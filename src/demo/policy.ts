/**
 * 확정 대기 시한(F16)과 인계 시한·담당(F6)을 볼트 문서에서 읽는다.
 *
 * 왜 코드 상수가 아니라 문서에서 읽나: 규정이 바뀌면 원무팀·간호팀이 문서를 고치고, 화면은 그 문서를 따라야 한다.
 * 읽을 수 없으면 조용히 기본값을 쓰지 않는다 — 확정 대기 시한만 상수로 물러나되 화면에 "문서에서 읽지 못해
 * 기본값"이라고 보이고, 인계 담당·환자 안내 문구는 지어내지 않고 "V12에서 읽지 못함"으로 보인다.
 * (환자에게 나가는 문장을 코드가 지어내면 승인 문구만 보낸다는 규칙(F6)이 깨진다.)
 */

import type { Chunk } from "../core/vault";
import type { Hours } from "../core/template";
import { DOW_KO, kstDate, kstParts, kstToMs } from "./clock";

/**
 * V04에서 "입금을 확인하면 N영업일 안에 확정 연락"을 읽지 못했을 때 쓰는 값.
 * 지금 V04 3판에는 문장이 있어 쓰이지 않는다. 쓰이면 화면에 "기본값"으로 표시된다.
 */
export const FALLBACK_CONFIRM_BUSINESS_DAYS = 1;

export interface SourcedValue<T> {
  value: T;
  /** 값을 읽은 문단. null이면 문서에서 읽지 못해 기본값을 쓴 것이다. */
  chunkId: string | null;
}

export interface ConfirmPolicy {
  businessDays: SourcedValue<number>;
}

export function readConfirmPolicy(chunks: Chunk[]): ConfirmPolicy {
  for (const c of chunks) {
    if (c.docId !== "V04") continue;
    const m = /입금을\s*확인하면\s*(\d{1,2})\s*영업일\s*안에/.exec(c.text);
    if (m) return { businessDays: { value: Number(m[1]), chunkId: c.chunkId } };
  }
  return { businessDays: { value: FALLBACK_CONFIRM_BUSINESS_DAYS, chunkId: null } };
}

export interface HandoverPolicy {
  /** 확인한 순간부터 인계까지(분). */
  handoverMinutes: SourcedValue<number> | null;
  /** 인계받은 의료진이 환자에게 직접 연락하는 목표(분). */
  contactMinutes: SourcedValue<number> | null;
  /** 진료일 담당("담당 간호사")과 휴진·진료시간 밖 담당("당직 의료진 연락망"). */
  roleOpen: SourcedValue<string> | null;
  roleClosed: SourcedValue<string> | null;
  /** 환자에게 보내는 승인 문구. 볼트 V12의 따옴표 안 문장 그대로. */
  patientMessage: SourcedValue<string> | null;
}

export function readHandoverPolicy(chunks: Chunk[]): HandoverPolicy {
  const v12 = chunks.filter((c) => c.docId === "V12");
  const find = <T>(re: RegExp, map: (m: RegExpExecArray) => T): SourcedValue<T> | null => {
    for (const c of v12) {
      const m = re.exec(c.text);
      if (m) return { value: map(m), chunkId: c.chunkId };
    }
    return null;
  };
  // 환자 안내 문구는 제목이 '고정 안내 문장'인 문단의 따옴표 안만 읽는다. 다른 문단의 따옴표를 잘못 집지 않게.
  const msgChunk = v12.find((c) => c.heading !== null && /고정\s*안내/.test(c.heading));
  const quoted = msgChunk ? /["“]([^"”]+)["”]/.exec(msgChunk.text) : null;
  return {
    handoverMinutes: find(/(\d{1,3})\s*분\s*안에\s*인계/, (m) => Number(m[1])),
    contactMinutes: find(/(\d{1,3})\s*분\s*안에\s*환자에게\s*직접\s*연락/, (m) => Number(m[1])),
    roleOpen: find(/진료일에는\s*그날\s*(.+?)에게/, (m) => m[1].trim()),
    roleClosed: find(/진료시간\s*밖에는\s*(.+?)(?:으로|로)\s*전화/, (m) => m[1].trim()),
    patientMessage: quoted && msgChunk ? { value: quoted[1].trim(), chunkId: msgChunk.chunkId } : null,
  };
}

/** 그날(KST 날짜)의 진료 시간. 휴진이면 null. 법정 공휴일 목록은 볼트에 없어 보지 않는다(docs/DETAILS.md 한계에 적음). */
export function openInterval(hours: Hours, year: number, month: number, day: number): { openMs: number; closeMs: number } | null {
  const base = kstToMs(year, month, day);
  const date = kstDate(base);
  if (hours.extraClosedDates.some((e) => e.date === date)) return null;
  const dowKo = DOW_KO[kstParts(base).dow];
  const d = hours.weekly.find((w) => w.day === dowKo);
  if (!d || !d.open || !d.close) return null;
  const [oh, om] = d.open.split(":").map(Number);
  const [ch, cm] = d.close.split(":").map(Number);
  return { openMs: kstToMs(year, month, day, oh, om), closeMs: kstToMs(year, month, day, ch, cm) };
}

export function isOpenAt(hours: Hours, ms: number): boolean {
  const p = kstParts(ms);
  const iv = openInterval(hours, p.year, p.month, p.day);
  return iv !== null && iv.openMs <= ms && ms < iv.closeMs;
}

/**
 * "입금을 확인하면 N영업일 안에 확정 연락"의 시한.
 * 해석: 받은 뒤에 **새로 시작하는** 진료일을 N번째까지 세고, 그날 진료 종료 시각을 시한으로 본다.
 * - 토 18:10(진료 끝난 뒤)·일요일에 받은 건 → 월요일 진료 종료
 * - 월 00:35(진료 시작 전)에 받은 건 → 월요일 진료 종료
 * - 월 11:00(진료 중)에 받은 건 → 화요일 진료 종료(받은 날은 이미 시작한 진료일이라 세지 않는다)
 * 이 해석은 규정 문장에서 바로 나오지 않는다. 원무팀에 물어볼 목록(PRD 9절)에 넣을 값이다.
 */
export function confirmDeadlineMs(hours: Hours, receivedMs: number, businessDays: number): number | null {
  let count = 0;
  const p = kstParts(receivedMs);
  // 60일 안에 진료일이 N번 안 나오면 진료시간 표가 이상한 것이다. 시한을 지어내지 않고 null.
  for (let i = 0; i < 60; i++) {
    const d = new Date(Date.UTC(p.year, p.month - 1, p.day + i));
    const iv = openInterval(hours, d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    if (!iv || iv.openMs <= receivedMs) continue;
    count++;
    if (count === businessDays) return iv.closeMs;
  }
  return null;
}
