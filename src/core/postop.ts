/**
 * 경과일 읽기(PRD F17). 문의의 "9일째", "열흘", "D+12", "3주 됐는데"를 숫자 하나로 읽는다.
 *
 * 왜 redflag.ts의 extractSelfReportedDays를 그대로 쓰지 않고 감싸나:
 * - 그 함수는 인계 카드에 "환자가 적은 표현"을 보이려는 것이라 숫자로 적은 표현만 읽는다.
 *   F17은 "열흘째", "일주일 됐는데", "어제 수술했는데"처럼 말로 적은 날수도 읽어야 한다.
 * - "D+7 내원이 목요일인데"의 D+7은 오늘이 수술 후 7일이라는 뜻이 아니라 예약 이름이다.
 *   이런 표현을 경과일로 읽으면 엉뚱한 날짜 구간의 안내가 검색 맨 앞에 선다.
 *
 * 읽은 값은 추정이다. 화면에 원문 조각과 함께 보이고 직원이 고칠 수 있다(PRD F17).
 * 환자 여러 명의 기록을 합쳐 경과일을 계산하지 않는다(PRD 6절: 같은 사람 자동 병합 금지).
 */

import { extractSelfReportedDays } from "./redflag";

export interface PostopDayReading {
  days: number;
  /** 날수를 읽은 원문 조각. 화면에 "여기서 읽었습니다"로 보인다. */
  text: string;
}

const NATIVE_DAYS: Record<string, number> = { 하루: 1, 이틀: 2, 사흘: 3, 나흘: 4, 닷새: 5, 엿새: 6, 이레: 7, 일주일: 7, 열흘: 10, 보름: 15 };
/** 날수 뒤에 와야 '지금이 그날'이라는 뜻이 되는 말. "열흘 동안 약을"처럼 기간만 말한 경우를 거른다. */
const NOW_TAIL = "(?:째|차|됐|되었|지났|인데|이에요|예요)";
/** D+N 뒤에 이 말이 오면 오늘의 경과일이 아니라 예약·진료의 이름이다("D+7 내원", "D+7 경과 진료 예약"). */
const VISIT_NAME_AFTER = /^\s*(?:내원|경과|진료|예약|방문)/;

interface Found extends PostopDayReading {
  start: number;
}

function extraReadings(t: string): Found[] {
  const out: Found[] = [];
  const native = new RegExp(`(${Object.keys(NATIVE_DAYS).join("|")})\\s*${NOW_TAIL}`, "g");
  for (const m of t.matchAll(native)) out.push({ days: NATIVE_DAYS[m[1]], text: m[0], start: m.index! });
  // "3주 됐는데", "2주째". 숫자를 반드시 요구한다("주차"는 주차장과 겹친다).
  for (const m of t.matchAll(new RegExp(`(\\d{1,2})\\s*주\\s*${NOW_TAIL}`, "g"))) out.push({ days: Number(m[1]) * 7, text: m[0], start: m.index! });
  // "5일 지났는데". "N일째"는 extractSelfReportedDays가 이미 읽는다.
  for (const m of t.matchAll(/(\d{1,3})\s*일\s*(?:됐|되었|지났)/g)) out.push({ days: Number(m[1]), text: m[0], start: m.index! });
  const REL: Record<string, number> = { 오늘: 0, 어제: 1, 그제: 2, 그저께: 2 };
  for (const m of t.matchAll(/(오늘|어제|그저께|그제)\s*수술/g)) out.push({ days: REL[m[1]], text: m[0], start: m.index! });
  return out;
}

/**
 * 문의에서 경과일을 하나 읽는다. 여러 개면 원문에서 먼저 나온 것. 못 읽으면 null.
 * null을 0이나 추정값으로 채우지 않는다 — 모르는 날짜 구간을 검색 맨 앞에 세우지 않기 위해서다.
 */
export function readPostopDay(text: string): PostopDayReading | null {
  const t = text.normalize("NFKC");
  const found: Found[] = [];
  let from = 0;
  for (const r of extractSelfReportedDays(t)) {
    const start = t.indexOf(r.text, from);
    if (start === -1) continue;
    from = start + r.text.length;
    if (/^[dD]\s*\+/.test(r.text) && VISIT_NAME_AFTER.test(t.slice(start + r.text.length))) continue;
    found.push({ ...r, start });
  }
  found.push(...extraReadings(t));
  if (found.length === 0) return null;
  found.sort((a, b) => a.start - b.start);
  return { days: found[0].days, text: found[0].text };
}

export interface PostopRange {
  from: number;
  to: number;
}

/**
 * 볼트 소제목이 가리키는 수술 후 날짜 구간. "수술 후 머리 감기(D+3~D+14)" → 3~14, "D+7 내원" → 7,
 * "4주 경과 진료" → 28. 구간이 없는 제목은 null.
 * "주사 당일"·"수술 당일 복장"처럼 수술 후 날짜가 아닌 '당일'은 읽지 않는다.
 */
export function headingPostopRange(heading: string | null): PostopRange | null {
  if (!heading) return null;
  const h = heading.normalize("NFKC");
  const span = /D\s*\+\s*(\d{1,3})\s*[~∼\-–]\s*D\s*\+\s*(\d{1,3})/i.exec(h);
  if (span) return { from: Number(span[1]), to: Number(span[2]) };
  const one = /D\s*\+\s*(\d{1,3})/i.exec(h);
  if (one) return { from: Number(one[1]), to: Number(one[1]) };
  if (!/경과/.test(h)) return null;
  const unit = /(\d{1,2})\s*(주|개월|년)/.exec(h);
  if (!unit) return null;
  const n = Number(unit[1]) * (unit[2] === "주" ? 7 : unit[2] === "개월" ? 30 : 365);
  return { from: n, to: n };
}

export function rangeContains(r: PostopRange, day: number): boolean {
  return r.from <= day && day <= r.to;
}
