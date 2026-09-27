/**
 * 시연 모드용 응답 녹화(PRD F15). **키가 있을 때 오너가 직접 실행한다.** 방문자는 이 결과만 본다.
 *
 *   ANTHROPIC_API_KEY=... npm run record-demo            # 전부
 *   ANTHROPIC_API_KEY=... npm run record-demo -- --limit 3   # 앞 3건씩만(비용 확인용)
 *
 * 입력: vault/*.md, data/inquiries.json, data/golden.json
 * 출력: data/demo-responses.json — 모델명·생성일·usage를 함께 저장한다.
 *
 * 파이프라인은 화면과 같다: 가림 → 규칙 게이트(적신호·약 문의) → (통과하면) 분류 → 경로 재결정 → 검색 → 인용 생성·검증.
 * 모델을 부르는 건 분류와 초안 생성 두 곳뿐이고, 인계·공개 창구·쇼핑몰 건은 초안을 만들지 않는다.
 * 분류가 실패한 문의도 초안을 만들지 않는다(보류). 요청 설정 오류(400·401·403·404)가 나면 녹화 전체를 멈춘다.
 *
 * 사내 Q&A(직원 질문)에는 적신호·약 규칙 게이트를 돌리지 않는다. 직원이 절차를 묻는 것이라 인계할 환자·창구가 없고,
 * "고름이 나온다는 환자에게 뭐라고 하나요?"의 정답은 인계가 아니라 근거를 단 절차(V11·V12)다.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { buildKnowledge, groupHitsByDoc, type Knowledge } from "../src/core/knowledge";
import { maskPii } from "../src/core/mask";
import { decideRoute, type LlmStage, type RouteDecision } from "../src/core/route";
import { queryFromInquiry, search } from "../src/core/search";
import { loadVault } from "../src/core/vault";
import { classifyInquiry, type ClassifyResult } from "../src/llm/classify";
import { createClaudeClient, type ClaudeClient } from "../src/llm/client";
import { MODEL } from "../src/llm/config";
import { generateDraft, type DraftResult } from "../src/llm/draft";
import { readVaultDir } from "../src/server/vault-files";

const ROOT = process.cwd();
const TOP_K = 5;

// 입력 파일은 필요한 필드만 검증한다(라벨·정답은 평가 쪽에서 쓰므로 여기서 읽지 않는다 — 녹화가 정답을 보지 않게).
const InquirySchema = z.object({ id: z.string(), channel: z.string(), text: z.string() });
const GoldenSchema = z.object({
  id: z.string(),
  kind: z.enum(["staff-qa", "inquiry"]),
  question: z.string().optional(),
  inquiryId: z.string().optional(),
});

type Usage = { input_tokens: number; output_tokens: number };
type UsageLike = { input_tokens: number; output_tokens: number; iterations?: ReadonlyArray<{ input_tokens?: number; output_tokens?: number }> | null };

interface InquiryRecord {
  id: string;
  route: Pick<RouteDecision, "step" | "trace" | "holdReason"> & { maskedText: string; ruleIds: string[] };
  classification: ClassifyResult | null;
  retrieval: { chunkId: string; score: number }[] | null;
  excludedMatches: { docId: string; reason: string }[] | null;
  draft: DraftResult | null;
}

interface GoldenRecord {
  id: string;
  question: string;
  retrieval: { chunkId: string; score: number }[];
  excludedMatches: { docId: string; reason: string }[];
  draft: DraftResult;
}

function retrieve(k: Knowledge, query: string) {
  const r = search(k.index, query, TOP_K);
  return {
    hits: r.hits,
    retrieval: r.hits.map((h) => ({ chunkId: h.chunk.chunkId, score: h.score })),
    excludedMatches: r.excluded.filter((e) => e.matched).map((e) => ({ docId: e.doc.id, reason: e.doc.reason })),
  };
}

async function draftFor(client: ClaudeClient, k: Knowledge, mode: "reply" | "staff-qa", channel: string | null, maskedText: string) {
  // 문의는 날짜·요일·폼 칸 이름을 뺀 질의로 찾는다(core/search.ts queryFromInquiry). 직원 질문은 그대로.
  const { hits, retrieval, excludedMatches } = retrieve(k, mode === "reply" ? queryFromInquiry(maskedText) : maskedText);
  const draft = await generateDraft(client, {
    mode,
    channel,
    maskedText,
    sources: groupHitsByDoc(hits, k.titles),
    allowedDocIds: k.allowedDocIds,
    tone: k.tone,
    prices: k.prices,
    hours: k.hours,
    ad: k.ad,
  });
  return { draft, retrieval, excludedMatches };
}

async function recordInquiry(client: ClaudeClient, k: Knowledge, q: z.infer<typeof InquirySchema>): Promise<InquiryRecord> {
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
  const route = {
    step: decision.step,
    trace: decision.trace,
    holdReason: decision.holdReason,
    maskedText: decision.mask.masked,
    ruleIds: decision.redflag.ruleIds,
  };
  if (decision.step !== "draft") return { id: q.id, route, classification, retrieval: null, excludedMatches: null, draft: null };
  const d = await draftFor(client, k, "reply", q.channel, decision.mask.masked);
  return { id: q.id, route, classification, retrieval: d.retrieval, excludedMatches: d.excludedMatches, draft: d.draft };
}

/**
 * 과금 기준은 usage.iterations(시도별)다. 서버 측 대체가 일어나면 최상위 usage는 응답을 만든 시도만 담는다
 * (claude-api 스킬 문서). iterations가 있으면 그 합을, 없으면 최상위 값을 더한다.
 */
