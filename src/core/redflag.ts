/**
 * 적신호 게이트(PRD F5). LLM보다 **먼저** 돈다.
 *
 * 왜 규칙이 먼저인가: 같은 모델이 만든 시험 문항으로 LLM 분류기를 재면 "누락 0건"이 나와도 의미가 없다.
 * 증상어 목록은 코드에 적지 않고 볼트의 '적신호 증상' 문서(V11) json에서 읽는다.
 * 목록을 고치는 사람은 개발자가 아니라 간호팀이어야 하기 때문이다.
 *
 * 판정표(fail-closed — 애매하면 인계):
 *
 * | 규칙  | 증상어 | 모호어 | 수술 후 문맥 | 결과 |
 * |-------|--------|--------|--------------|------|
 * | RF-01 | 있음   | -      | 있음         | 인계(긴급) |
 * | RF-02 | 있음   | -      | 없음         | 인계 — 문맥을 안 적었을 뿐 수술 환자일 수 있다 |
 * | RF-03 | 없음   | 있음   | 있음         | 인계 — 정상 경과인지 판단은 의료진 몫 |
 * | -     | 없음   | 있음   | 없음         | 통과(표시만) — "이식하면 붓기 얼마나 가요?" 같은 일반 질문 |
 * | -     | 없음   | 없음   | -            | 통과 |
 *
 * 부정문("열은 없어요")도 인계한다. 부정 판별을 규칙으로 넣으면 "열이 없진 않아요" 같은 문장을 놓친다.
 * 과잉 인계는 허용하고 비율을 따로 적는다(PRD 7절).
 *
 * 단어 목록만으로는 못 잡는 두 가지는 V11 json의 다른 값으로 잡는다(역시 코드에 적지 않는다).
 * - postopContextPatterns: "3주차", "5일 지났는데", "열흘째"처럼 숫자·날수가 들어간 문맥 표현(정규식).
 *   "주차"만 목록에 넣으면 주차장과 겹치므로 숫자를 앞에 요구하는 정규식으로 둔다.
 * - feverThresholdCelsius: "38.5도", "체온이 40도"처럼 숫자로 적힌 체온. 목록에 "38도"만 두면 38.5도를 놓친다.
 */

export interface RedflagConfig {
  symptoms: string[];
  postopContext: string[];
  /** 수술 후 문맥으로 볼 정규식(문자열). NFKC만 한 원문(공백 유지)에 대고 찾는다. */
  postopContextPatterns: string[];
  /** 이 온도(섭씨) 이상이 숫자로 적혀 있으면 증상어로 본다. */
  feverThresholdCelsius: number;
  ambiguous: string[];
}

export type RedflagRuleId = "RF-01" | "RF-02" | "RF-03";

export interface RedflagResult {
  decision: "handover" | "pass";
  /** 인계 카드의 색. RF-01만 긴급. */
  urgency: "urgent" | "normal" | null;
  ruleIds: RedflagRuleId[];
  matchedSymptoms: string[];
  matchedAmbiguous: string[];
  matchedContext: string[];
  /** 통과지만 직원에게 보일 메모(모호어만 있고 문맥 없음). */
  notes: string[];
}

export type ConfigResult = { ok: true; config: RedflagConfig } | { ok: false; error: string };

function stringList(v: unknown, name: string): string[] | string {
  if (!Array.isArray(v)) return `${name}이(가) 배열이 아닙니다`;
  if (!v.every((x) => typeof x === "string" && x.trim() !== "")) return `${name}에 빈 값이나 문자열이 아닌 값이 있습니다`;
  return v as string[];
}

/**
 * V11 json을 검증한다. 증상어나 문맥어가 비어 있으면 거부한다:
 * 목록이 비면 게이트가 아무것도 잡지 않는데, 그게 "적신호 없음"처럼 보이기 때문이다.
 */
