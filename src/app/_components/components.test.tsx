/**
 * 화면 약속을 글자로 확인한다(renderToStaticMarkup). 뷰 모델 시험(src/demo/view.test.ts)만으로는
 * 컴포넌트가 그 값을 버리고 다른 글을 그려도 잡지 못한다 — 예: 인계 카드가 V12 문구 대신 다른 문장을 찍거나,
 * ① 검색 칸이 '제외됨' 목록을 숨기는 경우.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { handoverDraftAllowed } from "@/core/route";
import { analyzeInquiry, analyzeStaffQuestion } from "@/demo/analyze";
import { DEMO_NOW_MS } from "@/demo/clock";
import { buildInboxItem } from "@/demo/inbox";
import { readConfirmPolicy, readHandoverPolicy } from "@/demo/policy";
import { staffRuleCard } from "@/demo/qa";
import { handoverCardModel, maskedCaseForInquiry, maskedView, retrievalView } from "@/demo/view";
import { realBundle, realKnowledge } from "@/demo/__fixtures__/real";
import { fakeClient } from "@/demo/fake-recording";
import { handoverDraftFor } from "@/demo/record";
import { ApprovePanel, CLINICIAN_SEND_BLOCK } from "./Approve";
import { HandoverCard } from "./HandoverCard";
import { HandoverDraftSection } from "./HandoverDraft";
import { MaskedText } from "./MaskedText";
import { RetrievalPanel } from "./Pipeline";
import { QaResult } from "./QaResult";
import { StaffRuleCard } from "./StaffRuleCard";

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

  it("인계 초안(PRD v0.3): 카드 머리는 '의료진 확인용 — 직원은 보낼 수 없음'이고, 옛 문구 'AI 답장 초안을 만들지 않습니다'는 없다", () => {
    const html = card("Q06");
    expect(html).toContain("AI 초안은 의료진 확인용입니다 — 직원은 보낼 수 없고");
    expect(html).not.toContain("AI 답장 초안을 만들지 않습니다");
    // 공개 창구 인계(Q16 유튜브 댓글)는 초안을 만들지 않는다고 적는다.
    expect(card("Q16")).toContain("공개 창구라 AI 초안을 만들지 않습니다");
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
  it("인계 초안 녹화가 없는 인계 문의에는 'AI가 받은 글'이라고 쓰지 않고 '보낸다면'으로 보인다", () => {
    const a = analyzeInquiry(k, q("Q11").channel, q("Q11").text);
    const html = renderToStaticMarkup(<MaskedText view={maskedView(maskedCaseForInquiry("handover", null, a.decision.mask, handoverDraftAllowed(a.decision)))} />);
    expect(html).toContain("AI에 보낸다면");
    expect(html).not.toContain("AI가 받은 글");
    expect(html).not.toContain("모델이 실제로 받은");
  });

  it("공개 창구 인계(Q16)는 AI에 보내지 않는다", () => {
    const a = analyzeInquiry(k, q("Q16").channel, q("Q16").text);
    const html = renderToStaticMarkup(<MaskedText view={maskedView(maskedCaseForInquiry("handover", null, a.decision.mask, handoverDraftAllowed(a.decision)))} />);
    expect(html).toContain("AI에 보내지 않음 — 공개 창구는 고정 문구만");
  });
});

describe("의료진 확인 패널(인계 초안, PRD v0.3) — 의료진 확인 전에는 보낼 수 없다", () => {
  // 서버 렌더 = 시연 기록이 빈 첫 화면. 기본 역할은 CS 직원이다.
  const html = renderToStaticMarkup(<ApprovePanel target="Q06" initialText="보내 주신 내용은 의료진에게 바로 전달했습니다." replyMode="copy" clinicianOnly />);
  const buttons = [...html.matchAll(/<button([^>]*)>([^<]*)<\/button>/g)].map((m) => ({ attrs: m[1], label: m[2] }));
  const button = (label: string) => buttons.find((b) => b.label === label);

  it("발송 버튼은 꺼져 있고, 막힌 이유는 '의료진이 확인하기 전에는 보낼 수 없습니다'와 직원이 대신 보내는 것", () => {
    expect(button("복사하고 보낸 것으로 표시(모의)")?.attrs).toContain("disabled");
    expect(html).toContain("의료진이 확인하기 전에는 보낼 수 없습니다. 직원(CS 직원·코디네이터·상담실장)은 이 초안을 보내지 않고 위 승인 문구만 보냅니다.");
  });

  it("'승인' 버튼이 없고, 기본 역할(CS 직원)에서는 '의료진 확인(모의)'도 꺼져 있다", () => {
    expect(buttons.some((b) => b.label === "승인" || b.label === "다시 승인")).toBe(false);
    expect(button("의료진 확인(모의)")?.attrs).toContain("disabled");
    // 역할 목록에 의사가 있다(간호사·의사만 확인할 수 있음).
    expect(html).toContain('<option value="의사">');
    expect(html).toContain("의료진 확인 · 모의 발송");
  });

  it("clinicianOnly가 없으면 기존 직원 패널 그대로(승인 버튼, 의사 역할 없음)", () => {
    const staff = renderToStaticMarkup(<ApprovePanel target="Q02" initialText="안녕하세요." replyMode="copy" />);
    expect(staff).toMatch(/<button[^>]*>승인<\/button>/);
    expect(staff).not.toContain('<option value="의사">');
    expect(staff).toContain("승인한 뒤에 보낼 수 있습니다.");
  });
});

// 녹화 여부와 상관없이 돈다(2026-09-30 검증 변이 M27: HandoverDraftSection이 ApprovePanel에 넘기는 clinicianOnly를 지워도 시험이 몰랐다 —
// 화면 시험은 인계 초안이 녹화된 뒤에만 돌아서). 초안은 가짜 모델로 진짜 파이프라인(handoverDraftFor)을 돌려 만든다.
describe("인계 카드 안 의료진 확인용 초안 칸(HandoverDraftSection) — 직원 화면에서는 보낼 수 없다", () => {
  const render = (rec: Awaited<ReturnType<typeof handoverDraftFor>>) =>
    renderToStaticMarkup(<HandoverDraftSection id="Q06" view={{ kind: "recorded", rec }} replyMode="copy" />);
  const buttonsOf = (html: string) => [...html.matchAll(/<button([^>]*)>([^<]*)<\/button>/g)].map((m) => ({ attrs: m[1], label: m[2] }));

  it("통과한 Q06 초안: '승인' 버튼이 없고, '의료진 확인(모의)'·수정 저장·발송은 꺼져 있고, 막힌 이유와 '직원 발송 불가'가 보인다", async () => {
    const rec = await handoverDraftFor(fakeClient(k.tone, k.prices), k, q("Q06"));
    expect(rec.draft.status).toBe("ok");
    const html = render(rec);
    const buttons = buttonsOf(html);
    const button = (label: string) => buttons.find((b) => b.label === label);
    expect(buttons.some((b) => b.label === "승인" || b.label === "다시 승인")).toBe(false);
    expect(button("의료진 확인(모의)")?.attrs).toContain("disabled");
    expect(button("수정 저장")?.attrs).toContain("disabled");
    expect(button("복사하고 보낸 것으로 표시(모의)")?.attrs).toContain("disabled");
    expect(html).toContain(CLINICIAN_SEND_BLOCK["not-clinician-checked"]);
    expect(html).toContain("직원 발송 불가");
    expect(html).toContain("의료진 확인 · 모의 발송");
    expect(html).toContain("<textarea");
    expect(html).toContain("확인 통과 — 의료진이 확인한 뒤에만 보낼 수 있음");
  });

  /** 가짜 모델: 고정 안내 문단(V12#4)을 인용해 text를 쓴다. */
  const fixedModel = (text: string) => {
    const create = async (p: { messages: { content: unknown }[] }) => {
      const docs = (p.messages[0].content as { type: string; source?: { content: { text: string }[] } }[]).filter((c) => c.type === "document");
      const fixed = docs[0].source!.content[0].text;
      return {
        id: "m",
        type: "message",
        role: "assistant",
        model: "fake-fixture",
        content: [{ type: "text", text, citations: [{ type: "content_block_location", cited_text: fixed, document_index: 0, start_block_index: 0, end_block_index: 1 }] }],
        stop_reason: "end_turn",
        stop_details: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      };
    };
    return { beta: { messages: { create } } } as unknown as Parameters<typeof handoverDraftFor>[0];
  };
  const message = k.index.rules!.handoverDraft!.fixedMessage!;

  // 변이 C5(2026-09-30): 화면이 draftDisplay에 넘기는 따옴표 빼기 옵션을 지워도 시험이 몰랐다 — 따옴표로 녹화된 14건의 보낼 글에 &quot;가 그대로 나갔다.
  it("승인 문구를 큰따옴표로 감싼 초안(Q11): 보낼 글(textarea)과 문장 표시에 따옴표가 없다", async () => {
    const rec = await handoverDraftFor(fixedModel(`"${message}"`), k, q("Q11"));
    expect([rec.draft.status, rec.draft.modelText]).toEqual(["ok", `"${message}"`]);
    const html = render(rec);
    const textarea = /<textarea[^>]*>([^<]*)<\/textarea>/.exec(html)?.[1] ?? null;
    expect(textarea).not.toBeNull();
    const sentences = [...html.matchAll(/<p class="sentence[^"]*">(.*?)<\/p>/g)].map((m) => m[1].replace(/<[^>]+>/g, ""));
    expect(sentences.length).toBeGreaterThan(0);
    for (const t of [textarea!, ...sentences]) expect([t, /&quot;|“|”|"/.test(t)]).toEqual([t, false]);
    expect(textarea).toBe(message);
  });

  // 녹화 때는 통과했는데(옛 규칙) 지금 검사로는 보류인 초안 — 화면이 녹화 status만 믿으면 의료진이 보낼 수 있다(2026-09-30 적대 검증).
  it("녹화 때 통과로 기록됐어도 지금 인계 초안 검사로 보류면 발송 패널을 숨기고 사유를 보인다", async () => {
    const held = await handoverDraftFor(fixedModel(`${message} 기다려 보세요.`), k, q("Q06"));
    expect(held.draft.status).toBe("hold");
    const oldRecord = { ...held, draft: { ...held.draft, status: "ok" as const, holdReasons: [], finalText: held.draft.modelText } };
    const html = render(oldRecord);
    expect(html).not.toContain("<textarea");
    expect(buttonsOf(html).some((b) => b.label.includes("보낸 것으로 표시"))).toBe(false);
    expect(html).toContain("녹화 때는 통과했지만 지금 인계 초안 검사로는 보류됩니다");
    expect(html).toContain("직원에게 하는 말");
  });

  it("보류된 초안이면 발송 패널 자체가 없고, 의료진이 직접 연락한다고 적는다", async () => {
    const ok = await handoverDraftFor(fakeClient(k.tone, k.prices), k, q("Q06"));
    const held = { ...ok, draft: { ...ok.draft, status: "hold" as const, finalText: null, holdReasons: [{ code: "handover-medical-words" as const, detail: "시험" }] } };
    const html = render(held);
    expect(html).not.toContain("<textarea");
    expect(buttonsOf(html).some((b) => b.label.includes("보낸 것으로 표시"))).toBe(false);
    expect(html).toContain("AI 초안이 검증에서 보류됐습니다 — 의료진이 직접 연락합니다");
  });
});

describe("사내 Q&A 규칙 카드", () => {
  const G46 = "수술 2주째 환자가 이식 부위에서 고름이 나온다는데 연고 바르라고 해도 돼요?";
  const text = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&quot;/g, '"');

  it("걸린 말, 5분 인계 한 줄, V12 문단 원문과 문서 제목, 승인 문구를 찍는다", () => {
    const html = renderToStaticMarkup(<StaffRuleCard model={staffRuleCard(k, policies.handover, G46)!} />);
    const t = text(html);
    expect(t).toContain("이 질문은 환자 증상·약 얘기를 담고 있습니다 — 인계 절차대로 5분 안에 의료진에게 넘기세요.");
    expect(t).toContain('"고름"');
    expect(t).toContain(k.chunks.find((c) => c.chunkId === "V12#2")!.text);
    expect(t).toContain(k.chunks.find((c) => c.chunkId === "V12#1")!.text);
    expect(t).toContain("출처: 의료진 인계 절차");
    expect(t).toContain(policies.handover.patientMessage!.value);
    expect(t).toContain("아래 AI 답과 다르면 이 카드대로 하세요");
    // PRD v0.3: 문의함 인계 건의 AI 초안은 의료진 확인용이라 직원이 보내지 않는다 — 카드의 '직원은 증상·약에 답하지 않습니다'와 어긋나지 않는다.
    expect(t).toContain("직원은 증상·약에 답하지 않습니다");
    expect(t).toContain("의료진 확인용 초안이 붙지만, 직원은 그 초안을 보내지 않습니다");
  });

  it("V12 문단을 읽지 못하면 절차를 지어내지 않고 안내만", () => {
    const model = { ...staffRuleCard(k, policies.handover, G46)!, quotes: [] };
    const html = renderToStaticMarkup(<StaffRuleCard model={model} />);
    expect(text(html)).toContain("절차를 지어내지 않습니다");
  });
});

