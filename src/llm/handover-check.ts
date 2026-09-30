/**
 * 인계 초안(src/llm/draft.ts mode "handover", PRD v0.4)의 코드 검사. SDK를 쓰지 않는 순수 함수라 녹화(src/demo/record.ts)·녹화 뒤 바뀜 검사
 * (src/demo/drift.ts)·평가(src/demo/evaluation.ts)·화면(src/demo/view.ts recheckHandoverDraft → 인계 카드 안 초안 칸)이 같은 함수를 부른다 —
 * 화면이 녹화 때의 status만 믿으면, 규칙을 조인 뒤에도 옛 기준으로 통과한 녹화 초안을 의료진이 보낼 수 있다(막는 쪽으로 틀리지 않는다).
 *
 * 초안 구성(2026-09-30 오너 두 번째 결정 '문의에 맞춰 조금 더 쓰게 푼다'): [되짚기 0~1문장] + [승인 문구(필수)] + [섞인 의료가 아닌 물음의 답] +
 * [연락·내원 절차]. 인용 없이 받는 문장은 맨 앞 되짚기 하나뿐이고, 나머지 문장은 인용한 원문 문장을 글자 그대로 옮긴 것이어야 한다.
 * 같은 날 적대 검증에서 나온 우회로(승인 문구 뒤 짧은 꼬리 "기다려 보세요", 인용을 달고 바꿔 쓴 "소독하며 지켜보시면 됩니다",
 * 인용 없는 자리표시자 문장 "바로 오시면 되는 시간은 {{hours}}입니다", 부정 말을 뒤집은 되짚기, 물음을 허락으로 바꾼 되짚기, 금액을 숫자로 쓴 인용 문장,
 * 제외 문서 링크)를 모두 여기서 막는다.
 */

import { koreanNumeralsToDigits, numbersIn, type SentenceReport } from "../core/citations";
import { inquiryClauses } from "../core/clauses";
import { unquoteFixedMessage, type Knowledge } from "../core/knowledge";
import { checkMedication, type MedicationConfig } from "../core/medication";
import { checkRedflags, type RedflagConfig } from "../core/redflag";
import type { DraftResult } from "./draft";

/** 인계 초안 검사(checkHandoverDraft)가 쓰는 볼트 값. handoverGuardOf가 Knowledge에서 채운다. */
export interface HandoverGuard {
  /** 고정 안내 문단(인계 절차 문서의 '환자에게 보내는 고정 안내 문장'). */
  fixedChunkId: string;
  /** 그 문단의 따옴표 안 승인 문구(core/knowledge.ts handoverFixedMessage — 인계 카드가 보이는 문구와 같다). */
  fixedMessage: string;
  /** 약 말(V17 terms·exclude). 문의 게이트와 같은 값. */
  medication: MedicationConfig;
  /** 증상 말(V11 symptoms·ambiguous·nonSymptomWords·체온 기준). 문의 게이트와 같은 값. */
  redflag: RedflagConfig;
  /** 가림 뒤 문의 원문(모델이 받은 글). 되짚기 문장의 말이 여기에 있어야 한다(checkRecapSentence). */
  maskedText: string;
}

/** 지금 볼트 값으로 만든 검사 기준. 고정 안내 문단이나 승인 문구를 읽지 못하면 null(부르는 쪽이 보류한다). */
export function handoverGuardOf(k: Pick<Knowledge, "index" | "medication" | "redflag">, maskedText: string): HandoverGuard | null {
  const rules = k.index.rules?.handoverDraft;
  if (!rules?.fixedChunkId || !rules.fixedMessage) return null;
  return { fixedChunkId: rules.fixedChunkId, fixedMessage: rules.fixedMessage, medication: k.medication, redflag: k.redflag, maskedText };
}

/** 글자·숫자만 남긴다(공백·문장부호·따옴표 무시). 승인 문구가 통째로 들어 있는지 볼 때 쓴다. */
function lettersDigits(s: string): string {
  return s.normalize("NFKC").replace(/[^\p{L}\p{N}]/gu, "");
}

const escapeRe = (ch: string) => ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 승인 문구의 문장마다, 공백·문장부호 차이를 허용하고 그 문장을 찾는 정규식. 문장에서 승인 문구를 지운 나머지를 볼 때 쓴다. */
function messageSentencePatterns(message: string): RegExp[] {
  return message
    .normalize("NFKC")
    .split(/(?<=[.!?。])\s+/)
    .map(lettersDigits)
    .filter((m) => m !== "")
    .map((m) => new RegExp([...m].map(escapeRe).join("[^\\p{L}\\p{N}]*"), "gu"));
}

// ─── 되짚기 문장 ─────────────────────────────────────────────────────────