export function parseRedflagConfig(json: unknown): ConfigResult {
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    return { ok: false, error: "V11 json이 객체가 아닙니다" };
  }
  const o = json as Record<string, unknown>;
  const symptoms = stringList(o.symptoms, "symptoms");
  const postopContext = stringList(o.postopContext, "postopContext");
  const ambiguous = stringList(o.ambiguous, "ambiguous");
  const patterns = stringList(o.postopContextPatterns, "postopContextPatterns");
  for (const r of [symptoms, postopContext, ambiguous, patterns]) if (typeof r === "string") return { ok: false, error: r };
  if ((symptoms as string[]).length === 0) return { ok: false, error: "symptoms가 비어 있습니다" };
  if ((postopContext as string[]).length === 0) return { ok: false, error: "postopContext가 비어 있습니다" };
  for (const p of patterns as string[]) {
    try {
      new RegExp(p, "u");
    } catch {
      return { ok: false, error: `postopContextPatterns의 정규식을 읽을 수 없습니다: ${p}` };
    }
  }
  // 체온 기준은 기본값을 두지 않는다. 빠지거나 말이 안 되는 값이면(오타로 83 등) 게이트 전체를 거부한다.
  const t = o.feverThresholdCelsius;
  if (typeof t !== "number" || !Number.isFinite(t) || t < 37 || t > 40) {
    return { ok: false, error: "feverThresholdCelsius는 37~40 사이의 숫자여야 합니다" };
  }
  return {
    ok: true,
    config: {
      symptoms: symptoms as string[],
      postopContext: postopContext as string[],
      postopContextPatterns: patterns as string[],
      feverThresholdCelsius: t,
      ambiguous: ambiguous as string[],
    },
  };
}

/** 비교용 정규화: NFKC + 소문자 + 공백 전부 제거. "숨 차요"와 "숨차요", "D + 3"과 "D+3"을 같게 본다. */
export function normalizeForMatch(s: string): string {
  return s.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
}

function findTerms(textNorm: string, terms: string[]): string[] {
  const hits: string[] = [];
  for (const t of terms) {
    const n = normalizeForMatch(t);
    if (n !== "" && textNorm.includes(n) && !hits.includes(t)) hits.push(t);
  }
  return hits;
}

// 체온 숫자. 앞에 다른 숫자가 붙어 있으면("180도 돌려") 체온이 아니다. 45도를 넘으면 체온으로 보지 않는다.
const TEMPERATURE = /(?<![\d.])(\d{2}(?:[.,]\d{1,2})?)\s*(?:도|℃|°\s*c?)/giu;
const MAX_BODY_TEMP = 45;

function findFever(text: string, threshold: number): string[] {
  const hits: string[] = [];
  for (const m of text.normalize("NFKC").matchAll(TEMPERATURE)) {
    const v = Number(m[1].replace(",", "."));
    if (v >= threshold && v <= MAX_BODY_TEMP && !hits.includes(m[0])) hits.push(m[0]);
  }
  return hits;
}

function findPatterns(text: string, patterns: string[]): string[] {
  const t = text.normalize("NFKC");
  const hits: string[] = [];
  for (const p of patterns) {
    for (const m of t.matchAll(new RegExp(p, "gu"))) if (m[0] !== "" && !hits.includes(m[0])) hits.push(m[0]);
  }
  return hits;
}

/**
 * 규칙 게이트. 입력은 가림(mask) 뒤의 텍스트여도 되고 원문이어도 된다
 * (가림 표시 "[이름]" 등은 증상어와 겹치지 않는다).
 */
export function checkRedflags(text: string, config: RedflagConfig): RedflagResult {
  const norm = normalizeForMatch(text);
  const matchedSymptoms = [...findTerms(norm, config.symptoms)];
  for (const f of findFever(text, config.feverThresholdCelsius)) if (!matchedSymptoms.includes(f)) matchedSymptoms.push(f);
  const matchedAmbiguous = findTerms(norm, config.ambiguous);
  const matchedContext = [...findTerms(norm, config.postopContext), ...findPatterns(text, config.postopContextPatterns)];
  const hasCtx = matchedContext.length > 0;

  const ruleIds: RedflagRuleId[] = [];
  if (matchedSymptoms.length > 0) ruleIds.push(hasCtx ? "RF-01" : "RF-02");
  if (matchedAmbiguous.length > 0 && hasCtx) ruleIds.push("RF-03");

  const notes: string[] = [];
  if (ruleIds.length === 0 && matchedAmbiguous.length > 0) {
    notes.push("모호어가 있으나 수술 후 문맥이 없어 통과했습니다. 직원이 한 번 더 확인하세요.");
  }

  return {
    decision: ruleIds.length > 0 ? "handover" : "pass",
    urgency: ruleIds.includes("RF-01") ? "urgent" : ruleIds.length > 0 ? "normal" : null,
    ruleIds,
    matchedSymptoms,
    matchedAmbiguous,
    matchedContext,
    notes,
  };
}

