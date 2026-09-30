/**
 * 시연 모드용 응답 녹화(PRD F18). **키가 있을 때 저장소 주인이 직접 실행한다.** 방문자는 이 결과만 본다.
 * 무엇을 녹화할지 반드시 고른다(--all 또는 --handover-only). 모르는 인자는 거부한다 — 오타 하나로 전체 재녹화(약 $1, 4회차 파일·수치를 덮어씀)가
 * 돌지 않게.
 *
 *   ANTHROPIC_API_KEY=... npm run record-demo -- --all             # 전부(분류·일반 초안·사내 Q&A·인계 문의의 의료진 확인용 초안). 기존 파일을 덮어씀
 *   ANTHROPIC_API_KEY=... npm run record-demo -- --all --limit 3   # 앞 3건씩만(비용 확인용)
 *
 * 인계 초안만 따로 녹화해 기존 녹화에 합치기(PRD v0.3, 2026-09-30 오너 결정) — 이미 녹화된 일반 초안·수치(오보류 0/39 등)는 그대로 둔다:
 *
 *   npx tsx scripts/record-demo.ts --handover-only --dry-run                               # 키 없이: 대상 문의와 추정 비용만
 *   npx tsx --env-file=.env.local scripts/record-demo.ts --handover-only --limit 3          # 아직 녹화 안 된 대상 중 앞 3건(약 $0.05)
 *   npx tsx --env-file=.env.local scripts/record-demo.ts --handover-only                    # 아직 녹화 안 된 대상 전부(처음이면 20건, 약 $0.3)
 *   npx tsx --env-file=.env.local scripts/record-demo.ts --handover-only --only Q06,Q11     # 골라서 다시(이미 녹화됐어도)
 *   npx tsx --env-file=.env.local scripts/record-demo.ts --handover-only --redo             # 대상 전부 다시(이미 녹화된 것도 — 지시문·발췌를 바꾼 뒤)
 *   npx tsx scripts/record-demo.ts --handover-only --redo --dry-run                        # 키 없이: 다시 녹화할 대상과 추정 비용만
 *
 *   - 대상: 지금 규칙이 인계로 보내거나, 기존 녹화의 분류가 인계로 보낸 문의 중 공개·모르는·쇼핑몰 창구가 아닌 것(src/demo/record.ts handoverDraftTargets).
 *     분류는 다시 부르지 않는다. 모델 호출은 대상마다 초안 1번이다. --only·--redo가 없으면 이미 인계 초안이 녹화된 문의는 건너뛴다
 *     (--limit 3 뒤에 옵션 없이 다시 돌리면 나머지만 녹화한다).
 *   - 기존 파일(data/demo-responses.json)이 있어야 하고, 형식이 맞고 볼트 기준일이 시연 기준일과 같아야 하고, 대상마다 기존 기록이 인계 경로여야 한다
 *     (handoverMergeProblems). 이 확인과 대상 계산은 키를 읽기 전에 끝낸다.
 *   - 합치기는 파일 원본(JSON.parse)에 문의별 `handoverDraft`와 최상위 `handoverRun`만 더한다(mergeHandoverDrafts). 기존 줄은 바뀌지 않는다.
 *     **한 건 녹화할 때마다 합쳐서 파일에 쓴다** — 중간에 멈춰도 이미 쓴 크레딧의 결과가 남는다. 합치기가 실패하면 그 초안을
 *     data/handover-drafts.unmerged.json에 남기고 멈춘다.
 *   - 일시 오류(429·5xx 등, api-error 보류)가 난 건은 합치지 않는다 — 화면에 '녹화 전'으로 남고, 끝에 찍히는 `--only`로 다시 녹화한다.
 *   - 설정 오류(400·401·403·404)는 generateDraft가 던져 멈춘다(그 전까지 녹화한 건은 이미 파일에 있다).
 *
 * 입력: vault/*.md, data/inquiries.json, data/golden.json
 * 출력: data/demo-responses.json — 형식은 src/demo/recording.ts(DemoRecording). 화면이 같은 타입으로 읽는다.
 *
 * 파이프라인 본체는 src/demo/record.ts에 있다. 시험용 가짜 녹화(src/demo/fake-recording.ts)도 같은 함수를
 * 모의 클라이언트로 부르므로, 화면을 가짜 녹화로 시험해도 이 스크립트가 쓰는 모양과 어긋나지 않는다.
 * 여기서는 파일 읽기·쓰기, 인자 해석, 진짜 클라이언트 만들기만 한다.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { buildKnowledge, type Knowledge } from "../src/core/knowledge";
import { loadVault } from "../src/core/vault";
import { DEMO_AS_OF } from "../src/demo/clock";
import { addUsage, handoverDraftFor, handoverDraftTargets, handoverMergeProblems, mergeHandoverDrafts, recordAll } from "../src/demo/record";
import { parseRecordArgs, type RecordArgs } from "../src/demo/record-args";
import { parseDemoRecording, type DemoRecording } from "../src/demo/recording";
import { createClaudeClient } from "../src/llm/client";
import { MODEL } from "../src/llm/config";
import { readVaultDir } from "../src/server/vault-files";

const ROOT = process.cwd();
const REC_PATH = join(ROOT, "data/demo-responses.json");
const UNMERGED_PATH = join(ROOT, "data/handover-drafts.unmerged.json");

// 입력 파일은 필요한 필드만 검증한다(라벨·정답은 평가 쪽에서 쓰므로 여기서 읽지 않는다 — 녹화가 정답을 보지 않게).
const InquirySchema = z.object({ id: z.string(), channel: z.string(), text: z.string() });
const GoldenSchema = z.object({
  id: z.string(),
  kind: z.enum(["staff-qa", "inquiry"]),
  question: z.string().optional(),
  inquiryId: z.string().optional(),
});

/** 단가(docs/EVALUATION.md '비용·토큰'): 100만 토큰당 입력 $2, 출력 $10. */
const USD_PER_MTOK = { input: 2, output: 10 };
/**
 * 인계 초안 1건 추정 토큰. 1차 인계 초안 녹화(2026-09-30) 평균은 입력 약 5,130 · 출력 약 210이었다(20건 합 102,650 / 4,207).
 * 지금 판은 규칙 17·18이 길어지고(되짚기·섞인 물음) 행정 안내 문단이 최대 2칸 더 가서 입력을 6,000으로 잡았다. 출력은 되짚기·답이 붙고
 * adaptive thinking 때문에 흔들려 범위로 적는다.
 */
