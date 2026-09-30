/**
 * 파이프라인 결정(PRD 5절)을 순수 함수 하나로 둔다.
 *
 *   문의 → 가림 → 규칙 게이트(적신호 V11 + 약 문의 V17) ─┬─ 인계 카드
 *                                                        ├─ (모르는 창구) → 보류
 *                                                        ├─ 쇼핑몰 창구 → 연결 안내
 *                                                        ├─ 공개 창구 → 고정 문구
 *                                                        ├─ (분류 전) → 분류 단계로
 *                                                        ├─ (분류 실패) → 보류
 *                                                        ├─ (분류: 인계·약) → 인계 카드
 *                                                        ├─ (분류: 쇼핑몰) → 연결 안내
 *                                                        └─ 초안 경로(검색·생성·검증)
 *
 * 순서가 곧 안전장치다. 공개 리뷰에 증상이 적혀 있어도 먼저 인계로 빠지고(답글은 여전히 고정 문구만),
 * 쇼핑몰 문의로 분류돼도 증상이 있으면 인계가 이긴다.
 *
 * 분류가 실패하면 초안을 만들지 않는다(fail-closed). 약 용량처럼 규칙이 못 잡고 분류만 잡는 문의가 있을 수
 * 있는데, 분류가 429·거절·잘림으로 비었을 때 초안 경로로 흘러가면 인계 카드 없이 답장 초안이 생긴다.
 *
 * 쇼핑몰 창구를 공개 창구보다 먼저 보는 이유: 쇼핑몰 게시판도 답장 방식은 template-only일 수 있지만,
 * 거기에 맞는 고정 문구는 리뷰 감사 문구(V14)가 아니라 쇼핑몰 연결 안내(V18)다.
 * 반대로 공개 리뷰에 샴푸 이야기가 있어도(분류가 shop) 공개 창구 규칙이 먼저다 — 공개 답글에는 V14 문구만.
 *
 * 두 번 부른다: 분류 전(llm 생략 → 초안 경로 문의는 "classify")과 후(분류 결과 또는 실패 사유 포함).
 *
 * 인계 카드로 간 문의에도 AI가 의료진 확인용 초안을 쓸 수 있다(2026-09-30 오너 결정, PRD v0.3). 이 결정은 경로를 바꾸지 않는다 —
 * 게이트가 먼저 돌고 인계 판정·카드·응답 시한은 그대로이고, 초안을 붙일지만 handoverDraftAllowed가 따로 정한다.
 */

import { checkMedication, type MedicationConfig, type MedicationResult } from "./medication";
import { maskPii, type MaskResult } from "./mask";
import { checkRedflags, mergeRoute, type MergedRoute, type RedflagConfig, type RedflagResult, type RuleId } from "./redflag";

export const REPLY_MODES = ["direct", "copy", "callback", "template-only"] as const;
export type ReplyMode = (typeof REPLY_MODES)[number];

export interface ChannelEntry {
  channel: string;
  /** 화면에 보일 이름(없으면 channel). */
  label: string;
  replyMode: ReplyMode;
  note: string | null;
  /** 운영 주체. 쇼핑몰이 별도 사업자면 "shop"(PRD 9절). 없으면 채널 이름으로 짐작한다. */
  operator: "clinic" | "shop" | null;
}

export type ChannelMapResult = { ok: true; channels: ChannelEntry[] } | { ok: false; error: string };

/** V19 json 검증. 답장 방식이 규격 밖이면 거부한다 — 화면의 발송 버튼이 이 값을 따른다(PRD F2). */
export function parseChannelMap(json: unknown): ChannelMapResult {
  if (!Array.isArray(json)) return { ok: false, error: "V19 json이 배열이 아닙니다" };
  const out: ChannelEntry[] = [];
  for (const [i, raw] of json.entries()) {
    if (typeof raw !== "object" || raw === null) return { ok: false, error: `V19 ${i}번 항목이 객체가 아닙니다` };
    const o = raw as Record<string, unknown>;
    if (typeof o.channel !== "string" || o.channel.trim() === "") return { ok: false, error: `V19 ${i}번 channel이 없습니다` };
    if (out.some((c) => c.channel === o.channel)) return { ok: false, error: `V19 channel이 겹칩니다: ${o.channel}` };
    if (!(REPLY_MODES as readonly unknown[]).includes(o.replyMode)) return { ok: false, error: `V19 ${o.channel}: replyMode가 틀렸습니다(${String(o.replyMode)})` };
    if (o.operator !== undefined && o.operator !== "clinic" && o.operator !== "shop") return { ok: false, error: `V19 ${o.channel}: operator가 틀렸습니다` };
    out.push({
      channel: o.channel,
      label: typeof o.label === "string" && o.label.trim() !== "" ? o.label : o.channel,
      replyMode: o.replyMode as ReplyMode,
      note: typeof o.note === "string" ? o.note : null,
      operator: (o.operator as ChannelEntry["operator"]) ?? null,
    });
  }
  if (out.length === 0) return { ok: false, error: "V19 채널이 하나도 없습니다" };
  return { ok: true, channels: out };
}

