/**
 * 볼트(가상 의원 문서) 파싱·청크·필터.
 *
 * 왜 gray-matter를 쓰지 않나: 볼트 프런트매터는 `key: value` 한 줄짜리 스칼라뿐이다.
 * YAML 전체를 받아들이는 파서를 두면 "필드가 틀렸는데 조용히 통과"하는 길이 넓어진다.
 * 여기서는 규격(docs/PRD.md F1, 볼트 규격)에 있는 모양만 받고 나머지는 거부한다.
 *
 * 오프셋 규칙: CRLF는 LF로 바꾼 뒤의 문자열(`source`) 기준이다.
 * 청크의 `text`는 언제나 `source.slice(start, end)`와 같다(테스트로 고정).
 */

export const DOC_TYPES = ["patient-guide", "policy", "procedure", "template", "reference"] as const;
export const DOC_STATUSES = ["approved", "draft", "superseded"] as const;

export type DocType = (typeof DOC_TYPES)[number];
export type DocStatus = (typeof DOC_STATUSES)[number];

export interface Frontmatter {
  id: string;
  title: string;
  type: DocType;
  version: number;
  status: DocStatus;
  effective: string;
  owner: string;
  fictional: true;
  supersedes?: string;
}

export interface VaultDoc {
  path: string;
  meta: Frontmatter;
  /** CRLF→LF 정규화한 파일 전체. 모든 오프셋의 기준. */
  source: string;
  /** 본문(프런트매터 뒤)이 `source`에서 시작하는 위치. */
  bodyStart: number;
}

export interface Chunk {
  /** `V07#3` 꼴. 문서 ID + 문서 안 문단 순번(0부터). */
  chunkId: string;
  docId: string;
  /** 문단 바로 위의 제목(## 소제목). 제목 전에 나온 문단이면 null. */
  heading: string | null;
  /** 문서 안 문단 순번(0부터). 코드블록·면책 문장은 세지 않는다. */
  index: number;
  text: string;
  start: number;
  end: number;
}

export type ParseResult =
  | { ok: true; doc: VaultDoc }
  | { ok: false; path: string; errors: string[] };

/** 각 파일 맨 아래 면책 문장. 검색·인용 대상이 아니므로 청크에서 뺀다. */
export const DISCLAIMER = "가상 의원의 예시 문서이며 실제 의료 지침이 아닙니다.";

const ID_RE = /^V\d{2}[a-z]?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const REQUIRED = ["id", "title", "type", "version", "status", "effective", "owner", "fictional"] as const;
/**
 * 받는 키 전체. 모르는 키는 거부한다 — "supercedes" 같은 오타를 조용히 받으면
 * 대체 관계가 사라진 채 옛 문서가 승인 문서로 남는다.
 */
const KNOWN_KEYS: ReadonlySet<string> = new Set([...REQUIRED, "supersedes"]);

/**
 * 값 뒤의 ` # 주석`을 떼고, 따옴표로 감싼 값이면 벗긴다. 따옴표 안의 #은 주석이 아니다.
 * `"값" # 주석`처럼 따옴표 값 뒤에 주석이 와도 따옴표를 벗긴다. 닫는 따옴표 뒤에 주석 말고 다른 것이 있으면 null.
 */
function parseScalar(raw: string): string | null {
  const v = raw.trim();
  const q = v[0];
  if (q === '"' || q === "'") {
    const close = v.indexOf(q, 1);
    if (close === -1) return null;
    const rest = v.slice(close + 1).trim();
    if (rest !== "" && !rest.startsWith("#")) return null;
    return v.slice(1, close);
  }
  const hash = v.search(/\s#/);
  return (hash === -1 ? v : v.slice(0, hash)).trim();
}

function isValidDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  // 달력에 없는 날(2026-02-30 등)을 거른다. Date 객체를 쓰지 않고 윤년만 계산한다.
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return m >= 1 && m <= 12 && d >= 1 && d <= days[m - 1];
}

/**
 * md 한 편을 파싱한다. 필드 누락·잘못된 값은 모두 모아 거부한다.
 * 기본값을 채우지 않는다: status가 빠진 문서를 approved로 추정하면 미승인 문서가 인용될 수 있다.
 */
