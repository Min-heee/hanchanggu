/**
 * 녹화 형식(F18)과 번들 생성 시험. '녹화가 있을 때' 화면은 시험용 가짜 녹화로 확인한다.
 * 가짜 녹화는 scripts/record-demo.ts와 같은 recordAll을 모의 클라이언트로 부르므로 형식이 어긋날 수 없다.
 */

import { describe, expect, it } from "vitest";
import { buildBundle, recordingGuard } from "./bundle";
import { recordingDrift } from "./drift";
import { DEMO_AS_OF, DEMO_NOW_MS } from "./clock";
import { computeMetrics } from "./evaluation";
import { buildFakeRecording, FAKE_MODEL } from "./fake-recording";
import { buildInboxItem, inboxSummary, sortInbox } from "./inbox";
import { readConfirmPolicy, readHandoverPolicy } from "./policy";
import { parseDemoRecording, type DemoRecording } from "./recording";
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
    expect(r.value.inquiries).toHaveLength(41);
    // 사내 Q&A 녹화는 직원 질문 문항만.
    expect(r.value.golden.map((g) => g.id)).toEqual(golden.filter((g) => g.kind === "staff-qa").map((g) => g.id));
  });

  it("분류는 규칙을 통과한 초안 경로만 — 인계·공개 창구엔 분류도 직원이 보낼 초안(draft)도 없다", async () => {
    const r = parseDemoRecording(await fakeJson());
    if (!r.ok) throw new Error(r.errors.join("\n"));
    const q06 = r.value.inquiries.find((q) => q.id === "Q06")!;
    expect([q06.route.step, q06.classification, q06.draft, q06.postopDay]).toEqual(["handover", null, null, 9]);
    const q04 = r.value.inquiries.find((q) => q.id === "Q04")!;
    expect([q04.route.step, q04.classification, q04.draft, q04.handoverDraft]).toEqual(["public-template", null, null, null]);
    // 인계 문의는 늘 draft null — 의료진 확인용 초안은 handoverDraft에만 있어 직원 발송 경로와 섞이지 않는다.
    expect(r.value.inquiries.filter((x) => x.route.step === "handover").every((x) => x.draft === null)).toBe(true);
  });

  it("인계 문의(Q06)에는 의료진 확인용 초안(PRD v0.3): 인계 문서 묶음만 인용하고, 첫 문서 블록이 V12 고정 안내 문단", async () => {
    const r = parseDemoRecording(await fakeJson());
    if (!r.ok) throw new Error(r.errors.join("\n"));
    const hd = r.value.inquiries.find((q) => q.id === "Q06")!.handoverDraft!;
    expect(hd.draft.status).toBe("ok");
    expect(hd.draft.documents.every((d) => k.handoverAllowedDocIds.has(d.docId))).toBe(true);
    expect(hd.draft.documents[0].blocks[0].chunkId).toBe(k.index.rules!.handoverDraft!.fixedChunkId);
    // V12에서는 고정 안내 문단 하나만 보낸다(나머지는 직원이 할 일).
    expect(hd.draft.documents.find((d) => d.docId === "V12")!.blocks.map((b) => b.chunkId)).toEqual(["V12#4"]);
    expect(hd.retrieval[0]).toMatchObject({ chunkId: "V12#4", pin: "handover" });
    expect(hd.maskedText).toBe(r.value.inquiries.find((q) => q.id === "Q06")!.route.maskedText);
    // 통과한 초안은 고정 안내 문장을 인용한다.
    expect(hd.draft.sentences.some((x) => x.citations.some((c) => c.chunkIds.includes("V12#4")))).toBe(true);
  });

  it("의료진 확인용 초안은 인계 경로이고 직원이 보낼 초안(draft)이 없는 기록에만 — 아니면 파일 모양 오류로 멈춘다", async () => {
    type Rec = { id: string; draft: unknown; handoverDraft?: unknown };
    const json = (await fakeJson()) as { inquiries: Rec[] };
    const hd = json.inquiries.find((x) => x.id === "Q06")!.handoverDraft;
    const q02Draft = json.inquiries.find((x) => x.id === "Q02")!.draft;
    expect(q02Draft).not.toBeNull();
    const onDraftPath = JSON.parse(JSON.stringify(json)) as { inquiries: Rec[] };
    onDraftPath.inquiries.find((x) => x.id === "Q02")!.handoverDraft = hd;
    const r1 = parseDemoRecording(onDraftPath);
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.errors.join("\n")).toContain("의료진 확인용 초안은 인계 경로에만 있어야 합니다(지금 draft)");
    const both = JSON.parse(JSON.stringify(json)) as { inquiries: Rec[] };
    both.inquiries.find((x) => x.id === "Q06")!.draft = q02Draft;
    const r2 = parseDemoRecording(both);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.errors.join("\n")).toContain("직원이 보낼 초안(draft)이 함께 있습니다");
  });

  it("공개 창구 인계(Q16 유튜브 댓글)와 초안 경로 문의(Q02)에는 인계 초안이 없다(null)", async () => {
    const r = parseDemoRecording(await fakeJson());
    if (!r.ok) throw new Error(r.errors.join("\n"));
    const q16 = r.value.inquiries.find((q) => q.id === "Q16")!;
    expect([q16.route.step, q16.handoverDraft]).toEqual(["handover", null]);
    expect(r.value.inquiries.find((q) => q.id === "Q02")!.handoverDraft).toBeNull();
  });

  it("가격 칸(F9)은 코드가 V03에서 넣은 값으로 기록된다", async () => {
    const r = parseDemoRecording(await fakeJson());
    if (!r.ok) throw new Error(r.errors.join("\n"));
    const q02 = r.value.inquiries.find((q) => q.id === "Q02")!.draft!;
    expect(q02.status).toBe("ok");
    // 가짜 모델은 가격표 문장("모발이식은 모당 2,000원이며…")의 금액만 칸으로 바꿔 인용한다. 같은 절에 "모당"이 있어 "/모"는 붙지 않는다.
    expect(q02.fills).toEqual([{ placeholder: "{{price:graft}}", value: "2,000원", sourceDoc: "V03", key: "graft" }]);
    expect(q02.finalText).toContain("모당 2,000원이며");
    expect(q02.sentences.find((s) => s.text.includes("{{price:graft}}"))?.kind).toBe("cited");
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

  it("근거가 약하면(PRD F7) 모델을 부르지 않고 보류로 기록한다", async () => {
    const r = parseDemoRecording(await fakeJson());
    if (!r.ok) throw new Error(r.errors.join("\n"));
    for (const id of ["G34", "G36", "G38"]) {
      const d = r.value.golden.find((g) => g.id === id)!.draft;
      expect([id, d.status, d.holdReasons.map((h) => h.code), d.meta.model, d.documents]).toEqual([id, "hold", ["weak-retrieval"], null, []]);
    }
    // 대본 질문(G16)은 근거가 있어 모델을 부른다.
    expect(r.value.golden.find((g) => g.id === "G16")!.draft.meta.model).toBe(FAKE_MODEL);
  });

  it("사내 Q&A 녹화는 모델에 보낸 가린 질문을 남긴다", async () => {
    const r = parseDemoRecording(await fakeJson());
    if (!r.ok) throw new Error(r.errors.join("\n"));
    const g16 = r.value.golden.find((g) => g.id === "G16")!;
    expect(g16.maskedQuestion).toBe(g16.question);
  });

  it("parse 결과는 파일에서 읽은 값과 같다 — 스키마가 조용히 버리는 키가 없다", async () => {
    const json = await fakeJson();
    const r = parseDemoRecording(json);
    if (!r.ok) throw new Error(r.errors.join("\n"));
    expect(r.value).toEqual(json);
  });

  it("쓰는 쪽이 스키마에 없는 필드를 더하면 읽기가 멈춘다(strict)", async () => {
    const json = (await fakeJson()) as DemoRecording;
    const withExtra = { ...json, inquiries: [{ ...json.inquiries[0], maskVersion: "v2" }, ...json.inquiries.slice(1)] };
    const r = parseDemoRecording(withExtra);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.startsWith("inquiries.0"))).toBe(true);
    const draftExtra = { ...json, golden: [{ ...json.golden[0], draft: { ...json.golden[0].draft, intent: "confirm" } }, ...json.golden.slice(1)] };
    expect(parseDemoRecording(draftExtra).ok).toBe(false);
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

});

