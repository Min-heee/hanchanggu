import { describe, expect, it } from "vitest";
import { assertBm25Params, buildIndex, queryFromInquiry, search, tokenize } from "./search";
import { chunkDoc, loadVault, type Chunk } from "./vault";
import { fixtureFiles } from "./__fixtures__/load";

function chunk(chunkId: string, text: string, heading: string | null = null): Chunk {
  return { chunkId, docId: chunkId.split("#")[0], heading, index: 0, text, start: 0, end: text.length };
}

function fixtureIndex() {
  const v = loadVault(fixtureFiles());
  const searchable = v.active.flatMap(chunkDoc);
  const excluded = v.excluded.map((e) => ({ doc: e, chunks: chunkDoc(v.all.find((d) => d.meta.id === e.id)!) }));
  return buildIndex(searchable, excluded);
}

describe("tokenize", () => {
  it("단어와 한글 2-gram을 만들고, D+3은 한 단어로 둔다", () => {
    expect(tokenize("수술 후 D+3에")).toEqual(["w:수술", "g:수술", "w:후", "g:후", "w:d+3", "w:에", "g:에"]);
  });

  it("3글자 이상 한글 단어는 겹치는 2-gram으로 쪼갠다", () => {
    expect(tokenize("예약금")).toEqual(["w:예약금", "g:예약", "g:약금"]);
  });

  it("조사를 뗀 줄기를 하나 더한다(한 글자 줄기면 2-gram 자리에 그 글자도)", () => {
    expect(tokenize("술은")).toEqual(["w:술은", "g:술은", "w:술", "g:술"]);
    expect(tokenize("예약금은")).toEqual(["w:예약금은", "g:예약", "g:약금", "g:금은", "w:예약금"]);
    // '문의'의 '의'처럼 단어 끝 글자와 겹치는 조사는 떼지 않는다.
    expect(tokenize("문의")).toEqual(["w:문의", "g:문의"]);
  });

  it("'3일째'·'열흘째'는 D+N 조각을 하나 더한다", () => {
    expect(tokenize("3일째")).toEqual(["w:3일째", "w:d+3", "g:3일", "g:일째"]);
    expect(tokenize("열흘째")).toEqual(["w:열흘째", "w:d+10", "g:열흘", "g:흘째"]);
  });

  it("NFKC로 전각 문자를 통일하고 영문은 소문자로 둔다", () => {
    expect(tokenize("ＤＭ 문의")).toEqual(["w:dm", "w:문의", "g:문의"]);
  });
});