export function parseVaultFile(path: string, raw: string): ParseResult {
  const source = raw.replace(/\r\n/g, "\n");
  const errors: string[] = [];

  if (!source.startsWith("---\n")) {
    return { ok: false, path, errors: ["프런트매터(---)로 시작하지 않습니다"] };
  }
  const close = source.indexOf("\n---", 3);
  if (close === -1) {
    return { ok: false, path, errors: ["프런트매터가 닫히지 않았습니다"] };
  }
  const afterClose = close + "\n---".length;
  // 닫는 줄은 `---` 뒤에 줄바꿈이나 파일 끝만 허용한다(`----` 같은 선을 오인하지 않게).
  if (afterClose < source.length && source[afterClose] !== "\n") {
    return { ok: false, path, errors: ["프런트매터 닫는 줄이 '---'가 아닙니다"] };
  }
  const bodyStart = Math.min(afterClose + 1, source.length);

  const fields = new Map<string, string>();
  for (const line of source.slice(4, close).split("\n")) {
    if (line.trim() === "" || line.trim().startsWith("#")) continue;
    const m = /^([A-Za-z][\w-]*):(.*)$/.exec(line);
    if (!m) {
      errors.push(`프런트매터 줄을 읽을 수 없습니다: "${line}"`);
      continue;
    }
    if (fields.has(m[1])) errors.push(`필드가 두 번 나옵니다: ${m[1]}`);
    if (!KNOWN_KEYS.has(m[1])) errors.push(`모르는 필드입니다: ${m[1]}`);
    const value = parseScalar(m[2]);
    if (value === null) {
      errors.push(`따옴표 값을 읽을 수 없습니다: "${line}"`);
      continue;
    }
    fields.set(m[1], value);
  }

  for (const key of REQUIRED) {
    if (!fields.has(key) || fields.get(key) === "") errors.push(`필수 필드 누락: ${key}`);
  }
  if (errors.length > 0) return { ok: false, path, errors };

  const id = fields.get("id")!;
  const type = fields.get("type")!;
  const versionRaw = fields.get("version")!;
  const status = fields.get("status")!;
  const effective = fields.get("effective")!;
  const fictional = fields.get("fictional")!;
  const supersedes = fields.get("supersedes");

  if (!ID_RE.test(id)) errors.push(`id 형식이 틀렸습니다: ${id}`);
  if (!(DOC_TYPES as readonly string[]).includes(type)) errors.push(`type 값이 틀렸습니다: ${type}`);
  if (!/^[1-9]\d*$/.test(versionRaw)) errors.push(`version은 1 이상의 정수여야 합니다: ${versionRaw}`);
  if (!(DOC_STATUSES as readonly string[]).includes(status)) errors.push(`status 값이 틀렸습니다: ${status}`);
  if (!isValidDate(effective)) errors.push(`effective 날짜가 틀렸습니다: ${effective}`);
  // 공개 저장소에 실제 문서가 섞이지 않게, 가상 문서임을 스스로 밝히지 않은 파일은 받지 않는다.
  if (fictional !== "true") errors.push(`fictional은 true여야 합니다: ${fictional}`);
  if (supersedes !== undefined) {
    if (!ID_RE.test(supersedes)) errors.push(`supersedes 형식이 틀렸습니다: ${supersedes}`);
    else if (supersedes === id) errors.push("문서가 자기 자신을 대체할 수 없습니다");
  }
  if (errors.length > 0) return { ok: false, path, errors };

  return {
    ok: true,
    doc: {
      path,
      source,
      bodyStart,
      meta: {
        id,
        title: fields.get("title")!,
        type: type as DocType,
        version: Number(versionRaw),
        status: status as DocStatus,
        effective,
        owner: fields.get("owner")!,
        fictional: true,
        ...(supersedes !== undefined ? { supersedes } : {}),
      },
    },
  };
}

/**
 * 본문을 문단 단위로 자른다.
 * - 빈 줄로 나뉜 연속된 줄 묶음이 한 문단이다.
 * - `#`로 시작하는 제목 줄은 문단이 아니라 다음 문단들의 `heading`이 된다.
 * - ``` 코드블록(기계가 읽는 json)은 검색·인용 대상이 아니므로 뺀다.
 * - 면책 문장은 모든 문서에 같은 글이 있어 검색을 흐리므로 뺀다.
 */