/**
 * 되짚기 문장이 끝나야 하는 확인 어미("…라고 말씀 주셨습니다", "…문의 주셨습니다"). 환자가 한 말을 옮겼다는 표시라,
 * 이 어미로 끝나지 않는 문장(평서 판단 "…입니다", 권유 "…하세요")은 되짚기로 받지 않는다. 첫 묶음이 어미 낱말(물음 꼴 검사에 쓴다).
 */
const RECAP_ENDING = /(말씀|문의|요청|부탁|적어|알려)\s*(?:을\s*|를\s*)?(?:주셨|하셨)습니다\s*[.!]?$/u;

/**
 * 되짚기에 있으면 안 되는 판단·권유·지시·허락 말. 환자가 문의에 같은 말을 썼어도 막는다("괜찮겠죠?" → "괜찮은지 문의 주셨습니다"도 보류) —
 * 인용 없이 받는 문장이라 과하게 막는 쪽으로 틀린다. '세요'는 하세요·드세요·바르세요·마세요 같은 권유·지시 어미를 한 번에 막는다.
 * 허락 말(된다고·돼도·해도 된·…도 되·안 …도·먹어도·끊어도·바르/발라)은 환자의 물음("가도 되나요?")을 병원의 허락("가도 된다고")처럼 바꾸는 것을
 * 막는다(2026-09-30 적대 검증). 물음은 "…가도 되는지 문의 주셨습니다" 꼴로만 받는다 — '되는지'·'될지'는 막지 않는다.
 */
const RECAP_BANNED = new RegExp(
  [
    "괜찮", "정상", "문제\\s*(?:없|되지|가\\s*없)", "걱정\\s*(?:마|하지|안\\s*하)", "안심", "원인", "때문", "진단", "염증", "감염",
    "흔한", "흔히", "흔합", "자연스러", "일시적", "대부분", "좋아지", "좋아질", "나아지", "나아질", "가라앉", "회복",
    "세요", "십시오", "하셔야", "드셔야", "해야", "필요", "권해", "권합", "추천", "복용", "보입니다", "같습니다", "듯합니다", "추정", "의심", "가능성",
    "된다고", "돼도", "되어도", "해도\\s*된", "도\\s*(?:된|돼|되(?!는지)|될(?!지))", "(?:^|\\s)안\\s+\\S*도(?=\\s|$)", "먹어도", "끊어도", "발라", "바르",
  ].join("|"),
  "gu",
);

/** 되짚기에 쓸 수 없는 용량(수 + mg·알·정·캡슐·포·방울). 약 이름은 약 말 검사가, 용량은 여기서 막는다. */
const RECAP_DOSE = /(?:\d\s*|(?<![가-힣])(?:반|한|두|세|네|다섯|여섯|일곱|여덟|아홉|열)\s+)(?:mg|㎎|밀리|알|정(?![도상말])|캡슐|포|방울)/iu;
/** 되짚기에 쓸 수 없는 금액(수 + 원·만·천, 한자어 수 + 원). 문의 속 금액이 틀렸을 수 있고, 금액은 가격표 칸으로만 나간다. */
const RECAP_MONEY = /\d\s*(?:만|천|원)|(?<![가-힣])(?:[일이삼사오육칠팔구]?[십백천만억])+\s*원/u;

/** 되짚기 안의 말에서 떼어 내는 조사·어미(긴 것부터, 두 번까지). 떼고 남은 줄기가 문의에 있는지 본다. */
const RECAP_SUFFIXES = [
  "느냐고", "이라고", "는다고", "냐고", "다고", "라고", "는지", "인지", "은지", "에서", "에게", "께서", "으로", "부터", "까지", "처럼", "이랑", "하고",
  "인데", "는데", "은데", "지만", "면서", "이", "가", "은", "는", "을", "를", "에", "로", "와", "과", "도", "만", "의", "고", "서", "며", "요", "분", "님",
].sort((a, b) => b.length - a.length);

/**
 * 이 어미로 끝난 말은 풀이말(동사·형용사)로 본다. 풀이말은 되짚기에서 어미가 바뀌기 쉽다("나와요" → "나온다고", "보낼게요" → "보내겠다고",
 * "예약했는데요" → "예약하셨고"). '이라고'·'인지'·'인데'는 이름씨 뒤에 붙는 말이라 넣지 않는다("감기인지", "9일째인데").
 */
const RECAP_VERBAL_ENDINGS = new Set(["느냐고", "는다고", "냐고", "다고", "라고", "는지", "은지", "는데", "은데", "지만", "면서", "고", "서", "며"]);