/**
 * 환자가 스스로 적은 수술 후 일수("D+9", "9일째", "수술한 지 9일")를 읽는다.
 * 인계 카드에 보이기 위한 것이고 판정에는 쓰지 않는다. 한창구는 이 값을 해석하지 않는다(PRD 3절 B).
 */
export function extractSelfReportedDays(text: string): { days: number; text: string }[] {
  const t = text.normalize("NFKC");
  const patterns = [/[dD]\s*\+\s*(\d{1,3})/g, /수술(?:한|을\s*한|받은)?\s*(?:지|후|뒤)?\s*(\d{1,3})\s*일/g, /(\d{1,3})\s*일\s*(?:째|차)/g];
  const found: { days: number; text: string; start: number; end: number }[] = [];
  for (const re of patterns) {
    for (const m of t.matchAll(re)) {
      found.push({ days: Number(m[1]), text: m[0], start: m.index!, end: m.index! + m[0].length });
    }
  }
  // "수술 9일째"는 두 패턴에 모두 걸린다. 먼저 시작한(같으면 긴) 쪽 하나만 남긴다.
  found.sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: typeof found = [];
  for (const f of found) if (!kept.some((k) => f.start < k.end && k.start < f.end)) kept.push(f);
  return kept.map(({ days, text }) => ({ days, text }));
}

/** LLM 분류의 인계 의견. null이면 모델 호출이 실패했거나 아직 안 한 것이다. */
export interface LlmRouteOpinion {
  handover: boolean;
  reason?: string;
}

/** 규칙 게이트의 ID. MED-01은 적신호가 아닌 약 문의 규칙(V17, core/medication.ts)이다. */
export type RuleId = RedflagRuleId | "MED-01";

/** mergeRoute가 보는 규칙 판정. 적신호 게이트와 약 문의 규칙을 합친 결과도 이 모양이다. */
export interface RuleVerdict {
  decision: "handover" | "pass";
  ruleIds: RuleId[];
}

export interface MergedRoute {
  decision: "handover" | "pass";
  source: "rule" | "llm" | "rule+llm" | "none";
  ruleIds: RuleId[];
  llmReason?: string;
  /** LLM 의견이 없었는지. 화면에 "분류 전"으로 표시한다(기본값을 채우지 않는다, PRD F4). */
  llmMissing: boolean;
}

/**
 * 규칙과 LLM 의견을 합친다. 비대칭이 핵심이다.
 * - 규칙이 인계면 LLM이 "괜찮다"고 해도 인계다(LLM은 규칙이 건 인계를 풀 수 없다).
 * - 규칙이 통과여도 LLM이 인계라면 인계다(LLM은 인계 쪽으로만 바꿀 수 있다).
 * - LLM 의견이 없으면 규칙 판정을 그대로 쓴다. 모델 장애가 인계를 없애지 않는다.
 *   (분류가 실패한 문의에 초안을 만들지 않는 건 route.ts의 몫이다 — 실패하면 보류.)
 */
export function mergeRoute(rule: RuleVerdict, llm: LlmRouteOpinion | null): MergedRoute {
  const llmMissing = llm === null;
  const ruleHandover = rule.decision === "handover";
  const llmHandover = llm?.handover === true;
  const base = { ruleIds: rule.ruleIds, llmMissing, ...(llm?.reason ? { llmReason: llm.reason } : {}) };
  if (ruleHandover && llmHandover) return { decision: "handover", source: "rule+llm", ...base };
  if (ruleHandover) return { decision: "handover", source: "rule", ...base };
  if (llmHandover) return { decision: "handover", source: "llm", ...base };
  return { decision: "pass", source: "none", ...base };
}
