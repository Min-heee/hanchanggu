/**
 * 녹화 파이프라인(PRD F18). scripts/record-demo.ts가 진짜 클라이언트로, 시험용 가짜 녹화(fake-recording.ts)가
 * 모의 클라이언트로 같은 함수를 부른다. 그래서 가짜 녹화로 시험한 화면은 진짜 녹화 파일의 모양과 어긋날 수 없다.
 *
 * 파이프라인은 화면과 같다: 가림 → 규칙 게이트(적신호·약 문의) → (통과하면) 분류 → 경로 재결정 → 검색 → 인용 생성·검증.
 * 모델을 부르는 건 분류와 초안 생성 두 곳뿐이고, 인계·공개 창구·쇼핑몰 건은 초안을 만들지 않는다.
 * 분류가 실패한 문의도 초안을 만들지 않는다(보류). 요청 설정 오류(400·401·403·404)는 generateDraft·classifyInquiry가
 * 던지므로 녹화 전체가 멈춘다.
 *
 * 사내 Q&A(직원 질문)에는 적신호·약 규칙 게이트를 돌리지 않는다. 직원이 절차를 묻는 것이라 인계할 환자·창구가 없고,
 * "고름이 나온다는 환자에게 뭐라고 하나요?"의 정답은 인계가 아니라 근거를 단 절차(V11·V12)다.
 */

import { groupHitsByDoc, type Knowledge } from "../core/knowledge";
import { maskPii } from "../core/mask";
import { readPostopDay } from "../core/postop";
import { MIN_TOP_SCORE, retrieve } from "../core/retrieve";
import { decideRoute, type LlmStage } from "../core/route";
import { classifyInquiry, type ClassifyResult } from "../llm/classify";
import type { ClaudeClient } from "../llm/client";
import { generateDraft, holdBeforeModel } from "../llm/draft";
import type { DemoRecording, GoldenRecord, InquiryRecord } from "./recording";

type Usage = { input_tokens: number; output_tokens: number };
type UsageLike = { input_tokens: number; output_tokens: number; iterations?: ReadonlyArray<{ input_tokens?: number; output_tokens?: number }> | null };

async function draftFor(client: ClaudeClient, k: Knowledge, mode: "reply" | "staff-qa", channel: string | null, maskedText: string, postopDay: number | null) {
  // 화면과 같은 검색 함수(core/retrieve.ts). 문의는 날짜·폼 칸 이름을 뺀 질의 + 경과일 앞세우기, 직원 질문은 그대로.
  const r = retrieve(k.index, mode, maskedText, postopDay);
  // 근거가 약하면(PRD F7) 모델을 부르지 않는다. 화면의 ① '근거 약함 — 문서 빈칸'과 같은 판정이다.
  const draft = r.weak
    ? holdBeforeModel("weak-retrieval", `검색 점수가 기준보다 낮아(최고 ${r.topScore.toFixed(2)} < ${MIN_TOP_SCORE}) 모델을 부르지 않았습니다(문서 빈칸)`)
    : await generateDraft(client, {
        mode,
        channel,
        maskedText,
        sources: groupHitsByDoc(r.hits, k.titles),
        allowedDocIds: k.allowedDocIds,
        tone: k.tone,
        prices: k.prices,
        hours: k.hours,
        ad: k.ad,
        linkTitles: k.linkTitles,
        approvedLinks: k.approvedLinks,
      });
  return {
    draft,
    retrieval: r.hits.map((h) => ({ chunkId: h.chunk.chunkId, score: h.score, pin: h.pin, postopBoost: h.postopBoost })),
    // 화면이 녹화 때 판정을 그대로 보이게(근거 강도는 발췌 점수의 최댓값과 다를 수 있다 — core/retrieve.ts).
    retrievalMeta: { expandedWith: r.expandedWith, topScore: r.topScore, weak: r.weak },
    excludedMatches: r.excluded.filter((e) => e.matched).map((e) => ({ docId: e.doc.id, reason: e.doc.reason })),
  };
}