export function chunkDoc(doc: VaultDoc): Chunk[] {
  const { source, bodyStart } = doc;
  const chunks: Chunk[] = [];
  let heading: string | null = null;
  let inFence = false;
  let paraStart = -1;
  let paraEnd = -1;

  const flush = () => {
    if (paraStart === -1) return;
    const text = source.slice(paraStart, paraEnd);
    if (text.trim() !== DISCLAIMER) {
      const index = chunks.length;
      chunks.push({ chunkId: `${doc.meta.id}#${index}`, docId: doc.meta.id, heading, index, text, start: paraStart, end: paraEnd });
    }
    paraStart = -1;
    paraEnd = -1;
  };

  let pos = bodyStart;
  while (pos < source.length) {
    const nl = source.indexOf("\n", pos);
    const lineEnd = nl === -1 ? source.length : nl;
    const line = source.slice(pos, lineEnd);

    if (/^\s*```/.test(line)) {
      flush();
      inFence = !inFence;
    } else if (inFence) {
      // 코드블록 안은 건너뛴다.
    } else if (line.trim() === "") {
      flush();
    } else if (/^#{1,6}\s/.test(line)) {
      flush();
      heading = line.replace(/^#{1,6}\s+/, "").trim();
    } else {
      // 줄 끝 공백은 문단 범위에 넣지 않는다(인용 대조 때 원문과 어긋나지 않게 slice와 text를 같게 유지).
      const trimmedEnd = pos + line.replace(/\s+$/, "").length;
      if (paraStart === -1) paraStart = pos + (line.length - line.trimStart().length);
      paraEnd = trimmedEnd;
    }
    pos = lineEnd + 1;
  }
  flush();
  return chunks;
}

export type JsonBlockResult = { ok: true; value: unknown } | { ok: false; error: string };

/** 본문의 ```json 코드블록 하나를 꺼낸다. 없거나 둘 이상이거나 JSON이 깨졌으면 거부한다. */
export function extractJsonBlock(doc: VaultDoc): JsonBlockResult {
  const body = doc.source.slice(doc.bodyStart);
  const blocks = [...body.matchAll(/^\s*```json[ \t]*\n([\s\S]*?)\n\s*```[ \t]*$/gm)];
  if (blocks.length === 0) return { ok: false, error: `${doc.meta.id}: json 코드블록이 없습니다` };
  if (blocks.length > 1) return { ok: false, error: `${doc.meta.id}: json 코드블록이 ${blocks.length}개입니다(하나만 허용)` };
  try {
    return { ok: true, value: JSON.parse(blocks[0][1]) };
  } catch (e) {
    return { ok: false, error: `${doc.meta.id}: json을 읽을 수 없습니다 (${(e as Error).message})` };
  }
}

export type ExcludeReason = "draft" | "superseded" | "replaced" | "not-yet-effective";

export interface ExcludedDoc {
  id: string;
  title: string;
  status: DocStatus;
  version: number;
  reason: ExcludeReason;
  /** 이 문서를 대체한 승인 문서 ID(알 수 있을 때). */
  supersededBy?: string;
}

export interface VaultSelection {
  active: VaultDoc[];
  excluded: ExcludedDoc[];
  errors: string[];
}

/**
 * 검색·인용에 쓸 문서만 고른다.
 * - approved만 남긴다. draft·superseded는 이유와 함께 '제외 목록'으로 돌려준다(화면에 보이기 위해).
 * - status가 approved여도 다른 승인 문서의 supersedes에 이름이 오르면 뺀다('replaced').
 *   옛 문서의 status를 superseded로 바꾸는 걸 잊는 실수가 흔해서 두 겹으로 막는다.
 * - ID가 겹치면 어느 쪽이 정본인지 알 수 없으므로 둘 다 빼고 오류로 알린다.
 * - 대체하는 문서의 version이 대체되는 문서보다 높지 않으면 오류다(어느 쪽이 새 판인지 알 수 없다).
 * - `asOf`(YYYY-MM-DD)를 주면 시행일이 그 뒤인 승인 문서는 '아직 시행 전'으로 뺀다.
 *   코어는 시계를 읽지 않으므로 오늘 날짜는 호출하는 쪽이 넘긴다. 생략하면 시행일을 보지 않는다.
 */
export function selectCurrent(docs: VaultDoc[], opts: { asOf?: string } = {}): VaultSelection {
  const errors: string[] = [];
  const byId = new Map<string, VaultDoc[]>();
  for (const d of docs) byId.set(d.meta.id, [...(byId.get(d.meta.id) ?? []), d]);

  const dupIds = new Set<string>();
  for (const [id, list] of byId) {
    if (list.length > 1) {
      dupIds.add(id);
      errors.push(`문서 ID가 겹칩니다: ${id} (${list.map((d) => d.path).join(", ")})`);
    }
  }

  if (opts.asOf !== undefined && !isValidDate(opts.asOf)) errors.push(`asOf 날짜가 틀렸습니다: ${opts.asOf}`);
  const asOf = opts.asOf !== undefined && isValidDate(opts.asOf) ? opts.asOf : null;
  const pending = (d: VaultDoc) => asOf !== null && d.meta.effective > asOf;

  const replacedBy = new Map<string, string>();
  for (const d of docs) {
    // 아직 시행 전인 새 판은 옛 판을 대체하지 않는다(옛 판이 시행일까지 유효하다).
    if (d.meta.status === "approved" && d.meta.supersedes && !dupIds.has(d.meta.id) && !pending(d)) {
      const old = byId.get(d.meta.supersedes)?.[0];
      if (old && old.meta.version >= d.meta.version) {
        errors.push(`${d.meta.id}(v${d.meta.version})가 더 높거나 같은 판 ${old.meta.id}(v${old.meta.version})를 대체한다고 적었습니다`);
      }
      replacedBy.set(d.meta.supersedes, d.meta.id);
    }
  }

  const active: VaultDoc[] = [];
  const excluded: ExcludedDoc[] = [];
  for (const d of docs) {
    if (dupIds.has(d.meta.id)) continue;
    const base = { id: d.meta.id, title: d.meta.title, status: d.meta.status, version: d.meta.version };
    const by = replacedBy.get(d.meta.id);
    if (d.meta.status === "draft") excluded.push({ ...base, reason: "draft" });
    else if (d.meta.status === "superseded") excluded.push({ ...base, reason: "superseded", ...(by ? { supersededBy: by } : {}) });
    else if (by) excluded.push({ ...base, reason: "replaced", supersededBy: by });
    else if (pending(d)) excluded.push({ ...base, reason: "not-yet-effective" });
    else active.push(d);
  }
  return { active, excluded, errors };
}

export interface LoadedVault extends VaultSelection {
  /** 파싱에 성공한 모든 문서(제외 문서 포함). json 값을 읽을 때는 active만 쓴다. */
  all: VaultDoc[];
}

/** 파일 목록(경로·원문)을 받아 파싱과 필터를 한 번에 한다. 파일 읽기와 오늘 날짜(asOf)는 호출하는 쪽 몫이다. */
export function loadVault(files: { path: string; raw: string }[], opts: { asOf?: string } = {}): LoadedVault {
  const all: VaultDoc[] = [];
  const errors: string[] = [];
  for (const f of files) {
    const r = parseVaultFile(f.path, f.raw);
    if (r.ok) all.push(r.doc);
    else errors.push(...r.errors.map((e) => `${r.path}: ${e}`));
  }
  const sel = selectCurrent(all, opts);
  return { all, active: sel.active, excluded: sel.excluded, errors: [...errors, ...sel.errors] };
}

/** 승인 문서에서만 json 값을 꺼낸다. 미승인·옛 버전 가격표가 초안에 들어가는 길을 막는다. */
export function activeJson(vault: VaultSelection, id: string): JsonBlockResult {
  const doc = vault.active.find((d) => d.meta.id === id);
  if (!doc) return { ok: false, error: `${id}: 승인된 문서가 없습니다` };
  return extractJsonBlock(doc);
}