/** 되짚기에 문의에 없어도 되는 말(이음말·의존 명사). 새 사실을 담지 않는다. '뒤'는 "술을 조금 마신 뒤"처럼 때를 잇는 말이다. */
const RECAP_STOPWORDS = new Set(["그리고", "또", "또한", "및", "함께", "것", "등", "때", "뒤"]);
/** 되짚기에 문의에 없어도 되는 이음 풀이말("…라고 하시며", "…하셨고"). 무엇을 했는지는 담지 않는다. */
const RECAP_LINKING_VERB = /^(?:하시|하셨|하신)/u;

/** 되짚기 비교용: 한글로 쓴 수를 숫자로 바꾸고(열흘 → 10일), 흔한 준말을 맞추고(되었 → 됐, 하였 → 했), 글자·숫자만 남긴다. */
function recapLetters(s: string): string {
  return koreanNumeralsToDigits(s.normalize("NFKC"))
    .replace(/되었/g, "됐")
    .replace(/되어/g, "돼")
    .replace(/하였/g, "했")
    .replace(/하여/g, "해")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

/**
 * 활용으로 바뀌어도 같은 말로 볼 자모 앞부분의 길이. 끝 음절의 모음·받침(자모 둘)까지는 바뀔 수 있다고 보되, 적어도 자모의 60%는 같아야 한다
 * ("나온" ↔ '나와'는 앞 3자모 'ㄴㅏㅇ', "아프" ↔ '아파'는 'ㅇㅏㅍ'). 두 음절 명사는 첫 음절만으로는 모자란다("이마" ↔ '이식' 아님).
 */
function jamoPrefixNeed(jamo: string): number {
  return Math.max(jamo.length - 2, Math.ceil(jamo.length * 0.6));
}

/** 받침 ㄴ·ㄹ(조합형 자모). 한 음절 풀이말의 이 받침은 어미 조각일 수 있다("난다고"의 'ㄴ', "달라고"의 'ㄹ'). */
const CODA_N = "ᆫ";
const CODA_L = "ᆯ";

/**
 * 말 줄기가 글(문의 전체나 절 하나)에 있나. 글자 그대로 있으면 있음. 없으면 자모로 풀어 앞부분이 있는지 본다.
 * - 한 음절 줄기: 글자 그대로만. 예외는 받침이 ㄴ·ㄹ인 풀이말("난다고" → '나요', "찬다고" → '차진') — 초성·중성만 본다.
 *   2026-09-30 검증: 한 음절 풀이말을 자모 둘로 맞추면 "뜨겁지 않다고"의 '않'이 문의의 '아파'와 맞았다.
 * - 이름씨 쪽(풀이말 어미가 아닌 말): 앞부분 jamoPrefixNeed("부었" ↔ '부어'). 새 명사("뒷머리", "이마")는 걸린다.
 * - 풀이말(RECAP_VERBAL_ENDINGS로 끝난 말): 첫 음절과 다음 음절의 첫 자음까지("보내겠다고"의 '보ㄴ' ↔ '보낼게요', "나온다고"의 '나ㅇ' ↔ '나와요').
 * 넓게 봐서 생기는 구멍(우연히 앞 음절만 같은 말)은 증상·약 말 대조·숫자 대조·부정 말 대조가 일부 막고, 나머지는 의료진 확인이 본다.
 */
function stemIn(stem: string, verbal: boolean, letters: string, jamoText: string): boolean {
  if (letters.includes(stem)) return true;
  const jamo = stem.normalize("NFD");
  const syllables = [...stem];
  if (syllables.length === 1) {
    const coda = jamo.length === 3 ? jamo[2] : "";
    return verbal && (coda === CODA_N || coda === CODA_L) && jamoText.includes(jamo.slice(0, 2));
  }
  const need = verbal ? syllables[0].normalize("NFD").length + 1 : jamoPrefixNeed(jamo);
  return jamoText.includes(jamo.slice(0, need));
}

/**
 * 되짚기의 증상 말 w가 목록 words 중 하나와 같은 말인가. 같은 글자이거나 활용 차이만 있어야 한다:
 * 첫 음절이 같고 둘째 음절 초성이 같거나("아프" ↔ "아파", "부었" ↔ "부어"), 첫 음절 받침만 다른 불규칙 활용("붓고" ↔ "부어"). 글자 수 차이는 한 자까지 —
 * "피가" ↔ "피가 안 멈"은 다른 말이다(부정이 든 증상 말을 빼고 되짚지 못하게). "통증" ↔ "아파", "고름" ↔ "고여"도 다른 말로 본다(과하게 막는 쪽).
 */
function sameSymptomWord(w: string, words: readonly string[]): boolean {
  const a = [...recapLetters(w)].map((ch) => ch.normalize("NFD"));
  return words.some((v) => {
    const b = [...recapLetters(v)].map((ch) => ch.normalize("NFD"));
    if (a.join("") === b.join("")) return true;
    if (a.length === 0 || b.length === 0 || Math.abs(a.length - b.length) > 1) return false;
    if (a[0] === b[0]) return a.length === 1 || b.length === 1 || a[1][0] === b[1][0];
    return a[0].slice(0, 2) === b[0].slice(0, 2) && (a[0].length === 2 || b[0].length === 2);
  });
}

/** 따로 쓴 부정 말. */
const NEG_STANDALONE = new Set(["안", "못"]);
/** 말 안의 부정(…지 않·…지 못·없·아니). 부정 말 자체로 시작하는 말("않아요", "없는데")도 부정 말로 센다. */
const NEG_IN_WORD = /않|없|못|아니|아닌/gu;
const NEG_START = /^(?:않|없|못|아니|아닌)/u;

function negationCount(words: readonly string[]): number {
  let n = 0;
  for (const w of words) {
    const l = recapLetters(w);
    n += NEG_STANDALONE.has(l) ? 1 : (l.match(NEG_IN_WORD) ?? []).length;
  }
  return n;
}

const isNegationWord = (letters: string) => NEG_STANDALONE.has(letters) || NEG_START.test(letters);

/** words[i]가 부정됐나: 앞말이 '안'·'못'이거나, 말 안(첫 글자 뒤)에 않·없·못이 있거나, 뒷말이 않·없·못·아니로 시작한다("차진 않아요"). */
function negatedAt(words: readonly string[], i: number): boolean {
  const l = (j: number) => (j >= 0 && j < words.length ? recapLetters(words[j]) : "");
  return NEG_STANDALONE.has(l(i - 1)) || /않|없|못|아니|아닌/u.test(l(i).slice(1)) || NEG_START.test(l(i + 1));
}

interface RecapWord {
  index: number;
  word: string;
  stems: string[];
  verbal: boolean;
}

/** 되짚기 본문의 내용어. 말 그대로, 조사·어미를 하나 뗀 것, 둘 뗀 것("닫았는지와" → "닫았는지" → "닫았")을 줄기 후보로 둔다. */
function recapWords(words: readonly string[]): RecapWord[] {
  const out: RecapWord[] = [];
  words.forEach((word, index) => {
    const letters = recapLetters(word);
    if (letters === "" || RECAP_STOPWORDS.has(letters) || RECAP_LINKING_VERB.test(letters)) return;
    const stems = [letters];
    let verbal = false;
    for (let i = 0; i < 2; i++) {
      const cur = stems[stems.length - 1];
      const suffix = RECAP_SUFFIXES.find((x) => cur.length > x.length && cur.endsWith(x));
      if (!suffix) break;
      if (i === 0) verbal = RECAP_VERBAL_ENDINGS.has(suffix);
      stems.push(cur.slice(0, -suffix.length));
    }
    if (stems.some((st) => RECAP_STOPWORDS.has(st))) return;
    out.push({ index, word, stems, verbal });
  });
  return out;
}

const foundIn = (w: RecapWord, letters: string, jamo: string) => w.stems.some((st) => stemIn(st, w.verbal, letters, jamo));

/**
 * 인계 초안의 되짚기 문장 검사(2026-09-30 오너 두 번째 결정, 같은 날 적대 검증 반영). 인용 없이 받는 유일한 문장이라 코드로 본다.
 * 문제마다 한 줄씩 돌려주고, 비면 받는다.
 * 1. 한 문장, "…말씀 주셨습니다"·"…문의 주셨습니다" 같은 확인 어미(RECAP_ENDING).
 * 2. 판단·권유·지시·허락 말(RECAP_BANNED), 용량(RECAP_DOSE), 금액(RECAP_MONEY), 자리표시자·볼트 링크가 없다.
 * 3. 약 말(V17 terms)이 없다 — 문의에 같은 약 말이 있어도. 되짚기의 예외는 증상 말뿐이다.
 * 4. 숫자(경과일·체온 등, 한글로 쓴 수 포함)가 모두 문의에 있다.
 * 5. 증상 말(V11)이 모두 문의에서도 걸리는 말이고(활용 차이만 허용 — sameSymptomWord), 문의의 적신호 증상(V11 symptoms·체온)은 늘 모두 담고,
 *    그 밖의 증상 말은 하나라도 쓰면 모두 담는다(적신호를 빼고 되짚지 않게 — "숨이 차고 피곤해요" → "피곤하다고"는 보류).
 * 6. 내용어마다 조사·어미를 뗀 줄기가 문의에 있다(stemIn).
 * 7. 부정 말(안·않·못·없·아니): 되짚기에 문의보다 많지 않고, 내용어마다 문의의 그 말과 부정 여부가 같다("피가 안 멈춰요" → "피가 멈춘다고",
 *    "숨이 차진 않아요" → "숨이 찬다고", "뜨겁고" → "뜨겁지 않다고"는 보류).
 * 8. 문의의 물음 절(core/clauses.ts)에만 있는 말을 되짚으면 "…는지 문의 주셨습니다" 꼴이어야 한다.
 * 못 하는 것: 문의의 말만 다시 엮어 뜻을 바꾸는 것(말 순서·수식 관계 바꾸기)은 다 막지 못한다 — 의료진이 확인한 뒤에만 보낸다.
 * @param maskedInquiry 가림 뒤 문의 원문(모델이 받은 글).
 */
export function checkRecapSentence(sentence: string, maskedInquiry: string, g: Pick<HandoverGuard, "medication" | "redflag">): string[] {
  const problems: string[] = [];
  const text = sentence.normalize("NFKC").trim();
  const parts = text.split(/(?<=[.!?。])\s+|\n+/).filter((x) => x.trim() !== "");
  if (parts.length > 1) problems.push(`한 문장이 아닙니다(${parts.length}문장)`);
  const ending = RECAP_ENDING.exec(text);
  if (!ending) problems.push("'…말씀 주셨습니다'·'…문의 주셨습니다' 같은 확인 어미로 끝나지 않습니다");
  const banned = [...new Set([...text.matchAll(RECAP_BANNED)].map((m) => m[0].trim()))];
  if (banned.length > 0) problems.push(`판단·권유·지시·허락 말(${banned.map((b) => `"${b}"`).join(", ")})이 있습니다`);
  const dose = RECAP_DOSE.exec(text)?.[0];
  if (dose) problems.push(`용량("${dose}")을 되짚을 수 없습니다`);
  const money = RECAP_MONEY.exec(text)?.[0];
  if (money) problems.push(`금액("${money}")을 되짚을 수 없습니다(금액은 가격표 칸으로만)`);
  if (/\{\{|\[\[/.test(text)) problems.push("가격·시간 칸이나 문서 링크가 있습니다");
  const inquiryNumbers = new Set(numbersIn(maskedInquiry));
  const newNumbers = [...new Set(numbersIn(text))].filter((n) => !inquiryNumbers.has(n));
  if (newNumbers.length > 0) problems.push(`문의에 없는 숫자(${newNumbers.join(", ")})가 있습니다`);
  const meds = checkMedication(text, g.medication).matchedTerms;
  if (meds.length > 0) problems.push(`약 말(${meds.join(", ")})은 되짚기에도 쓸 수 없습니다`);
  const inquiryRf = checkRedflags(maskedInquiry, g.redflag);
  const recapRf = checkRedflags(text, g.redflag);
  const inquirySymptoms = [...new Set([...inquiryRf.matchedSymptoms, ...inquiryRf.matchedAmbiguous])];
  const recapSymptoms = [...new Set([...recapRf.matchedSymptoms, ...recapRf.matchedAmbiguous])];
  const newSymptoms = recapSymptoms.filter((w) => !sameSymptomWord(w, inquirySymptoms));
  if (newSymptoms.length > 0) problems.push(`문의에 없는 증상 말(${newSymptoms.join(", ")})이 있습니다`);
  // 적신호 증상(V11 symptoms·체온)은 되짚기를 쓰면 늘 모두 담는다. 그 밖의 증상 말(ambiguous)은 하나라도 되짚으면 모두 담는다.
  const required = recapSymptoms.length > 0 ? inquirySymptoms : [...new Set(inquiryRf.matchedSymptoms)];
  // 담았나: 같은 증상 말이 걸렸거나, 되짚기 글에 그 말이 끝 자모 하나만 다르게 들어 있다("안 멈춰" ↔ "안 멈춘다고").
  const recapJamo = recapLetters(text).normalize("NFD");
  const covered = (w: string) => {
    const j = recapLetters(w).normalize("NFD");
    return sameSymptomWord(w, recapSymptoms) || (j.length > 1 && recapJamo.includes(j.slice(0, j.length - 1)));
  };
  const dropped = required.filter((w) => !covered(w));
  if (dropped.length > 0) {
    problems.push(`문의의 증상 말(${dropped.join(", ")})을 빼고 되짚었습니다(적신호 증상은 늘, 그 밖의 증상은 하나라도 되짚으면 모두 되짚습니다)`);
  }

  const body = ending ? text.slice(0, ending.index) : text;
  if (body.replace(/[^\p{L}\p{N}]/gu, "") === "") problems.push("되짚는 내용이 없습니다");
  const words = body.split(/\s+/).filter((w) => w !== "");
  const content = recapWords(words);
  const inquiryLetters = recapLetters(maskedInquiry);
  const inquiryJamo = inquiryLetters.normalize("NFD");
  const missing = content.filter((w) => !foundIn(w, inquiryLetters, inquiryJamo)).map((w) => w.word);
  if (missing.length > 0) problems.push(`문의에 없는 말(${missing.join(", ")})이 있습니다`);

  // 부정 말: 개수와, 내용어마다 문의의 그 말과 부정 여부.
  const inquiryWords = maskedInquiry.normalize("NFKC").split(/\s+/).filter((w) => w !== "");
  if (negationCount(words) > negationCount(inquiryWords)) problems.push("문의에 없는 부정 말(안·않·못·없)이 있습니다");
  const flipped: string[] = [];
  for (const w of content) {
    if (isNegationWord(recapLetters(w.word))) continue;
    const occ = inquiryWords.flatMap((iw, j) => {
      const l = recapLetters(iw);
      return foundIn(w, l, l.normalize("NFD")) ? [j] : [];
    });
    if (occ.length > 0 && !occ.some((j) => negatedAt(inquiryWords, j) === negatedAt(words, w.index))) flipped.push(w.word);
  }
  if (flipped.length > 0) problems.push(`부정 말(안·않·못·없)이 문의와 다릅니다(${flipped.join(", ")})`);

  // 물음 절에만 있는 말을 되짚으면 "…는지 문의 주셨습니다" 꼴이어야 한다.
  const clauses = inquiryClauses(maskedInquiry).map((c) => {
    const letters = recapLetters(c.text);
    return { question: c.question, letters, jamo: letters.normalize("NFD") };
  });
  const asked = content.filter((w) => {
    const where = clauses.filter((c) => foundIn(w, c.letters, c.jamo));
    return where.length > 0 && where.every((c) => c.question);
  });
  const questionForm = ending?.[1] === "문의" && /지(?:를)?$/u.test(recapLetters(words.at(-1) ?? ""));
  if (asked.length > 0 && !questionForm) {
    problems.push(`환자의 물음(${asked.map((w) => w.word).join(", ")})은 '…는지 문의 주셨습니다' 꼴로만 되짚습니다`);
  }
  return problems;
}

// ─── 인용 문장 ───────────────────────────────────────────────────────────

/**
 * 되짚기·승인 문구 밖 문장에 있으면 안 되는 판단·지시 말. 되짚기 목록(RECAP_BANNED)보다 좁다 — 인용 문장은 병원 문서의 글이라
 * '진단'(가격표 "정밀 진단은 …원")·'필요' 같은 말까지 막으면 답할 수 있는 행정 안내가 보류된다. 지금 인계 발췌 문단의 인용할 문장에는 이 말이 없다.
 * 인용 문장을 글자 그대로 옮기게 하는 검사(quotesSourceVerbatim)가 먼저 막지만, 이음말·승인 문구 사이에 끼운 말을 한 번 더 본다.
 */
const HANDOVER_REST_BANNED =
  /괜찮|정상|문제\s*(?:없|되지|가\s*없)|걱정\s*(?:마|하지\s*마)|안심|원인|때문|염증|감염|흔한|흔히|흔하|흔합|자연스러|일시적|좋아지|좋아질|나아지|나아질|세요|십시오|하셔야|해야|마요|돼요|되요|그럴\s*수|생길\s*수/u;

/** 가격 칸 밖에 숫자로 쓴 금액("50,000원", "3만 원", "삼만원"). 인계 초안의 금액은 가격표 칸({{price:…}})으로만 나간다. */
const AMOUNT_TEXT = /\d[\d,]*\s*(?:만\s*|천\s*)?원|(?<![가-힣])(?:[일이삼사오육칠팔구]?[십백천만억])+\s*원/u;

/** 인용 문장 앞에 붙여도 되는 이음말(인계 초안). 예/아니요("네,"·"아니요,")는 의료 물음의 답처럼 읽혀 받지 않는다. */
const HANDOVER_CONNECTORS = ["또한", "그리고", "참고로", "아울러", "다만", "또"];
/** 인계 초안에서 받는 진료시간 문장 하나(인용한 문장 안에서만). 주어를 고정해 "바로 오시면 되는 시간은 {{hours}}"를 막는다. */
const HOURS_FRAME = /^진료시간은¶(?:입니다|이에요|예요)$/u;

/** 대조용 글자: 가격 칸은 §, 진료시간 칸은 ¶, 그 밖의 칸은 ¤로 두고 글자·숫자만 남긴다. */
function verbatimLetters(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/\{\{\s*price:[^{}]*\}\}/g, "§")
    .replace(/\{\{\s*hours\s*\}\}/g, "¶")
    .replace(/\{\{[^{}]*\}\}/g, "¤")
    .replace(/[^\p{L}\p{N}§¶¤]/gu, "");
}

/**
 * 인용 문장이 인용한 원문의 문장(이어진 문장 여럿도 됨)을 공백·문장부호만 빼고 글자 그대로 옮겼나(2026-09-30 적대 검증 — 겹침 비율 0.25만 넘으면
 * 치료 지시·판단·반대 안내를 끼워 바꿔 쓴 문장이 통과했다). 예외: 가격 칸은 원문의 금액("80,000원") 자리에만, 앞에 HANDOVER_CONNECTORS 하나,
 * 진료시간은 HOURS_FRAME 한 문장. 가격 칸이 맞는 항목인지는 가격 칸 대조(core/pricecheck.ts)가 따로 본다.
 */
export function quotesSourceVerbatim(s: Pick<SentenceReport, "text" | "citations">): boolean {
  const claim = verbatimLetters(s.text);
  if (HOURS_FRAME.test(claim)) return true;
  if (/[¶¤]/u.test(claim)) return false;
  const sources = s.citations
    .flatMap((c) => c.citedText.normalize("NFKC").split(/(?<=[.!?。])\s+|\n+/))
    .map((x) => x.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter((x) => x !== "");
  for (const pre of ["", ...HANDOVER_CONNECTORS]) {
    if (!claim.startsWith(pre) || claim.length === pre.length) continue;
    const re = new RegExp(`^${claim.slice(pre.length).split("§").map((part) => [...part].map(escapeRe).join("")).join("\\d+원")}$`, "u");
    for (let i = 0; i < sources.length; i++) {
      let run = "";
      for (let j = i; j < sources.length; j++) {
        run += sources[j];
        if (re.test(run)) return true;
      }
    }
  }
  return false;
}

/**
 * 인계 초안(handover)의 코드 검사. 인용 검증을 통과한 초안에만 돌고, 하나라도 걸리면 보류로 바꾼다. 인용은 문단(블록) 단위라
 * "그 문단을 인용했나"만으로는 문단의 어느 문장을 썼는지 모른다 — 그래서 문장을 본다.
 * 1. handover-no-fixed-message: 고정 안내 문단을 인용한 문장이 없거나, 승인 문구(따옴표 안 문장) 전체가 글자 그대로 들어 있지 않다(공백·문장부호만 무시).
 * 2. handover-recap: 되짚기 문장(인용 검증이 맨 앞 한 문장에만 붙이는 kind "recap")이 checkRecapSentence를 통과하지 못했거나, 맨 앞이 아니거나 둘 이상이다.
 * 3. handover-staff-text: 고정 안내 문단을 인용한 문장에 승인 문구 문장이 없거나 승인 문구 밖 글자가 **하나라도** 있다(따옴표 밖 직원 지시,
 *    "아니요, "·" 기다려 보세요." 같은 이음말·꼬리 — 이음말 상한 6자도 여기서는 받지 않는다), 또는 어느 문장에든 '직원'이 있다.
 * 4. handover-not-verbatim: 되짚기가 아닌데 인용이 없는 문장(자리표시자 문장 포함 — 인계 초안은 인용 없는 자리표시자 문장을 받지 않는다),
 *    또는 인용 문장이 인용한 원문 문장을 글자 그대로 옮기지 않았다(quotesSourceVerbatim).
 * 5. handover-link: 문서 링크([[…]])가 든 문장. 인계 발췌의 링크는 모두 수술 후 관리·두피 주사·두피 관리처럼 증상 문의에 쓰지 않는 문서를 가리킨다.
 * 6. handover-amount: 되짚기가 아닌 문장에 가격 칸 밖 금액을 숫자로 썼다(항목을 바꿔 쓴 "첫 상담비는 50,000원" 같은 문장).
 * 7. handover-medical-words: 되짚기가 아닌 문장에서 승인 문구를 지운 나머지 글에 약 말(V17 terms) 또는 증상 말(V11 symptoms·ambiguous, 체온 숫자)이 있다.
 * 8. handover-judgment-words: 되짚기가 아닌 문장의 승인 문구 밖 글에 판단·지시 말(HANDOVER_REST_BANNED)이 있다.
 * 섞인 의료가 아닌 물음의 답은 위 4·6과 인용 대조·숫자 대조·가격 칸 대조(generateDraft)로 본다.
 * 통과하면 보낼 글(finalText)에서 승인 문구를 감싼 따옴표를 뺀다(core/knowledge.ts unquoteFixedMessage). 모델 글(modelText)·문장은 그대로 둔다.
 * 못 하는 것: 문서 문장을 글자 그대로 옮겼지만 문의와 상관없는 문장(묻지 않은 예약 규정 등)은 막지 못한다. 그래서 의료진이 확인해야 보낸다.
 */
export function checkHandoverDraft(draft: DraftResult, g: HandoverGuard): DraftResult {
  if (draft.status !== "ok") return draft;
  const hold = (holdReasons: DraftResult["holdReasons"]): DraftResult => ({ ...draft, status: "hold", finalText: null, holdReasons });
  const citesFixed = (s: SentenceReport) => s.citations.some((c) => c.chunkIds.includes(g.fixedChunkId));
  if (!draft.sentences.some(citesFixed)) {
    return hold([{ code: "handover-no-fixed-message", detail: `의료진이 확인한 뒤 연락한다는 고정 안내 문단(${g.fixedChunkId})을 인용하지 않았습니다` }]);
  }
  if (!lettersDigits(draft.finalText ?? draft.modelText).includes(lettersDigits(g.fixedMessage))) {
    return hold([{ code: "handover-no-fixed-message", detail: `승인 문구 전체가 그대로 들어 있지 않습니다(빠지거나 바뀐 문장이 있음): "${g.fixedMessage}"` }]);
  }
  const patterns = messageSentencePatterns(g.fixedMessage);
  const reasons: DraftResult["holdReasons"] = [];
  const recaps = draft.sentences.filter((s) => s.kind === "recap");
  for (const s of recaps) {
    const problems = [
      ...(s.index !== 0 ? ["초안 맨 앞 문장이 아닙니다"] : []),
      ...(recaps.length > 1 ? [`되짚기 문장이 ${recaps.length}개입니다(한 문장만)`] : []),
      ...checkRecapSentence(s.text, g.maskedText, g),
    ];
    if (problems.length > 0) reasons.push({ code: "handover-recap", detail: `되짚기 문장으로 받을 수 없습니다(${problems.join("; ")}): "${s.text}"` });
  }
  for (const s of draft.sentences) {
    const text = s.text.normalize("NFKC");
    if (s.kind === "template" || s.kind === "uncited") {
      reasons.push({ code: "handover-not-verbatim", detail: `인용 없는 문장입니다(인계 초안에서 인용 없이 받는 문장은 맨 앞 되짚기 하나뿐): "${s.text}"` });
    }
    if (/\[\[/.test(text)) reasons.push({ code: "handover-link", detail: `문서 링크가 든 문장입니다(인계 초안에는 다른 문서를 안내하지 않습니다): "${s.text}"` });
    let rest = text;
    for (const re of patterns) rest = rest.replace(re, " ");
    const restLetters = lettersDigits(rest.replace(/\{\{[^{}]*\}\}/g, " "));
    let staff = false;
    if (s.kind === "cited" && citesFixed(s)) {
      if (!patterns.some((re) => text.search(re) >= 0) || restLetters !== "") {
        staff = true;
        reasons.push({ code: "handover-staff-text", detail: `고정 안내 문단을 인용한 문장에는 승인 문구(따옴표 안) 문장만 씁니다 — 그 밖의 말이 있습니다: "${s.text}"` });
      }
    } else if (s.kind === "cited" && !quotesSourceVerbatim(s)) {
      reasons.push({ code: "handover-not-verbatim", detail: `인용한 원문 문장을 글자 그대로 옮기지 않았습니다(바꿔 쓰거나 말을 끼움): "${s.text}"` });
    }
    if (!staff && rest.includes("직원")) reasons.push({ code: "handover-staff-text", detail: `직원에게 하는 말이 들어 있습니다: "${s.text}"` });
    // 되짚기는 checkRecapSentence가, 허용 인사·맺음(V13 — 병원이 정한 문장, "안녕하세요"의 '세요')은 검사하지 않는다.
    if (s.kind === "recap" || s.kind === "allowlisted") continue;
    if (AMOUNT_TEXT.test(text.replace(/\{\{[^{}]*\}\}/g, " "))) {
      reasons.push({ code: "handover-amount", detail: `금액을 가격 칸({{price:…}}) 밖에 숫자로 썼습니다: "${s.text}"` });
    }
    const rf = checkRedflags(rest, g.redflag);
    const words = [...new Set([...checkMedication(rest, g.medication).matchedTerms, ...rf.matchedSymptoms, ...rf.matchedAmbiguous])];
    if (words.length > 0) {
      reasons.push({ code: "handover-medical-words", detail: `되짚기·승인 문구 밖 문장에 약·증상 말(${words.join(", ")})이 있습니다: "${s.text}"` });
    }
    const judgment = HANDOVER_REST_BANNED.exec(rest)?.[0];
    if (judgment) reasons.push({ code: "handover-judgment-words", detail: `되짚기·승인 문구 밖 문장에 판단·지시 말("${judgment}")이 있습니다: "${s.text}"` });
  }
  if (reasons.length > 0) return hold(reasons);
  const finalText = draft.finalText === null ? null : unquoteFixedMessage(draft.finalText, g.fixedMessage);
  return finalText === draft.finalText ? draft : { ...draft, finalText };
}
