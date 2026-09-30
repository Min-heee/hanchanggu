/**
 * ① 검색을 한 곳에서 부른다. 화면(브라우저), 녹화 스크립트, 평가가 모두 이 함수를 써서
 * "화면에서 본 검색 결과"와 "모델이 받은 문단"과 "평가가 잰 적중률"이 같은 질의·같은 순서에서 나온다.
 *
 * BM25 순위 위에 얹는 규칙은 넷이다. 모두 "무엇을 앞에 두나"만 바꾸고, 근거 강도(topScore·weak)는 **검색을 돕는 장치를
 * 모두 뺀** BM25 점수로 잰다: 넓히기 전 질의 × 소제목 끝의 찾는 말 괄호를 뺀 색인(`strengthIndex`). 앞에 세운 문단이나
 * 넓히기·찾는 말 때문에 근거 없는 질문이 '근거 있음'으로 바뀌면 안 되기 때문이다 — 3차 적대 검증에서 "카드 할부 개월 수
 * 바꿀 수 있어요?"(6.8 → 19.8), "…준비해 올 것도요"(9.0 → 21.3)가 넓힌 질의·찾는 말 소제목 점수로 검색 단계 보류를 빠져나갔다.
 *
 * 1. 질의 넓히기: 환자가 쓰는 말("바꾸고 싶어요", "미룰 수")이 문서의 말("예약 변경")과 글자가 하나도 안 겹치면
 *    2-gram BM25로는 찾을 수 없다. 볼트 문서(V04) json의 searchSynonyms에 적힌 말이 질의에 있고, withAny가 있으면 그 말도
 *    함께 있을 때만 문서의 말을 질의 뒤에 붙인다. withAny가 없으면 "샴푸 바꿔도 돼요?"·"염색 미뤄야 하나요?"에도
 *    예약 문단이 발췌 5칸을 차지했다. 목록은 코드에 두지 않는다 — 놓친 표현을 더하는 사람은 원무팀이다.
 * 2. 경과일 앞세우기(PRD F17): 문의에서 경과일을 읽었으면, 소제목이 그 날짜 구간을 가리키는 문단
 *    ("수술 후 머리 감기(D+3~D+14)")을 점수와 상관없이 결과 맨 앞에 둔다. BM25 점수만으로는
 *    "9일째"가 "D+3~D+14" 구간에 든다는 것을 알 수 없기 때문이다.
 *    직원 질문(사내 Q&A)에는 적용하지 않는다 — "수술 2주째 환자가 고름이…"처럼 날짜보다 절차를 묻는 질문에서
 *    날짜 문단이 인계 절차 문단을 밀어낸다(평가로 확인).
 * 3. 직원 질문의 인계 절차 앞세우기: 직원 질문에 적신호 말(V11 json)이나 약 말(V17 json)이 있으면 적신호 문서·인계 절차 문서(V12)·
 *    약 문서의 문단을 앞에 둔다. 2회차 녹화 G46("수술 2주째 … 고름 … 연고 바르라고 해도 돼요?")은 BM25 상위 5개가 모두
 *    수술 후 안내(V07)여서 초안이 인계·연고 금지를 빼먹었다. 말 목록은 문의 게이트가 쓰는 것과 같은 볼트 값을 읽는다.
 * 4. 날짜 세는 기준 함께 보내기: 질문이 경과일을 말하고 D+N 소제목 문단(D+3~D+14 등)이 결과에 있으면, 같은 문서에서 "D+0"을 정한 문단을 함께 보낸다.
 *    기준 없이 "D+3부터"만 가면 "수술 3일째"가 D+2인지 D+3인지 직원이 알 수 없다(2회차 녹화 G16 검토).
 *
 * 인계 문의의 의료진 확인용 초안(PRD v0.3)은 `retrieveForHandover`로 따로 찾는다. BM25 순위는 같이 쓰되 위 규칙 2·4(경과일 앞세우기·날짜 세는
 * 기준)는 끄고, 보낼 수 있는 문단(core/knowledge.ts handoverExcerptChunkIds — 고정 안내·즉시 조치·수술 후 즉시 조치 문단)만 남기고,
 * 고정 안내 문단과 적신호 기준의 즉시 조치 문단을 맨 앞에 세운다. 그 뒤에, 문의의 물음 절에 의료가 아닌 물음(예약·가격 등)이 있으면 그용 문단
 * (core/knowledge.ts handoverGeneralChunkIds)을 점수 순으로 최대 2칸 더한다(2026-09-30 오너 두 번째 결정).
 */

