/**
 * 개인정보 가림(PRD F9). 모델 호출 **전에** 돈다.
 *
 * 목표는 "외부 API로 나가는 정보를 줄이는 것"이지 완벽한 비식별화가 아니다(PRD 9절).
 * 그래서 애매하면 가리는 쪽으로 기운다: 이름이 아닌 말을 가려도 초안 품질이 조금 떨어질 뿐이지만,
 * 이름을 놓치면 그대로 외부로 나간다.
 */

export type MaskKind = "rrn" | "phone" | "email" | "birth" | "address" | "name";

export const MASK_LABEL: Record<MaskKind, string> = {
  rrn: "[주민번호]",
  phone: "[전화]",
  email: "[이메일]",
  birth: "[생년월일]",
  address: "[주소]",
  name: "[이름]",
};

export interface MaskItem {
  kind: MaskKind;
  /** 원문 조각. 이 값은 서버·브라우저 안에만 머문다(모델에 보내는 건 `masked`뿐). */
  original: string;
  start: number;
  end: number;
}

export interface MaskResult {
  /** 모델이 실제로 받는 텍스트. 화면의 "모델이 받은 텍스트"에 그대로 보인다. */
  masked: string;
  items: MaskItem[];
}

// 전각 숫자(０-９)도 숫자로 본다. 휴대폰 키보드·복사 붙여넣기로 흔히 들어온다. 전각 숫자는 한 글자씩이라 위치가 어긋나지 않는다.
const D = "[0-9０-９]";
const NOT_D = "(?<![0-9０-９+＋])";
// 숫자 앞뒤에 다른 숫자가 붙어 있으면 더 긴 번호(계좌번호 등)의 일부이므로 여기서 잡지 않는다.
const RRN = new RegExp(`${NOT_D}${D}{6}\\s?[-–]?\\s?[1-8１-８]${D}{6}(?!${D})`, "g");
// 휴대전화: 010-1234-5678, 010 1234 5678, 010.1234.5678, 01012345678, 010 - 1234 - 5678, 010)1234-5678, +82 10-1234-5678
const MOBILE = new RegExp(
  `${NOT_D}(?:[+＋]82[\\s.\\-)]*[1１]|[0０][1１])[016789０１６７８９](?:\\s*[.\\-)]\\s*|\\s*)${D}{3,4}(?:\\s*[.\\-]\\s*|\\s*)${D}{4}(?!${D})`,
  "g",
);
// 유선·안심번호: 구분자(공백 포함)를 반드시 요구한다(가격 "30000" 같은 숫자를 전화로 오인하지 않게).
const LANDLINE = new RegExp(
  `${NOT_D}[0０](?:[2２]|[3-6３-６][1-5１-５]|[5５][0０]${D}|[7７][0０])(?:\\s*[.\\-)]\\s*|\\s+)${D}{3,4}(?:\\s*[.\\-]\\s*|\\s+)${D}{4}(?!${D})`,
  "g",
);
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
// 생년월일: "1990년 1월 1일생", "1960년생", "생년월일: 1990.01.01".
const BIRTH = /(?<!\d)(?:19|20)\d{2}\s*년\s*(?:\d{1,2}\s*월\s*(?:\d{1,2}\s*일\s*)?)?생|생년월일\s*[:：]?\s*\d{2,4}[.\-/년\s]\s*\d{1,2}[.\-/월\s]\s*\d{1,2}일?/g;
// 폼의 주소 칸: "주소: …"에서 다음 칸 구분자(/, |, 줄바꿈) 전까지.
const ADDRESS = /(?<=주소\s*[:：]\s*)[^/|\n]+?(?=\s*(?:[/|\n]|$))/g;
// 폼의 이름 칸: "이름: 박OO", "성함 : 김철수".
const NAME_FIELD = /(?<=(?:이름|성함|성명)\s*[:：]\s*)[가-힣A-Za-z○OＯ*＊]{2,10}/g;
// "김철수님", "김철수 님", "김OO님", "김○○님". 단어 중간이면(앞에 한글) 끝의 세 글자만 이름으로 본다.
const NAME = /([가-힣]{2,4}|[가-힣][○OＯ*＊]{1,3})(\s?님)/g;
// "홍길동 고객님", "홍길동 환자님": 호칭 앞의 이름. "김철수씨", "김철수 씨".
const NAME_TITLED = /(?<![가-힣])([가-힣]{2,4})(?=\s?(?:(?:고객|환자|회원|보호자)\s?님|씨))/g;
// 가명 표기 "김OO", "이○○"는 어디에 있든 이름으로 본다.
const PSEUDONYM = /(?<![가-힣])[가-힣][○OＯ]{2,3}(?![A-Za-z])/g;

/**
 * '님'으로 끝나지만 사람 이름이 아닌 말. 호칭·관계어는 가리지 않는다.
 * 이 목록에 없는 '○○님'은 이름으로 보고 가린다(fail-closed).
 */
