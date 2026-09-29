/**
 * ④ 근거 검증(PRD F7). 모델이 돌려준 인용을 코드가 다시 대조한다.
 *
 * 모델의 인용 기능(citations)은 원문 위치를 돌려주지만, 그 위치가 우리가 보낸 문단과
 * 정말 맞는지, 인용 없는 문장이 섞이지 않았는지는 여기서 따로 본다. 하나라도 어긋나면 '보류'다.
 *
 * 입력 타입을 SDK 타입 대신 최소 구조로 둔 이유: 코어는 SDK 없이 테스트돼야 하고,
 * SDK의 BetaTextBlock은 이 구조에 그대로 들어맞는다(구조적 타입).
 *
 * 공백 정규화 규칙(인용 대조): NFC 후 **모든 공백 문자(\s, U+200B 포함)를 지우고** 완전 일치.
 *   - 블록 여러 개를 이어 붙일 때 API가 사이에 무엇을 넣는지에 흔들리지 않게 하려는 것이다.
 *   - 공백 말고는 한 글자도 다르면 불일치다(부분 문자열 허용 안 함).
 * 공백 정규화 규칙(인사·맺음 허용 목록 대조): NFKC, 연속 공백을 하나로, 앞뒤 공백 제거,
 *   끝의 문장부호(. ! ? ~ 。 …)와 공백 제거 후 완전 일치.
 * 글자 수를 셀 때(이음말 길이): NFKC 후 문자·숫자(\p{L}\p{N})만 센다. 공백·문장부호·자리표시자는 세지 않는다.
 * 초안 단위: 인용 문장이나 자리표시자 문장이 하나도 없으면(인사·맺음만) 보류한다(no-cited). 허용 목록 문장은 인용 없이
 *   나가므로, 그것만으로 된 초안이 통과하면 "양해 부탁드립니다" 같은 인사가 거절·수락 결론을 대신 전할 수 있다.
 *
 * 인용 대조가 보장하는 것과 못 하는 것:
 *   - 보장: cited_text가 우리가 보낸 원문에 글자 그대로 있다(인용 원문 불일치 0건).
 *   - 근사: 모델 문장이 그 원문과 같은 말인지는 2-gram 겹침 비율(MIN_CITED_OVERLAP)과 숫자 대조로만 본다.
 *     겹침이 낮으면 보류하지만, 겹치면서 뜻을 뒤집는 문장("~해도 됩니다" ↔ "~하면 안 됩니다")은 못 잡는다.
 *   - 못 함: 6자 이하 이음말의 "네, "·"아니요, "가 인용 문장과 맞는 답인지. 1회차 녹화에서 통과한 답(G02·G03)이
 *     이 모양이라 막지 않았다 — 인용 문장이 그 예/아니요를 뒷받침하는지는 보내는 사람이 본다.
 *     그래서 보내는 사람이 문장마다 원문을 확인한다(PRD 9절 환각).
 */

/** 텍스트 문서로 보낼 때 문단 사이에 넣는 구분자. 생성 쪽(llm)과 검증 쪽이 같은 값을 써야 한다. */
export const TEXT_DOC_SEPARATOR = "\n\n";

/** 근거가 없을 때 모델이 이 문장 하나만 쓰도록 지시한다. 이 문장이 오면 '문서 빈칸'으로 보류한다. */
export const NO_EVIDENCE_MARKER = "[근거 없음]";

