/**
 * 녹화 파이프라인(PRD F18). scripts/record-demo.ts가 진짜 클라이언트로, 시험용 가짜 녹화(fake-recording.ts)가
 * 모의 클라이언트로 같은 함수를 부른다. 그래서 가짜 녹화로 시험한 화면은 진짜 녹화 파일의 모양과 어긋날 수 없다.
 *
 * 파이프라인은 화면과 같다: 가림 → 규칙 게이트(적신호·약 문의) → (통과하면) 분류 → 경로 재결정 → 검색 → 인용 생성·검증.
 * 모델을 부르는 건 분류와 초안 생성 두 곳뿐이고, 공개 창구·쇼핑몰 건은 초안을 만들지 않는다. 분류가 실패한 문의도 초안을 만들지 않는다(보류).
 * 요청 설정 오류(400·401·403·404)는 generateDraft·classifyInquiry가 던지므로 녹화 전체가 멈춘다.
 *
 * 인계 문의(규칙 인계든 분류 인계든)는 직원이 보낼 초안(draft)이 늘 null이다. 대신 2026-09-30 오너 결정(PRD v0.3)으로 의료진 확인용 초안
 * (handoverDraft)을 따로 만든다: 가린 글 → 인계 발췌(core/retrieve.ts retrieveForHandover) → 인용 생성(mode "handover") →
 * 같은 인용·숫자·가격 칸·광고 검증 → 인계 초안 코드 검사(src/llm/handover-check.ts checkHandoverDraft: 승인 문구 전체·되짚기 문장·인용 문장 글자 대조·
 * 직원 문장·링크·금액·약·증상·판단 말).
 * 게이트가 먼저 돌아 인계를 정한 뒤이고, 공개·모르는·쇼핑몰 창구에는 만들지 않는다
 * (core/route.ts handoverDraftAllowed). 규칙 목록(V11·V17)이 깨지면 buildKnowledge가 실패해 녹화 자체가 멈추므로 AI를 부르지 않는다.
 * 인계 초안만 따로 녹화해 기존 파일에 합치는 길(handoverDraftTargets·mergeHandoverDrafts)은 scripts/record-demo.ts --handover-only가 쓴다.
 *
 * 사내 Q&A(직원 질문)는 적신호·약 규칙 게이트로 초안을 막지 않는다. 직원이 절차를 묻는 것이라 인계할 환자·창구가 없고,
 * "고름이 나온다는 환자에게 뭐라고 하나요?"의 정답은 인계가 아니라 근거를 단 절차(V11·V12)다.
 * 그 절차가 AI 답에서 빠져도 되도록, 화면은 녹화와 상관없이 규칙 카드(인계 절차 원문)를 띄운다(src/demo/qa.ts staffRuleCard).
 */

import { groupHitsByDoc, type Knowledge } from "../core/knowledge";
import { maskPii } from "../core/mask";
import { readPostopDay } from "../core/postop";
import { MIN_TOP_SCORE, retrieve, retrieveForHandover, type Retrieval } from "../core/retrieve";
import { decideRoute, handoverDraftAllowed, type LlmStage } from "../core/route";
import { classifyInquiry, type ClassifyResult } from "../llm/classify";
import type { ClaudeClient } from "../llm/client";
import { checkHandoverDraft, generateDraft, handoverGuardOf, holdBeforeModel } from "../llm/draft";
import { parseDemoRecording, type DemoRecording, type GoldenRecord, type HandoverDraftRecord, type HandoverRun, type InquiryRecord } from "./recording";

type Usage = { input_tokens: number; output_tokens: number };
type UsageLike = { input_tokens: number; output_tokens: number; iterations?: ReadonlyArray<{ input_tokens?: number; output_tokens?: number }> | null };

function recordedHits(r: Retrieval) {
  return r.hits.map((h) => ({ chunkId: h.chunk.chunkId, score: h.score, pin: h.pin, postopBoost: h.postopBoost }));
}

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
    retrieval: recordedHits(r),
    // 화면이 녹화 때 판정을 그대로 보이게(근거 강도는 발췌 점수의 최댓값과 다를 수 있다 — core/retrieve.ts).
    retrievalMeta: { expandedWith: r.expandedWith, topScore: r.topScore, weak: r.weak },
    excludedMatches: r.excluded.filter((e) => e.matched).map((e) => ({ docId: e.doc.id, reason: e.doc.reason })),
  };
}

