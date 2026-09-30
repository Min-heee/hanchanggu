import { describe, expect, it } from "vitest";
import { verifyCitations } from "../core/citations";
import { buildSystemPrompt } from "./draft";

// 2회차 녹화(2026-09-29) 문장별 검토에서 나온 결함마다 시스템 지시에 막는 규칙이 있는지 본다.
// 스냅숏(draft.test.ts)은 -u 한 번에 다시 찍히므로, 규칙의 핵심 문장은 여기서 따로 고정한다.
describe("시스템 지시 — 2회차 녹화 결함", () => {
  const p = buildSystemPrompt("reply", ["consult"]);

  it("답장은 받는 사람(환자) 시점: 직원용 절차 문장은 인용하지 않고, 고쳐 쓰지 않고 빼기만 한다", () => {
    expect(p).toContain("inquiry 값(환자·고객 문의)에 답할 때 읽는 사람은 환자·고객입니다");
    expect(p).toContain("받는 사람에게 할 말이 아니므로 인용하지 마세요");
    expect(p).toContain("환자 시점으로 고쳐 쓰지도 말고 빼기만 하세요");
    // "…하도록 안내합니다"까지 막으면 볼트의 환자 안내 대부분을 못 쓰게 되어 오보류가 는다.
    expect(p).toContain("\"…하도록 안내합니다\"처럼 직원 시점으로만 적혀 있거나");
    // 사내 Q&A는 읽는 사람이 직원이다 — 같은 규칙 문구가 두 모드에 다 실리므로 규칙 안에서 모드를 가른다.
    expect(p).toContain("question 값(직원 질문)에 답할 때는 읽는 사람이 직원이므로 이 규칙을 적용하지 않습니다");
  });

  it("물음이 여럿이면 물음마다 답하고, 하나라도 답이 없으면 빼지 말고 초안 전체를 '[근거 없음]'으로 — 보류 재현율(8/8)이 안전 기준(3차 적대 검증)", () => {
    expect(p).toContain("물음마다 답이 되는 문서 문장을 찾아 인용하세요");
    expect(p).toContain("곁가지 문장은 답이 아닙니다");
    expect(p).toContain('물음 하나라도 답이 되는 문장이 문서에 없으면, 다른 물음에 답할 수 있어도 다른 말 없이 "[근거 없음]" 한 줄만 쓰세요');
    expect(p).toContain("답 없는 물음을 조용히 빼거나");
    // 옛 문구(답 없는 물음은 빼라)가 돌아오면 곁가지만 인용해 검증을 통과하는 초안이 생긴다.
    expect(p).not.toContain("추측하지 말고 빼세요");
  });

  it("직원 시점이어도 '의료진이 판단한다' 문장(규칙 4)은 인용한다 — 규칙 12의 예외", () => {
    expect(p).toContain("의료진이 판단·답한다고 적힌 문장(규칙 4)은 직원 시점이어도 인용하세요");
  });

  it("가격 칸은 그 금액이 적힌 문서 문장을 인용하는 문장 안에서만 쓴다", () => {
    expect(p).toContain("가격 자리표시자는 그 금액이 적힌 문서 문장을 인용하는 문장 안에서, 그 금액 자리에만 쓰세요");
    // 지시문에 실제 가격을 적지 않는다(예시도 N원).
    expect(p).not.toMatch(/\d{1,3},\d{3}원/);
  });

  it("부분 '[근거 없음]'은 검증기에서 인용 없는 문장이라 초안 전체를 보류시킨다 — 규칙 13이 그렇게 적는 까닭", () => {
    const docs = [{ docId: "V03", kind: "content" as const, blocks: [{ chunkId: "V03#1", text: "첫 상담비는 30,000원입니다." }] }];
    const cite = { type: "content_block_location", cited_text: "첫 상담비는 30,000원입니다.", document_index: 0, start_block_index: 0, end_block_index: 1 };
    const answered = verifyCitations([{ type: "text", text: "첫 상담비는 30,000원입니다.", citations: [cite] }], docs, new Set(["V03"]), { greetings: [], closings: [] });
    expect(answered.status).toBe("ok");
    const partial = verifyCitations(
      [
        { type: "text", text: "첫 상담비는 30,000원입니다.", citations: [cite] },
        { type: "text", text: "\n[근거 없음]", citations: null },
      ],
      docs,
      new Set(["V03"]),
      { greetings: [], closings: [] },
    );
    // 전체가 '[근거 없음]' 한 줄일 때만 no-evidence(문서 빈칸)다. 섞이면 uncited-sentence로 보류된다.
    expect(partial.status).toBe("hold");
    expect(partial.reasons.map((r) => r.code)).toEqual(["uncited-sentence"]);
  });

  it("날짜 표기를 인용하면 날짜 세는 기준(D+0) 문장도 함께 인용하게 하고, 계산은 여전히 막는다", () => {
    expect(p).toContain("날짜를 세는 기준 문장(예: \"날짜는 수술일을 D+0으로 셉니다\")이 문서에 있으면 그 문장도 함께 인용하세요");
    expect(p).toContain("D+몇인지는 계산하지 마세요(규칙 11)");
  });

  it("직원 질문이 증상·약을 다루면 인계 절차(누구에게·몇 분 안에) 문장을 인용하게 한다 — 3회차 G46 답에 '5분 안에 인계'가 빠졌다", () => {
    // 두 모드 규칙이 같아야 하므로(draft.test.ts) 사내 Q&A 지시에도, 답장 지시에도 같은 문장이 실린다.
    for (const mode of ["reply", "staff-qa"] as const) {
      const q = buildSystemPrompt(mode, []);
      expect(q).toContain("question 값(직원 질문)이 환자의 증상이나 약을 다루고");
      expect(q).toContain("인계 절차 문장(누구에게 넘기는지, 몇 분 안에 넘기는지)이 있으면 그 문장을 통째로 인용해 답에 넣으세요");
    }
    // 지시문에 시한 숫자를 박지 않는다 — 시한은 문서(V12)에서만 와야 문서가 바뀌면 답도 바뀐다.
    expect(p.slice(p.indexOf("15."))).not.toMatch(/\d+분/);
  });
});

describe("시스템 지시 — 인계 문의의 의료진 확인용 초안(PRD v0.3)", () => {
  const h = buildSystemPrompt("handover", ["consult"]);
  const tail = h.slice(h.indexOf("16. "));

  it("진단·판단·용량은 쓰지 않고, 되짚기 한 문장 + 고정 안내 문장 + 섞인 의료가 아닌 물음의 문서 인용 답 + 연락·내원 절차 — 직원 절차는 인용하지 않는다", () => {
    expect(tail).toContain("고정 안내 문장");
    expect(tail).toContain("되짚기 문장");
    expect(tail).toContain("의료가 아닌 물음");
    expect(tail).toContain("연락·내원 절차 안내");
    expect(tail).toContain("진단");
    expect(tail).toContain("원인 추정");
    expect(tail).toContain("용량");
    expect(tail).toContain("따옴표로 감싸지 말고");
    expect(tail).toContain("직원이 할 일");
    // 규칙 4(증상 해석·진단·치료 판단 금지)는 그대로 실린다.
    expect(h).toContain("4. 증상 해석, 진단, 치료 판단, 약 용량·중단·병용, 효과 보장은 쓰지 마세요.");
  });

  it("분 단위 시한·119·금액을 지시문에 박지 않는다 — 문서가 바뀌면 초안도 바뀌게", () => {
    expect(tail).not.toMatch(/\d+분/);
    expect(tail).not.toContain("119");
    expect(tail).not.toMatch(/\d{1,3},\d{3}원/);
  });
});
