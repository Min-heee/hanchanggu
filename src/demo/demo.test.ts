/**
 * 화면 로직의 순수 함수 시험. 실제 볼트·합성 데이터로 돌린다(화면이 보는 것과 같은 값).
 * 기대값은 손으로 적었다 — 데이터를 고치면 사람이 다시 적는다.
 */

import { describe, expect, it } from "vitest";
import { verifyCitations } from "../core/citations";
import { MIN_TOP_SCORE, retrieve } from "../core/retrieve";
import { readPostopDay } from "../core/postop";
import { analyzeInquiry, analyzeStaffQuestion } from "./analyze";
import { DEMO_NOW, DEMO_NOW_MS, formatDuration, formatKst, kstParts, kstToMs } from "./clock";
import { computeMetrics, metricValue } from "./evaluation";
import { buildInboxItem, deadlineBadge, filterInbox, filterOptions, inboxRows, inboxSummary, KIND_LABEL, receivedRangeText, sortInbox, STATUS_LABEL, type LocalMarks } from "./inbox";
import { confirmDeadlineMs, FALLBACK_CONFIRM_BUSINESS_DAYS, isOpenAt, readConfirmPolicy, readHandoverPolicy } from "./policy";
import { realBundle, realKnowledge } from "./__fixtures__/real";

const k = realKnowledge();
const bundle = realBundle();
const policies = { confirm: readConfirmPolicy(k.chunks), handover: readHandoverPolicy(k.chunks) };
const noMarks: LocalMarks = { sent: new Set(), handedOver: new Map() };
const items = (marks: LocalMarks = noMarks) => sortInbox(bundle.inquiries.map((q) => buildInboxItem(q, k, null, policies, marks, DEMO_NOW_MS)));

describe("시연 시계", () => {
  it("기준 시각은 월요일 오전 10시(KST)이고 마지막 문의 뒤다", () => {
    const p = kstParts(DEMO_NOW_MS);
    expect([p.dow, p.hour, p.minute]).toEqual([1, 10, 0]);
    const last = Math.max(...bundle.inquiries.map((q) => Date.parse(q.receivedAt)));
    expect(last).toBeLessThan(DEMO_NOW_MS);
    expect(DEMO_NOW_MS - last).toBeLessThanOrEqual(30 * 60000);
  });

  it("KST 표시는 실행 환경 시간대와 상관없다", () => {
    expect(formatKst(Date.parse("2026-09-19T18:10:00+09:00"))).toBe("9/19(토) 18:10");
    expect(formatKst(Date.parse("2026-09-20T15:00:00Z"))).toBe("9/21(월) 00:00");
    expect(kstToMs(2026, 9, 21, 10, 0)).toBe(Date.parse(DEMO_NOW));
  });

  it.each([
    [0, "0분"],
    [45, "45분"],
    [60, "1시간"],
    [200, "3시간 20분"],
    [1440, "1일"],
    [2390, "1일 15시간"],
    [-5, "0분"],
  ])("기다린 시간 %i분 → %s", (m, s) => {
    expect(formatDuration(m)).toBe(s);
  });
});