describe("사내 Q&A 결과 — 녹화 없이도 규칙 카드", () => {
  const text = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&quot;/g, '"');
  const render = (question: string) =>
    text(
      renderToStaticMarkup(
        <QaResult
          k={k}
          handoverPolicy={policies.handover}
          a={analyzeStaffQuestion(k, question)}
          rec={null}
          recordingSource="none"
          drift={[]}
          inGaps={false}
          onAddGap={() => {}}
        />,
      ),
    );

  // 적대 검증: 화면이 녹화가 있을 때만 카드를 그리게 바뀌어도 뷰 모델 시험은 통과했다. 결과 묶음을 녹화 없이 그려 본다.
  it("AI 답이 준비 전이어도 G46에 카드와 '규칙 카드가 우선합니다'가 뜬다", () => {
    const t = render("수술 2주째 환자가 이식 부위에서 고름이 나온다는데 연고 바르라고 해도 돼요?");
    expect(t).toContain("AI 초안은 아직 준비 전입니다");
    expect(t).toContain("의료진 인계 먼저");
    expect(t).toContain("인계 절차대로 5분 안에 의료진에게 넘기세요");
    expect(t).toContain("규칙 카드가 우선합니다");
    // 카드가 결과 맨 위(질문보다 앞)에 있다.
    expect(t.indexOf("의료진 인계 먼저")).toBeLessThan(t.indexOf("질문"));
  });

  it("규칙에 안 걸리는 질문에는 카드도 안내도 없다", () => {
    const t = render("두피 관리 받으면 두피가 붉어지나요?");
    expect(t).not.toContain("의료진 인계 먼저");
    expect(t).not.toContain("규칙 카드가 우선합니다");
  });
});
