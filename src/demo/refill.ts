/**
 * 녹화된 초안을 **지금 코드로 다시 채운다**(가격·시간 칸, 볼트 링크, 조사).
 *
 * 왜: 녹화 파일(data/demo-responses.json)은 finalText·fills를 녹화 때 계산해 저장한다. 채움 규칙(단위 겹침, 조사, 링크)을
 * 고친 뒤에도 화면이 녹화 때 글을 보이면 이미 고친 결함("모당 2,000원/모")이 시연에 그대로 나온다. 녹화는 모델 호출이
 * 필요해 다시 만들 수 없으므로, 모델이 쓴 글(modelText — 자리표시자·링크 그대로)만 녹화에서 가져오고 채우기는 화면에서 다시 한다.
 *
 * 거짓이 없는 이유:
 * - 모델이 쓴 말은 한 글자도 바꾸지 않는다. 바뀌는 것은 코드가 넣는 값(가격표·진료시간·문서 제목)과 그 뒤 조사뿐이다.
 * - 인용 검증은 녹화 때 modelText로 끝났다. 채우기는 검증 뒤 단계라(src/llm/draft.ts와 같은 순서) 검증 결과가 바뀌지 않는다.
 * - 녹화 때 글과 다르면 화면이 "지금 코드로 다시 채움"이라고 적고 녹화 때 글을 함께 보인다.
 * - 다시 채우지 못하면(녹화 뒤 가격표 키가 사라지는 등) 보낼 글을 만들지 않는다. 지금 가격표 금액이 인용한 원문 문장의 금액과
 *   어긋나도(녹화 뒤 json 값만 바뀜) 만들지 않는다 — 초안 생성과 같은 가격 칸 대조(core/pricecheck.ts)다. 번들 생성의 녹화 뒤 바뀜 검사(drift.ts)도
 *   같은 함수로 이 경우를 잡는다. 채운 글이 녹화 때와 다른 것 자체는 '바뀜'이 아니다 — 입력(가린 글·검색·인용 문단)이 같기 때문이다.
 *
 * 번들 생성 때 계산해 넣지 않고 화면에서 계산하는 이유는 bundle.ts와 같다: 브라우저가 같은 볼트 원문으로 같은 코어 함수를
 * 돌리면 두 번째 사본이 생기지 않는다.
 */

import { checkAdExpressions, type AdCheckResult } from "../core/adcheck";
import type { Knowledge } from "../core/knowledge";
import { checkPriceCitations } from "../core/pricecheck";
import { composeOutgoing, type Fill, type OutgoingPart, type OutgoingResult } from "../core/template";
import type { DraftResult } from "../llm/draft";

export type DraftMode = "reply" | "staff-qa";

/** src/llm/draft.ts generateDraft가 보낼 글을 만드는 것과 같은 호출. */
export type RefillKnowledge = Pick<Knowledge, "prices" | "hours" | "linkTitles" | "approvedLinks">;

export function recompose(k: RefillKnowledge, modelText: string, mode: DraftMode): OutgoingResult {
  return composeOutgoing(modelText, {
    prices: k.prices,
    hours: k.hours,
    links: { titles: k.linkTitles, audience: mode === "reply" ? "patient" : "staff", approved: k.approvedLinks },
  });
}

export interface DraftDisplay {
  /** 지금 코드로 채운 보낼 글. 보류 초안이거나 다시 채우지 못하면 null. */
  text: string | null;
  fills: Fill[];
  /** 문장 번호 → 화면에 그릴 조각(값 칸은 fill이 있다). */
  sentenceParts: Map<number, OutgoingPart[]>;
  /** 녹화 때 저장한 글. */
  recordedText: string | null;
  /** 지금 채운 글이 녹화 때 글과 다른가(화면에 "지금 코드로 다시 채움"을 적는다). */
  refilled: boolean;
  /** 다시 채우지 못한 이유. 있으면 보낼 글이 없다. */
  errors: string[];
  /** 환자 답장에서 문서 제목으로 바꿔 넣은 링크의 제목(환자가 열 수 없는 문서라 보내는 직원이 볼 곳). */
  patientLinkTitles: string[];
  adcheck: AdCheckResult | null;
}

export function draftDisplay(k: RefillKnowledge & Pick<Knowledge, "ad">, draft: DraftResult, mode: DraftMode): DraftDisplay {
  const sentenceParts = new Map<number, OutgoingPart[]>();
  for (const s of draft.sentences) {
    // 문장 하나씩 채워도 전체를 채운 것과 같다: 단위는 같은 절 안에서만, 조사는 값 바로 뒤만 보기 때문이다.
    const r = recompose(k, s.text, mode);
    sentenceParts.set(s.index, r.ok ? r.parts : [{ text: s.text, fill: null }]);
  }
  const base = { sentenceParts, recordedText: draft.finalText };
  if (draft.status !== "ok") {
    return { ...base, text: null, fills: draft.fills, refilled: false, errors: [], patientLinkTitles: [], adcheck: draft.adcheck };
  }
  const r = recompose(k, draft.modelText, mode);
  if (!r.ok) return { ...base, text: null, fills: [], refilled: false, errors: r.errors, patientLinkTitles: [], adcheck: draft.adcheck };
  const priceProblems = checkPriceCitations(draft.sentences, k.prices);
  if (priceProblems.length > 0) {
    return { ...base, text: null, fills: [], refilled: false, errors: priceProblems.map((p) => p.detail), patientLinkTitles: [], adcheck: draft.adcheck };
  }
  const titles = mode === "reply" ? [...new Set(r.links.map((f) => k.linkTitles.get(f) ?? f))] : [];
  return {
    ...base,
    text: r.text,
    fills: r.fills,
    refilled: r.text !== draft.finalText,
    errors: [],
    patientLinkTitles: titles,
    adcheck: checkAdExpressions(r.text, k.ad),
  };
}
