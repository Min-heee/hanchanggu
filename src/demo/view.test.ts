/**
 * 화면 뷰 모델(src/demo/view.ts)·사내 Q&A 판단(src/demo/qa.ts) 시험. 실제 볼트·합성 데이터로 돌린다.
 * 기대값은 손으로 적었다 — "환자에게 보일 문구", "AI에 보냈다고 말해도 되나", "제외 문서를 보이나" 같은
 * 화면 약속이 조용히 바뀌지 않게.
 */

import { describe, expect, it } from "vitest";
import { maskPii } from "../core/mask";
import { analyzeInquiry, analyzeStaffQuestion } from "./analyze";
import { DEMO_NOW_MS } from "./clock";
import { buildFakeRecording } from "./fake-recording";
import { buildInboxItem, handoverInfo } from "./inbox";
import { readConfirmPolicy, readHandoverPolicy } from "./policy";
import { gapDecision, gapEntry, preparedFromParam } from "./qa";
import { parseDemoRecording } from "./recording";
import {
  bandText,
  depositBasis,
  draftSourceLabel,
  handoverCardModel,
  highlightSegments,
  maskedCaseForInquiry,
  maskedCaseForQuestion,
  maskedCaseForTry,
  maskedView,
  postopEditorOpen,
  pricePreview,
  priceSourceChunk,
  recordedRetrievalView,
  relevanceLabel,
  replaceWikiLinks,
  retrievalView,
  snippet,
  staffOriginal,
} from "./view";
import { realBundle, realInputs, realKnowledge } from "./__fixtures__/real";

const k = realKnowledge();
const bundle = realBundle();
const policies = { confirm: readConfirmPolicy(k.chunks), handover: readHandoverPolicy(k.chunks) };
const q = (id: string) => bundle.inquiries.find((x) => x.id === id)!;
const item = (id: string) => buildInboxItem(q(id), k, null, policies, { sent: new Set(), handedOver: new Map() }, DEMO_NOW_MS);
const V12_MESSAGE =
  "보내 주신 내용은 의료진에게 바로 전달했습니다. 의료진이 확인한 뒤 직접 연락드리겠습니다. 숨이 차거나 출혈이 멈추지 않는 등 급한 상황이면 기다리지 마시고 119나 가까운 응급실을 이용해 주세요.";

async function fakeRecording() {
  const inp = realInputs();
  const json = JSON.parse(JSON.stringify(await buildFakeRecording(k, inp.inquiriesJson as never, inp.goldenJson as never, inp.asOf)));
  const r = parseDemoRecording(json);
  if (!r.ok) throw new Error(r.errors.join("\n"));
  return r.value;
}

describe("머리 띠", () => {
  it("AI 답이 없으면 '미리 만든 AI 답'이라고 쓰지 않는다", () => {
    const t = bandText({ recording: null, recordingSource: "none" });
    expect(t.main).toBe("가상 의원 · 합성 데이터");
    expect(t.ai).toBe("AI 초안: 아직 준비 전 · 안전 규칙과 문서 찾기는 지금 동작");
    expect(`${t.main}${t.ai}`).not.toContain("녹화");
  });

  it("AI 답이 있으면 모델과 생성 날짜(KST)를 쓴다 — UTC 날짜를 잘라 쓰면 KST 오전 생성이 전날로 보인다", async () => {
    const rec = { ...(await fakeRecording()), generatedAt: "2026-09-29T23:30:00.000Z", servedModels: ["claude-sonnet-5-5"] };
    const t = bandText({ recording: rec, recordingSource: "file" });
    expect(t.main).toBe("가상 의원 · 합성 데이터 · 미리 만든 AI 답");
    expect(t.ai).toBe("claude-sonnet-5-5 · 2026-09-30 생성");
  });

  it("가짜 AI 답은 표시하고, ③ 설명도 'AI 응답'이라 부르지 않는다", () => {
    expect(bandText({ recording: null, recordingSource: "fake-fixture" }).fake).toBe(true);
    expect(draftSourceLabel("fake-fixture", "fake-fixture", false)).toContain("시험용 가짜 초안(모델 호출 없음)");
    expect(draftSourceLabel("file", "claude-sonnet-5-5", true)).toBe("미리 만든 AI 답 · claude-sonnet-5-5 (대체 모델이 답함)");
  });
});

