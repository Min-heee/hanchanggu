import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkRedflags, extractSelfReportedDays, mergeRoute, parseRedflagConfig, type RedflagConfig } from "./redflag";
import { activeJson, loadVault } from "./vault";
import { fixtureFiles } from "./__fixtures__/load";

/** 실제 볼트의 V11(간호팀이 관리하는 목록). 변형 문장 회귀 시험은 픽스처가 아니라 이 목록으로 돈다. */
function realV11(): RedflagConfig {
  const path = join(fileURLToPath(new URL(".", import.meta.url)), "../../vault/redflags.md");
  const j = activeJson(loadVault([{ path: "redflags.md", raw: readFileSync(path, "utf8") }]), "V11");
  if (!j.ok) throw new Error(j.error);
  const c = parseRedflagConfig(j.value);
  if (!c.ok) throw new Error(c.error);
  return c.config;
}

function v11(): RedflagConfig {
  const j = activeJson(loadVault(fixtureFiles()), "V11");
  if (!j.ok) throw new Error(j.error);
  const c = parseRedflagConfig(j.value);
  if (!c.ok) throw new Error(c.error);
  return c.config;
}

describe("parseRedflagConfig", () => {
  it("V11 json을 읽는다", () => {
    expect(v11()).toEqual({
      symptoms: ["고름", "열이", "심한 출혈", "숨이 차", "붓기가 심해"],
      postopContext: ["수술 후", "이식 부위", "D+", "일째"],
      postopContextPatterns: ["\\d{1,3}\\s*(일|주)\\s*(째|차)"],
      feverThresholdCelsius: 38,
      ambiguous: ["붓기", "가려", "빨개"],
    });
  });

  it("증상어·문맥어가 비었거나 모양이 틀리면 거부한다(빈 목록은 '적신호 없음'처럼 보이므로)", () => {
    const ok = { postopContextPatterns: [], feverThresholdCelsius: 38 };
    expect(parseRedflagConfig({ ...ok, symptoms: [], postopContext: ["수술 후"], ambiguous: [] })).toEqual({ ok: false, error: "symptoms가 비어 있습니다" });
    expect(parseRedflagConfig({ ...ok, symptoms: ["고름"], postopContext: [], ambiguous: [] })).toEqual({ ok: false, error: "postopContext가 비어 있습니다" });
    expect(parseRedflagConfig({ ...ok, symptoms: ["고름", ""], postopContext: ["x"], ambiguous: [] }).ok).toBe(false);
    expect(parseRedflagConfig({ ...ok, symptoms: ["고름"], postopContext: ["x"] }).ok).toBe(false);
    expect(parseRedflagConfig([]).ok).toBe(false);
  });

  it("체온 기준·문맥 정규식은 빠지거나 틀리면 거부한다(기본값을 채우지 않는다)", () => {
    const base = { symptoms: ["고름"], postopContext: ["x"], ambiguous: [], postopContextPatterns: [] };
    expect(parseRedflagConfig(base)).toEqual({ ok: false, error: "feverThresholdCelsius는 37~40 사이의 숫자여야 합니다" });
    expect(parseRedflagConfig({ ...base, feverThresholdCelsius: 83 }).ok).toBe(false);
    expect(parseRedflagConfig({ ...base, feverThresholdCelsius: 38, postopContextPatterns: ["(열"] })).toEqual({
      ok: false,
      error: "postopContextPatterns의 정규식을 읽을 수 없습니다: (열",
    });
    const { postopContextPatterns: _drop, ...noPatterns } = base;
    void _drop;
    expect(parseRedflagConfig({ ...noPatterns, feverThresholdCelsius: 38 }).ok).toBe(false);
  });
});

