import { describe, expect, it } from "vitest";
import { headingPostopRange, readPostopDay } from "./postop";

describe("readPostopDay — 문의의 경과일", () => {
  it.each([
    ["수술 9일째인데 고름이 나와요", 9, "수술 9일"],
    ["D+12예요. 이식부위가 벌게요", 12, "D+12"],
    ["d + 3 인데 부었어요", 3, "d + 3"],
    ["열흘째인데 이식한 곳이 뜨거워요", 10, "열흘째"],
    ["이식한 지 열흘인데 부위가 뜨겁고 누르면 아파요", 10, "열흘인데"],
    ["수술 받은 지 일주일 됐는데 볼록해요", 7, "일주일 됐"],
    ["이식 받은 지 3주 됐는데 빨개요", 21, "3주 됐"],
    ["어제 수술했는데 피가 배어 나와요", 1, "어제 수술"],
    ["수술하고 5일 지났는데 부어요", 5, "5일 지났"],
  ])("%s → %i", (text, days, found) => {
    expect(readPostopDay(text)).toEqual({ days, text: found });
  });

  it("'D+7 내원'·'D+7 경과 진료 예약'은 예약 이름이라 오늘의 경과일로 읽지 않는다", () => {
    expect(readPostopDay("수술하고 D+7 내원이 이번 주 목요일인데 토요일로 옮겨도 될까요?")).toBeNull();
    expect(readPostopDay("[D+7 경과 진료 예약] 요청사항: 감각이 없어요")).toBeNull();
  });

  it("숫자 없는 '주차'(주차장)·날짜·회차는 경과일이 아니다", () => {
    expect(readPostopDay("주차 몇 시간 무료예요?")).toBeNull();
    expect(readPostopDay("두피 주사 4회차가 9월 29일(화)인데 옮기고 싶어요")).toBeNull();
    expect(readPostopDay("다음 주 목요일 상담이에요")).toBeNull();
  });

  it("둘 이상이면 먼저 나온 것", () => {
    expect(readPostopDay("D+7 내원 전인데 지금 D+5예요")?.days).toBe(5);
    expect(readPostopDay("열흘째인데, 수술 12일째라고 적어야 하나요")?.days).toBe(10);
  });
});

describe("headingPostopRange — 소제목의 날짜 구간", () => {
  it.each([
    ["수술 후 머리 감기(D+3~D+14)", { from: 3, to: 14 }],
    ["D+1 내원", { from: 1, to: 1 }],
    ["D+14 무렵", { from: 14, to: 14 }],
    ["4주 경과 진료", { from: 28, to: 28 }],
    ["6개월 경과 진료", { from: 180, to: 180 }],
    ["1년 경과 진료", { from: 365, to: 365 }],
  ])("%s", (h, r) => {
    expect(headingPostopRange(h)).toEqual(r);
  });

  it.each([["수술 당일 밤"], ["주사 당일"], ["첫 주 체크리스트"], ["두피 주사 회차 날짜 옮기기"], ["주차"]])("%s → 구간 없음", (h) => {
    expect(headingPostopRange(h)).toBeNull();
  });

  it("제목이 없으면 null", () => {
    expect(headingPostopRange(null)).toBeNull();
  });
});