const EST_HANDOVER = { input: 6000, outputLow: 300, outputHigh: 1000 };

function usd(input: number, output: number): string {
  return `$${((input * USD_PER_MTOK.input + output * USD_PER_MTOK.output) / 1_000_000).toFixed(3)}`;
}

function loadKnowledge(): Knowledge {
  // 볼트 시행일 기준은 화면과 같은 시연 기준일(src/demo/clock.ts DEMO_AS_OF) 하나다. 녹화하는 날의 날짜를 쓰면
  // 화면이 고른 문서 묶음과 모델이 받은 문서 묶음이 달라질 수 있다. 번들 생성이 두 값이 다르면 멈춘다.
  // 볼트가 깨지면(적신호·약 목록이 비는 등) 여기서 멈춘다 — 규칙 게이트 없이 AI를 부르지 않는다.
  const kr = buildKnowledge(loadVault(readVaultDir(join(ROOT, "vault")), { asOf: DEMO_AS_OF }));
  if (!kr.ok) throw new Error(`볼트를 읽지 못했습니다:\n${kr.errors.join("\n")}`);
  return kr.knowledge;
}

function readInquiries() {
  return z.array(InquirySchema).parse(JSON.parse(readFileSync(join(ROOT, "data/inquiries.json"), "utf8")));
}

async function recordEverything(limit: number) {
  // --all로만 온다(src/demo/record-args.ts). 기존 파일(4회차 등)과 그 수치를 덮어쓴다.
  const client = createClaudeClient(); // 키가 없으면 여기서 멈춘다.
  const k = loadKnowledge();
  const inquiries = readInquiries();
  const golden = z.array(GoldenSchema).parse(JSON.parse(readFileSync(join(ROOT, "data/golden.json"), "utf8")));

  const out: DemoRecording = await recordAll(client, k, inquiries, golden, {
    requestedModel: MODEL,
    vaultAsOf: DEMO_AS_OF,
    generatedAt: new Date().toISOString(),
    limit,
    log: (line) => console.log(line),
  });
  writeFileSync(REC_PATH, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`저장: data/demo-responses.json (입력 ${out.totalUsage.input_tokens} / 출력 ${out.totalUsage.output_tokens} 토큰)`);
  console.log("화면에 반영하려면 번들을 다시 만드세요: npm run bundle");
}

