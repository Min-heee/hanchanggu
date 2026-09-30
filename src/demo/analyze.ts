/**
 * 문의 한 건(또는 '직접 해 보기' 입력)을 브라우저에서 규칙·검색 단계까지 돌린다. 키 없이 돈다.
 *
 *   가림(F10) → 게이트(F5) → 경과일(F17) → ① 검색 → ② 발췌
 *
 * ③ 생성·④ 검증은 모델이 필요하므로 여기서 하지 않는다. 녹화가 있으면 화면이 녹화를 붙인다.
 * 녹화 스크립트와 같은 함수(decideRoute, readPostopDay, retrieve, groupHitsByDoc)를 부르므로
 * 화면에서 본 발췌가 녹화 때 모델이 받은 문단과 같다(볼트가 그 뒤에 바뀌지 않았다면).
 */

import { groupHitsByDoc, type Knowledge } from "../core/knowledge";
import { maskPii } from "../core/mask";
import { readPostopDay, type PostopDayReading } from "../core/postop";
import { retrieve, type Retrieval } from "../core/retrieve";
import { decideRoute, type RouteDecision } from "../core/route";

export interface Analysis {
  decision: RouteDecision;
  /** 문의에서 읽은 경과일(없으면 null). */
  postopRead: PostopDayReading | null;
  /** 검색에 실제로 쓴 경과일: 직원이 고친 값이 있으면 그 값. */
  postopUsed: number | null;
  /** 인계·공개 창구·보류면 이 검색을 하지 않는다(null). 인계 문의의 의료진 확인용 초안은 녹화 때 인계 발췌(고정 안내·즉시 조치 문단 + 섞인 의료가 아닌 물음용 행정 안내 문단)로 따로 찾았다(core/retrieve.ts retrieveForHandover). */
  retrieval: Retrieval | null;
  excerpts: ReturnType<typeof groupHitsByDoc>;
}

/**
 * 검색(①②)까지 가는 경로. 고정 문구·보류는 초안을 만들지 않으므로 검색하지 않는다. 인계 카드는 직원이 보낼 초안이 없어 이 검색 칸을 그리지 않고,
 * 의료진 확인용 초안의 발췌는 녹화된 값을 인계 카드 안에 보인다(src/app/_components/HandoverDraft.tsx).
 */
const SEARCH_STEPS = new Set(["classify", "draft", "shop-redirect"]);

export function analyzeInquiry(k: Knowledge, channel: string, text: string, postopOverride: number | null | undefined = undefined): Analysis {
  const decision = decideRoute({ channel, text, channels: k.channels, redflag: k.redflag, medication: k.medication });
  const postopRead = readPostopDay(text);
  // undefined = 직원이 고치지 않음, null = 직원이 '경과일 없음'으로 고침.
  const postopUsed = postopOverride === undefined ? (postopRead?.days ?? null) : postopOverride;
  if (!SEARCH_STEPS.has(decision.step)) return { decision, postopRead, postopUsed, retrieval: null, excerpts: [] };
  const retrieval = retrieve(k.index, "reply", decision.mask.masked, postopUsed);
  return { decision, postopRead, postopUsed, retrieval, excerpts: groupHitsByDoc(retrieval.hits, k.titles) };
}

/**
 * 사내 Q&A(F14). 직원 질문은 게이트로 인계하지 않는다(인계할 환자·창구가 없다). 가림은 한다.
 * 적신호·약 말이 있으면 화면이 규칙 카드를 따로 띄운다(src/demo/qa.ts staffRuleCard — 발췌 앞세우기와 같은 판정).
 */
export function analyzeStaffQuestion(k: Knowledge, question: string) {
  const mask = maskPii(question);
  const retrieval = retrieve(k.index, "staff-qa", mask.masked);
  return { mask, retrieval, excerpts: groupHitsByDoc(retrieval.hits, k.titles) };
}