import { inquiryClauses } from "./clauses";
import type { MedicationConfig } from "./medication";
import { checkMedication } from "./medication";
import { headingPostopRange, rangeContains, readPostopDay } from "./postop";
import { checkRedflags, normalizeForMatch, type RedflagConfig, type RedflagResult } from "./redflag";
import { queryFromInquiry, search, type ExcludedReport, type SearchHit, type SearchIndex } from "./search";
import type { Chunk } from "./vault";

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

/** 질의 넓히기 한 줄: words 중 하나라도 질의에 있고(withAny가 있으면 그중 하나도 있을 때) searchAs를 질의에 더한다. */
export interface QuerySynonym {
  words: string[];
  searchAs: string;
  /** 함께 있어야 하는 말. "바꾸"만으로는 예약 이야기인지 알 수 없다(샴푸를 바꾸는 것일 수 있다). 없으면 조건 없음. */
  withAny?: string[];
}

/** 직원 질문 앞세우기에 쓰는 볼트 값과 문서 ID. core/knowledge.ts가 채운다. */
export interface StaffPinRules {
  redflag: RedflagConfig;
  medication: MedicationConfig;
  redflagDocId: string;
  handoverDocId: string;
  medicationDocId: string;
}

/**
 * 인계 초안 발췌 규칙(PRD v0.3). core/knowledge.ts가 볼트에서 채운다.
 * 보낼 문단 목록(chunkIds)을 코드가 미리 정한다 — 환자에게 갈 초안에 직원 절차·날짜별 일반 관리·약 복용 안내가 섞일 자리를
 * 지시문(규칙 18·19)에만 맡기지 않고 발췌에서 없앤다.
 */
export interface HandoverDraftRules {
  /** 인계 초안이 인용해도 되는 문서(승인된 최신판만). 인용 대조의 허용 목록이다. */
  docIds: string[];
  /** 모델에 보내도 되는 문단(core/knowledge.ts handoverExcerptChunkIds). 고정 안내·즉시 조치 문단 포함. */
  chunkIds: string[];
  /** 고정 안내 문단. 읽지 못하면 null — 인계 초안은 모델을 부르지 않고 보류한다(src/demo/record.ts). */
  fixedChunkId: string | null;
  /** 고정 안내 문단의 따옴표 안 승인 문구. 초안에 통째로 들어 있어야 통과한다(src/llm/handover-check.ts checkHandoverDraft). 읽지 못하면 null(보류). */
  fixedMessage: string | null;
  /** 고정 안내 다음에 세울 즉시 조치 문단(적신호 기준 '문맥 없이도 인계하는 증상' — 119·응급실 안내). 없으면 세우지 않는다. */
  urgentChunkId: string | null;
  /**
   * 문의에 섞인 의료가 아닌 물음(진료시간·가격·예약·반품 등)의 답으로 보낼 수 있는 문단(core/knowledge.ts handoverGeneralChunkIds).
   * 없거나 비면 더하지 않는다.
   */
  generalChunkIds?: string[];
}

/** 인계 초안 발췌에 더하는 의료가 아닌 물음용 문단의 최대 칸 수. */
export const HANDOVER_GENERAL_MAX = 2;

