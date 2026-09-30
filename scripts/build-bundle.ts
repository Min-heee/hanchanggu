/**
 * 화면용 번들을 만든다(src/generated/bundle.json). `npm run build`·`dev` 앞에 자동으로 돈다.
 *
 *   npm run bundle                         # 볼트 + 문의 + 골든셋 + (있으면) data/demo-responses.json
 *   DEMO_FAKE_RECORDING=1 npm run dev      # 녹화 대신 시험용 가짜 녹화(모델 호출 없음)로 화면 보기
 *   npm run bundle -- --if-missing         # 번들이 이미 있으면 건드리지 않는다(typecheck·test 앞에서 쓴다)
 *
 * 생성물은 커밋하지 않는다(data/README.md '화면용 번들'). 원본(vault/, data/)과 두 벌이 되면 어긋날 수 있다.
 * 볼트·데이터·녹화 중 하나라도 읽히지 않으면 번들을 쓰지 않고 멈춘다 — 빈 화면이 배포되지 않게.
 * 가짜 녹화가 배포에 실리거나, 녹화 없이 공개 배포되는 것도 여기서 멈춘다(src/demo/bundle.ts recordingGuard).
 * 녹화에 인계 문의의 의료진 확인용 초안(PRD v0.3)이 빠진 건이 있으면 경고만 한다 — 화면은 그 문의에 '녹화 전'을 정직하게 보이고,
 * 안전 규칙·인계 카드·응답 시한은 녹화와 상관없이 돈다. 채우려면 `record-demo --handover-only`(기존 녹화에 인계 초안만 합침).
 *
 * `--fake-recording` 인자는 없앴다. 뒤이어 부르는 dev·build의 pre 훅이 번들을 다시 만들면서 가짜 녹화를
 * 조용히 지웠기 때문이다. 환경변수는 dev 앞의 자동 번들까지 이어진다.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildKnowledge } from "../src/core/knowledge";
import { loadVault } from "../src/core/vault";
import { buildBundle, recordingGuard } from "../src/demo/bundle";
import { DEMO_AS_OF } from "../src/demo/clock";
import { buildFakeRecording } from "../src/demo/fake-recording";
import { handoverDraftTargets } from "../src/demo/record";
import { readVaultDir } from "../src/server/vault-files";

const ROOT = process.cwd();
const OUT = join(ROOT, "src/generated/bundle.json");

async function main() {
  if (process.argv.includes("--if-missing") && existsSync(OUT)) return;
  const fake = process.env.DEMO_FAKE_RECORDING === "1";
  const recPath = join(ROOT, "data/demo-responses.json");
  const guard = recordingGuard({
    fakeRequested: fake,
    hasRecordingFile: existsSync(recPath),
    forBuild: process.argv.includes("--for-build"),
    vercel: process.env.VERCEL,
    vercelEnv: process.env.VERCEL_ENV,
    ci: process.env.CI,
  });
  if (!guard.ok) {
    console.error(`번들을 만들지 않습니다: ${guard.error}`);
    process.exit(1);
  }

  const vaultFiles = readVaultDir(join(ROOT, "vault"));
  const inquiriesJson = JSON.parse(readFileSync(join(ROOT, "data/inquiries.json"), "utf8")) as { id: string; channel: string; text: string }[];
  const goldenJson = JSON.parse(readFileSync(join(ROOT, "data/golden.json"), "utf8")) as { id: string; kind: "staff-qa" | "inquiry"; question?: string }[];

  let recordingJson: unknown | null = null;
  if (fake) {
    const kr = buildKnowledge(loadVault(vaultFiles, { asOf: DEMO_AS_OF }));
    if (!kr.ok) throw new Error(kr.errors.join("\n"));
    // JSON으로 한 번 왕복시킨다. 진짜 녹화 파일과 똑같이 '파일에서 읽은 값'으로 검사받게.
    recordingJson = JSON.parse(JSON.stringify(await buildFakeRecording(kr.knowledge, inquiriesJson, goldenJson, DEMO_AS_OF)));
  } else if (existsSync(recPath)) {
    recordingJson = JSON.parse(readFileSync(recPath, "utf8"));
  }

  const r = buildBundle({
    asOf: DEMO_AS_OF,
    vaultFiles,
    inquiriesJson,
    goldenJson,
    recordingJson,
    recordingSource: fake ? "fake-fixture" : "file",
  });
  if (!r.ok) {
    console.error(`번들을 만들지 못했습니다:\n${r.errors.join("\n")}`);
    process.exit(1);
  }
  mkdirSync(join(ROOT, "src/generated"), { recursive: true });
  writeFileSync(OUT, JSON.stringify(r.bundle));
  const recText = r.bundle.recording ? `녹화 ${r.bundle.recordingSource}(문의 ${r.bundle.recording.inquiries.length}, 질문 ${r.bundle.recording.golden.length})` : "녹화 없음";
  console.log(`번들: 볼트 ${vaultFiles.length}편, 문의 ${r.bundle.inquiries.length}건, 골든셋 ${r.bundle.golden.length}문항, ${recText}`);
  for (const w of r.bundle.recordingIssues) console.warn(`경고: ${w.target} ${w.message}`);
  const rec = r.bundle.recording;
  if (rec) {
    const kr = buildKnowledge(loadVault(vaultFiles, { asOf: DEMO_AS_OF }));
    if (kr.ok) {
      const missing = handoverDraftTargets(kr.knowledge, r.bundle.inquiries, rec).filter((q) => !rec.inquiries.find((x) => x.id === q.id)?.handoverDraft);
      if (missing.length > 0) console.warn(`경고: 인계 초안 녹화 전 ${missing.length}건(${missing.map((q) => q.id).join(", ")}) — record-demo --handover-only`);
    }
  }
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
