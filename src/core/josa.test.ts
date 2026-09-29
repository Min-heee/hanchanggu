import { describe, expect, it } from "vitest";
import { finalSound, fixParticle } from "./josa";

describe("finalSound", () => {
  it.each([
    ["30,000원", "other"],
    ["30,000원/회", "none"],
    ["서울", "rieul"],
    ["‘가격표’", "none"],
    ["임시 휴진: 2026-10-16(내부 교육)", "other"],
    ["10:00", null],
  ] as const)("%s → %s", (v, want) => expect(finalSound(v)).toBe(want));
});

describe("fixParticle", () => {
  it("값 바로 뒤 조사를 끝소리에 맞춘다", () => {
    expect(fixParticle("30,000원", "를 받습니다")).toBe("을 받습니다");
    expect(fixParticle("30,000원/회", "을 받습니다")).toBe("를 받습니다");
    expect(fixParticle("30,000원/회", "은 같습니다")).toBe("는 같습니다");
    expect(fixParticle("30,000원", "가 듭니다")).toBe("이 듭니다");
    expect(fixParticle("예약 규정", "와 같습니다")).toBe("과 같습니다");
    expect(fixParticle("30,000원", "로 정합니다")).toBe("으로 정합니다");
    expect(fixParticle("30,000원/회", "으로도 됩니다")).toBe("로도 됩니다");
    expect(fixParticle("서울", "으로 갑니다")).toBe("로 갑니다");
  });

  it("서술격 조사·다른 말의 첫 글자는 건드리지 않는다", () => {
    expect(fixParticle("2,000원/모", "이며 최소")).toBe("이며 최소");
    expect(fixParticle("30,000원/회", "입니다.")).toBe("입니다.");
    expect(fixParticle("30,000원", "을까요")).toBe("을까요");
    expect(fixParticle("10:00", "을 넘기면")).toBe("을 넘기면");
    // "로" 뒤에 한글이 이어지면 조사 "로서/로는"이 아니라 다른 말일 수 있다(3차 적대 검증 "…규정로서울").
    expect(fixParticle("예약 규정", "로서울")).toBe("로서울");
    expect(fixParticle("예약 규정", "로서 ")).toBe("으로서 ");
  });

  it("'이에요/예요'를 받침에 맞춘다", () => {
    expect(fixParticle("30,000원", "예요.")).toBe("이에요.");
    expect(fixParticle("30,000원/회", "이에요.")).toBe("예요.");
  });
});