/**
 * 의료가 아닌 물음의 말(가격·예약·진료시간·주차·오시는 길·쇼핑몰). 인계 문의의 **물음 절**(core/clauses.ts)에 이 말이 있을 때만 행정 안내 문단을 더한다
 * (2026-09-30 적대 검증: BM25 점수만으로 고르니 38도 열 문의(Q14)에 쇼핑몰 안내, 두드러기(Q19)에 주사 가격, 출혈(Q08)에 예약 변경이 붙었다).
 * "번호는 예약 기록과 같다고 함"처럼 물음이 아닌 절의 '예약'은 세지 않는다.
 */
export const HANDOVER_ADMIN_WORDS = /얼마|가격|비용|금액|요금|예약|변경|취소|환불|시간|몇\s*시|휴진|쉬는\s*날|주차|오시는|위치|주소|반품|교환|배송|주문|결제/u;

/** 문의의 물음 절에 의료가 아닌 물음의 말이 있나(retrieveForHandover가 행정 안내 문단을 더할지). */
export function asksAdminQuestion(text: string): boolean {
  return inquiryClauses(text).some((c) => c.question && HANDOVER_ADMIN_WORDS.test(c.text));
}

export interface RetrievalRules {
  synonyms: QuerySynonym[];
  staffPins: StaffPinRules | null;
  /** 근거 강도만 재는 색인(소제목 끝의 찾는 말 괄호를 뺀 것, `stripSearchAlias`). 없으면 순위 색인으로 잰다. */
  strengthIndex?: SearchIndex;
  /** 없으면 인계 초안 발췌가 비어 초안을 만들지 않는다. */
  handoverDraft?: HandoverDraftRules | null;
}

/**
 * 소제목 끝의 '찾는 말' 괄호("예약 변경(날짜·시간을 바꾸고 싶을 때)")를 뗀다. 이 괄호는 환자가 쓰는 말로도 문단을 찾게
 * 하려고 볼트에 더한 검색용 말이라, 근거 강도에 넣으면 그 말만 겹쳐도 근거가 있는 것처럼 보인다.
 * 숫자가 든 괄호("수술 후 머리 감기(D+3~D+14)", "(3판)")는 문단이 다루는 범위·판이라 본문 정보로 보고 남긴다.
 * 볼트를 쓰는 규칙이기도 하다(data/README.md): 찾는 말 괄호에는 숫자를 쓰지 않는다.
 */
export function stripSearchAlias(heading: string | null): string | null {
  return heading === null ? null : heading.replace(/\s*\([^()0-9]*\)\s*$/, "");
}

/**
 * 검색 색인 + 순위 규칙. 규칙을 색인에 붙여 두는 이유: 화면·녹화·평가·드리프트 검사가 모두 `retrieve(k.index, …)`로
 * 부르므로, 인자를 늘리면 부르는 곳마다 규칙을 빠뜨릴 수 있다(한 곳만 빠지면 화면과 녹화의 발췌가 조용히 달라진다).
 * rules가 없으면(시험용 작은 색인) BM25와 경과일 앞세우기만 한다.
 */
export interface RetrievalIndex extends SearchIndex {
  rules?: RetrievalRules;
}

/**
 * 앞에 세운 까닭. redflag·handover·medication: 직원 질문 규칙(3), day-base: 날짜 세는 기준(4).
 * 인계 초안의 고정 안내 문단은 handover, 적신호 기준의 즉시 조치 문단은 redflag다(retrieveForHandover).
 */
export type PinReason = "redflag" | "handover" | "medication" | "day-base";

export interface RetrievalHit extends SearchHit {
  /** 경과일 구간이 맞아서 앞에 세운 문단인지. 화면에 "경과일 D+N 구간"으로 표시한다. */
  postopBoost: boolean;
  /** 점수와 상관없이 규칙으로 넣은 문단이면 그 까닭. BM25 순위로 들어온 문단은 null. */
  pin: PinReason | null;
}

