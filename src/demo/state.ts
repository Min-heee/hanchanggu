/**
 * 방문자 브라우저에만 남는 시연 상태(localStorage 한 칸). 승인·수정·모의 발송 기록(F13), 확정 대기의
 * 연락 시도(F16), 인계 표시(F6), 직원이 고친 경과일(F17), 문서 빈칸(F14).
 *
 * 왜 서버에 두지 않나: 시연은 로그인도 데이터베이스도 없다(PRD 2절). 방문자마다 따로이고, '초기화'로 지운다.
 * 순수 함수로 두는 이유: 화면 컴포넌트에 기록 규칙을 쓰면 시험할 수 없다.
 *
 * 시각: 기록의 `at`은 시연 기준 시각(고정)이다. 시계가 멈춰 있으므로 순서는 `seq`로 가린다.
 *
 * 개인정보: 이 칸에는 사람이 친 글이 남는다. 문서 빈칸은 **가린 질문**만 저장하고, 검토자는 이름 대신 역할을 고른다.
 */

import { z } from "zod";

export const STORAGE_KEY = "hanchanggu:demo:v1";

export type LogAction = "승인" | "수정" | "모의 발송" | "인계 표시" | "인계 취소" | "연락 시도" | "경과일 수정" | "고정 문구 선택";

export const LOG_ACTIONS = ["승인", "수정", "모의 발송", "인계 표시", "인계 취소", "연락 시도", "경과일 수정", "고정 문구 선택"] as const satisfies readonly LogAction[];

/** 검토자는 이름을 치지 않고 역할을 고른다(방문자가 실명을 쳐서 브라우저에 남기지 않게). */
export const REVIEWER_ROLES = ["CS 직원", "코디네이터", "상담실장", "간호사"] as const;

export interface LogEntry {
  seq: number;
  /** 문의 ID(Q01) 또는 사내 Q&A 질문 ID. */
  target: string;
  action: LogAction;
  by: string;
  at: string;
  detail: string;
  /** 수정이면 바뀐 문장(전 → 후). */
  changes?: { before: string; after: string }[];
  /** 승인·모의 발송이면 그때의 글 전체. 승인본과 발송본이 같은지 기록으로 확인한다. */
  text?: string;
}

export interface GapEntry {
  /** 개인정보를 가린 질문. 주간 보고로 문서 담당자에게 넘기는 목록이라 원문을 두지 않는다. */
  question: string;
  /** 가린 곳 수. */
  masked: number;
  at: string;
  reason: string;
}

export interface DemoState {
  log: LogEntry[];
  /** 문의별 연락 시도 시각들. */
  contactAttempts: Record<string, string[]>;
  /** 문의별 '인계함' 시각. */
  handedOver: Record<string, string>;
  /** 문의별 직원이 고친 경과일. null = '경과일 없음'으로 고침. */
  postopDays: Record<string, number | null>;
  /** 문의별 직원이 고친 초안 본문. */
  edits: Record<string, string>;
  gaps: GapEntry[];
}

export const EMPTY_STATE: DemoState = { log: [], contactAttempts: {}, handedOver: {}, postopDays: {}, edits: {}, gaps: [] };

const LogEntrySchema = z.object({
  seq: z.number().int().positive(),
  target: z.string(),
  action: z.enum(LOG_ACTIONS),
  by: z.string(),
  at: z.string(),
  detail: z.string(),
  changes: z.array(z.object({ before: z.string(), after: z.string() })).optional(),
  text: z.string().optional(),
});
const GapSchema = z.object({ question: z.string(), masked: z.number().int().nonnegative(), at: z.string(), reason: z.string() });
const FIELDS = {
  contactAttempts: z.record(z.string(), z.array(z.string())),
  handedOver: z.record(z.string(), z.string()),
  postopDays: z.record(z.string(), z.number().int().nonnegative().nullable()),
  edits: z.record(z.string(), z.string()),
};

/**
 * 저장된 값을 읽는다. 필드마다 모양을 확인하고 **틀린 필드만** 비운다(다른 판의 기록, 손으로 고친 값 등).
 * 한 필드가 깨졌다고 전부 버리면 기록이 사라지고, 확인 없이 믿으면 상세 화면이 통째로 죽는다
 * (예: 연락 시도가 배열이 아니면 .map에서 TypeError).
 */
export function parseState(raw: string | null): DemoState {
  if (!raw) return EMPTY_STATE;
  let o: unknown;
  try {
    o = JSON.parse(raw);
  } catch {
    return EMPTY_STATE;
  }
  if (typeof o !== "object" || o === null || Array.isArray(o)) return EMPTY_STATE;
  const r = o as Record<string, unknown>;
  const list = <T>(v: unknown, schema: z.ZodType<T>): T[] => {
    if (!Array.isArray(v)) return [];
    return v.flatMap((x) => {
      const p = schema.safeParse(x);
      return p.success ? [p.data] : [];
    });
  };
  const field = <K extends keyof typeof FIELDS>(key: K): DemoState[K] => {
    const p = FIELDS[key].safeParse(r[key]);
    return (p.success ? p.data : {}) as DemoState[K];
  };
  // seq가 겹치면 순서를 가릴 수 없다. 처음 것만 남긴다.
  const seen = new Set<number>();
  const log = list(r.log, LogEntrySchema).filter((e) => (seen.has(e.seq) ? false : (seen.add(e.seq), true)));
  return {
    log,
    contactAttempts: field("contactAttempts"),
    handedOver: field("handedOver"),
    postopDays: field("postopDays"),
    edits: field("edits"),
    gaps: list(r.gaps, GapSchema),
  };
}

