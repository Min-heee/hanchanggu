/**
 * 화면이 그릴 값을 만드는 순수 함수(뷰 모델). 컴포넌트는 이 결과를 그리기만 한다.
 *
 * 왜 따로 두나: "환자에게 어떤 문구를 보이나", "어느 시각으로 시한을 재나", "제외된 문서를 보이나",
 * "AI가 이 글을 받았다고 말해도 되나" 같은 판단이 컴포넌트 안에 있으면 시험이 없어 조용히 바뀐다.
 * 여기 두고 vitest로 기대값을 고정한다(src/demo/view.test.ts). 판단 자체는 core·policy·inbox의 함수를 부른다.
 *
 * 화면 문구 원칙: 병원 사람이 읽는 말로 쓴다. 'BM25'·'2-gram'·문단 ID 같은 개발 용어는
 * '자세히(개발자용)' 펼치기에만 둔다(dev 필드).
 */

import { maskPii, type MaskResult } from "../core/mask";
import type { Knowledge } from "../core/knowledge";
import { RULE_DESCRIPTION, type RuleId } from "../core/redflag";
import { MIN_TOP_SCORE, retrieve, type Retrieval } from "../core/retrieve";
import type { RouteDecision, RouteStep } from "../core/route";
import { tokenize } from "../core/search";
import { formatWon, renderPrice, type Fill } from "../core/template";
import type { ExcludeReason } from "../core/vault";
import type { DraftResult } from "../llm/draft";
import { formatDuration, formatKst, kstDate, minutesBetween } from "./clock";
import type { HandoverInfo } from "./inbox";
import type { HandoverPolicy } from "./policy";
import type { Bundle } from "./bundle";
import type { GoldenRecord, InquiryRecord } from "./recording";

// ─── 머리 띠 ─────────────────────────────────────────────────────────────

/**
 * 머리 띠 문구. 미리 만든 AI 답이 없는데 "미리 생성한 AI 응답"이라고 적으면 사실이 아니다.
 * '녹화'는 병원 사람에게 동영상 녹화로 읽혀서 화면에는 '미리 만든 AI 답'이라고 쓴다.
 */
export function bandText(b: Pick<Bundle, "recording" | "recordingSource">): { main: string; ai: string; fake: boolean } {
  if (b.recordingSource === "fake-fixture") return { main: "가상 의원 · 합성 데이터", ai: "시험용 가짜 AI 답(모델 호출 없음)", fake: true };
  if (!b.recording) return { main: "가상 의원 · 합성 데이터", ai: "AI 초안: 아직 준비 전 · 안전 규칙과 문서 찾기는 지금 동작", fake: false };
  const model = b.recording.servedModels.join(", ") || b.recording.requestedModel;
  // 생성 시각은 UTC ISO로 저장된다. 날짜만 잘라 쓰면 KST 오전에 만든 답이 전날로 보인다.
  return { main: "가상 의원 · 합성 데이터 · 미리 만든 AI 답", ai: `${model} · ${kstDate(Date.parse(b.recording.generatedAt))} 생성`, fake: false };
}

/** ③ 생성 칸 머리의 출처 설명. */
export function draftSourceLabel(source: Bundle["recordingSource"], model: string | null, fallback: boolean): string {
  if (source === "fake-fixture") return "시험용 가짜 초안(모델 호출 없음) — 모양 확인용이라 내용 품질을 보여 주지 않습니다";
  return `미리 만든 AI 답 · ${model ?? "모델 정보 없음"}${fallback ? " (대체 모델이 답함)" : ""}`;
}

// ─── 개인정보 가림(F10) ─────────────────────────────────────────────────────

const MASK_KIND: Record<string, string> = { rrn: "주민번호", phone: "전화", email: "이메일", birth: "생년월일", address: "주소", name: "이름" };