/**
 * 인계 문의 한 건의 의료진 확인용 초안(PRD v0.3). 부르는 쪽이 인계 판정과 창구(handoverDraftAllowed)를 먼저 확인한다.
 * 가림은 모델 호출 전(화면·게이트와 같은 maskPii). 경과일은 쓰지 않는다 — 인계 발췌는 날짜별 일반 관리 문단을 앞세우지 않는다(core/retrieve.ts).
 * 고정 안내 문단이 발췌에 없거나 승인 문구(따옴표 안 문장)를 읽지 못하면 모델을 부르지 않고 보류한다 — 답의 핵심 없이 초안을 쓰게 하지 않는다.
 * 근거 약함(weak) 관문은 걸지 않는다: 고정 안내 문단이 늘 맨 앞에 서므로 BM25 점수가 낮아도(Q11 등) 인용할 답이 있다.
 * 인용 대조의 허용 문서는 인계 문서 묶음(k.handoverAllowedDocIds — 인계 문서 + 의료가 아닌 물음용 행정 안내 문서)이다. 발췌가 실수로 넓어져도
 * 묶음 밖 인용은 invalid-citation으로 막힌다. 되짚기 문장은 가린 글(maskedText)과 대조한다 — 모델이 받은 글과 같은 글이다.
 */
export async function handoverDraftFor(client: ClaudeClient, k: Knowledge, q: { channel: string; text: string }): Promise<HandoverDraftRecord> {
  const maskedText = maskPii(q.text).masked;
  const r = retrieveForHandover(k.index, maskedText);
  const base = { maskedText, retrieval: recordedHits(r), retrievalMeta: { expandedWith: r.expandedWith, topScore: r.topScore, weak: r.weak } };
  const guard = handoverGuardOf(k, maskedText);
  if (guard === null || !r.hits.some((h) => h.chunk.chunkId === guard.fixedChunkId)) {
    return { ...base, draft: holdBeforeModel("no-sources", "고정 안내 문장(인계 절차 문서)을 읽지 못해 인계 초안을 만들지 않습니다(모델을 부르지 않음)") };
  }
  const draft = await generateDraft(client, {
    mode: "handover",
    channel: q.channel,
    maskedText,
    sources: groupHitsByDoc(r.hits, k.titles),
    allowedDocIds: k.handoverAllowedDocIds,
    tone: k.tone,
    // 가격·진료시간 칸은 일반 초안과 같은 코드로 대조한다. 가격 칸은 발췌에 든 가격표 문장을 인용한 문장 안에서만 통과한다(금액은 가격표 칸만).
    prices: k.prices,
    hours: k.hours,
    ad: k.ad,
    linkTitles: k.linkTitles,
    approvedLinks: k.approvedLinks,
  });
  return { ...base, draft: checkHandoverDraft(draft, guard) };
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
  const none = { retrieval: null, retrievalMeta: null, excludedMatches: null, draft: null };
  // 인계: 직원이 보낼 초안(draft)은 없다. 의료진 확인용 초안만 따로(공개·모르는·쇼핑몰 창구면 null).
  if (decision.step === "handover") {
    const handoverDraft = handoverDraftAllowed(decision).ok ? await handoverDraftFor(client, k, q) : null;
    return { id: q.id, route, postopDay, classification, ...none, handoverDraft };
  }
  if (decision.step !== "draft") return { id: q.id, route, postopDay, classification, ...none, handoverDraft: null };
  const d = await draftFor(client, k, "reply", q.channel, decision.mask.masked, postopDay);
  return {
    id: q.id,
    route,
    postopDay,
    classification,
    retrieval: d.retrieval,
    retrievalMeta: d.retrievalMeta,
    excludedMatches: d.excludedMatches,
    draft: d.draft,
    handoverDraft: null,
  };
}

/**
 * 인계 초안만 따로 녹화할 문의(scripts/record-demo.ts --handover-only). 지금 규칙이 인계로 보내거나, 규칙은 통과시켰는데 기존 녹화의
 * 분류가 인계로 보낸 문의 중 초안을 붙일 수 있는 창구(handoverDraftAllowed)의 것. 분류를 다시 부르지 않는다 — 목록·상세 화면이 쓰는 경로
 * (src/demo/inbox.ts buildInboxItem: 규칙이 classify면 녹화의 경로)와 같은 판정이다.
 */
export function handoverDraftTargets<Q extends { id: string; channel: string; text: string }>(k: Knowledge, inquiries: Q[], existing: DemoRecording | null): Q[] {
  return inquiries.filter((q) => {
    const d = decideRoute({ channel: q.channel, text: q.text, channels: k.channels, redflag: k.redflag, medication: k.medication });
    const recorded = existing?.inquiries.find((r) => r.id === q.id)?.route.step;
    const step = d.step === "classify" && recorded ? recorded : d.step;
    return handoverDraftAllowed({ ...d, step }).ok;
  });
}

