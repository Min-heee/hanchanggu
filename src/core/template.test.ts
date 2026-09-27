import { describe, expect, it } from "vitest";
import { fillTemplate, formatWon, parseHours, parsePriceList, renderHours, type Hours, type PriceItem } from "./template";
import { activeJson, loadVault } from "./vault";
import { fixtureFiles } from "./__fixtures__/load";

function fromVault(): { prices: PriceItem[]; hours: Hours } {
  const v = loadVault(fixtureFiles());
  const p = activeJson(v, "V03");
  const h = activeJson(v, "V02");
  if (!p.ok || !h.ok) throw new Error("fixture");
  const prices = parsePriceList(p.value);
  const hours = parseHours(h.value);
  if (!prices.ok || !hours.ok) throw new Error("fixture parse");
  return { prices: prices.value, hours: hours.value };
}

describe("formatWon", () => {
  it.each([
    [0, "0"],
    [999, "999"],
    [1000, "1,000"],
    [1234567, "1,234,567"],
  ])("%d → %s", (n, s) => expect(formatWon(n)).toBe(s));
});

describe("parsePriceList", () => {
  it("V03 json을 읽는다", () => {
    expect(fromVault().prices).toEqual([
      { key: "consult", label: "상담비", price: 10000, unit: null, note: null },
      { key: "graft", label: "모당 단가", price: 3000, unit: "1모", note: "가상 값" },
      { key: "injection", label: "두피 주사 1회", price: 50000, unit: "1회", note: null },
    ]);
  });

  it("가격이 정수가 아니거나 키가 겹치면 거부한다", () => {
    expect(parsePriceList([{ key: "a", label: "A", price: "상담 후" }]).ok).toBe(false);
    expect(parsePriceList([{ key: "a", label: "A", price: 1.5 }]).ok).toBe(false);
    expect(parsePriceList([{ key: "a", label: "A", price: 1 }, { key: "a", label: "B", price: 2 }])).toEqual({ ok: false, error: "V03 key가 겹칩니다: a" });
    expect(parsePriceList({}).ok).toBe(false);
  });
});

describe("parseHours / renderHours", () => {
  it("객체형 weekly(null=휴진)와 점심·접수 마감·휴진·임시 휴진을 읽어 한 줄로 쓴다", () => {
    expect(renderHours(fromVault().hours)).toBe("월–화 10:00–19:00 · 수 휴진 · 목–금 10:00–19:00 · 토 10:00–15:00 · 일 휴진 (월–화·목–금 점심시간 13:00–14:00) · 접수 마감은 진료 종료 30분 전 · 공휴일 휴진 · 임시 휴진: 2026-10-16(내부 교육)");
  });

  it("배열형 weekly와 영문·한글 요일 키를 모두 받는다", () => {
    const weekly = ["mon", "화", "wed", "thu", "fri", "sat", "sun"].map((day) => ({ day, open: "09:00", close: "18:00" }));
    const r = parseHours({ weekly });
    expect(r.ok && renderHours(r.value)).toBe("월–일 09:00–18:00");
  });

  it("요일이 빠지면 휴진으로 추정하지 않고 거부한다", () => {
    const weekly = ["월", "화", "수", "목", "금", "토"].map((day) => ({ day, open: "09:00", close: "18:00" }));
    expect(parseHours({ weekly })).toEqual({ ok: false, error: "V02 요일이 빠졌습니다: 일" });
  });

  it("시간 형식이 틀리거나 여는 시각이 늦으면 거부한다", () => {
    expect(parseHours({ weekly: [{ day: "월", open: "9시", close: "18:00" }] }).ok).toBe(false);
    expect(parseHours({ weekly: [{ day: "월", open: "19:00", close: "18:00" }] }).ok).toBe(false);
  });

  it("closed의 요일이 weekly와 어긋나거나 모르는 휴진 토큰이면 거부한다", () => {
    const weekly = Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, { open: "09:00", close: "18:00" }]));
    expect(parseHours({ weekly, closed: ["sun"] })).toEqual({ ok: false, error: "V02 closed와 weekly가 어긋납니다(일: closed에는 휴진, weekly에는 진료)" });
    expect(parseHours({ weekly, closed: ["lunar-new-year"] })).toEqual({ ok: false, error: "V02 closed 값을 알 수 없습니다: lunar-new-year" });
  });
});

describe("fillTemplate", () => {
  const { prices, hours } = fromVault();

  it("가격·진료시간 자리표시자를 볼트 값으로 채우고 출처를 기록한다", () => {
    const r = fillTemplate("상담비는 {{price:consult}}이고 모당 {{ price:graft }}입니다. 진료시간: {{hours}}", prices, hours);
    expect(r).toEqual({
      ok: true,
      text: `상담비는 10,000원이고 모당 3,000원/1모입니다. 진료시간: ${"월–화 10:00–19:00 · 수 휴진 · 목–금 10:00–19:00 · 토 10:00–15:00 · 일 휴진 (월–화·목–금 점심시간 13:00–14:00) · 접수 마감은 진료 종료 30분 전 · 공휴일 휴진 · 임시 휴진: 2026-10-16(내부 교육)"}`,
      fills: [
        { placeholder: "{{price:consult}}", value: "10,000원", sourceDoc: "V03", key: "consult" },
        { placeholder: "{{ price:graft }}", value: "3,000원/1모", sourceDoc: "V03", key: "graft" },
        { placeholder: "{{hours}}", value: expect.stringContaining("월–화"), sourceDoc: "V02", key: null },
      ],
    });
  });

  it("없는 키는 추측하지 않고 오류로 돌려준다", () => {
    expect(fillTemplate("주차비는 {{price:parking}}입니다.", prices, hours)).toEqual({ ok: false, errors: ["가격표에 없는 키입니다: parking"] });
  });

  it("모르는 자리표시자·값 소스 없음·닫히지 않은 괄호는 오류", () => {
    expect(fillTemplate("{{doctor}}", prices, hours)).toEqual({ ok: false, errors: ["알 수 없는 자리표시자입니다: {{doctor}}"] });
    expect(fillTemplate("{{hours}}", prices, null)).toEqual({ ok: false, errors: ["진료시간(V02)이 없어 {{hours}}를 채울 수 없습니다"] });
    expect(fillTemplate("상담비 {{price:consult", prices, hours)).toEqual({ ok: false, errors: ["닫히지 않은 자리표시자가 남았습니다"] });
  });

  it("자리표시자가 없으면 그대로 통과", () => {
    expect(fillTemplate("예약 변경은 전날까지 가능합니다.", prices, hours)).toEqual({ ok: true, text: "예약 변경은 전날까지 가능합니다.", fills: [] });
  });
});
