/**
 * 사내 Q&A(PRD F14)의 판단: 어떤 질문을 '문서 빈칸'에 자동으로 쌓을지, 링크(?q=G16)가 어떤 질문을 가리키는지,
 * 적신호·약 규칙 카드를 띄울지.
 * 컴포넌트에 두면 시험할 수 없어서 순수 함수로 뺐다(src/demo/view.test.ts).
 */

import type { Knowledge } from "../core/knowledge";
import { RULE_DESCRIPTION, type RuleId } from "../core/redflag";
import { staffRuleHits, type Retrieval } from "../core/retrieve";
import type { HandoverPolicy } from "./policy";
import type { MaskResult } from "../core/mask";
import type { GapEntry } from "./state";
import type { GoldenRecord } from "./recording";
import { patientMessageOf, replaceWikiLinks } from "./view";

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

// ─── 규칙 카드(사내 Q&A) ─────────────────────────────────────────────────

/**
 * 직원 질문의 규칙 카드. 3회차 녹화 G46("수술 2주째 … 고름 … 연고 바르라고 해도 돼요?")의 AI 답에 '5분 안에 의료진에게 인계'가
 * 빠졌다 — 검색이 그 문단(V12 시한 문단)을 발췌 맨 앞에 세웠는데도 모델이 쓰지 않았다. 지시문을 고쳐도 다음 녹화에서만 확인되고
 * 또 빠질 수 있다. 그래서 "규칙이 AI보다 먼저" 원칙대로, 질문이 적신호·약 규칙에 걸리면 AI 답과 상관없이 인계 절차 원문을 카드로 보인다.
 *
 * 문의 게이트는 적신호·약 문의를 인계로 정하고 AI 초안을 의료진 확인용으로 돌린다(직원 발송 불가, PRD v0.3). 직원 질문은 절차를 묻는 것이라
 * 인계할 환자·창구가 없고, 근거를 단 절차 안내도 쓸모가 있어 AI 답을 그대로 보인다 — 카드는 그 위에서 "직원은 인계하고 승인 문구만 보낸다"를 지킨다.
 * 판정은 발췌 앞세우기와 같은 함수(core/retrieve staffRuleHits)라, 발췌 맨 앞에 선 인계 절차 문단은 늘 카드에도 인용된다.
 * 시한(분)은 인계 절차 문서(V12)에서 읽은 값만 쓴다. 그 문장은 "적신호 문의는 … N분 안에"라서 약 문의뿐일 때는 분을 적지 않는다.
 * 분을 적으면 그 분을 읽은 문단도 반드시 인용한다 — 인계 문단 고르기('적신호'라는 말로 고름)와 분 읽기("N분 안에 인계" 문장)는
 * 따로 정해져서, V12 문구가 바뀌면 "5분"만 뜨고 근거 문단은 딴 문단("5분 안에 답이 없으면" 같은 다른 뜻)일 수 있다(적대 검증).
 * 알려진 한계: 부정문("고름 얘기 말고요"), 수술 뒤 일반 질문("수술 후 붓기 며칠 가요?"), 광고 문구를 묻는 질문("통증 없는 수술이라고
 * 광고해도 돼요?")에도 적신호 카드가 뜬다 — V11은 부정·쓰임새를 가리지 않고 애매하면 인계하는 쪽이다. "처방전 재발급은 어디서 해요?"에도
 * 약 카드가 뜨는데, V17은 처방전 재발급 접수를 직원이 해도 되는 일로 적는다(약 말 '처방'이 걸린다).
 * AI 답은 그대로 보이므로 카드가 잘못 떠도 답을 잃지 않는다.
 */
export interface StaffRuleCardModel {
  urgent: boolean;
  urgencyLabel: string;
  /** "이 질문은 환자 증상 얘기를 담고 있습니다 — …" 한 줄. */
  headline: string;
  rules: { id: RuleId; text: string }[];
  words: string[];
  context: string[];
  medTerms: string[];
  /** 인계 시한(분). 적신호에 걸렸고 V12에서 읽었을 때만. */
  minutes: number | null;
  deadlineText: string;
  /** 인계 절차 문서 제목(V12). */
  docTitle: string;
  /** 인계 절차 문서의 해당 문단 원문(문서 순서, 볼트 링크만 제목으로 바꿈). 읽지 못하면 빈 배열. */
  quotes: { chunkId: string; heading: string | null; text: string }[];
  patientMessage: { text: string; source: string } | null;
}

/** @param question 가린 뒤의 직원 질문(발췌 앞세우기와 같은 글로 판정해야 카드와 발췌가 어긋나지 않는다). 규칙에 안 걸리면 null. */
export function staffRuleCard(k: Knowledge, policy: HandoverPolicy, question: string): StaffRuleCardModel | null {
  const rules = k.index.rules?.staffPins;
  if (!rules) return null;
  const h = staffRuleHits(k.index, rules, question);
  if (!h.hit) return null;
  const red = h.redflag.decision === "handover";
  const ids: RuleId[] = [...h.redflag.ruleIds, ...(h.medTerms.length > 0 ? (["MED-01"] as const) : [])];
  const minutes = red ? (policy.handoverMinutes?.value ?? null) : null;
  const topic = red && h.medTerms.length > 0 ? "환자 증상·약" : red ? "환자 증상" : "약";
  const when = minutes !== null ? `${minutes}분 안에 ` : "";
  // 누구에게(담당 문단) + 언제(규칙이 고른 인계 문단) + 분을 읽은 문단(분을 적을 때만). 모두 V12 원문이고, 같은 문단이면 한 번만.
  const picked = [h.handoverChunk?.chunkId, policy.roleOpen?.chunkId, minutes !== null ? policy.handoverMinutes?.chunkId : null].filter(
    (id): id is string => typeof id === "string",
  );
  const quotes = k.chunks
    .filter((c) => picked.includes(c.chunkId))
    .sort((a, b) => a.index - b.index)
    .map((c) => ({ chunkId: c.chunkId, heading: c.heading, text: replaceWikiLinks(c.text, k) }));
  return {
    urgent: h.redflag.urgency === "urgent",
    urgencyLabel: h.redflag.urgency === "urgent" ? "긴급" : "인계",
    headline: `이 질문은 ${topic} 얘기를 담고 있습니다 — 인계 절차대로 ${when}의료진에게 넘기세요. 직원은 증상·약에 답하지 않습니다.`,
    rules: ids.map((id) => ({ id, text: RULE_DESCRIPTION[id] })),
    // 적신호 규칙에 안 걸렸으면 증상 말도 문맥도 판정에 쓰이지 않았다 — 약만 걸린 카드에 '걸린 말: "피나"'처럼 쓰지 않은 말을 보이지 않는다.
    words: red ? [...h.redflag.matchedSymptoms, ...h.redflag.matchedAmbiguous] : [],
    context: red ? h.redflag.matchedContext : [],
    medTerms: h.medTerms,
    minutes,
    deadlineText: !red
      ? "인계 절차 문서의 분 단위 시한은 적신호 문의 기준이라 약 문의에는 적지 않습니다"
      : minutes !== null
        ? `확인한 순간부터 ${minutes}분 안에 의료진에게 인계`
        : "인계 절차 문서에서 시한을 읽지 못함 — 문서를 확인하세요",
    docTitle: k.titles.get(rules.handoverDocId) ?? "인계 절차 문서",
    quotes,
    patientMessage: patientMessageOf(policy, k.titles),
  };
}