/**
 * 인계 초안을 합치기 전에 기존 녹화에서 확인할 것(scripts/record-demo.ts가 **키를 읽기 전에** 부른다 — 모델을 다 부른 뒤
 * 합치기에서 실패하면 쓴 크레딧이 날아간다). 대상마다 기존 녹화에 기록이 있고, 그 기록이 인계 경로이며 직원이 보낼 초안(draft)이 없어야 한다.
 * 녹화 뒤 볼트 규칙이 바뀌어 지금 규칙만 인계로 보내는 문의는 기존 기록이 초안 경로라 여기서 걸린다 — 그때는 전체를 다시 녹화한다.
 */
export function handoverMergeProblems(existing: DemoRecording, ids: readonly string[]): string[] {
  const out: string[] = [];
  for (const id of ids) {
    const r = existing.inquiries.find((x) => x.id === id);
    if (!r) out.push(`${id}: 기존 녹화에 없는 문의입니다`);
    else if (r.route.step !== "handover") out.push(`${id}: 기존 녹화의 경로가 인계가 아닙니다(${r.route.step}) — 녹화 뒤 규칙이 바뀌었습니다. 전체를 다시 녹화하세요(--all)`);
    else if (r.draft !== null) out.push(`${id}: 기존 녹화에 직원이 보낼 초안이 있습니다 — 전체를 다시 녹화하세요(--all)`);
  }
  return out;
}

export type MergeResult = { ok: true; value: unknown } | { ok: false; errors: string[] };

/**
 * 기존 녹화 파일(JSON.parse한 원본)에 인계 초안만 더한다. **zod 출력이 아니라 원본의 깊은 사본**에 `handoverDraft` 키와 최상위 `handoverRun`만
 * 붙인다 — parseDemoRecording 출력으로 다시 쓰면 키 순서가 스키마 순서로 바뀌어 파일 전체가 diff로 바뀌고, '기존 녹화(일반 초안·수치)는
 * 그대로'를 증명할 수 없다. 합친 결과도 parseDemoRecording을 통과해야 돌려준다. 입력 객체는 바꾸지 않는다.
 * 여러 번 합치면(한 건씩 합치거나 --limit로 나눠 녹화) handoverRun의 사용량을 더하고 모델 목록을 합친다.
 */
export function mergeHandoverDrafts(raw: unknown, drafts: ReadonlyMap<string, HandoverDraftRecord>, run: HandoverRun, asOf: string): MergeResult {
  const parsed = parseDemoRecording(raw);
  if (!parsed.ok) return { ok: false, errors: parsed.errors.map((e) => `기존 녹화: ${e}`) };
  if (parsed.value.vaultAsOf !== asOf) {
    return { ok: false, errors: [`기존 녹화의 볼트 기준일(${parsed.value.vaultAsOf})이 시연 기준일(${asOf})과 다릅니다. 인계 초안만 합칠 수 없습니다 — 전체를 다시 녹화하세요`] };
  }
  const out = JSON.parse(JSON.stringify(raw)) as { inquiries: Record<string, unknown>[]; handoverRun?: HandoverRun } & Record<string, unknown>;
  const errors: string[] = [];
  for (const [id, d] of drafts) {
    const r = out.inquiries.find((x) => x.id === id);
    if (!r) errors.push(`기존 녹화에 없는 문의입니다: ${id}`);
    else r.handoverDraft = JSON.parse(JSON.stringify(d)) as unknown;
  }
  if (errors.length > 0) return { ok: false, errors };
  const prev = parsed.value.handoverRun;
  out.handoverRun = prev
    ? {
        generatedAt: run.generatedAt,
        requestedModel: run.requestedModel,
        servedModels: [...new Set([...prev.servedModels, ...run.servedModels])].sort(),
        totalUsage: {
          input_tokens: prev.totalUsage.input_tokens + run.totalUsage.input_tokens,
          output_tokens: prev.totalUsage.output_tokens + run.totalUsage.output_tokens,
        },
      }
    : { ...run, servedModels: [...run.servedModels].sort() };
  const check = parseDemoRecording(out);
  if (!check.ok) return { ok: false, errors: check.errors.map((e) => `합친 결과: ${e}`) };
  return { ok: true, value: out };
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
    addUsage(total, r.handoverDraft?.draft.meta.usage);
    noteModel(r.handoverDraft?.draft.meta.model);
    inquiryRecords.push(r);
    log(`${q.id} ${r.route.step}${r.draft ? ` → ${r.draft.status}` : ""}${r.handoverDraft ? ` · 의료진 확인용 초안 → ${r.handoverDraft.draft.status}` : ""}`);
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
