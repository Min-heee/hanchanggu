/**
 * 녹화된 초안을 지금 코드로 다시 채우기(refill.ts)와, 그와 함께 더한 평가 행 시험.
 * 2회차 녹화의 사본(__fixtures__/recording-round2.json, 커밋 3430ae2의 data/demo-responses.json과 같은 바이트)을 읽는다.
 * 고치려던 결함이 그 녹화에서 나왔기 때문이다. 시연 녹화(data/demo-responses.json)는 3회차부터 새 코드로 만들어져
 * 다시 채울 것이 없으므로, 그 파일을 읽으면 "고친 것이 녹화에서 온 문제"라는 사실을 고정할 수 없다.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fixedMessageQuoteIndices } from "../core/knowledge";
import type { ClaudeClient } from "../llm/client";
import type { DraftResult } from "../llm/draft";
import { DEMO_AS_OF } from "./clock";
import { recordingDrift } from "./drift";
import { computeMetrics, evidenceChunks } from "./evaluation";
import { buildFakeRecording } from "./fake-recording";
import { handoverDraftFor } from "./record";
import { parseDemoRecording, type DemoRecording } from "./recording";
import { draftDisplay, type DraftMode } from "./refill";
import { realBundle, realInputs, realKnowledge, ROOT } from "./__fixtures__/real";

const k = realKnowledge();
const recJson = JSON.parse(readFileSync(join(ROOT, "src/demo/__fixtures__/recording-round2.json"), "utf8")) as unknown;
const parsed = parseDemoRecording(recJson);
if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
const rec: DemoRecording = parsed.value;

const okDrafts: { id: string; d: DraftResult; mode: DraftMode }[] = [
  ...rec.inquiries.filter((r) => r.draft?.status === "ok").map((r) => ({ id: r.id, d: r.draft!, mode: "reply" as const })),
  ...rec.golden.filter((g) => g.draft.status === "ok").map((g) => ({ id: g.id, d: g.draft, mode: "staff-qa" as const })),
];
const byId = new Map(okDrafts.map((x) => [x.id, x]));
const show = (id: string) => {
  const x = byId.get(id)!;
  return draftDisplay(k, x.d, x.mode);
};
const sentenceText = (id: string, index: number) => (show(id).sentenceParts.get(index) ?? []).map((p) => p.text).join("");
// 2회차 녹화에서 나온 단위 겹침·조사 어긋남 모양.
const DUP = /(?:모당|1회|회당)\s*[\d,]+원\/(?:모|회)|원\/회[을은이](?![가-힣])/;

describe("2회차 녹화를 지금 코드로 다시 채움", () => {
  it("통과한 초안 45건 모두 다시 채워지고, 보낼 글·문장에 링크 표기와 단위 겹침이 없다", () => {
    expect(okDrafts).toHaveLength(45);
    for (const { id, d, mode } of okDrafts) {
      const v = draftDisplay(k, d, mode);
      expect([id, v.errors]).toEqual([id, []]);
      expect([id, v.text!.includes("[["), DUP.test(v.text!)]).toEqual([id, false, false]);
      for (const s of d.sentences) {
        const t = (v.sentenceParts.get(s.index) ?? []).map((p) => p.text).join("");
        expect([id, s.index, t.includes("[["), DUP.test(t)]).toEqual([id, s.index, false, false]);
        // 문장 하나씩 채운 것이 전체를 채운 글의 일부와 같다(화면의 ③ 문장과 승인 패널의 글이 어긋나지 않게).
        expect([id, s.index, v.text!.includes(t)]).toEqual([id, s.index, true]);
      }
    }
  });

  it("녹화 때 글에는 결함이 있었다(고친 것이 녹화에서 온 문제임을 고정)", () => {
    expect(byId.get("Q02")!.d.finalText).toContain("모당 2,000원/모");
    expect(byId.get("Q02")!.d.finalText).toContain("30,000원/회을");
    expect(byId.get("Q38")!.d.finalText).toContain("[[booking-policy]]");
  });

  it("가격 문의(Q02): 단위를 한 번만, 한 번만 받는 항목은 단위 없이, 조사는 값에 맞춘다", () => {
    const v = show("Q02");
    expect(v.refilled).toBe(true);
    expect(v.recordedText).toBe(byId.get("Q02")!.d.finalText);
    expect(v.text).toContain("모발이식은 모당 2,000원이며 최소 500모부터 시술합니다.");
    expect(v.text).toContain("첫 상담비는 30,000원입니다.");
    expect(v.text).toContain("첫 상담을 예약할 때 예약금 30,000원을 받습니다.");
    expect(v.fills.map((f) => [f.key, f.value])).toEqual([
      ["graft", "2,000원"],
      ["consult-first", "30,000원"],
      ["deposit-consult", "30,000원"],
    ]);
    expect(sentenceText("Q29", 0)).toBe("두피 주사는 1회 120,000원입니다.");
  });

  it("환자 답장(Q38)의 링크는 문서 제목으로 바꾸고, 보내는 직원이 볼 수 있게 알린다", () => {
    const v = show("Q38");
    expect(v.text).toContain("예약 방법과 예약금은 예약·변경·취소·예약금·환불 규정을 따릅니다.");
    expect(v.patientLinkTitles).toEqual(["예약·변경·취소·예약금·환불 규정"]);
  });

  it("사내 Q&A(G10·G27·G47)의 링크는 ‘문서 제목’으로", () => {
    expect(show("G10").text).toContain("처리합니다(‘예약·변경·취소·예약금·환불 규정’).");
    expect(show("G27").text).toContain("인계 건은 ‘의료진 인계 절차’에 따라");
    expect(show("G47").text).toContain("원문 그대로 기록해 ‘의료진 인계 절차’에 따라");
    expect(show("G10").patientLinkTitles).toEqual([]);
  });

  it("채울 것이 바뀌지 않은 초안은 녹화 때 글 그대로다(다시 채움 표시 없음)", () => {
    const same = okDrafts.filter(({ d, mode }) => !draftDisplay(k, d, mode).refilled).map((x) => x.id);
    expect(same.length).toBe(34);
    for (const id of same) expect(show(id).text).toBe(byId.get(id)!.d.finalText);
  });

  it("다시 채우지 못하면(녹화 뒤 가격표 키가 사라짐) 보낼 글을 만들지 않는다", () => {
    const v = draftDisplay({ ...k, prices: k.prices.filter((p) => p.key !== "graft") }, byId.get("Q02")!.d, "reply");
    expect(v.text).toBeNull();
    expect(v.errors).toEqual(["가격표에 없는 키입니다: graft"]);
  });
});

describe("녹화 뒤 바뀜 검사 — 다시 채우기", () => {
  it("녹화 뒤 가격표 json 값만 바뀌면(첫 상담비 30,000 → 40,000) 경고하고, 화면은 보낼 글을 만들지 않는다(3차 적대 검증)", () => {
    const inputs = realInputs();
    const changed = { ...k, prices: k.prices.map((p) => (p.key === "consult-first" ? { ...p, price: 40000 } : p)) };
    const issues = recordingDrift(rec, changed, inputs.inquiriesJson as never, inputs.goldenJson as never).filter((i) => i.target === "Q02");
    expect(issues.map((i) => i.message)).toContain("녹화 뒤 가격표 값이 바뀌었습니다({{price:consult-first}}: 그때 30,000원/회 → 지금 40,000원)");
    expect(issues.some((i) => i.message.startsWith("지금 가격표 금액이 초안이 인용한 원문과 어긋납니다"))).toBe(true);
    const v = draftDisplay(changed, byId.get("Q02")!.d, "reply");
    expect(v.text).toBeNull();
    expect(v.errors[0]).toContain("consult-first(40,000원)의 금액이 인용한 원문에 없습니다");
  });

  it("채운 글이 녹화 때와 다른 것은 바뀜이 아니다", () => {
    const b = realBundle(recJson, "file");
    // 2회차 녹화의 초안 문장을 다시 채운 결과는 녹화 때와 11건이 다르지만 그것 때문에 생긴 경고는 없다.
    expect(b.recordingIssues.filter((i) => i.message.includes("채울 수 없습니다"))).toEqual([]);
  });

  it("지금 가격표로 칸을 채울 수 없으면 알린다", async () => {
    const inputs = realInputs();
    const fake = parseDemoRecording(
      JSON.parse(
        JSON.stringify(
          await buildFakeRecording(k, inputs.inquiriesJson as { id: string; channel: string; text: string }[], inputs.goldenJson as { id: string; kind: "staff-qa" | "inquiry"; question?: string }[], DEMO_AS_OF),
        ),
      ),
    );
    if (!fake.ok) throw new Error(fake.errors.join("\n"));
    const issues = recordingDrift(fake.value, { ...k, prices: k.prices.filter((p) => p.key !== "graft") }, inputs.inquiriesJson as never, inputs.goldenJson as never);
    expect(issues).toContainEqual({ target: "Q02", message: "지금 가격표·진료시간으로 초안의 칸을 채울 수 없습니다(가격표에 없는 키입니다: graft)" });
  });
});

describe("평가 탭 — 더한 행", () => {
  const b = realBundle(recJson, "file");
  const ms = computeMetrics(k, b.inquiries, b.golden, b.recording);
  const m = (key: string) => ms.find((x) => x.key === key)!;

  it("분류 모델이 인계한 문의를 규칙 인계와 따로 센다(2회차: 분류까지 간 20건 중 4건, 모두 라벨은 인계 아님)", () => {
    expect([m("llm-handover").numerator, m("llm-handover").denominator]).toEqual([4, 20]);
    expect(m("llm-handover").failures.map((f) => f.id)).toEqual(["Q03", "Q10", "Q21", "Q40"]);
    expect(m("llm-handover").failures.find((f) => f.id === "Q10")!.detail).toBe("라벨 경로 draft · 분류 범주 other — 라벨은 인계가 아님");
    // 규칙 인계만 세는 과잉 인계와 겹치지 않는다.
    expect(m("over-handover").failures.map((f) => f.id)).not.toContain("Q10");
    expect([m("llm-handover").target, m("llm-handover").pass]).toEqual(["기록만", null]);
  });

  it("정답 문단 적중은 문서 적중과 같은 문항을 분모로, 더 엄격하게 센다", () => {
    const doc = m("retrieval-hit");
    const chunk = m("retrieval-hit-chunk");
    expect(chunk.denominator).toBe(doc.denominator);
    expect(chunk.numerator!).toBeLessThanOrEqual(doc.numerator!);
    // 문서를 놓친 문항은 문단도 놓친다.
    for (const f of doc.failures) expect(chunk.failures.map((x) => x.id)).toContain(f.id);
    // PRD 7절 지표가 아니다 — 기준을 빌리지 않는다.
    expect([chunk.target, chunk.pass, chunk.verdict.label]).toEqual(["기록만", null, "기록만"]);
  });

  it("정답 문단 적중 값을 고정한다 — 문서 적중으로 세도 테스트가 알게(3차 회귀 변이 A8)", () => {
    const chunk = m("retrieval-hit-chunk");
    expect([chunk.numerator, chunk.denominator]).toEqual([40, 42]);
    // 문서는 맞고 정답 문단만 놓친 문항(G50, 인계 문항)이 있어야 두 지표가 갈린다.
    expect(chunk.failures.map((f) => f.id)).toEqual(["G49", "G50"]);
    expect(m("retrieval-hit").failures.map((f) => f.id)).toEqual(["G49"]);
  });

  it("정답 문단은 골든셋 근거 조각이 든 문단이다", () => {
    const g = (id: string) => b.golden.find((x) => x.id === id)!;
    expect(evidenceChunks(k, g("G13"))).toEqual(["V05#2"]);
    expect(evidenceChunks(k, g("G46"))).toEqual(["V11#4", "V12#2"]);
    // 같은 문단을 가리키는 조각 둘은 한 문단으로 센다.
    expect(evidenceChunks(k, g("G05"))).toEqual(["V02#1"]);
    expect(evidenceChunks(k, g("G31"))).toEqual([]);
  });

  it("녹화가 없으면 분류 인계 행도 'AI 답 준비 전'이다", () => {
    const none = computeMetrics(k, b.inquiries, b.golden, null);
    const row = none.find((x) => x.key === "llm-handover")!;
    expect([row.state, row.numerator]).toEqual(["needs-recording", null]);
  });
});

describe("인계 초안의 승인 문구 따옴표 — 화면 글·보낼 글에서만 뺀다(녹화 파일은 그대로)", () => {
  const message = k.index.rules!.handoverDraft!.fixedMessage!;
  const live = parseDemoRecording(JSON.parse(readFileSync(join(ROOT, "data/demo-responses.json"), "utf8")) as unknown);
  if (!live.ok) throw new Error(live.errors.join("\n"));
  const handoverDrafts = live.value.inquiries.flatMap((r) => (r.handoverDraft ? [{ id: r.id, d: r.handoverDraft.draft }] : []));
  const joined = (v: ReturnType<typeof draftDisplay>, d: DraftResult) => d.sentences.map((x) => (v.sentenceParts.get(x.index) ?? []).map((p) => p.text).join("")).join(" ");

  it("시연 녹화의 통과한 인계 초안: 보낼 글과 문장 표시에 승인 문구를 감싼 따옴표가 없고, 그것만으로 '다시 채움' 표시가 뜨지 않는다", () => {
    // 1차 인계 초안 녹화(2026-09-30)는 20건 모두 승인 문구와 같은 글이고 14건이 큰따옴표로 감쌌다. 다시 녹화한 뒤에도 같은 성질을 본다.
    for (const { id, d } of handoverDrafts.filter((x) => x.d.status === "ok")) {
      const v = draftDisplay(k, d, "reply", { unquote: message });
      expect([id, fixedMessageQuoteIndices(v.text!, message), fixedMessageQuoteIndices(joined(v, d), message), v.refilled]).toEqual([id, [], [], false]);
      expect(v.text!.replace(/[^\p{L}\p{N}]/gu, "")).toContain(message.replace(/[^\p{L}\p{N}]/gu, ""));
    }
  });

  it("감싼 채 녹화된 초안(옛 finalText에 따옴표)도 화면 글·보낼 글에서는 뺀다 — 일반 답장(unquote 없음)은 그대로", async () => {
    const create = async (p: { messages: { content: unknown }[] }) => {
      const docs = (p.messages[0].content as { type: string; source?: { content: { text: string }[] } }[]).filter((c) => c.type === "document");
      const fixed = docs[0].source!.content[0].text;
      const cite = { type: "content_block_location", cited_text: fixed, document_index: 0, start_block_index: 0, end_block_index: 1 };
      return { id: "m", type: "message", role: "assistant", model: "fake-fixture", content: [{ type: "text", text: `"${message}"`, citations: [cite] }], stop_reason: "end_turn", stop_details: null, usage: { input_tokens: 0, output_tokens: 0 } };
    };
    const inquiries = realInputs().inquiriesJson as { id: string; channel: string; text: string }[];
    const hd = await handoverDraftFor({ beta: { messages: { create } } } as unknown as ClaudeClient, k, inquiries.find((q) => q.id === "Q11")!);
    // 1차 녹화처럼 보낼 글에 따옴표가 남은 기록.
    const old: DraftResult = { ...hd.draft, finalText: hd.draft.modelText };
    expect(old.finalText).toBe(`"${message}"`);
    const v = draftDisplay(k, old, "reply", { unquote: message });
    expect([v.text, v.recordedText, v.refilled]).toEqual([message, message, false]);
    expect(joined(v, old)).not.toMatch(/["“”]/);
    expect(draftDisplay(k, old, "reply").text).toBe(`"${message}"`);
  });
});