describe("규정 읽기(볼트 V04·V12·V02)", () => {
  it("확정 연락 시한은 V04 '1영업일'에서 읽는다", () => {
    expect(policies.confirm.businessDays.value).toBe(1);
    expect(policies.confirm.businessDays.chunkId).toMatch(/^V04#/);
  });

  it("V04에서 읽지 못하면 기본값을 쓰고 출처가 없다고 표시한다", () => {
    expect(readConfirmPolicy([])).toEqual({ businessDays: { value: FALLBACK_CONFIRM_BUSINESS_DAYS, chunkId: null } });
  });

  it("인계 시한·담당·환자 안내 문구는 V12에서 글자 그대로", () => {
    const h = policies.handover;
    expect(h.handoverMinutes?.value).toBe(5);
    expect(h.contactMinutes?.value).toBe(30);
    expect(h.roleOpen?.value).toBe("담당 간호사");
    expect(h.roleClosed?.value).toBe("당직 의료진 연락망");
    expect(h.patientMessage?.value).toBe(
      "보내 주신 내용은 의료진에게 바로 전달했습니다. 의료진이 확인한 뒤 직접 연락드리겠습니다. 숨이 차거나 출혈이 멈추지 않는 등 급한 상황이면 기다리지 마시고 119나 가까운 응급실을 이용해 주세요.",
    );
    // 문구가 볼트 문단에 실제로 있는지(지어낸 문장이 아닌지).
    const chunk = k.chunks.find((c) => c.chunkId === h.patientMessage?.chunkId);
    expect(chunk?.text.includes(h.patientMessage!.value)).toBe(true);
  });

  it("V12에서 읽지 못하면 값을 지어내지 않고 null", () => {
    expect(readHandoverPolicy([])).toEqual({ handoverMinutes: null, contactMinutes: null, roleOpen: null, roleClosed: null, patientMessage: null });
  });

  it("진료시간(V02): 월 10:00은 진료 중, 일요일·10/16 임시 휴진은 아니다", () => {
    expect(isOpenAt(k.hours, DEMO_NOW_MS)).toBe(true);
    expect(isOpenAt(k.hours, kstToMs(2026, 9, 20, 11))).toBe(false);
    expect(isOpenAt(k.hours, kstToMs(2026, 10, 16, 11))).toBe(false);
    expect(isOpenAt(k.hours, kstToMs(2026, 9, 19, 14, 59))).toBe(true);
    expect(isOpenAt(k.hours, kstToMs(2026, 9, 19, 15, 0))).toBe(false);
  });

  it.each([
    ["토 18:10(진료 끝난 뒤)", kstToMs(2026, 9, 19, 18, 10), kstToMs(2026, 9, 21, 19)],
    ["일 10:45", kstToMs(2026, 9, 20, 10, 45), kstToMs(2026, 9, 21, 19)],
    ["월 00:35(진료 전)", kstToMs(2026, 9, 21, 0, 35), kstToMs(2026, 9, 21, 19)],
    ["월 11:00(진료 중)", kstToMs(2026, 9, 21, 11), kstToMs(2026, 9, 22, 19)],
    ["수 22:00 → 목은 야간 진료", kstToMs(2026, 9, 23, 22), kstToMs(2026, 9, 24, 21)],
    ["목 22:00 → 금 10/16 임시 휴진 → 토", kstToMs(2026, 10, 15, 22), kstToMs(2026, 10, 17, 15)],
  ])("확정 연락 시한(1영업일): %s", (_, received, deadline) => {
    expect(confirmDeadlineMs(k.hours, received, 1)).toBe(deadline);
  });
});

describe("V13 인사·맺음 허용 목록(1회차 녹화 문장)", () => {
  // 인용 없는 문장 하나만 넣어 실제 볼트의 허용 목록으로 판정한다. 허용 목록은 사실이 전혀 없는 인사·감사만 받는다.
  // (문장 하나만 넣은 초안 자체는 no-cited로 보류되므로 초안 상태가 아니라 문장 종류를 본다.)
  const kindOf = (text: string) => verifyCitations([{ type: "text", text, citations: null }], [], k.allowedDocIds, k.tone).sentences[0].kind;

  it("사실 없는 감사는 허용: 요청해 주셔서 감사합니다.", () => {
    // 1회차에서 이 한 문장 때문에 Q41 초안 전체가 보류됐다.
    expect(kindOf("요청해 주셔서 감사합니다.")).toBe("allowlisted");
  });

  it.each([
    // 예/아니요·가능 여부·결론은 사실이다. 허용 목록으로 풀지 않고 프롬프트로 인용을 붙이게 한다(llm/draft.ts 규칙 1·4).
    "아니요, 신청만으로는 확정되지 않습니다.",
    "아니요, 안내하면 안 됩니다.",
    "언급하면 안 됩니다.",
    "따라서 의료진 확인이 필요합니다.",
    // 모델이 날짜를 추론한 문장. 보류가 맞다.
    "요청하신 10월 1일(목)은 이 범위에 해당합니다.",
    // 연결 문장은 사실은 아니지만 인사도 아니다. 허용 목록을 넓히지 않고 쓰지 않게 한다(규칙 9).
    "처리 방법은 다음과 같습니다.",
    "환자에게는 이렇게 안내하시면 됩니다.",
    // 행동 요청 — '그 시간에 상담이 된다'는 뜻이 섞인다.
    "원하시는 상담 날짜와 시간이 있으면 알려 주세요.",
    // 적대 검증(2026-09-29): 안 된다는 답으로 읽혀 거절 결론을 인용 없이 전한다(Q20에서 한 번 넣었다가 뺐다).
    "양해 부탁드립니다.",
  ])("사실·결론·요청이 섞인 문장은 계속 막는다: %s", (text) => {
    expect(kindOf(text)).toBe("uncited");
  });

  it("허용 목록 전체를 글자 그대로 고정한다(문구를 더하면 사람이 이 목록을 고쳐야 한다)", () => {
    // 목록에 든 문장은 인용·숫자 대조 없이 나간다. 한 줄이 늘 때마다 리뷰에 드러나게 한다(변이 시험 V5~V10).
    expect([...k.tone.greetings, ...k.tone.closings]).toEqual([
      "안녕하세요, 샘플의원입니다.",
      "문의 주셔서 감사합니다.",
      "안녕하세요, 샘플의원 상담 담당입니다.",
      "기다리게 해 드려 죄송합니다.",
      "요청해 주셔서 감사합니다.",
      "더 궁금하신 점이 있으면 편하게 문의해 주세요.",
      "감사합니다.",
      "확인한 뒤 다시 연락드리겠습니다.",
      "샘플의원 드림",
    ]);
  });

  it("허용 목록에는 숫자·자리표시자·예/아니요·가능 여부가 없다", () => {
    // 한글 뒤에서는 \b가 듣지 않아 "아니요."를 놓친다. 그래서 (?![가-힣])로 낱말 끝을 본다.
    for (const s of [...k.tone.greetings, ...k.tone.closings]) {
      expect(s).not.toMatch(/[0-9０-９]|\{\{|^\s*(네|예|아니요|아니오)(?![가-힣])|가능|불가|안 됩니다|됩니다|확정|해당|양해/);
    }
  });
});

describe("통합 목록(F3) — 녹화 없음", () => {
  it("적신호 인계 → 약·분류 인계 → 예약금 확정 대기 → 기다린 시간 순", () => {
    expect(items().map((i) => i.id)).toEqual([
      // 적신호(규칙 RF-*) 16건, 받은 순 = 오래 기다린 순. Q24는 과잉 인계(부정문)라 여기 있다.
      ...["Q06", "Q07", "Q08", "Q09", "Q11", "Q13", "Q14", "Q16", "Q19", "Q22", "Q24", "Q26", "Q27", "Q32", "Q35", "Q36"],
      // 약 문의 인계(MED-01). 5분 시한의 인계라 주차·리뷰 문의 아래에 묻히면 안 된다.
      "Q25",
      // 예약금 받음·미확정. Q41은 금요일에 받아 가장 오래 기다렸다(시한 지남).
      ...["Q41", "Q01", "Q15", "Q31"],
      ...["Q02", "Q03", "Q04", "Q05", "Q10", "Q12", "Q17", "Q18", "Q20", "Q21", "Q23", "Q28", "Q29", "Q30", "Q33", "Q34", "Q37", "Q38", "Q39", "Q40"],
    ]);
    expect(items().find((i) => i.id === "Q25")!.group).toBe(1);
  });

  it("상태: 인계는 '인계 필요'→표시하면 '인계함', 공개 창구는 '고정 문구 고르기'→고르면 '초안', 초안 경로는 AI 답 전이라 '새 문의'", () => {
    const by = new Map(items().map((i) => [i.id, i]));
    expect(by.get("Q06")!.status).toBe("handover-needed");
    expect(by.get("Q25")!.status).toBe("handover-needed");
    expect(by.get("Q25")!.kind).toBe("medication");
    expect(by.get("Q04")!.status).toBe("template");
    expect(by.get("Q04")!.kind).toBe("public");
    expect(by.get("Q02")!.status).toBe("new");
    expect(by.get("Q02")!.kind).toBe("draft-path");
    expect(by.get("Q01")!.kind).toBe("deposit");
    const marked = new Map(items({ sent: new Set(), handedOver: new Map([["Q06", DEMO_NOW_MS]]), templateChosen: new Set(["Q04"]) }).map((i) => [i.id, i]));
    expect(marked.get("Q06")!.status).toBe("handed-over");
    expect(marked.get("Q04")!.status).toBe("draft");
    expect(KIND_LABEL["draft-path"]).toBe("일반 문의");
    expect(STATUS_LABEL["handover-needed"]).toBe("인계 필요");
  });

  it("모의 발송한 건은 맨 아래로", () => {
    const ids = items({ sent: new Set(["Q06"]), handedOver: new Map() }).map((i) => i.id);
    expect(ids.at(-1)).toBe("Q06");
    expect(ids[0]).toBe("Q07");
  });

  it("기다린 시간은 기준 시각에서 잰다", () => {
    const q06 = items().find((i) => i.id === "Q06")!;
    // 토 21:14 → 월 10:00 = 36시간 46분
    expect(q06.waitMinutes).toBe(36 * 60 + 46);
  });

  it("확정 대기(F16): 주말에 받은 건은 시한이 월 19:00이라 기준 시각엔 아직 남았다", () => {
    const q01 = items().find((i) => i.id === "Q01")!;
    expect(q01.deposit).toEqual({
      deadlineMs: kstToMs(2026, 9, 21, 19),
      elapsedMinutes: 39 * 60 + 50,
      remainingMinutes: 9 * 60,
      overdue: false,
      bookingAtMs: Date.parse("2026-09-25T11:00:00+09:00"),
    });
  });

  it("확정 대기(F16): 금 16:40(진료 중)에 받은 Q41은 시한이 토 15:00이라 기준 시각에 1일 19시간 지났다", () => {
    const q41 = items().find((i) => i.id === "Q41")!;
    expect(q41.deposit).toEqual({
      deadlineMs: kstToMs(2026, 9, 19, 15),
      elapsedMinutes: 2 * 1440 + 17 * 60 + 20,
      remainingMinutes: -(43 * 60),
      overdue: true,
      bookingAtMs: Date.parse("2026-10-08T19:30:00+09:00"),
    });
  });

  it("인계 시한(F6): 받은 뒤 5분이 지났으면 경보, 인계 표시 뒤에는 30분 연락 목표", () => {
    const q06 = items().find((i) => i.id === "Q06")!;
    expect(q06.handover).toMatchObject({ phase: "to-handover", overdue: true, role: "담당 간호사", openNow: true });
    expect(q06.handover!.deadlineMs).toBe(Date.parse("2026-09-19T21:19:00+09:00"));
    const handed = items({ sent: new Set(), handedOver: new Map([["Q06", DEMO_NOW_MS]]) }).find((i) => i.id === "Q06")!;
    expect(handed.handover).toMatchObject({ phase: "to-contact", overdue: false, deadlineMs: DEMO_NOW_MS + 30 * 60000 });
  });

  it("필터는 쓰인 값만 선택지로 내고, 창구·유형·상태를 함께 건다", () => {
    const all = items();
    const opts = filterOptions(all);
    expect(new Set(opts.channels)).toEqual(new Set(["kakao", "naver_talktalk", "instagram_dm", "web_form", "landing_form", "booking_note", "phone_memo", "sms", "review", "youtube_comment"]));
    expect(filterInbox(all, { channel: "booking_note", kind: null, status: null }).map((i) => i.id)).toEqual(["Q27", "Q41", "Q01", "Q15", "Q31"]);
    expect(filterInbox(all, { channel: "booking_note", kind: "deposit", status: null }).map((i) => i.id)).toEqual(["Q41", "Q01", "Q15", "Q31"]);
    expect(filterInbox(all, { channel: null, kind: null, status: "handover-needed" })).toHaveLength(17);
  });

  it("시한 배지는 넘긴 양까지 적는다(행끼리 구분되게)", () => {
    const by = new Map(items().map((i) => [i.id, i]));
    // Q06: 토 21:14 받음 → 21:19 시한 → 월 10:00 = 1일 12시간 41분 지남(하루가 넘으면 분은 버림).
    expect(deadlineBadge(by.get("Q06")!, DEMO_NOW_MS)).toEqual({ tone: "red", text: "인계 시한 1일 12시간 지남" });
    expect(deadlineBadge(by.get("Q01")!, DEMO_NOW_MS)).toEqual({ tone: "orange", text: "예약금 받음 · 확정 연락 9시간 남음" });
    // Q41: 금 16:40 받음 → 토 15:00 시한 → 월 10:00 = 43시간 지남(30초 시연 0~5초 장면의 배지).
    expect(deadlineBadge(by.get("Q41")!, DEMO_NOW_MS)).toEqual({ tone: "red", text: "예약금 받음 · 확정 연락 시한 1일 19시간 지남" });
    expect(deadlineBadge(by.get("Q02")!, DEMO_NOW_MS)).toBeNull();
    const texts = items()
      .filter((i) => i.group === 0)
      .map((i) => deadlineBadge(i, DEMO_NOW_MS)!.text);
    expect(new Set(texts).size).toBeGreaterThan(8);
  });

  it("요약: 적신호 16(시한 지남 16), 약·분류 인계 1, 확정 대기 4(시한 지남 1, 남은 것 중 가장 가까운 시한 9시간)", () => {
    expect(inboxSummary(items())).toEqual({
      redflag: 16,
      redflagOverdue: 16,
      otherHandover: 1,
      otherHandoverOverdue: 1,
      deposit: 4,
      depositOverdue: 1,
      nextDepositMinutes: 9 * 60,
      total: 41,
    });
    // 발송한 건은 할 일에서 빠진다.
    expect(inboxSummary(items({ sent: new Set(["Q06"]), handedOver: new Map() })).redflag).toBe(15);
  });

  it("목록 머리의 받은 기간은 데이터에서 계산한다(가장 이른 Q41 ~ 가장 늦은 Q40)", () => {
    expect(receivedRangeText(items())).toBe("9/18(금) 16:40~9/21(월) 09:40");
    expect(receivedRangeText([])).toBeNull();
  });

  it("적신호 묶음은 접으면 2건만 보이고, 그 아래 약 인계·확정 대기가 바로 이어진다", () => {
    const rows = inboxRows(items(), { collapseRedflag: true });
    const firstTen = rows.slice(0, 10).map((r) => (r.type === "item" ? r.item.id : r.type === "more" ? `+${r.hidden}` : r.text));
    expect(firstTen).toEqual(["적신호 인계", "Q06", "Q07", "+14", "약·분류 인계", "Q25", "예약금 받음 · 확정 대기", "Q41", "Q01", "Q15"]);
    expect(inboxRows(items(), { collapseRedflag: false }).filter((r) => r.type === "item")).toHaveLength(41);
  });
});

describe("문의 분석(가림 → 게이트 → 경과일 → 검색)", () => {
  it("30초 시연 문장: 규칙이 바로 인계로 보낸다(RF-03)", () => {
    const a = analyzeInquiry(k, "kakao", "이식한 지 열흘인데 부위가 뜨겁고 누르면 아파요");
    expect(a.decision.step).toBe("handover");
    expect(a.decision.redflag.ruleIds).toContain("RF-03");
    expect(a.retrieval).toBeNull();
    expect(a.postopRead?.days).toBe(10);
  });

  it("경과일 구간 문단이 검색 맨 앞에 선다(F17), 직원이 고치면 그 값으로", () => {
    const r = retrieve(k.index, "reply", "수술 9일째인데 샴푸는 뭘 써요?", 9);
    expect(r.hits[0].chunk.chunkId).toBe("V07#3");
    expect(r.hits[0].postopBoost).toBe(true);
    const fixed = analyzeInquiry(k, "kakao", "D+7 내원 날짜를 옮기고 싶어요", 14);
    expect(fixed.postopRead).toBeNull();
    expect(fixed.postopUsed).toBe(14);
    expect(fixed.retrieval!.hits.filter((h) => h.postopBoost).map((h) => h.chunk.chunkId)).toEqual(["V07#3", "V07#9"]); // 구간 문단끼리는 점수 순
  });

  it("직원 질문에는 경과일 앞세우기를 하지 않는다", () => {
    const r = analyzeStaffQuestion(k, "수술 2주째 환자가 이식 부위에서 고름이 나온다는데 연고 바르라고 해도 돼요?");
    expect(r.retrieval.hits.some((h) => h.postopBoost)).toBe(false);
    expect(r.retrieval.postopDay).toBeNull();
  });

  it("문의의 경과일 읽기가 사람이 적은 값(meta.postopDayMentioned)과 41건 모두 같다", () => {
    const diff = bundle.inquiries
      .map((q) => ({ id: q.id, read: readPostopDay(q.text)?.days ?? null, label: q.meta.postopDayMentioned ?? null }))
      .filter((x) => x.read !== x.label);
    expect(diff).toEqual([]);
  });

  it("근거 약함(PRD F7): 최고 점수가 기준 미만이면 weak — 와이파이는 weak, 대본 질문(G16)은 아니다", () => {
    expect(MIN_TOP_SCORE).toBe(9);
    const wifi = analyzeStaffQuestion(k, "대기실 와이파이 비밀번호가 뭐예요?");
    expect([wifi.retrieval.weak, wifi.retrieval.hits.length > 0]).toEqual([true, true]);
    expect(wifi.retrieval.topScore).toBeLessThan(MIN_TOP_SCORE);
    expect(analyzeStaffQuestion(k, "수술 3일째 환자가 머리를 감아도 되냐고 물으면 뭐라고 해요?").retrieval.weak).toBe(false);
    expect(analyzeStaffQuestion(k, "오늘 날씨 어때요?").retrieval).toMatchObject({ weak: true, topScore: 0, hits: [] });
    // 경과일로 앞에 세운 문단(점수 0일 수 있음)은 근거 강도에 넣지 않는다.
    const boosted = retrieve(k.index, "reply", "대기실 와이파이 비밀번호", 3);
    expect(boosted.hits[0].postopBoost).toBe(true);
    expect(boosted.weak).toBe(true);
  });

  it("제외 문서(옛 판·초안)는 결과에 없고 '제외됨' 보고에만 있다", () => {
    const a = analyzeInquiry(k, "kakao", "예약금 환불은 며칠 전까지 취소해야 돼요?");
    expect(a.retrieval!.hits.every((h) => h.chunk.docId !== "V04b" && h.chunk.docId !== "V20")).toBe(true);
    expect(a.retrieval!.excluded.find((e) => e.doc.id === "V04b")?.matched).toBe(true);
  });
});

describe("평가 탭(F15) — 녹화 없음", () => {
  const metrics = computeMetrics(k, bundle.inquiries, bundle.golden, null);
  const m = (key: string) => metrics.find((x) => x.key === key)!;

  it("규칙·검색 지표는 바로 계산한다", () => {
    expect([m("redflag-miss").numerator, m("redflag-miss").denominator, m("redflag-miss").pass]).toEqual([0, 15, true]);
    expect([m("over-handover").numerator, m("over-handover").denominator]).toEqual([1, 25]);
    expect(m("over-handover").failures.map((f) => f.id)).toEqual(["Q24"]);
    // scripts/eval-retrieval.ts의 '문단@5 40/42'와 같아야 한다(같은 retrieve).
    expect([m("retrieval-hit").numerator, m("retrieval-hit").denominator]).toEqual([40, 42]);
    expect(m("retrieval-hit").failures.map((f) => f.id)).toEqual(["G46", "G49"]);
    expect([m("handover-golden-rule").numerator, m("handover-golden-rule").denominator]).toEqual([3, 3]);
  });

  it("PRD 기준을 다 재지 않은 지표에 '기준 충족'을 달지 않는다", () => {
    // 적신호 누락: 별도 10문장 측정 전.
    expect(m("redflag-miss").verdict).toEqual({ tone: "neutral", label: "자기 시험 통과 · 별도 10문장 미측정" });
    // 검색 적중률: 볼트를 골든셋에 맞춘 곳이 있어 조건을 붙인다.
    expect(m("retrieval-hit").verdict).toEqual({ tone: "good", label: "기준 충족(합성·검수 전)" });
    expect(m("retrieval-hit").note).toContain("PRD 8절");
    // PRD에 없는 지표는 PRD 이름·기준을 빌리지 않는다.
    const rule = m("handover-golden-rule");
    expect([rule.name.includes("보류 재현율"), rule.target, rule.pass, rule.verdict.label]).toEqual([false, "기록만", null, "기록만"]);
    expect(rule.note).toContain("2건 겹침");
    expect(metrics.find((x) => x.key === "hold-recall-rule")).toBeUndefined();
  });

  it("분모가 10보다 작으면 퍼센트를 적지 않는다", () => {
    expect(metricValue(m("handover-golden-rule"))).toBe("3 / 3");
    expect(metricValue(m("retrieval-hit"))).toBe("40 / 42 (95.2%)");
    expect(metricValue(m("false-hold"))).toBe("AI 답 준비 전");
  });

  it("검색 단계 보류(근거 약함): 근거 없음 3/8, 답할 수 있는 39문항은 하나도 막지 않는다", () => {
    expect([m("weak-hold-nosource").numerator, m("weak-hold-nosource").denominator]).toEqual([3, 8]);
    expect(m("weak-hold-answerable").numerator).toBe(0);
    expect(m("weak-hold-answerable").denominator).toBe(39); // mustHold=false: answerable 30 + trap 5 + 직원 절차 질문 4
  });

  it("녹화가 필요한 지표는 '녹화 전'이고 숫자를 지어내지 않는다", () => {
    for (const key of ["hold-recall-nosource", "false-hold", "citation-mismatch", "injection"]) {
      expect([key, m(key).state, m(key).numerator]).toEqual([key, "needs-recording", null]);
    }
  });
});
