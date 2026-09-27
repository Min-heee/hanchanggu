import { describe, expect, it } from "vitest";
import { checkMedication, parseMedicationConfig, type MedicationConfig } from "./medication";

const cfg: MedicationConfig = { terms: ["탈모약", "약을", "mg", "먹어도"], exclude: ["예약", "약속"] };

describe("parseMedicationConfig", () => {
  it("terms·exclude 문자열 배열만 받고, terms가 비면 거부한다", () => {
    expect(parseMedicationConfig({ terms: ["약을"], exclude: [] })).toEqual({ ok: true, config: { terms: ["약을"], exclude: [] } });
    expect(parseMedicationConfig({ terms: [], exclude: [] })).toEqual({ ok: false, error: "V17 terms가 비어 있습니다" });
    expect(parseMedicationConfig({ terms: ["약을"] }).ok).toBe(false);
    expect(parseMedicationConfig({ terms: ["약을", ""], exclude: [] }).ok).toBe(false);
    expect(parseMedicationConfig([]).ok).toBe(false);
  });
});

describe("checkMedication", () => {
  it("약 용량·복용 문의를 잡는다(공백·전각 무시)", () => {
    expect(checkMedication("탈모약 1ＭＧ 반으로 잘라 먹어도 돼요?", cfg)).toEqual({ decision: "handover", matchedTerms: ["탈모약", "mg", "먹어도"] });
  });

  it("제외어를 먼저 지운다: '예약을'·'약속을'의 '약을'은 약 문의가 아니다", () => {
    expect(checkMedication("예약을 바꾸고 약속을 잡을게요", cfg)).toEqual({ decision: "pass", matchedTerms: [] });
    expect(checkMedication("예약 약을 먹었어요", cfg).matchedTerms).toEqual(["약을"]);
    // 제외어를 지운 자리는 공백으로 남긴다. 그냥 지우면 앞뒤 글자가 붙어 없던 말("mg")이 생긴다.
    expect(checkMedication("m약속g", cfg).decision).toBe("pass");
  });

  it("목록은 입력 json을 따른다(하드코딩 없음)", () => {
    expect(checkMedication("연고 발라도 돼요?", cfg).decision).toBe("pass");
    expect(checkMedication("연고 발라도 돼요?", { terms: ["연고"], exclude: [] }).decision).toBe("handover");
  });
});
