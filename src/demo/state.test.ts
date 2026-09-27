import { describe, expect, it } from "vitest";
import { addGap, addLog, canSend, changedSentences, EMPTY_STATE, parseState, sentTargets, splitSentences, type LogEntry } from "./state";

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
    const s = addGap(addGap(EMPTY_STATE, { question: "주차 정산은요?", masked: 0, at: "t", reason: "r" }), { question: "주차  정산은요? ", masked: 0, at: "t", reason: "r" });
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

describe("저장값 읽기 — 틀린 필드만 비운다", () => {
  it("연락 시도가 배열이 아니면 그 필드만 비우고 나머지 기록은 살린다", () => {
    const raw = JSON.stringify({
      log: [{ seq: 1, target: "Q01", action: "연락 시도", by: "CS 직원", at: "t", detail: "1회째" }],
      contactAttempts: { Q01: "x" },
      handedOver: { Q06: "9/21(월) 10:00" },
      postopDays: { Q02: 3 },
      edits: {},
      gaps: [],
    });
    const s = parseState(raw);
    expect(s.contactAttempts).toEqual({});
    expect(s.log).toHaveLength(1);
    expect(s.handedOver).toEqual({ Q06: "9/21(월) 10:00" });
    expect(s.postopDays).toEqual({ Q02: 3 });
  });

  it("모양이 틀린 기록 줄(seq 없음, 모르는 행동)과 옛 판 문서 빈칸은 버린다 — 순번 계산이 NaN이 되지 않게", () => {
    const raw = JSON.stringify({
      log: [{ target: "Q01", action: "승인" }, { seq: 2, target: "Q01", action: "뭔가", by: "", at: "", detail: "" }, { seq: 3, target: "Q02", action: "승인", by: "CS 직원", at: "t", detail: "" }],
      gaps: [{ question: "옛 모양", at: "t", reason: "r" }, { question: "와이파이", masked: 0, at: "t", reason: "r" }],
    });
    const s = parseState(raw);
    expect(s.log.map((e) => e.seq)).toEqual([3]);
    expect(addLog(s, { target: "Q02", action: "수정", by: "CS 직원", at: "t", detail: "" }).log.at(-1)!.seq).toBe(4);
    expect(s.gaps.map((g) => g.question)).toEqual(["와이파이"]);
    expect(parseState("[1,2]")).toEqual(EMPTY_STATE);
  });
});

describe("모의 발송을 켤지(canSend)", () => {
  const T = "Q02";
  const draft = "안녕하세요. 모당 2,000원입니다.";
  const edited = "안녕하세요. 모당 2,000원이고 최소 500모입니다.";
  const log = (s: ReturnType<typeof addLog>, action: LogEntry["action"], text?: string) =>
    addLog(s, { target: T, action, by: "CS 직원", at: "t", detail: "", ...(text !== undefined ? { text } : {}) });

  it("승인 전에는 못 보낸다", () => {
    expect(canSend(EMPTY_STATE.log, T, draft, draft)).toEqual({ ok: false, reason: "not-approved" });
  });

  it("승인 → 보낼 수 있음", () => {
    const s = log(EMPTY_STATE, "승인", draft);
    expect(canSend(s.log, T, draft, draft)).toEqual({ ok: true });
  });

  it("승인 → 글 수정·저장 → 다시 승인하기 전엔 못 보낸다 → 다시 승인하면 보낸다", () => {
    let s = log(EMPTY_STATE, "승인", draft);
    s = log(s, "수정");
    expect(canSend(s.log, T, edited, edited)).toEqual({ ok: false, reason: "edited-after-approval" });
    s = log(s, "승인", edited);
    expect(canSend(s.log, T, edited, edited)).toEqual({ ok: true });
  });

  it("저장하지 않은 고친 글은 못 보낸다", () => {
    const s = log(EMPTY_STATE, "승인", draft);
    expect(canSend(s.log, T, edited, draft)).toEqual({ ok: false, reason: "unsaved" });
  });

  it("승인한 글과 저장된 글이 다르면(기록 없이 바뀐 경우) 못 보낸다", () => {
    const s = log(EMPTY_STATE, "승인", draft);
    expect(canSend(s.log, T, edited, edited)).toEqual({ ok: false, reason: "edited-after-approval" });
  });

  it("보낸 뒤에는 다시 승인하기 전까지 또 보내지 못한다", () => {
    let s = log(EMPTY_STATE, "승인", draft);
    s = log(s, "모의 발송", draft);
    expect(canSend(s.log, T, draft, draft)).toEqual({ ok: false, reason: "already-sent" });
    s = log(s, "승인", draft);
    expect(canSend(s.log, T, draft, draft)).toEqual({ ok: true });
  });

  it("다른 문의의 승인은 상관없다", () => {
    const s = addLog(EMPTY_STATE, { target: "Q03", action: "승인", by: "CS 직원", at: "t", detail: "", text: draft });
    expect(canSend(s.log, T, draft, draft).ok).toBe(false);
  });
});
