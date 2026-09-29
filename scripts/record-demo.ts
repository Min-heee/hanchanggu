/**
 * 시연 모드용 응답 녹화(PRD F18). **키가 있을 때 저장소 주인이 직접 실행한다.** 방문자는 이 결과만 본다.
 *
 *   ANTHROPIC_API_KEY=... npm run record-demo            # 전부
 *   ANTHROPIC_API_KEY=... npm run record-demo -- --limit 3   # 앞 3건씩만(비용 확인용)
 *
 * 입력: vault/*.md, data/inquiries.json, data/golden.json
 * 출력: data/demo-responses.json — 형식은 src/demo/recording.ts(DemoRecording). 화면이 같은 타입으로 읽는다.
 *
 * 파이프라인 본체는 src/demo/record.ts에 있다. 시험용 가짜 녹화(src/demo/fake-recording.ts)도 같은 함수를
 * 모의 클라이언트로 부르므로, 화면을 가짜 녹화로 시험해도 이 스크립트가 쓰는 모양과 어긋나지 않는다.
 * 여기서는 파일 읽기·쓰기와 진짜 클라이언트 만들기만 한다.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { buildKnowledge } from "../src/core/knowledge";
import { loadVault } from "../src/core/vault";
import { DEMO_AS_OF } from "../src/demo/clock";
import { recordAll } from "../src/demo/record";
import type { DemoRecording } from "../src/demo/recording";
import { createClaudeClient } from "../src/llm/client";
import { MODEL } from "../src/llm/config";
import { readVaultDir } from "../src/server/vault-files";

const ROOT = process.cwd();

// 입력 파일은 필요한 필드만 검증한다(라벨·정답은 평가 쪽에서 쓰므로 여기서 읽지 않는다 — 녹화가 정답을 보지 않게).
const InquirySchema = z.object({ id: z.string(), channel: z.string(), text: z.string() });
const GoldenSchema = z.object({
  id: z.string(),
  kind: z.enum(["staff-qa", "inquiry"]),
  question: z.string().optional(),
  inquiryId: z.string().optional(),
});

async function main() {
  const limitArg = process.argv.indexOf("--limit");
  const limit = limitArg !== -1 ? Number(process.argv[limitArg + 1]) : Infinity;

  const client = createClaudeClient(); // 키가 없으면 여기서 멈춘다.
  // 볼트 시행일 기준은 화면과 같은 시연 기준일(src/demo/clock.ts DEMO_AS_OF) 하나다. 녹화하는 날의 날짜를 쓰면
  // 화면이 고른 문서 묶음과 모델이 받은 문서 묶음이 달라질 수 있다. 번들 생성이 두 값이 다르면 멈춘다.
  const asOf = DEMO_AS_OF;
  const kr = buildKnowledge(loadVault(readVaultDir(join(ROOT, "vault")), { asOf }));
  if (!kr.ok) throw new Error(`볼트를 읽지 못했습니다:\n${kr.errors.join("\n")}`);

  const inquiries = z.array(InquirySchema).parse(JSON.parse(readFileSync(join(ROOT, "data/inquiries.json"), "utf8")));
  const golden = z.array(GoldenSchema).parse(JSON.parse(readFileSync(join(ROOT, "data/golden.json"), "utf8")));

  const out: DemoRecording = await recordAll(client, kr.knowledge, inquiries, golden, {
    requestedModel: MODEL,
    vaultAsOf: asOf,
    generatedAt: new Date().toISOString(),
    limit,
    log: (line) => console.log(line),
  });
  writeFileSync(join(ROOT, "data/demo-responses.json"), `${JSON.stringify(out, null, 2)}\n`);
  console.log(`저장: data/demo-responses.json (입력 ${out.totalUsage.input_tokens} / 출력 ${out.totalUsage.output_tokens} 토큰)`);
  console.log("화면에 반영하려면 번들을 다시 만드세요: npm run bundle");
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
