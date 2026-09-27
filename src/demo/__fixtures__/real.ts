import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildKnowledge, type Knowledge } from "../../core/knowledge";
import { loadVault } from "../../core/vault";
import { readVaultDir } from "../../server/vault-files";
import { buildBundle, type Bundle } from "../bundle";
import { DEMO_AS_OF } from "../clock";

/** 시험 전용: 저장소의 실제 볼트·데이터로 번들과 지식을 만든다(화면이 쓰는 것과 같은 경로). */
export const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "../../..");

export function realInputs() {
  return {
    asOf: DEMO_AS_OF,
    vaultFiles: readVaultDir(join(ROOT, "vault")),
    inquiriesJson: JSON.parse(readFileSync(join(ROOT, "data/inquiries.json"), "utf8")) as unknown,
    goldenJson: JSON.parse(readFileSync(join(ROOT, "data/golden.json"), "utf8")) as unknown,
  };
}

export function realBundle(recordingJson: unknown | null = null, source: "file" | "fake-fixture" = "file"): Bundle {
  const r = buildBundle({ ...realInputs(), recordingJson, recordingSource: source });
  if (!r.ok) throw new Error(r.errors.join("\n"));
  return r.bundle;
}

export function realKnowledge(): Knowledge {
  const kr = buildKnowledge(loadVault(readVaultDir(join(ROOT, "vault")), { asOf: DEMO_AS_OF }));
  if (!kr.ok) throw new Error(kr.errors.join("\n"));
  return kr.knowledge;
}