describe("개인정보 가림 펼치기 — AI를 부르지 않은 곳에서 'AI가 받은 글'이라 하지 않는다", () => {
  it("규칙이 인계한 적신호 문의(Q11): AI에 보내지 않음", () => {
    const a = analyzeInquiry(k, q("Q11").channel, q("Q11").text);
    const v = maskedView(maskedCaseForInquiry("handover", null, a.decision.mask));
    expect(v.summary).toBe("AI에 보내지 않음 — 안전 규칙이 먼저 잡음 (가린 곳 없음)");
    expect(v.note).toContain("보낸다면");
  });

  it("공개 창구(Q04)와 AI 답 준비 전의 초안 경로(Q02), 직접 해 보기", () => {
    const m = maskPii(q("Q04").text);
    expect(maskedView(maskedCaseForInquiry("public-template", null, m)).summary).toMatch(/^AI에 보내지 않음 — 공개 창구는 고정 문구만/);
    expect(maskedView(maskedCaseForInquiry("classify", null, maskPii(q("Q02").text))).summary).toMatch(/^AI에 보낸다면 받을 글/);
    expect(maskedCaseForTry("handover", m).kind).toBe("not-sent");
    expect(maskedCaseForTry("classify", m).kind).toBe("would-send");
  });

  it("AI 답이 있으면 그때 보낸 글을 보이고, 지금 가림 결과와 다르면 경고한다", async () => {
    const rec = await fakeRecording();
    const r17 = rec.inquiries.find((r) => r.id === "Q17")!;
    const live = maskPii(q("Q17").text);
    const same = maskedView(maskedCaseForInquiry(r17.route.step, r17, live));
    expect([same.summary.startsWith("AI가 받은 글 보기"), same.text, same.warn]).toEqual([true, r17.route.maskedText, null]);
    const changed = maskedView(maskedCaseForInquiry(r17.route.step, { ...r17, route: { ...r17.route, maskedText: "옛 가림 결과" } }, live));
    expect([changed.text, changed.compareText, changed.warn !== null]).toEqual(["옛 가림 결과", live.masked, true]);
    // 규칙이 인계한 문의는 녹화가 있어도 AI에 보낸 적이 없다.
    const r06 = rec.inquiries.find((r) => r.id === "Q06")!;
    expect(maskedCaseForInquiry("handover", r06, maskPii(q("Q06").text)).kind).toBe("not-sent");
    const g16 = rec.golden.find((g) => g.id === "G16")!;
    expect(maskedCaseForQuestion(g16, maskPii(g16.question))).toMatchObject({ kind: "recorded", recordedText: g16.maskedQuestion });
    expect(maskedCaseForQuestion(null, maskPii("아무 질문")).kind).toBe("would-send");
  });

  it("직원 화면의 원문 보기에서도 주민번호는 가린다", () => {
    const s = staffOriginal(q("Q17").text);
    expect(s).toContain("[주민번호]");
    expect(s).not.toContain("900101-1234567");
    expect(s).toContain("010-0000-1234");
  });
});

