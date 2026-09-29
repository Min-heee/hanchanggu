/**
 * ① 검색: 한국어 문자 2-gram + 단어 BM25.
 *
 * 왜 임베딩이 아닌가(PRD 5절): 문서 20편·문단 수백 개 규모이고 "D+3", "모당" 같은
 * 정확히 맞아야 하는 용어가 많다. 점수가 어떤 글자 조각에서 왔는지 사람이 설명할 수 있어야
 * 직원이 "왜 이 문단이 근거인가"를 확인할 수 있다.
 *
 * 왜 2-gram인가: 한국어는 조사가 붙어 단어가 매번 모양을 바꾼다("수술 후" / "수술후" / "수술이").
 * 형태소 분석기 없이도 "수술"이라는 2글자 조각은 셋 모두에 남는다.
 */

import type { Chunk, ExcludedDoc } from "./vault";

/**
 * BM25 상수. 흔히 쓰는 기본값을 그대로 둔다(문단 길이가 비슷해 b를 조정할 근거가 아직 없다).
 * k1: 같은 조각이 여러 번 나올 때 점수가 얼마나 더 오르는지(포화 속도). b: 문단 길이 보정의 세기(0~1).
 */
export const BM25_K1 = 1.2;
export const BM25_B = 0.75;

/** 상수가 범위를 벗어나면 색인을 만들지 않는다(k1과 b를 뒤바꾸는 실수는 순위만 조용히 바꾼다). */
export function assertBm25Params(k1: number = BM25_K1, b: number = BM25_B): void {
  if (!(b >= 0 && b <= 1)) throw new Error(`BM25 b는 0~1이어야 합니다: ${b}`);
  if (!(k1 > 0 && k1 <= 3)) throw new Error(`BM25 k1은 0보다 크고 3 이하여야 합니다: ${k1}`);
}

const HANGUL = /[ㄱ-ㆎ가-힣]/;

/** 날수를 뜻하는 고유어. "열흘째"를 "D+10"과 같은 조각으로 읽으려고 둔다. */
const DAY_WORDS: Record<string, number> = { 하루: 1, 이틀: 2, 사흘: 3, 나흘: 4, 닷새: 5, 엿새: 6, 이레: 7, 열흘: 10, 보름: 15 };

/**
 * 단어 끝의 조사. 떼어 낸 줄기를 조각 하나로 더한다("술은" → "술", "예약금은" → "예약금").
 * 2-gram만으로는 두 글자 단어에 조사가 붙으면("술은") 원래 말("술")과 겹치는 조각이 하나도 없다.
 * 긴 것부터 본다. "이·가·의·과·도·로"처럼 단어 끝 글자와 자주 겹치는 조사는 넣지 않는다
 * ("문의" → "문", "효과" → "효"처럼 엉뚱한 줄기가 생겨 검색을 흐린다).
 */
const JOSA = ["에서는", "으로", "에서", "부터", "까지", "에는", "에도", "이고", "인데", "은", "는", "을", "를", "에"];

function stem(w: string): string | null {
  const chars = [...w];
  if (chars.length < 2 || !HANGUL.test(w)) return null;
  for (const j of JOSA) {
    if (w.endsWith(j) && chars.length - [...j].length >= 1) return chars.slice(0, chars.length - [...j].length).join("");
  }
  return null;
}

/**
 * 텍스트를 검색어 조각(term)으로 바꾼다.
 * - `w:` 단어 전체. "D+3"은 한 단어로 본다(수술 후 날짜 표기가 쪼개지면 "3"만 남아 쓸모가 없다).
 *   조사를 뗀 줄기도 `w:`로 하나 더한다(한 글자 줄기면 `g:`도).
 * - "3일째"·"3일차"·"사흘째"는 `w:d+3`을 하나 더한다. 문서는 수술 후 날짜를 "D+3"으로 적는다.
 * - `g:` 한글이 든 단어의 문자 2-gram. 한 글자 단어("열")는 그 글자 하나를 조각으로 쓴다.
 * 정규화: NFKC(전각·반각 통일) + 소문자.
 */
