import { describe, expect, it } from "vitest";
import {
  citedOverlap,
  koreanNumeralsToDigits,
  NO_EVIDENCE_MARKER,
  parseToneConfig,
  plainTextLayout,
  verifyCitations,
  type ModelTextBlock,
  type SentDocument,
  type ToneConfig,
} from "./citations";

const V07: SentDocument = {
  docId: "V07",
  kind: "content",
  blocks: [
    { chunkId: "V07#0", text: "수술 다음 날 내원해 첫 세척을 받습니다." },
    { chunkId: "V07#1", text: "D+3부터 가볍게 머리를 감을 수 있습니다." },
    { chunkId: "V07#2", text: "이상하면 의원으로 연락합니다." },
  ],
};
const V04: SentDocument = {
  docId: "V04",
  kind: "content",
  blocks: [{ chunkId: "V04#1", text: "예약금은 방문 2일 전까지 취소하면 전액 환불합니다." }],
};
const DOCS = [V07, V04];
const ALLOWED = new Set(["V07", "V04"]);
const TONE: ToneConfig = { greetings: ["안녕하세요, 샘플의원입니다."], closings: ["감사합니다."] };

const cite = (document_index: number, s: number, e: number, cited_text: string) => ({
  type: "content_block_location",
  cited_text,
  document_index,
  start_block_index: s,
  end_block_index: e,
});
const t = (text: string, citations: ModelTextBlock["citations"] = null): ModelTextBlock => ({ type: "text", text, citations });

describe("parseToneConfig", () => {
  it("greetings·closings 문자열 배열만 받는다", () => {
    expect(parseToneConfig({ greetings: ["a"], closings: ["b"] })).toEqual({ ok: true, config: { greetings: ["a"], closings: ["b"] } });
    expect(parseToneConfig({ greetings: ["a"] }).ok).toBe(false);
    expect(parseToneConfig({ greetings: [""], closings: [] }).ok).toBe(false);
  });
});

describe("verifyCitations — 통과", () => {
  it("인사(허용 목록) + 인용 문장 + 맺음(허용 목록)은 ok", () => {
    const r = verifyCitations(
      [
        t("안녕하세요, 샘플의원입니다.\n"),
        t("D+3부터는 가볍게 머리를 감으셔도 됩니다.", [cite(0, 1, 2, "D+3부터 가볍게 머리를 감을 수 있습니다.")]),
        t("\n감사합니다"),
      ],
      DOCS,
      ALLOWED,
      TONE,
    );
    expect(r.status).toBe("ok");
    expect(r.reasons).toEqual([]);
    expect(r.sentences.map((s) => [s.text, s.kind])).toEqual([
      ["안녕하세요, 샘플의원입니다.", "allowlisted"],
      ["D+3부터는 가볍게 머리를 감으셔도 됩니다.", "cited"],
      ["감사합니다", "allowlisted"],
    ]);
    expect(r.sentences[1].citations).toEqual([{ docId: "V07", chunkIds: ["V07#1"], citedText: "D+3부터 가볍게 머리를 감을 수 있습니다." }]);
  });

  it("여러 블록을 이어 인용해도(end 배타) 공백만 다르면 일치로 본다", () => {
    const joined = "수술 다음 날 내원해 첫 세척을 받습니다.D+3부터 가볍게 머리를   감을 수 있습니다.";
    const r = verifyCitations([t("내원 후 세척하고 D+3부터 감습니다.", [cite(0, 0, 2, joined)])], DOCS, ALLOWED, TONE);
    expect(r.status).toBe("ok");
    expect(r.sentences[0].citations[0].chunkIds).toEqual(["V07#0", "V07#1"]);
  });

  it("짧은 이음말(문자 6자 이하)은 인용 문장 안에서 허용한다", () => {
    const r = verifyCitations(
      [t("네, 환불은 "), t("방문 2일 전까지 취소하면 전액 환불됩니다.", [cite(1, 0, 1, "예약금은 방문 2일 전까지 취소하면 전액 환불합니다.")])],
      DOCS,
      ALLOWED,
      TONE,
    );
    expect(r.status).toBe("ok");
  });

  it("자리표시자 문장은 허용 틀('…는 {{…}}입니다')이면 인용이 없어도 'template'으로 허용한다", () => {
    for (const text of ["상담비는 {{price:consult}}입니다.", "진료시간은 {{hours}}입니다", "상담비는 {{price:consult}}, 진단비는 {{price:diagnosis}}입니다.", "{{hours}}"]) {
      const r = verifyCitations([t(text)], DOCS, ALLOWED, TONE);
      expect([text, r.status, r.sentences[0].kind]).toEqual([text, "ok", "template"]);
    }
  });
});

