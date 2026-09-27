import { describe, expect, it } from "vitest";
import { addGap, addLog, changedSentences, EMPTY_STATE, parseState, sentTargets, splitSentences } from "./state";

describe("시연 상태(localStorage)", () => {
  it("깨진 값·다른 모양은 빈 상태로 시작한다", () => {
    expect(parseState(null)).toEqual(EMPTY_STATE);
    expect(parseState("{")).toEqual(EMPTY_STATE);
    expect(parseState('{"log":"x"}')).toEqual(EMPTY_STATE);
  });

  it("기록은 순번이 붙고, 모의 발송한 대상을 모은다", () => {
    let s = addLog(EMPTY_STATE, { target: "Q02", action: "승인", by: "CS 직원", at: "t", detail: "" });
    s = addLog(s, { target: "Q02", action: "모의 발송", by: "CS 직원", at: "t", detail: "복사" });
    expect(s.log.map((e) => e.seq)).toEqual([1, 2]);
    expect(sentTargets(s)).toEqual(new Set(["Q02"]));
    expect(parseState(JSON.stringify(s))).toEqual(s);
  });

  it("문서 빈칸은 같은 질문을 두 번 쌓지 않는다", () => {
    const s = addGap(addGap(EMPTY_STATE, { question: "주차 정산은요?", at: "t", reason: "r" }), { question: "주차  정산은요? ", at: "t", reason: "r" });
    expect(s.gaps).toHaveLength(1);
  });
});

describe("고친 문장 찾기(F13)", () => {
  it("문장 경계", () => {
    expect(splitSentences("안녕하세요.\n예약은 3.5시간 전까지 됩니다. 감사합니다!")).toEqual(["안녕하세요.", "예약은 3.5시간 전까지 됩니다.", "감사합니다!"]);
  });

  it("바뀐 문장만 전 → 후로", () => {
    const before = "안녕하세요. 첫 상담비는 30,000원입니다. 감사합니다.";
    const after = "안녕하세요. 첫 상담비는 30,000원이고 방문하면 상담비로 전환됩니다. 감사합니다.";
    expect(changedSentences(before, after)).toEqual([{ before: "첫 상담비는 30,000원입니다.", after: "첫 상담비는 30,000원이고 방문하면 상담비로 전환됩니다." }]);
  });

  it("추가·삭제", () => {
    expect(changedSentences("가. 나.", "가. 나. 다.")).toEqual([{ before: "", after: "다." }]);
    expect(changedSentences("가. 나. 다.", "가. 다.")).toEqual([{ before: "나.", after: "" }]);
    expect(changedSentences("가.", "가.")).toEqual([]);
  });
});
