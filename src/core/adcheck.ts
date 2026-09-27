/**
 * 광고 표현 검사(PRD F10). 답장 초안에 섞인 효과 보장·최상급·할인 유인·후기 대가 표현을 찾는다.
 *
 * 표현 목록은 볼트의 '의료광고 표현 가이드'(V15) json에서 읽는다(하드코딩하지 않는다).
 * 이 검사는 경고를 띄울 뿐 법률 판단이 아니다. banned가 걸리면 발송 버튼을 막고, warn은 표시만 한다.
 */

export interface AdTerm {
  term: string;
  reason: string | null;
}

export interface AdConfig {
  banned: AdTerm[];
  warn: AdTerm[];
}

export interface AdHit {
  level: "banned" | "warn";
  term: string;
  reason: string | null;
  /** 원문(초안)에서의 위치. 화면에서 칠하는 데 쓴다. */
  start: number;
  end: number;
  matchedText: string;
}

export interface AdCheckResult {
  level: "banned" | "warn" | "clean";
  hits: AdHit[];
}

export type AdConfigResult = { ok: true; config: AdConfig } | { ok: false; error: string };

function toTerms(v: unknown, name: string): AdTerm[] | string {
  if (!Array.isArray(v)) return `V15 ${name}이(가) 배열이 아닙니다`;
  const out: AdTerm[] = [];
  for (const x of v) {
    // 문자열 또는 { term, reason } 둘 다 받는다. 가이드 작성자가 이유를 적고 싶을 때가 있다.
    if (typeof x === "string" && x.trim() !== "") out.push({ term: x, reason: null });
    else if (typeof x === "object" && x !== null && typeof (x as { term?: unknown }).term === "string" && (x as { term: string }).term.trim() !== "") {
      const r = (x as { reason?: unknown }).reason;
      out.push({ term: (x as { term: string }).term, reason: typeof r === "string" ? r : null });
    } else return `V15 ${name}에 읽을 수 없는 항목이 있습니다`;
  }
  return out;
}

export function parseAdConfig(json: unknown): AdConfigResult {
  if (typeof json !== "object" || json === null || Array.isArray(json)) return { ok: false, error: "V15 json이 객체가 아닙니다" };
  const o = json as Record<string, unknown>;
  const banned = toTerms(o.banned, "banned");
  if (typeof banned === "string") return { ok: false, error: banned };
  const warn = toTerms(o.warn, "warn");
  if (typeof warn === "string") return { ok: false, error: warn };
  if (banned.length === 0) return { ok: false, error: "V15 banned가 비어 있습니다" };
  return { ok: true, config: { banned, warn } };
}

/**
 * 공백을 무시하고 찾되, 위치는 원문 기준으로 돌려준다.
 * "100 %"와 "100%", "부작용 없는"과 "부작용없는"을 같게 보기 위해서다.
 * 방법: 원문에서 공백을 뺀 문자열을 만들면서 각 글자의 원래 위치를 기록한다.
 * (NFKC가 글자 수를 바꾸는 드문 경우를 피하려고 글자 단위로 정규화한다.)
 */
function compact(text: string): { s: string; map: number[] } {
  let s = "";
  const map: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (/\s/.test(ch)) continue;
    const n = ch.normalize("NFKC").toLowerCase();
    for (const c of n) {
      s += c;
      map.push(i);
    }
  }
  return { s, map };
}

export function checkAdExpressions(text: string, config: AdConfig): AdCheckResult {
  const { s, map } = compact(text);
  const hits: AdHit[] = [];
  const scan = (terms: AdTerm[], level: AdHit["level"]) => {
    for (const t of terms) {
      const needle = compact(t.term).s;
      if (needle === "") continue;
      let from = 0;
      for (;;) {
        const at = s.indexOf(needle, from);
        if (at === -1) break;
        const start = map[at];
        const end = map[at + needle.length - 1] + 1;
        hits.push({ level, term: t.term, reason: t.reason, start, end, matchedText: text.slice(start, end) });
        from = at + needle.length;
      }
    }
  };
  scan(config.banned, "banned");
  scan(config.warn, "warn");
  hits.sort((a, b) => a.start - b.start || (a.level === "banned" ? -1 : 1));
  const level = hits.some((h) => h.level === "banned") ? "banned" : hits.length > 0 ? "warn" : "clean";
  return { level, hits };
}