describe("녹화와 지금 코드·데이터의 어긋남(drift)", () => {
  it("녹화 직후에는 어긋남이 없다", async () => {
    const b = realBundle(await fakeJson(), "fake-fixture");
    expect(b.recordingIssues).toEqual([]);
  });

  it("녹화 뒤 볼트에 답 문단을 더하면(주차 정산) 그 문의의 ①이 바뀐 것을 잡는다", async () => {
    const json = await fakeJson();
    const vaultFiles = inputs.vaultFiles.map((f) =>
      f.path === "hours-location.md"
        ? { ...f, raw: f.raw.replace("## 기계가 읽는 값", "## 주차 정산\n\n주차는 2시간 무료이고 정산은 1층 안내 데스크에서 합니다.\n\n## 기계가 읽는 값") }
        : f,
    );
    const r = buildBundle({ ...inputs, vaultFiles, recordingJson: json, recordingSource: "fake-fixture" });
    if (!r.ok) throw new Error(r.errors.join("\n"));
    const q18 = r.bundle.recordingIssues.filter((i) => i.target === "Q18").map((i) => i.message);
    expect(q18).toContain("문서 찾기(①) 결과가 그때와 다릅니다");
  });

  it("문의 원문을 고치면 AI가 받은 글이 다르다고 잡는다", async () => {
    const json = await fakeJson();
    const qs = (inputs.inquiriesJson as { id: string; text: string }[]).map((q) => (q.id === "Q02" ? { ...q, text: "수술 후 머리는 언제 감아요?" } : q));
    const r = buildBundle({ ...inputs, inquiriesJson: qs, recordingJson: json, recordingSource: "fake-fixture" });
    if (!r.ok) throw new Error(r.errors.join("\n"));
    const q02 = r.bundle.recordingIssues.filter((i) => i.target === "Q02").map((i) => i.message);
    expect(q02).toContain("AI가 받은 글(문의 원문 또는 개인정보 가림 결과)이 지금과 다릅니다");
  });

  it("인계 초안: 녹화 뒤 V12 고정 안내 문단이 바뀌면 잡고, 문의 원문을 고치면 인계 초안의 가린 글도 잡는다", async () => {
    const r = parseDemoRecording(await fakeJson());
    if (!r.ok) throw new Error(r.errors.join("\n"));
    const chunks = k.chunks.map((c) => (c.chunkId === "V12#4" ? { ...c, text: "바뀐 고정 안내" } : c));
    const issues = recordingDrift(r.value, { ...k, chunks }, inquiries, golden);
    expect(issues.some((i) => i.target === "Q06" && i.message.startsWith("의료진 확인용 초안:") && i.message.includes("V12#4") && i.message.includes("바뀌었습니다"))).toBe(true);
    const qs = inquiries.map((q) => (q.id === "Q06" ? { ...q, text: `${q.text} 010-1234-5678` } : q));
    const moved = recordingDrift(r.value, k, qs, golden).filter((i) => i.target === "Q06").map((i) => i.message);
    expect(moved).toContain("의료진 확인용 초안: AI가 받은 글(문의 원문 또는 개인정보 가림 결과)이 지금과 다릅니다");
  });

  it("인계 초안: 녹화 뒤 승인 문구나 약·증상 말 목록이 바뀌어 지금 검사로는 보류되는 초안을 잡는다", async () => {
    const r = parseDemoRecording(await fakeJson());
    if (!r.ok) throw new Error(r.errors.join("\n"));
    expect(recordingDrift(r.value, k, inquiries, golden).filter((i) => i.message.includes("지금 인계 초안 검사로는"))).toEqual([]);
    const rules = k.index.rules!;
    const changed = { ...k, index: { ...k.index, rules: { ...rules, handoverDraft: { ...rules.handoverDraft!, fixedMessage: "의료진이 곧 전화드립니다." } } } };
    const q06 = recordingDrift(r.value, changed, inquiries, golden).filter((i) => i.target === "Q06").map((i) => i.message);
    expect(q06).toContain("의료진 확인용 초안: 지금 인계 초안 검사로는 보류됩니다(handover-no-fixed-message)");
  });

  it("초안이 쓴 문단이 바뀌거나 사라지면 잡는다", async () => {
    const r = parseDemoRecording(await fakeJson());
    if (!r.ok) throw new Error(r.errors.join("\n"));
    const chunks = k.chunks.map((c) => (c.chunkId === "V03#2" ? { ...c, text: "바뀐 문단" } : c));
    const issues = recordingDrift(r.value, { ...k, chunks }, inquiries, golden);
    expect(issues.some((i) => i.target === "Q02" && i.message.includes("V03#2"))).toBe(true);
  });

  it("녹화의 볼트 기준일이 시연 기준일과 다르면 번들을 만들지 않는다", async () => {
    const json = { ...((await fakeJson()) as DemoRecording), vaultAsOf: "2026-09-28" };
    const r = buildBundle({ ...inputs, recordingJson: json });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.includes("기준일"))).toBe(true);
  });
});

