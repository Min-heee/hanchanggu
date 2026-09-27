/**
 * 통합 목록(PRD F3)·확정 대기(F16)·인계 시한(F6)의 순수 계산. 화면 컴포넌트는 이 결과만 그린다.
 *
 * 순서: 적신호 인계 → 예약금 확정 대기 → 나머지, 같은 묶음 안에서는 오래 기다린 순.
 * 발송(모의)까지 끝난 건은 맨 아래로 내린다 — 할 일이 남은 건이 위에 있어야 한다.
 *
 * 경로는 **엔진이 낸 값**만 쓴다(규칙 게이트 decideRoute, 녹화가 있으면 녹화의 분류 뒤 경로).
 * 데이터의 정답 라벨(labels)은 여기서 읽지 않는다. 라벨로 정렬하면 엔진을 시연하는 게 아니다.
 */

import type { Knowledge } from "../core/knowledge";
import { decideRoute, type RouteDecision, type RouteStep } from "../core/route";
import type { BundleInquiry } from "./bundle";
import { minutesBetween } from "./clock";
import { confirmDeadlineMs, isOpenAt, type ConfirmPolicy, type HandoverPolicy } from "./policy";
import type { InquiryRecord } from "./recording";

export type InboxStatus = "new" | "draft" | "handover" | "hold" | "sent";

/** 색만으로 구분하지 않도록 상태는 언제나 글자 라벨과 함께 보인다. */
export const STATUS_LABEL: Record<InboxStatus, string> = { new: "새 문의", draft: "초안", handover: "인계", hold: "보류", sent: "발송" };

export type InboxKind = "redflag" | "medication" | "llm-handover" | "deposit" | "public" | "shop" | "draft-path" | "hold";

export const KIND_LABEL: Record<InboxKind, string> = {
  redflag: "적신호 인계",
  medication: "약 문의 인계",
  "llm-handover": "분류 인계",
  deposit: "예약금 확정 대기",
  public: "공개 창구",
  shop: "쇼핑몰 안내",
  "draft-path": "답장 초안",
  hold: "보류",
};

export interface DepositInfo {
  /** 확정 연락 시한(ms). 진료시간 표에서 계산할 수 없으면 null. */
  deadlineMs: number | null;
  elapsedMinutes: number;
  /** 시한까지 남은 분(지났으면 음수). */
  remainingMinutes: number | null;
  overdue: boolean;
  bookingAtMs: number | null;
}

export interface HandoverInfo {
  /** to-handover: 아직 인계 전(시한 = 받은 시각 + N분). to-contact: 인계함(시한 = 인계 시각 + 연락 목표 분). */
  phase: "to-handover" | "to-contact";
  deadlineMs: number | null;
  overdue: boolean;
  /** 지금 인계받을 사람(진료 중이면 진료일 담당, 아니면 휴진·진료시간 밖 담당). */
  role: string | null;
  openNow: boolean;
}

export interface InboxItem {
  id: string;
  inquiry: BundleInquiry;
  receivedMs: number;
  waitMinutes: number;
  step: RouteStep;
  kind: InboxKind;
  status: InboxStatus;
  /** 0 적신호 인계, 1 확정 대기, 2 나머지. */
  group: 0 | 1 | 2;
  decision: RouteDecision;
  record: InquiryRecord | null;
  deposit: DepositInfo | null;
  handover: HandoverInfo | null;
}

export interface LocalMarks {
  /** 모의 발송까지 끝낸 문의 ID. */
  sent: ReadonlySet<string>;
  /** 직원이 '인계함'으로 표시한 문의와 그 시각(ms). */
  handedOver: ReadonlyMap<string, number>;
}

export function isDepositPending(q: BundleInquiry): boolean {
  return q.meta.depositPaid === true && q.meta.bookingConfirmed !== true;
}

export function depositInfo(q: BundleInquiry, k: Knowledge, policy: ConfirmPolicy, nowMs: number): DepositInfo {
  const receivedMs = Date.parse(q.receivedAt);
  const deadlineMs = confirmDeadlineMs(k.hours, receivedMs, policy.businessDays.value);
  const remaining = deadlineMs === null ? null : minutesBetween(nowMs, deadlineMs);
  return {
    deadlineMs,
    elapsedMinutes: minutesBetween(receivedMs, nowMs),
    remainingMinutes: remaining,
    overdue: remaining !== null && remaining < 0,
    bookingAtMs: q.meta.bookingAt ? Date.parse(q.meta.bookingAt) : null,
  };
}

/**
 * 인계 시한. V12 "확인한 순간부터 N분 안에 인계"의 '확인한 순간'을 **도구가 문의를 받은 시각**으로 본다
 * (규칙 게이트는 받는 즉시 돈다). 주말에 쌓인 적신호 문의는 그래서 모두 시한이 지난 것으로 보인다 —
 * 휴진일에도 당직 연락망으로 넘겨야 한다는 V02·V12 규정과 맞다.
 */
