import { describe, expect, it } from "vitest";
import { buildKnowledge, fixedMessageQuoteIndices, groupHitsByDoc, unquoteFixedMessage } from "./knowledge";
import { search } from "./search";
import { loadVault } from "./vault";
import { fixtureFiles } from "./__fixtures__/load";

describe("buildKnowledge", () => {
  it("픽스처 볼트에서 모든 값을 만든다", () => {
    const r = buildKnowledge(loadVault(fixtureFiles()));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect([...r.knowledge.allowedDocIds].sort()).toEqual(["V02", "V03", "V04", "V07", "V11", "V13", "V14", "V15", "V17", "V19"]);
    expect(r.knowledge.medication).toEqual({ terms: ["탈모약", "약을", "복용", "mg", "먹어도"], exclude: ["예약", "약속"] });
    expect(r.knowledge.prices.map((p) => p.key)).toEqual(["consult", "graft", "injection"]);
    expect(r.knowledge.channels.length).toBe(4);
    expect(r.knowledge.publicTemplates.map((t) => t.key)).toEqual(["review-thanks", "comment-question"]);
  });

  it("json 문서 하나라도 깨지면 부분 실행하지 않고 오류를 모은다", () => {
    const files = fixtureFiles().map((f) => (f.path === "redflags.md" ? { ...f, raw: f.raw.replace('"symptoms": [', '"symptomz": [') } : f));
    const r = buildKnowledge(loadVault(files));
    expect(r).toEqual({ ok: false, errors: ["symptoms이(가) 배열이 아닙니다"] });
  });

  it("json이 없는 일반 문서의 파싱 오류도 부분 실행하지 않는다(문서가 조용히 빠지지 않게)", () => {
    const files = fixtureFiles().map((f) => (f.path === "postop-care.md" ? { ...f, raw: f.raw.replace("status: approved\n", "") } : f));
    const r = buildKnowledge(loadVault(files));
    expect(r).toEqual({ ok: false, errors: ["postop-care.md: 필수 필드 누락: status"] });
  });

  it("약 문의 목록(V17)이 깨져도 부분 실행하지 않는다", () => {
    const files = fixtureFiles().map((f) => (f.path === "medication-policy.md" ? { ...f, raw: f.raw.replace('"terms"', '"termz"') } : f));
    expect(buildKnowledge(loadVault(files))).toEqual({ ok: false, errors: ["V17 terms가 빈 값 없는 문자열 배열이 아닙니다"] });
  });

  it("인사·맺음 허용 목록(V13)이 깨지면 빈 목록으로 넘어가지 않고 멈춘다", () => {
    // 변이 시험(2026-09-29): V13 파싱 실패를 빈 목록으로 삼키는 변이가 살아남았다. 빈 목록 쪽 판정이 뒤집히면 전부 허용이 된다.
    const files = fixtureFiles().map((f) => (f.path === "cs-tone-guide.md" ? { ...f, raw: f.raw.replace('"greetings"', '"greetingz"') } : f));
    expect(buildKnowledge(loadVault(files))).toEqual({ ok: false, errors: ["V13 greetings가 빈 값 없는 문자열 배열이 아닙니다"] });
  });

  it("json 문서가 미승인이면 값을 쓰지 않는다", () => {
    const files = fixtureFiles().map((f) => (f.path === "price-list.md" ? { ...f, raw: f.raw.replace("status: approved", "status: draft") } : f));
    const r = buildKnowledge(loadVault(files));
    expect(r).toEqual({ ok: false, errors: ["V03: 승인된 문서가 없습니다"] });
  });
});

describe("groupHitsByDoc", () => {
  it("검색 순위상 먼저 나온 문서 순으로 묶고, 문서 안은 문단 순으로 둔다", () => {
    const r = buildKnowledge(loadVault(fixtureFiles()));
    if (!r.ok) throw new Error("fixture");
    const hits = search(r.knowledge.index, "예약 변경 환불 D+3 머리", 4).hits;
    const grouped = groupHitsByDoc(hits, r.knowledge.titles);
    expect(grouped.map((g) => g.docId)).toEqual([...new Set(hits.map((h) => h.chunk.docId))]);
    for (const g of grouped) {
      const idx = g.chunks.map((c) => Number(c.chunkId.split("#")[1]));
      expect(idx).toEqual([...idx].sort((a, b) => a - b));
    }
    expect(grouped.find((g) => g.docId === "V04")?.title).toBe("예약·변경·취소 규정");
  });
});

describe("승인 문구를 감싼 따옴표 빼기(인계 초안, 1차 녹화 20건 중 14건이 감쌈)", () => {
  const MSG = "보내 주신 내용은 의료진에게 바로 전달했습니다. 의료진이 확인한 뒤 직접 연락드리겠습니다. 급하면 119를 이용해 주세요.";

  it("승인 문구 바로 앞뒤의 따옴표만 뺀다(큰따옴표·둥근 따옴표, 공백·끝 문장부호 허용)", () => {
    expect(unquoteFixedMessage(`"${MSG}"`, MSG)).toBe(MSG);
    expect(unquoteFixedMessage(`수술 3일째라고 말씀 주셨습니다. “${MSG}” 진료시간은 {{hours}}입니다.`, MSG)).toBe(`수술 3일째라고 말씀 주셨습니다. ${MSG} 진료시간은 {{hours}}입니다.`);
    // 공백 차이가 있어도 승인 문구로 찾는다. 끝 마침표 뒤 따옴표도.
    expect(unquoteFixedMessage(`" ${MSG.replace(/ /g, "  ")} "`, MSG)).toBe(` ${MSG.replace(/ /g, "  ")} `);
  });

  it("승인 문구 밖의 따옴표와 승인 문구가 없는 글은 그대로", () => {
    expect(unquoteFixedMessage(`'두피 관리'는 1회 {{price:scalp-care}}입니다. ${MSG}`, MSG)).toBe(`'두피 관리'는 1회 {{price:scalp-care}}입니다. ${MSG}`);
    expect(unquoteFixedMessage(`"${MSG.slice(0, 20)}"`, MSG)).toBe(`"${MSG.slice(0, 20)}"`);
    expect(unquoteFixedMessage(`"${MSG}"`, null)).toBe(`"${MSG}"`);
    expect(fixedMessageQuoteIndices(MSG, MSG)).toEqual([]);
  });
});
