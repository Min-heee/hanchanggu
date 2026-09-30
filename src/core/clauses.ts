/**
 * 문의를 절로 나누고 물음 절을 가린다. 인계 초안의 두 곳이 같은 규칙을 쓴다:
 * - 인계 발췌(core/retrieve.ts retrieveForHandover): 행정 안내 문단은 물음 절에 의료가 아닌 물음의 말(얼마·예약·반품 등)이 있을 때만 더한다.
 * - 되짚기 검사(src/llm/handover-check.ts checkRecapSentence): 물음 절에만 있는 말을 되짚으면 "…는지 문의 주셨습니다" 꼴이어야 한다
 *   (환자의 물음이 병원의 허락처럼 읽히지 않게 — "헬스장 가도 된다고 말씀 주셨습니다").
 *
 * 절 나누기: 문장(. ! ? 뒤 공백, 줄바꿈)으로 나눈 뒤, 문장 안에서 이음 어미("…는데 ", "…인데 ", "…어서 ", 쉼표 뒤 공백)로 한 번 더 나눈다.
 * 물음 문장("?"가 있거나 "…나요/까요/죠"로 끝나거나 "…는지도 물음"·"알려 주세요"·"궁금")에서는 **마지막 절만** 물음으로 본다 —
 * "수술 9일째인데 고름이 나오는데 괜찮나요?"의 앞 두 절은 환자가 적은 사실이다.
 * 목록은 과하게 물음으로 보는 쪽으로 틀린다(되짚기는 물음 꼴을 강요받고, 행정 안내 문단이 더 붙을 뿐 — 둘 다 의료진이 확인한 뒤에만 나간다).
 */

export interface InquiryClause {
  text: string;
  question: boolean;
}

/**
 * 물음 문장. '…나요'는 앞 글자에 붙은 것만("되나요", "괜찮나요") — 띄어 쓴 "냄새가 나요"는 '나다'의 평서문이다. '…가요'도 "병원에 가요"와 갈리지 않아
 * 넣지 않는다("이런가요?"는 물음표로 잡힌다).
 */
const QUESTION_SENTENCE = /\?|(?:[가-힣]나요|까요|죠|는지요|되나|될까|을까)\s*[ㅠㅜ~.!]*$|(?:는지|은지|인지)도?\s*(?:물음|물어|묻|문의)|알려\s*(?:주|줘)|궁금/u;
const CLAUSE_BREAK = /(?<=(?:는데|은데|인데|던데|는데요|인데요|어서|아서|해서),?)\s+|(?<=,)\s+/u;

export function inquiryClauses(text: string): InquiryClause[] {
  const out: InquiryClause[] = [];
  for (const sentence of text.normalize("NFKC").split(/(?<=[.!?。])\s+|\n+/)) {
    const s = sentence.trim();
    if (s === "") continue;
    const question = QUESTION_SENTENCE.test(s);
    const parts = s
      .split(CLAUSE_BREAK)
      .map((p) => p.trim())
      .filter((p) => p !== "");
    parts.forEach((p, i) => out.push({ text: p, question: question && i === parts.length - 1 }));
  }
  return out;
}
