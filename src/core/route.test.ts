import { describe, expect, it } from "vitest";
import { decideRoute, isShopChannel, parseChannelMap, parsePublicTemplates, type ChannelEntry, type LlmClassification } from "./route";
import { parseMedicationConfig, type MedicationConfig } from "./medication";
import { parseRedflagConfig, type RedflagConfig } from "./redflag";
import { activeJson, loadVault } from "./vault";
import { fixtureFiles } from "./__fixtures__/load";

function setup(): { channels: ChannelEntry[]; redflag: RedflagConfig; medication: MedicationConfig } {
  const v = loadVault(fixtureFiles());
  const c = activeJson(v, "V19");
  const r = activeJson(v, "V11");
  const m = activeJson(v, "V17");
  if (!c.ok || !r.ok || !m.ok) throw new Error("fixture");
  const channels = parseChannelMap(c.value);
  const redflag = parseRedflagConfig(r.value);
  const medication = parseMedicationConfig(m.value);
  if (!channels.ok || !redflag.ok || !medication.ok) throw new Error("fixture parse");
  return { channels: channels.channels, redflag: redflag.config, medication: medication.config };
}

const classified = (value: LlmClassification) => ({ status: "classified" as const, value });

describe("parseChannelMap", () => {
  it("V19 json을 읽는다", () => {
    expect(setup().channels).toEqual([
      { channel: "kakao", label: "카카오 채널", replyMode: "copy", note: "상담 도구에 붙여넣기", operator: null },
      { channel: "web_form", label: "web_form", replyMode: "callback", note: "전화로 답함", operator: null },
      { channel: "review", label: "플레이스 리뷰", replyMode: "template-only", note: "공개 답글", operator: null },
      { channel: "shop_qna", label: "쇼핑몰 문의 게시판", replyMode: "template-only", note: "별도 사업자", operator: null },
    ]);
  });

  it("답장 방식이 규격 밖이거나 창구가 겹치면 거부한다", () => {
    expect(parseChannelMap([{ channel: "kakao", replyMode: "auto-send" }])).toEqual({ ok: false, error: "V19 kakao: replyMode가 틀렸습니다(auto-send)" });
    expect(parseChannelMap([{ channel: "a", replyMode: "copy" }, { channel: "a", replyMode: "copy" }]).ok).toBe(false);
    expect(parseChannelMap([]).ok).toBe(false);
  });

  it("operator가 있으면 그것으로, 없으면 이름으로 쇼핑몰을 가린다", () => {
    expect(isShopChannel({ channel: "store", label: "store", replyMode: "copy", note: null, operator: "shop" })).toBe(true);
    expect(isShopChannel({ channel: "shop-qna", label: "x", replyMode: "copy", note: null, operator: "clinic" })).toBe(false);
    expect(isShopChannel({ channel: "shop-qna", label: "x", replyMode: "copy", note: null, operator: null })).toBe(true);
  });
});