describe("배포 빌드의 녹화 확인(recordingGuard)", () => {
  const base = { fakeRequested: false, hasRecordingFile: true, forBuild: false, vercel: undefined, vercelEnv: undefined, ci: undefined };
  it.each([
    ["로컬 개발, 녹화 없음", { hasRecordingFile: false }, true],
    ["로컬 빌드, 녹화 없음", { hasRecordingFile: false, forBuild: true }, true],
    ["Vercel 미리 보기, 녹화 없음", { hasRecordingFile: false, vercel: "1", vercelEnv: "preview" }, true],
    ["Vercel 공개 배포, 녹화 없음", { hasRecordingFile: false, vercel: "1", vercelEnv: "production" }, false],
    ["CI, 녹화 없음", { hasRecordingFile: false, ci: "true" }, false],
    ["Vercel 공개 배포, 녹화 있음", { vercel: "1", vercelEnv: "production" }, true],
    ["가짜 녹화 + npm run dev", { fakeRequested: true }, true],
    ["가짜 녹화 + npm run build", { fakeRequested: true, forBuild: true }, false],
    ["가짜 녹화 + Vercel 미리 보기", { fakeRequested: true, vercel: "1", vercelEnv: "preview" }, false],
    ["가짜 녹화 + CI", { fakeRequested: true, ci: "1" }, false],
  ] as const)("%s → 통과 %s", (_, env, ok) => {
    expect(recordingGuard({ ...base, ...env }).ok).toBe(ok);
  });
});

