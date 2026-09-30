import { describe, expect, it } from "vitest";
import { realInputs, realKnowledge } from "../demo/__fixtures__/real";
import { DEMO_AS_OF } from "../demo/clock";
import { readHandoverPolicy } from "../demo/policy";
import { buildKnowledge, HANDOVER_DRAFT_DOCS, HANDOVER_GENERAL_DOCS } from "./knowledge";
import { maskPii } from "./mask";
import { readPostopDay } from "./postop";
import { asksAdminQuestion, expandQuery, HANDOVER_GENERAL_MAX, MIN_TOP_SCORE, parseQuerySynonyms, retrieve, retrieveForHandover, stripSearchAlias, TOP_K } from "./retrieve";
import { search } from "./search";
import { loadVault } from "./vault";
import { fixtureFiles } from "./__fixtures__/load";

const k = realKnowledge();
const ids = (r: { hits: { chunk: { chunkId: string } }[] }) => r.hits.map((h) => h.chunk.chunkId);
const G46 = "수술 2주째 환자가 이식 부위에서 고름이 나온다는데 연고 바르라고 해도 돼요?";

function knowledgeWith(edit: (path: string, raw: string) => string) {
  const files = realInputs().vaultFiles.map((f) => ({ ...f, raw: edit(f.path, f.raw) }));
  return buildKnowledge(loadVault(files, { asOf: DEMO_AS_OF }));
}

describe("직원 질문의 인계 절차 앞세우기(규칙 3)", () => {
  it("적신호·약 말이 든 직원 질문은 적신호·약·인계 절차 문단을 앞에 둔다(2회차 G46: 상위 5개가 모두 V07이었다)", () => {
    const r = retrieve(k.index, "staff-qa", G46);
    expect(r.hits.slice(0, 3).map((h) => [h.chunk.chunkId, h.pin])).toEqual([
      ["V11#4", "redflag"], // 직원이 하지 않는 것 — 어떤 약을 먹어야 하는지 스스로 말하지 않는다
      ["V17#1", "medication"], // 직원이 하는 일 — 약 문의는 기록해 의료진에게 넘긴다
      ["V12#2", "handover"], // 몇 분 안에 — 적신호 문의는 5분 안에 인계(2회차 G46 검토에서 빠진 핵심)
    ]);
    expect(r.hits[2].chunk.text).toContain("5분 안에 인계합니다");
    expect(r.hits).toHaveLength(5);
  });

  it("근거 강도는 앞세운 문단이 아니라 BM25 점수로만 잰다", () => {
    const r = retrieve(k.index, "staff-qa", G46);
    const plain = search(k.index.rules!.strengthIndex!, G46, 1000).hits;
    expect(r.topScore).toBe(plain[0].score);
    expect(r.hits.slice(0, 3).every((h) => h.pin !== null)).toBe(true);
  });

  it("약 말 중 지도(약도)·식사(먹어도)·광고(부작용) 뜻으로 흔히 쓰는 말만 있으면 앞세우지 않는다 — 문의 게이트는 그대로 인계한다", () => {
    for (const q of ["병원 약도 어디서 보내 줘요?", "상담 전에 점심 먹어도 돼요?", "광고에 부작용 없다고 써도 돼요?"]) {
      expect(retrieve(k.index, "staff-qa", q).hits.filter((h) => h.pin === "medication" || h.pin === "handover")).toEqual([]);
    }
    // 게이트(인계)는 넓은 목록 그대로다: 과잉 인계는 허용하고 누락은 허용하지 않는다.
    expect(k.medication.terms).toContain("약도");
    expect(retrieve(k.index, "staff-qa", "피나스테리드 부작용 물어보면요?").hits.some((h) => h.pin === "medication")).toBe(true);
  });

  it("적신호·약 말이 없는 직원 질문과 환자 문의에는 앞세우지 않는다", () => {
    expect(retrieve(k.index, "staff-qa", "첫 상담은 몇 분 걸려요?").hits.some((h) => h.pin !== null)).toBe(false);
    // 문의는 적신호·약 말이 있으면 규칙 게이트가 인계해 검색까지 오지 않는다. 검색만 불러도 앞세우지 않는다.
    expect(retrieve(k.index, "reply", G46).hits.some((h) => h.pin === "redflag" || h.pin === "handover" || h.pin === "medication")).toBe(false);
  });

  it("말 목록은 볼트 json(V11·V17)에서 온다 — 목록에서 빼면 앞세우지 않는다", () => {
    const kr = knowledgeWith((path, raw) =>
      path === "redflags.md" ? raw.replace('"고름", "농이", ', "") : path === "medication-policy.md" ? raw.replace('"연고", ', "") : raw,
    );
    if (!kr.ok) throw new Error(kr.errors.join("\n"));
    // '2주째'는 경과일이라 날짜 세는 기준 문단(day-base)은 여전히 붙는다. 규칙 3의 문단만 본다.
    expect(retrieve(kr.knowledge.index, "staff-qa", G46).hits.filter((h) => h.pin !== null && h.pin !== "day-base")).toEqual([]);
  });

  it("약 말만 있으면 약 문서와 인계 절차만 앞에 둔다", () => {
    const r = retrieve(k.index, "staff-qa", "미녹시딜이랑 먹는 탈모약을 같이 먹어도 되냐는 문의에는 뭐라고 답해요?");
    expect(r.hits.filter((h) => h.pin !== null).map((h) => [h.chunk.chunkId, h.pin])).toEqual([
      ["V17#1", "medication"],
      ["V12#0", "handover"],
    ]);
  });
});

