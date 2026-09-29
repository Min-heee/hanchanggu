/**
 * 시연 모드의 시계(PRD F18). 기준 시각은 **이 파일의 DEMO_NOW 하나**다.
 *
 * 왜 고정하나: 합성 문의 41건은 금요일 오후(Q41 한 건)와 토요일 저녁~월요일 아침에 받은 것으로 적혀 있다. 실제 시계로 기다린 시간을
 * 재면 방문하는 날마다 "며칠 기다림"이 늘고, 확정 대기 시한은 모두 지난 것으로 보인다. 방문자가 언제 열어도
 * 같은 화면(마지막 문의 직후 월요일 오전 10시)을 보게 한다.
 *
 * 왜 Intl·toLocaleString을 쓰지 않나: 서버에서 미리 그린 화면과 브라우저에서 다시 그린 화면의 글자가
 * 실행 환경의 시간대·ICU에 따라 달라지면 하이드레이션이 어긋난다. KST(+09:00, 서머타임 없음)를 직접 더해 계산한다.
 */

/** 데이터의 마지막 문의(09:40) 직후, 월요일 오전 10시. */
export const DEMO_NOW = "2026-09-21T10:00:00+09:00";
export const DEMO_NOW_MS = Date.parse(DEMO_NOW);
/** 볼트 시행일 필터(selectCurrent의 asOf)에 쓰는 날짜. 기준 시각과 같은 날이다. */
export const DEMO_AS_OF = DEMO_NOW.slice(0, 10);

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
export const DOW_KO = ["일", "월", "화", "수", "목", "금", "토"] as const;

export interface KstParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** 0=일 … 6=토 */
  dow: number;
}

export function kstParts(ms: number): KstParts {
  const d = new Date(ms + KST_OFFSET_MS);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: d.getUTCHours(), minute: d.getUTCMinutes(), dow: d.getUTCDay() };
}

/** KST 날짜·시각을 ms로. month는 1부터. */
export function kstToMs(year: number, month: number, day: number, hour = 0, minute = 0): number {
  return Date.UTC(year, month - 1, day, hour, minute) - KST_OFFSET_MS;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "9/19(토) 18:10" */
export function formatKst(ms: number): string {
  const p = kstParts(ms);
  return `${p.month}/${p.day}(${DOW_KO[p.dow]}) ${pad(p.hour)}:${pad(p.minute)}`;
}

/** "18:10" */
export function formatKstTime(ms: number): string {
  const p = kstParts(ms);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** "2026-09-21" */
export function kstDate(ms: number): string {
  const p = kstParts(ms);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

export function minutesBetween(fromMs: number, toMs: number): number {
  return Math.floor((toMs - fromMs) / 60000);
}

/**
 * 기다린 시간·남은 시간을 짧게: "1일 15시간", "3시간 20분", "45분". 음수는 0으로 본다.
 * 하루가 넘으면 분은 버린다 — 목록에서 한눈에 비교하는 값이라 자릿수가 적어야 읽힌다.
 */
export function formatDuration(minutes: number): string {
  const m = Math.max(0, Math.floor(minutes));
  const days = Math.floor(m / 1440);
  const hours = Math.floor((m % 1440) / 60);
  const mins = m % 60;
  if (days > 0) return hours > 0 ? `${days}일 ${hours}시간` : `${days}일`;
  if (hours > 0) return mins > 0 ? `${hours}시간 ${mins}분` : `${hours}시간`;
  return `${mins}분`;
}
