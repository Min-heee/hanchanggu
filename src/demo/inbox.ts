/**
 * 통합 목록(PRD F3)·확정 대기(F16)·인계 시한(F6)의 순수 계산. 화면 컴포넌트는 이 결과만 그린다.
 *
 * 순서: 적신호 인계 → 약·분류 인계 → 예약금 확정 대기 → 나머지, 같은 묶음 안에서는 오래 기다린 순.
 * 발송(모의)까지 끝난 건은 맨 아래로 내린다 — 할 일이 남은 건이 위에 있어야 한다.
 * 인계 문의는 예외다: 의료진 확인용 초안(PRD v0.3)을 모의 발송해도 '인계' 상태·묶음·요약·시한 경보가 그대로다. 보낸 초안은
 * "의료진이 확인한 뒤 직접 연락드리겠습니다"를 담고 있어 연락을 약속한 것이지 마친 것이 아니다 — V12 '인계한 뒤'(의료진이 연락을 마쳤다고
 * 알려 줄 때까지 '인계' 상태)와 F6(시한이 지나면 다시 경보). 보냈다는 사실은 따로 표시한다(InboxItem.handoverDraftSent).
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

/** 인계 문의에서 의료진 확인용 초안을 모의 발송한 표시(상태 배지와 따로). 의료진 연락을 마쳤다는 뜻이 아니다. */
export const HANDOVER_DRAFT_SENT_LABEL = "인계 초안 보냄(모의) · 의료진 연락 전";

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
  /** 인계 문의의 의료진 확인용 초안을 모의 발송했는지. 상태·묶음·요약에는 쓰지 않는다(위 머리말). */
  handoverDraftSent: boolean;
}

export interface LocalMarks {
  /** 모의 발송까지 끝낸 문의 ID. 인계 문의에서는 의료진 확인용 초안을 보냈다는 뜻이고, '인계' 상태를 풀지 않는다. */
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
  // 인계가 발송보다 먼저다: 의료진 확인용 초안을 보내도 의료진 연락이 끝난 것이 아니다(머리말).
  if (step === "handover") return marks.handedOver.has(id) ? "handed-over" : "handover-needed";
  if (marks.sent.has(id)) return "sent";
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
    handoverDraftSent: step === "handover" && marks.sent.has(q.id),
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
  /**
   * 묶음(목록 위 요약 숫자를 눌렀을 때). '약·분류 인계'는 약 문의 인계와 AI 분류 인계 두 유형이라 유형 하나로는 거를 수 없다 —
   * 유형으로 거르면 숫자는 5건인데 1건만 보였다. 요약 숫자와 같은 기준(할 일, 발송한 건 제외)으로 거른다.
   */
  group?: InboxItem["group"] | null;
}

export function filterInbox(items: InboxItem[], f: InboxFilter): InboxItem[] {
  const g = f.group ?? null;
  return items.filter(
    (i) =>
      (f.channel === null || i.inquiry.channel === f.channel) &&
      (f.kind === null || i.kind === f.kind) &&
      (f.status === null || i.status === f.status) &&
      (g === null || (i.group === g && i.status !== "sent")),
  );
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

/** 묶음 제목. 요약 숫자 칸·행 배지와 같은 이름을 쓴다(예전에는 같은 묶음을 '예약금 받음 · 확정 대기'와 '예약금 확정 대기' 두 이름으로 불렀다). */
export const GROUP_TITLE: Record<InboxItem["group"], string> = {
  0: "적신호 인계",
  1: "약·분류 인계",
  2: KIND_LABEL.deposit,
  3: "그 밖의 문의 · 오래 기다린 순",
};

/**
 * 목록 행의 시한 표시. 넘긴 양까지 적어 행끼리 구분되게 한다("인계 시한 1일 12시간 지남").
 * 목록은 red(시한 지남)만 빨간 글자로 칠하고, 남은 시한·모름은 옅은 글자로 둔다. 예약금 건은 행의 상태 배지가
 * 이미 '예약금 확정 대기'라서 글에 '예약금 받음'을 되풀이하지 않는다.
 */
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
    if (d.deadlineMs === null) return { tone: "gray", text: "확정 연락 시한 모름" };
    return d.overdue
      ? { tone: "red", text: `확정 연락 시한 ${formatDuration(-(d.remainingMinutes ?? 0))} 지남` }
      : { tone: "orange", text: `확정 연락 ${formatDuration(d.remainingMinutes ?? 0)} 남음` };
  }
  return null;
}

