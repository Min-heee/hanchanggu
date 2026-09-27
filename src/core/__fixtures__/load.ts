import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** 테스트 전용: 작은 볼트 픽스처를 읽는다. 실제 볼트(저장소 루트 vault/)는 다른 작업이 쓰는 중이라 건드리지 않는다. */
const DIR = join(fileURLToPath(new URL(".", import.meta.url)), "vault");

export function fixtureFiles(): { path: string; raw: string }[] {
  return readdirSync(DIR)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => ({ path: f, raw: readFileSync(join(DIR, f), "utf8") }));
}

export function fixture(name: string): { path: string; raw: string } {
  return { path: name, raw: readFileSync(join(DIR, name), "utf8") };
}
