import { describe, expect, it } from "vitest";
import { composeOutgoing, fillTemplate, formatWon, parseHours, parsePriceList, renderHours, unitAlreadySaid, type Hours, type PriceItem } from "./template";
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
      text: `상담비는 10,000원이고 모당 3,000원입니다. 진료시간: ${"월–화 10:00–19:00 · 수 휴진 · 목–금 10:00–19:00 · 토 10:00–15:00 · 일 휴진 (월–화·목–금 점심시간 13:00–14:00) · 접수 마감은 진료 종료 30분 전 · 공휴일 휴진 · 임시 휴진: 2026-10-16(내부 교육)"}`,
      fills: [
        { placeholder: "{{price:consult}}", value: "10,000원", sourceDoc: "V03", key: "consult" },
        { placeholder: "{{ price:graft }}", value: "3,000원", sourceDoc: "V03", key: "graft" },
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

// 2회차 녹화(2026-09-29)의 실제 모델 문장. "모당 2,000원/모", "1회 120,000원/회", "30,000원/회을"이 나왔다.
describe("composeOutgoing — 단위 겹침·조사", () => {
  const P: PriceItem[] = [
    { key: "graft", label: "모발이식 모당 단가", price: 2000, unit: "모", note: null },
    { key: "injection", label: "두피 주사 1회", price: 120000, unit: "회", note: null },
    { key: "scalp-care", label: "두피 관리 1회", price: 80000, unit: "회", note: null },
    { key: "diagnosis", label: "정밀 진단", price: 50000, unit: "회", note: null },
    // 한 번만 받는 항목은 가격표에 단위가 없다(vault/price-list.md).
    { key: "deposit-consult", label: "첫 상담 예약금", price: 30000, unit: null, note: null },
  ];
  const fill = (t: string) => {
    const r = composeOutgoing(t, { prices: P, hours: null });
    if (!r.ok) throw new Error(r.errors.join());
    return r.text;
  };

  it.each([
    ["모발이식은 모당 {{price:graft}}이며 최소 500모부터 시술합니다.", "모발이식은 모당 2,000원이며 최소 500모부터 시술합니다."],
    ["두피 주사는 1회 {{price:injection}}입니다.", "두피 주사는 1회 120,000원입니다."],
    ["첫 상담을 예약할 때 예약금 {{price:deposit-consult}}을 받습니다.", "첫 상담을 예약할 때 예약금 30,000원을 받습니다."],
    // 모델이 받침 없는 값을 짐작해 "를"을 써도 값에 맞춘다.
    ["예약금 {{price:deposit-consult}}를 받습니다.", "예약금 30,000원을 받습니다."],
    ["주사는 회당 {{price:injection}}이고 매회 같습니다.", "주사는 회당 120,000원이고 매회 같습니다."],
  ])("%s", (input, want) => expect(fill(input)).toBe(want));

  it("단위 말이 없으면 '/단위'를 붙이고 조사를 받침 없는 쪽으로 맞춘다", () => {
    expect(fill("두피 관리 가격은 {{price:scalp-care}}입니다.")).toBe("두피 관리 가격은 80,000원/회입니다.");
    expect(fill("두피 관리는 {{price:scalp-care}}을 받습니다.")).toBe("두피 관리는 80,000원/회를 받습니다.");
    expect(fill("진단은 {{price:diagnosis}}으로 정해져 있습니다.")).toBe("진단은 50,000원/회로 정해져 있습니다.");
  });

  it("단위 말은 같은 절에서만 본다 — 앞 문장·앞 칸의 '1회'가 뒤 값의 단위를 지우지 않는다", () => {
    expect(fill("두피 주사는 1회 {{price:injection}}입니다. 관리는 {{price:scalp-care}}입니다.")).toBe("두피 주사는 1회 120,000원입니다. 관리는 80,000원/회입니다.");
    expect(fill("주사는 1회 {{price:injection}}, 진단은 {{price:diagnosis}}입니다.")).toBe("주사는 1회 120,000원, 진단은 50,000원/회입니다.");
  });

  it("앞 절에 다른 항목의 '회당·매회'가 있어도 이 값의 단위를 지우지 않는다(3차 적대 검증 U2·U4)", () => {
    expect(fill("두피 주사는 회당 약 10분이고 두피 관리는 {{price:scalp-care}}입니다.")).toBe("두피 주사는 회당 약 10분이고 두피 관리는 80,000원/회입니다.");
    expect(fill("매회 사진을 찍으며 정밀 진단은 {{price:diagnosis}}입니다.")).toBe("매회 사진을 찍으며 정밀 진단은 50,000원/회입니다.");
    expect(fill("주사는 회당, 진단은 {{price:diagnosis}}입니다.")).toBe("주사는 회당, 진단은 50,000원/회입니다.");
  });

  it("값 뒤 '이에요/예요'도 값에 맞춘다", () => {
    expect(fill("예약금은 {{price:deposit-consult}}예요.")).toBe("예약금은 30,000원이에요.");
    expect(fill("관리는 {{price:scalp-care}}이에요.")).toBe("관리는 80,000원/회예요.");
  });

  it("'10회'·'1회차'는 단위 말이 아니다", () => {
    expect(unitAlreadySaid("프로그램은 10회 진행하며 ", "회")).toBe(false);
    expect(unitAlreadySaid("1회차 ", "회")).toBe(false);
    expect(unitAlreadySaid("제1회 상담은 ", "회")).toBe(false);
    expect(unitAlreadySaid("두피 주사는 1회 ", "회")).toBe(true);
    expect(unitAlreadySaid("1회에 ", "회")).toBe(true);
    expect(unitAlreadySaid("모당 단가는 ", "모")).toBe(true);
    expect(unitAlreadySaid("모당 ", "1모")).toBe(true);
  });

  it("fills의 값은 문장에 들어간 값 그대로다(화면의 가격 칸과 보낸 글이 같게)", () => {
    const r = composeOutgoing("모당 {{price:graft}}, 단가 {{price:graft}}", { prices: P, hours: null });
    expect(r.ok && r.fills.map((f) => f.value)).toEqual(["2,000원", "2,000원/모"]);
    expect(r.ok && r.parts.map((p) => [p.text, p.fill?.key ?? null])).toEqual([
      ["모당 ", null],
      ["2,000원", "graft"],
      [", 단가 ", null],
      ["2,000원/모", "graft"],
    ]);
  });
});

describe("composeOutgoing — 볼트 링크", () => {
  const titles = new Map([
    ["booking-policy", "예약 규정"],
    ["handover-procedure", "의료진 인계 절차"],
  ]);
  const out = (t: string, audience: "patient" | "staff") => {
    const r = composeOutgoing(t, { prices: [], hours: null, links: { titles, audience } });
    if (!r.ok) throw new Error(r.errors.join());
    return r;
  };

  it("사내 Q&A(직원): 제목을 ‘ ’로 감싸고 조사를 제목에 맞춘다", () => {
    // G27 문장. "[[handover-procedure]]에"는 조사가 그대로, "([[booking-policy]])"는 ‘제목’으로.
    expect(out("인계 건은 [[handover-procedure]]에 따라 넘깁니다. 그다음 처리합니다([[booking-policy]]).", "staff").text).toBe(
      "인계 건은 ‘의료진 인계 절차’에 따라 넘깁니다. 그다음 처리합니다(‘예약 규정’).",
    );
    expect(out("[[booking-policy]]를 따릅니다.", "staff").text).toBe("‘예약 규정’을 따릅니다.");
  });

  it("환자 답장: 괄호 속 참고 표시는 괄호째 빼고, 문장 성분인 링크는 제목(따옴표 없이)으로", () => {
    // Q38 문장.
    const r = out("첫 상담은 예약제이며 예약 방법과 예약금은 [[booking-policy]]를 따릅니다. 확정 연락을 드립니다([[booking-policy]], [[handover-procedure]]).", "patient");
    expect(r.text).toBe("첫 상담은 예약제이며 예약 방법과 예약금은 예약 규정을 따릅니다. 확정 연락을 드립니다.");
    expect(r.links).toEqual(["booking-policy"]);
  });

  it("별칭이 있으면 별칭, 모르는 파일은 파일 이름(제목을 지어내지 않는다)", () => {
    expect(out("[[booking-policy|예약 안내]]를 보세요.", "patient").text).toBe("예약 안내를 보세요.");
    expect(out("[[없는-파일]]을 보세요.", "staff").text).toBe("‘없는-파일’을 보세요.");
  });

  it("환자 답장이 승인 문서가 아닌 문서(초안·옛 판)나 모르는 파일을 가리키면 보류한다 — 제목만으로도 미승인 내용이 샌다", () => {
    const withDraft = new Map([...titles, ["promo-draft", "가을 이벤트 안내 (초안, 미승인)"]]);
    const approved = new Set(["booking-policy", "handover-procedure"]);
    const r = composeOutgoing("승인되지 않은 문서([[promo-draft]] 같은 초안)의 가격은 안내하지 않습니다.", {
      prices: [],
      hours: null,
      links: { titles: withDraft, audience: "patient", approved },
    });
    expect(r).toEqual({ ok: false, errors: ["환자에게 보낼 글이 승인되지 않았거나 모르는 문서를 가리킵니다: promo-draft"] });
    // approved를 주지 않으면 제목을 아는 문서만 받는다(모르는 파일 이름이 그대로 나가지 않게).
    expect(composeOutgoing("[[nonexistent-doc]]을 보세요.", { prices: [], hours: null, links: { titles, audience: "patient" } }).ok).toBe(false);
    // 괄호 속 참고 표시는 빼므로 문제되지 않는다.
    expect(composeOutgoing("안내합니다([[promo-draft]]).", { prices: [], hours: null, links: { titles: withDraft, audience: "patient", approved } })).toMatchObject({ ok: true, text: "안내합니다." });
    // 직원 글은 막지 않는다(직원은 볼트를 볼 수 있다).
    expect(composeOutgoing("[[promo-draft]]는 미승인입니다.", { prices: [], hours: null, links: { titles: withDraft, audience: "staff", approved } }).ok).toBe(true);
  });

  it("fillTemplate(받는 사람 모름)은 링크를 건드리지 않는다", () => {
    expect(fillTemplate("[[booking-policy]]를 따릅니다.", [], null)).toEqual({ ok: true, text: "[[booking-policy]]를 따릅니다.", fills: [] });
  });
});
