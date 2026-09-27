/**
 * 녹화 형식(F18)과 번들 생성 시험. '녹화가 있을 때' 화면은 시험용 가짜 녹화로 확인한다.
 * 가짜 녹화는 scripts/record-demo.ts와 같은 recordAll을 모의 클라이언트로 부르므로 형식이 어긋날 수 없다.
 */

import { describe, expect, it } from "vitest";
import { buildBundle } from "./bundle";
import { DEMO_AS_OF, DEMO_NOW_MS } from "./clock";
import { computeMetrics } from "./evaluation";
import { buildFakeRecording, FAKE_MODEL } from "./fake-recording";
import { buildInboxItem, sortInbox } from "./inbox";
import { readConfirmPolicy, readHandoverPolicy } from "./policy";
import { parseDemoRecording, recordingDrift, type DemoRecording } from "./recording";
import { realBundle, realInputs, realKnowledge } from "./__fixtures__/real";

const k = realKnowledge();
const inputs = realInputs();
const inquiries = inputs.inquiriesJson as { id: string; channel: string; text: string }[];
const golden = inputs.goldenJson as { id: string; kind: "staff-qa" | "inquiry"; question?: string }[];

async function fakeJson(): Promise<unknown> {
  // 파일로 쓰고 읽은 것과 같게 JSON 왕복.
  return JSON.parse(JSON.stringify(await buildFakeRecording(k, inquiries, golden, DEMO_AS_OF)));
}

describe("가짜 녹화 → 녹화 형식 파서", () => {
  it("record-demo와 같은 형식으로 읽힌다", async () => {
    const r = parseDemoRecording(await fakeJson());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.servedModels).toEqual([FAKE_MODEL]);
    expect(r.value.inquiries).toHaveLength(40);
    // 사내 Q&A 녹화는 직원 질문 문항만.
    expect(r.value.golden.map((g) => g.id)).toEqual(golden.filter((g) => g.kind === "staff-qa").map((g) => g.id));
  });

  it("모델을 부르는 건 규칙을 통과한 초안 경로뿐이다(인계·공개 창구엔 분류도 초안도 없다)", async () => {
    const r = parseDemoRecording(await fakeJson());
    if (!r.ok) throw new Error(r.errors.join("\n"));
    const q06 = r.value.inquiries.find((q) => q.id === "Q06")!;
    expect([q06.route.step, q06.classification, q06.draft, q06.postopDay]).toEqual(["handover", null, null, 9]);
    const q04 = r.value.inquiries.find((q) => q.id === "Q04")!;
    expect([q04.route.step, q04.classification]).toEqual(["public-template", null]);
  });

  it("가격 칸(F9)은 코드가 V03에서 넣은 값으로 기록된다", async () => {
    const r = parseDemoRecording(await fakeJson());
    if (!r.ok) throw new Error(r.errors.join("\n"));
    const q02 = r.value.inquiries.find((q) => q.id === "Q02")!.draft!;
    expect(q02.status).toBe("ok");
    expect(q02.fills).toEqual([{ placeholder: "{{price:graft}}", value: "2,000원/모", sourceDoc: "V03", key: "graft" }]);
    expect(q02.finalText).toContain("2,000원/모");
    expect(q02.sentences.filter((s) => s.kind === "cited").every((s) => s.citations.length > 0)).toBe(true);
  });

  it("검증이 막은 초안은 보류 사유와 함께 기록된다(인용 없는 문장, 근거 없음)", async () => {
    const r = parseDemoRecording(await fakeJson());
    if (!r.ok) throw new Error(r.errors.join("\n"));
    const q21 = r.value.inquiries.find((q) => q.id === "Q21")!.draft!;
    expect([q21.status, q21.holdReasons.map((h) => h.code)]).toEqual(["hold", ["uncited-sentence"]]);
    const g32 = r.value.golden.find((g) => g.id === "G32")!.draft;
    expect([g32.status, g32.holdReasons.map((h) => h.code)]).toEqual(["hold", ["no-evidence"]]);
  });

  it("모양이 틀리면 어느 경로가 틀렸는지 알려 준다", async () => {
    const bad = (await fakeJson()) as DemoRecording;
    const broken = { ...bad, inquiries: [{ ...bad.inquiries[0], route: { step: "뭔가" } }] };
    const r = parseDemoRecording(broken);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => e.startsWith("inquiries.0.route"))).toBe(true);
    expect(parseDemoRecording({ fictional: false }).ok).toBe(false);
  });

  it("녹화 뒤에 볼트 문단이 바뀌면 경고한다", async () => {
    const r = parseDemoRecording(await fakeJson());
    if (!r.ok) throw new Error(r.errors.join("\n"));
    const text = new Map(k.chunks.map((c) => [c.chunkId, c.text]));
    expect(recordingDrift(r.value, text)).toEqual([]);
    text.set("V03#1", "바뀐 문단");
    expect(recordingDrift(r.value, text).some((w) => w.includes("V03#1"))).toBe(true);
  });
});