export function tokenize(text: string): string[] {
  const norm = text.normalize("NFKC").toLowerCase();
  const words = norm.match(/d\s*\+\s*\d+|[\p{L}\p{N}]+/gu) ?? [];
  const terms: string[] = [];
  for (const raw of words) {
    const w = raw.replace(/\s+/g, "");
    terms.push(`w:${w}`);
    const day = /^(\d{1,3})일(?:째|차)/.exec(w) ?? null;
    const dayWord = Object.keys(DAY_WORDS).find((k) => w.startsWith(`${k}째`) || w.startsWith(`${k}차`));
    if (day) terms.push(`w:d+${Number(day[1])}`);
    else if (dayWord) terms.push(`w:d+${DAY_WORDS[dayWord]}`);
    if (HANGUL.test(w)) {
      const chars = [...w];
      if (chars.length === 1) terms.push(`g:${chars[0]}`);
      for (let i = 0; i + 1 < chars.length; i++) terms.push(`g:${chars[i]}${chars[i + 1]}`);
      const st = stem(w);
      if (st) {
        terms.push(`w:${st}`);
        if ([...st].length === 1) terms.push(`g:${st}`);
      }
    }
  }
  return terms;
}

/**
 * 문의 원문에서 검색 질의를 만든다. 날짜·요일·시각, 폼 칸 이름, 가림 표시를 뺀다.
 * 긴 문의에 "9월 29일(화)", "오후 3시"가 섞이면 진료시간 문서(V02)가 날짜·요일 조각으로 이겨
 * 정작 물은 규정(예약 변경, 주사 일정)이 밀려난다. 직원 질문에는 쓰지 않는다(날짜 자체를 묻는 경우가 있다).
 */