describe("날짜 세는 기준 함께 보내기(규칙 4)", () => {
  it("경과일을 말한 직원 질문에 D+N 문단이 걸리면 D+0 기준 문단을 그 뒤에 넣고, 발췌 개수는 그대로 둔다(G16)", () => {
    const r = retrieve(k.index, "staff-qa", "수술 3일째 환자가 머리를 감아도 되냐고 물으면 뭐라고 해요?");
    expect(ids(r)).toEqual(["V07#3", "V07#2", "V07#0", "V06#4", "V13#3"]);
    expect(r.hits[2].pin).toBe("day-base");
    expect(r.hits[2].chunk.text).toContain("날짜는 수술일을 D+0으로 셉니다");
  });

  it("경과일 앞세우기(답장)에도 함께 가고, 구간 문단 뒤에 선다", () => {
    const r = retrieve(k.index, "reply", "수술 9일째인데 샴푸는 뭘 써요?", 9);
    const base = r.hits.findIndex((h) => h.pin === "day-base");
    expect(r.hits[base].chunk.chunkId).toBe("V07#0");
    expect(r.hits.slice(0, base).every((h) => h.postopBoost)).toBe(true);
    expect(r.hits).toHaveLength(5);
  });

  it("날짜 기준 문단은 앞세운 문단(적신호·약·인계)을 밀어내지 않는다", () => {
    const q = "수술 2주째 D+14 머리 감기 중인 환자가 고름이 나온다는데 연고 바르라고 해도 돼요?";
    const r = retrieve(k.index, "staff-qa", q);
    const pinned = r.hits.filter((h) => h.pin !== null && h.pin !== "day-base").map((h) => h.chunk.chunkId);
    expect(pinned).toEqual(["V11#4", "V17#1", "V12#2"]);
    expect(r.hits).toHaveLength(5);
  });

  it("경과일을 말하지 않은 질문에는 넣지 않는다 — 예약 문의에 'D+1 내원' 문단이 점수로 섞여도(Q33)", () => {
    const r = retrieve(k.index, "reply", "이번 주 수요일 오후 3시 상담 예약을 다음 주로 미룰 수 있을까요?");
    expect(r.hits.some((h) => h.pin === "day-base")).toBe(false);
  });
});