describe("decideRoute — 순서가 안전장치다", () => {
  const { channels, redflag, medication } = setup();
  const base = { channels, redflag, medication };

  it("가림 → 규칙 통과 → 분류 단계 → (분류 뒤) 초안 경로", () => {
    const text = "김샘플님 예약을 목요일로 바꾸고 싶어요 010-1234-5678";
    const d = decideRoute({ ...base, channel: "kakao", text });
    expect(d.step).toBe("classify");
    expect(d.mask.masked).toBe("[이름]님 예약을 목요일로 바꾸고 싶어요 [전화]");
    expect(d.replyMode).toBe("copy");
    expect(d.trace).toEqual(["가림: 2곳", "적신호 규칙: 통과", "약 문의 규칙: 통과", "분류 단계로"]);
    const after = decideRoute({ ...base, channel: "kakao", text, llm: classified({ handover: false, category: "booking" }) });
    expect([after.step, after.trace.at(-1)]).toEqual(["draft", "초안 경로(분류: booking)"]);
  });

  it("분류가 실패하면 초안을 만들지 않고 보류한다(fail-closed)", () => {
    const d = decideRoute({ ...base, channel: "kakao", text: "예약 바꾸고 싶어요", llm: { status: "failed", reason: "호출 한도 초과(429)" } });
    expect([d.step, d.holdReason]).toEqual(["hold", "분류하지 못해 초안을 만들지 않습니다: 호출 한도 초과(429)"]);
  });

  it("분류가 실패해도 규칙이 건 인계는 그대로 인계다", () => {
    const d = decideRoute({ ...base, channel: "kakao", text: "D+9 고름", llm: { status: "failed", reason: "x" } });
    expect(d.step).toBe("handover");
  });

  it("약 문의 규칙(MED-01)은 분류 없이도 인계한다. '예약을'의 '약을'은 약 문의가 아니다", () => {
    const d = decideRoute({ ...base, channel: "kakao", text: "탈모약 1mg 반으로 잘라 먹어도 되나요?" });
    expect([d.step, d.merged.ruleIds, d.medication.matchedTerms]).toEqual(["handover", ["MED-01"], ["탈모약", "mg", "먹어도"]]);
    expect(decideRoute({ ...base, channel: "kakao", text: "예약을 바꾸고 약속을 잡고 싶어요" }).medication.decision).toBe("pass");
  });

  it("약 문의 규칙도 가리기 전 원문에 돈다('탈모약님'처럼 약 이름이 이름으로 가려져도 잡는다)", () => {
    const d = decideRoute({ ...base, channel: "kakao", text: "탈모약님 반으로 잘라도 되나요" });
    expect(d.mask.masked).toBe("[이름]님 반으로 잘라도 되나요");
    expect(d.step).toBe("handover");
  });

  it("분류가 medication이면 handover:false라고 해도 인계한다(모순된 분류)", () => {
    const d = decideRoute({ ...base, channel: "kakao", text: "이거 계속 써도 되나요", llm: classified({ handover: false, category: "medication" }) });
    expect([d.step, d.merged.source]).toEqual(["handover", "llm"]);
  });

  it("적신호는 창구보다 먼저다: 공개 리뷰의 증상도 인계로 가고 답장은 고정 문구만", () => {
    const d = decideRoute({ ...base, channel: "review", text: "수술 후 이식 부위에 고름이 나는데 답이 없네요" });
    expect([d.step, d.replyMode, d.redflag.ruleIds]).toEqual(["handover", "template-only", ["RF-01"]]);
  });

  it("공개 창구는 고정 문구", () => {
    expect(decideRoute({ ...base, channel: "review", text: "친절했어요" }).step).toBe("public-template");
  });

  it("쇼핑몰 창구는 (template-only여도) 연결 안내, 다른 창구라도 LLM이 shop으로 분류하면 연결 안내", () => {
    expect(decideRoute({ ...base, channel: "shop_qna", text: "샴푸 배송 언제 와요?" }).step).toBe("shop-redirect");
    expect(
      decideRoute({ ...base, channel: "kakao", text: "샴푸 배송 언제 와요?", llm: classified({ handover: false, category: "shop" }) }).step,
    ).toBe("shop-redirect");
  });

  it("쇼핑몰 문의라도 증상이 있으면 인계가 이긴다", () => {
    expect(decideRoute({ ...base, channel: "shop_qna", text: "샴푸 쓰고 열이 나요" }).step).toBe("handover");
  });

  it("공개 리뷰에 쇼핑몰 이야기가 있어도(분류 shop) 공개 창구 규칙이 먼저다", () => {
    expect(decideRoute({ ...base, channel: "review", text: "샴푸 좋아요", llm: classified({ handover: false, category: "shop" }) }).step).toBe("public-template");
  });

  it("LLM은 인계 쪽으로만 바꾼다: 규칙 통과 + LLM 인계 → 인계", () => {
    const d = decideRoute({ ...base, channel: "kakao", text: "머리가 욱신거려요", llm: classified({ handover: true, category: "postop", reason: "통증" }) });
    expect([d.step, d.merged.source]).toEqual(["handover", "llm"]);
  });

  it("규칙 인계는 LLM이 풀 수 없다", () => {
    const d = decideRoute({ ...base, channel: "kakao", text: "D+9 고름", llm: classified({ handover: false, category: "booking" }) });
    expect([d.step, d.merged.source]).toEqual(["handover", "rule"]);
  });

  it("창구 지도에 없는 창구는 추측하지 않고 보류", () => {
    const d = decideRoute({ ...base, channel: "fax", text: "예약 문의" });
    expect([d.step, d.holdReason]).toEqual(["hold", "창구 지도에 없는 창구입니다: fax"]);
  });

  it("적신호 게이트는 가리기 전 원문에 돈다(가림이 증상어를 지우지 않게)", () => {
    // '고름님'처럼 증상어 뒤에 님이 붙어 이름으로 가려져도 원문에서 잡힌다.
    const d = decideRoute({ ...base, channel: "kakao", text: "수술 후 고름님" });
    expect(d.mask.masked).toBe("수술 후 [이름]님");
    expect(d.step).toBe("handover");
  });
});

describe("parsePublicTemplates", () => {
  it("key·text 배열만 받는다", () => {
    expect(parsePublicTemplates([{ key: "a", text: "감사합니다." }])).toEqual({ ok: true, templates: [{ key: "a", text: "감사합니다." }] });
    expect(parsePublicTemplates([{ key: "a" }]).ok).toBe(false);
    expect(parsePublicTemplates([]).ok).toBe(false);
  });
});
