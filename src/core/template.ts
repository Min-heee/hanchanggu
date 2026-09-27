/**
 * 고정값 삽입(PRD F8). 가격과 진료시간은 모델이 쓰지 않는다.
 *
 * 모델은 초안에 `{{price:consult}}`, `{{hours}}` 같은 자리표시자만 쓰고,
 * 값은 승인된 가격표(V03)·진료시간(V02) json에서 이 함수가 넣는다.
 * 없는 키는 추측하지 않고 오류로 돌려준다 — 오류가 나면 초안은 보류된다.
 */

export interface PriceItem {
  key: string;
  label: string;
  price: number;
  unit: string | null;
  note: string | null;
}

export type DayKey = "월" | "화" | "수" | "목" | "금" | "토" | "일";
export const DAY_ORDER: DayKey[] = ["월", "화", "수", "목", "금", "토", "일"];
const EN_DAY: Record<string, DayKey> = { mon: "월", tue: "화", wed: "수", thu: "목", fri: "금", sat: "토", sun: "일" };

export interface DayHours {
  day: DayKey;
  open: string | null;
  close: string | null;
}

export interface Hours {
  weekly: DayHours[];
  /** 점심시간. days가 비어 있으면 진료하는 모든 요일에 적용. */
  lunch: { start: string; end: string; days: DayKey[] } | null;
  /** 요일이 아닌 휴진(공휴일 등). */
  closedDays: string[];
  /** 임시 휴진일. */
  extraClosedDates: { date: string; reason: string | null }[];
  /** 접수 마감(진료 종료 몇 분 전). */
  lastEntryMinutesBeforeClose: number | null;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const KEY_RE = /^[a-z0-9][a-z0-9_-]*$/;
/** 요일이 아닌 휴진 토큰. 모르는 영문 토큰은 추측하지 않고 거부한다. */
const CLOSED_TOKENS: Record<string, string> = { "public-holiday": "공휴일", holiday: "공휴일" };

/** V03 가격표 json 검증. 가격은 0 이상의 정수(원)만 받는다. "상담 후 결정" 같은 값은 가격표가 아니라 문장으로 쓴다. */
export function parsePriceList(json: unknown): Parsed<PriceItem[]> {
  if (!Array.isArray(json)) return { ok: false, error: "V03 json이 배열이 아닙니다" };
  const items: PriceItem[] = [];
  const keys = new Set<string>();
  for (const [i, raw] of json.entries()) {
    if (typeof raw !== "object" || raw === null) return { ok: false, error: `V03 ${i}번 항목이 객체가 아닙니다` };
    const o = raw as Record<string, unknown>;
    if (typeof o.key !== "string" || !KEY_RE.test(o.key)) return { ok: false, error: `V03 ${i}번 key가 틀렸습니다` };
    if (keys.has(o.key)) return { ok: false, error: `V03 key가 겹칩니다: ${o.key}` };
    if (typeof o.label !== "string" || o.label.trim() === "") return { ok: false, error: `V03 ${o.key}: label이 없습니다` };
    if (typeof o.price !== "number" || !Number.isInteger(o.price) || o.price < 0) {
      return { ok: false, error: `V03 ${o.key}: price는 0 이상의 정수여야 합니다` };
    }
    for (const f of ["unit", "note"] as const) {
      if (o[f] !== undefined && o[f] !== null && typeof o[f] !== "string") return { ok: false, error: `V03 ${o.key}: ${f}는 문자열이어야 합니다` };
    }
    keys.add(o.key);
    items.push({ key: o.key, label: o.label, price: o.price, unit: (o.unit as string) || null, note: (o.note as string) || null });
  }
  return { ok: true, value: items };
}

function toDay(v: unknown): DayKey | null {
  if (typeof v !== "string") return null;
  if ((DAY_ORDER as string[]).includes(v)) return v as DayKey;
  return EN_DAY[v.toLowerCase()] ?? null;
}

function parseDayEntry(day: DayKey, e: unknown): Parsed<DayHours> {
  // null 또는 { closed: true }는 휴진.
  if (e === null || (typeof e === "object" && (e as { closed?: unknown }).closed === true)) return { ok: true, value: { day, open: null, close: null } };
  if (typeof e !== "object") return { ok: false, error: `V02 ${day}: 값이 객체가 아닙니다` };
  const o = e as Record<string, unknown>;
  if (typeof o.open !== "string" || !TIME_RE.test(o.open) || typeof o.close !== "string" || !TIME_RE.test(o.close)) {
    return { ok: false, error: `V02 ${day}: open/close가 HH:MM이 아닙니다` };
  }
  if (o.open >= o.close) return { ok: false, error: `V02 ${day}: 여는 시각이 닫는 시각보다 늦습니다` };
  return { ok: true, value: { day, open: o.open, close: o.close } };
}

/**
 * V02 진료시간 json 검증. 두 모양을 받는다.
 *   객체형: `"weekly": { "mon": { "open": "10:00", "close": "19:00" }, ..., "sun": null }`
 *   배열형: `"weekly": [{ "day": "월", "open": "10:00", "close": "19:00" }, { "day": "일", "closed": true }]`
 * 그 밖의 선택 필드: `lunch {start,end,days?}`, `closed`(요일 키 또는 "public-holiday"), `closedDays`(한국어 문자열),
 * `extraClosedDates [{date, reason}]`, `lastEntryMinutesBeforeClose`. 모르는 필드는 무시한다(시간 계산에 안 쓰는 값).
 * 요일은 7개가 모두 있어야 한다. 빠진 요일을 '휴진'으로 추정하지 않는다.
 */
export function parseHours(json: unknown): Parsed<Hours> {
  if (typeof json !== "object" || json === null || Array.isArray(json)) return { ok: false, error: "V02 json이 객체가 아닙니다" };
  const o = json as Record<string, unknown>;
  const byDay = new Map<DayKey, DayHours>();
  const put = (day: DayKey | null, raw: unknown, label: string): string | null => {
    if (!day) return `V02 요일 값이 틀렸습니다: ${label}`;
    if (byDay.has(day)) return `V02 요일이 겹칩니다: ${day}`;
    const r = parseDayEntry(day, raw);
    if (!r.ok) return r.error;
    byDay.set(day, r.value);
    return null;
  };
  if (Array.isArray(o.weekly)) {
    for (const raw of o.weekly) {
      if (typeof raw !== "object" || raw === null) return { ok: false, error: "V02 weekly 항목이 객체가 아닙니다" };
      const d = (raw as { day?: unknown }).day;
      const err = put(toDay(d), raw, String(d));
      if (err) return { ok: false, error: err };
    }
  } else if (typeof o.weekly === "object" && o.weekly !== null) {
    for (const [k, raw] of Object.entries(o.weekly)) {
      const err = put(toDay(k), raw, k);
      if (err) return { ok: false, error: err };
    }
  } else return { ok: false, error: "V02 weekly가 없습니다" };

  const missing = DAY_ORDER.filter((d) => !byDay.has(d));
  if (missing.length > 0) return { ok: false, error: `V02 요일이 빠졌습니다: ${missing.join(",")}` };

  let lunch: Hours["lunch"] = null;
  if (o.lunch !== undefined && o.lunch !== null) {
    const l = o.lunch as Record<string, unknown>;
    if (typeof l.start !== "string" || !TIME_RE.test(l.start) || typeof l.end !== "string" || !TIME_RE.test(l.end)) {
      return { ok: false, error: "V02 lunch가 HH:MM이 아닙니다" };
    }
    const days: DayKey[] = [];
    if (l.days !== undefined) {
      if (!Array.isArray(l.days)) return { ok: false, error: "V02 lunch.days가 배열이 아닙니다" };
      for (const d of l.days) {
        const k = toDay(d);
        if (!k) return { ok: false, error: `V02 lunch.days 요일 값이 틀렸습니다: ${String(d)}` };
        days.push(k);
      }
    }
    lunch = { start: l.start, end: l.end, days: DAY_ORDER.filter((d) => days.includes(d)) };
  }

  const closedDays: string[] = [];
  if (o.closed !== undefined) {
    if (!Array.isArray(o.closed)) return { ok: false, error: "V02 closed가 배열이 아닙니다" };
    for (const c of o.closed) {
      const day = toDay(c);
      if (day) {
        // 요일 휴진은 weekly에 이미 있다. 두 곳이 어긋나면 어느 쪽이 맞는지 모르므로 거부한다.
        if (byDay.get(day)!.open !== null) return { ok: false, error: `V02 closed와 weekly가 어긋납니다(${day}: closed에는 휴진, weekly에는 진료)` };
      } else if (typeof c === "string" && CLOSED_TOKENS[c]) closedDays.push(CLOSED_TOKENS[c]);
      else return { ok: false, error: `V02 closed 값을 알 수 없습니다: ${String(c)}` };
    }
  }
  if (o.closedDays !== undefined) {
    if (!Array.isArray(o.closedDays) || !o.closedDays.every((x) => typeof x === "string")) {
      return { ok: false, error: "V02 closedDays가 문자열 배열이 아닙니다" };
    }
    for (const c of o.closedDays as string[]) if (!closedDays.includes(c)) closedDays.push(c);
  }

  const extraClosedDates: Hours["extraClosedDates"] = [];
  if (o.extraClosedDates !== undefined) {
    if (!Array.isArray(o.extraClosedDates)) return { ok: false, error: "V02 extraClosedDates가 배열이 아닙니다" };
    for (const x of o.extraClosedDates) {
      const e = x as Record<string, unknown>;
      if (typeof e !== "object" || e === null || typeof e.date !== "string" || !DATE_RE.test(e.date)) {
        return { ok: false, error: "V02 extraClosedDates의 date가 YYYY-MM-DD가 아닙니다" };
      }
      extraClosedDates.push({ date: e.date, reason: typeof e.reason === "string" ? e.reason : null });
    }
  }

  let lastEntryMinutesBeforeClose: number | null = null;
  if (o.lastEntryMinutesBeforeClose !== undefined) {
    const m = o.lastEntryMinutesBeforeClose;
    if (typeof m !== "number" || !Number.isInteger(m) || m < 0) return { ok: false, error: "V02 lastEntryMinutesBeforeClose가 0 이상의 정수가 아닙니다" };
    lastEntryMinutesBeforeClose = m;
  }

  return { ok: true, value: { weekly: DAY_ORDER.map((d) => byDay.get(d)!), lunch, closedDays, extraClosedDates, lastEntryMinutesBeforeClose } };
}

/** 1234567 → "1,234,567". toLocaleString은 실행 환경의 ICU에 따라 달라질 수 있어 직접 쓴다. */
export function formatWon(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function renderPrice(item: PriceItem): string {
  // "2,000원/모", "30,000원/회". 단위가 없으면 금액만.
  return `${formatWon(item.price)}원${item.unit ? `/${item.unit}` : ""}`;
}

function groupDays(days: DayKey[]): string {
  // 연속 요일을 "월–금"처럼 묶는다. DAY_ORDER 기준 연속만 묶는다(일→월은 잇지 않는다).
  const parts: string[] = [];
  let i = 0;
  while (i < days.length) {
    let j = i;
    while (j + 1 < days.length && DAY_ORDER.indexOf(days[j + 1]) === DAY_ORDER.indexOf(days[j]) + 1) j++;
    parts.push(i === j ? days[i] : `${days[i]}–${days[j]}`);
    i = j + 1;
  }
  return parts.join("·");
}

/** 같은 시간대의 연속 요일을 묶는다: "월–수 10:00–19:00 · 목 10:00–21:00 · 일 휴진". */
export function renderHours(h: Hours): string {
  const groups: { from: DayKey; to: DayKey; label: string }[] = [];
  for (const d of h.weekly) {
    const label = d.open ? `${d.open}–${d.close}` : "휴진";
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.to = d.day;
    else groups.push({ from: d.day, to: d.day, label });
  }
  let s = groups.map((g) => `${g.from === g.to ? g.from : `${g.from}–${g.to}`} ${g.label}`).join(" · ");
  if (h.lunch) s += ` (${h.lunch.days.length > 0 ? `${groupDays(h.lunch.days)} ` : ""}점심시간 ${h.lunch.start}–${h.lunch.end})`;
  if (h.lastEntryMinutesBeforeClose !== null) s += ` · 접수 마감은 진료 종료 ${h.lastEntryMinutesBeforeClose}분 전`;
  if (h.closedDays.length > 0) s += ` · ${h.closedDays.join("·")} 휴진`;
  if (h.extraClosedDates.length > 0) {
    s += ` · 임시 휴진: ${h.extraClosedDates.map((e) => `${e.date}${e.reason ? `(${e.reason})` : ""}`).join(", ")}`;
  }
  return s;
}

export interface Fill {
  placeholder: string;
  value: string;
  /** 값을 가져온 볼트 문서. 화면에서 "가격표 V03에서 들어온 값"으로 보인다. */
  sourceDoc: "V03" | "V02";
  key: string | null;
}

export type FillResult =
  | { ok: true; text: string; fills: Fill[] }
  | { ok: false; errors: string[] };

/**
 * 자리표시자를 채운다. 알 수 있는 형식은 `{{price:키}}`와 `{{hours}}` 둘뿐이다.
 * 모르는 형식, 없는 키, 닫히지 않은 `{{`는 모두 오류다(남은 괄호가 환자에게 나가면 안 된다).
 * 값 소스가 없으면(null) 그 자리표시자를 쓴 초안만 오류가 난다.
 */
export function fillTemplate(text: string, prices: PriceItem[] | null, hours: Hours | null): FillResult {
  const errors: string[] = [];
  const fills: Fill[] = [];
  const out = text.replace(/\{\{\s*([^{}]*?)\s*\}\}/g, (whole, inner: string) => {
    const pm = /^price:([a-z0-9][a-z0-9_-]*)$/.exec(inner);
    if (pm) {
      if (!prices) {
        errors.push(`가격표(V03)가 없어 ${whole}를 채울 수 없습니다`);
        return whole;
      }
      const item = prices.find((p) => p.key === pm[1]);
      if (!item) {
        errors.push(`가격표에 없는 키입니다: ${pm[1]}`);
        return whole;
      }
      const value = renderPrice(item);
      fills.push({ placeholder: whole, value, sourceDoc: "V03", key: item.key });
      return value;
    }
    if (inner === "hours") {
      if (!hours) {
        errors.push(`진료시간(V02)이 없어 ${whole}를 채울 수 없습니다`);
        return whole;
      }
      const value = renderHours(hours);
      fills.push({ placeholder: whole, value, sourceDoc: "V02", key: null });
      return value;
    }
    errors.push(`알 수 없는 자리표시자입니다: ${whole}`);
    return whole;
  });
  if (errors.length === 0 && /\{\{|\}\}/.test(out)) errors.push("닫히지 않은 자리표시자가 남았습니다");
  return errors.length > 0 ? { ok: false, errors } : { ok: true, text: out, fills };
}
