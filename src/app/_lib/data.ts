/**
 * 화면이 쓰는 데이터 입구. 번들(빌드 전에 만든 JSON)을 읽고, 볼트 원문으로 코어 지식(색인·규칙 값)을 한 번 만든다.
 * 판단은 모두 src/core·src/demo의 순수 함수가 한다. 여기서는 묶어서 넘기기만 한다.
 */

import raw from "@/generated/bundle.json";
import { buildKnowledge, type Knowledge } from "@/core/knowledge";
import { loadVault } from "@/core/vault";
import type { Bundle } from "@/demo/bundle";
import { readConfirmPolicy, readHandoverPolicy, type ConfirmPolicy, type HandoverPolicy } from "@/demo/policy";
import type { GoldenRecord, InquiryRecord } from "@/demo/recording";

export const bundle = raw as unknown as Bundle;

let cached: { k: Knowledge; policies: { confirm: ConfirmPolicy; handover: HandoverPolicy } } | null = null;

/** 번들은 빌드 때 이미 검증했으므로 여기서 실패하면 번들이 손상된 것이다. 조용히 빈 화면을 그리지 않고 던진다. */
export function engine() {
  if (!cached) {
    const kr = buildKnowledge(loadVault(bundle.vaultFiles, { asOf: bundle.asOf }));
    if (!kr.ok) throw new Error(`볼트를 읽지 못했습니다: ${kr.errors.join(" / ")}`);
    cached = { k: kr.knowledge, policies: { confirm: readConfirmPolicy(kr.knowledge.chunks), handover: readHandoverPolicy(kr.knowledge.chunks) } };
  }
  return cached;
}

export function inquiryRecord(id: string): InquiryRecord | null {
  return bundle.recording?.inquiries.find((r) => r.id === id) ?? null;
}

export function goldenRecord(id: string): GoldenRecord | null {
  return bundle.recording?.golden.find((r) => r.id === id) ?? null;
}

/**
 * 입력한 질문과 글자가 같은(공백 무시) 녹화 질문. 직접 입력한 질문에도 미리 만든 답이 있으면 보여 준다.
 * 일부러 느슨하게 맞추지 않는다 — 비슷한 질문에 엉뚱한 답이 붙는 것보다 '준비 안 됨'이 낫다.
 * 시연 대본은 준비된 질문 버튼(?q=G16)으로 연다.
 */
export function goldenRecordByQuestion(q: string): GoldenRecord | null {
  const n = (s: string) => s.normalize("NFKC").replace(/\s+/g, "");
  return bundle.recording?.golden.find((r) => n(r.question) === n(q)) ?? null;
}

export function channelLabel(channel: string): string {
  return engine().k.channels.find((c) => c.channel === channel)?.label ?? channel;
}

/** 미리 만든 AI 답과 지금 코드·데이터가 어긋난 곳(이 문의·질문 것만). */
export function driftFor(id: string): string[] {
  return bundle.recordingIssues.filter((i) => i.target === id).map((i) => i.message);
}
