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
    return { mode, query, postopDay: null, hits: r.hits.map((h) => ({ ...h, postopBoost: false })), excluded: r.excluded };
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
  return { mode, query, postopDay: day, hits: ordered.map((h, i) => ({ ...h, rank: i + 1 })), excluded: full.excluded };
}