/**
 * 근거가 있는 문장 안에서 인용 없는 이음말로 허용하는 최대 글자 수(문자·숫자만, 자리표시자 제외).
 * "네, ", "또한 " 정도만 들어가게 작게 둔다. 20자였을 때는 ", 음주·사우나도 바로 괜찮습니다" 같은 절 하나가 통째로 들어갔다.
 * 글자 수만으로는 6자 안에 든 사실(", 당일도 됩니다", ", 즉 목요일부터", " ⭕")을 못 막아서 TAIL_FACT_WORDS·기호 검사를 함께 한다.
 * 1회차 녹화(2026-09-29)에서 이 상한에 걸린 5건(9·9·13·13·19자)은 모두 이음말이 아니라 사실 조각이었다 —
 * 조건("휴진일과 진료시간 밖:"), 주어("다른 약과 함께 먹어도 되는지는"), 날짜 추론("목요일이 D+7이면 토요일은 D+9여서").
 * 9자로 올리면 조건·주어가 든 2건이, 19자면 날짜 추론까지 인용 없이 풀린다. 그래서 올리지 않고 프롬프트(llm/draft.ts 규칙 10)로
 * 문서 문장을 통째로 인용하게 했다.
 */
export const UNCITED_TAIL_MAX_CHARS = 6;

/**
 * 인용 블록의 모델 문장이 인용한 원문과 겹쳐야 하는 최소 비율(문장 2-gram 중 원문에도 있는 비율).
 * 원문과 상관없는 문장에 인용만 붙여 통과하는 것을 막는다. 값은 손으로 쓴 예시로 정했고, 실제 응답으로 다시 잰다.
 */
export const MIN_CITED_OVERLAP = 0.25;
/** 2-gram이 이보다 적은 짧은 문장은 겹침 비율을 재지 않는다(비율이 흔들린다). */
export const MIN_OVERLAP_GRAMS = 4;

export interface SentBlock {
  chunkId: string;
  text: string;
}

/**
 * 모델에 보낸 문서 하나. documents 배열의 순서가 곧 document_index다.
 * kind "content": 문단을 custom content 블록으로 보냄 → content_block_location 인용.
 * kind "text": 문단을 TEXT_DOC_SEPARATOR로 이어 plain text로 보냄 → char_location 인용.
 */
export interface SentDocument {
  docId: string;
  kind: "content" | "text";
  blocks: SentBlock[];
}

export interface CitationLike {
  type: string;
  cited_text?: string | null;
  document_index?: number;
  start_block_index?: number;
  end_block_index?: number;
  start_char_index?: number;
  end_char_index?: number;
}

export interface ModelTextBlock {
  type: "text";
  text: string;
  citations?: ReadonlyArray<CitationLike> | null;
}

export interface ToneConfig {
  greetings: string[];
  closings: string[];
}

export interface VerifiedCitation {
  docId: string;
  chunkIds: string[];
  citedText: string;
}

export type HoldCode =
  | "empty"
  | "no-evidence"
  | "invalid-citation"
  | "uncited-sentence"
  | "uncited-tail"
  | "unsupported-number"
  | "low-overlap"
  | "no-cited";

export interface HoldReason {
  code: HoldCode;
  sentenceIndex: number | null;
  detail: string;
}

export interface SentenceReport {
  index: number;
  text: string;
  start: number;
  end: number;
  /**
   * cited: 인용 있음. allowlisted: V13 인사·맺음. template: 인용은 없지만 자리표시자({{price:…}}, {{hours}})를
   * 담은 짧은 문장 — 값이 승인 문서 json에서 들어오므로 허용한다. uncited: 막힌 문장.
   */
  kind: "cited" | "allowlisted" | "template" | "uncited";
  citations: VerifiedCitation[];
  problems: HoldCode[];
}

export interface VerifyResult {
  status: "ok" | "hold";
  reasons: HoldReason[];
  sentences: SentenceReport[];
  /** 모델이 쓴 초안 전체(자리표시자 채우기 전). */
  text: string;
}

export type ToneResult = { ok: true; config: ToneConfig } | { ok: false; error: string };

export function parseToneConfig(json: unknown): ToneResult {
  if (typeof json !== "object" || json === null || Array.isArray(json)) return { ok: false, error: "V13 json이 객체가 아닙니다" };
  const o = json as Record<string, unknown>;
  for (const k of ["greetings", "closings"] as const) {
    const v = o[k];
    if (!Array.isArray(v) || !v.every((x) => typeof x === "string" && x.trim() !== "")) {
      return { ok: false, error: `V13 ${k}가 빈 값 없는 문자열 배열이 아닙니다` };
    }
  }
  return { ok: true, config: { greetings: o.greetings as string[], closings: o.closings as string[] } };
}