export interface Retrieval {
  mode: "reply" | "staff-qa";
  /** 실제로 검색한 질의(문의면 날짜·폼 칸 이름을 뺀 것, 넓히기로 더한 말 포함). */
  query: string;
  /** 질의 넓히기로 질의 뒤에 더한 말(searchAs). 화면이 "‘예약 변경’으로도 찾았습니다"를 보일 수 있게 따로 둔다. */
  expandedWith: string[];
  postopDay: number | null;
  hits: RetrievalHit[];
  excluded: ExcludedReport[];
  /** 근거 강도: 넓히기 전 질의로 찾는 말 괄호를 뺀 색인에서 잰 가장 높은 BM25 점수(걸린 문단이 없으면 0). 앞세우기와 상관없다. */
  topScore: number;
  /** topScore가 MIN_TOP_SCORE 미만. 모델을 부르지 않고 '근거 약함'으로 보류한다. */
  weak: boolean;
}

export type SynonymsResult = { ok: true; synonyms: QuerySynonym[] } | { ok: false; error: string };

/**
 * 볼트 json의 searchSynonyms를 읽는다. 빈 말·빈 searchAs는 거부한다 — 빈 말은 모든 질의에 걸려(`includes("")`)
 * 모든 질문에 문서의 말을 붙인다.
 */
export function parseQuerySynonyms(json: unknown, docId: string): SynonymsResult {
  const bad = (why: string): SynonymsResult => ({ ok: false, error: `${docId} searchSynonyms ${why}` });
  if (typeof json !== "object" || json === null || Array.isArray(json)) return bad("json이 객체가 아닙니다");
  const list = (json as Record<string, unknown>).searchSynonyms;
  if (!Array.isArray(list)) return bad("가 배열이 아닙니다");
  const out: QuerySynonym[] = [];
  for (const e of list) {
    if (typeof e !== "object" || e === null) return bad("항목이 객체가 아닙니다");
    const { words, searchAs, withAny } = e as Record<string, unknown>;
    const nonEmpty = (v: unknown): v is string[] => Array.isArray(v) && v.length > 0 && v.every((w) => typeof w === "string" && normalizeForMatch(w) !== "");
    if (!nonEmpty(words)) return bad("words가 빈 값 없는 문자열 배열이 아닙니다");
    if (typeof searchAs !== "string" || searchAs.trim() === "") return bad("searchAs가 비어 있습니다");
    // withAny를 빈 배열로 두면 어떤 질의에도 붙지 않는다. 적은 사람의 뜻(조건 없음?)을 알 수 없으므로 거부한다.
    if (withAny !== undefined && !nonEmpty(withAny)) return bad("withAny가 빈 값 없는 문자열 배열이 아닙니다");
    out.push({ words, searchAs: searchAs.trim(), ...(withAny !== undefined ? { withAny } : {}) });
  }
  return { ok: true, synonyms: out };
}

/** 질의에 넓히기 말이 있으면 문서의 말을 뒤에 붙인다. 이미 질의에 문서의 말이 있으면 붙이지 않는다(점수를 부풀리지 않게). */
export function expandQuery(query: string, synonyms: QuerySynonym[]): { query: string; expandedWith: string[] } {
  const norm = normalizeForMatch(query);
  const added: string[] = [];
  for (const s of synonyms) {
    if (added.includes(s.searchAs) || norm.includes(normalizeForMatch(s.searchAs))) continue;
    const has = (list: string[]) => list.some((w) => norm.includes(normalizeForMatch(w)));
    if (has(s.words) && (s.withAny === undefined || has(s.withAny))) added.push(s.searchAs);
  }
  return { query: added.length === 0 ? query : `${query} ${added.join(" ")}`, expandedWith: added };
}

function strength(hits: SearchHit[]): { topScore: number; weak: boolean } {
  const topScore = hits.reduce((m, h) => Math.max(m, h.score), 0);
  return { topScore, weak: topScore < MIN_TOP_SCORE };
}

