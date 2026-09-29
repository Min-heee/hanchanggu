/**
 * 볼트 문서 속 링크(`[[booking-policy]]`, `[[x|별칭]]`, `[[x#절]]`)를 사람이 읽는 말로 바꾼다.
 *
 * 왜 코어에 두나: 초안은 볼트 문장을 통째로 인용하므로 링크 표기가 그대로 딸려 온다(2회차 녹화 5문장).
 * 인용 대조는 원문 그대로 해야 하지만, 보내는 글·읽는 글에 파일 이름이 남으면 안 된다. 화면(읽는 글)과
 * 초안 생성(보내는 글)이 같은 규칙을 쓰게 한 곳에 둔다.
 *
 * 받는 사람에 따라 다르게 바꾼다.
 * - 직원(staff): 문서 제목을 ‘ ’로 감싼다. 직원은 그 문서를 열어 볼 수 있다.
 * - 환자(patient): 괄호 안에 링크만 있으면 괄호째 뺀다("처리합니다([[x]])." → "처리합니다."). 환자는 내부 문서를 열 수 없어
 *   참고 표시가 쓸모없고, 파일 구조를 밖에 알릴 이유도 없다. 문장 성분으로 쓰인 링크("예약금은 [[booking-policy]]를 따릅니다")는
 *   빼면 문장이 깨지므로 문서 제목을 따옴표 없이 넣는다. 제목은 승인 문서에 적힌 말이라 코드가 새 말을 지어내지 않는다.
 *   환자에게 그 이름이 필요한지는 보내는 직원이 판단한다(화면이 링크가 있던 자리를 알린다).
 */

import { fixParticle } from "./josa";
import type { LoadedVault } from "./vault";

export type Audience = "patient" | "staff";

/** 파일 이름(확장자·폴더 뺀 것) → 문서 제목. */
export type LinkTitles = ReadonlyMap<string, string>;

export const WIKI_LINK_SOURCE = String.raw`\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]`;

/** 괄호 안에 링크만(여럿이면 쉼표·가운뎃점·및·와/과로 이은 것) 있는 참고 표시. 앞 공백까지 뺀다. */
const LINK_ONLY_PARENS = new RegExp(String.raw`\s*\(\s*\[\[[^\]]+\]\](?:\s*(?:,|·|및|와|과)\s*\[\[[^\]]+\]\])*\s*\)`, "g");

const fileOf = (path: string) => path.replace(/^.*\//, "").replace(/\.md$/, "");

export function linkTitlesOf(vault: Pick<LoadedVault, "all">): LinkTitles {
  return new Map(vault.all.map((d) => [fileOf(d.path), d.meta.title]));
}

/** 환자 글에 이름이 나가도 되는 문서(승인된 최신판)의 파일 이름. 초안·옛 판은 제목을 알아도 여기 없다. */
export function approvedLinksOf(vault: Pick<LoadedVault, "active">): ReadonlySet<string> {
  return new Set(vault.active.map((d) => fileOf(d.path)));
}

/** 링크 하나를 바꾼 말. 제목을 모르면 파일 이름을 그대로 쓴다(없는 제목을 지어내지 않는다). */
export function linkText(file: string, alias: string | undefined, titles: LinkTitles, audience: Audience): string {
  if (alias) return alias;
  const name = titles.get(file.trim()) ?? file.trim();
  return audience === "staff" ? `‘${name}’` : name;
}

/** 환자에게 보내는 글에서 링크만 든 괄호를 뺀다. */
export function dropLinkOnlyParens(text: string): string {
  return text.replace(LINK_ONLY_PARENS, "");
}

/** 링크만 바꾼다(자리표시자가 없는 글: 볼트 문단 발췌 등). 뒤 조사는 바꾼 말에 맞춘다. */
export function renderWikiLinks(text: string, titles: LinkTitles, audience: Audience): string {
  const src = audience === "patient" ? dropLinkOnlyParens(text) : text;
  let out = "";
  let last = 0;
  let prev: string | null = null;
  for (const m of src.matchAll(new RegExp(WIKI_LINK_SOURCE, "g"))) {
    const between = src.slice(last, m.index);
    out += prev !== null ? fixParticle(prev, between) : between;
    prev = linkText(m[1], m[2], titles, audience);
    out += prev;
    last = m.index + m[0].length;
  }
  const rest = src.slice(last);
  return out + (prev !== null ? fixParticle(prev, rest) : rest);
}