export function stripAllWhitespace(s: string): string {
  return s.normalize("NFC").replace(/[\s​-‍﻿]+/g, "");
}

export function normalizeSentence(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[\s.!?~。…]+$/u, "");
}

/** 문서를 plain text로 보낼 때의 원문과 문단별 위치. 생성·검증 양쪽이 이 함수 하나를 쓴다. */
export function plainTextLayout(doc: SentDocument): { text: string; spans: { chunkId: string; start: number; end: number }[] } {
  let text = "";
  const spans: { chunkId: string; start: number; end: number }[] = [];
  doc.blocks.forEach((b, i) => {
    if (i > 0) text += TEXT_DOC_SEPARATOR;
    spans.push({ chunkId: b.chunkId, start: text.length, end: text.length + b.text.length });
    text += b.text;
  });
  return { text, spans };
}

type CheckedCitation = { ok: true; value: VerifiedCitation } | { ok: false; detail: string };

function checkCitation(c: CitationLike, docs: SentDocument[], allowedDocIds: ReadonlySet<string>): CheckedCitation {
  const di = c.document_index;
  if (typeof di !== "number" || !Number.isInteger(di) || di < 0 || di >= docs.length) {
    return { ok: false, detail: `보내지 않은 문서 번호를 인용했습니다(${String(di)})` };
  }
  const doc = docs[di];
  // 보낸 문서라도 승인 목록에 없으면 거부한다. 검색 단계의 승인 필터가 빠져도 여기서 한 번 더 막는다.
  if (!allowedDocIds.has(doc.docId)) return { ok: false, detail: `승인 목록에 없는 문서를 인용했습니다(${doc.docId})` };
  const cited = typeof c.cited_text === "string" ? c.cited_text : "";

  let expected: string;
  let chunkIds: string[];
  if (c.type === "content_block_location") {
    if (doc.kind !== "content") return { ok: false, detail: `${doc.docId}: 인용 형식이 문서 형식과 다릅니다` };
    const s = c.start_block_index;
    const e = c.end_block_index;
    if (typeof s !== "number" || typeof e !== "number" || !Number.isInteger(s) || !Number.isInteger(e) || s < 0 || e <= s || e > doc.blocks.length) {
      return { ok: false, detail: `${doc.docId}: 블록 범위가 틀렸습니다(${String(s)}–${String(e)})` };
    }
    const blocks = doc.blocks.slice(s, e);
    expected = blocks.map((b) => b.text).join("");
    chunkIds = blocks.map((b) => b.chunkId);
  } else if (c.type === "char_location") {
    if (doc.kind !== "text") return { ok: false, detail: `${doc.docId}: 인용 형식이 문서 형식과 다릅니다` };
    const { text, spans } = plainTextLayout(doc);
    const s = c.start_char_index;
    const e = c.end_char_index;
    if (typeof s !== "number" || typeof e !== "number" || !Number.isInteger(s) || !Number.isInteger(e) || s < 0 || e <= s || e > text.length) {
      return { ok: false, detail: `${doc.docId}: 글자 범위가 틀렸습니다(${String(s)}–${String(e)})` };
    }
    expected = text.slice(s, e);
    chunkIds = spans.filter((sp) => s < sp.end && sp.start < e).map((sp) => sp.chunkId);
  } else {
    return { ok: false, detail: `알 수 없는 인용 형식입니다(${c.type})` };
  }

  const a = stripAllWhitespace(cited);
  if (a === "" || a !== stripAllWhitespace(expected)) {
    return { ok: false, detail: `${doc.docId}: 인용문이 원문과 다릅니다` };
  }
  return { ok: true, value: { docId: doc.docId, chunkIds, citedText: cited } };
}