function addUsage(total: Usage, u: UsageLike | null | undefined) {
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

async function main() {
  const limitArg = process.argv.indexOf("--limit");
  const limit = limitArg !== -1 ? Number(process.argv[limitArg + 1]) : Infinity;

  const client = createClaudeClient(); // 키가 없으면 여기서 멈춘다.
  // 시행일이 오늘 뒤인 문서는 쓰지 않는다. 코어는 시계를 읽지 않으므로 여기서 오늘(서울) 날짜를 넘긴다.
  const asOf = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
  const kr = buildKnowledge(loadVault(readVaultDir(join(ROOT, "vault")), { asOf }));
  if (!kr.ok) throw new Error(`볼트를 읽지 못했습니다:\n${kr.errors.join("\n")}`);
  const k = kr.knowledge;

  const inquiries = z.array(InquirySchema).parse(JSON.parse(readFileSync(join(ROOT, "data/inquiries.json"), "utf8"))).slice(0, limit);
  const golden = z.array(GoldenSchema).parse(JSON.parse(readFileSync(join(ROOT, "data/golden.json"), "utf8")));

  const total: Usage = { input_tokens: 0, output_tokens: 0 };
  // 실제로 답한 모델(대체가 일어나면 요청한 모델과 다르다). 최상위에 요청 모델만 적으면 대체 사실이 가려진다.
  const servedModels = new Set<string>();
  const noteModel = (m: string | null | undefined) => {
    if (m) servedModels.add(m);
  };
  const inquiryRecords: InquiryRecord[] = [];
  for (const q of inquiries) {
    const r = await recordInquiry(client, k, q);
    if (r.classification?.status === "classified") {
      addUsage(total, r.classification.usage);
      noteModel(r.classification.model);
    } else noteModel(r.classification?.model);
    addUsage(total, r.draft?.meta.usage);
    noteModel(r.draft?.meta.model);
    inquiryRecords.push(r);
    console.log(`${q.id} ${r.route.step}${r.draft ? ` → ${r.draft.status}` : ""}`);
  }

  // 사내 Q&A 골든 문항만 녹화한다. kind "inquiry" 문항은 위의 문의 녹화 결과를 평가 쪽에서 참조한다.
  const goldenRecords: GoldenRecord[] = [];
  for (const g of golden.filter((x) => x.kind === "staff-qa" && x.question).slice(0, limit)) {
    const masked = maskPii(g.question!).masked;
    const d = await draftFor(client, k, "staff-qa", null, masked);
    addUsage(total, d.draft.meta.usage);
    noteModel(d.draft.meta.model);
    goldenRecords.push({ id: g.id, question: g.question!, ...d });
    console.log(`${g.id} → ${d.draft.status}`);
  }

  const out = {
    fictional: true,
    note: "가상 의원·합성 데이터·미리 생성한 AI 응답. 초안은 사람이 검토한 뒤 보낸다.",
    requestedModel: MODEL,
    servedModels: [...servedModels].sort(),
    vaultAsOf: asOf,
    generatedAt: new Date().toISOString(),
    totalUsage: total,
    inquiries: inquiryRecords,
    golden: goldenRecords,
  };
  writeFileSync(join(ROOT, "data/demo-responses.json"), `${JSON.stringify(out, null, 2)}\n`);
  console.log(`저장: data/demo-responses.json (입력 ${total.input_tokens} / 출력 ${total.output_tokens} 토큰)`);
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