export type MaskedCase =
  /** 미리 만든 AI 답을 만들 때 모델을 불렀다. 그때 보낸 글을 보인다. */
  | { kind: "recorded"; recordedText: string; live: MaskResult }
  /** 규칙이 먼저 경로를 정해 모델을 부르지 않았다. */
  | { kind: "not-sent"; why: "handover" | "public" | "shop" | "hold"; live: MaskResult }
  /** 이 화면에서는 모델을 부르지 않는다(직접 해 보기·자유 입력·AI 답 준비 전). */
  | { kind: "would-send"; live: MaskResult };

export interface MaskedView {
  summary: string;
  note: string;
  text: string;
  kinds: string[];
  count: number;
  /** 미리 만든 AI 답 때 보낸 글과 지금 가림 결과가 다르면 경고와 지금 값. */
  warn: string | null;
  compareText: string | null;
}

const NOT_SENT_WHY: Record<"handover" | "public" | "shop" | "hold", string> = {
  handover: "안전 규칙이 먼저 잡음",
  public: "공개 창구는 고정 문구만",
  shop: "쇼핑몰 문의는 연결 창구만 안내",
  hold: "보류",
};

export function maskedView(c: MaskedCase): MaskedView {
  const count = c.live.items.length;
  const kinds = [...new Set(c.live.items.map((i) => MASK_KIND[i.kind] ?? i.kind))];
  const tail = count > 0 ? ` (가린 곳 ${count})` : " (가린 곳 없음)";
  if (c.kind === "recorded") {
    const differs = c.recordedText !== c.live.masked;
    return {
      summary: `AI가 받은 글 보기${tail}`,
      note: "미리 만든 AI 답을 만들 때 모델에 보낸 글입니다. 원문은 이 화면에만 있습니다.",
      text: c.recordedText,
      kinds,
      count,
      warn: differs ? "그 뒤 문의 원문이나 개인정보 가림 규칙이 바뀌어, 지금 가리면 아래처럼 됩니다." : null,
      compareText: differs ? c.live.masked : null,
    };
  }
  if (c.kind === "not-sent") {
    return {
      summary: `AI에 보내지 않음 — ${NOT_SENT_WHY[c.why]}${tail}`,
      note: "이 문의는 AI에 보내지 않았습니다. 보낸다면 개인정보를 이렇게 가립니다.",
      text: c.live.masked,
      kinds,
      count,
      warn: null,
      compareText: null,
    };
  }
  return {
    summary: `AI에 보낸다면 받을 글${tail}`,
    note: "이 화면에서는 AI를 부르지 않습니다. 보낸다면 개인정보를 이렇게 가린 글만 보냅니다.",
    text: c.live.masked,
    kinds,
    count,
    warn: null,
    compareText: null,
  };
}

/** 문의 상세에서 어느 경우인지 정한다. 모델을 불렀는지는 녹화의 분류 기록으로 안다(record.ts는 분류를 불러야 초안도 부른다). */
export function maskedCaseForInquiry(step: RouteStep, record: InquiryRecord | null, live: MaskResult): MaskedCase {
  if (record && record.classification !== null) return { kind: "recorded", recordedText: record.route.maskedText, live };
  if (step === "handover") return { kind: "not-sent", why: "handover", live };
  if (step === "public-template") return { kind: "not-sent", why: "public", live };
  if (step === "shop-redirect" && record) return { kind: "not-sent", why: "shop", live };
  if (step === "hold" && record) return { kind: "not-sent", why: "hold", live };
  return { kind: "would-send", live };
}

/** 직접 해 보기: 규칙이 인계·공개 창구로 보내면 AI에 보내지 않는 경로, 아니면 '보낸다면'. 어느 쪽이든 이 화면은 AI를 부르지 않는다. */
export function maskedCaseForTry(step: RouteStep, live: MaskResult): MaskedCase {
  if (step === "handover") return { kind: "not-sent", why: "handover", live };
  if (step === "public-template") return { kind: "not-sent", why: "public", live };
  return { kind: "would-send", live };
}