export function addLog(s: DemoState, e: Omit<LogEntry, "seq">): DemoState {
  const seq = s.log.reduce((m, x) => Math.max(m, x.seq), 0) + 1;
  return { ...s, log: [...s.log, { ...e, seq }] };
}

export function sentTargets(s: DemoState): Set<string> {
  return new Set(s.log.filter((e) => e.action === "모의 발송").map((e) => e.target));
}

/** 공개 창구에서 고정 문구를 고른 문의. */
export function templateChosenTargets(s: DemoState): Set<string> {
  return new Set(s.log.filter((e) => e.action === "고정 문구 선택").map((e) => e.target));
}

function lastSeq(log: LogEntry[], target: string, action: LogAction): LogEntry | null {
  let best: LogEntry | null = null;
  for (const e of log) if (e.target === target && e.action === action && (!best || e.seq > best.seq)) best = e;
  return best;
}

export type SendCheck = { ok: true } | { ok: false; reason: "unsaved" | "not-approved" | "edited-after-approval" | "already-sent" };

/**
 * 모의 발송 버튼을 켤지(F13). 판정 기준은 "마지막 승인이 마지막 수정보다 뒤이고, 승인한 글이 지금 보낼 글과 같은가".
 * '이 문의에 승인 기록이 한 번이라도 있는가'로 보면, 승인 → 글 수정 → 저장 뒤에도 다시 승인하지 않고 보낼 수 있다.
 * 보낸 뒤에는 다시 승인하기 전까지 같은 건을 또 보내지 못한다.
 *
 * @param text 지금 입력칸의 글. @param saved 저장된 글(수정본이 없으면 원 초안).
 */
export function canSend(log: LogEntry[], target: string, text: string, saved: string): SendCheck {
  if (text !== saved) return { ok: false, reason: "unsaved" };
  const approval = lastSeq(log, target, "승인");
  if (!approval) return { ok: false, reason: "not-approved" };
  const edit = lastSeq(log, target, "수정");
  if ((edit && edit.seq > approval.seq) || approval.text !== saved) return { ok: false, reason: "edited-after-approval" };
  const sent = lastSeq(log, target, "모의 발송");
  if (sent && sent.seq > approval.seq) return { ok: false, reason: "already-sent" };
  return { ok: true };
}

/** 같은 질문을 두 번 쌓지 않는다(공백·대소문자만 다른 것도 같은 질문). 질문은 가린 글이어야 한다(호출하는 쪽 몫). */
export function addGap(s: DemoState, g: GapEntry): DemoState {
  const norm = (q: string) => q.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
  if (s.gaps.some((x) => norm(x.question) === norm(g.question))) return s;
  return { ...s, gaps: [...s.gaps, g] };
}

/** 문장 단위로 나눈다: 줄바꿈, 그리고 공백·끝이 뒤따르는 . ! ? (core/citations의 문장 경계와 같은 규칙). */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\n" || (/[.!?。]/.test(ch) && (i + 1 === text.length || /\s/.test(text[i + 1])))) {
      out.push(text.slice(start, ch === "\n" ? i : i + 1));
      start = i + 1;
    }
  }
  out.push(text.slice(start));
  return out.map((s) => s.trim()).filter((s) => s !== "");
}

/**
 * 누가 어떤 문장을 고쳤는지(F13). 문장 목록을 최장 공통 부분열로 맞춘 뒤, 짝이 없는 문장을
 * 같은 자리끼리 "전 → 후"로 묶는다. 한쪽만 있으면 추가("" → 문장) 또는 삭제(문장 → "")다.
 */
export function changedSentences(before: string, after: string): { before: string; after: string }[] {
  const a = splitSentences(before);
  const b = splitSentences(after);
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: { before: string; after: string }[] = [];
  let i = 0;
  let j = 0;
  let pendA: string[] = [];
  let pendB: string[] = [];
  const flush = () => {
    const n = Math.max(pendA.length, pendB.length);
    for (let x = 0; x < n; x++) out.push({ before: pendA[x] ?? "", after: pendB[x] ?? "" });
    pendA = [];
    pendB = [];
  };
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      flush();
      i++;
      j++;
    } else if (j < b.length && (i === a.length || dp[i][j + 1] >= dp[i + 1][j])) pendB.push(b[j++]);
    else pendA.push(a[i++]);
  }
  flush();
  return out;
}