describe("질의 넓히기(규칙 1)", () => {
  it("넓히기 말이 있으면 문서의 말을 뒤에 붙이고, 이미 있거나 없으면 그대로 둔다", () => {
    const syn = [{ words: ["바꾸", "미룰"], searchAs: "예약 변경" }];
    expect(expandQuery("상담을 바꾸고 싶어요", syn)).toEqual({ query: "상담을 바꾸고 싶어요 예약 변경", expandedWith: ["예약 변경"] });
    expect(expandQuery("예약 변경 바꾸고", syn)).toEqual({ query: "예약 변경 바꾸고", expandedWith: [] });
    expect(expandQuery("주차 되나요", syn)).toEqual({ query: "주차 되나요", expandedWith: [] });
  });

  it("볼트 V04 json에서 읽는다", () => {
    expect(k.index.rules?.synonyms).toEqual([
      {
        words: ["바꾸", "바꿔", "바꿀", "바꿨", "미루", "미룰", "미뤄", "미뤘"],
        withAny: ["예약", "상담", "방문", "내원", "진료", "수술", "일정", "날짜", "요일", "오전", "오후", "시간"],
        searchAs: "예약 변경",
      },
    ]);
  });

  it("withAny의 말이 함께 없으면 넓히지 않는다 — '샴푸 바꿔도', '염색 미뤄야'에 예약 문단이 붙지 않게", () => {
    for (const mode of ["reply", "staff-qa"] as const) {
      for (const q of ["샴푸 바꿔도 돼요?", "염색 미뤄야 하나요?", "카드 할부 개월 수 바꿀 수 있어요?"]) {
        expect(retrieve(k.index, mode, q).expandedWith).toEqual([]);
      }
    }
    expect(retrieve(k.index, "staff-qa", "방문 당일 오전에 예약 시간을 오후로 바꿔 달라는데 바꿔 줘도 돼요?").expandedWith).toEqual(["예약 변경"]);
  });

  it("'바꾸고 싶어요'·'미룰 수'로 쓴 예약 변경 문의가 예약 변경 문단(V04#4)을 찾는다(2회차 오보류 G28=Q17, 숨은 Q33)", () => {
    const { inquiriesJson } = realInputs();
    for (const id of ["Q17", "Q33"]) {
      const q = (inquiriesJson as { id: string; text: string }[]).find((x) => x.id === id)!;
      const r = retrieve(k.index, "reply", maskPii(q.text).masked);
      expect(r.expandedWith).toEqual(["예약 변경"]);
      expect(ids(r)).toContain("V04#4");
    }
  });

  it("빈 말·빈 searchAs·배열 아닌 값은 거부한다(빈 말은 모든 질의에 걸린다)", () => {
    expect(parseQuerySynonyms({ searchSynonyms: [{ words: [" "], searchAs: "예약 변경" }] }, "V04").ok).toBe(false);
    expect(parseQuerySynonyms({ searchSynonyms: [{ words: ["바꾸"], searchAs: "" }] }, "V04").ok).toBe(false);
    expect(parseQuerySynonyms({ searchSynonyms: "바꾸" }, "V04").ok).toBe(false);
    expect(parseQuerySynonyms({ searchSynonyms: [] }, "V04")).toEqual({ ok: true, synonyms: [] });
    // withAny를 빈 배열로 두면 어디에도 붙지 않는다 — 뜻을 알 수 없어 거부한다.
    expect(parseQuerySynonyms({ searchSynonyms: [{ words: ["바꾸"], withAny: [], searchAs: "예약 변경" }] }, "V04").ok).toBe(false);
  });

  it("V04에 json이 없으면 넓히지 않고, 있는데 깨졌으면 지식 전체를 멈춘다", () => {
    const fx = buildKnowledge(loadVault(fixtureFiles()));
    if (!fx.ok) throw new Error(fx.errors.join("\n"));
    expect(fx.knowledge.index.rules?.synonyms).toEqual([]);
    const broken = knowledgeWith((path, raw) => (path === "booking-policy.md" ? raw.replace('"searchAs": "예약 변경"', '"searchAs": ""') : raw));
    expect(broken).toEqual({ ok: false, errors: ["V04 searchSynonyms searchAs가 비어 있습니다"] });
    // json 문법이 깨진 경우(쉼표 빠짐)도 조용히 넘기지 않는다.
    const syntax = knowledgeWith((path, raw) => (path === "booking-policy.md" ? raw.replace('"searchAs": "예약 변경"', '"searchAs" "예약 변경"') : raw));
    expect(syntax.ok).toBe(false);
    if (!syntax.ok) expect(syntax.errors.join("\n")).toMatch(/V04: json을 읽을 수 없습니다/);
  });
});