/** 문장 경계: 줄바꿈, 그리고 공백·끝이 뒤따르는 . ! ? 。 */
function splitSentences(full: string): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  let start = 0;
  for (let i = 0; i < full.length; i++) {
    const ch = full[i];
    const isBreak = ch === "\n" || (/[.!?。]/.test(ch) && (i + 1 === full.length || /\s/.test(full[i + 1])));
    if (isBreak) {
      out.push({ start, end: ch === "\n" ? i : i + 1 });
      start = i + 1;
    }
  }
  if (start < full.length) out.push({ start, end: full.length });
  return out
    .map(({ start: s, end: e }) => {
      const seg = full.slice(s, e);
      const lead = seg.length - seg.trimStart().length;
      const trail = seg.length - seg.trimEnd().length;
      return { start: s + lead, end: e - trail };
    })
    .filter(({ start: s, end: e }) => e > s);
}

const PLACEHOLDER = /\{\{[^{}]*\}\}/g;
const PLACEHOLDER_TEST = /\{\{[^{}]*\}\}/;

/** 날수를 뜻하는 고유어. "이틀째"가 "D+3" 인용을 달고 숫자 대조를 피해 가지 않게 숫자로 바꿔 센다. */
const KOREAN_DAY_WORDS: [RegExp, string][] = [
  [/일주일/g, "7일"],
  [/하루/g, "1일"],
  [/이틀/g, "2일"],
  [/사흘/g, "3일"],
  [/나흘/g, "4일"],
  [/닷새/g, "5일"],
  [/엿새/g, "6일"],
  [/열흘/g, "10일"],
  [/보름/g, "15일"],
];
const NATIVE_COUNT: Record<string, string> = { 한: "1", 두: "2", 세: "3", 석: "3", 네: "4", 넉: "4", 다섯: "5", 여섯: "6", 일곱: "7", 여덟: "8", 아홉: "9", 열: "10" };
// 고유어 수는 뒤에 단위가 올 때만 수로 본다("세 번"은 3, "세척"·"열이"는 아니다).
const NATIVE_COUNT_RE = /(?<![가-힣])(한|두|세|석|네|넉|다섯|여섯|일곱|여덟|아홉|열)\s*(?=번|달|주|시간|개월|회|명|장|차례|살)/g;

/** 한글로 쓴 수를 숫자로 바꾼다. 인용 문장과 인용 원문 양쪽에 똑같이 쓴다. */
export function koreanNumeralsToDigits(s: string): string {
  let out = s;
  for (const [re, d] of KOREAN_DAY_WORDS) out = out.replace(re, d);
  return out.replace(NATIVE_COUNT_RE, (_m, w: string) => NATIVE_COUNT[w]);
}

/**
 * 한자 숫자(五日)와 한자어 수로 쓴 금액(삼만원, 오천 원)은 숫자로 바꾸지 않고 그대로 '수 토큰'으로 센다.
 * 인용 원문은 아라비아 숫자로 쓰므로, 모델이 이렇게 쓰면 원문에 없는 수로 걸린다 — 숫자 대조를 글자 바꾸기로 피해 가지 못하게.
 * 한자어 수 전체(일·이·삼…)를 수로 보지 않는 이유: '일'(하루·업무)·'이'(이것)·'사'가 보통 낱말에 너무 흔하다.
 * 금액은 십·백·천·만·억이 들고 '원'으로 끝날 때만 잡는다(병원·의원·사원은 걸리지 않는다).
 */
const HANJA_NUMERAL_RE = /[〇零一二三四五六七八九十百千萬万億兩]+/g;
// 앞 글자가 한글이면 수가 아니다("불만 원인"의 '만 원').
const SINO_PRICE_RE = /(?<![가-힣])(?:[일이삼사오육칠팔구]?[십백천만억])+\s*원/g;