export function queryFromInquiry(text: string): string {
  return text
    .normalize("NFKC")
    // 가린 자리 바로 앞의 칸 이름("연락처 [전화]", "주민번호 [주민번호]")도 문의 내용이 아니다. 쌍점 없이 쓴 칸 이름이
    // 남으면 개인정보 안내 문서(V16)가 '연락처·이메일·주민번호' 조각으로 이겨 정작 물은 규정(예약 변경)을 밀어낸다
    // (2회차 녹화 Q17). 가린 자리 앞일 때만 지운다 — "보호자 [이름]"의 '보호자'처럼 뜻이 있는 말은 목록에 넣지 않는다.
    .replace(/(?:연락처|전화번호|휴대폰|핸드폰|이메일|주민번호|주민등록번호|생년월일|주소|성함|이름)\s*[:：]?\s*(?=\[(?:이름|전화|이메일|주민번호|생년월일|주소)\])/g, " ")
    .replace(/\[(?:이름|전화|이메일|주민번호|생년월일|주소)\]/g, " ")
    // 폼·예약 요청사항의 칸 이름("연락처:", "문의:")은 문의 내용이 아니다.
    .replace(/(?:이름|성함|연락처|전화번호|주소|이메일|문의|요청사항|희망 시기|이식 희망 부위)\s*[:：]/g, " ")
    .replace(/\d{4}\s*[-./년]\s*\d{1,2}\s*[-./월]\s*\d{1,2}\s*일?/g, " ")
    .replace(/\d{1,2}\s*월\s*\d{1,2}\s*일/g, " ")
    .replace(/\(\s*[월화수목금토일]\s*\)/g, " ")
    .replace(/(?:오전|오후|저녁|아침)?\s*\d{1,2}\s*시(?:\s*\d{1,2}\s*분|\s*반)?/g, " ")
    .replace(/[월화수목금토일]요일/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

interface IndexedChunk {
  chunk: Chunk;
  tf: Map<string, number>;
  length: number;
}

export interface SearchIndex {
  docs: IndexedChunk[];
  df: Map<string, number>;
  avgLength: number;
  /** 제외 문서의 청크. 점수는 매기되(화면에 '걸렸지만 제외됨'을 보이려고) 결과 hits에는 절대 넣지 않는다. */
  excludedDocs: { doc: ExcludedDoc; chunks: IndexedChunk[] }[];
}

function indexChunk(chunk: Chunk): IndexedChunk {
  // 제목도 검색 대상에 넣는다. "수술 후 관리 > D+3" 같은 소제목이 문단 본문에는 없는 경우가 많다.
  const terms = tokenize(`${chunk.heading ?? ""}\n${chunk.text}`);
  const tf = new Map<string, number>();
  for (const t of terms) tf.set(t, (tf.get(t) ?? 0) + 1);
  return { chunk, tf, length: terms.length };
}

/**
 * 색인을 만든다. 문서 빈도(df)와 평균 길이는 **검색 대상(승인 문서) 청크만으로** 센다.
 * 제외 문서가 통계에 섞이면 승인 문서의 순위가 제외 문서 때문에 바뀌기 때문이다.
 */
export function buildIndex(
  searchable: Chunk[],
  excluded: { doc: ExcludedDoc; chunks: Chunk[] }[] = [],
): SearchIndex {
  assertBm25Params();
  const docs = searchable.map(indexChunk);
  const df = new Map<string, number>();
  for (const d of docs) for (const t of d.tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  const avgLength = docs.length === 0 ? 0 : docs.reduce((s, d) => s + d.length, 0) / docs.length;
  return {
    docs,
    df,
    avgLength,
    excludedDocs: excluded.map((e) => ({ doc: e.doc, chunks: e.chunks.map(indexChunk) })),
  };
}

/** Lucene식 IDF. 모든 문단에 나오는 조각도 음수가 되지 않는다. */
function idf(index: SearchIndex, term: string): number {
  const n = index.docs.length;
  const df = index.df.get(term) ?? 0;
  return Math.log(1 + (n - df + 0.5) / (df + 0.5));
}

function score(index: SearchIndex, d: IndexedChunk, queryTerms: string[]): { score: number; matched: string[] } {
  let s = 0;
  const matched: string[] = [];
  const avg = index.avgLength || 1;
  for (const t of queryTerms) {
    const f = d.tf.get(t);
    if (!f) continue;
    matched.push(t);
    s += idf(index, t) * ((f * (BM25_K1 + 1)) / (f + BM25_K1 * (1 - BM25_B + (BM25_B * d.length) / avg)));
  }
  return { score: s, matched };
}

export interface SearchHit {
  rank: number;
  chunk: Chunk;
  score: number;
  /** 점수를 만든 조각들. 화면에서 "왜 걸렸나"를 보인다. */
  matchedTerms: string[];
}

export interface ExcludedReport {
  doc: ExcludedDoc;
  /** 이 질문에 걸린 청크가 있었는가. true면 "관련 있지만 제외됨"으로 보인다. */
  matched: boolean;
  bestScore: number;
  bestChunkId: string | null;
}

export interface SearchResult {
  query: string;
  hits: SearchHit[];
  excluded: ExcludedReport[];
}

/**
 * 상위 k개 문단을 돌려준다.
 * - 질의 조각은 중복을 없앤 뒤 더한다(같은 단어를 여러 번 쓴 질문이 점수를 부풀리지 않게).
 * - 점수 0(겹치는 조각 없음)은 결과에 넣지 않는다.
 * - 동점이면 색인 순서(볼트 파일 순서, 문단 순서)로 정한다 — 결과가 실행마다 같아야 평가가 재현된다.
 */
export function search(index: SearchIndex, query: string, k = 5, minScore = 0): SearchResult {
  const queryTerms = [...new Set(tokenize(query))];
  const scored = index.docs
    .map((d, i) => ({ d, i, ...score(index, d, queryTerms) }))
    .filter((x) => x.score > minScore && x.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, k);

  const hits: SearchHit[] = scored.map((x, r) => ({ rank: r + 1, chunk: x.d.chunk, score: x.score, matchedTerms: x.matched }));

  const excluded: ExcludedReport[] = index.excludedDocs.map(({ doc, chunks }) => {
    let best = 0;
    let bestId: string | null = null;
    for (const c of chunks) {
      const s = score(index, c, queryTerms).score;
      if (s > best) {
        best = s;
        bestId = c.chunk.chunkId;
      }
    }
    return { doc, matched: best > 0, bestScore: best, bestChunkId: bestId };
  });

  return { query, hits, excluded };
}
