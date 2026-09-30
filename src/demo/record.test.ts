/**
 * 녹화 파이프라인(src/demo/record.ts)의 인계 초안(PRD v0.4, 2026-09-30 오너 결정) 시험. 모델은 부르지 않는다 —
 * 호출을 세는 모의 클라이언트(가짜 녹화의 fakeClient를 감쌈)로 "몇 번, 무엇을 보냈나"를 본다.
 * 합치기(--handover-only)는 저장소의 실제 녹화 파일(data/demo-responses.json)을 **읽기만** 해서 시험한다.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildKnowledge, type Knowledge } from "../core/knowledge";
import { loadVault } from "../core/vault";
import type { ClaudeClient } from "../llm/client";
import { buildSystemPrompt } from "../llm/draft";
import { DEMO_AS_OF } from "./clock";
import { fakeClient } from "./fake-recording";
import { handoverDraftFor, handoverDraftTargets, handoverMergeProblems, mergeHandoverDrafts, recordInquiry } from "./record";
import { parseDemoRecording, type DemoRecording, type HandoverRun } from "./recording";
import { realInputs, realKnowledge, ROOT } from "./__fixtures__/real";

const k = realKnowledge();
const inquiries = realInputs().inquiriesJson as { id: string; channel: string; text: string }[];
const q = (id: string) => inquiries.find((x) => x.id === id)!;

type Params = { system?: string; output_config?: unknown; messages: { content: unknown }[] };

/** 가짜 녹화의 모의 클라이언트를 감싸 호출을 센다. classifyAs를 주면 분류 요청에 그 값을 돌려준다. */
function counting(kn: Knowledge, classifyAs?: { handover: boolean; category: string }) {
  const base = fakeClient(kn.tone, kn.prices);
  const calls: Params[] = [];
  const create = async (p: Params) => {
    calls.push(p);
    if (classifyAs && p.output_config) {
      const inquiry = (JSON.parse(p.messages[0].content as string) as { inquiry: string }).inquiry;
      const body = { ...classifyAs, priority: "normal", evidence: [inquiry.split(/\s+/)[0]], reason: "시험용 분류" };
      return { id: "msg_t", type: "message", role: "assistant", model: "fake-fixture", content: [{ type: "text", text: JSON.stringify(body), citations: null }], stop_reason: "end_turn", stop_details: null, usage: { input_tokens: 0, output_tokens: 0 } };
    }
    return base.beta.messages.create(p as never);
  };
  return { client: { beta: { messages: { create } } } as unknown as ClaudeClient, calls };
}

/** 모델에 보낸 요청의 마지막 글(문의 JSON). */
const payloadOf = (p: Params) => (p.messages[0].content as { type: string; text?: string }[]).at(-1)!.text!;