export function numbersIn(s: string): string[] {
  const t = koreanNumeralsToDigits(s.replace(PLACEHOLDER, " ").normalize("NFKC"));
  const digits = (t.match(/\d[\d,]*/g) ?? []).map((n) => n.replace(/,/g, "")).filter((n) => n !== "");
  const words = [...(t.match(HANJA_NUMERAL_RE) ?? []), ...(t.match(SINO_PRICE_RE) ?? []).map((w) => w.replace(/\s+/g, ""))];
  return [...digits, ...words];
}

/**
 * 인용 밖 이음말(6자 이하)과 자리표시자 문장의 주어에 있으면 안 되는 말: 가능 여부, 날짜·요일, 값 비교.
 * 이런 말은 인용 블록 안에 있어야 한다 — 짧아도 결론이다(", 당일도 됩니다", " {{price:…}}의 반값입니다").
 * 1회차 녹화에서 통과한 인용 문장에 쓰인 이 말은 모두 인용 원문에도 있었다(원문 밖에서 쓴 것은 이미 보류된 Q34 날짜 추론뿐).
 * 녹화에는 블록 경계가 남지 않아, 원문에 있는 말을 모델이 이음말 쪽에 두었는지는 2회차 녹화에서 확인한다.
 */
const TAIL_FACT_WORDS = /가능|불가|안\s*돼|안\s*됩|됩니다|돼요|됨|어렵|당일|반값|무료|공짜|할인|확정|해당|요일|내일|모레|오늘|주말|평일|이번\s*주|다음\s*주/;
/** 기호로 쓴 결론(⭕ ❌ ✅ ○ ×)은 글자 수에 안 잡히므로 따로 막는다. */
const TAIL_SYMBOLS = /[\p{So}\p{Extended_Pictographic}○◯×✕✗✘]/u;

/** 문자·숫자만 남긴다(자리표시자 제외). 이음말 길이와 겹침 비율에 쓴다. */
function lettersOnly(s: string): string {
  return koreanNumeralsToDigits(s.replace(PLACEHOLDER, " ").normalize("NFKC").toLowerCase()).replace(/[^\p{L}\p{N}]/gu, "");
}

function bigrams(s: string): string[] {
  const c = [...lettersOnly(s)];
  const out: string[] = [];
  for (let i = 0; i + 1 < c.length; i++) out.push(c[i] + c[i + 1]);
  return out;
}

/** 문장 2-gram 중 원문 2-gram에도 있는 비율. 문장이 너무 짧으면 null(재지 않음). */
export function citedOverlap(claim: string, cited: string): number | null {
  const a = bigrams(claim);
  if (a.length < MIN_OVERLAP_GRAMS) return null;
  const b = new Set(bigrams(cited));
  return a.filter((g) => b.has(g)).length / a.length;
}

/**
 * 인용 없이 허용하는 자리표시자 문장의 틀: "(주어는) {{…}}(, 주어는 {{…}})(입니다)."
 * 주어는 숫자 없는 짧은 말(조사까지 13자 이하)만 — 숫자를 쓰면 틀 밖이다. 틀 밖의 말("부작용 걱정 없습니다", "당일 수술 가능합니다")이
 * 자리표시자를 방패 삼아 인용 없이 나가는 것을 막는다.
 */
const TEMPLATE_SUBJECT = "(?:[가-힣A-Za-z·()\\s]{1,20}?(?:은|는|이|가)\\s*)";
const TEMPLATE_FRAME = new RegExp(
  `^${TEMPLATE_SUBJECT}?§(?:\\s*(?:,|와|과|및|이고|이며)\\s*${TEMPLATE_SUBJECT}?§)*\\s*(?:입니다|이에요|예요)?\\s*[.。]?$`,
);
/** 자리표시자 앞 조각(주어 + 조사 + 이음말)의 최대 글자 수. 주어 10자 안팎을 허용한다. */
const TEMPLATE_PART_MAX_LETTERS = 13;

