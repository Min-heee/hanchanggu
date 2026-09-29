import { describe, expect, it } from "vitest";
import { realKnowledge } from "../demo/__fixtures__/real";
import type { SentenceReport } from "./citations";
import { checkPriceCitations } from "./pricecheck";
import { formatWon } from "./template";

const k = realKnowledge();
const chunk = (id: string) => k.chunks.find((c) => c.chunkId === id)!.text;
const sentence = (text: string, ids: string[]): SentenceReport => ({
  index: 0,
  text,
  start: 0,
  end: text.length,
  kind: "cited",
  problems: [],
  citations: ids.map((id) => ({ docId: "V03", chunkIds: [id], citedText: chunk(id) })),
});
const check = (text: string, ids: string[]) => checkPriceCitations([sentence(text, ids)], k.prices).map((p) => p.detail);

describe("checkPriceCitations — 가격 칸이 인용한 원문의 금액과 같은 항목인지", () => {
  it("맞는 키는 통과한다(2회차 녹화 문장 모양)", () => {
    expect(check("모발이식은 모당 {{price:graft}}이며 최소 500모부터 시술합니다.", ["V03#2"])).toEqual([]);
    expect(check("첫 상담비는 {{price:consult-first}}입니다.", ["V03#1"])).toEqual([]);
    expect(check("두피 주사는 1회 {{price:injection}}입니다.", ["V03#4"])).toEqual([]);
  });

  it("같은 문단에 있는 다른 항목 금액으로는 통과하지 않는다(3차 적대 검증: 모당에 수술 예약금)", () => {
    expect(check("모발이식은 모당 {{price:deposit-surgery}}이며 최소 500모부터 시술합니다.", ["V03#2"])).toEqual([
      '가격 칸 deposit-surgery(500,000원)가 인용한 원문 문장의 금액(2,000원)과 다릅니다: "모발이식은 모당 {{price:deposit-surgery}}이며 최소 500모부터 시술합니다."',
    ]);
    expect(check("두피·모발 정밀 진단은 {{price:consult-first}}이며, 확대 촬영과 진단 결과 설명이 포함됩니다.", ["V03#1"])).toHaveLength(1);
  });

  it("인용한 원문 어디에도 그 금액이 없으면 막는다(두피 관리 문장에 주사 값)", () => {
    expect(check("두피 관리는 1회 {{price:injection}}이며 약 60분 걸립니다.", ["V03#5"])).toEqual([
      '가격 칸 injection(120,000원)의 금액이 인용한 원문에 없습니다: "두피 관리는 1회 {{price:injection}}이며 약 60분 걸립니다."',
    ]);
    // 금액이 없는 원칙 문장에 가격 칸을 붙여도 막는다.
    expect(check("가격 문의에는 해당 항목의 금액 {{price:injection}}을 안내합니다.", ["V03#6"])).toHaveLength(1);
  });

  it("인용 없는 문장·가격 칸 없는 문장·없는 키는 여기서 보지 않는다(검증기·채우기가 막는다)", () => {
    expect(checkPriceCitations([{ ...sentence("상담비는 {{price:consult-first}}입니다.", []), kind: "uncited" }], k.prices)).toEqual([]);
    expect(check("첫 상담비는 30,000원입니다.", ["V03#1"])).toEqual([]);
    expect(check("첫 상담비는 {{price:parking}}입니다.", ["V03#1"])).toEqual([]);
  });
});

describe("가격표 본문과 json 값", () => {
  it("0원이 아닌 항목의 금액은 가격표 본문에 글자 그대로 있다 — 어긋나면 가격 칸 대조가 맞는 문장까지 막는다", () => {
    const body = k.chunks.filter((c) => c.docId === "V03").map((c) => c.text).join("\n");
    for (const p of k.prices.filter((x) => x.price > 0)) expect([p.key, body.includes(`${formatWon(p.price)}원`)]).toEqual([p.key, true]);
  });
});
