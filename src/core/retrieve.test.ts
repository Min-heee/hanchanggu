import { describe, expect, it } from "vitest";
import { realInputs, realKnowledge } from "../demo/__fixtures__/real";
import { DEMO_AS_OF } from "../demo/clock";
import { buildKnowledge } from "./knowledge";
import { maskPii } from "./mask";
import { expandQuery, MIN_TOP_SCORE, parseQuerySynonyms, retrieve, stripSearchAlias } from "./retrieve";
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