describe("verifyCitations — 보류", () => {
  it("인용 없는 문장(허용 목록 밖)은 막는다", () => {
    const r = verifyCitations([t("주차는 건물 지하에 무료로 가능합니다.")], DOCS, ALLOWED, TONE);
    expect(r.status).toBe("hold");
    expect(r.reasons).toEqual([{ code: "uncited-sentence", sentenceIndex: 0, detail: '인용 없는 문장: "주차는 건물 지하에 무료로 가능합니다."' }]);
  });

  it("cited_text가 원문과 한 글자라도 다르면 보류(옛 버전 문구를 인용한 척하는 경우)", () => {
    const r = verifyCitations(
      [t("1일 전까지 취소하면 환불됩니다.", [cite(1, 0, 1, "예약금은 방문 1일 전까지 취소하면 전액 환불합니다.")])],
      DOCS,
      ALLOWED,
      TONE,
    );
    expect(r.status).toBe("hold");
    expect(r.reasons.map((x) => x.code)).toEqual(["invalid-citation"]);
    expect(r.reasons[0].detail).toBe("V04: 인용문이 원문과 다릅니다");
  });

  it("보내지 않은 문서 번호, 범위 밖 블록, 승인 목록 밖 문서는 모두 잘못된 인용", () => {
    const bad = [
      cite(5, 0, 1, "x"),
      cite(0, 2, 4, "이상하면 의원으로 연락합니다."),
      cite(0, 1, 1, ""),
    ];
    const r = verifyCitations([t("문장입니다.", bad)], DOCS, ALLOWED, TONE);
    expect(r.reasons.map((x) => x.detail)).toEqual([
      "보내지 않은 문서 번호를 인용했습니다(5)",
      "V07: 블록 범위가 틀렸습니다(2–4)",
      "V07: 블록 범위가 틀렸습니다(1–1)",
    ]);
    const r2 = verifyCitations([t("연락합니다.", [cite(0, 2, 3, "이상하면 의원으로 연락합니다.")])], DOCS, new Set(["V04"]), TONE);
    expect(r2.reasons.map((x) => x.detail)).toEqual(["승인 목록에 없는 문서를 인용했습니다(V07)"]);
  });

  it("인용 문장 속 숫자가 인용 원문에 없으면 보류(가격·날짜 환각)", () => {
    const r = verifyCitations(
      [t("방문 3일 전까지 취소하면 전액 환불됩니다.", [cite(1, 0, 1, "예약금은 방문 2일 전까지 취소하면 전액 환불합니다.")])],
      DOCS,
      ALLOWED,
      TONE,
    );
    expect(r.reasons).toEqual([{ code: "unsupported-number", sentenceIndex: 0, detail: "인용한 원문에 없는 숫자: 3" }]);
  });

  it("인용 문장 안의 이음말이 6자를 넘으면 보류(여기선 22자)", () => {
    const r = verifyCitations(
      [
        t("참고로 주차는 지하 2층에서 모두 무료로 하실 수 있고 "),
        t("D+3부터 머리를 감을 수 있습니다.", [cite(0, 1, 2, "D+3부터 가볍게 머리를 감을 수 있습니다.")]),
      ],
      DOCS,
      ALLOWED,
      TONE,
    );
    expect(r.reasons.map((x) => x.code)).toEqual(["uncited-tail", "unsupported-number"]);
  });

  it("이음말이 정확히 6자면 통과, 7자면 보류(경계값, 공백·문장부호는 세지 않는다)", () => {
    const at = (glue: string) =>
      verifyCitations([t(glue), t("머리를 감을 수 있습니다.", [cite(0, 1, 2, "D+3부터 가볍게 머리를 감을 수 있습니다.")])], DOCS, ALLOWED, TONE);
    expect(at("가나, 다라 마바 ").status).toBe("ok");
    expect(at("가나, 다라 마바사 ").reasons.map((x) => x.code)).toEqual(["uncited-tail"]);
  });

  it("인용 블록에 인용 없는 절을 붙이면 보류(C3: '…되고, 음주·사우나도 바로 괜찮습니다')", () => {
    const r = verifyCitations(
      [
        t("머리는 가볍게 감으셔도 되고", [cite(0, 1, 2, "D+3부터 가볍게 머리를 감을 수 있습니다.")]),
        t(", 음주·사우나도 바로 괜찮습니다."),
      ],
      DOCS,
      ALLOWED,
      TONE,
    );
    expect(r.reasons.map((x) => x.code)).toEqual(["uncited-tail"]);
  });

  it("자리표시자를 방패로 쓴 무인용 문장은 보류(C3)", () => {
    for (const text of ["상담비는 {{price:consult}}이고 부작용 걱정 없습니다.", "{{hours}} 사이 오시면 당일 수술 가능합니다."]) {
      const r = verifyCitations([t(text)], DOCS, ALLOWED, TONE);
      expect([text, r.sentences[0].kind, r.reasons.map((x) => x.code)]).toEqual([text, "uncited", ["uncited-sentence"]]);
    }
  });

  it("인용 원문과 겹치는 말이 적은 문장은 보류(M1: 인용만 붙이고 딴말)", () => {
    const r = verifyCitations([t("사우나와 음주도 바로 하셔도 됩니다.", [cite(0, 1, 2, "D+3부터 가볍게 머리를 감을 수 있습니다.")])], DOCS, ALLOWED, TONE);
    expect(r.reasons.map((x) => x.code)).toEqual(["low-overlap"]);
  });

  it("겹침 비율은 문장 2-gram 중 원문에도 있는 비율이다(손 계산)", () => {
    // "머리 감기요 네" → 머리·리감·감기·기요·요네(5개), 원문 "머리를 감기" → 머리·리를·를감·감기 → 겹침 2/5.
    expect(citedOverlap("머리 감기요 네", "머리를 감기")).toBeCloseTo(2 / 5, 10);
    // 2-gram이 4개보다 적으면 재지 않는다.
    expect(citedOverlap("네 좋아요", "x")).toBeNull();
  });

  it("한글로 쓴 수도 숫자 대조를 받는다(M2: '이틀째'가 D+3 인용을 달고 통과하지 않게)", () => {
    const r = verifyCitations([t("수술 후 이틀째부터 가볍게 머리를 감을 수 있습니다.", [cite(0, 1, 2, "D+3부터 가볍게 머리를 감을 수 있습니다.")])], DOCS, ALLOWED, TONE);
    expect(r.reasons).toEqual([{ code: "unsupported-number", sentenceIndex: 0, detail: "인용한 원문에 없는 숫자: 2" }]);
    expect(koreanNumeralsToDigits("일주일 뒤 하루 세 번, 세척은 열흘째")).toBe("7일 뒤 1일 3번, 세척은 10일째");
  });

  it("예전 상한(20자)에서 통과하던 20자 이음말은 이제 보류", () => {
    const r = verifyCitations(
      [
        t("가나다라마바사아자차카타파하가나다라마바 "),
        t("머리를 감을 수 있습니다.", [cite(0, 1, 2, "D+3부터 가볍게 머리를 감을 수 있습니다.")]),
      ],
      DOCS,
      ALLOWED,
      TONE,
    );
    expect(r.reasons.map((x) => x.code)).toEqual(["uncited-tail"]);
  });

  it("자리표시자 문장에 숫자를 직접 쓰면 보류(틀 밖이라 무인용 문장으로 막힌다)", () => {
    const r = verifyCitations([t("상담비는 {{price:consult}}, 주사는 5만원입니다.")], DOCS, ALLOWED, TONE);
    expect(r.reasons.map((x) => x.code)).toEqual(["uncited-sentence"]);
  });

  it("틀처럼 보여도 주어에 숫자가 섞이면 틀 밖(무인용 문장)이다", () => {
    const r = verifyCitations([t("상담비(1회)는 {{price:consult}}입니다.")], DOCS, ALLOWED, TONE);
    expect(r.reasons.map((x) => x.code)).toEqual(["uncited-sentence"]);
  });

  it("틀의 앞 조각(주어+조사)은 13자까지, 14자면 틀 밖(경계값)", () => {
    expect(verifyCitations([t("가나다라마바사아자차카타는 {{hours}}입니다.")], DOCS, ALLOWED, TONE).status).toBe("ok");
    expect(verifyCitations([t("가나다라마바사아자차카타파는 {{hours}}입니다.")], DOCS, ALLOWED, TONE).status).toBe("hold");
  });

  it("빈 답과 '근거 없음' 표시는 각각 보류 사유가 다르다", () => {
    expect(verifyCitations([t("  \n")], DOCS, ALLOWED, TONE).reasons.map((x) => x.code)).toEqual(["empty"]);
    expect(verifyCitations([t(NO_EVIDENCE_MARKER)], DOCS, ALLOWED, TONE).reasons.map((x) => x.code)).toEqual(["no-evidence"]);
  });

  it("허용 목록 비교는 끝 문장부호·공백만 무시한다(내용이 다르면 막는다)", () => {
    expect(verifyCitations([t("감사합니다!!")], DOCS, ALLOWED, TONE).status).toBe("ok");
    expect(verifyCitations([t("정말 감사합니다.")], DOCS, ALLOWED, TONE).status).toBe("hold");
  });
});