describe("① 문서 찾기 뷰", () => {
  it("관련 있지만 쓰지 않는 문서(옛 판·초안)를 '제외됨'으로 보인다", () => {
    const text = "예약금 환불은 며칠 전까지 취소해야 돼요?";
    const v = retrievalView(k, analyzeInquiry(k, "kakao", text).retrieval!, text);
    expect(v.excluded.map((e) => [e.docId, e.label])).toEqual([
      ["V04b", "제외됨 · 옛 판"],
      ["V20", "제외됨 · 승인 전 초안"],
    ]);
    expect(v.items.map((i) => i.chunkId)).toEqual(["V04#5", "V04#6", "V21#2", "V04#4", "V04#0"]);
    expect(v.items[0].relevance).toBe("높음");
    // 걸린 말을 칠한다(2-gram 조각 대신).
    expect(v.items[0].snippet.filter((s) => s.hit).map((s) => s.text)).toContain("예약금");
  });

  it("문의에서 날짜·칸 이름을 뺀 질의는 그렇다고 적는다", () => {
    const a = analyzeInquiry(k, q("Q01").channel, q("Q01").text);
    expect(retrievalView(k, a.retrieval!, a.decision.mask.masked).queryNote).toBe("날짜·시각·폼 칸 이름·가린 곳은 빼고 찾았습니다.");
    const s = analyzeStaffQuestion(k, "점심시간이 언제예요?");
    expect(retrievalView(k, s.retrieval, s.mask.masked).queryNote).toBeNull();
  });

  it("근거가 약하면(와이파이) weak이고 관련도는 모두 '낮음'", () => {
    const s = analyzeStaffQuestion(k, "대기실 와이파이 비밀번호가 뭐예요?");
    const v = retrievalView(k, s.retrieval, s.mask.masked);
    expect(v.weak).toBe(true);
    expect(new Set(v.items.map((i) => i.relevance))).toEqual(new Set(["낮음"]));
  });

  it("미리 만든 AI 답이 있으면 그때의 순위·제외 문서를 보인다", async () => {
    const rec = await fakeRecording();
    const r = rec.inquiries.find((x) => x.id === "Q02")!;
    const v = recordedRetrievalView(k, { retrieval: r.retrieval!, excludedMatches: r.excludedMatches! }, "reply", r.route.maskedText, r.postopDay);
    expect(v.source).toBe("recorded");
    expect(v.items.map((i) => i.chunkId)).toEqual(r.retrieval!.map((h) => h.chunkId));
    expect(v.excluded.map((e) => e.docId)).toEqual(r.excludedMatches!.map((e) => e.docId));
    // 녹화가 제외 문서를 실제로 남겼는지(가격·예약금 문의라 옛 판 예약 규정과 미승인 이벤트 초안이 걸린다).
    expect(r.excludedMatches!.map((e) => [e.docId, e.reason])).toEqual([
      ["V04b", "superseded"],
      ["V20", "draft"],
    ]);
    expect(v.excluded.map((e) => e.label)).toEqual(["제외됨 · 옛 판", "제외됨 · 승인 전 초안"]);
    const gone = recordedRetrievalView(k, { retrieval: [{ chunkId: "V99#1", score: 20 }], excludedMatches: [] }, "reply", "x", null);
    expect(gone.missing).toEqual(["V99#1"]);
  });

  it.each([
    [25, false, "높음"],
    [12, false, "보통"],
    [4, false, "낮음"],
    [0, true, "경과일 구간"],
    [20, true, "높음"],
  ] as const)("관련도: 점수 %d, 경과일 %s → %s", (score, boost, label) => {
    expect(relevanceLabel(score, boost)).toBe(label);
  });

  it("칠하기: 이어진 두 글자 조각은 한 덩어리, 흔한 조각은 뺀다", () => {
    expect(highlightSegments("모발이식은 모당 2,000원입니다.", "모당 가격")).toEqual([
      { text: "모발이식은 ", hit: false },
      { text: "모당", hit: true },
      { text: " 2,000원입니다.", hit: false },
    ]);
    expect(highlightSegments("수술 후 관리", "수술 후", (t) => t === "g:수술").every((s) => !s.hit || s.text !== "수술")).toBe(true);
    const long = highlightSegments(`${"가".repeat(100)}모당${"나".repeat(100)}`, "모당");
    const cut = snippet(long, 40);
    expect(cut.map((s) => s.text).join("")).toContain("모당");
    expect(cut[0].text).toBe("…");
  });

  it("문서 링크([[파일]])는 문서 제목으로", () => {
    expect(replaceWikiLinks("정기 경과 진료 일정은 [[postop-care]]를 봅니다.", k)).toBe("정기 경과 진료 일정은 ‘모발이식 수술 후 날짜별 관리’를 봅니다.");
    expect(replaceWikiLinks("[[없는-파일]]", k)).toBe("‘없는-파일’");
  });
});

