/**
 * 코드가 넣은 값 바로 뒤의 조사(을/를, 은/는, 이/가, 과/와, 으로/로)를 값의 끝소리에 맞춘다.
 *
 * 왜 필요한가: 모델은 자리표시자(`{{price:x}}`)나 문서 링크(`[[x]]`) 뒤에 조사를 붙이는데, 그때는 값을 모른다.
 * 값이 "30,000원"(받침 있음)으로 바뀌면 "을", "30,000원/회"(받침 없음)면 "를"이어야 한다. 2회차 녹화의
 * "30,000원/회을"이 이 경우다. 값을 넣는 코드가 조사까지 맞춰야 한다.
 *
 * 고치는 것은 값 바로 뒤에 붙은 조사 한 개뿐이다. 서술격 조사("입니다", "이며")는 받침과 상관없이 맞으므로 건드리지 않는다.
 * 값이 한글로 끝나지 않으면(숫자·기호) 읽는 소리를 추측하지 않고 그대로 둔다.
 */

type Final = "none" | "rieul" | "other";

const CLOSERS = /[’'"”)\]」』>]+$/;

/** 값의 마지막 한글 음절 받침. 닫는 따옴표·괄호는 건너뛴다("‘가격표’" → "표"). 한글로 끝나지 않으면 null. */
export function finalSound(value: string): Final | null {
  const s = value.replace(CLOSERS, "");
  const ch = s.charCodeAt(s.length - 1);
  if (!(ch >= 0xac00 && ch <= 0xd7a3)) return null;
  const jong = (ch - 0xac00) % 28;
  return jong === 0 ? "none" : jong === 8 ? "rieul" : "other";
}

// [받침 있을 때, 받침 없을 때]. 뒤에 한글이 이어지면 조사가 아니라 다른 말의 일부일 수 있어 경계를 본다.
const PAIRS: [string, string][] = [
  // 서술격 "이에요/예요"는 받침에 따라 갈린다("30,000원이에요", "30,000원/회예요"). 틀 문장이 허용하는 끝맺음이라 값 바로 뒤에 온다.
  ["이에요", "예요"],
  ["을", "를"],
  ["은", "는"],
  ["이", "가"],
  ["과", "와"],
];
const BOUNDARY = /^(?:[^가-힣]|$)/;

/** `following`(값 바로 뒤의 글) 앞머리 조사를 `value`의 끝소리에 맞춰 돌려준다. 고칠 것이 없으면 그대로. */
export function fixParticle(value: string, following: string): string {
  const f = finalSound(value);
  if (f === null) return following;
  for (const [withFinal, withoutFinal] of PAIRS) {
    for (const cand of [withFinal, withoutFinal]) {
      if (following.startsWith(cand) && BOUNDARY.test(following.slice(cand.length))) {
        return (f === "none" ? withoutFinal : withFinal) + following.slice(cand.length);
      }
    }
  }
  // 으로/로: ㄹ 받침은 "로"("서울로"). 뒤에 "는·도·서·써·만·부터"가 붙어도 같은 조사다 — 그 뒤가 다시 한글이면 다른 말일 수 있어
  // ("로서울") 고치지 않는다.
  const m = /^(으로|로)(?=(?:는|도|서|써|만|부터)?(?:[^가-힣]|$))/.exec(following);
  if (m) return (f === "other" ? "으로" : "로") + following.slice(m[1].length);
  return following;
}
