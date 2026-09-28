/**
 * 통합 목록(PRD F3)·확정 대기(F16)·인계 시한(F6)의 순수 계산. 화면 컴포넌트는 이 결과만 그린다.
 *
 * 순서: 적신호 인계 → 약·분류 인계 → 예약금 확정 대기 → 나머지, 같은 묶음 안에서는 오래 기다린 순.
 * 발송(모의)까지 끝난 건은 맨 아래로 내린다 — 할 일이 남은 건이 위에 있어야 한다.
 * 약·분류 인계를 확정 대기보다 위에 두는 이유: 둘 다 5분 시한의 의료진 인계다. PRD F3의 "적신호 맨 위"는 지키되,
 * 약 용량 문의가 주차·리뷰 문의 아래에 묻히면 병원 쪽에는 안전 결함으로 읽힌다.
 *
 * 경로는 **엔진이 낸 값**만 쓴다(규칙 게이트 decideRoute, 녹화가 있으면 녹화의 분류 뒤 경로).
 * 데이터의 정답 라벨(labels)은 여기서 읽지 않는다. 라벨로 정렬하면 엔진을 시연하는 게 아니다.
 */

import type { Knowledge } from "../core/knowledge";
import { decideRoute, type RouteDecision, type RouteStep } from "../core/route";
import type { BundleInquiry } from "./bundle";
import { formatDuration, formatKst, minutesBetween } from "./clock";
import { confirmDeadlineMs, isOpenAt, type ConfirmPolicy, type HandoverPolicy } from "./policy";
import type { InquiryRecord } from "./recording";

/**
 * 상태. '할 일'이 남았는지가 한눈에 읽히게 이름을 붙인다.
 * - template: 공개 창구에서 고정 문구를 아직 안 고름. 고르면 draft.
 * - handover-needed / handed-over: '인계'만 적으면 끝난 일처럼 읽혀서 둘로 나눴다.
 */
export type InboxStatus = "new" | "template" | "draft" | "handover-needed" | "handed-over" | "hold" | "sent";

/** 색만으로 구분하지 않도록 상태는 언제나 글자 라벨과 함께 보인다. */
export const STATUS_LABEL: Record<InboxStatus, string> = {
  new: "새 문의",
  template: "고정 문구 고르기",
  draft: "초안",
  "handover-needed": "인계 필요",
  "handed-over": "인계함",
  hold: "보류",
  sent: "발송",
};

export type InboxKind = "redflag" | "medication" | "llm-handover" | "deposit" | "public" | "shop" | "draft-path" | "hold";

export const KIND_LABEL: Record<InboxKind, string> = {
  redflag: "적신호 인계",
  medication: "약 문의 인계",
  "llm-handover": "AI 분류 인계",
  deposit: "예약금 확정 대기",
  public: "공개 창구",
  shop: "쇼핑몰 안내",
  "draft-path": "일반 문의",
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
  /** 시한 당시 인계받았어야 할 사람. 일요일에 지난 시한이면 '당직 의료진 연락망'이다. */
  roleAtDeadline: string | null;
}