describe("BM25 점수", () => {
  it("손으로 계산한 값과 같다: 두 문단 중 하나에만 있는 한 글자 단어", () => {
    // 각 문단 길이 2(단어 1 + 조각 1), 평균 2 → 길이 보정 1.
    // idf = ln(1 + (2 - 1 + 0.5) / (1 + 0.5)) = ln 2, tf 항 = 1·2.2 / (1 + 1.2) = 1.
    // "w:열"과 "g:열" 두 조각이 맞으므로 2·ln 2.
    const idx = buildIndex([chunk("A#0", "열"), chunk("B#0", "두피")]);
    const r = search(idx, "열");
    expect(r.hits.length).toBe(1);
    expect(r.hits[0].chunk.chunkId).toBe("A#0");
    expect(r.hits[0].score).toBeCloseTo(2 * Math.log(2), 10);
    expect(r.hits[0].matchedTerms).toEqual(["w:열", "g:열"]);
  });

  it("손으로 계산한 값: 길이가 다른 문단(길이 보정 b가 점수에 들어간다)", () => {
    // A "열 두피" = w:열 g:열 w:두피 g:두피 → 길이 4, B "상담" → 길이 2, 평균 3.
    // tf 항 = 1·2.2 / (1 + 1.2·(0.25 + 0.75·4/3)) = 2.2 / 2.5 = 0.88, idf = ln 2 → 2·ln 2·0.88.
    const idx = buildIndex([chunk("A#0", "열 두피"), chunk("B#0", "상담")]);
    expect(search(idx, "열").hits[0].score).toBeCloseTo(2 * Math.log(2) * 0.88, 10);
  });

  it("손으로 계산한 값: 같은 조각이 두 번(포화 k1이 점수에 들어간다)", () => {
    // A "열 열 두피" → 길이 6(w:열·g:열 각 2번), B 길이 2, 평균 4.
    // tf 항 = 2·2.2 / (2 + 1.2·(0.25 + 0.75·6/4)) = 4.4 / 3.65.
    const idx = buildIndex([chunk("A#0", "열 열 두피"), chunk("B#0", "상담")]);
    expect(search(idx, "열").hits[0].score).toBeCloseTo(2 * Math.log(2) * (4.4 / 3.65), 10);
  });

  it("BM25 상수가 범위를 벗어나면 색인을 만들지 않는다(k1·b 뒤바꿈 방지)", () => {
    expect(() => assertBm25Params(0.75, 1.2)).toThrow("BM25 b는 0~1이어야 합니다: 1.2");
    expect(() => assertBm25Params(0, 0.75)).toThrow();
    expect(() => assertBm25Params(1.2, -0.1)).toThrow();
    expect(() => assertBm25Params(1.2, 0)).not.toThrow();
    expect(() => assertBm25Params()).not.toThrow();
  });

  it("겹치는 조각이 없으면 결과가 비고, 질의 중복은 점수를 부풀리지 않는다", () => {
    const idx = buildIndex([chunk("A#0", "열"), chunk("B#0", "두피")]);
    expect(search(idx, "주차").hits).toEqual([]);
    expect(search(idx, "열 열 열").hits[0].score).toBeCloseTo(search(idx, "열").hits[0].score, 10);
  });

  it("동점이면 색인 순서를 따른다(재현성)", () => {
    const idx = buildIndex([chunk("A#0", "상담"), chunk("B#0", "상담"), chunk("C#0", "주사")]);
    expect(search(idx, "상담").hits.map((h) => h.chunk.chunkId)).toEqual(["A#0", "B#0"]);
  });

  it("소제목도 검색 대상이다", () => {
    const idx = buildIndex([chunk("A#0", "거품을 얹어 헹굽니다.", "머리 감기"), chunk("B#0", "상담 안내")]);
    expect(search(idx, "머리 감기").hits[0].chunk.chunkId).toBe("A#0");
  });
});

describe("queryFromInquiry", () => {
  it("날짜·요일·시각, 폼 칸 이름, 가림 표시를 뺀다", () => {
    expect(queryFromInquiry("이름: [이름] / 문의: 9월 29일(화) 오후 3시 예약을 10월 1일로 옮기고 싶어요")).toBe("/ 예약을 로 옮기고 싶어요");
    expect(queryFromInquiry("금요일 2026-10-02 상담")).toBe("상담");
  });
});

describe("search — 볼트 픽스처", () => {
  it("예약금 환불 질문은 승인 문서 V04의 환불 문단을 1위로 찾는다", () => {
    const r = search(fixtureIndex(), "예약금 환불은 며칠 전까지 돼요?", 3);
    expect(r.hits[0].chunk.chunkId).toBe("V04#1");
  });

  it("옛 버전(V04b)·미승인(V20)은 결과에 넣지 않고 excluded로 보고한다", () => {
    const r = search(fixtureIndex(), "예약금 환불", 10);
    expect(r.hits.some((h) => h.chunk.docId === "V04b" || h.chunk.docId === "V20")).toBe(false);
    expect(r.excluded.map((e) => [e.doc.id, e.doc.reason, e.matched, e.bestChunkId])).toEqual([
      ["V04b", "superseded", true, "V04b#0"],
      ["V20", "draft", true, "V20#0"],
    ]);
  });

  it("제외 문서는 순위 통계(df)에도 들어가지 않는다", () => {
    const withExcluded = fixtureIndex();
    const v = loadVault(fixtureFiles());
    const without = buildIndex(v.active.flatMap(chunkDoc));
    const q = "예약금 환불";
    expect(search(withExcluded, q, 10).hits.map((h) => [h.chunk.chunkId, h.score])).toEqual(
      search(without, q, 10).hits.map((h) => [h.chunk.chunkId, h.score]),
    );
  });

  it("D+3 질문은 D+3 문단을 찾는다", () => {
    const r = search(fixtureIndex(), "D+3에 머리 감아도 되나요", 3);
    expect(r.hits[0].chunk.chunkId).toBe("V07#1");
  });

  it("볼트에 없는 주제(주차 정산)는 결과가 비어 있다", () => {
    const r = search(fixtureIndex(), "주차 정산", 5);
    expect(r.hits).toEqual([]);
  });
});
