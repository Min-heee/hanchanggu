/**
 * 화면 약속을 글자로 확인한다(renderToStaticMarkup). 뷰 모델 시험(src/demo/view.test.ts)만으로는
 * 컴포넌트가 그 값을 버리고 다른 글을 그려도 잡지 못한다 — 예: 인계 카드가 V12 문구 대신 다른 문장을 찍거나,
 * ① 검색 칸이 '제외됨' 목록을 숨기는 경우.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { analyzeInquiry } from "@/demo/analyze";
import { DEMO_NOW_MS } from "@/demo/clock";
import { buildInboxItem } from "@/demo/inbox";
import { readConfirmPolicy, readHandoverPolicy } from "@/demo/policy";
import { handoverCardModel, maskedCaseForInquiry, maskedView, retrievalView } from "@/demo/view";
import { realBundle, realKnowledge } from "@/demo/__fixtures__/real";
import { HandoverCard } from "./HandoverCard";
import { MaskedText } from "./MaskedText";
import { RetrievalPanel } from "./Pipeline";

const k = realKnowledge();
const bundle = realBundle();
const policies = { confirm: readConfirmPolicy(k.chunks), handover: readHandoverPolicy(k.chunks) };
const q = (id: string) => bundle.inquiries.find((x) => x.id === id)!;

function card(id: string) {
  const a = analyzeInquiry(k, q(id).channel, q(id).text);
  const it = buildInboxItem(q(id), k, null, policies, { sent: new Set(), handedOver: new Map() }, DEMO_NOW_MS);
  return renderToStaticMarkup(<HandoverCard model={handoverCardModel(a.decision, it.handover, policies.handover, DEMO_NOW_MS, k.titles)} postop={a.postopRead} />);
}

/** 인용 블록(.quote) 안의 글만 뽑는다. */
function quotes(html: string): string[] {
  return [...html.matchAll(/<p class="quote">([^<]*)<\/p>/g)].map((m) => m[1]);
}

describe("인계 카드", () => {
  it("환자에게 보낼 문구 칸에는 V12 승인 문구 하나만 찍힌다", () => {
    const html = card("Q06");
    expect(quotes(html)).toEqual([policies.handover.patientMessage!.value]);
    expect(html).toContain("고쳐 쓰지 않습니다");
  });

  it("시한은 기준 시각으로 잰 넘긴 양과, 시한 당시 담당을 보인다(Q11)", () => {
    const html = card("Q11");
    expect(html).toContain("시한 1일 2시간 지남");
    expect(html).toContain("시한 당시 담당: 당직 의료진 연락망");
    expect(html).toContain("지금 담당: 담당 간호사");
  });

  it("V12 문구를 읽지 못하면 문구 칸 대신 안내만", () => {
    const a = analyzeInquiry(k, q("Q06").channel, q("Q06").text);
    const it = buildInboxItem(q("Q06"), k, null, policies, { sent: new Set(), handedOver: new Map() }, DEMO_NOW_MS);
    const html = renderToStaticMarkup(
      <HandoverCard model={handoverCardModel(a.decision, it.handover, { ...policies.handover, patientMessage: null }, DEMO_NOW_MS, k.titles)} />,
    );
    expect(quotes(html)).toEqual([]);
    expect(html).toContain("문구를 지어내지 않습니다");
  });
});

describe("① 문서 찾기 칸", () => {
  it("관련 있지만 쓰지 않는 옛 판·초안을 '제외됨'으로 보인다", () => {
    const text = "예약금 환불은 며칠 전까지 취소해야 돼요?";
    const html = renderToStaticMarkup(<RetrievalPanel view={retrievalView(k, analyzeInquiry(k, "kakao", text).retrieval!, text)} />);
    expect(html).toContain("제외됨 · 옛 판");
    expect(html).toContain("제외됨 · 승인 전 초안");
    // 개발 용어는 '자세히(개발자용)' 안에만.
    const beforeDev = html.slice(0, html.indexOf("자세히(개발자용)"));
    expect(beforeDev).not.toMatch(/BM25|2-gram|V04#/);
  });

  it("근거 약함이면 '문서 빈칸' 안내를 띄운다", () => {
    const text = "대기실 와이파이 비밀번호가 뭐예요?";
    const html = renderToStaticMarkup(<RetrievalPanel view={retrievalView(k, analyzeInquiry(k, "kakao", text).retrieval!, text)} />);
    expect(html).toContain("근거 약함 — 문서 빈칸");
  });
});

describe("개인정보 가림 펼치기", () => {
  it("규칙이 인계한 문의에는 'AI가 받은 글'이라고 쓰지 않는다", () => {
    const a = analyzeInquiry(k, q("Q11").channel, q("Q11").text);
    const html = renderToStaticMarkup(<MaskedText view={maskedView(maskedCaseForInquiry("handover", null, a.decision.mask))} />);
    expect(html).toContain("AI에 보내지 않음");
    expect(html).not.toContain("AI가 받은 글");
    expect(html).not.toContain("모델이 실제로 받은");
  });
});