export interface InboxItem {
  id: string;
  inquiry: BundleInquiry;
  receivedMs: number;
  waitMinutes: number;
  step: RouteStep;
  kind: InboxKind;
  status: InboxStatus;
  /** 0 적신호 인계, 1 약·분류 인계, 2 확정 대기, 3 나머지. */
  group: 0 | 1 | 2 | 3;
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
  /** 공개 창구에서 고정 문구를 고른 문의. 없으면 아무것도 안 고른 것으로 본다. */
  templateChosen?: ReadonlySet<string>;
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
  const roleAt = (ms: number) => (isOpenAt(k.hours, ms) ? policy.roleOpen : policy.roleClosed)?.value ?? null;
  const openNow = isOpenAt(k.hours, nowMs);
  const role = roleAt(nowMs);
  const deadlineMs =
    handedAtMs === null
      ? policy.handoverMinutes
        ? receivedMs + policy.handoverMinutes.value * 60000
        : null
      : policy.contactMinutes
        ? handedAtMs + policy.contactMinutes.value * 60000
        : null;
  return {
    phase: handedAtMs === null ? "to-handover" : "to-contact",
    deadlineMs,
    overdue: deadlineMs !== null && nowMs > deadlineMs,
    role,
    openNow,
    roleAtDeadline: deadlineMs === null ? null : roleAt(deadlineMs),
  };
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

function statusOf(id: string, step: RouteStep, record: InquiryRecord | null, marks: LocalMarks): InboxStatus {
  if (marks.sent.has(id)) return "sent";
  if (step === "handover") return marks.handedOver.has(id) ? "handed-over" : "handover-needed";
  if (step === "hold") return "hold";
  if (step === "public-template") return marks.templateChosen?.has(id) ? "draft" : "template";
  // 쇼핑몰 안내는 초안을 만들지 않는다(연결 창구만 안내). 직원이 아직 손대지 않은 새 문의다.
  if (step === "shop-redirect") return "new";
  // 초안 경로: 미리 만든 AI 답이 있으면 그 검증 결과, 없으면 아직 AI 초안이 없는 새 문의.
  if (step === "draft") return record?.draft?.status === "ok" ? "draft" : "hold";
  return "new";
}

function groupOf(kind: InboxKind, step: RouteStep, pending: boolean): InboxItem["group"] {
  if (kind === "redflag") return 0;
  if (step === "handover") return 1;
  if (pending) return 2;
  return 3;
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
  const status = statusOf(q.id, step, record, marks);
  return {
    id: q.id,
    inquiry: q,
    receivedMs,
    waitMinutes: minutesBetween(receivedMs, nowMs),
    step,
    kind,
    status,
    group: groupOf(kind, step, pending),
    decision,
    record,
    deposit: pending ? depositInfo(q, k, policies.confirm, nowMs) : null,
    handover: step === "handover" ? handoverInfo(receivedMs, marks.handedOver.get(q.id) ?? null, policies.handover, k, nowMs) : null,
  };
}

/** 적신호 → 약·분류 인계 → 확정 대기 → 나머지, 같은 묶음은 오래 기다린 순, 발송한 건은 맨 아래. 동률은 ID 순(실행마다 같게). */
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

export const GROUP_TITLE: Record<InboxItem["group"], string> = {
  0: "적신호 인계",
  1: "약·분류 인계",
  2: "예약금 받음 · 확정 대기",
  3: "기다린 시간 순",
};

/** 목록 행의 시한 배지. 넘긴 양까지 적어 행끼리 구분되게 한다("인계 시한 1일 12시간 지남"). */
export function deadlineBadge(item: InboxItem, nowMs: number): { tone: "red" | "orange" | "gray"; text: string } | null {
  if (item.handover) {
    const h = item.handover;
    const what = h.phase === "to-handover" ? "인계" : "의료진 연락";
    if (h.deadlineMs === null) return { tone: "gray", text: `${what} 시한 모름(인계 절차 문서에서 읽지 못함)` };
    return h.overdue
      ? { tone: "red", text: `${what} 시한 ${formatDuration(minutesBetween(h.deadlineMs, nowMs))} 지남` }
      : { tone: "orange", text: `${what} ${formatKst(h.deadlineMs)}까지` };
  }
  if (item.deposit) {
    const d = item.deposit;
    if (d.deadlineMs === null) return { tone: "gray", text: "예약금 받음 · 확정 연락 시한 모름" };
    return d.overdue
      ? { tone: "red", text: `예약금 받음 · 확정 연락 시한 ${formatDuration(-(d.remainingMinutes ?? 0))} 지남` }
      : { tone: "orange", text: `예약금 받음 · 확정 연락 ${formatDuration(d.remainingMinutes ?? 0)} 남음` };
  }
  return null;
}

export interface InboxSummary {
  /** 규칙이 잡은 적신호 인계(발송 전). 정답 라벨과 비교(과잉 인계)는 평가 탭 몫이다. */
  redflag: number;
  redflagOverdue: number;
  /** 약 문의·AI 분류 인계. */
  otherHandover: number;
  otherHandoverOverdue: number;
  deposit: number;
  depositOverdue: number;
  /** 가장 가까운(아직 안 지난) 확정 연락 시한까지 남은 분. */
  nextDepositMinutes: number | null;
  total: number;
}

/** 목록 위 요약(30초 시연 0~5초). 발송한 건은 할 일에서 뺀다. */
export function inboxSummary(items: InboxItem[]): InboxSummary {
  const open = items.filter((i) => i.status !== "sent");
  const g = (n: number) => open.filter((i) => i.group === n);
  const next = g(2)
    .map((i) => i.deposit?.remainingMinutes ?? null)
    .filter((m): m is number => m !== null && m >= 0)
    .sort((a, b) => a - b)[0];
  return {
    redflag: g(0).length,
    redflagOverdue: g(0).filter((i) => i.handover?.overdue).length,
    otherHandover: g(1).length,
    otherHandoverOverdue: g(1).filter((i) => i.handover?.overdue).length,
    deposit: g(2).length,
    depositOverdue: g(2).filter((i) => i.deposit?.overdue).length,
    nextDepositMinutes: next ?? null,
    total: items.length,
  };
}

/**
 * 목록 머리에 적는 '문의를 받은 기간'("9/18(금) 16:40~9/21(월) 09:40"). 데이터에서 계산한다 —
 * 문의를 더하거나 받은 시각을 고쳐도 화면 문구가 따라오게(손으로 적어 두면 데이터와 어긋난다). 문의가 없으면 null.
 */
export function receivedRangeText(items: InboxItem[]): string | null {
  if (items.length === 0) return null;
  const ms = items.map((i) => i.receivedMs);
  return `${formatKst(Math.min(...ms))}~${formatKst(Math.max(...ms))}`;
}

export type InboxRow =
  | { type: "title"; key: string; text: string }
  | { type: "item"; key: string; item: InboxItem }
  | { type: "more"; key: string; hidden: number };

/**
 * 목록을 묶음 제목·행·'더 보기'로 편다. 적신호 묶음은 접혀 있으면 앞 `peek`건(기본 2)만 보인다 —
 * 16건이 첫 화면을 다 차지하면 그 아래 약 문의 인계·예약금 확정 대기(30초 시연 0~5초의 주황 칸)가 스크롤 밖으로 밀린다.
 */
export function inboxRows(items: InboxItem[], opts: { collapseRedflag: boolean; peek?: number }): InboxRow[] {
  const peek = opts.peek ?? 2;
  const rows: InboxRow[] = [];
  let prevKey: string | null = null;
  let shownInGroup = 0;
  let hidden = 0;
  const flushMore = () => {
    if (hidden > 0) rows.push({ type: "more", key: "more-redflag", hidden });
    hidden = 0;
  };
  for (const it of items) {
    const key = it.status === "sent" ? "sent" : String(it.group);
    if (key !== prevKey) {
      flushMore();
      rows.push({ type: "title", key: `t-${key}`, text: it.status === "sent" ? "발송함" : GROUP_TITLE[it.group] });
      prevKey = key;
      shownInGroup = 0;
    }
    if (opts.collapseRedflag && key === "0" && shownInGroup >= peek) {
      hidden++;
      continue;
    }
    rows.push({ type: "item", key: it.id, item: it });
    shownInGroup++;
  }
  flushMore();
  return rows;
}