describe("checkRedflags — 판정표", () => {
  const cfg = v11();

  it("RF-01: 증상어 + 수술 후 문맥 → 긴급 인계", () => {
    const r = checkRedflags("수술 9일째인데 이식 부위에서 고름이 나와요", cfg);
    expect(r.decision).toBe("handover");
    expect(r.urgency).toBe("urgent");
    expect(r.ruleIds).toEqual(["RF-01"]);
    expect(r.matchedSymptoms).toEqual(["고름"]);
    expect(r.matchedContext).toEqual(["이식 부위", "일째", "9일째"]);
  });

  it("RF-02: 문맥 없이 증상어만 있어도 인계(fail-closed)", () => {
    const r = checkRedflags("어제부터 열이 나요", cfg);
    expect([r.decision, r.urgency, r.ruleIds]).toEqual(["handover", "normal", ["RF-02"]]);
  });

  it("RF-03: 모호어 + 수술 후 문맥 → 인계", () => {
    const r = checkRedflags("D+5인데 붓기가 있어요", cfg);
    expect([r.decision, r.ruleIds, r.matchedAmbiguous]).toEqual(["handover", ["RF-03"], ["붓기"]]);
  });

  it("모호어만 있고 문맥이 없으면 통과하되 메모를 남긴다", () => {
    const r = checkRedflags("모발이식하면 붓기가 보통 얼마나 가나요?", cfg);
    expect(r.decision).toBe("pass");
    expect(r.notes.length).toBe(1);
  });

  it("증상어와 모호어가 함께 문맥과 걸리면 두 규칙을 모두 적는다", () => {
    expect(checkRedflags("수술 후 붓기가 심해지고 열이 나요", cfg).ruleIds).toEqual(["RF-01", "RF-03"]);
  });

  it("공백·전각 차이를 무시한다: '숨이  차요', 'Ｄ＋３'", () => {
    expect(checkRedflags("숨이  차요", cfg).decision).toBe("handover");
    expect(checkRedflags("Ｄ＋３ 가려워요", cfg).ruleIds).toEqual(["RF-03"]);
  });

  it("부정문도 인계한다(부정 판별을 규칙에 넣지 않는다)", () => {
    expect(checkRedflags("수술 후 열이 나진 않는데요", cfg).decision).toBe("handover");
  });

  it("증상 없는 일반 문의는 통과", () => {
    const r = checkRedflags("다음 주 예약을 목요일로 바꾸고 싶어요", cfg);
    expect(r).toEqual({ decision: "pass", urgency: null, ruleIds: [], matchedSymptoms: [], matchedAmbiguous: [], matchedContext: [], notes: [] });
  });

  it("단어 목록은 입력 json을 따른다(하드코딩 없음): 목록을 바꾸면 판정이 바뀐다", () => {
    const custom: RedflagConfig = { symptoms: ["진물"], postopContext: ["시술 후"], postopContextPatterns: [], feverThresholdCelsius: 38, ambiguous: [] };
    expect(checkRedflags("시술 후 진물이 나요", custom).ruleIds).toEqual(["RF-01"]);
    expect(checkRedflags("수술 후 고름이 나요", custom).decision).toBe("pass");
  });
});

describe("checkRedflags — 숫자 표현(V11의 정규식·체온 기준)", () => {
  const cfg = v11();

  it("체온은 기준 이상 숫자면 증상어로 본다(38.5도, 40℃). 기준 미만·체온 범위 밖은 아니다", () => {
    expect(checkRedflags("열이 38.5도까지", { ...cfg, symptoms: ["고름"] }).matchedSymptoms).toEqual(["38.5도"]);
    expect(checkRedflags("체온 40℃예요", cfg).ruleIds).toEqual(["RF-02"]);
    expect(checkRedflags("37.5도 정도예요", { ...cfg, symptoms: ["고름"] }).matchedSymptoms).toEqual([]);
    expect(checkRedflags("머리를 180도 돌려", cfg).matchedSymptoms).toEqual([]);
    expect(checkRedflags("고개를 90도로 숙이면", cfg).matchedSymptoms).toEqual([]);
    // 기준은 json 값을 따른다.
    expect(checkRedflags("37.5도", { ...cfg, feverThresholdCelsius: 37.5 }).decision).toBe("handover");
  });

  it("'3주차'·'2일차'는 문맥, '주차 정산'은 문맥이 아니다(숫자를 요구)", () => {
    expect(checkRedflags("이식 3주차인데 빨개요", { ...cfg, postopContext: ["없는말"] }).ruleIds).toEqual(["RF-03"]);
    expect(checkRedflags("주차 정산 빨개요", { ...cfg, postopContext: ["없는말"] }).decision).toBe("pass");
  });
});