/**
 * 문서에서 앞에 세울 문단 하나. 고르는 순서:
 * 1) 소제목에 '직원'이 든 절("직원이 하지 않는 것", "직원이 하는 일") 중 첫 문단 — 직원 질문은 "해도 돼요?"처럼 직원의 행동을 묻고,
 *    볼트 문서는 그 답을 이런 절에 모아 둔다.
 * 2) 질문에서 걸린 말(고름·연고 등)이 가장 많이 적힌 문단.
 * 3) 문서의 첫 문단 — 볼트 문서는 첫 절에 원칙("언제 인계하나", "원칙")을 둔다.
 * BM25로 고르지 않는 까닭: 질문의 '환자가', '수술 후' 같은 말에 끌려 "무엇을 기록하나"·"공개 창구" 같은 곁가지 문단이
 * 뽑혔다(G46으로 확인).
 */
function pickChunk(index: SearchIndex, docId: string, words: string[]): Chunk | null {
  const chunks = index.docs
    .map((d) => d.chunk)
    .filter((c) => c.docId === docId)
    .sort((a, b) => a.index - b.index);
  if (chunks.length === 0) return null;
  const staff = chunks.find((c) => c.heading !== null && c.heading.includes("직원"));
  if (staff) return staff;
  const needles = words.map(normalizeForMatch).filter((w) => w !== "");
  let best = chunks[0];
  let bestCount = 0;
  for (const c of chunks) {
    const text = normalizeForMatch(c.text);
    const count = needles.filter((w) => text.includes(w)).length;
    if (count > bestCount) {
      best = c;
      bestCount = count;
    }
  }
  return best;
}

/**
 * 직원 질문이 적신호·약 규칙에 걸렸는지와, 그때 앞에 세울 문단. 발췌 앞세우기(규칙 3)와 사내 Q&A의 규칙 카드(src/demo/qa.ts)가
 * 이 함수 하나를 쓴다 — 둘이 따로 판정하면 "카드는 떴는데 인계 절차 문단은 발췌에 없는" 화면이 생길 수 있다.
 * 말 목록은 문의 게이트와 같은 볼트 값(V11·V17)이다. 코드에 목록을 따로 두지 않는다.
 */
export interface StaffRuleHits {
  redflag: RedflagResult;
  /** 약 말 중 qaPinIgnore를 뺀 것. 게이트(checkMedication)의 matchedTerms보다 좁다. */
  medTerms: string[];
  /** 적신호나 약 규칙 중 하나라도 걸렸는지. */
  hit: boolean;
  redflagChunk: Chunk | null;
  medicationChunk: Chunk | null;
  /** 인계 절차 문서에서 고른 문단. 적신호면 시한 문단, 약 문의뿐이면 첫 문단. 규칙에 안 걸렸거나 문서가 없으면 null. */
  handoverChunk: Chunk | null;
}

export function staffRuleHits(index: SearchIndex, rules: StaffPinRules, question: string): StaffRuleHits {
  const redflag = checkRedflags(question, rules.redflag);
  const med = checkMedication(question, rules.medication);
  const red = redflag.decision === "handover";
  // 약 말은 직원 질문용 기준이 게이트보다 좁다(V17 qaPinIgnore — "약도"·"먹어도"만 있으면 약 질문이 아닐 때가 많다).
  const medTerms = med.matchedTerms.filter((t) => !(rules.medication.qaPinIgnore ?? []).includes(t));
  const hit = red || medTerms.length > 0;
  return {
    redflag,
    medTerms,
    hit,
    redflagChunk: red ? pickChunk(index, rules.redflagDocId, [...redflag.matchedSymptoms, ...redflag.matchedAmbiguous]) : null,
    medicationChunk: medTerms.length > 0 ? pickChunk(index, rules.medicationDocId, medTerms) : null,
    // 인계 절차 문서에서는, 적신호면 시한("적신호 문의는 … 5분 안에 인계합니다")이 든 문단을, 약 문의뿐이면 첫 문단("언제 인계하나")을 고른다.
    // 2회차 G46 검토에서 빠진 핵심이 '5분 안에 인계'였는데, 말 없이 고르면 첫 문단이 와 그 문장이 모델에 가지 않았다(3차 회귀 확인).
    handoverChunk: hit ? pickChunk(index, rules.handoverDocId, red ? ["적신호"] : []) : null,
  };
}

