import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { classifyInquiry, type Classification } from "./classify";
import { ClaudeConfigError, type ClaudeClient } from "./client";
import { MODEL } from "./config";

const usage = { input_tokens: 10, output_tokens: 5 } as unknown as Anthropic.Beta.BetaUsage;

function mockClient(result: unknown) {
  const create = vi.fn(async () => result);
  const client = { beta: { messages: { create } } } as unknown as ClaudeClient;
  return { client, create };
}

function throwing(err: unknown) {
  const create = vi.fn(async () => {
    throw err;
  });
  return { beta: { messages: { create } } } as unknown as ClaudeClient;
}

const good: Classification = {
  category: "booking",
  priority: "high",
  handover: false,
  evidence: ["예약금 냈는데", "확정 연락"],
  reason: "예약금 입금 후 확정 연락을 기다리는 문의",
};

const reply = (content: unknown[], stop_reason = "end_turn") => ({ model: MODEL, stop_reason, usage, content });
const jsonText = (c: unknown) => ({ type: "text", text: JSON.stringify(c), citations: null });

describe("classifyInquiry — 요청 모양", () => {
  it("구조화 출력 요청: 적응형 사고, 거절 대체('default' + 07-01 헤더), 문의는 JSON 데이터로", async () => {
    const { client, create } = mockClient(reply([jsonText(good)]));
    const inquiry = "예약금 냈는데 확정 연락이 없어요";
    await classifyInquiry(client, { channel: "kakao", maskedText: inquiry });
    const p = (create.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(p.model).toBe("claude-opus-5");
    // 상수와 비교하지 않고 글자 그대로 적는다: 상수가 틀리면(06-01 등) 모든 호출이 400이다.
    expect(p.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect(p.fallbacks).toBe("default");
    expect(p.thinking).toEqual({ type: "adaptive" });
    const oc = p.output_config as { effort: string; format: { type: string } };
    expect(oc.effort).toBe("medium");
    expect(oc.format.type).toBe("json_schema");
    expect(p.messages).toEqual([{ role: "user", content: JSON.stringify({ channel: "kakao", inquiry }) }]);
    // 문의 원문은 시스템 지시에 섞이지 않는다(프롬프트 인젝션 회귀 방지).
    expect(String(p.system)).not.toContain("확정 연락이 없어요");
  });
});

describe("classifyInquiry — 결과", () => {
  it("근거 표현은 원문에 실제로 있는 것만 남기고 나머지는 따로 보인다", async () => {
    const { client } = mockClient(reply([jsonText({ ...good, evidence: ["예약금 냈는데", "환불해 주세요"] })]));
    const r = await classifyInquiry(client, { channel: "kakao", maskedText: "예약금  냈는데 확정 연락이 없어요" });
    expect(r.status === "classified" && [r.evidence, r.droppedEvidence]).toEqual([["예약금 냈는데"], ["환불해 주세요"]]);
  });

  it("서버 측 대체가 일어나면 마지막 fallback 경계 뒤의 글만 읽는다", async () => {
    const { client } = mockClient(
      reply([
        { type: "text", text: "{\"category\":", citations: null },
        { type: "fallback", from: { model: "claude-opus-5" }, to: { model: "claude-opus-4-8" } },
        jsonText(good),
      ]),
    );
    const r = await classifyInquiry(client, { channel: "kakao", maskedText: "예약금 냈는데 확정 연락" });
    expect(r.status === "classified" && r.classification).toEqual(good);
  });

  it("거절·잘림·형식 오류는 기본값을 채우지 않고 미분류(거절은 글이 JSON이 아니어도 '거절'로 보인다)", async () => {
    const cases: [unknown, string][] = [
      [reply([{ type: "text", text: "도와드릴 수 없습니다.", citations: null }], "refusal"), "모델이 거절했습니다(대체 모델 포함)"],
      [reply([{ type: "text", text: "{\"cat", citations: null }], "max_tokens"), "응답이 길이 상한에서 잘렸습니다"],
      [reply([{ type: "text", text: "분류: 예약", citations: null }]), "구조화 출력을 읽지 못했습니다"],
      [reply([jsonText({ ...good, category: "unknown" })]), "구조화 출력을 읽지 못했습니다"],
      [reply([]), "구조화 출력을 읽지 못했습니다"],
    ];
    for (const [resp, reason] of cases) {
      expect(await classifyInquiry(mockClient(resp).client, { channel: "kakao", maskedText: "x" })).toEqual({ status: "unclassified", reason, model: MODEL });
    }
  });

  it("429·연결 오류는 미분류로, 설정 오류(400·401)는 크게 실패한다", async () => {
    const input = { channel: "kakao", maskedText: "x" };
    expect(await classifyInquiry(throwing(new Anthropic.RateLimitError(429, undefined, "rate", new Headers())), input)).toEqual({
      status: "unclassified",
      reason: "호출 한도 초과(429)",
      model: null,
    });
    expect(await classifyInquiry(throwing(new Anthropic.APIConnectionError({ message: "down" })), input)).toEqual({
      status: "unclassified",
      reason: "모델 서버에 연결하지 못했습니다",
      model: null,
    });
    await expect(classifyInquiry(throwing(new Anthropic.BadRequestError(400, undefined, "bad beta", new Headers())), input)).rejects.toBeInstanceOf(ClaudeConfigError);
    await expect(classifyInquiry(throwing(new Anthropic.AuthenticationError(401, undefined, "key", new Headers())), input)).rejects.toThrow("모델 호출 설정 오류(401)");
  });
});