async function recordHandoverOnly(args: RecordArgs) {
  const { limit, dryRun, only, redo } = args;
  // 키를 읽기 전에 기존 파일·기준일·대상·합칠 수 있는지를 모두 확인한다(잘못된 상태로 크레딧을 쓰지 않게).
  if (!existsSync(REC_PATH)) {
    throw new Error("data/demo-responses.json이 없습니다. --handover-only는 기존 녹화에 인계 초안만 합칩니다 — 처음이면 --all로 전체를 녹화하세요.");
  }
  const raw: unknown = JSON.parse(readFileSync(REC_PATH, "utf8"));
  const parsed = parseDemoRecording(raw);
  if (!parsed.ok) throw new Error(`기존 녹화 파일 모양이 틀렸습니다:\n${parsed.errors.join("\n")}`);
  if (parsed.value.vaultAsOf !== DEMO_AS_OF) {
    throw new Error(`기존 녹화의 볼트 기준일(${parsed.value.vaultAsOf})이 시연 기준일(${DEMO_AS_OF})과 다릅니다. 인계 초안만 합칠 수 없습니다 — --all로 전체를 다시 녹화하세요.`);
  }
  const k = loadKnowledge();
  const all = handoverDraftTargets(k, readInquiries(), parsed.value);
  if (only) {
    const unknown = only.filter((id) => !all.some((q) => q.id === id));
    if (unknown.length > 0) throw new Error(`인계 초안 대상이 아닌 문의입니다: ${unknown.join(", ")} (대상: ${all.map((q) => q.id).join(", ")})`);
  }
  const recorded = (id: string) => Boolean(parsed.value.inquiries.find((r) => r.id === id)?.handoverDraft);
  const chosen = only ? all.filter((q) => only.includes(q.id)) : all;
  // --only·--redo가 없으면 이미 녹화된 인계 초안은 다시 부르지 않는다(사람이 읽은 결과를 덮지 않고, 크레딧을 두 번 쓰지 않게).
  const skipped = only || redo ? [] : chosen.filter((q) => recorded(q.id));
  const targets = chosen.filter((q) => !skipped.includes(q)).slice(0, limit);
  const problems = handoverMergeProblems(parsed.value, targets.map((q) => q.id));
  if (problems.length > 0) throw new Error(`기존 녹화에 합칠 수 없는 대상이 있습니다(모델을 부르지 않았습니다):\n${problems.join("\n")}`);

  console.log(`인계 초안 대상 ${targets.length}건(전체 대상 ${all.length}건): ${targets.map((q) => q.id).join(", ") || "없음"}`);
  if (skipped.length > 0) console.log(`이미 녹화돼 건너뜀 ${skipped.length}건: ${skipped.map((q) => q.id).join(", ")} (다시 녹화하려면 --only 또는 --redo)`);
  const redoing = targets.filter((q) => recorded(q.id));
  if (redoing.length > 0) console.log(`이미 녹화된 인계 초안을 다시 녹화합니다: ${redoing.map((q) => q.id).join(", ")}`);
  const n = targets.length;
  console.log(
    `추정: 입력 약 ${(n * EST_HANDOVER.input).toLocaleString()} / 출력 약 ${(n * EST_HANDOVER.outputLow).toLocaleString()}~${(n * EST_HANDOVER.outputHigh).toLocaleString()} 토큰 ≈ ${usd(n * EST_HANDOVER.input, n * EST_HANDOVER.outputLow)}~${usd(n * EST_HANDOVER.input, n * EST_HANDOVER.outputHigh)} (분류는 다시 부르지 않음)`,
  );
  if (dryRun || n === 0) {
    if (dryRun) console.log("--dry-run: 모델을 부르지 않았고 파일도 쓰지 않았습니다.");
    return;
  }

  const client = createClaudeClient(); // 키가 없으면 여기서 멈춘다.
  let current: unknown = raw;
  let merged = 0;
  const retry: string[] = [];
  const total = { input_tokens: 0, output_tokens: 0 };
  for (const q of targets) {
    const d = await handoverDraftFor(client, k, q);
    const usage = { input_tokens: 0, output_tokens: 0 };
    addUsage(usage, d.draft.meta.usage);
    total.input_tokens += usage.input_tokens;
    total.output_tokens += usage.output_tokens;
    const codes = d.draft.holdReasons.map((h) => h.code);
    if (codes.includes("api-error")) {
      retry.push(q.id);
      console.log(`${q.id} 인계 초안 → 모델 호출 오류(합치지 않음): ${d.draft.holdReasons.map((h) => h.detail).join(", ")}`);
      continue;
    }
    // 한 건씩 합쳐 바로 쓴다. 중간에 멈춰도(설정 오류·중단) 이미 쓴 크레딧의 결과가 파일에 남는다.
    const run = { generatedAt: new Date().toISOString(), requestedModel: MODEL, servedModels: d.draft.meta.model ? [d.draft.meta.model] : [], totalUsage: usage };
    const m = mergeHandoverDrafts(current, new Map([[q.id, d]]), run, DEMO_AS_OF);
    if (!m.ok) {
      writeFileSync(UNMERGED_PATH, `${JSON.stringify({ id: q.id, run, handoverDraft: d }, null, 2)}\n`);
      throw new Error(`${q.id}를 합치지 못했습니다(그 초안은 data/handover-drafts.unmerged.json에 남김, 앞서 합친 ${merged}건은 파일에 있음):\n${m.errors.join("\n")}`);
    }
    current = m.value;
    writeFileSync(REC_PATH, `${JSON.stringify(current, null, 2)}\n`);
    merged++;
    console.log(`${q.id} 인계 초안 → ${d.draft.status}${codes.length > 0 ? ` (${codes.join(", ")})` : ""} · 합쳐 저장`);
  }
  console.log(`저장: data/demo-responses.json에 인계 초안 ${merged}건 합침 (이번 입력 ${total.input_tokens} / 출력 ${total.output_tokens} 토큰 ≈ ${usd(total.input_tokens, total.output_tokens)})`);
  if (retry.length > 0) console.log(`다시 녹화할 건: --handover-only --only ${retry.join(",")}`);
  console.log("화면에 반영하려면 번들을 다시 만드세요: npm run bundle — 그 뒤 git diff data/demo-responses.json이 추가만인지 확인하세요.");
}

async function main() {
  const args = parseRecordArgs(process.argv.slice(2));
  if (args.handoverOnly) await recordHandoverOnly(args);
  else await recordEverything(args.limit);
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