export function handoverInfo(receivedMs: number, handedAtMs: number | null, policy: HandoverPolicy, k: Knowledge, nowMs: number): HandoverInfo {
  const openNow = isOpenAt(k.hours, nowMs);
  const role = (openNow ? policy.roleOpen : policy.roleClosed)?.value ?? null;
  if (handedAtMs === null) {
    const deadlineMs = policy.handoverMinutes ? receivedMs + policy.handoverMinutes.value * 60000 : null;
    return { phase: "to-handover", deadlineMs, overdue: deadlineMs !== null && nowMs > deadlineMs, role, openNow };
  }
  const deadlineMs = policy.contactMinutes ? handedAtMs + policy.contactMinutes.value * 60000 : null;
  return { phase: "to-contact", deadlineMs, overdue: deadlineMs !== null && nowMs > deadlineMs, role, openNow };
}

function kindOf(decision: RouteDecision, step: RouteStep, deposit: boolean): InboxKind {
  if (decision.redflag.decision === "handover") return "redflag";
  if (step === "handover") return decision.medication.decision === "handover" ? "medication" : "llm-handover";
  if (deposit) return "deposit";
  if (step === "public-template") return "public";
  if (step === "shop-redirect") return "shop";
  if (step === "hold") return "hold";
  return "draft-path";
}

function statusOf(step: RouteStep, record: InquiryRecord | null, sent: boolean): InboxStatus {
  if (sent) return "sent";
  if (step === "handover") return "handover";
  if (step === "hold") return "hold";
  if (step === "public-template" || step === "shop-redirect") return "draft";
  // 초안 경로: 녹화가 있으면 녹화된 초안의 검증 결과, 없으면 아직 AI 초안이 없는 새 문의.
  if (step === "draft") return record?.draft?.status === "ok" ? "draft" : "hold";
  return "new";
}

/**
 * 한 건의 목록 행을 만든다. 녹화가 있으면 녹화의 분류 뒤 경로를 쓰되, 규칙 게이트가 인계라고 하면
 * 녹화와 상관없이 인계다(녹화 뒤에 V11 목록이 바뀌어 새로 걸린 문의를 놓치지 않게).
 */
export function buildInboxItem(
  q: BundleInquiry,
  k: Knowledge,
  record: InquiryRecord | null,
  policies: { confirm: ConfirmPolicy; handover: HandoverPolicy },
  marks: LocalMarks,
  nowMs: number,
): InboxItem {
  const decision = decideRoute({ channel: q.channel, text: q.text, channels: k.channels, redflag: k.redflag, medication: k.medication });
  const step: RouteStep = decision.step === "classify" && record ? record.route.step : decision.step;
  const pending = isDepositPending(q);
  const kind = kindOf(decision, step, pending);
  const receivedMs = Date.parse(q.receivedAt);
  const status = statusOf(step, record, marks.sent.has(q.id));
  return {
    id: q.id,
    inquiry: q,
    receivedMs,
    waitMinutes: minutesBetween(receivedMs, nowMs),
    step,
    kind,
    status,
    group: kind === "redflag" ? 0 : pending ? 1 : 2,
    decision,
    record,
    deposit: pending ? depositInfo(q, k, policies.confirm, nowMs) : null,
    handover: step === "handover" ? handoverInfo(receivedMs, marks.handedOver.get(q.id) ?? null, policies.handover, k, nowMs) : null,
  };
}

/** 적신호 → 확정 대기 → 나머지, 같은 묶음은 오래 기다린 순, 발송한 건은 맨 아래. 동률은 ID 순(실행마다 같게). */
export function sortInbox(items: InboxItem[]): InboxItem[] {
  return [...items].sort(
    (a, b) =>
      Number(a.status === "sent") - Number(b.status === "sent") ||
      a.group - b.group ||
      b.waitMinutes - a.waitMinutes ||
      a.id.localeCompare(b.id),
  );
}

export interface InboxFilter {
  channel: string | null;
  kind: InboxKind | null;
  status: InboxStatus | null;
}

export function filterInbox(items: InboxItem[], f: InboxFilter): InboxItem[] {
  return items.filter((i) => (f.channel === null || i.inquiry.channel === f.channel) && (f.kind === null || i.kind === f.kind) && (f.status === null || i.status === f.status));
}

/** 필터 선택지: 실제로 쓰인 값만, 목록에 나오는 순서대로. */
export function filterOptions(items: InboxItem[]) {
  const uniq = <T>(xs: T[]) => [...new Set(xs)];
  return {
    channels: uniq(items.map((i) => i.inquiry.channel)),
    kinds: uniq(items.map((i) => i.kind)),
    statuses: uniq(items.map((i) => i.status)),
  };
}
