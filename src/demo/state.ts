/**
 * 방문자 브라우저에만 남는 시연 상태(localStorage 한 칸). 승인·수정·모의 발송 기록(F13), 확정 대기의
 * 연락 시도(F16), 인계 표시(F6), 직원이 고친 경과일(F17), 문서 빈칸(F14).
 *
 * 왜 서버에 두지 않나: 시연은 로그인도 데이터베이스도 없다(PRD 2절). 방문자마다 따로이고, '초기화'로 지운다.
 * 순수 함수로 두는 이유: 화면 컴포넌트에 기록 규칙을 쓰면 시험할 수 없다.
 *
 * 시각: 기록의 `at`은 시연 기준 시각(고정)이다. 시계가 멈춰 있으므로 순서는 `seq`로 가린다.
 */

export const STORAGE_KEY = "hanchanggu:demo:v1";

export type LogAction = "승인" | "수정" | "모의 발송" | "인계 표시" | "인계 취소" | "연락 시도" | "경과일 수정" | "고정 문구 선택";

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
}

export interface GapEntry {
  question: string;
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

/** 저장된 값을 읽는다. 모양이 틀리면(다른 판의 기록 등) 빈 상태로 시작한다 — 화면이 깨지는 것보다 낫다. */
export function parseState(raw: string | null): DemoState {
  if (!raw) return EMPTY_STATE;
  try {
    const o = JSON.parse(raw) as Partial<DemoState>;
    if (typeof o !== "object" || o === null || !Array.isArray(o.log) || !Array.isArray(o.gaps)) return EMPTY_STATE;
    return {
      log: o.log,
      contactAttempts: o.contactAttempts ?? {},
      handedOver: o.handedOver ?? {},
      postopDays: o.postopDays ?? {},
      edits: o.edits ?? {},
      gaps: o.gaps,
    };
  } catch {
    return EMPTY_STATE;
  }
}

export function addLog(s: DemoState, e: Omit<LogEntry, "seq">): DemoState {
  const seq = s.log.reduce((m, x) => Math.max(m, x.seq), 0) + 1;
  return { ...s, log: [...s.log, { ...e, seq }] };
}

export function sentTargets(s: DemoState): Set<string> {
  return new Set(s.log.filter((e) => e.action === "모의 발송").map((e) => e.target));
}

/** 같은 질문을 두 번 쌓지 않는다(공백·대소문자만 다른 것도 같은 질문). */
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