describe("인계 문의 녹화 — 게이트가 먼저, 초안은 의료진 확인용 한 번", () => {
  it("규칙 인계(Q06): 분류 없이 모델 호출 정확히 1번(인계 초안), 지시문은 handover 모드(규칙 16~19)", async () => {
    const { client, calls } = counting(k);
    const r = await recordInquiry(client, k, q("Q06"));
    expect(calls).toHaveLength(1);
    expect(calls[0].output_config).toBeUndefined();
    expect(calls[0].system).toBe(buildSystemPrompt("handover", k.prices.map((p) => p.key)));
    expect(calls[0].system).toContain("19. ");
    expect([r.route.step, r.classification, r.draft, r.handoverDraft?.draft.status]).toEqual(["handover", null, null, "ok"]);
  });

  it("공개 창구 인계(Q16 유튜브 댓글): 모델을 부르지 않는다(고정 문구만)", async () => {
    const { client, calls } = counting(k);
    const r = await recordInquiry(client, k, q("Q16"));
    expect(calls).toHaveLength(0);
    expect([r.route.step, r.handoverDraft]).toEqual(["handover", null]);
  });

  it("개인정보 가림은 AI 호출 전 — 전화번호를 넣은 인계 문의의 요청에는 원문 번호가 없고 가림 표시만 있다", async () => {
    const { client, calls } = counting(k);
    const r = await recordInquiry(client, k, { id: "T1", channel: "kakao", text: "수술 9일째인데 고름이 나와요. 010-1234-5678로 연락 주세요" });
    expect(r.route.step).toBe("handover");
    expect(calls).toHaveLength(1);
    const sent = JSON.stringify(calls[0]);
    expect(sent).not.toContain("010-1234-5678");
    expect(sent).not.toContain("1234-5678");
    expect(payloadOf(calls[0])).toContain(r.handoverDraft!.maskedText);
    expect(r.handoverDraft!.maskedText).not.toContain("010-1234-5678");
  });

  it("분류가 인계한 문의(Q03류): 분류 1번 + 인계 초안 1번, 직원이 보낼 초안은 없다", async () => {
    const { client, calls } = counting(k, { handover: true, category: "other" });
    const r = await recordInquiry(client, k, q("Q03"));
    expect(calls.map((c) => (c.output_config ? "classify" : "draft"))).toEqual(["classify", "draft"]);
    expect([r.route.step, r.draft, r.handoverDraft?.draft.status]).toEqual(["handover", null, "ok"]);
  });

  it("고정 안내 문단을 볼트에서 읽지 못하면 모델을 부르지 않고 no-sources로 보류", async () => {
    const files = realInputs().vaultFiles.map((f) =>
      f.path === "handover-procedure.md" ? { ...f, raw: f.raw.replace("## 환자에게 보내는 고정 안내 문장", "## 환자에게 보내는 문장") } : f,
    );
    const kr = buildKnowledge(loadVault(files, { asOf: DEMO_AS_OF }));
    if (!kr.ok) throw new Error(kr.errors.join("\n"));
    const { client, calls } = counting(kr.knowledge);
    const r = await recordInquiry(client, kr.knowledge, q("Q06"));
    expect(calls).toHaveLength(0);
    expect([r.handoverDraft!.draft.status, r.handoverDraft!.draft.holdReasons.map((h) => h.code), r.handoverDraft!.draft.meta.model]).toEqual(["hold", ["no-sources"], null]);
  });

  it("고정 안내 문단의 따옴표(승인 문구)를 읽지 못해도 모델을 부르지 않고 no-sources로 보류 — 초안 검사에 쓸 문장이 없다", async () => {
    const files = realInputs().vaultFiles.map((f) => (f.path === "handover-procedure.md" ? { ...f, raw: f.raw.replace(/"보내 주신([^"]+)"/, "보내 주신$1") } : f));
    const kr = buildKnowledge(loadVault(files, { asOf: DEMO_AS_OF }));
    if (!kr.ok) throw new Error(kr.errors.join("\n"));
    expect([kr.knowledge.index.rules!.handoverDraft!.fixedChunkId, kr.knowledge.index.rules!.handoverDraft!.fixedMessage]).toEqual(["V12#4", null]);
    const { client, calls } = counting(kr.knowledge);
    const r = await recordInquiry(client, kr.knowledge, q("Q06"));
    expect(calls).toHaveLength(0);
    expect(r.handoverDraft!.draft.holdReasons.map((h) => h.code)).toEqual(["no-sources"]);
  });

  it("모델에 보내는 인계 문서 문단은 고정 안내·즉시 조치·'이상하면 연락'뿐(행정 안내 문단은 점수가 기준 이상일 때만) — 약 문의(Q25)·'진통제 두 알, 수술 당일' 문의에도 복용 안내(V07#1)·V17 직원 문단이 없다", async () => {
    const sentChunks = async (text: string) => {
      const { client, calls } = counting(k);
      await handoverDraftFor(client, k, { channel: "kakao", text });
      const docs = (calls[0].messages[0].content as { type: string; title?: string; source?: { content: { text: string }[] } }[]).filter((c) => c.type === "document");
      return docs.flatMap((d) => d.source!.content.map((b) => k.chunks.find((c) => c.text === b.text)!.chunkId));
    };
    expect(await sentChunks(q("Q25").text)).toEqual(["V12#4", "V11#2", "V07#13"]);
    const painkiller = await sentChunks("진통제 두 알 먹어도 돼요? 수술 당일이에요");
    expect(painkiller).not.toContain("V07#1");
    expect(painkiller.some((id) => id.startsWith("V17#"))).toBe(false);
    expect(painkiller.slice(0, 2)).toEqual(["V12#4", "V11#2"]);
  });

  it("인용 대조의 허용 문서는 인계 문서 묶음(인계 문서 V07·V11·V12·V17 + 행정 안내 V02·V03·V04·V18) — 발췌에 묶음 밖 문단(두피 관리 V09)이 끼어도 그 인용은 invalid-citation으로 보류", async () => {
    expect([...k.handoverAllowedDocIds].sort()).toEqual(["V02", "V03", "V04", "V07", "V11", "V12", "V17", "V18"]);
    // 즉시 조치 자리에 묶음 밖 문단을 세운 색인(발췌가 실수로 넓어진 경우). handoverDraftFor가 k.allowedDocIds(모든 승인 문서)를 쓰면 통과해 버린다.
    const price = k.chunks.find((c) => c.docId === "V09" && /60분/.test(c.text))!;
    const rules = k.index.rules!;
    const widened: Knowledge = {
      ...k,
      index: { ...k.index, rules: { ...rules, handoverDraft: { ...rules.handoverDraft!, urgentChunkId: price.chunkId, chunkIds: [...rules.handoverDraft!.chunkIds, price.chunkId] } } },
    };
    const create = async (p: Params) => {
      const docs = (p.messages[0].content as { type: string; source?: { content: { text: string }[] } }[]).filter((c) => c.type === "document");
      const fixed = docs[0].source!.content[0].text;
      const priceText = docs[1].source!.content[0].text;
      expect(priceText).toBe(price.text);
      const message = rules.handoverDraft!.fixedMessage!;
      return {
        id: "m",
        type: "message",
        role: "assistant",
        model: "fake-fixture",
        content: [
          { type: "text", text: `${message} `, citations: [{ type: "content_block_location", cited_text: fixed, document_index: 0, start_block_index: 0, end_block_index: 1 }] },
          { type: "text", text: priceText, citations: [{ type: "content_block_location", cited_text: priceText, document_index: 1, start_block_index: 0, end_block_index: 1 }] },
        ],
        stop_reason: "end_turn",
        stop_details: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      };
    };
    const hd = await handoverDraftFor({ beta: { messages: { create } } } as unknown as ClaudeClient, widened, q("Q06"));
    expect([hd.draft.status, [...new Set(hd.draft.holdReasons.map((h) => h.code))]]).toEqual(["hold", ["invalid-citation"]]);
    expect(hd.draft.holdReasons[0].detail).toContain("V09");
  });

  it("적신호 목록(V11)이 깨지면 지식 자체가 만들어지지 않는다 — 녹화가 멈춰 AI를 부를 수 없다(fail-closed)", () => {
    const files = realInputs().vaultFiles.map((f) => (f.path === "redflags.md" ? { ...f, raw: f.raw.replace(/"symptoms": \[[^\]]*\]/, '"symptoms": []') } : f));
    const kr = buildKnowledge(loadVault(files, { asOf: DEMO_AS_OF }));
    expect(kr.ok).toBe(false);
  });

  it("고정 안내 문단을 인용하지 않은 초안은 검증을 통과해도 handover-no-fixed-message로 보류", async () => {
    // 고정 문단이 아니라 두 번째 문서만 인용하는 모의 모델.
    const create = async (p: Params) => {
      const docs = (p.messages[0].content as { type: string; source?: { content: { text: string }[] } }[]).filter((c) => c.type === "document");
      const text = docs[1].source!.content[0].text;
      return {
        id: "m",
        type: "message",
        role: "assistant",
        model: "fake-fixture",
        content: [{ type: "text", text, citations: [{ type: "content_block_location", cited_text: text, document_index: 1, start_block_index: 0, end_block_index: 1 }] }],
        stop_reason: "end_turn",
        stop_details: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      };
    };
    const hd = await handoverDraftFor({ beta: { messages: { create } } } as unknown as ClaudeClient, k, q("Q06"));
    expect([hd.draft.status, hd.draft.holdReasons.map((h) => h.code), hd.draft.finalText]).toEqual(["hold", ["handover-no-fixed-message"], null]);
  });

  it("가격 칸은 가격표 문장을 인용한 문장에서만 — 고정 안내 문단을 인용해 가격 칸을 쓰면 보류(금액은 가격표 칸만)", async () => {
    const create = async (p: Params) => {
      const docs = (p.messages[0].content as { type: string; source?: { content: { text: string }[] } }[]).filter((c) => c.type === "document");
      const fixed = docs[0].source!.content[0].text;
      const cite = { type: "content_block_location", cited_text: fixed, document_index: 0, start_block_index: 0, end_block_index: 1 };
      return {
        id: "m",
        type: "message",
        role: "assistant",
        model: "fake-fixture",
        content: [
          { type: "text", text: "보내 주신 내용은 의료진에게 바로 전달했습니다. ", citations: [cite] },
          { type: "text", text: "모발이식은 모당 {{price:graft}}입니다.", citations: [cite] },
        ],
        stop_reason: "end_turn",
        stop_details: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      };
    };
    const hd = await handoverDraftFor({ beta: { messages: { create } } } as unknown as ClaudeClient, k, q("Q06"));
    // 고정 안내 문단과 겹치는 말이 적어 인용 검증이 먼저 막는다(가격 칸 대조까지 가지 않는다).
    expect([hd.draft.status, hd.draft.finalText, hd.draft.holdReasons.map((h) => h.code)]).toEqual(["hold", null, ["low-overlap"]]);
  });
});

describe("인계 초안 구성(오너 두 번째 결정): 되짚기 + 승인 문구 + 섞인 의료가 아닌 물음의 답 — 실제 볼트·실제 문의로", () => {
  type Doc = { type: string; title?: string; source?: { content: { text: string }[] } };
  /** 받은 문서에서 문단을 찾아 인용 블록을 만든다. 없으면 시험이 실패한다(발췌에 그 문단이 와야 한다). */
  const blockOf = (docs: Doc[], chunkId: string, text: string) => {
    const chunk = k.chunks.find((c) => c.chunkId === chunkId)!;
    const di = docs.findIndex((d) => d.title?.startsWith(`${chunk.docId} `));
    const bi = docs[di].source!.content.findIndex((b) => b.text === chunk.text);
    expect([chunkId, di >= 0 && bi >= 0]).toEqual([chunkId, true]);
    return { type: "text", text, citations: [{ type: "content_block_location", cited_text: chunk.text, document_index: di, start_block_index: bi, end_block_index: bi + 1 }] };
  };
  const model = (blocks: (docs: Doc[]) => unknown[]) => {
    const create = async (p: Params) => {
      const docs = (p.messages[0].content as Doc[]).filter((c) => c.type === "document");
      return { id: "m", type: "message", role: "assistant", model: "fake-fixture", content: blocks(docs), stop_reason: "end_turn", stop_details: null, usage: { input_tokens: 0, output_tokens: 0 } };
    };
    return { beta: { messages: { create } } } as unknown as ClaudeClient;
  };
  const message = k.index.rules!.handoverDraft!.fixedMessage!;
  const recap = { type: "text", text: "두피 관리 받으면 도움 되는지, 한 번에 얼마인지 문의 주셨습니다. ", citations: null };

  it("Q21(두피에 열·두피 관리 도움 되나요·한 번에 얼마예요): 되짚기 + 승인 문구 + 가격표 두피 관리 문장(가격 칸) → 통과, 보낼 글에 가격표 값", async () => {
    const hd = await handoverDraftFor(
      model((docs) => [recap, blockOf(docs, "V12#4", `${message} `), blockOf(docs, "V03#5", "두피 관리는 1회 {{price:scalp-care}}이며 약 60분 걸립니다.")]),
      k,
      q("Q21"),
    );
    expect([hd.draft.status, hd.draft.holdReasons]).toEqual(["ok", []]);
    expect(hd.draft.sentences.map((x) => x.kind)).toEqual(["recap", "cited", "cited", "cited", "cited"]);
    expect(hd.draft.finalText).toBe(`두피 관리 받으면 도움 되는지, 한 번에 얼마인지 문의 주셨습니다. ${message} 두피 관리는 1회 80,000원이며 약 60분 걸립니다.`);
  });

  it("같은 초안에 판단 문장·약 용량·원인 추정이 들어가면 보류", async () => {
    const withTail = (tail: unknown) => model((docs) => [recap, blockOf(docs, "V12#4", `${message} `), tail]);
    // 인용 없는 판단 문장(둘째 문장부터는 되짚기로 받지 않는다).
    const judged = await handoverDraftFor(withTail({ type: "text", text: "열감은 괜찮습니다.", citations: null }), k, q("Q21"));
    expect([judged.draft.status, judged.draft.holdReasons.map((h) => h.code)]).toEqual(["hold", ["uncited-sentence"]]);
    // 인용을 달고 판단을 끼운 문장(행정 안내 문장을 바꿔 씀) — 겹침 비율은 통과해도 판단 말로 보류.
    const disguised = await handoverDraftFor(
      model((docs) => [recap, blockOf(docs, "V12#4", `${message} `), blockOf(docs, "V03#5", "두피 관리는 1회 {{price:scalp-care}}이며 약 60분 걸리는데 정상입니다.")]),
      k,
      q("Q21"),
    );
    expect(disguised.draft.status).toBe("hold");
    expect(disguised.draft.holdReasons.map((h) => h.code)).toContain("handover-judgment-words");
    // 되짚기 자리에 쓴 약 용량 지시·원인 추정.
    const dose = await handoverDraftFor(model((docs) => [{ type: "text", text: "탈모약은 1mg씩 드세요. ", citations: null }, blockOf(docs, "V12#4", message)]), k, q("Q25"));
    expect([dose.draft.status, dose.draft.holdReasons.map((h) => h.code)]).toEqual(["hold", ["handover-recap"]]);
    const cause = await handoverDraftFor(model((docs) => [{ type: "text", text: "술 때문에 이식부위가 벌겋게 달아올랐다고 말씀 주셨습니다. ", citations: null }, blockOf(docs, "V12#4", message)]), k, q("Q07"));
    expect([cause.draft.status, cause.draft.holdReasons.map((h) => h.code)]).toEqual(["hold", ["handover-recap"]]);
    expect(cause.draft.holdReasons[0].detail).toContain("때문");
  });

  it("되짚기에 문의에 없는 증상을 더하면 보류, 문의의 말만 쓰면 통과(Q06 수술 9일째 고름)", async () => {
    const run = (text: string) => handoverDraftFor(model((docs) => [{ type: "text", text, citations: null }, blockOf(docs, "V12#4", message)]), k, q("Q06"));
    const ok = await run("수술 9일째 이식 부위에서 노란 고름 같은 게 조금씩 나온다고 말씀 주셨습니다. ");
    expect([ok.draft.status, ok.draft.holdReasons]).toEqual(["ok", []]);
    const added = await run("수술 9일째 이식 부위에서 고름과 피가 나온다고 말씀 주셨습니다. ");
    expect([added.draft.status, added.draft.holdReasons.map((h) => h.code)]).toEqual(["hold", ["handover-recap"]]);
    expect(added.draft.holdReasons[0].detail).toContain("피가");
    const moreDays = await run("수술 10일째 이식 부위에서 고름이 나온다고 말씀 주셨습니다. ");
    expect(moreDays.draft.holdReasons.map((h) => h.code)).toEqual(["handover-recap"]);
    // 변이 A3: '붓고'·'부어'는 문의의 '부위'와 앞 자모가 같아 낱말 대조를 통과한다 — 증상 말 대조만 이것을 잡는다(문의에 없는 부기 증상).
    for (const [text, word] of [
      ["수술 9일째 이식 부위가 붓고 노란 고름 같은 게 나온다고 말씀 주셨습니다. ", "붓고"],
      ["수술 9일째 이식 부위가 부어 있고 노란 고름 같은 게 나온다고 말씀 주셨습니다. ", "부어"],
    ] as const) {
      const swollen = await run(text);
      expect([word, swollen.draft.status, swollen.draft.holdReasons.map((h) => h.code)]).toEqual([word, "hold", ["handover-recap"]]);
      expect(swollen.draft.holdReasons[0].detail).toContain(`문의에 없는 증상 말(${word}`);
    }
    // 적신호(고름)를 빼고 물음만 되짚으면 보류.
    const dropped = await run("월요일에 가도 되는지 문의 주셨습니다. ");
    expect(dropped.draft.holdReasons[0].detail).toContain("문의의 증상 말(고름)을 빼고");
  });

  // 변이 D4: handover 모드에서만 가격 칸 대조를 건너뛰어도 시험이 몰랐다(기존 시험은 고정 안내 문단을 인용해 low-overlap으로 막혔다).
  it("가격 칸 키가 인용한 가격표 문장의 금액과 다르면 보류(price-mismatch) — 두피 관리(80,000원) 문장에 모발이식 칸", async () => {
    const hd = await handoverDraftFor(
      model((docs) => [recap, blockOf(docs, "V12#4", `${message} `), blockOf(docs, "V03#5", "두피 관리는 1회 {{price:graft}}이며 약 60분 걸립니다.")]),
      k,
      q("Q21"),
    );
    expect([hd.draft.status, hd.draft.finalText, hd.draft.holdReasons.map((h) => h.code)]).toEqual(["hold", null, ["price-mismatch"]]);
  });

  it("가격표 문단의 링크 문장('관리 내용은 [[scalp-care]]를 봅니다')을 옮기면 보류(handover-link) — 증상 초안이 다른 문서를 안내하지 않게", async () => {
    const hd = await handoverDraftFor(
      model((docs) => [recap, blockOf(docs, "V12#4", `${message} `), blockOf(docs, "V03#5", "두피 관리는 1회 {{price:scalp-care}}이며 약 60분 걸립니다. 관리 내용은 [[scalp-care]]를 봅니다.")]),
      k,
      q("Q21"),
    );
    expect([hd.draft.status, hd.draft.holdReasons.map((h) => h.code)]).toEqual(["hold", ["handover-link"]]);
  });

  it("Q22(3주·빨갛게 부어오름·냄새): 되짚기 + 승인 문구 + V07 '이상하면 연락' 첫 문장 → 통과, 둘째 문장(직원 방침)은 보류", async () => {
    const recap22 = { type: "text", text: "이식 받은 지 3주 됐는데 뒷머리 채취한 곳이 빨갛게 부어오르고 냄새가 난다고 말씀 주셨습니다. ", citations: null };
    const ok = await handoverDraftFor(
      model((docs) => [recap22, blockOf(docs, "V12#4", `${message} `), blockOf(docs, "V07#13", "이 문서에 없는 변화가 있거나 걱정되면 병원에 연락하도록 안내합니다.")]),
      k,
      q("Q22"),
    );
    expect([ok.draft.status, ok.draft.holdReasons]).toEqual(["ok", []]);
    const staff = await handoverDraftFor(
      model((docs) => [recap22, blockOf(docs, "V12#4", `${message} `), blockOf(docs, "V07#13", k.chunks.find((c) => c.chunkId === "V07#13")!.text)]),
      k,
      q("Q22"),
    );
    expect(staff.draft.holdReasons.map((h) => h.code)).toContain("handover-staff-text");
  });

  it("인용 없는 자리표시자 문장('바로 오시면 되는 시간은 {{hours}}입니다.')은 보류 — 인계 초안에서 인용 없이 받는 문장은 되짚기뿐", async () => {
    const hd = await handoverDraftFor(model((docs) => [blockOf(docs, "V12#4", `${message} `), { type: "text", text: "바로 오시면 되는 시간은 {{hours}}입니다.", citations: null }]), k, q("Q08"));
    expect([hd.draft.status, hd.draft.holdReasons.map((h) => h.code)]).toEqual(["hold", ["uncited-sentence"]]);
  });

  it("되짚기: 약 말·용량·허락 말(진통제 500mg 두 알 먹어도 된다고), 부정 뒤집기(피가 안 멈춰요 → 피가 멈춘다고)는 실제 볼트 목록으로도 보류", async () => {
    const run = (text: string, recapText: string) =>
      handoverDraftFor(model((docs) => [{ type: "text", text: recapText, citations: null }, blockOf(docs, "V12#4", message)]), k, { channel: "kakao", text });
    const pain = await run("진통제 500mg 두 알 먹어도 되나요? 수술 3일째 너무 아파요", "수술 3일째 너무 아파 진통제 500mg 두 알 먹어도 된다고 말씀 주셨습니다. ");
    expect([pain.draft.status, pain.draft.holdReasons.map((h) => h.code)]).toEqual(["hold", ["handover-recap"]]);
    const stop = await run("수술 3일째인데 피가 안 멈춰요", "수술 3일째 피가 멈춘다고 말씀 주셨습니다. ");
    expect([stop.draft.status, stop.draft.holdReasons.map((h) => h.code)]).toEqual(["hold", ["handover-recap"]]);
    expect(stop.draft.holdReasons[0].detail).toContain("부정 말");
    const kept = await run("수술 3일째인데 피가 안 멈춰요", "수술 3일째 피가 안 멈춘다고 말씀 주셨습니다. ");
    expect([kept.draft.status, kept.draft.holdReasons]).toEqual(["ok", []]);
  });

  it("승인 문구를 큰따옴표로 감싸도 통과하고, 보낼 글(finalText)에서는 따옴표를 뺀다 — 모델 글은 그대로", async () => {
    const hd = await handoverDraftFor(model((docs) => [blockOf(docs, "V12#4", `"${message}"`)]), k, q("Q11"));
    expect(hd.draft.status).toBe("ok");
    expect(hd.draft.modelText).toBe(`"${message}"`);
    expect(hd.draft.finalText).toBe(message);
  });
});

describe("인계 초안만 따로 녹화해 합치기(record-demo --handover-only)", () => {
  const FILE = join(ROOT, "data/demo-responses.json");
  const text = readFileSync(FILE, "utf8");
  const raw = JSON.parse(text) as unknown;
  const parsed = parseDemoRecording(raw);
  if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
  const existing: DemoRecording = parsed.value;
  const run: HandoverRun = { generatedAt: "2026-09-30T00:00:00.000Z", requestedModel: "fake-fixture", servedModels: ["fake-fixture"], totalUsage: { input_tokens: 10, output_tokens: 2 } };
  const stripAdded = (v: unknown) => {
    const o = JSON.parse(JSON.stringify(v)) as { inquiries: Record<string, unknown>[]; handoverRun?: unknown };
    delete o.handoverRun;
    for (const r of o.inquiries) delete r.handoverDraft;
    return o;
  };

  it("대상: 규칙 인계 16건(Q16 공개 창구 제외) + 녹화된 분류 인계 4건 = 20건", () => {
    // 인계 초안이 이미 합쳐진 뒤에도 대상은 같다(규칙과 녹화된 분류 경로만 본다).
    expect(handoverDraftTargets(k, inquiries, existing).map((x) => x.id)).toEqual([
      "Q03", "Q06", "Q07", "Q08", "Q09", "Q10", "Q11", "Q13", "Q14", "Q19", "Q21", "Q22", "Q24", "Q25", "Q26", "Q27", "Q32", "Q35", "Q36", "Q40",
    ]);
    // 녹화가 없으면 분류 인계를 알 수 없어 규칙 인계만.
    expect(handoverDraftTargets(k, inquiries, null)).toHaveLength(16);
  });

  it("합친 결과에서 더한 키를 지우면 원본 파일과 바이트까지 같다 — 기존 녹화(일반 초안·수치)는 그대로, 키 순서도 그대로", async () => {
    const hd = await handoverDraftFor(counting(k).client, k, q("Q06"));
    const merged = mergeHandoverDrafts(raw, new Map([["Q06", hd]]), run, DEMO_AS_OF);
    if (!merged.ok) throw new Error(merged.errors.join("\n"));
    // 파일에 이미 인계 초안이 합쳐져 있어도(1차 녹화 뒤) 비교가 되게, 양쪽에서 더한 키를 지우고 견준다.
    expect(`${JSON.stringify(stripAdded(merged.value), null, 2)}\n`).toBe(`${JSON.stringify(stripAdded(raw), null, 2)}\n`);
    const again = parseDemoRecording(merged.value);
    if (!again.ok) throw new Error(again.errors.join("\n"));
    expect(again.value.inquiries.find((r) => r.id === "Q06")!.handoverDraft).toEqual(hd);
    expect(again.value.inquiries.filter((r) => r.handoverDraft !== undefined).map((r) => r.id)).toEqual(
      existing.inquiries.filter((r) => r.handoverDraft !== undefined).map((r) => r.id).concat(existing.inquiries.find((r) => r.id === "Q06")!.handoverDraft ? [] : ["Q06"]),
    );
    // 4회차의 생성 시각·사용량·모델은 그대로이고, 인계 녹화 사용량은 따로 남는다.
    expect([again.value.generatedAt, again.value.totalUsage, again.value.servedModels]).toEqual([existing.generatedAt, existing.totalUsage, existing.servedModels]);
    expect(again.value.handoverRun?.totalUsage).toEqual(
      existing.handoverRun
        ? { input_tokens: existing.handoverRun.totalUsage.input_tokens + 10, output_tokens: existing.handoverRun.totalUsage.output_tokens + 2 }
        : { input_tokens: 10, output_tokens: 2 },
    );
    // 입력 객체는 바뀌지 않는다.
    expect(`${JSON.stringify(raw, null, 2)}\n`).toBe(text);
  });

  it("여러 번 합치면 인계 녹화 사용량을 더한다", async () => {
    const hd = await handoverDraftFor(counting(k).client, k, q("Q06"));
    const first = mergeHandoverDrafts(raw, new Map([["Q06", hd]]), run, DEMO_AS_OF);
    if (!first.ok) throw new Error(first.errors.join("\n"));
    const second = mergeHandoverDrafts(first.value, new Map([["Q07", await handoverDraftFor(counting(k).client, k, q("Q07"))]]), run, DEMO_AS_OF);
    if (!second.ok) throw new Error(second.errors.join("\n"));
    const v = parseDemoRecording(second.value);
    if (!v.ok) throw new Error(v.errors.join("\n"));
    const before = existing.handoverRun?.totalUsage ?? { input_tokens: 0, output_tokens: 0 };
    expect(v.value.handoverRun!.totalUsage).toEqual({ input_tokens: before.input_tokens + 20, output_tokens: before.output_tokens + 4 });
  });

  it("합치기 전 확인(handoverMergeProblems): 대상이 모두 기존 녹화에 있고 인계 경로여야 한다 — 키를 읽기 전에 부른다", () => {
    const targets = handoverDraftTargets(k, inquiries, existing).map((x) => x.id);
    expect(handoverMergeProblems(existing, targets)).toEqual([]);
    const problems = handoverMergeProblems(existing, ["Q06", "Q99", "Q02"]);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain("Q99");
    expect(problems[1]).toContain("Q02");
  });

  it("인계 경로가 아닌 기록(Q02 초안 경로)에 인계 초안을 합치면 파일 모양 오류로 거부 — 한 기록에 두 초안이 생기지 않는다", async () => {
    const hd = await handoverDraftFor(counting(k).client, k, q("Q06"));
    const merged = mergeHandoverDrafts(raw, new Map([["Q02", hd]]), run, DEMO_AS_OF);
    expect(merged.ok).toBe(false);
    if (!merged.ok) expect(merged.errors.join("\n")).toContain("의료진 확인용 초안은 인계 경로에만");
  });

  it("볼트 기준일이 다르거나, 녹화에 없는 문의이거나, 파일 모양이 틀리면 거부한다", async () => {
    const hd = await handoverDraftFor(counting(k).client, k, q("Q06"));
    expect(mergeHandoverDrafts(raw, new Map([["Q06", hd]]), run, "2026-09-28").ok).toBe(false);
    const unknown = mergeHandoverDrafts(raw, new Map([["Q99", hd]]), run, DEMO_AS_OF);
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.errors.join()).toContain("Q99");
    expect(mergeHandoverDrafts({ fictional: true }, new Map([["Q06", hd]]), run, DEMO_AS_OF).ok).toBe(false);
  });
});
