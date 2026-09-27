/**
 * 화면 로직의 순수 함수 시험. 실제 볼트·합성 데이터로 돌린다(화면이 보는 것과 같은 값).
 * 기대값은 손으로 적었다 — 데이터를 고치면 사람이 다시 적는다.
 */

import { describe, expect, it } from "vitest";
import { retrieve } from "../core/retrieve";
import { readPostopDay } from "../core/postop";
import { analyzeInquiry, analyzeStaffQuestion } from "./analyze";
import { DEMO_NOW, DEMO_NOW_MS, formatDuration, formatKst, kstParts, kstToMs } from "./clock";
import { computeMetrics } from "./evaluation";
import { buildInboxItem, filterInbox, filterOptions, sortInbox, type LocalMarks } from "./inbox";
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

describe("통합 목록(F3) — 녹화 없음", () => {
  it("적신호 인계 → 예약금 확정 대기 → 기다린 시간 순", () => {
    expect(items().map((i) => i.id)).toEqual([
      // 적신호(규칙 RF-*) 16건, 받은 순 = 오래 기다린 순. Q24는 과잉 인계(부정문)라 여기 있다.
      ...["Q06", "Q07", "Q08", "Q09", "Q11", "Q13", "Q14", "Q16", "Q19", "Q22", "Q24", "Q26", "Q27", "Q32", "Q35", "Q36"],
      // 예약금 받음·미확정
      ...["Q01", "Q15", "Q31"],
      ...["Q02", "Q03", "Q04", "Q05", "Q10", "Q12", "Q17", "Q18", "Q20", "Q21", "Q23", "Q25", "Q28", "Q29", "Q30", "Q33", "Q34", "Q37", "Q38", "Q39", "Q40"],
    ]);
  });

  it("상태: 규칙 인계는 '인계', 공개 창구는 '초안'(고정 문구), 나머지는 녹화 전이라 '새 문의'", () => {
    const by = new Map(items().map((i) => [i.id, i]));
    expect(by.get("Q06")!.status).toBe("handover");
    expect(by.get("Q25")!.status).toBe("handover");
    expect(by.get("Q25")!.kind).toBe("medication");
    expect(by.get("Q04")!.status).toBe("draft");
    expect(by.get("Q04")!.kind).toBe("public");
    expect(by.get("Q02")!.status).toBe("new");
    expect(by.get("Q01")!.kind).toBe("deposit");
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

  it("확정 대기(F16): 시한은 월 19:00, 기준 시각엔 아직 남았다", () => {
    const q01 = items().find((i) => i.id === "Q01")!;
    expect(q01.deposit).toEqual({
      deadlineMs: kstToMs(2026, 9, 21, 19),
      elapsedMinutes: 39 * 60 + 50,
      remainingMinutes: 9 * 60,
      overdue: false,
      bookingAtMs: Date.parse("2026-09-25T11:00:00+09:00"),
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
    expect(filterInbox(all, { channel: "booking_note", kind: null, status: null }).map((i) => i.id)).toEqual(["Q27", "Q01", "Q15", "Q31"]);
    expect(filterInbox(all, { channel: "booking_note", kind: "deposit", status: null }).map((i) => i.id)).toEqual(["Q01", "Q15", "Q31"]);
    expect(filterInbox(all, { channel: null, kind: null, status: "handover" })).toHaveLength(17);
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

  it("문의의 경과일 읽기가 사람이 적은 값(meta.postopDayMentioned)과 40건 모두 같다", () => {
    const diff = bundle.inquiries
      .map((q) => ({ id: q.id, read: readPostopDay(q.text)?.days ?? null, label: q.meta.postopDayMentioned ?? null }))
      .filter((x) => x.read !== x.label);
    expect(diff).toEqual([]);
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
    expect([m("over-handover").numerator, m("over-handover").denominator]).toEqual([1, 24]);
    expect(m("over-handover").failures.map((f) => f.id)).toEqual(["Q24"]);
    // scripts/eval-retrieval.ts의 '문단@5 40/42'와 같아야 한다(같은 retrieve).
    expect([m("retrieval-hit").numerator, m("retrieval-hit").denominator]).toEqual([40, 42]);
    expect(m("retrieval-hit").failures.map((f) => f.id)).toEqual(["G46", "G49"]);
    expect([m("hold-recall-rule").numerator, m("hold-recall-rule").denominator]).toEqual([3, 3]);
  });

  it("녹화가 필요한 지표는 '녹화 전'이고 숫자를 지어내지 않는다", () => {
    for (const key of ["hold-recall-nosource", "false-hold", "citation-mismatch", "injection"]) {
      expect([key, m(key).state, m(key).numerator]).toEqual([key, "needs-recording", null]);
    }
  });
});
