/**
 * 시험용 가짜 녹화. **모델을 부르지 않는다.** 녹화 파일(data/demo-responses.json)이 아직 없을 때
 * '녹화가 있을 때'의 화면을 시험하려고 만든다.
 *
 * 진짜 녹화와 같은 함수(record.ts의 recordAll)를 모의 클라이언트로 부른다. 그래서 가림·게이트·분류 경로·검색·
 * 인용 검증·가격 칸 채우기·광고 검사까지 진짜 코드가 돌고, 결과 모양이 scripts/record-demo.ts가 쓰는 것과 같다.
 * 모의 클라이언트의 답은 받은 문단을 글자 그대로 옮긴 문장이라 내용 품질을 보여 주지 않는다.
 * 인계 문의의 의료진 확인용 초안(지시문이 handover 모드)에는 맨 앞 문서(고정 안내 문단)의 따옴표 안 승인 문구를 통째로 옮기고 그 문단만 인용한다 —
 * 진짜 모델에게 시키는 모양(규칙 17)이자 인계 초안 검사(checkHandoverDraft)를 통과하는 가장 작은 모양일 뿐, 이것도 모양 확인용이다.
 * 화면은 recordingSource가 "fake-fixture"면 "시험용 가짜 녹화"라고 크게 표시한다.
 *
 *   DEMO_FAKE_RECORDING=1 npm run dev     # 가짜 녹화를 넣은 번들로 화면 보기(배포·빌드에서는 거부된다)
 */

import type Anthropic from "@anthropic-ai/sdk";
import type { Knowledge } from "../core/knowledge";
import { NO_EVIDENCE_MARKER } from "../core/citations";
import { formatWon, type PriceItem } from "../core/template";
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

/** 인계 초안용: 따옴표 안 문장이 있으면 그 전체(승인 문구), 없으면 문단의 첫 문장. */
function quotedMessage(text: string): string {
  const q = /["“]([^"”]+)["”]/.exec(text);
  return q ? q[1].trim() : firstSentence(text);
}

/** buildSystemPrompt의 handover 모드 머리말(src/llm/draft.ts). */
const HANDOVER_WHO = "의료진에게 인계한 환자 문의";

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

/**
 * 가격 칸 문장: 받은 가격표 문단(V03)에서 그 금액이 적힌 문장을 찾아, 금액만 자리표시자로 바꿔 그 문단을 인용한다.
 * 가격 칸은 인용 문장 안에서만 받으므로(core/citations.ts, core/pricecheck.ts) 진짜 모델에게 시키는 모양과 같게 만든다.
 * 가격표 문단을 받지 못했으면 가격 문장을 쓰지 않는다.
 */
function priceSentence(docs: DocBlock[], item: PriceItem | undefined): unknown | null {
  if (!item) return null;
  const amount = `${formatWon(item.price)}원`;
  for (const [di, d] of docs.entries()) {
    if (!d.title?.startsWith("V03 ")) continue;
    for (const [bi, b] of d.source.content.entries()) {
      const sentence = b.text.split(/(?<=[.?!])\s+/).find((s) => s.includes(amount));
      if (!sentence) continue;
      return {
        type: "text",
        text: sentence.replace(amount, `{{price:${item.key}}}`),
        citations: [{ type: "content_block_location", cited_text: b.text, document_index: di, document_title: d.title, start_block_index: bi, end_block_index: bi + 1 }],
      };
    }
  }
  return null;
}

/** 요청 모양을 보고 분류 응답 또는 인용 달린 초안 응답을 돌려주는 모의 클라이언트. */
export function fakeClient(tone: Knowledge["tone"], prices: PriceItem[] = []): ClaudeClient {
  const create = async (params: unknown) => {
    const p = params as { output_config?: { format?: unknown }; system?: string; messages: { content: unknown }[] };
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

    const handover = typeof p.system === "string" && p.system.includes(HANDOVER_WHO);
    const blocks: unknown[] = [{ type: "text", text: `${tone.greetings[0]}\n`, citations: null }];
    // 앞의 두 문서에서 첫 문단의 첫 문장을 글자 그대로 옮기고 그 문단을 인용한다. 인계 초안은 맨 앞 문서(고정 안내)의 승인 문구만.
    docs.slice(0, handover ? 1 : 2).forEach((d, di) => {
      const cited = d.source.content[0].text;
      blocks.push({
        type: "text",
        text: handover ? quotedMessage(cited) : firstSentence(cited),
        citations: [
          { type: "content_block_location", cited_text: cited, document_index: di, document_title: d.title ?? null, start_block_index: 0, end_block_index: 1 },
        ],
      });
      blocks.push({ type: "text", text: "\n", citations: null });
    });
    const price = PRICE_WORDS.find(([re]) => re.test(q));
    const priced = price ? priceSentence(docs, prices.find((x) => x.key === price[1])) : null;
    if (priced) blocks.push(priced, { type: "text", text: "\n", citations: null });
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
  return recordAll(fakeClient(k.tone, k.prices), k, inquiries, golden, {
    requestedModel: `${FAKE_MODEL}(시험용 가짜 녹화 — 모델 호출 없음)`,
    vaultAsOf,
    // 생성 시각을 고정해 번들이 실행마다 같게 한다.
    generatedAt: "2026-09-21T00:00:00.000Z",
  });
}
