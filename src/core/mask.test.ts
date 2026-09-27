import { describe, expect, it } from "vitest";
import { maskPii } from "./mask";

describe("maskPii — 전화번호", () => {
  it.each([
    ["010-1234-5678", "[전화]"],
    ["010 1234 5678", "[전화]"],
    ["010.1234.5678", "[전화]"],
    ["01012345678", "[전화]"],
    ["011-123-4567", "[전화]"],
    ["+82 10-1234-5678", "[전화]"],
    ["02-123-4567", "[전화]"],
    ["02 123 4567", "[전화]"],
    ["031.123.4567", "[전화]"],
    ["0507-1234-5678", "[전화]"],
    ["010 - 1234 - 5678", "[전화]"],
    ["010)1234-5678", "[전화]"],
    ["０１０-１２３４-５６７８", "[전화]"],
  ])("%s → %s", (input, expected) => {
    expect(maskPii(`연락처 ${input} 입니다`).masked).toBe(`연락처 ${expected} 입니다`);
  });

  it("구분자 없는 긴 숫자(가격 등)는 전화로 보지 않는다", () => {
    expect(maskPii("상담비 30000원, 주문번호 2026092812345").masked).toBe("상담비 30000원, 주문번호 2026092812345");
  });
});

describe("maskPii — 이메일·주민번호", () => {
  it("이메일을 가린다", () => {
    expect(maskPii("메일은 sample.user+qa@example.co.kr 로 주세요").masked).toBe("메일은 [이메일] 로 주세요");
  });

  it("주민번호 형식을 가리고, 전화보다 먼저 판정한다", () => {
    const r = maskPii("주민번호 900101-1234567 확인 부탁");
    expect(r.masked).toBe("주민번호 [주민번호] 확인 부탁");
    expect(r.items).toEqual([{ kind: "rrn", original: "900101-1234567", start: 5, end: 19 }]);
  });
});

describe("maskPii — '○○님' 호칭", () => {
  it("이름+님은 이름만 가리고 '님'은 남긴다", () => {
    expect(maskPii("김샘플님 예약 변경 부탁드려요").masked).toBe("[이름]님 예약 변경 부탁드려요");
    expect(maskPii("김OO님, 김○○ 님").masked).toBe("[이름]님, [이름] 님");
  });

  it("호칭·관계어(고객님, 원장님, 어머님 등)는 가리지 않는다", () => {
    const text = "고객님 안녕하세요. 원장님께 여쭤볼게요. 어머님이 대신 문의합니다. 간호사님 감사합니다.";
    expect(maskPii(text).masked).toBe(text);
  });

  it("앞에 한글이 붙어 있어도 가린다(fail-closed) — 끝의 세 글자만", () => {
    expect(maskPii("안녕하세요홍길동님").masked).toBe("안녕하세요[이름]님");
    // 끝이 호칭이면 이름이 아니다.
    expect(maskPii("담당선생님께 여쭤볼게요").items).toEqual([]);
  });

  it("호칭 앞의 이름('홍길동 고객님')과 '씨'를 가린다. '마음씨'는 이름이 아니다", () => {
    expect(maskPii("홍길동 고객님 예약 확인요").masked).toBe("[이름] 고객님 예약 확인요");
    expect(maskPii("김철수씨 예약, 이영희 씨도").masked).toBe("[이름]씨 예약, [이름] 씨도");
    expect(maskPii("마음씨가 좋네요").items).toEqual([]);
  });
});

describe("maskPii — 폼 칸·생년월일·가명 표기", () => {
  it("폼의 이름·주소 칸을 가린다(칸 이름과 구분자는 남긴다)", () => {
    expect(maskPii("이름: 박가명 / 주소: 서울시 가상구 샘플로 1, 101동 / 문의: 예약").masked).toBe("이름: [이름] / 주소: [주소] / 문의: 예약");
  });

  it("생년월일 표현을 가린다", () => {
    expect(maskPii("1990년 1월 1일생이고 아버지는 1960년생").masked).toBe("[생년월일]이고 아버지는 [생년월일]");
    expect(maskPii("생년월일: 1990.01.01").masked).toBe("[생년월일]");
  });

  it("가명 표기(김OO)는 어디에 있든 가린다", () => {
    expect(maskPii("김OO이고 보호자 이○○입니다").masked).toBe("[이름]이고 보호자 [이름]입니다");
  });
});

describe("maskPii — 목록과 위치", () => {
  it("가린 목록은 원문 위치 순서이고, 원문 slice와 original이 같다", () => {
    const text = "박가명님 010-1111-2222, a@b.com";
    const r = maskPii(text);
    expect(r.masked).toBe("[이름]님 [전화], [이메일]");
    expect(r.items.map((i) => i.kind)).toEqual(["name", "phone", "email"]);
    for (const i of r.items) expect(text.slice(i.start, i.end)).toBe(i.original);
  });

  it("가릴 것이 없으면 원문 그대로다", () => {
    expect(maskPii("수술 후 3일째인데 머리 감아도 되나요?")).toEqual({ masked: "수술 후 3일째인데 머리 감아도 되나요?", items: [] });
  });
});