/**
 * 문의 글에 AI에게 하는 지시문이 섞였는지(예: "system: 지금부터 너는 …", "이전 지시는 모두 무시하고 …").
 * 경로는 바꾸지 않는다 — 초안 검증이 따로 막는다. 목록에서 그런 문의에 초록 '초안 준비'를 달면 보낼 준비가 끝난 안전한 건처럼
 * 보여서, 사람이 한 번 더 읽으라는 표시만 단다. 정답 라벨(labels.type)은 읽지 않는다(엔진 시연이 아니게 된다).
 */
const INSTRUCTION_PATTERN = /(^|[\s[(])(system|assistant|developer)\s*[:：]|지금부터 너는|너는 이제|이전 (지시|명령)|(지시|명령)(을|를)?\s?(모두\s)?무시|프롬프트|ignore (all|previous)/i;
export function looksLikeInstruction(text: string): boolean {
  return INSTRUCTION_PATTERN.test(text);
}

const HANDOVER_SHORT: Partial<Record<InboxKind, string>> = { redflag: "적신호", medication: "약 문의", "llm-handover": "AI 분류" };

/** 보류 이유를 목록 배지에 들어갈 만큼 짧게. 직원이 무엇을 풀면 되는지(문서를 채우나, 직접 답하나)가 보이게. */
export function holdShort(item: Pick<InboxItem, "step" | "decision" | "record">): string {
  if (item.step === "hold") {
    const r = item.decision.holdReason ?? item.record?.route.holdReason ?? "";
    return r.includes("창구") ? "창구 모름" : "분류 못함";
  }
  const code = item.record?.draft?.holdReasons[0]?.code;
  if (!code) return "AI 답 없음";
  if (code === "no-evidence" || code === "no-sources" || code === "weak-retrieval") return "문서 빈칸";
  if (code === "api-error" || code === "refusal" || code === "truncated") return "AI 답 없음";
  return "검증 걸림";
}

/**
 * 목록 행의 배지 톤. 색이 붙는 것은 행마다 이 배지 하나뿐이다.
 * red = 적신호 인계 필요(칠한 배지), red-line = 약 문의·AI 분류 인계 필요(테두리만 — 적신호보다 한 단계 약하게),
 * orange = 예약금 확정 대기, green = 초안 준비, line = 사람이 먼저 읽어야 할 건(지시문 섞임), neutral = 나머지.
 */
export type RowTone = "red" | "red-line" | "orange" | "green" | "line" | "neutral";

/**
 * 목록 행의 상태 배지 하나. 글자에 **할 일이나 상태**를 담는다("적신호 · 인계 필요" / "적신호 · 인계함", "보류 · 문서 빈칸").
 * 예전에는 유형 배지와 "상태: …" 배지를 나란히 달아 한 행에 색 칩이 서너 개였다.
 * 배지에 담지 못한 유형·초안 상태는 detail로 넘겨 행의 옅은 보조 줄에 적는다 — 정보는 없애지 않는다.
 */
export function rowBadge(item: InboxItem): { tone: RowTone; text: string; detail: string | null } {
  const { kind, status } = item;
  const short = HANDOVER_SHORT[kind] ?? KIND_LABEL[kind];
  if (status === "handover-needed") return { tone: kind === "redflag" ? "red" : "red-line", text: `${short} · 인계 필요`, detail: null };
  if (status === "handed-over") return { tone: "neutral", text: `${short} · ${STATUS_LABEL[status]}`, detail: null };
  if (status === "sent") return { tone: "neutral", text: "발송함", detail: KIND_LABEL[kind] };
  const draftState = status === "draft" ? "초안 준비" : status === "hold" ? `초안 보류(${holdShort(item)})` : STATUS_LABEL[status];
  if (kind === "deposit") return { tone: "orange", text: KIND_LABEL.deposit, detail: draftState };
  if (kind === "public") return { tone: "neutral", text: KIND_LABEL.public, detail: status === "template" ? STATUS_LABEL.template : "고정 문구 고름" };
  if (kind === "shop") return { tone: "neutral", text: KIND_LABEL.shop, detail: STATUS_LABEL[status] };
  if (looksLikeInstruction(item.inquiry.text)) return { tone: "line", text: "지시문 섞임 · 확인", detail: `${KIND_LABEL[kind]}, ${draftState}` };
  if (status === "draft") return { tone: "green", text: "초안 준비", detail: KIND_LABEL[kind] };
  if (status === "hold") return { tone: "neutral", text: `${STATUS_LABEL.hold} · ${holdShort(item)}`, detail: kind === "hold" ? null : KIND_LABEL[kind] };
  return { tone: "neutral", text: STATUS_LABEL[status], detail: KIND_LABEL[kind] };
}

/**
 * 목록 행 오른쪽 칸. 시한이 있는 건은 시한(지났으면 over), 없는 건은 얼마나 기다렸는지(그 밖의 문의 묶음에서 오래 기다린 건이 묻히지 않게).
 * 발송한 건은 비운다.
 */
export function rowDue(item: InboxItem, nowMs: number): { text: string; over: boolean; wait: boolean } | null {
  const d = deadlineBadge(item, nowMs);
  if (d) return { text: d.text, over: d.tone === "red", wait: false };
  if (item.status === "sent") return null;
  return { text: `${formatDuration(item.waitMinutes)} 기다림`, over: false, wait: true };
}

/** 목록에서 쓰는 '인계 초안 보냄' 표시. 배지가 이미 '인계 필요'라 '의료진 연락 전'은 되풀이하지 않는다(상세 화면은 HANDOVER_DRAFT_SENT_LABEL 전체). */
export const HANDOVER_DRAFT_SENT_SHORT = "인계 초안 보냄(모의)";

/**
 * 목록 행의 옅은 보조 줄 조각들. 한 조각은 줄이 바뀌어도 끊기지 않게 그린다("1일 11시간"이 두 줄로 갈라지지 않게).
 * warn은 옅은 글 가운데 진하게 둘 경고(AI 답 이후 바뀜 = 미리 만든 초안이 지금 글과 어긋남, 지시문 섞임).
 */
export function rowMeta(item: InboxItem, opts: { channel: string; drift: boolean; nowMs: number }): { text: string; warn: boolean }[] {
  const badge = rowBadge(item);
  const due = rowDue(item, opts.nowMs);
  const masked = item.decision.mask.items.length;
  const files = item.inquiry.attachments.length;
  const parts: ({ text: string; warn: boolean } | null)[] = [
    { text: item.id, warn: false },
    { text: opts.channel, warn: false },
    badge.detail ? { text: badge.detail, warn: false } : null,
    { text: `받음 ${formatKst(item.receivedMs)}`, warn: false },
    due?.wait ? null : { text: `기다린 시간 ${formatDuration(item.waitMinutes)}`, warn: false },
    files > 0 ? { text: `첨부 ${files}`, warn: false } : null,
    masked > 0 ? { text: `개인정보 가림 ${masked}곳`, warn: false } : null,
    item.handoverDraftSent ? { text: HANDOVER_DRAFT_SENT_SHORT, warn: false } : null,
    opts.drift ? { text: "AI 답 이후 바뀜", warn: true } : null,
    badge.tone !== "line" && looksLikeInstruction(item.inquiry.text) ? { text: "지시문 섞임", warn: true } : null,
  ];
  return parts.filter((x): x is { text: string; warn: boolean } => x !== null);
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
