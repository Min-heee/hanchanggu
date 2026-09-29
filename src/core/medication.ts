/**
 * 약 문의 규칙(MED-01). 적신호는 아니지만 직원이 답하면 안 되는 문의를 LLM보다 먼저 잡는다(V17).
 *
 * 왜 규칙이 필요한가: "1mg짜리 반으로 잘라 먹어도 되나요?" 같은 문의는 증상어가 없어 적신호 게이트를
 * 통과한다. 여기서 인계를 LLM 분류에만 맡기면, 분류가 실패하거나 문의 속 지시문에 흔들릴 때 인계가 빠진다.
 *
 * 단어 목록은 코드에 적지 않고 V17 json에서 읽는다. "약"은 "예약"·"약속"에도 들어 있어서,
 * exclude에 있는 말을 먼저 지운 뒤 terms를 찾는다. 과잉 인계는 허용한다(애매하면 인계).
 */

import { normalizeForMatch } from "./redflag";

export interface MedicationConfig {
  terms: string[];
  exclude: string[];
  /**
   * 직원 질문(사내 Q&A)에서 약 문서를 발췌 앞에 세울 때는 세지 않는 말(core/retrieve.ts 규칙 3). 문의 게이트(인계)에는 쓰지 않는다.
   * "약도"(지도), "먹어도"(점심 먹어도), "부작용"(광고 문구)은 약 이야기가 아닐 때도 흔해서, 이 말만으로 앞세우면 발췌 5칸 중
   * 2칸이 약·인계 문서로 찬다(3차 적대 검증). 게이트는 애매하면 인계하는 쪽이 맞지만 발췌 칸은 한정돼 있어 기준을 달리 둔다.
   */
  qaPinIgnore?: string[];
}

export type MedicationConfigResult = { ok: true; config: MedicationConfig } | { ok: false; error: string };

export interface MedicationResult {
  decision: "handover" | "pass";
  matchedTerms: string[];
}

export function parseMedicationConfig(json: unknown): MedicationConfigResult {
  if (typeof json !== "object" || json === null || Array.isArray(json)) return { ok: false, error: "V17 json이 객체가 아닙니다" };
  const o = json as Record<string, unknown>;
  for (const k of ["terms", "exclude"] as const) {
    const v = o[k];
    if (!Array.isArray(v) || !v.every((x) => typeof x === "string" && x.trim() !== "")) {
      return { ok: false, error: `V17 ${k}가 빈 값 없는 문자열 배열이 아닙니다` };
    }
  }
  if ((o.terms as string[]).length === 0) return { ok: false, error: "V17 terms가 비어 있습니다" };
  const ignore = o.qaPinIgnore;
  if (ignore !== undefined && (!Array.isArray(ignore) || !ignore.every((x) => typeof x === "string" && x.trim() !== ""))) {
    return { ok: false, error: "V17 qaPinIgnore가 빈 값 없는 문자열 배열이 아닙니다" };
  }
  return { ok: true, config: { terms: o.terms as string[], exclude: o.exclude as string[], ...(ignore !== undefined ? { qaPinIgnore: ignore as string[] } : {}) } };
}

export function checkMedication(text: string, config: MedicationConfig): MedicationResult {
  let norm = normalizeForMatch(text);
  // 긴 말부터 지운다("예약금"보다 먼저 "예약"을 지워도 결과가 같게, 겹치는 제외어가 서로를 망가뜨리지 않게).
  for (const x of [...config.exclude].sort((a, b) => b.length - a.length)) {
    const n = normalizeForMatch(x);
    // 공백 하나로 바꾼다. 그냥 지우면 앞뒤 글자가 붙어 없던 말이 생길 수 있다.
    if (n !== "") norm = norm.split(n).join(" ");
  }
  const matchedTerms: string[] = [];
  for (const t of config.terms) {
    const n = normalizeForMatch(t);
    if (n !== "" && norm.includes(n) && !matchedTerms.includes(t)) matchedTerms.push(t);
  }
  return { decision: matchedTerms.length > 0 ? "handover" : "pass", matchedTerms };
}
