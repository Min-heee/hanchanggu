import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 볼트 폴더의 md를 읽는다. 파싱·검증은 core/vault.ts의 몫이고 여기서는 파일만 읽는다.
 * 파일명 순으로 정렬한다 — 검색 동점 처리(색인 순서)가 실행 환경의 디렉터리 순서에 흔들리지 않게.
 */
export function readVaultDir(dir: string): { path: string; raw: string }[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md") && !f.startsWith("."))
    .sort()
    .map((f) => ({ path: f, raw: readFileSync(join(dir, f), "utf8") }));
}