export function maskedCaseForQuestion(rec: GoldenRecord | null, live: MaskResult): MaskedCase {
  return rec ? { kind: "recorded", recordedText: rec.maskedQuestion, live } : { kind: "would-send", live };
}

/**
 * 직원 화면의 '원문 보기'. 원문을 보이되 주민번호만은 직원 화면에서도 가린다 — 답장에 필요 없는 정보다.
 */
export function staffOriginal(text: string): string {
  const m = maskPii(text);
  let out = "";
  let at = 0;
  for (const it of [...m.items].sort((a, b) => a.start - b.start)) {
    if (it.kind !== "rrn") continue;
    out += text.slice(at, it.start) + "[주민번호]";
    at = it.end;
  }
  return out + text.slice(at);
}

// ─── ① 검색 ──────────────────────────────────────────────────────────────

export type Relevance = "높음" | "보통" | "낮음" | "경과일 구간";

/** 점수를 직원이 읽는 말로. 기준(MIN_TOP_SCORE)은 PRD F7 근거 약함 기준과 같은 값이다. */
export function relevanceLabel(score: number, postopBoost = false): Relevance {
  if (postopBoost && score < MIN_TOP_SCORE) return "경과일 구간";
  if (score >= MIN_TOP_SCORE * 2) return "높음";
  if (score >= MIN_TOP_SCORE) return "보통";
  return "낮음";
}

export interface Segment {
  text: string;
  hit: boolean;
}

const HANGUL = /[가-힣]/;

/**
 * 문단에서 질의와 겹친 말을 칠한다. 검색이 실제로 쓴 조각(core/search tokenize)을 그대로 쓴다 —
 * 두 글자 조각끼리 이어지면 한 덩어리로 칠해 '걸린 말'로 읽히게 한다. 거의 모든 문단에 나오는 조각
 * ("니다" 등)은 `isCommon`으로 빼서 문단이 온통 칠해지지 않게 한다.
 */
export function highlightSegments(text: string, query: string, isCommon: (term: string) => boolean = () => false): Segment[] {
  const terms = [...new Set(tokenize(query))].filter((t) => !isCommon(t));
  const grams = new Set(terms.filter((t) => t.startsWith("g:") && [...t.slice(2)].length === 2).map((t) => t.slice(2)));
  const words = terms.filter((t) => t.startsWith("w:") && !HANGUL.test(t)).map((t) => t.slice(2)).filter((w) => w.length >= 2);
  const lower = text.normalize("NFKC").length === text.length ? text.normalize("NFKC").toLowerCase() : text.toLowerCase();
  const mark = new Array<boolean>(text.length).fill(false);
  for (let i = 0; i + 1 < text.length; i++) {
    const g = lower.slice(i, i + 2);
    if (HANGUL.test(g[0]) && HANGUL.test(g[1]) && grams.has(g)) mark[i] = mark[i + 1] = true;
  }
  for (const w of words) {
    for (let at = lower.indexOf(w); at !== -1; at = lower.indexOf(w, at + 1)) for (let j = at; j < at + w.length; j++) mark[j] = true;
  }
  const out: Segment[] = [];
  for (let i = 0; i < text.length; i++) {
    const last = out[out.length - 1];
    if (last && last.hit === mark[i]) last.text += text[i];
    else out.push({ text: text[i], hit: mark[i] });
  }
  return out;
}

/** 칠한 문단에서 첫 칠한 곳 주변만 잘라 한 줄 요약으로. */
export function snippet(segs: Segment[], max = 90): Segment[] {
  const full = segs.map((s) => s.text).join("");
  if (full.length <= max) return segs;
  let pos = 0;
  let first = 0;
  for (const s of segs) {
    if (s.hit) {
      first = pos;
      break;
    }
    pos += s.text.length;
  }
  const start = Math.max(0, Math.min(first - 20, full.length - max));
  const end = start + max;
  const out: Segment[] = start > 0 ? [{ text: "…", hit: false }] : [];
  let at = 0;
  for (const s of segs) {
    const a = Math.max(at, start);
    const b = Math.min(at + s.text.length, end);
    if (a < b) out.push({ text: s.text.slice(a - at, b - at), hit: s.hit });
    at += s.text.length;
  }
  if (end < full.length) out.push({ text: "…", hit: false });
  return out;
}