/**
 * 변형 문장 회귀 시험. 목록을 쓴 쪽이 아니라 검증자가 따로 쓴 문장이다(9/28 데이터·코어 검증 보고).
 * 이 문장들로 목록을 넓혔으므로 이제는 '본 문장'이다. 새 변형 세트는 사람이 따로 써서 더한다.
 */
describe("checkRedflags — 실제 V11로 변형 문장이 모두 인계된다", () => {
  const cfg = realV11();
  const paraphrases = [
    "열이 38.5도까지 올라갔어요",
    "체온이 40도예요",
    "숨차요",
    "숨 차서 힘들어요",
    "가슴 답답해요",
    "호흡곤란이 와요",
    "수술 3일 됐는데 이마가 부었어요",
    "모발이식하고 5일 지났는데 너무 부어요",
    "이식하고 나서 계속 욱신거려요",
    "어제 이식했는데 피가 좀 나요",
    "시술하고 나서 빨갛게 올라왔어요",
    "수술 일주일 지났는데 진물이 나요",
    "주사 맞았는데 붓고 아파요",
    "피 안 멈춰요",
    "그저께 수술했어요 너무 아파요",
    "이식 3주차인데 뾰루지가 났어요",
    "수술 3일 됐는데 진물이 나요",
    "모발이식했는데 피가 나요",
    "이식 3일차인데 머리가 아파요",
    "어제부터 열이 나요",
    "시술 받은 지 일주일인데 빨갛게 부었어요",
    "수술한 지 5일인데 통증이 심해요",
    "모발이식 받았는데 뒷머리가 욱신거려요",
  ];
  it.each(paraphrases)("%s → 인계", (text) => {
    expect(checkRedflags(text, cfg).decision).toBe("handover");
  });

  it("일반 문의는 통과한다(과잉 인계가 넓어지지 않았는지)", () => {
    for (const text of ["토요일에 주차 몇 시간 무료예요?", "다음 주 예약을 목요일로 바꾸고 싶어요", "두피 관리 한 번에 얼마예요?"]) {
      expect(checkRedflags(text, cfg).decision).toBe("pass");
    }
  });
});

describe("extractSelfReportedDays", () => {
  it("환자가 쓴 수술 후 일수를 읽고, 겹치는 표현은 하나로 센다", () => {
    expect(extractSelfReportedDays("수술 9일째인데요")).toEqual([{ days: 9, text: "수술 9일" }]);
    expect(extractSelfReportedDays("D+3 이고 수술한 지 3일 됐어요")).toEqual([
      { days: 3, text: "D+3" },
      { days: 3, text: "수술한 지 3일" },
    ]);
    expect(extractSelfReportedDays("예약 변경 문의")).toEqual([]);
    expect(extractSelfReportedDays("이식 3일차예요")).toEqual([{ days: 3, text: "3일차" }]);
  });
});

describe("mergeRoute — 비대칭 합치기", () => {
  const cfg = v11();
  const handover = checkRedflags("수술 후 고름", cfg);
  const pass = checkRedflags("예약 변경", cfg);

  it("규칙이 인계면 LLM이 통과라고 해도 인계다", () => {
    expect(mergeRoute(handover, { handover: false })).toMatchObject({ decision: "handover", source: "rule" });
  });

  it("규칙 통과 + LLM 인계 → 인계(LLM은 인계 쪽으로만 바꿀 수 있다)", () => {
    expect(mergeRoute(pass, { handover: true, reason: "통증 호소" })).toMatchObject({ decision: "handover", source: "llm", llmReason: "통증 호소" });
  });

  it("둘 다 인계면 source는 rule+llm", () => {
    expect(mergeRoute(handover, { handover: true }).source).toBe("rule+llm");
  });

  it("LLM 의견이 없으면 규칙을 그대로 쓰고 llmMissing을 표시한다", () => {
    expect(mergeRoute(pass, null)).toEqual({ decision: "pass", source: "none", ruleIds: [], llmMissing: true });
    expect(mergeRoute(handover, null)).toMatchObject({ decision: "handover", source: "rule", llmMissing: true });
  });
});