describe("근거 강도는 검색을 돕는 장치를 빼고 잰다(3차 적대 검증)", () => {
  it("소제목 끝의 찾는 말 괄호만 떼고, 숫자가 든 괄호(날짜 구간·판)는 남긴다", () => {
    expect(stripSearchAlias("예약 변경(날짜·시간을 바꾸고 싶을 때)")).toBe("예약 변경");
    expect(stripSearchAlias("준비할 것(준비해 올 것)")).toBe("준비할 것");
    expect(stripSearchAlias("수술 후 머리 감기(D+3~D+14)")).toBe("수술 후 머리 감기(D+3~D+14)");
    expect(stripSearchAlias("예약·변경·취소·예약금·환불 규정 (3판)")).toBe("예약·변경·취소·예약금·환불 규정 (3판)");
    expect(stripSearchAlias("음주(술)와 흡연")).toBe("음주(술)와 흡연");
    expect(stripSearchAlias(null)).toBeNull();
  });

  it("넓히기 말이나 찾는 말 소제목과만 겹치는 근거 없는 질문은 그대로 검색 단계에서 멈춘다", () => {
    // 3차 적대 검증 재현 사례. 넓힌 질의·찾는 말 소제목으로 잴 때는 19.8·21.3·23.3까지 올라 보류가 풀렸다.
    for (const q of ["카드 할부 개월 수 바꿀 수 있어요?", "무이자 할부 미룰 수 있나요?", "근처 제휴 숙소 가는 길 안내할 수 있어요? 준비해 올 것도요"]) {
      expect(retrieve(k.index, "staff-qa", q).weak).toBe(true);
    }
    // 순위에는 찾는 말이 그대로 쓰인다(G13 준비물 문단이 1위).
    expect(retrieve(k.index, "staff-qa", "근처 제휴 숙소 가는 길 안내할 수 있어요? 준비해 올 것도요").hits[0].chunk.chunkId).toBe("V05#2");
  });

  it("근거 강도 = 넓히기 전 질의 × 찾는 말을 뗀 색인의 최고 점수", () => {
    const q = "보호자가 대신 와이파이 비밀번호 물어봐요";
    const r = retrieve(k.index, "staff-qa", q);
    expect(r.topScore).toBe(search(k.index.rules!.strengthIndex!, q, 1).hits[0].score);
    // 순위 색인으로 재면 찾는 말("보호자가 대신 예약할 때") 때문에 거의 두 배가 된다.
    expect(search(k.index, q, 1).hits[0].score).toBeGreaterThan(r.topScore * 1.5);
  });
});