describe("가격 칸(F9)", () => {
  it("AI 답 전에도 가격 문의(Q02)의 가격 칸을 가격표 값으로 미리 보인다", () => {
    const a = analyzeInquiry(k, q("Q02").channel, q("Q02").text);
    const p = pricePreview(k, a.decision.mask.masked, a.retrieval!.hits.map((h) => h.chunk.docId));
    expect(p.map((x) => [x.placeholder, x.value, x.chunkId])).toEqual([
      ["{{price:consult-first}}", "30,000원/회", "V03#1"],
      ["{{price:graft}}", "2,000원/모", "V03#2"],
      ["{{price:deposit-consult}}", "30,000원/회", "V03#1"],
    ]);
  });

  it("검색에 가격표가 없으면 미리보기도 없다", () => {
    expect(pricePreview(k, "모당 얼마예요", ["V07"])).toEqual([]);
  });

  it("가격 칸을 누르면 칠할 가격표 문단", () => {
    expect([priceSourceChunk(k, "graft"), priceSourceChunk(k, "consult-first"), priceSourceChunk(k, "postop-visit"), priceSourceChunk(k, null)]).toEqual([
      "V03#2",
      "V03#1",
      null,
      null,
    ]);
  });
});

describe("인계 카드 뷰 모델(F6)", () => {
  it("Q11: 환자에게 보낼 문구는 V12 승인 문구 그대로, 시한은 기준 시각으로, 시한 당시 담당과 지금 담당을 함께", () => {
    const a = analyzeInquiry(k, q("Q11").channel, q("Q11").text);
    const m = handoverCardModel(a.decision, item("Q11").handover, policies.handover, DEMO_NOW_MS, k.titles);
    expect(m.patientMessage).toEqual({ text: V12_MESSAGE, source: "의료진 인계 절차의 고정 안내 문장" });
    expect(m.rules).toEqual([{ id: "RF-03", text: "애매한 표현과 수술 뒤라는 말이 함께 있음 → 인계" }]);
    expect(m.deadline).toEqual({ rule: "받은 뒤 5분 안에 의료진에게 인계", until: "9/20(일) 07:47까지", overdue: "시한 1일 2시간 지남", remaining: null });
    expect([m.roleNow, m.roleAtDeadline, m.openNow]).toEqual(["담당 간호사", "당직 의료진 연락망", true]);
  });

  it("V12에서 문구를 읽지 못하면 null — 지어내지 않는다", () => {
    const a = analyzeInquiry(k, q("Q11").channel, q("Q11").text);
    const m = handoverCardModel(a.decision, item("Q11").handover, { ...policies.handover, patientMessage: null }, DEMO_NOW_MS, k.titles);
    expect(m.patientMessage).toBeNull();
  });

  it("직접 해 보기(지금 받은 문장): 시한이 남아 있고 담당은 하나", () => {
    const a = analyzeInquiry(k, "kakao", "이식한 지 열흘인데 부위가 뜨겁고 누르면 아파요");
    const m = handoverCardModel(a.decision, handoverInfo(DEMO_NOW_MS, null, policies.handover, k, DEMO_NOW_MS), policies.handover, DEMO_NOW_MS, k.titles);
    expect(m.deadline).toEqual({ rule: "받은 뒤 5분 안에 의료진에게 인계", until: "9/21(월) 10:05까지", overdue: null, remaining: "5분 남음" });
    expect(m.roleAtDeadline).toBeNull();
    expect(m.patientMessage?.text).toBe(V12_MESSAGE);
  });

  it("약 문의(Q25)는 MED-01", () => {
    const a = analyzeInquiry(k, q("Q25").channel, q("Q25").text);
    const m = handoverCardModel(a.decision, item("Q25").handover, policies.handover, DEMO_NOW_MS, k.titles);
    expect(m.rules.map((r) => r.id)).toEqual(["MED-01"]);
    expect(m.medTerms.length).toBeGreaterThan(0);
  });
});