describe("번들 생성", () => {
  it("녹화 파일이 없으면 recording null, 있으면 형식을 확인해 넣는다", async () => {
    expect(realBundle().recording).toBeNull();
    expect(realBundle().recordingSource).toBe("none");
    const b = realBundle(await fakeJson(), "fake-fixture");
    expect(b.recordingSource).toBe("fake-fixture");
    expect(b.recording?.inquiries).toHaveLength(40);
    expect(b.recordingIssues).toEqual([]);
  });

  it("녹화 모양이 틀리면 번들을 만들지 않는다(빈 화면 배포 방지)", () => {
    const r = buildBundle({ ...inputs, recordingJson: { fictional: true } });
    expect(r.ok).toBe(false);
  });

  it("볼트가 깨지면(적신호 목록 문서 없음) 번들을 만들지 않는다", () => {
    const r = buildBundle({ ...inputs, vaultFiles: inputs.vaultFiles.filter((f) => f.path !== "redflags.md"), recordingJson: null });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.includes("V11"))).toBe(true);
  });

  it("창구 지도에 없는 창구의 문의가 있으면 멈춘다", () => {
    const qs = (inputs.inquiriesJson as { channel: string }[]).map((q, i) => (i === 0 ? { ...q, channel: "fax" } : q));
    const r = buildBundle({ ...inputs, inquiriesJson: qs, recordingJson: null });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toContain("Q01: 창구 지도(V19)에 없는 창구 fax");
  });
});

describe("녹화가 있을 때의 목록·평가", () => {
  it("초안 경로 문의의 상태가 녹화된 검증 결과를 따른다", async () => {
    const b = realBundle(await fakeJson(), "fake-fixture");
    const policies = { confirm: readConfirmPolicy(k.chunks), handover: readHandoverPolicy(k.chunks) };
    const rows = sortInbox(
      b.inquiries.map((q) => buildInboxItem(q, k, b.recording!.inquiries.find((r) => r.id === q.id) ?? null, policies, { sent: new Set(), handedOver: new Map() }, DEMO_NOW_MS)),
    );
    const by = new Map(rows.map((r) => [r.id, r]));
    expect(by.get("Q02")!.status).toBe("draft");
    expect(by.get("Q21")!.status).toBe("hold");
    expect(by.get("Q12")!.kind).toBe("shop");
    // 녹화가 있어도 적신호 순서는 그대로.
    expect(rows[0].id).toBe("Q06");
  });

  it("녹화가 있으면 보류 재현율·오보류율·인용 불일치를 분자/분모로 계산한다", async () => {
    const b = realBundle(await fakeJson(), "fake-fixture");
    const ms = computeMetrics(k, b.inquiries, b.golden, b.recording);
    const m = (key: string) => ms.find((x) => x.key === key)!;
    expect(m("hold-recall-nosource").state).toBe("computed");
    // 가짜 녹화는 no-source 핵심어에 '[근거 없음]'으로 답하므로 8/8.
    expect([m("hold-recall-nosource").numerator, m("hold-recall-nosource").denominator]).toEqual([8, 8]);
    expect(m("citation-mismatch").numerator).toBe(0);
    expect(m("false-hold").denominator).toBeGreaterThan(0);
  });
});
