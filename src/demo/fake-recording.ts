/**
 * 시험용 가짜 녹화. **모델을 부르지 않는다.** 녹화 파일(data/demo-responses.json)이 아직 없을 때
 * '녹화가 있을 때'의 화면을 시험하려고 만든다.
 *
 * 진짜 녹화와 같은 함수(record.ts의 recordAll)를 모의 클라이언트로 부른다. 그래서 가림·게이트·분류 경로·검색·
 * 인용 검증·가격 칸 채우기·광고 검사까지 진짜 코드가 돌고, 결과 모양이 scripts/record-demo.ts가 쓰는 것과 같다.
 * 모의 클라이언트의 답은 받은 문단을 글자 그대로 옮긴 문장이라 내용 품질을 보여 주지 않는다.
 * 화면은 recordingSource가 "fake-fixture"면 "시험용 가짜 녹화"라고 크게 표시한다.
 *
 *   npm run bundle -- --fake-recording     # 가짜 녹화를 넣은 번들로 화면 보기(커밋하지 않는 생성물)
 */

import type Anthropic from "@anthropic-ai/sdk";
import type { Knowledge } from "../core/knowledge";
import { NO_EVIDENCE_MARKER } from "../core/citations";
import type { ClaudeClient } from "../llm/client";
import { recordAll } from "./record";
import type { DemoRecording } from "./recording";

export const FAKE_MODEL = "fake-fixture";

/** 문서 빈칸 시험용: 이 말이 든 질문에는 '[근거 없음]'으로 답한다(골든셋 no-source 문항의 핵심어). */
const NO_SOURCE_WORDS = ["정산", "실손", "휴가", "할부", "통역", "숙소", "연차", "와이파이"];
/** 보류 화면 시험용: 이 말이 든 문의에는 인용 없는 문장을 하나 섞는다(검증이 막아야 한다). */
const HOLD_TRIGGER = "도움 되나요";
/** 가격 칸 시험용: 질문 속 말 → 가격표 키. */
const PRICE_WORDS: [RegExp, string][] = [
  [/모당/, "graft"],
  [/상담비/, "consult-first"],
  [/주사/, "injection"],
  [/두피\s*관리/, "scalp-care"],
];

const usage = { input_tokens: 0, output_tokens: 0 } as unknown as Anthropic.Beta.BetaUsage;

function message(content: unknown[]) {
  return { id: "msg_fake", type: "message", role: "assistant", model: FAKE_MODEL, content, stop_reason: "end_turn", stop_details: null, usage };
}

function firstSentence(text: string): string {
  return text.split(/(?<=[.?!])\s+/)[0];
}

interface DocBlock {
  type: "document";
  title?: string;
  source: { type: "content"; content: { type: "text"; text: string }[] };
}

function fakeClassify(inquiry: string) {
  const category = /배송|반품|토닉|에센스|주문/.test(inquiry)
    ? "shop"
    : /예약|취소|환불|확정|옮기|미룰/.test(inquiry)
      ? "booking"
      : /가격|얼마|모당|할인/.test(inquiry)
        ? "price"
        : /상담/.test(inquiry)
          ? "consultation"
          : "other";
  const evidence = inquiry.split(/\s+/).slice(0, 1);
  return { category, priority: "normal", handover: false, evidence, reason: "시험용 가짜 분류(모델 호출 없음)" };
}

/** 요청 모양을 보고 분류 응답 또는 인용 달린 초안 응답을 돌려주는 모의 클라이언트. */
export function fakeClient(tone: Knowledge["tone"]): ClaudeClient {
  const create = async (params: unknown) => {
    const p = params as { output_config?: { format?: unknown }; messages: { content: unknown }[] };
    if (p.output_config?.format) {
      const data = JSON.parse(p.messages[0].content as string) as { inquiry: string };
      return message([{ type: "text", text: JSON.stringify(fakeClassify(data.inquiry)), citations: null }]);
    }
    const content = p.messages[0].content as (DocBlock | { type: "text"; text: string })[];
    const docs = content.filter((c): c is DocBlock => c.type === "document");
    const last = content[content.length - 1] as { text: string };
    const payload = JSON.parse(last.text) as { inquiry?: string; question?: string };
    const q = payload.inquiry ?? payload.question ?? "";
    if (NO_SOURCE_WORDS.some((w) => q.includes(w))) return message([{ type: "text", text: NO_EVIDENCE_MARKER, citations: null }]);

    const blocks: unknown[] = [{ type: "text", text: `${tone.greetings[0]}\n`, citations: null }];
    // 앞의 두 문서에서 첫 문단의 첫 문장을 글자 그대로 옮기고 그 문단을 인용한다.
    docs.slice(0, 2).forEach((d, di) => {
      const cited = d.source.content[0].text;
      blocks.push({
        type: "text",
        text: firstSentence(cited),
        citations: [
          { type: "content_block_location", cited_text: cited, document_index: di, document_title: d.title ?? null, start_block_index: 0, end_block_index: 1 },
        ],
      });
      blocks.push({ type: "text", text: "\n", citations: null });
    });
    const price = PRICE_WORDS.find(([re]) => re.test(q));
    if (price) blocks.push({ type: "text", text: `가격은 {{price:${price[1]}}}입니다.\n`, citations: null });
    if (q.includes(HOLD_TRIGGER)) blocks.push({ type: "text", text: "관리를 받으면 누구나 금방 좋아집니다.\n", citations: null });
    blocks.push({ type: "text", text: tone.closings[0], citations: null });
    return message(blocks);
  };
  return { beta: { messages: { create } } } as unknown as ClaudeClient;
}

export async function buildFakeRecording(
  k: Knowledge,
  inquiries: { id: string; channel: string; text: string }[],
  golden: { id: string; kind: "staff-qa" | "inquiry"; question?: string }[],
  vaultAsOf: string,
): Promise<DemoRecording> {
  return recordAll(fakeClient(k.tone), k, inquiries, golden, {
    requestedModel: `${FAKE_MODEL}(시험용 가짜 녹화 — 모델 호출 없음)`,
    vaultAsOf,
    // 생성 시각을 고정해 번들이 실행마다 같게 한다.
    generatedAt: "2026-09-21T00:00:00.000Z",
  });
}