describe("볼트 소제목·넓히기 뒤에도 근거 없음 판정이 그대로다", () => {
  const { goldenJson, inquiriesJson } = realInputs();
  const golden = goldenJson as { id: string; kind: string; question?: string; inquiryId?: string; mustHold: boolean; mustHandover: boolean }[];
  const inquiries = inquiriesJson as { id: string; text: string }[];
  const run = (g: (typeof golden)[number]) =>
    g.kind === "staff-qa" ? retrieve(k.index, "staff-qa", maskPii(g.question!).masked) : retrieve(k.index, "reply", maskPii(inquiries.find((q) => q.id === g.inquiryId)!.text).masked);

  it("근거 없음 8문항 중 검색 단계에서 멈추는 3개(와이파이·할부·숙소)는 그대로 멈춘다", () => {
    const noSource = golden.filter((g) => g.mustHold && !g.mustHandover);
    expect(noSource).toHaveLength(8);
    expect(noSource.filter((g) => run(g).weak).map((g) => g.id)).toEqual(["G34", "G36", "G38"]);
  });

  it("답할 수 있는 문항은 하나도 검색 단계에서 멈추지 않는다", () => {
    const answerable = golden.filter((g) => !g.mustHold);
    expect(answerable.filter((g) => run(g).topScore < MIN_TOP_SCORE).map((g) => g.id)).toEqual([]);
  });

  it("2회차 오보류 문항의 정답 문단이 상위 5개에 든다(G13 준비물, G21 사진 각도·장수)", () => {
    expect(ids(retrieve(k.index, "staff-qa", "첫 상담 올 때 뭘 준비해 오라고 안내해요?"))).toContain("V05#2");
    expect(ids(retrieve(k.index, "staff-qa", "경과 사진은 어떤 각도로 몇 장 찍어요?"))).toContain("V10#1");
  });
});