describe("verifyCitations — plain text 문서(char_location)", () => {
  const textDoc: SentDocument = { ...V04, kind: "text", blocks: [{ chunkId: "V04#0", text: "예약 변경은 전날까지 합니다." }, ...V04.blocks] };

  it("문단을 구분자로 이은 원문 위치로 대조하고 걸친 문단을 찾는다", () => {
    const { text, spans } = plainTextLayout(textDoc);
    expect(spans).toEqual([
      { chunkId: "V04#0", start: 0, end: 16 },
      { chunkId: "V04#1", start: 18, end: 18 + V04.blocks[0].text.length },
    ]);
    const start = text.indexOf("예약금");
    const r = verifyCitations(
      [
        t("환불은 방문 2일 전까지입니다.", [
          { type: "char_location", cited_text: V04.blocks[0].text, document_index: 0, start_char_index: start, end_char_index: text.length },
        ]),
      ],
      [textDoc],
      ALLOWED,
      TONE,
    );
    expect(r.status).toBe("ok");
    expect(r.sentences[0].citations[0].chunkIds).toEqual(["V04#1"]);
  });

  it("문서 형식과 인용 형식이 다르면 잘못된 인용", () => {
    const r = verifyCitations([t("x입니다.", [cite(0, 0, 1, "예약 변경은 전날까지 합니다.")])], [textDoc], ALLOWED, TONE);
    expect(r.reasons[0].detail).toBe("V04: 인용 형식이 문서 형식과 다릅니다");
  });
});