describe("번들 생성", () => {
  it("공개 번들에는 화면이 읽지 않는 라벨 설명(notes)을 싣지 않는다", () => {
    const b = realBundle();
    expect(b.inquiries.every((q) => !("notes" in q.labels))).toBe(true);
    expect(b.golden.every((g) => !("notes" in g))).toBe(true);
    expect(JSON.stringify(b)).not.toContain('"notes":');
  });

  it("녹화 파일이 없으면 recording null, 있으면 형식을 확인해 넣는다", async () => {
    expect(realBundle().recording).toBeNull();
    expect(realBundle().recordingSource).toBe("none");
    const b = realBundle(await fakeJson(), "fake-fixture");
    expect(b.recordingSource).toBe("fake-fixture");
    expect(b.recording?.inquiries).toHaveLength(41);
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

  it("인계 초안을 더해도 기존 지표(적신호 누락·과잉 인계·오보류·보류 재현율·인용 불일치 등)와 목록 상태는 한 글자도 바뀌지 않는다", async () => {
    const withDrafts = realBundle(await fakeJson(), "fake-fixture");
    const json = (await fakeJson()) as DemoRecording;
    const stripped = {
      ...json,
      inquiries: json.inquiries.map((x) => {
        const { handoverDraft: _hd, ...rest } = x;
        void _hd;
        return rest;
      }),
    };
    const without = realBundle(stripped, "fake-fixture");
    expect(withDrafts.recording!.inquiries.filter((x) => x.handoverDraft).length).toBeGreaterThan(10);
    const pick = (ms: ReturnType<typeof computeMetrics>) =>
      ms.filter((m) => m.key !== "handover-draft").map((m) => [m.key, m.numerator, m.denominator, m.failures, m.state]);
    const a = computeMetrics(k, withDrafts.inquiries, withDrafts.golden, withDrafts.recording, "fake-fixture");
    const b = computeMetrics(k, without.inquiries, without.golden, without.recording, "fake-fixture");
    expect(pick(a)).toEqual(pick(b));
    const m = (key: string) => a.find((x) => x.key === key)!;
    expect([m("redflag-miss").numerator, m("redflag-miss").denominator]).toEqual([0, 15]);
    expect([m("over-handover").numerator, m("over-handover").denominator]).toEqual([1, 25]);
    // 인계 초안 지표는 따로 센다: 가짜 녹화에서는 인계 초안이 모두 통과, 없으면 '녹화 전'.
    expect([m("handover-draft").state, m("handover-draft").numerator === m("handover-draft").denominator]).toEqual(["computed", true]);
    expect(b.find((x) => x.key === "handover-draft")!.state).toBe("needs-recording");
    // 목록: 행의 경로·유형·상태·묶음과 요약이 같다(인계는 여전히 '인계 필요').
    const policies = { confirm: readConfirmPolicy(k.chunks), handover: readHandoverPolicy(k.chunks) };
    const rows = (bb: typeof withDrafts) =>
      bb.inquiries.map((q) => buildInboxItem(q, k, bb.recording!.inquiries.find((r) => r.id === q.id) ?? null, policies, { sent: new Set(), handedOver: new Map() }, DEMO_NOW_MS));
    const shape = (xs: ReturnType<typeof rows>) => xs.map((x) => [x.id, x.step, x.kind, x.status, x.group]);
    expect(shape(rows(withDrafts))).toEqual(shape(rows(without)));
    expect(inboxSummary(rows(withDrafts))).toEqual(inboxSummary(rows(without)));
    expect(rows(withDrafts).find((x) => x.id === "Q06")!.status).toBe("handover-needed");
  });

  it("오보류·보류 재현율은 직원이 보낼 초안(draft)만 본다 — 인계 문의를 가리키는 답할 수 있는 합성 문항은 인계 초안이 통과해도 보류로 센다", async () => {
    // 지금 골든셋에서 인계 문의를 가리키는 문항(G48~G50)은 모두 mustHold라 오보류 분모에 없다. 합성 문항으로 draftOf가 handoverDraft를 읽지 않는지 고정한다.
    const b = realBundle(await fakeJson(), "fake-fixture");
    expect(b.recording!.inquiries.find((r) => r.id === "Q06")!.handoverDraft!.draft.status).toBe("ok");
    const base = b.golden.find((g) => g.kind === "inquiry")!;
    const synthetic = { ...base, id: "GX", inquiryId: "Q06", mustHold: false, holdReason: null, mustHandover: false };
    const ms = computeMetrics(k, b.inquiries, [...b.golden, synthetic], b.recording, "fake-fixture");
    expect(ms.find((m) => m.key === "false-hold")!.failures.find((f) => f.id === "GX")?.detail).toBe("초안 경로가 아님");
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
