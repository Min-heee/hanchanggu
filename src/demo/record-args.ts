/**
 * scripts/record-demo.ts의 인자 해석(2026-09-30 검증 반영). 스크립트는 불러오면 바로 돌기 때문에 시험할 수 있게 따로 둔다.
 * 모르는 인자는 거부하고, 전체 재녹화는 --all이 있어야만 돈다 — "--handover-ony" 같은 오타 하나가 조용히 전체 재녹화(약 $1, 4회차 파일·수치를
 * 덮어씀)로 가지 않게.
 */

export interface RecordArgs {
  all: boolean;
  handoverOnly: boolean;
  dryRun: boolean;
  redo: boolean;
  limit: number;
  only: string[] | null;
}

/** 받는 인자. 값이 붙는 것(--limit, --only)과 아닌 것. 이 밖의 인자는 거부한다. */
const FLAGS = ["--all", "--handover-only", "--dry-run", "--redo"] as const;
const VALUED = ["--limit", "--only"] as const;

/**
 * 인자를 해석한다. 모르는 인자·값 빠진 인자·함께 쓸 수 없는 조합은 모두 오류다.
 * 전체 재녹화는 --all이 있어야만 돈다(인자 없이 실행하면 멈춘다) — 4회차 파일과 수치를 덮어쓰는 동작이라 명시적으로 고르게 한다.
 */
export function parseRecordArgs(argv: string[]): RecordArgs {
  const seen = new Set<string>();
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if ((FLAGS as readonly string[]).includes(a)) seen.add(a);
    else if ((VALUED as readonly string[]).includes(a)) {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith("--")) throw new Error(`${a} 뒤에 값을 적으세요.`);
      values.set(a, v);
      i++;
    } else {
      throw new Error(`모르는 인자입니다: ${a} (받는 인자: ${[...FLAGS, ...VALUED.map((x) => `${x} 값`)].join(", ")})`);
    }
  }
  const all = seen.has("--all");
  const handoverOnly = seen.has("--handover-only");
  if (all === handoverOnly) {
    throw new Error(
      all
        ? "--all과 --handover-only는 함께 쓸 수 없습니다."
        : "무엇을 녹화할지 고르세요: --handover-only(기존 녹화에 인계 초안만 합침, 약 $0.3) 또는 --all(전체 재녹화, 약 $1 — 기존 파일과 수치를 덮어씀).",
    );
  }
  const dryRun = seen.has("--dry-run");
  const redo = seen.has("--redo");
  const onlyArg = values.get("--only");
  if ((dryRun || redo || onlyArg !== undefined) && !handoverOnly) throw new Error("--dry-run·--redo·--only는 --handover-only와 함께만 씁니다.");
  const only = onlyArg === undefined ? null : onlyArg.split(",").map((x) => x.trim().toUpperCase()).filter((x) => x !== "");
  if (only && only.length === 0) throw new Error("--only 뒤에 문의 ID를 쉼표로 적으세요(예: --only Q06,Q11).");
  if (only && redo) throw new Error("--only와 --redo는 함께 쓰지 않습니다(--only는 고른 건만 다시, --redo는 대상 전부 다시).");
  const limitArg = values.get("--limit");
  let limit = Infinity;
  if (limitArg !== undefined) {
    limit = Number(limitArg);
    if (!Number.isInteger(limit) || limit <= 0) throw new Error(`--limit 값이 1 이상의 정수가 아닙니다: ${limitArg}`);
  }
  return { all, handoverOnly, dryRun, redo, limit, only };
}