/** 문서 속 `[[postop-care]]` 링크를 문서 제목으로. 병원 사람에게 파일 이름은 뜻이 없다. */
export function replaceWikiLinks(text: string, k: Pick<Knowledge, "vault">): string {
  const byFile = new Map(k.vault.all.map((d) => [d.path.replace(/^.*\//, "").replace(/\.md$/, ""), d.meta.title]));
  return text.replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (whole, file: string, alias?: string) => alias ?? `‘${byFile.get(file.trim()) ?? file.trim()}’`);
}

export const EXCLUDE_LABEL: Record<ExcludeReason, string> = {
  superseded: "옛 판",
  replaced: "새 판으로 바뀜",
  draft: "승인 전 초안",
  "not-yet-effective": "시행 전",
};

export interface RetrievalItem {
  chunkId: string;
  docId: string;
  title: string;
  heading: string | null;
  relevance: Relevance;
  postopBoost: boolean;
  snippet: Segment[];
  /** 개발자용: 점수. */
  score: number;
}

export interface ExcludedItem {
  docId: string;
  title: string;
  label: string;
  /** 개발자용. */
  version: string | null;
  supersededBy: string | null;
}

export interface RetrievalView {
  source: "live" | "recorded";
  items: RetrievalItem[];
  excluded: ExcludedItem[];
  weak: boolean;
  /** 질의 설명(문의면 날짜·칸 이름을 뺐다는 것). */
  queryNote: string | null;
  query: string;
  postopDay: number | null;
  /** 지금 문서에 없는 문단(녹화 뒤 바뀐 경우). */
  missing: string[];
}

function commonTerm(k: Knowledge): (t: string) => boolean {
  const n = k.index.docs.length || 1;
  return (t) => (k.index.df.get(t) ?? 0) / n > 0.25;
}

function excludedItem(k: Knowledge, docId: string, reason: ExcludeReason): ExcludedItem {
  const e = k.vault.excluded.find((x) => x.id === docId);
  return { docId, title: k.titles.get(docId) ?? docId, label: `제외됨 · ${EXCLUDE_LABEL[reason]}`, version: e?.version != null ? String(e.version) : null, supersededBy: e?.supersededBy ?? null };
}

function queryNote(mode: "reply" | "staff-qa", maskedText: string, query: string): string | null {
  if (mode !== "reply") return null;
  return query.replace(/\s+/g, "") !== maskedText.replace(/\s+/g, "") ? "날짜·시각·폼 칸 이름·가린 곳은 빼고 찾았습니다." : null;
}

/** 방금 브라우저에서 돌린 검색 결과를 그릴 값으로. 제외 문서는 '질의에 걸린 것'만 보인다. */
export function retrievalView(k: Knowledge, r: Retrieval, maskedText: string): RetrievalView {
  const common = commonTerm(k);
  return {
    source: "live",
    items: r.hits.map((h) => ({
      chunkId: h.chunk.chunkId,
      docId: h.chunk.docId,
      title: k.titles.get(h.chunk.docId) ?? h.chunk.docId,
      heading: h.chunk.heading,
      relevance: relevanceLabel(h.score, h.postopBoost),
      postopBoost: h.postopBoost,
      snippet: snippet(highlightSegments(replaceWikiLinks(h.chunk.text, k), r.query, common)),
      score: h.score,
    })),
    excluded: r.excluded.filter((e) => e.matched).map((e) => excludedItem(k, e.doc.id, e.doc.reason)),
    weak: r.weak,
    queryNote: queryNote(r.mode, maskedText, r.query),
    query: r.query,
    postopDay: r.postopDay,
    missing: [],
  };
}

/** 미리 만든 AI 답을 만들 때의 검색 결과(녹화)를 그릴 값으로. 문단 글은 지금 문서에서 찾는다. */
export function recordedRetrievalView(
  k: Knowledge,
  rec: { retrieval: { chunkId: string; score: number }[]; excludedMatches: { docId: string; reason: string }[] },
  mode: "reply" | "staff-qa",
  maskedText: string,
  postopDay: number | null,
): RetrievalView {
  // 질의는 녹화 때와 같은 함수로 다시 만든다(칠하기에만 쓴다). 순위·점수는 녹화 값 그대로.
  const again = retrieve(k.index, mode, maskedText, postopDay, 1);
  const common = commonTerm(k);
  const byId = new Map(k.chunks.map((c) => [c.chunkId, c]));
  const missing: string[] = [];
  const items: RetrievalItem[] = [];
  const top = rec.retrieval.reduce((m, h) => Math.max(m, h.score), 0);
  for (const h of rec.retrieval) {
    const c = byId.get(h.chunkId);
    if (!c) {
      missing.push(h.chunkId);
      continue;
    }
    items.push({
      chunkId: c.chunkId,
      docId: c.docId,
      title: k.titles.get(c.docId) ?? c.docId,
      heading: c.heading,
      relevance: relevanceLabel(h.score),
      postopBoost: false,
      snippet: snippet(highlightSegments(replaceWikiLinks(c.text, k), again.query, common)),
      score: h.score,
    });
  }
  return {
    source: "recorded",
    items,
    excluded: rec.excludedMatches.map((e) => excludedItem(k, e.docId, e.reason as ExcludeReason)),
    weak: top < MIN_TOP_SCORE,
    queryNote: queryNote(mode, maskedText, again.query),
    query: again.query,
    postopDay: mode === "reply" ? postopDay : null,
    missing,
  };
}

// ─── ③ 가격 칸(F9) ────────────────────────────────────────────────────────

const GENERIC_LABEL_WORDS = new Set(["단가", "1회", "정기"]);

function labelWords(label: string): string[] {
  return label.split(/[\s·]+/).filter((w) => [...w].length >= 2 && !GENERIC_LABEL_WORDS.has(w));
}

/** 가격표(V03)에서 그 값이 적힌 문단. 가격 칸을 누르면 이 문단을 칠한다. */
export function priceSourceChunk(k: Pick<Knowledge, "chunks" | "prices">, key: string | null): string | null {
  const item = key ? k.prices.find((p) => p.key === key) : undefined;
  if (!item || item.price === 0) return null;
  const won = `${formatWon(item.price)}원`;
  const cands = k.chunks.filter((c) => c.docId === "V03" && c.text.includes(won));
  const words = labelWords(item.label);
  return (cands.find((c) => words.some((w) => c.text.includes(w))) ?? cands[0])?.chunkId ?? null;
}

export interface PricePreview {
  placeholder: string;
  value: string;
  label: string;
  chunkId: string | null;
}

/**
 * AI 답이 준비되기 전에도 가격 칸이 어떻게 채워지는지 보인다(모델 없이). 검색 결과에 가격표(V03)가 있고,
 * 문의에 가격표 항목 이름의 말이 들어 있을 때만. 모델이 실제로 어느 칸을 쓸지는 알 수 없으므로 '미리보기'다.
 */
export function pricePreview(k: Pick<Knowledge, "chunks" | "prices">, maskedText: string, hitDocIds: string[]): PricePreview[] {
  if (!hitDocIds.includes("V03")) return [];
  const text = maskedText.normalize("NFKC");
  return k.prices.flatMap((p) => {
    const words = labelWords(p.label);
    const need = Math.min(2, words.length);
    if (need === 0 || words.filter((w) => text.includes(w)).length < need) return [];
    return [{ placeholder: `{{price:${p.key}}}`, value: renderPrice(p), label: p.label, chunkId: priceSourceChunk(k, p.key) }];
  });
}

/** 초안의 가격 칸이 어느 문단에서 왔나. */
export function fillSourceChunk(k: Pick<Knowledge, "chunks" | "prices">, f: Fill): string | null {
  return f.sourceDoc === "V03" ? priceSourceChunk(k, f.key) : null;
}

// ─── 분류(F4) ─────────────────────────────────────────────────────────────

export const PRIORITY_LABEL: Record<string, string> = { urgent: "긴급", high: "높음", normal: "보통", low: "낮음" };

export const CATEGORY_LABEL: Record<string, string> = {
  booking: "예약",
  price: "가격",
  consultation: "첫 상담",
  postop: "수술 후 관리",
  injection: "두피 주사",
  "scalp-care": "두피 관리",
  medication: "약",
  shop: "쇼핑몰",
  complaint: "불만",
  other: "기타",
};

export const HOLD_TEXT: Record<string, string> = {
  empty: "빈 답",
  "no-evidence": "근거 없음(문서 빈칸)",
  "no-sources": "찾은 문단 없음(문서 빈칸)",
  "weak-retrieval": "근거 약함 — 찾은 문단의 관련도가 낮음(문서 빈칸)",
  "invalid-citation": "인용이 원문과 다름",
  "uncited-sentence": "근거 없는 문장",
  "uncited-tail": "근거 밖 말이 김",
  "unsupported-number": "원문에 없는 숫자",
  "low-overlap": "근거와 겹치는 말이 적음",
  "no-cited": "인용한 문장 없음 — 인사·맺음뿐",
  refusal: "모델 거절",
  truncated: "응답 잘림",
  template: "가격·시간 칸 오류",
  "ad-banned": "금지 광고 표현",
  "api-error": "모델 호출 오류",
};

// ─── 인계 카드(F5·F6) ─────────────────────────────────────────────────────

export interface HandoverCardModel {
  urgent: boolean;
  urgencyLabel: string;
  rules: { id: string; text: string }[];
  /** 규칙이 아니라 AI 분류가 인계로 정한 경우. */
  byClassifier: boolean;
  words: string[];
  context: string[];
  medTerms: string[];
  roleNow: string | null;
  openNow: boolean | null;
  /** 시한이 이미 지났고, 그때 담당이 지금 담당과 다르면 둘 다 보인다. */
  roleAtDeadline: string | null;
  deadline: null | { rule: string; until: string; overdue: string | null; remaining: string | null };
  patientMessage: null | { text: string; source: string };
}

/**
 * 인계 카드에 그릴 값. 환자에게 보낼 문구는 **V12 승인 문구만**이다 — 읽지 못하면 null이고, 지어내지 않는다.
 * 시한은 넘겨받은 nowMs(시연 기준 시각)로만 잰다.
 */
export function handoverCardModel(
  decision: RouteDecision,
  info: HandoverInfo | null,
  policy: HandoverPolicy,
  nowMs: number,
  titles: ReadonlyMap<string, string>,
): HandoverCardModel {
  const ids: RuleId[] = [...decision.redflag.ruleIds, ...(decision.medication.decision === "handover" ? (["MED-01"] as const) : [])];
  let deadline: HandoverCardModel["deadline"] = null;
  if (info && info.deadlineMs !== null) {
    const over = minutesBetween(info.deadlineMs, nowMs);
    deadline = {
      rule:
        info.phase === "to-handover"
          ? `받은 뒤 ${policy.handoverMinutes?.value ?? "?"}분 안에 의료진에게 인계`
          : `인계한 뒤 ${policy.contactMinutes?.value ?? "?"}분 안에 의료진이 환자에게 연락`,
      until: `${formatKst(info.deadlineMs)}까지`,
      overdue: info.overdue ? `시한 ${formatDuration(over)} 지남` : null,
      remaining: info.overdue ? null : `${formatDuration(-over)} 남음`,
    };
  }
  const msg = policy.patientMessage;
  return {
    urgent: decision.redflag.urgency === "urgent",
    urgencyLabel: decision.redflag.urgency === "urgent" ? "긴급" : "인계",
    rules: ids.map((id) => ({ id, text: RULE_DESCRIPTION[id] })),
    byClassifier: ids.length === 0,
    words: [...decision.redflag.matchedSymptoms, ...decision.redflag.matchedAmbiguous],
    context: decision.redflag.matchedContext,
    medTerms: decision.medication.matchedTerms,
    roleNow: info?.role ?? null,
    openNow: info ? info.openNow : null,
    roleAtDeadline: info && info.overdue && info.roleAtDeadline !== info.role ? info.roleAtDeadline : null,
    deadline,
    patientMessage: msg ? { text: msg.value, source: `${(msg.chunkId && titles.get(msg.chunkId.split("#")[0])) || "인계 절차 문서"}의 고정 안내 문장` } : null,
  };
}

// ─── 확정 대기(F16) ──────────────────────────────────────────────────────

/**
 * 확정 대기 카드의 '안내할 때 근거 규정'. 종류마다 예약 규정(V04)에서 근거 문단을 고른다.
 * 질의 문장은 규정의 어느 부분을 찾을지 정하는 값이라 여기 한 곳에 두고 시험으로 결과를 고정한다.
 */
export const DEPOSIT_INTENTS = [
  { key: "confirm", label: "확정 안내", query: "예약금 입금 확인 확정 연락" },
  { key: "change", label: "일정 변경 안내", query: "예약 변경 기한 예약금 옮겨" },
  { key: "refund", label: "환불 안내", query: "취소 예약금 환불" },
] as const;
export type DepositIntent = (typeof DEPOSIT_INTENTS)[number]["key"];

export function depositBasis(k: Knowledge, intent: DepositIntent): { chunkId: string; heading: string | null; text: string }[] {
  const q = DEPOSIT_INTENTS.find((x) => x.key === intent)!.query;
  return retrieve(k.index, "staff-qa", q, null, 20)
    .hits.filter((h) => h.chunk.docId === "V04")
    .slice(0, 2)
    .map((h) => ({ chunkId: h.chunk.chunkId, heading: h.chunk.heading, text: replaceWikiLinks(h.chunk.text, k) }));
}

// ─── 문의 상세 배치 ──────────────────────────────────────────────────────

/** 경과일 편집을 펼쳐 둘지. 값을 읽었거나 직원이 고쳤거나 인계 건일 때만 — 가격·예약·리뷰 문의에서 핵심 카드를 밀어내지 않게. */
export function postopEditorOpen(step: RouteStep, read: number | null, overridden: boolean): boolean {
  return read !== null || overridden || step === "handover";
}

/** 결과 박스 제목 등에 쓰는 문단 이름: "가격표 › 모발이식". */
export function chunkLabel(titles: ReadonlyMap<string, string>, chunk: { docId: string; heading: string | null }): string {
  return `${titles.get(chunk.docId) ?? chunk.docId}${chunk.heading ? ` › ${chunk.heading}` : ""}`;
}

/** DraftResult에서 보낸 문서를 ② 발췌 모양으로(글 속 링크는 제목으로). */
export function recordedExcerpts(k: Knowledge, draft: DraftResult) {
  return draft.documents.map((d) => ({
    docId: d.docId,
    title: k.titles.get(d.docId) ?? d.docId,
    chunks: d.blocks.map((b) => ({ chunkId: b.chunkId, text: replaceWikiLinks(b.text, k) })),
  }));
}

/** 방금 찾은 발췌(analyze의 excerpts)를 ② 모양으로(글 속 링크는 제목으로). */
export function liveExcerpts(k: Knowledge, docs: { docId: string; title: string; chunks: { chunkId: string; text: string }[] }[]) {
  return docs.map((d) => ({ ...d, chunks: d.chunks.map((c) => ({ ...c, text: replaceWikiLinks(c.text, k) })) }));
}