describe("인계 초안 발췌(PRD v0.3, retrieveForHandover)", () => {
  const inquiry = (id: string) => (realInputs().inquiriesJson as { id: string; text: string }[]).find((q) => q.id === id)!.text;
  const forInquiry = (id: string) => retrieveForHandover(k.index, maskPii(inquiry(id)).masked);
  const shape = (r: ReturnType<typeof forInquiry>) => r.hits.map((h) => [h.chunk.chunkId, h.pin, h.postopBoost]);

  it("보낼 수 있는 문단은 V12 고정 안내 · V11 즉시 조치 · V07 '이상하면 연락' 셋뿐(지금 볼트)", () => {
    const rules = k.index.rules!.handoverDraft!;
    expect(rules.chunkIds).toEqual(["V12#4", "V07#13", "V11#2"]);
    expect([rules.fixedChunkId, rules.urgentChunkId]).toEqual(["V12#4", "V11#2"]);
    // V07 '수술 당일 밤'(V07#1)은 즉시 조치 소제목이지만 "처방받은 약은 처방받은 대로 복용합니다"가 있어 뺀다. V17 문단은 모두 약 말이나 직원 절차다.
    expect(rules.chunkIds).not.toContain("V07#1");
    expect(rules.chunkIds.some((id) => id.startsWith("V17#"))).toBe(false);
    expect(rules.fixedMessage).toBe(readHandoverPolicy(k.chunks).patientMessage!.value);
  });

  it("의료가 아닌 물음용 문단(오너 두 번째 결정): 진료시간·가격·예약·쇼핑몰 문서에서 변경 이력·직원·AI 규칙·효과·증상·수술 후 일정 절, '직원' 문단, 응답이 늦어진다는 문단을 뺀 것", () => {
    const rules = k.index.rules!.handoverDraft!;
    expect(rules.generalChunkIds).toEqual(["V04#2", "V04#4", "V04#5", "V04#6", "V02#0", "V02#2", "V02#5", "V02#6", "V03#1", "V03#2", "V03#4", "V03#5", "V18#0", "V18#2"]);
    // 빠진 것: V04 변경 이력(#0)·'직원' 문단(#1 확정 연락, #3 입금 대조), V02 휴진일 급한 증상(#4), V03 원칙(#0)·가격을 물으면(#6), V18 효과(#3)·게시판(#4).
    for (const id of ["V04#0", "V04#1", "V04#3", "V02#4", "V03#0", "V03#6", "V18#3", "V18#4"]) expect(rules.generalChunkIds).not.toContain(id);
    // 2026-09-30 적대 검증: 응답이 늦어진다는 문단(점심시간 V02#1 "순서대로 답합니다", 휴진 V02#3 "순서대로 확인합니다", 쇼핑몰 V18#1 "답하지 않고")은
    // 승인 문구의 "바로 전달했습니다"와 부딪치고, 수술 후 일정·비용 문단(V04#7·V03#3)은 수술 후 관리·두피 주사 문서로 안내한다.
    for (const id of ["V02#1", "V02#3", "V18#1", "V04#7", "V03#3"]) expect([id, rules.generalChunkIds!.includes(id)]).toEqual([id, false]);
    // 인용 허용 문서 = 인계 문서 + 의료가 아닌 물음용 문서(승인된 최신판).
    expect([...k.handoverAllowedDocIds].sort()).toEqual([...HANDOVER_DRAFT_DOCS, ...HANDOVER_GENERAL_DOCS].sort());
    expect(rules.docIds).toEqual([...k.handoverAllowedDocIds]);
  });

  // 2026-09-30 검증: 경과일 앞세우기·날짜 세는 기준이 켜져 있어 발췌가 V07 날짜별 일반 관리로 찼다(Q06 V12#4 V07#3 V07#9 V07#2 V07#0,
  // Q11 V12#4 V07#3 V07#0 V07#5 V07#1). 즉시 조치(119) 문장이 든 V11#2는 자주 빠졌다.
  it("Q06(수술 9일째 고름 — 물음은 '문 닫았죠?'·'월요일에 가도 될까요?'): 고정 안내 → 즉시 조치(V11#2) → V07 '이상하면 연락'. 행정 안내·경과일 앞세우기·날짜 세는 기준은 없다", () => {
    // 2026-09-30 적대 검증 전에는 점수만으로 예약금(V04#2)·경과 진료 일정(V04#7 — [[postop-care]] 링크) 문단이 붙었다. 지금은 물음 절에 의료가 아닌 물음의 말이 있을 때만 붙는다.
    expect(shape(forInquiry("Q06"))).toEqual([
      ["V12#4", "handover", false],
      ["V11#2", "redflag", false],
      ["V07#13", null, false],
    ]);
    expect(forInquiry("Q06").postopDay).toBeNull();
  });

  it("섞인 의료가 아닌 물음: Q21(두피 관리 얼마예요?)은 가격표 두피 관리 문단, Q36(경과 진료 시간을 늦출 수 있는지도 물음)은 예약 문단, Q40(반품 되나요?)은 쇼핑몰 문단", () => {
    expect(ids(forInquiry("Q21")).slice(0, 3)).toEqual(["V12#4", "V11#2", "V03#5"]);
    expect(ids(forInquiry("Q36"))).toEqual(["V12#4", "V11#2", "V04#4", "V02#2"]);
    expect(ids(forInquiry("Q40"))).toEqual(["V12#4", "V11#2", "V18#0", "V07#13"]);
  });

  it("행정 안내 문단은 문의의 물음 절에 의료가 아닌 물음의 말이 있을 때만 — Q22(점심시간 문단 V02#1)·Q14(쇼핑몰 V18#1)·Q19(주사 가격)·Q08(예약 변경)에 붙지 않는다(2026-09-30 적대 검증)", () => {
    // Q22 "상담 가능한 시간에 전화 주세요"는 부탁이지 물음이 아니다. 전에는 점심시간 문단("응대를 하지 않습니다 … 순서대로 답합니다")이 20점으로 붙었다.
    expect(ids(forInquiry("Q22"))).toEqual(["V12#4", "V11#2", "V07#13"]);
    // Q14 "번호는 예약 기록과 같다고 함"의 '예약'은 물음 절이 아니다. 전에는 쇼핑몰 안내(V18#1)·수술 예약금(V04#6)이 붙었다.
    expect(ids(forInquiry("Q14"))).toEqual(["V12#4", "V11#2"]);
    expect(ids(forInquiry("Q19"))).toEqual(["V12#4", "V11#2"]);
    expect(ids(forInquiry("Q08"))).toEqual(["V12#4", "V11#2"]);
    expect(asksAdminQuestion("수술 9일째인데 고름이 나와요. 모당 가격도 알려 주세요")).toBe(true);
    expect(asksAdminQuestion("38도 넘게 열이 난다고 함. 번호는 예약 기록과 같다고 함.")).toBe(false);
    // 응답이 늦어진다는 문단은 물음이 있어도 오지 않는다(점심시간 물음).
    expect(ids(retrieveForHandover(k.index, "수술 3일째 피가 계속 나요. 점심시간에도 전화 받나요?"))).not.toContain("V02#1");
  });

  it("Q11(열흘째 뜨겁고 아파요, 골든 G49): 일반 검색으론 근거 약함이어도 고정 안내·즉시 조치를 받는다 — 날짜별 일반 관리 문단은 없다", () => {
    const text = inquiry("Q11");
    expect(retrieve(k.index, "reply", maskPii(text).masked, readPostopDay(text)?.days ?? null).weak).toBe(true);
    expect(shape(forInquiry("Q11"))).toEqual([
      ["V12#4", "handover", false],
      ["V11#2", "redflag", false],
    ]);
  });

  it("Q25(탈모약 반으로 잘라 먹어도?, 골든 G48): 약 문의에도 V17 직원 문단·V07 복용 안내가 발췌에 없다", () => {
    expect(shape(forInquiry("Q25"))).toEqual([
      ["V12#4", "handover", false],
      ["V11#2", "redflag", false],
      ["V07#13", null, false],
    ]);
  });

  it("Q26(일주일째 볼록·하얀 게, 골든 G50): 고정 안내 → 즉시 조치 → '이상하면 연락'", () => {
    expect(shape(forInquiry("Q26"))).toEqual([
      ["V12#4", "handover", false],
      ["V11#2", "redflag", false],
      ["V07#13", null, false],
    ]);
  });

  it("인계 초안 대상 전부: 첫 두 칸은 고정 안내·즉시 조치, 나머지도 보낼 수 있는 문단뿐, 날짜 문단·경과일 표시 없음, 행정 안내는 기준 점수 이상 최대 2칸", () => {
    const rules = k.index.rules!.handoverDraft!;
    const allowed = new Set([...rules.chunkIds, ...rules.generalChunkIds!]);
    const general = new Set(rules.generalChunkIds);
    for (const id of ["Q03", "Q06", "Q07", "Q08", "Q09", "Q10", "Q11", "Q13", "Q14", "Q19", "Q21", "Q22", "Q24", "Q25", "Q26", "Q27", "Q32", "Q35", "Q36", "Q40"]) {
      const r = forInquiry(id);
      expect([id, ids(r).slice(0, 2)]).toEqual([id, ["V12#4", "V11#2"]]);
      expect([id, r.hits.every((h) => allowed.has(h.chunk.chunkId) && !h.postopBoost && h.pin !== "day-base")]).toEqual([id, true]);
      expect(r.hits.every((h) => k.handoverAllowedDocIds.has(h.chunk.docId))).toBe(true);
      const g = r.hits.filter((h) => general.has(h.chunk.chunkId));
      expect([id, g.length <= HANDOVER_GENERAL_MAX && g.every((h) => h.score >= MIN_TOP_SCORE && h.pin === null)]).toEqual([id, true]);
      expect(r.hits.length).toBeLessThanOrEqual(TOP_K);
    }
    // 물음 절에 의료가 아닌 물음의 말이 없는 문의에는 행정 안내 문단이 붙지 않는다. 붙는 것은 Q21(얼마)·Q36(시간)·Q40(반품)뿐이다.
    const withGeneral = ["Q03", "Q06", "Q07", "Q08", "Q09", "Q10", "Q11", "Q13", "Q14", "Q19", "Q21", "Q22", "Q24", "Q25", "Q26", "Q27", "Q32", "Q35", "Q36", "Q40"].filter((id) =>
      ids(forInquiry(id)).some((c) => general.has(c)),
    );
    expect(withGeneral).toEqual(["Q21", "Q36", "Q40"]);
  });

  it("V07 즉시 조치 문단에서 약 말이 빠지면 들어오고, V17의 직원·알아보는 말·공개 창구 절은 약 말이 없어도 들어오지 않는다", () => {
    const kr = knowledgeWith((path, raw) =>
      path === "postop-care.md"
        ? raw.replace("처방받은 약은 처방받은 대로 복용합니다. ", "")
        : path === "medication-policy.md"
          ? raw.replace("약의 용량, 복용 중단, 다른 약과 함께 먹어도 되는지, 부작용에 관한 질문은 의료진만 답합니다. ", "")
          : raw,
    );
    if (!kr.ok) throw new Error(kr.errors.join("\n"));
    const got = kr.knowledge.index.rules!.handoverDraft!.chunkIds;
    expect(got).toContain("V07#1");
    // V17 '원칙'은 약 말이 든 첫 문장을 지우면 들어온다(직원 절 아님). '직원이 하는 일'·'공개 창구의 약 질문'은 그대로 빠진다.
    expect(got).toContain("V17#0");
    expect(got).not.toContain("V17#1");
    expect(got).not.toContain("V17#5");
  });

  it("인계 카드의 승인 문구와 인계 초안의 고정 안내 문단·승인 문구는 같다(한 선택기)", () => {
    const p = readHandoverPolicy(k.chunks).patientMessage!;
    expect([p.chunkId, p.value]).toEqual([k.index.rules!.handoverDraft!.fixedChunkId, k.index.rules!.handoverDraft!.fixedMessage]);
  });

  it("일반 검색(retrieve)은 인계 초안 규칙이 붙어도 바뀌지 않는다 — 인계 발췌 제한·고정 문단은 retrieveForHandover에만", () => {
    const text = inquiry("Q06");
    const r = retrieve(k.index, "reply", maskPii(text).masked, 9);
    expect(r.hits.some((h) => h.pin === "handover")).toBe(false);
    const noRules = retrieve({ ...k.index, rules: { ...k.index.rules!, handoverDraft: null } }, "reply", maskPii(text).masked, 9);
    expect(ids(r)).toEqual(ids(noRules));
  });

  it("규칙이 없거나 고정 안내 문단을 읽지 못하면 고정 문단이 발췌에 없다(record.ts가 모델 없이 보류)", () => {
    const text = maskPii(inquiry("Q06")).masked;
    expect(retrieveForHandover({ ...k.index, rules: { ...k.index.rules!, handoverDraft: null } }, text).hits).toEqual([]);
    const kr = knowledgeWith((path, raw) => (path === "handover-procedure.md" ? raw.replace("## 환자에게 보내는 고정 안내 문장", "## 환자에게 보내는 문장") : raw));
    if (!kr.ok) throw new Error(kr.errors.join("\n"));
    expect([kr.knowledge.index.rules!.handoverDraft!.fixedChunkId, kr.knowledge.index.rules!.handoverDraft!.fixedMessage]).toEqual([null, null]);
    expect(retrieveForHandover(kr.knowledge.index, text).hits.some((h) => h.chunk.docId === "V12")).toBe(false);
    // 고정 안내가 없으면 초안을 만들지 않으므로 행정 안내 문단도 더하지 않는다.
    const general = new Set(kr.knowledge.index.rules!.handoverDraft!.generalChunkIds);
    expect(retrieveForHandover(kr.knowledge.index, text).hits.some((h) => general.has(h.chunk.chunkId))).toBe(false);
  });
});
