/**
 * 가격 칸 대조(PRD F8 보강). 인용 문장 속 `{{price:키}}`가 **인용한 원문이 말하는 금액**과 같은 항목인지 본다.
 *
 * 왜 필요한가: 모델은 금액을 쓰지 않고 키만 고른다. 키를 잘못 고르면("모발이식은 모당 {{price:deposit-surgery}}이며…")
 * 인용·겹침·숫자 대조를 모두 통과하고 "모당 500,000원"이 나간다 — 자리표시자 속 값은 숫자 대조(core/citations.ts numbersIn)가
 * 세지 않기 때문이다. 전에는 "/회" 단위가 어긋나 보여 사람이 알아챌 단서라도 있었는데, 한 번만 받는 항목의 단위를 없애며
 * (vault/price-list.md) 그 단서도 사라졌다(3차 적대 검증).
 *
 * 규칙(문장마다, 채운 값 기준):
 * 1. 가격 칸의 금액("30,000원")은 이 문장이 인용한 원문 어딘가에 글자 그대로 있어야 한다 — 인용 문장 속 숫자와 같은 대접이다.
 * 2. 인용 원문 중 이 문장과 가장 많이 겹치는 원문 문장에 금액이 적혀 있으면, 칸의 금액은 그 금액 중 하나여야 한다.
 *    같은 문단에 여러 금액이 있을 때("첫 상담비는 30,000원입니다. 두피·모발 정밀 진단은 50,000원이며…") 옆 문장 금액으로 통과하지 않게.
 * 가격 칸이 인용 없는 틀 문장에 있는 경우는 여기까지 오지 않는다 — 검증기가 인용 없는 가격 칸 문장을 받지 않는다.
 *
 * 볼트 가격표 본문 문장과 json 값이 같다는 전제에 선다. 둘이 어긋나면 1이 막는다(보류 쪽으로 틀린다).
 */

import { citedOverlap, type SentenceReport } from "./citations";
import { formatWon, type PriceItem } from "./template";

const PRICE_PH = /\{\{\s*price:([a-z0-9][a-z0-9_-]*)\s*\}\}/g;
const AMOUNT = /(\d[\d,]*)\s*원/g;

function amountsIn(s: string): string[] {
  return [...s.normalize("NFKC").matchAll(AMOUNT)].map((m) => m[1].replace(/,/g, ""));
}

/** 원문을 문장으로 나눈다(마침표·물음표·느낌표 뒤 공백, 줄바꿈). 금액 속 쉼표·점은 나누지 않는다. */
function sourceSentences(text: string): string[] {
  return text.split(/(?<=[.!?。])\s+|\n+/).filter((s) => s.trim() !== "");
}

export interface PriceProblem {
  sentenceIndex: number;
  detail: string;
}

export function checkPriceCitations(sentences: ReadonlyArray<SentenceReport>, prices: ReadonlyArray<PriceItem> | null): PriceProblem[] {
  const out: PriceProblem[] = [];
  for (const s of sentences) {
    const keys = [...s.text.matchAll(PRICE_PH)].map((m) => m[1]);
    if (keys.length === 0 || s.kind !== "cited") continue;
    const cited = s.citations.map((c) => c.citedText);
    const allAmounts = new Set(cited.flatMap(amountsIn));
    let best = "";
    let bestOverlap = -1;
    for (const src of cited.flatMap(sourceSentences)) {
      const ov = citedOverlap(s.text, src) ?? 0;
      if (ov > bestOverlap) {
        bestOverlap = ov;
        best = src;
      }
    }
    const bestAmounts = amountsIn(best);
    for (const key of keys) {
      // 없는 키는 채우기(core/template.ts)가 오류로 막는다. 여기서는 있는 키의 금액만 본다.
      const item = prices?.find((p) => p.key === key);
      if (!item) continue;
      const amount = String(item.price);
      if (!allAmounts.has(amount)) {
        out.push({ sentenceIndex: s.index, detail: `가격 칸 ${key}(${formatWon(item.price)}원)의 금액이 인용한 원문에 없습니다: "${s.text}"` });
      } else if (bestAmounts.length > 0 && !bestAmounts.includes(amount)) {
        out.push({
          sentenceIndex: s.index,
          detail: `가격 칸 ${key}(${formatWon(item.price)}원)가 인용한 원문 문장의 금액(${bestAmounts.map((a) => `${formatWon(Number(a))}원`).join(", ")})과 다릅니다: "${s.text}"`,
        });
      }
    }
  }
  return out;
}