const NOT_NAMES = new Set([
  "고객", "환자", "회원", "보호자", "손", "어머", "아버", "부모", "사모", "따", "아드", "형", "누",
  "원장", "선생", "간호사", "실장", "팀장", "과장", "부장", "대표", "사장", "상담사", "코디", "매니저",
  "담당자", "직원", "의사", "교수", "기사", "작가", "여러분", "하느", "주인", "상담", "문의자", "작성자",
  "할머", "할아버", "시어머", "시아버", "장모", "장인", "선배", "고객센터",
]);
/** '씨' 앞에서 이름이 아닌 말(마음씨, 아가씨, 아저씨). */
const NOT_NAMES_SSI = new Set(["마음", "아가", "아저", "솜", "날", "글", "말", "맵"]);

function plausibleBirth(yymmdd: string): boolean {
  const mm = Number(yymmdd.slice(2, 4));
  const dd = Number(yymmdd.slice(4, 6));
  return mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31;
}

interface Candidate extends MaskItem {
  priority: number;
}

function isNotName(word: string): boolean {
  if (NOT_NAMES.has(word)) return true;
  // "담당선생님"처럼 단어 중간에서 잡혀도 끝이 호칭이면 이름이 아니다(두 글자 이상 호칭만 본다).
  for (const n of NOT_NAMES) if (n.length >= 2 && word.endsWith(n)) return true;
  return false;
}

function collect(text: string, re: RegExp, kind: MaskKind, priority: number, out: Candidate[]) {
  for (const m of text.matchAll(re)) {
    const at = m.index!;
    if (re === NAME) {
      let word = m[1];
      let start = at;
      // 앞에 한글이 붙어 있으면("안녕하세요홍길동님" → "요홍길동") 이름은 보통 끝의 세 글자다.
      // 앞 글자까지 가리면 뜻이 흐려지므로 세 글자만 가린다. 단어 중간이라고 건너뛰지는 않는다(fail-closed).
      if (at > 0 && /[가-힣]/.test(text[at - 1]) && word.length > 3) {
        start = at + word.length - 3;
        word = word.slice(-3);
      }
      if (isNotName(m[1]) || isNotName(word)) continue;
      // 이름 부분만 가리고 '님'은 남긴다. "[이름]님"이 초안 문장에서 자연스럽다.
      out.push({ kind, original: word, start, end: start + word.length, priority });
    } else if (re === NAME_TITLED) {
      const word = m[1];
      const after = text.slice(at + word.length).replace(/^\s/, "");
      if (after.startsWith("씨") && NOT_NAMES_SSI.has(word)) continue;
      if (isNotName(word)) continue;
      out.push({ kind, original: word, start: at, end: at + word.length, priority });
    } else {
      // 주민번호 앞 6자리는 생년월일이다. 월·일이 말이 안 되면 주문번호 같은 다른 숫자로 본다.
      if (kind === "rrn" && !plausibleBirth(m[0].normalize("NFKC").replace(/\D/g, "").slice(0, 6))) continue;
      // 앞뒤 공백은 가리지 않는다("주소: 서울…"에서 콜론 뒤 공백은 남긴다).
      const lead = m[0].length - m[0].trimStart().length;
      const original = m[0].trim();
      if (original === "") continue;
      out.push({ kind, original, start: at + lead, end: at + lead + original.length, priority });
    }
  }
}

/**
 * 겹치는 후보는 우선순위(주민번호 > 전화 > 이메일 > 생년월일 > 주소 > 이름), 같으면 먼저 시작한 것을 남긴다.
 * 가림 범위(PRD F9): 전화·이메일·주민번호·"○○님" 호칭, 그리고 폼의 이름·주소 칸, 생년월일, 가명 표기(김OO).
 */
export function maskPii(text: string): MaskResult {
  const cands: Candidate[] = [];
  collect(text, RRN, "rrn", 0, cands);
  collect(text, MOBILE, "phone", 1, cands);
  collect(text, LANDLINE, "phone", 1, cands);
  collect(text, EMAIL, "email", 2, cands);
  collect(text, BIRTH, "birth", 3, cands);
  collect(text, ADDRESS, "address", 4, cands);
  collect(text, NAME_FIELD, "name", 5, cands);
  collect(text, PSEUDONYM, "name", 5, cands);
  collect(text, NAME_TITLED, "name", 5, cands);
  collect(text, NAME, "name", 5, cands);

  cands.sort((a, b) => a.priority - b.priority || a.start - b.start);
  const chosen: Candidate[] = [];
  for (const c of cands) {
    if (chosen.some((x) => c.start < x.end && x.start < c.end)) continue;
    chosen.push(c);
  }
  chosen.sort((a, b) => a.start - b.start);

  let masked = "";
  let pos = 0;
  for (const c of chosen) {
    masked += text.slice(pos, c.start) + MASK_LABEL[c.kind];
    pos = c.end;
  }
  masked += text.slice(pos);

  return { masked, items: chosen.map(({ kind, original, start, end }) => ({ kind, original, start, end })) };
}