export async function recordInquiry(client: ClaudeClient, k: Knowledge, q: { id: string; channel: string; text: string }): Promise<InquiryRecord> {
  const input = { channel: q.channel, text: q.text, channels: k.channels, redflag: k.redflag, medication: k.medication };
  let decision = decideRoute(input);
  let classification: ClassifyResult | null = null;
  // 규칙이 이미 인계·보류로 보냈거나 공개 창구·쇼핑몰이면 모델을 부르지 않는다(비용과 위험을 함께 줄인다).
  if (decision.step === "classify") {
    classification = await classifyInquiry(client, { channel: q.channel, maskedText: decision.mask.masked });
    const c = classification.status === "classified" ? classification.classification : null;
    const llm: LlmStage = c
      ? { status: "classified", value: { handover: c.handover, category: c.category, reason: c.reason } }
      : { status: "failed", reason: classification.status === "unclassified" ? classification.reason : "알 수 없음" };
    decision = decideRoute({ ...input, llm });
  }
  // 경과일은 가리기 전 원문에서 읽는다(가림이 "D+3" 같은 표현을 바꾸지는 않지만, 화면과 같은 입력을 쓴다).
  const postopDay = readPostopDay(q.text)?.days ?? null;
  const route = {
    step: decision.step,
    trace: decision.trace,
    holdReason: decision.holdReason,
    maskedText: decision.mask.masked,
    ruleIds: decision.redflag.ruleIds,
  };
  if (decision.step !== "draft") return { id: q.id, route, postopDay, classification, retrieval: null, retrievalMeta: null, excludedMatches: null, draft: null };
  const d = await draftFor(client, k, "reply", q.channel, decision.mask.masked, postopDay);
  return { id: q.id, route, postopDay, classification, retrieval: d.retrieval, retrievalMeta: d.retrievalMeta, excludedMatches: d.excludedMatches, draft: d.draft };
}

/**
 * 과금 기준은 usage.iterations(시도별)다. 서버 측 대체가 일어나면 최상위 usage는 응답을 만든 시도만 담는다
 * (Anthropic API 문서). iterations가 있으면 그 합을, 없으면 최상위 값을 더한다.
 */
export function addUsage(total: Usage, u: UsageLike | null | undefined): void {
  if (!u) return;
  const its = u.iterations ?? [];
  if (its.length > 0) {
    for (const it of its) {
      total.input_tokens += it.input_tokens ?? 0;
      total.output_tokens += it.output_tokens ?? 0;
    }
    return;
  }
  total.input_tokens += u.input_tokens;
  total.output_tokens += u.output_tokens;
}

export interface RecordOptions {
  requestedModel: string;
  /** 볼트를 고른 기준 날짜(시행일 필터). 화면에 함께 보인다. */
  vaultAsOf: string;
  /** 녹화 시각. 코어처럼 시계를 직접 읽지 않고 받는다(시험이 재현되게). */
  generatedAt: string;
  limit?: number;
  log?: (line: string) => void;
}

export async function recordAll(
  client: ClaudeClient,
  k: Knowledge,
  inquiries: { id: string; channel: string; text: string }[],
  golden: { id: string; kind: "staff-qa" | "inquiry"; question?: string }[],
  opts: RecordOptions,
): Promise<DemoRecording> {
  const limit = opts.limit ?? Infinity;
  const log = opts.log ?? (() => {});
  const total: Usage = { input_tokens: 0, output_tokens: 0 };
  // 실제로 답한 모델(대체가 일어나면 요청한 모델과 다르다). 최상위에 요청 모델만 적으면 대체 사실이 가려진다.
  const servedModels = new Set<string>();
  const noteModel = (m: string | null | undefined) => {
    if (m) servedModels.add(m);
  };

  const inquiryRecords: InquiryRecord[] = [];
  for (const q of inquiries.slice(0, limit)) {
    const r = await recordInquiry(client, k, q);
    if (r.classification?.status === "classified") {
      addUsage(total, r.classification.usage);
      noteModel(r.classification.model);
    } else noteModel(r.classification?.model);
    addUsage(total, r.draft?.meta.usage);
    noteModel(r.draft?.meta.model);
    inquiryRecords.push(r);
    log(`${q.id} ${r.route.step}${r.draft ? ` → ${r.draft.status}` : ""}`);
  }

  // 사내 Q&A 골든 문항만 녹화한다. kind "inquiry" 문항은 위의 문의 녹화 결과를 평가 쪽에서 참조한다.
  const goldenRecords: GoldenRecord[] = [];
  for (const g of golden.filter((x) => x.kind === "staff-qa" && x.question).slice(0, limit)) {
    const masked = maskPii(g.question!).masked;
    const d = await draftFor(client, k, "staff-qa", null, masked, null);
    addUsage(total, d.draft.meta.usage);
    noteModel(d.draft.meta.model);
    goldenRecords.push({ id: g.id, question: g.question!, maskedQuestion: masked, ...d });
    log(`${g.id} → ${d.draft.status}`);
  }

  return {
    fictional: true,
    note: "가상 의원·합성 데이터·미리 생성한 AI 응답. 초안은 사람이 검토한 뒤 보낸다.",
    requestedModel: opts.requestedModel,
    servedModels: [...servedModels].sort(),
    vaultAsOf: opts.vaultAsOf,
    generatedAt: opts.generatedAt,
    totalUsage: total,
    inquiries: inquiryRecords,
    golden: goldenRecords,
  };
}