function fitsTemplateFrame(sentence: string): boolean {
  const t = sentence.normalize("NFKC").replace(PLACEHOLDER, "§").trim();
  if (!TEMPLATE_FRAME.test(t)) return false;
  // 자리표시자 앞의 조각(주어 + 조사 + 이음말) 하나하나가 짧아야 한다. 마지막 조각은 맺음("입니다.")이다.
  const parts = t.split("§");
  // 주어에 가능 여부·날짜("당일 예약 가능 시간은")나 한글로 쓴 수를 끼우면 값은 문서에서 와도 문장은 모델의 주장이 된다.
  return parts.every((part, i) => {
    if (TAIL_FACT_WORDS.test(part) || numbersIn(part).length > 0) return false;
    return i === parts.length - 1 || [...part.replace(/[^\p{L}]/gu, "")].length <= TEMPLATE_PART_MAX_LETTERS;
  });
}

/**
 * 모델 응답을 검증한다.
 * @param content 응답의 text 블록들(thinking·fallback 블록은 호출하는 쪽에서 뺀다).
 * @param docs 요청에 넣은 문서들(document_index 순서).
 * @param allowedDocIds 승인된 최신 문서 ID.
 * @param tone V13 인사·맺음 허용 목록.
 */
export function verifyCitations(
  content: ReadonlyArray<ModelTextBlock>,
  docs: SentDocument[],
  allowedDocIds: ReadonlySet<string>,
  tone: ToneConfig,
): VerifyResult {
  const reasons: HoldReason[] = [];

  // 블록을 이어 붙이며 각 블록의 위치와 인용 검증 결과를 기록한다.
  let full = "";
  const spans: { start: number; end: number; valid: VerifiedCitation[]; invalid: string[] }[] = [];
  for (const b of content) {
    const valid: VerifiedCitation[] = [];
    const invalid: string[] = [];
    for (const c of b.citations ?? []) {
      const r = checkCitation(c, docs, allowedDocIds);
      if (r.ok) valid.push(r.value);
      else invalid.push(r.detail);
    }
    spans.push({ start: full.length, end: full.length + b.text.length, valid, invalid });
    full += b.text;
  }

  if (stripAllWhitespace(full) === "") {
    return { status: "hold", reasons: [{ code: "empty", sentenceIndex: null, detail: "모델이 빈 답을 돌려줬습니다" }], sentences: [], text: full };
  }
  if (normalizeSentence(full) === normalizeSentence(NO_EVIDENCE_MARKER)) {
    return {
      status: "hold",
      reasons: [{ code: "no-evidence", sentenceIndex: null, detail: "승인된 문서에 근거가 없습니다(문서 빈칸)" }],
      sentences: [],
      text: full,
    };
  }

  const allow = new Set([...tone.greetings, ...tone.closings].map(normalizeSentence));
  const sentences: SentenceReport[] = [];

  splitSentences(full).forEach(({ start, end }, index) => {
    const text = full.slice(start, end);
    const problems: HoldCode[] = [];
    const overlapping = spans.filter((sp) => sp.start < end && start < sp.end && stripAllWhitespace(full.slice(Math.max(sp.start, start), Math.min(sp.end, end))) !== "");
    const citations = overlapping.flatMap((sp) => sp.valid);
    const invalid = overlapping.flatMap((sp) => sp.invalid);

    for (const d of invalid) {
      problems.push("invalid-citation");
      reasons.push({ code: "invalid-citation", sentenceIndex: index, detail: d });
    }

    let kind: SentenceReport["kind"];
    if (overlapping.some((sp) => sp.valid.length > 0)) {
      kind = "cited";
      // 인용 블록 밖의 이음말 길이. 자리표시자는 값이 문서에서 들어오므로 세지 않는다.
      const uncited = overlapping
        .filter((sp) => sp.valid.length === 0 && sp.invalid.length === 0)
        .map((sp) => full.slice(Math.max(sp.start, start), Math.min(sp.end, end)))
        .join("");
      const tailLen = [...lettersOnly(uncited)].length;
      const factWord = TAIL_FACT_WORDS.exec(uncited.replace(PLACEHOLDER, " ").normalize("NFKC"))?.[0] ?? null;
      const symbol = TAIL_SYMBOLS.exec(uncited)?.[0] ?? null;
      if (tailLen > UNCITED_TAIL_MAX_CHARS) {
        problems.push("uncited-tail");
        reasons.push({ code: "uncited-tail", sentenceIndex: index, detail: `인용 밖 이음말이 ${tailLen}자입니다(최대 ${UNCITED_TAIL_MAX_CHARS}자)` });
      } else if (factWord !== null || symbol !== null) {
        problems.push("uncited-tail");
        reasons.push({
          code: "uncited-tail",
          sentenceIndex: index,
          detail: `인용 밖 이음말에 결론을 뜻하는 ${factWord !== null ? `말("${factWord}")` : `기호("${symbol}")`}이 있습니다`,
        });
      }
      // 인용 블록마다 모델 문장이 인용 원문과 겹치는지 본다. 인용만 붙이고 딴말을 하는 문장을 막는다.
      for (const sp of overlapping.filter((x) => x.valid.length > 0)) {
        const claim = full.slice(Math.max(sp.start, start), Math.min(sp.end, end));
        const ratio = citedOverlap(claim, sp.valid.map((c) => c.citedText).join(" "));
        if (ratio !== null && ratio < MIN_CITED_OVERLAP) {
          problems.push("low-overlap");
          reasons.push({
            code: "low-overlap",
            sentenceIndex: index,
            detail: `인용한 원문과 겹치는 말이 적습니다(${Math.round(ratio * 100)}%, 최소 ${Math.round(MIN_CITED_OVERLAP * 100)}%): "${claim.trim()}"`,
          });
        }
      }
      // 문장 속 숫자는 모두 이 문장이 인용한 원문에 있어야 한다. 가격·날짜 환각을 막는다.
      const supported = new Set(citations.flatMap((c) => numbersIn(c.citedText)));
      const missing = [...new Set(numbersIn(text))].filter((n) => !supported.has(n));
      if (missing.length > 0) {
        problems.push("unsupported-number");
        reasons.push({ code: "unsupported-number", sentenceIndex: index, detail: `인용한 원문에 없는 숫자: ${missing.join(", ")}` });
      }
    } else if (invalid.length === 0 && allow.has(normalizeSentence(text))) {
      kind = "allowlisted";
    } else if (invalid.length === 0 && PLACEHOLDER_TEST.test(text) && fitsTemplateFrame(text)) {
      // 틀의 주어에는 숫자가 들어갈 수 없으므로 숫자 대조는 따로 하지 않는다(값은 자리표시자로만 들어온다).
      kind = "template";
    } else {
      kind = "uncited";
      if (invalid.length === 0) {
        problems.push("uncited-sentence");
        const why = PLACEHOLDER_TEST.test(text) ? " (자리표시자 문장이 허용 틀 '…는 {{…}}입니다'를 벗어났습니다)" : "";
        reasons.push({ code: "uncited-sentence", sentenceIndex: index, detail: `인용 없는 문장: "${text}"${why}` });
      }
    }
    sentences.push({ index, text, start, end, kind, citations, problems });
  });

  // 문장마다 통과해도 사실을 담은 문장(인용·자리표시자)이 하나도 없으면 막는다. 이 경우 모델은 사실상 근거를 찾지 못한 것이라,
  // '[근거 없음]' 대신 허용 인사로만 채운 답이 '문서 빈칸' 보류를 건너뛰고 나가지 않게 한다.
  if (reasons.length === 0 && !sentences.some((s) => s.kind === "cited" || s.kind === "template")) {
    reasons.push({ code: "no-cited", sentenceIndex: null, detail: "문서를 인용한 문장이 없습니다(인사·맺음 문장뿐)" });
  }

  return { status: reasons.length > 0 ? "hold" : "ok", reasons, sentences, text: full };
}
