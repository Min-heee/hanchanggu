/**
 * 화면 뷰 모델(src/demo/view.ts)·사내 Q&A 판단(src/demo/qa.ts) 시험. 실제 볼트·합성 데이터로 돌린다.
 * 기대값은 손으로 적었다 — "환자에게 보일 문구", "AI에 보냈다고 말해도 되나", "제외 문서를 보이나" 같은
 * 화면 약속이 조용히 바뀌지 않게.
 */

import { describe, expect, it } from "vitest";
import { buildKnowledge } from "../core/knowledge";
import { checkMedication } from "../core/medication";
import { maskPii } from "../core/mask";
import { retrieve } from "../core/retrieve";
import { decideRoute, handoverDraftAllowed } from "../core/route";
import { loadVault } from "../core/vault";
import { analyzeInquiry, analyzeStaffQuestion } from "./analyze";
import { DEMO_AS_OF, DEMO_NOW_MS } from "./clock";
import { buildFakeRecording } from "./fake-recording";
import { buildInboxItem, handoverInfo } from "./inbox";
import { readConfirmPolicy, readHandoverPolicy } from "./policy";
import { gapDecision, gapEntry, preparedFromParam, staffRuleCard } from "./qa";
import { parseDemoRecording } from "./recording";
import {
  bandText,
  depositBasis,
  draftSourceLabel,
  HANDOVER_DRAFT_NOTE,
  handoverCardModel,
  handoverDraftNotice,
  handoverDraftView,
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
  const allowedOf = (id: string) => handoverDraftAllowed(analyzeInquiry(k, q(id).channel, q(id).text).decision);

  it("규칙이 인계한 적신호 문의(Q11): 인계 초안(PRD v0.3)을 위해 AI에 보내는 경로 — 녹화 전이면 '보낸다면'", () => {
    const a = analyzeInquiry(k, q("Q11").channel, q("Q11").text);
    const v = maskedView(maskedCaseForInquiry("handover", null, a.decision.mask, allowedOf("Q11")));
    expect(v.summary).toBe("AI에 보낸다면 받을 글 (가린 곳 없음)");
    expect(v.summary).not.toContain("AI가 받은 글");
    expect(v.note).toContain("보낸다면");
  });

  it("공개 창구 인계(Q16 유튜브 댓글)는 인계 초안을 만들지 않아 AI에 보내지 않는다", () => {
    const a = analyzeInquiry(k, q("Q16").channel, q("Q16").text);
    expect(a.decision.step).toBe("handover");
    expect(allowedOf("Q16")).toEqual({ ok: false, why: "public" });
    expect(maskedView(maskedCaseForInquiry("handover", null, a.decision.mask, allowedOf("Q16"))).summary).toMatch(/^AI에 보내지 않음 — 공개 창구는 고정 문구만/);
    expect(maskedCaseForTry("handover", a.decision.mask, allowedOf("Q16")).kind).toBe("not-sent");
  });

  it("공개 창구(Q04)와 AI 답 준비 전의 초안 경로(Q02), 직접 해 보기", () => {
    const m = maskPii(q("Q04").text);
    const notHandover = { ok: false, why: "not-handover" } as const;
    expect(maskedView(maskedCaseForInquiry("public-template", null, m, notHandover)).summary).toMatch(/^AI에 보내지 않음 — 공개 창구는 고정 문구만/);
    expect(maskedView(maskedCaseForInquiry("classify", null, maskPii(q("Q02").text), notHandover)).summary).toMatch(/^AI에 보낸다면 받을 글/);
    // 직접 해 보기의 인계 문장도 이 화면에서는 AI를 부르지 않지만, 준비된 인계 문의라면 인계 초안을 위해 보낼 글이다.
    expect(maskedCaseForTry("handover", m, { ok: true }).kind).toBe("would-send");
    expect(maskedCaseForTry("classify", m, notHandover).kind).toBe("would-send");
    expect(maskedCaseForTry("public-template", m, notHandover).kind).toBe("not-sent");
  });

  it("AI 답이 있으면 그때 보낸 글을 보이고, 지금 가림 결과와 다르면 경고한다", async () => {
    const rec = await fakeRecording();
    const r17 = rec.inquiries.find((r) => r.id === "Q17")!;
    const live = maskPii(q("Q17").text);
    const notHandover = { ok: false, why: "not-handover" } as const;
    const same = maskedView(maskedCaseForInquiry(r17.route.step, r17, live, notHandover));
    expect([same.summary.startsWith("AI가 받은 글 보기"), same.text, same.warn]).toEqual([true, r17.route.maskedText, null]);
    const changed = maskedView(maskedCaseForInquiry(r17.route.step, { ...r17, route: { ...r17.route, maskedText: "옛 가림 결과" } }, live, notHandover));
    expect([changed.text, changed.compareText, changed.warn !== null]).toEqual(["옛 가림 결과", live.masked, true]);
    // 규칙이 인계한 문의(Q06)는 분류 없이 인계 초안 때만 AI에 보냈다 — 그때 보낸 가린 글을 보인다.
    const r06 = rec.inquiries.find((r) => r.id === "Q06")!;
    const c06 = maskedCaseForInquiry("handover", r06, maskPii(q("Q06").text), { ok: true });
    expect(c06).toMatchObject({ kind: "recorded", recordedText: r06.handoverDraft!.maskedText });
    // 인계 초안 키가 없는 녹화(4회차처럼 이 기능 전) → 아직 보낸 적 없음, '보낸다면'.
    const { handoverDraft: _hd, ...r06Old } = r06;
    void _hd;
    expect(maskedCaseForInquiry("handover", r06Old, maskPii(q("Q06").text), { ok: true }).kind).toBe("would-send");
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

  it("직원 질문에서 규칙으로 앞에 세운 문단은 '낮음' 대신 까닭을 보인다(3차 회귀 확인: G46 1~3위가 '관련도 낮음'으로 보였다)", () => {
    const s = analyzeStaffQuestion(k, "수술 2주째 환자가 이식 부위에서 고름이 나온다는데 연고 바르라고 해도 돼요?");
    const v = retrievalView(k, s.retrieval, s.mask.masked);
    expect(v.items.slice(0, 3).map((i) => [i.chunkId, i.pin, i.relevance])).toEqual([
      ["V11#4", "redflag", "규칙으로 앞에 섬"],
      ["V17#1", "medication", "규칙으로 앞에 섬"],
      ["V12#2", "handover", "규칙으로 앞에 섬"],
    ]);
    expect(relevanceLabel(20, false, "handover")).toBe("높음");
  });

  it("넓히기를 한 문의는 넓힌 말을 적고, 날짜·칸 이름을 뺀 것과 구분한다", () => {
    const a = analyzeInquiry(k, "kakao", "이번 주 수요일 오후 3시 상담 예약을 다음 주로 미룰 수 있을까요?");
    const note = retrievalView(k, a.retrieval!, a.decision.mask.masked).queryNote!;
    expect(note).toContain("‘예약 변경’으로도 찾았습니다");
    expect(note).toContain("근거 약함 판정은 넓히기 전 말로만 합니다");
    // 날짜·시각을 뺐으므로 그 안내도 함께.
    expect(note).toContain("날짜·시각·폼 칸 이름·가린 곳은 빼고 찾았습니다.");
    // 날짜·칸 이름이 없고 넓히기만 한 직원 질문에는 넓히기 안내만.
    const q = analyzeStaffQuestion(k, "방문 당일 오전에 예약 시간을 오후로 바꿔 달라는데 바꿔 줘도 돼요?");
    expect(retrievalView(k, q.retrieval, q.mask.masked).queryNote).toMatch(/^문의의 말을 문서의 말로 넓혀/);
  });

  it("녹화에 검색 부가 정보가 있으면(3회차부터) 근거 약함·앞세움 표시를 녹화 때 판정대로 보인다", () => {
    const v = recordedRetrievalView(
      k,
      { retrieval: [{ chunkId: "V04#4", score: 14.7, pin: null }, { chunkId: "V12#2", score: 3, pin: "handover" }], excludedMatches: [], retrievalMeta: { expandedWith: ["예약 변경"], topScore: 7.6, weak: true } },
      "staff-qa",
      "샴푸 바꿔도 돼요?",
      null,
    );
    expect(v.weak).toBe(true);
    expect(v.items.map((i) => [i.pin, i.relevance])).toEqual([
      [null, "보통"],
      ["handover", "규칙으로 앞에 섬"],
    ]);
    // 부가 정보가 없는 2회차 녹화는 전처럼 발췌 점수로 판정한다.
    expect(recordedRetrievalView(k, { retrieval: [{ chunkId: "V04#4", score: 14.7 }], excludedMatches: [] }, "staff-qa", "x", null).weak).toBe(false);
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
      // 한 번만 받는 첫 상담비·예약금은 가격표에 단위가 없다(모당 단가만 "/모").
      ["{{price:consult-first}}", "30,000원", "V03#1"],
      ["{{price:graft}}", "2,000원/모", "V03#2"],
      ["{{price:deposit-consult}}", "30,000원", "V03#1"],
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

  it("인계 초안 안내(draftNote): 보통 창구는 '의료진 확인용 — 직원은 보낼 수 없음', 공개 창구는 만들지 않음", () => {
    const m = (id: string) => handoverCardModel(analyzeInquiry(k, q(id).channel, q(id).text).decision, item(id).handover, policies.handover, DEMO_NOW_MS, k.titles);
    expect(m("Q06").draftNote).toBe(HANDOVER_DRAFT_NOTE.ok);
    expect(m("Q06").draftNote).toContain("직원은 보낼 수 없고");
    expect(m("Q16").draftNote).toBe("공개 창구라 AI 초안을 만들지 않습니다.");
    // 모르는 창구(지도에 없음)는 규칙이 인계해도 초안을 만들지 않는다.
    const unknown = decideRoute({ channel: "fax", text: q("Q06").text, channels: k.channels, redflag: k.redflag, medication: k.medication });
    expect(handoverCardModel(unknown, null, policies.handover, DEMO_NOW_MS, k.titles).draftNote).toBe("창구를 몰라 AI 초안을 만들지 않습니다.");
    // 승인 문구(V12)는 draftNote와 상관없이 그대로.
    expect(m("Q16").patientMessage?.text).toBe(V12_MESSAGE);
  });

  it("약 문의(Q25)는 MED-01", () => {
    const a = analyzeInquiry(k, q("Q25").channel, q("Q25").text);
    const m = handoverCardModel(a.decision, item("Q25").handover, policies.handover, DEMO_NOW_MS, k.titles);
    expect(m.rules.map((r) => r.id)).toEqual(["MED-01"]);
    expect(m.medTerms.length).toBeGreaterThan(0);
  });
});

describe("인계 초안 칸(PRD v0.3) — 녹화 상태를 정직하게", () => {
  const allowedOf = (id: string) => handoverDraftAllowed(analyzeInquiry(k, q(id).channel, q(id).text).decision);

  it("공개 창구(Q16)는 칸을 그리지 않고, 녹화가 아예 없으면 '준비 전', 키가 없는 녹화(4회차)는 '녹화 전', 가짜 녹화는 녹화됨", async () => {
    const rec = await fakeRecording();
    expect(handoverDraftView(allowedOf("Q16"), null, true)).toEqual({ kind: "none", why: "public" });
    expect(handoverDraftView(allowedOf("Q06"), null, false)).toEqual({ kind: "no-recording" });
    const r06 = rec.inquiries.find((r) => r.id === "Q06")!;
    const { handoverDraft: _hd, ...r06Old } = r06;
    void _hd;
    expect(handoverDraftView(allowedOf("Q06"), r06Old, true)).toEqual({ kind: "not-recorded" });
    expect(handoverDraftView(allowedOf("Q06"), r06, true)).toEqual({ kind: "recorded", rec: r06.handoverDraft });
  });

  it("안내 글: 녹화 전·준비 전에도 안전 규칙·인계 카드·응답 시한은 동작한다고 적고, 녹화됨이면 안내 없음", () => {
    expect(handoverDraftNotice({ kind: "not-recorded" })).toBe(
      "이 문의의 의료진 확인용 AI 초안은 아직 미리 만들지 않았습니다(인계 초안 녹화 전). 안전 규칙·인계 카드·응답 시한과 승인 문구는 지금 동작합니다.",
    );
    expect(handoverDraftNotice({ kind: "no-recording" })).toContain("아직 준비 전입니다 — 안전 규칙·인계 카드·응답 시한은 지금 동작합니다");
    expect(handoverDraftNotice({ kind: "none", why: "public" })).toBe("공개 창구라 AI 초안을 만들지 않습니다 — 공개 답글은 고정 문구만.");
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

describe("사내 Q&A — 규칙 카드(적신호·약이 담긴 직원 질문)", () => {
  const G46 = "수술 2주째 환자가 이식 부위에서 고름이 나온다는데 연고 바르라고 해도 돼요?";
  const G47 = "미녹시딜이랑 먹는 탈모약을 같이 먹어도 되냐는 문의에는 뭐라고 답해요?";
  const text = (id: string) => k.chunks.find((c) => c.chunkId === id)!.text;

  it("G46: 적신호(고름)+약(연고) — V12에서 읽은 5분, 담당(누구에게)·시한(몇 분 안에) 문단을 원문 그대로 인용", () => {
    const c = staffRuleCard(k, policies.handover, G46)!;
    expect(c.headline).toBe("이 질문은 환자 증상·약 얘기를 담고 있습니다 — 인계 절차대로 5분 안에 의료진에게 넘기세요. 직원은 증상·약에 답하지 않습니다.");
    expect([c.urgent, c.urgencyLabel, c.minutes]).toEqual([true, "긴급", 5]);
    expect(c.rules.map((r) => r.id)).toEqual(["RF-01", "MED-01"]);
    expect([c.words, c.medTerms]).toEqual([["고름"], ["연고"]]);
    expect(c.quotes.map((q) => q.chunkId)).toEqual(["V12#1", "V12#2"]);
    for (const q of c.quotes) expect(q.text).toBe(text(q.chunkId));
    expect(c.quotes[1].text).toContain("적신호 문의는 확인한 순간부터 5분 안에 인계합니다");
    expect(c.docTitle).toBe("의료진 인계 절차");
    expect(c.patientMessage?.text).toBe(policies.handover.patientMessage!.value);
  });

  it("카드가 인용한 시한 문단은 발췌 맨 앞에 선 인계 문단과 같다(같은 판정 함수)", () => {
    const c = staffRuleCard(k, policies.handover, G46)!;
    const pinned = retrieve(k.index, "staff-qa", G46).hits.find((h) => h.pin === "handover")!.chunk.chunkId;
    expect(c.quotes.map((q) => q.chunkId)).toContain(pinned);
  });

  it("G47: 약 문의뿐이면 분을 적지 않는다 — V12의 5분은 '적신호 문의' 문장이다", () => {
    const c = staffRuleCard(k, policies.handover, G47)!;
    expect(c.headline).toBe("이 질문은 약 얘기를 담고 있습니다 — 인계 절차대로 의료진에게 넘기세요. 직원은 증상·약에 답하지 않습니다.");
    expect([c.urgent, c.urgencyLabel, c.minutes]).toEqual([false, "인계", null]);
    expect(c.rules.map((r) => r.id)).toEqual(["MED-01"]);
    expect(c.quotes.map((q) => q.chunkId)).toEqual(["V12#0", "V12#1"]);
    // 볼트 링크만 제목으로 바꾼다.
    expect(c.quotes[0].text).toBe(replaceWikiLinks(text("V12#0"), k));
    expect(c.quotes[0].text).not.toContain("[[");
    expect(c.deadlineText).toContain("적신호 문의 기준");
  });

  it("시한은 V12에서 읽은 값을 따른다 — 문서가 10분으로 바뀌면 카드도 10분, 못 읽으면 분을 지어내지 않는다", () => {
    const ten = staffRuleCard(k, { ...policies.handover, handoverMinutes: { value: 10, chunkId: "V12#2" } }, G46)!;
    expect(ten.headline).toContain("10분 안에 의료진에게");
    const none = staffRuleCard(k, { ...policies.handover, handoverMinutes: null }, G46)!;
    expect(none.minutes).toBeNull();
    expect(none.headline).toContain("인계 절차대로 의료진에게");
    expect(none.deadlineText).toContain("읽지 못함");
  });

  it("규칙에 안 걸리는 질문에는 카드가 없다 — 절차 질문(G22)·약도·'먹어도'만 있는 질문(V17 qaPinIgnore)", () => {
    expect(staffRuleCard(k, policies.handover, "적신호 문의를 보면 몇 분 안에 누구에게 넘겨요?")).toBeNull();
    expect(staffRuleCard(k, policies.handover, "첫 상담은 몇 분 걸려요?")).toBeNull();
    // 문의 게이트라면 인계였을 말이지만 직원 질문에서는 약 이야기가 아닐 때가 많다(발췌 앞세우기와 같은 기준).
    expect(checkMedication("점심시간에 밥 먹어도 돼요?", k.medication).decision).toBe("handover");
    expect(staffRuleCard(k, policies.handover, "점심시간에 밥 먹어도 돼요?")).toBeNull();
    expect(staffRuleCard(k, policies.handover, "병원 약도는 어디서 보내요?")).toBeNull();
  });

  it("분을 적으면 그 분을 읽은 V12 문단도 인용한다 — 골든셋 직원 질문 전부", () => {
    const staff = realBundle().golden.filter((g) => g.kind === "staff-qa" && g.question);
    let withMinutes = 0;
    for (const g of staff) {
      const c = staffRuleCard(k, policies.handover, maskPii(g.question!).masked);
      if (!c || c.minutes === null) continue;
      withMinutes++;
      expect(c.quotes.map((q) => q.chunkId), g.id).toContain(policies.handover.handoverMinutes!.chunkId);
    }
    expect(withMinutes).toBeGreaterThan(0);
  });

  // 적대 검증: 분은 "N분 안에 인계" 문장에서, 인계 문단은 '적신호'라는 말로 따로 고른다. 둘이 갈라지면 카드에 5분만 뜨고
  // 인용은 '누구에게' 문단의 "5분 안에 답이 없으면"(다른 뜻)뿐이었다.
  it("V12 문구가 바뀌어 인계 문단 고르기와 분 읽기가 갈라져도, 분을 읽은 문단을 인용한다", () => {
    const files = realInputs().vaultFiles.map((f) =>
      f.path === "handover-procedure.md" ? { ...f, raw: f.raw.replace("적신호 문의는 확인한 순간부터", "증상 문의는 확인한 순간부터") } : f,
    );
    expect(files.find((f) => f.path === "handover-procedure.md")!.raw).toContain("증상 문의는 확인한 순간부터");
    const kr = buildKnowledge(loadVault(files, { asOf: DEMO_AS_OF }));
    if (!kr.ok) throw new Error(kr.errors.join("\n"));
    const policy = readHandoverPolicy(kr.knowledge.chunks);
    const c = staffRuleCard(kr.knowledge, policy, G46)!;
    expect(c.minutes).toBe(5);
    expect(c.quotes.map((q) => q.chunkId)).toContain(policy.handoverMinutes!.chunkId);
    expect(c.quotes.some((q) => q.text.includes("확인한 순간부터 5분 안에 인계합니다"))).toBe(true);
  });

  it("약만 걸린 카드에는 판정에 쓰지 않은 증상 말을 보이지 않는다", () => {
    // '붓기'는 수술 후 문맥이 없어 적신호 판정에 쓰이지 않았다. 약(진통제)만 걸린 카드다.
    const c = staffRuleCard(k, policies.handover, "진통제 먹으면 붓기 빠져요?")!;
    expect(c.rules.map((r) => r.id)).toEqual(["MED-01"]);
    expect([c.words, c.context, c.minutes]).toEqual([[], [], null]);
  });

  it("'피나스테리드' 안의 '피나'는 출혈로 읽지 않는다(V11 nonSymptomWords) — 약 카드만, 5분 없음", () => {
    for (const q of ["수술 후 피나스테리드 계속 먹어도 돼요?", "피나스테리드 끊어도 되냐고 물어요"]) {
      const c = staffRuleCard(k, policies.handover, q)!;
      expect(c.rules.map((r) => r.id), q).toEqual(["MED-01"]);
      expect(c.words, q).toEqual([]);
      expect(c.minutes, q).toBeNull();
      expect(c.medTerms, q).toContain("피나스테리드");
    }
  });

  it("수술 문맥 없이 애매한 말만 있으면 카드가 없다(두피 관리의 붉어짐)", () => {
    expect(staffRuleCard(k, policies.handover, "두피 관리 받으면 두피가 붉어지나요?")).toBeNull();
    expect(staffRuleCard(k, policies.handover, "두피가 가려운 환자는 어디로 안내해요?")).toBeNull();
  });

  it("알려진 한계: 광고 문구를 묻는 질문, 처방전 재발급 접수에도 카드가 뜬다", () => {
    expect(staffRuleCard(k, policies.handover, "통증 없는 수술이라고 광고해도 돼요?")?.minutes).toBe(5);
    expect(staffRuleCard(k, policies.handover, "처방전 재발급은 어디서 해요?")?.rules.map((r) => r.id)).toEqual(["MED-01"]);
  });

  it("알려진 한계: 부정문(\"고름 얘기 말고요\")에도 카드가 뜬다 — 적신호 규칙은 부정을 가리지 않는다", () => {
    expect(staffRuleCard(k, policies.handover, "고름 얘기 말고요, 수술 후 샴푸는 언제부터 써요?")).not.toBeNull();
  });

  it("가린 글로 판정해도 같다(화면은 가린 질문으로 부른다)", () => {
    const masked = maskPii(`010-1234-5678 환자분 ${G46}`).masked;
    expect(staffRuleCard(k, policies.handover, masked)?.quotes.map((q) => q.chunkId)).toEqual(["V12#1", "V12#2"]);
  });
});