describe("확정 대기·상세 배치", () => {
  it("안내 종류별 근거 규정 문단은 예약 규정(V04)에서만", () => {
    expect(depositBasis(k, "confirm").map((c) => c.chunkId)).toEqual(["V04#2", "V04#3"]);
    expect(depositBasis(k, "change").map((c) => c.chunkId)).toEqual(["V04#0", "V04#4"]);
    expect(depositBasis(k, "refund").map((c) => c.chunkId)).toEqual(["V04#5", "V04#6"]);
  });

  it("경과일 편집은 읽은 값이 있거나 고쳤거나 인계 건일 때만 펼친다", () => {
    expect(postopEditorOpen("classify", null, false)).toBe(false); // 예약금·가격 문의
    expect(postopEditorOpen("public-template", null, false)).toBe(false);
    expect(postopEditorOpen("classify", 7, false)).toBe(true);
    expect(postopEditorOpen("classify", null, true)).toBe(true);
    expect(postopEditorOpen("handover", null, false)).toBe(true);
  });
});

describe("사내 Q&A — 문서 빈칸 자동 추가", () => {
  it("근거 약함이면 AI 답 없이도 쌓는다(와이파이)", () => {
    const a = analyzeStaffQuestion(k, "대기실 와이파이 비밀번호가 뭐예요?");
    expect(gapDecision(a.retrieval, null)).toEqual({ add: true, reason: "근거 약함 — 찾은 문단의 관련도가 낮음" });
  });

  it("근거가 있어 보이는 질문은 AI 답이 없으면 쌓지 않는다(실손보험은 AI 답이 '근거 없음'이어야 쌓임)", () => {
    const a = analyzeStaffQuestion(k, "모발이식 수술도 실손보험 적용돼요?");
    expect(gapDecision(a.retrieval, null)).toEqual({ add: false });
    expect(gapDecision(analyzeStaffQuestion(k, "수술 3일째 환자가 머리를 감아도 되냐고 물으면 뭐라고 해요?").retrieval, null)).toEqual({ add: false });
  });

  it("미리 만든 AI 답이 '근거 없음'이면 쌓는다", async () => {
    const rec = await fakeRecording();
    const g32 = rec.golden.find((g) => g.id === "G32")!;
    const a = analyzeStaffQuestion(k, g32.question);
    expect(gapDecision(a.retrieval, g32)).toEqual({ add: true, reason: "AI가 '근거 없음'으로 답함(미리 만든 답)" });
  });

  it("빈칸에는 가린 질문만 남긴다", () => {
    const g = gapEntry(maskPii("김철수님 010-1234-5678 환자 주차 정산은?"), "t", "r");
    expect(g.question).not.toContain("010-1234-5678");
    expect(g.masked).toBeGreaterThan(0);
  });

  it("?q= 링크는 준비된 직원 질문 ID만 받는다", () => {
    expect(preparedFromParam(bundle.golden, "G16")?.question).toBe("수술 3일째 환자가 머리를 감아도 되냐고 물으면 뭐라고 해요?");
    expect(preparedFromParam(bundle.golden, "g38")?.id).toBe("G38");
    expect(preparedFromParam(bundle.golden, "G28")).toBeNull(); // 문의 문항
    expect(preparedFromParam(bundle.golden, "아무 문장")).toBeNull();
    expect(preparedFromParam(bundle.golden, null)).toBeNull();
  });
});