/** 직원 질문 규칙(3): 적신호 → 적신호 문서, 약 → 약 문서, 둘 중 하나라도 → 인계 절차 순으로 앞에 둘 문단. */
function staffPins(index: SearchIndex, rules: StaffPinRules, question: string): { chunk: Chunk; pin: PinReason }[] {
  const h = staffRuleHits(index, rules, question);
  const out: { chunk: Chunk; pin: PinReason }[] = [];
  const add = (c: Chunk | null, pin: PinReason) => {
    if (c && !out.some((o) => o.chunk.chunkId === c.chunkId)) out.push({ chunk: c, pin });
  };
  add(h.redflagChunk, "redflag");
  add(h.medicationChunk, "medication");
  add(h.handoverChunk, "handover");
  return out;
}

/** "D+0"을 정한 문장(날짜 세는 기준). D+0 뒤에 숫자가 붙은 D+01 같은 표기는 아니다. */
const DAY_BASE = /D\s*\+\s*0(?!\d)/i;
/**
 * D+N 표기가 든 소제목("D+1 내원", "수술 후 머리 감기(D+3~D+14)"). "4주 경과 진료"·"6개월 경과 진료"처럼 D+ 없이 적은 소제목은
 * 날짜를 세는 기준이 답에 필요하지 않아 넣지 않는다(G46 "수술 2주째 … 고름" 질문에 "4주 경과 진료" 문단이 걸려도 D+0은 답과 상관없다).
 */
const D_PLUS_HEADING = /D\s*\+\s*\d/i;

/**
 * 규칙 4: 날짜 구간 문단이 든 문서마다 D+0 기준 문단을 마지막 날짜 구간 문단 바로 뒤에 넣는다. 자리는 뒤에서부터
 * '규칙으로 넣지 않았고 날짜 구간도 아닌' 문단 하나를 빼서 만든다 — 발췌 개수(k)는 늘리지 않는다. 뺄 문단이 없으면 넣지 않는다.
 */
function withDayBase(index: SearchIndex, hits: RetrievalHit[], hitOf: (c: Chunk) => SearchHit, k: number, allow: (c: Chunk) => boolean): RetrievalHit[] {
  let out = [...hits];
  const isDate = (h: RetrievalHit) => h.chunk.heading !== null && D_PLUS_HEADING.test(h.chunk.heading.normalize("NFKC"));
  const docs = [...new Set(out.filter(isDate).map((h) => h.chunk.docId))];
  for (const docId of docs) {
    const base = index.docs.map((d) => d.chunk).find((c) => c.docId === docId && DAY_BASE.test(c.text) && allow(c));
    if (!base || out.some((h) => h.chunk.chunkId === base.chunkId)) continue;
    if (out.length >= k) {
      let drop = -1;
      for (let i = out.length - 1; i >= 0; i--) {
        if (!out[i].postopBoost && out[i].pin === null && !isDate(out[i])) {
          drop = i;
          break;
        }
      }
      if (drop === -1) continue;
      out = out.filter((_, i) => i !== drop);
    }
    let last = -1;
    out.forEach((h, i) => {
      if (h.chunk.docId === docId && isDate(h)) last = i;
    });
    out.splice(last + 1, 0, { ...hitOf(base), postopBoost: false, pin: "day-base" });
  }
  return out.slice(0, k);
}

/**
 * @param text 문의면 가림 뒤의 원문, 직원 질문이면 질문 그대로.
 * @param postopDay 문의에서 읽었거나 직원이 고친 경과일. null이면 앞세우기를 하지 않는다.
 */
export function retrieve(index: RetrievalIndex, mode: "reply" | "staff-qa", text: string, postopDay: number | null = null, k = TOP_K): Retrieval {
  return rank(index, mode, text, postopDay, k, {});
}

