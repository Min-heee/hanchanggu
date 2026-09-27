/**
 * 사내 Q&A(PRD F14)의 판단: 어떤 질문을 '문서 빈칸'에 자동으로 쌓을지, 링크(?q=G16)가 어떤 질문을 가리키는지.
 * 컴포넌트에 두면 시험할 수 없어서 순수 함수로 뺐다(src/demo/view.test.ts).
 */

import type { Retrieval } from "../core/retrieve";
import type { MaskResult } from "../core/mask";
import type { GapEntry } from "./state";
import type { GoldenRecord } from "./recording";

export type GapDecision = { add: false } | { add: true; reason: string };

/**
 * 자동으로 문서 빈칸에 쌓는 조건. 근거가 없다는 것이 확실할 때만 쌓는다(엉뚱한 질문이 주간 보고에 섞이지 않게).
 * 1. 검색 근거가 약함(core/retrieve MIN_TOP_SCORE 미만) — AI 답 없이도 판정된다.
 * 2. 미리 만든 AI 답이 '근거 없음'이거나 모델 전에 근거 약함으로 보류됐다.
 */
export function gapDecision(retrieval: Pick<Retrieval, "weak" | "hits">, rec: GoldenRecord | null): GapDecision {
  if (retrieval.hits.length === 0 || retrieval.weak) return { add: true, reason: "근거 약함 — 찾은 문단의 관련도가 낮음" };
  const codes = rec?.draft.holdReasons.map((h) => h.code) ?? [];
  if (codes.includes("no-evidence")) return { add: true, reason: "AI가 '근거 없음'으로 답함(미리 만든 답)" };
  if (codes.includes("no-sources") || codes.includes("weak-retrieval")) return { add: true, reason: "근거 약함 — 찾은 문단의 관련도가 낮음" };
  return { add: false };
}

/** 문서 빈칸 한 줄. 질문은 가린 글로만 남긴다(주간 보고로 넘기는 목록이다). */
export function gapEntry(mask: MaskResult, at: string, reason: string): GapEntry {
  return { question: mask.masked, masked: mask.items.length, at, reason };
}

/** `?q=G16` 링크를 준비된 질문으로. 모르는 값이면 null(자유 입력으로 보지 않는다 — 링크로 모르는 문장을 넣지 않게). */
export function preparedFromParam<T extends { id: string; kind: string; question?: string }>(golden: T[], param: string | null): T | null {
  if (!param) return null;
  const g = golden.find((x) => x.id === param.trim().toUpperCase());
  return g && g.kind === "staff-qa" && g.question ? g : null;
}