export function isShopChannel(c: ChannelEntry): boolean {
  if (c.operator) return c.operator === "shop";
  return /shop|mall|쇼핑/i.test(c.channel);
}

/** classify: 규칙을 통과한 초안 경로 문의 — 다음 단계는 LLM 분류다(아직 초안을 만들지 않는다). */
export type RouteStep = "handover" | "public-template" | "shop-redirect" | "classify" | "draft" | "hold";

/** LLM 분류 결과 중 경로 결정에 쓰는 부분. */
export interface LlmClassification {
  handover: boolean;
  category: string;
  reason?: string;
}

/**
 * 분류 단계의 상태. "분류 전"과 "분류 실패"를 null 하나로 뭉치지 않는다 —
 * 앞의 것은 다음 단계로 가라는 뜻이고, 뒤의 것은 초안을 만들지 말라는 뜻이다.
 */
export type LlmStage =
  | { status: "pending" }
  | { status: "failed"; reason: string }
  | { status: "classified"; value: LlmClassification };

/** 분류가 이 category를 내면 handover 값과 상관없이 인계한다(모순된 분류 "medication + handover:false" 방지). */
export const HANDOVER_CATEGORIES: readonly string[] = ["medication"];

export interface RouteInput {
  channel: string;
  text: string;
  channels: ChannelEntry[];
  redflag: RedflagConfig;
  medication: MedicationConfig;
  /** 생략하면 분류 전(pending). */
  llm?: LlmStage;
}

export interface RouteDecision {
  step: RouteStep;
  mask: MaskResult;
  redflag: RedflagResult;
  medication: MedicationResult;
  merged: MergedRoute;
  channel: ChannelEntry | null;
  /** 이 창구에서 허용되는 답장 방식. 인계여도 공개 창구면 고정 문구만 답할 수 있다. */
  replyMode: ReplyMode | null;
  /** 화면의 단계 표시용 기록. 어떤 단계에서 왜 멈췄는지 사람이 읽는다. */
  trace: string[];
  holdReason: string | null;
}