/**
 * 인계 문의의 의료진 확인용 초안(PRD v0.3)이 받을 발췌. `retrieve(…, "reply", …)`와 같은 질의·BM25 순위에서
 * ① 보낼 수 있는 문단(HandoverDraftRules.chunkIds) 밖은 뺀다. ② 고정 안내 문단(의료진이 확인한 뒤 연락한다는 승인 문구, pin "handover")과
 * 적신호 기준의 즉시 조치 문단(pin "redflag")을 점수와 상관없이 이 순서로 맨 앞에 세운다.
 * 경과일 앞세우기와 날짜 세는 기준 문단은 쓰지 않는다(경과일을 받지 않는다) — 켜 두면 증상 문의 발췌가 V07 날짜별 일반 관리 문단으로 찬다
 * (2026-09-30 검증: Q06 V12#4 V07#3 V07#9 V07#2 V07#0). 볼트 V11은 증상이 적힌 문의에 수술 후 일반 안내로 답하지 말라고 적는다.
 * ③ 문의의 물음 절에 의료가 아닌 물음의 말(HANDOVER_ADMIN_WORDS)이 있으면, 그 답이 될 문단(HandoverDraftRules.generalChunkIds)을 같은 질의·같은
 * BM25 점수로 골라, 점수가 근거 약함 기준(MIN_TOP_SCORE) 이상인 것만 최대 HANDOVER_GENERAL_MAX칸 고정 문단 바로 뒤에 둔다(2026-09-30 오너 두 번째 결정).
 * 물음 말이 있어도 점수로 고르므로 묻지 않은 예약·가격 문단이 섞일 수 있다 — 묻지 않은 것은 쓰지 말라는 것은 지시문(규칙 18)이 맡고, 인용 문장이 원문
 * 그대로인지·숫자·가격 칸은 검증기와 인계 초안 검사가, 문의와 상관있는 답인지는 의료진 확인이 맡는다.
 * 근거 강도(topScore·weak)는 기록만 한다 — 답의 핵심인 고정 안내 문단이 늘 들어가므로 인계 초안에는 근거 약함 관문을 걸지 않는다.
 * 규칙이 없으면(시험용 작은 색인) 발췌가 비고, 초안을 만들지 않는다.
 */
export function retrieveForHandover(index: RetrievalIndex, text: string, k = TOP_K): Retrieval {
  const rules = index.rules?.handoverDraft ?? null;
  const allowed = new Set(rules?.chunkIds ?? []);
  const allow = (c: Chunk) => allowed.has(c.chunkId);
  const chunkOf = (id: string | null | undefined) => (id ? (index.docs.find((d) => d.chunk.chunkId === id)?.chunk ?? null) : null);
  const pins: { chunk: Chunk; pin: PinReason }[] = [];
  const fixed = chunkOf(rules?.fixedChunkId);
  const urgent = chunkOf(rules?.urgentChunkId);
  if (fixed && allow(fixed)) pins.push({ chunk: fixed, pin: "handover" });
  if (urgent && allow(urgent)) pins.push({ chunk: urgent, pin: "redflag" });
  const base = rank(index, "reply", text, null, k, { allow, pins });
  const generalIds = new Set(rules?.generalChunkIds ?? []);
  // 고정 문단이 없으면(고정 안내를 읽지 못함) 초안을 만들지 않으므로 의료가 아닌 물음용 문단도 더하지 않는다.
  // 문의의 물음 절에 의료가 아닌 물음의 말이 없으면 더하지 않는다 — 묻지 않은 행정 안내가 증상 문의 초안에 끼지 않게.
  if (generalIds.size === 0 || !base.hits.some((h) => h.pin === "handover") || !asksAdminQuestion(text)) return base;
  const general = rank(index, "reply", text, null, HANDOVER_GENERAL_MAX, { allow: (c) => generalIds.has(c.chunkId) }).hits.filter((h) => h.score >= MIN_TOP_SCORE);
  const pinned = base.hits.filter((h) => h.pin !== null);
  const rest = base.hits.filter((h) => h.pin === null);
  return { ...base, hits: [...pinned, ...general, ...rest].slice(0, k).map((h, i) => ({ ...h, rank: i + 1 })) };
}

