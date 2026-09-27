/**
 * ① 검색을 한 곳에서 부른다. 화면(브라우저), 녹화 스크립트, 평가가 모두 이 함수를 써서
 * "화면에서 본 검색 결과"와 "모델이 받은 문단"과 "평가가 잰 적중률"이 같은 질의·같은 순서에서 나온다.
 *
 * 경과일 앞세우기(PRD F17): 문의에서 경과일을 읽었으면, 소제목이 그 날짜 구간을 가리키는 문단
 * ("수술 후 머리 감기(D+3~D+14)")을 점수와 상관없이 결과 맨 앞에 둔다. BM25 점수만으로는
 * "9일째"가 "D+3~D+14" 구간에 든다는 것을 알 수 없기 때문이다.
 * 직원 질문(사내 Q&A)에는 적용하지 않는다 — "수술 2주째 환자가 고름이…"처럼 날짜보다 절차를 묻는 질문에서
 * 날짜 문단이 인계 절차 문단을 밀어낸다(평가로 확인).
 */

import { headingPostopRange, rangeContains } from "./postop";
import { queryFromInquiry, search, type ExcludedReport, type SearchHit, type SearchIndex } from "./search";

export const TOP_K = 5;

/**
 * 근거 약함 기준(PRD F7 "점수가 기준 미만이면 모델을 부르지 않고 보류").
 * 가장 높은 BM25 점수가 이 값보다 낮으면 `weak`이다. 모델을 부르지 않고 '근거 약함 — 문서 빈칸'으로 보류한다.
 *
 * 값을 정한 근거(합성 골든셋, 2026-09-28, 볼트 22편): 답할 수 있는 문항(mustHold=false 39개)과 초안 경로 문의의 최고 점수는
 * 가장 낮은 것이 9.65(G15 운전)·12.06(Q34)이고, 근거 없음 8문항은 4.67(와이파이)·7.40(할부)·8.52(숙소)·
 * 12.4~20.7(나머지 5개)이다. 두 분포가 겹쳐서 한 값으로 가를 수 없다. 그래서 **답할 수 있는 문항을 하나도
 * 막지 않는 가장 높은 쪽**으로 잡았다: 9.0 → 근거 없음 3/8만 여기서 걸리고, 나머지 5개는 모델의 '[근거 없음]'과
 * 사람이 막아야 한다. 올리면 답할 수 있는 문항이 보류되기 시작한다(G15). 볼트 문서가 늘면 다시 잰다(data/README.md).
 */
export const MIN_TOP_SCORE = 9;

export interface RetrievalHit extends SearchHit {
  /** 경과일 구간이 맞아서 앞에 세운 문단인지. 화면에 "경과일 D+N 구간"으로 표시한다. */
  postopBoost: boolean;
}

export interface Retrieval {
  mode: "reply" | "staff-qa";
  /** 실제로 검색한 질의(문의면 날짜·폼 칸 이름을 뺀 것). */
  query: string;
  postopDay: number | null;
  hits: RetrievalHit[];
  excluded: ExcludedReport[];
  /** 경과일 앞세우기와 상관없이, 가장 높은 BM25 점수(걸린 문단이 없으면 0). */
  topScore: number;
  /** topScore가 MIN_TOP_SCORE 미만. 모델을 부르지 않고 '근거 약함'으로 보류한다. */
  weak: boolean;
}

function strength(hits: SearchHit[]): { topScore: number; weak: boolean } {
  const topScore = hits.reduce((m, h) => Math.max(m, h.score), 0);
  return { topScore, weak: topScore < MIN_TOP_SCORE };
}

/**
 * @param text 문의면 가림 뒤의 원문, 직원 질문이면 질문 그대로.
 * @param postopDay 문의에서 읽었거나 직원이 고친 경과일. null이면 앞세우기를 하지 않는다.
 */
export function retrieve(index: SearchIndex, mode: "reply" | "staff-qa", text: string, postopDay: number | null = null, k = TOP_K): Retrieval {
  const query = mode === "reply" ? queryFromInquiry(text) : text;
  const day = mode === "reply" ? postopDay : null;
  if (day === null) {
    const r = search(index, query, k);
    return { mode, query, postopDay: null, hits: r.hits.map((h) => ({ ...h, postopBoost: false })), excluded: r.excluded, ...strength(r.hits) };
  }
  // 전체 순위를 받아 두고, 구간이 맞는 문단을 앞으로 옮긴다. 점수 0인 구간 문단도 앞에 선다(점수는 0으로 보인다).
  const full = search(index, query, index.docs.length);
  const scoreOf = new Map(full.hits.map((h) => [h.chunk.chunkId, h]));
  const boosted: SearchHit[] = [];
  index.docs.forEach(({ chunk }) => {
    const range = headingPostopRange(chunk.heading);
    if (range && rangeContains(range, day)) boosted.push(scoreOf.get(chunk.chunkId) ?? { rank: 0, chunk, score: 0, matchedTerms: [] });
  });
  boosted.sort((a, b) => b.score - a.score);
  const boostedIds = new Set(boosted.map((h) => h.chunk.chunkId));
  const ordered = [
    ...boosted.map((h) => ({ ...h, postopBoost: true })),
    ...full.hits.filter((h) => !boostedIds.has(h.chunk.chunkId)).map((h) => ({ ...h, postopBoost: false })),
  ].slice(0, k);
  // 근거 강도는 경과일로 앞에 세운 문단(점수 0일 수 있음)이 아니라 질의와 겹친 정도로만 잰다.
  return { mode, query, postopDay: day, hits: ordered.map((h, i) => ({ ...h, rank: i + 1 })), excluded: full.excluded, ...strength(full.hits) };
}
