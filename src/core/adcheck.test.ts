import { describe, expect, it } from "vitest";
import { checkAdExpressions, parseAdConfig, type AdConfig } from "./adcheck";
import { activeJson, loadVault } from "./vault";
import { fixtureFiles } from "./__fixtures__/load";

function v15(): AdConfig {
  const j = activeJson(loadVault(fixtureFiles()), "V15");
  if (!j.ok) throw new Error(j.error);
  const c = parseAdConfig(j.value);
  if (!c.ok) throw new Error(c.error);
  return c.config;
}

describe("parseAdConfig", () => {
  it("문자열과 {term, reason}을 모두 받는다", () => {
    expect(v15()).toEqual({
      banned: [
        { term: "100%", reason: null },
        { term: "부작용 없는", reason: "효과·안전 보장" },
        { term: "최고", reason: null },
      ],
      warn: [
        { term: "할인", reason: null },
        { term: "후기 이벤트", reason: null },
      ],
    });
  });

  it("banned가 비었거나 모양이 틀리면 거부한다", () => {
    expect(parseAdConfig({ banned: [], warn: [] })).toEqual({ ok: false, error: "V15 banned가 비어 있습니다" });
    expect(parseAdConfig({ banned: [1], warn: [] }).ok).toBe(false);
    expect(parseAdConfig({ banned: ["x"] }).ok).toBe(false);
  });
});

describe("checkAdExpressions", () => {
  const cfg = v15();

  it("banned를 찾아 원문 위치와 함께 돌려준다", () => {
    const text = "생착률 100% 보장";
    const r = checkAdExpressions(text, cfg);
    expect(r.level).toBe("banned");
    expect(r.hits).toEqual([{ level: "banned", term: "100%", reason: null, start: 4, end: 8, matchedText: "100%" }]);
  });

  it("공백 차이를 무시하되 위치는 원문 기준이다: '부작용  없는', '100 %'", () => {
    const text = "부작용  없는 시술, 100 %";
    const r = checkAdExpressions(text, cfg);
    expect(r.hits.map((h) => h.matchedText)).toEqual(["부작용  없는", "100 %"]);
    for (const h of r.hits) expect(text.slice(h.start, h.end)).toBe(h.matchedText);
  });

  it("warn만 있으면 level은 warn", () => {
    const r = checkAdExpressions("이번 달 할인 안내", cfg);
    expect([r.level, r.hits.map((h) => h.term)]).toEqual(["warn", ["할인"]]);
  });

  it("같은 표현이 두 번 나오면 두 번 잡는다", () => {
    expect(checkAdExpressions("최고의 의료진, 최고의 결과", cfg).hits.map((h) => h.start)).toEqual([0, 9]);
  });

  it("해당 없음은 clean", () => {
    expect(checkAdExpressions("예약 변경은 전날까지 가능합니다.", cfg)).toEqual({ level: "clean", hits: [] });
  });
});