interface RankOptions {
  /** 결과에 넣어도 되는 문단. 없으면 모두. */
  allow?: (c: Chunk) => boolean;
  /** 점수와 상관없이 맨 앞(경과일 구간 문단보다도 앞)에 세울 문단. */
  pins?: { chunk: Chunk; pin: PinReason }[];
}

function rank(index: RetrievalIndex, mode: "reply" | "staff-qa", text: string, postopDay: number | null, k: number, opts: RankOptions): Retrieval {
  const allow = opts.allow ?? (() => true);
  const baseQuery = mode === "reply" ? queryFromInquiry(text) : text;
  const { query, expandedWith } = expandQuery(baseQuery, index.rules?.synonyms ?? []);
  const day = mode === "reply" ? postopDay : null;
  // 전체 순위를 받아 두고 규칙으로 앞에 세울 문단을 옮긴다. 점수 0인 문단도 앞에 설 수 있다(점수는 0으로 보인다).
  const full = search(index, query, index.docs.length);
  const scoreOf = new Map(full.hits.map((h) => [h.chunk.chunkId, h]));
  const hitOf = (chunk: Chunk): SearchHit => scoreOf.get(chunk.chunkId) ?? { rank: 0, chunk, score: 0, matchedTerms: [] };

  const front: RetrievalHit[] = [];
  for (const p of opts.pins ?? []) {
    if (!front.some((h) => h.chunk.chunkId === p.chunk.chunkId)) front.push({ ...hitOf(p.chunk), postopBoost: false, pin: p.pin });
  }
  if (day !== null) {
    const boosted: SearchHit[] = [];
    index.docs.forEach(({ chunk }) => {
      const range = headingPostopRange(chunk.heading);
      if (range && rangeContains(range, day) && allow(chunk) && !front.some((h) => h.chunk.chunkId === chunk.chunkId)) boosted.push(hitOf(chunk));
    });
    boosted.sort((a, b) => b.score - a.score);
    front.push(...boosted.map((h) => ({ ...h, postopBoost: true, pin: null })));
  }
  // 직원 질문에만: 문의는 적신호·약 말이 있으면 규칙 게이트가 먼저 인계로 정한다(인계 초안은 retrieveForHandover가 인계 발췌로 따로 찾는다).
  if (mode === "staff-qa" && index.rules?.staffPins) {
    for (const p of staffPins(index, index.rules.staffPins, text)) {
      if (!front.some((h) => h.chunk.chunkId === p.chunk.chunkId)) front.push({ ...hitOf(p.chunk), postopBoost: false, pin: p.pin });
    }
  }
  const frontIds = new Set(front.map((h) => h.chunk.chunkId));
  const ordered = [
    ...front,
    ...full.hits.filter((h) => !frontIds.has(h.chunk.chunkId) && allow(h.chunk)).map((h) => ({ ...h, postopBoost: false, pin: null })),
  ].slice(0, k);
  // 날짜 세는 기준은 질문이 경과일을 말할 때만 보낸다. 예약 문의에 'D+1 내원' 문단이 점수로 섞여 들어온 경우까지 넣으면
  // 발췌 한 칸을 곁가지 두 개가 차지한다(Q33으로 확인). 직원 질문은 앞세우기에 쓰지 않는 경과일을 여기서만 읽는다.
  const asksDay = mode === "reply" ? day !== null : readPostopDay(text) !== null;
  const hits = asksDay ? withDayBase(index, ordered, hitOf, k, allow) : ordered;
  // 근거 강도는 앞세운 문단(점수 0일 수 있음)도, 넓히기로 더한 말도, 소제목의 찾는 말도 빼고 문의 원래 말과 겹친 정도로만 잰다.
  return {
    mode,
    query,
    expandedWith,
    postopDay: day,
    hits: hits.map((h, i) => ({ ...h, rank: i + 1 })),
    excluded: full.excluded,
    ...strength(search(index.rules?.strengthIndex ?? index, baseQuery, 1).hits),
  };
}