export function decideRoute(input: RouteInput): RouteDecision {
  const trace: string[] = [];
  const mask = maskPii(input.text);
  trace.push(mask.items.length > 0 ? `가림: ${mask.items.length}곳` : "가림: 없음");

  // 게이트는 가리기 전 원문에 돈다. 가림은 정보를 줄이기만 하므로 원문에서 잡히는 것이 가린 글에서 더 잡힐 수는 없다.
  const redflag = checkRedflags(input.text, input.redflag);
  const medication = checkMedication(input.text, input.medication);
  const ruleIds: RuleId[] = [...redflag.ruleIds, ...(medication.decision === "handover" ? (["MED-01"] as const) : [])];
  const stage: LlmStage = input.llm ?? { status: "pending" };
  const cls = stage.status === "classified" ? stage.value : null;
  const opinion = cls
    ? { handover: cls.handover || HANDOVER_CATEGORIES.includes(cls.category), ...(cls.reason ? { reason: cls.reason } : {}) }
    : null;
  const merged = mergeRoute({ decision: ruleIds.length > 0 ? "handover" : "pass", ruleIds }, opinion);
  trace.push(
    redflag.decision === "handover"
      ? `적신호 규칙: ${redflag.ruleIds.join(",")} (${[...redflag.matchedSymptoms, ...redflag.matchedAmbiguous].join(", ")})`
      : "적신호 규칙: 통과",
  );
  trace.push(medication.decision === "handover" ? `약 문의 규칙: MED-01 (${medication.matchedTerms.join(", ")})` : "약 문의 규칙: 통과");

  const channel = input.channels.find((c) => c.channel === input.channel) ?? null;
  const base = { mask, redflag, medication, merged, channel, replyMode: channel?.replyMode ?? null, trace };

  if (merged.decision === "handover") {
    trace.push(merged.source === "llm" ? `인계: 분류(${cls?.category ?? "?"})` : "인계: 규칙");
    return { ...base, step: "handover", holdReason: null };
  }
  if (!channel) {
    // 모르는 창구는 답장 방식을 모른다는 뜻이다. 추측해서 초안을 만들지 않는다.
    trace.push(`보류: 창구 지도(V19)에 없는 창구 "${input.channel}"`);
    return { ...base, step: "hold", holdReason: `창구 지도에 없는 창구입니다: ${input.channel}` };
  }
  if (isShopChannel(channel)) {
    trace.push("쇼핑몰 창구: 연결 창구 안내");
    return { ...base, step: "shop-redirect", holdReason: null };
  }
  if (channel.replyMode === "template-only") {
    trace.push("공개 창구: 고정 문구만");
    return { ...base, step: "public-template", holdReason: null };
  }
  if (stage.status === "pending") {
    trace.push("분류 단계로");
    return { ...base, step: "classify", holdReason: null };
  }
  if (stage.status === "failed") {
    trace.push(`보류: 분류 실패(${stage.reason})`);
    return { ...base, step: "hold", holdReason: `분류하지 못해 초안을 만들지 않습니다: ${stage.reason}` };
  }
  if (stage.value.category === "shop") {
    trace.push("쇼핑몰 문의(분류): 연결 창구 안내");
    return { ...base, step: "shop-redirect", holdReason: null };
  }
  trace.push(`초안 경로(분류: ${stage.value.category})`);
  return { ...base, step: "draft", holdReason: null };
}

/**
 * 인계 문의에 의료진 확인용 AI 초안을 붙여도 되나(PRD v0.3). 경로는 바꾸지 않고 초안을 만들지만 정한다.
 * - 공개 창구(리뷰·댓글, template-only): 공개 답글은 고정 문구만이라 만들지 않는다.
 * - 모르는 창구: 답장 방식을 모르므로 만들지 않는다.
 * - 쇼핑몰 창구: 별도 사업자가 운영하는 창구라 병원 문서를 인용한 답을 만들지 않는다.
 * 초안은 직원이 보낼 수 없고 의료진이 확인해야만 보낼 수 있다(src/demo/state.ts canSend의 clinicianOnly).
 */
export type HandoverDraftAllowed = { ok: true } | { ok: false; why: "not-handover" | "public" | "channel" | "shop" };

export function handoverDraftAllowed(d: Pick<RouteDecision, "step" | "replyMode" | "channel">): HandoverDraftAllowed {
  if (d.step !== "handover") return { ok: false, why: "not-handover" };
  if (!d.channel || d.replyMode === null) return { ok: false, why: "channel" };
  if (isShopChannel(d.channel)) return { ok: false, why: "shop" };
  if (d.replyMode === "template-only") return { ok: false, why: "public" };
  return { ok: true };
}

export interface PublicTemplate {
  key: string;
  text: string;
}

/** V14 공개 창구 고정 문구 json 검증. 공개 창구에서는 이 문구만 제안한다(PRD F11). */
export function parsePublicTemplates(json: unknown): { ok: true; templates: PublicTemplate[] } | { ok: false; error: string } {
  if (!Array.isArray(json)) return { ok: false, error: "V14 json이 배열이 아닙니다" };
  const out: PublicTemplate[] = [];
  for (const [i, raw] of json.entries()) {
    const o = raw as Record<string, unknown>;
    if (typeof o !== "object" || o === null || typeof o.key !== "string" || o.key === "" || typeof o.text !== "string" || o.text.trim() === "") {
      return { ok: false, error: `V14 ${i}번 항목에 key나 text가 없습니다` };
    }
    if (out.some((t) => t.key === o.key)) return { ok: false, error: `V14 key가 겹칩니다: ${o.key}` };
    out.push({ key: o.key, text: o.text });
  }
  if (out.length === 0) return { ok: false, error: "V14 고정 문구가 하나도 없습니다" };
  return { ok: true, templates: out };
}
