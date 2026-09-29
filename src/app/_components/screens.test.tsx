/**
 * 화면 전체를 서버 렌더로 찍어 본다(renderToStaticMarkup). 뷰 모델 시험은 컴포넌트가 그 함수에 **어떤 값을 넘기는지**
 * (예: 상세 화면이 인계 카드에 V12 대신 AI 초안을 넘기거나, 목록이 가린 글 대신 원문을 넘기는 것)를 잡지 못한다.
 * 번들(src/generated/bundle.json)이 있어야 돈다 — npm test 앞의 pretest가 없으면 만든다.
 * 이 렌더는 localStorage가 없는 서버 쪽 첫 화면(시연 기록 없음)이다.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { readHandoverPolicy } from "@/demo/policy";
import { bundle, engine } from "../_lib/data";
import { Inbox } from "./Inbox";
import { InquiryDetail } from "./InquiryDetail";

const V12 = readHandoverPolicy(engine().k.chunks).patientMessage!.value;

function quotes(html: string): string[] {
  return [...html.matchAll(/<p class="quote"[^>]*>([^<]*)<\/p>/g)].map((m) => m[1]);
}

describe("통합 목록 첫 화면", () => {
  const html = renderToStaticMarkup(<Inbox />);

  it("미리보기는 가린 글이다 — 주민번호·전화·이메일이 목록에 찍히지 않는다", () => {
    expect(html).not.toContain("900101-1234567");
    expect(html).not.toContain("010-0000-1234");
    expect(html).not.toContain("sample.user@example.com");
    expect(html).toContain("[주민번호]");
    expect(html).toContain("개인정보 가림");
  });

  it("적신호 묶음은 접혀 있고, 약 문의 인계와 확정 대기가 그 아래 바로 온다", () => {
    const iQ25 = html.indexOf("/inquiry/Q25");
    const iQ01 = html.indexOf("/inquiry/Q01");
    const iMore = html.indexOf("적신호 인계 14건 더 보기");
    expect(iMore).toBeGreaterThan(0);
    expect(iMore).toBeLessThan(iQ25);
    expect(iQ25).toBeLessThan(iQ01);
    expect(html).not.toContain("/inquiry/Q08"); // 접힌 적신호
  });

  it("30초 시연 0~5초: 확정 대기 맨 앞은 시한이 지난 Q41, 요약과 받은 기간은 데이터에서 계산한 값", () => {
    const iQ41 = html.indexOf("/inquiry/Q41");
    expect(iQ41).toBeGreaterThan(html.indexOf("/inquiry/Q25"));
    expect(iQ41).toBeLessThan(html.indexOf("/inquiry/Q01"));
    expect(html).toContain("예약금 받음 · 확정 연락 시한 1일 19시간 지남");
    expect(html).toContain("예약금 받음 · 확정 대기 4건 · 시한 지남 1");
    expect(html).toContain("9/18(금) 16:40~9/21(월) 09:40에 받은 합성 문의");
    // 대본의 '주황 칸': 행은 확정 대기 묶음 색(g2 주황), 배지만 시한 지남 빨강
    expect(html).toContain('class="item g2" href="/inquiry/Q41"');
    expect(html).toContain('<span class="badge red">예약금 받음 · 확정 연락 시한 1일 19시간 지남</span>');
  });
});

describe("문의 상세", () => {
  it("인계 카드에는 V12 승인 문구만 — 원문 인용과 함께 찍히는 글은 가린 원문과 V12 둘뿐", () => {
    const html = renderToStaticMarkup(<InquiryDetail id="Q06" />);
    const qs = quotes(html);
    expect(qs).toContain(V12);
    expect(qs).toHaveLength(2);
    expect(html).toContain("AI에 보내지 않음 — 안전 규칙이 먼저 잡음");
    expect(html).not.toContain("AI가 받은 글");
  });

  it("주민번호가 든 문의(Q17)는 원문 인용도 가린 글이 기본이고, 원문 보기에서도 주민번호는 가린다", () => {
    const html = renderToStaticMarkup(<InquiryDetail id="Q17" />);
    expect(html).not.toContain("900101-1234567");
    expect(html).toContain("원문 보기(직원만 · 주민번호는 계속 가림)");
  });

  it("예약금 문의(Q01): 확정 대기 카드가 경과일 카드보다 먼저, 경과일은 접힌 한 줄", () => {
    const html = renderToStaticMarkup(<InquiryDetail id="Q01" />);
    expect(html.indexOf("예약금 받음 · 확정 대기")).toBeLessThan(html.indexOf("경과일: 문의에 적힌 값 없음"));
    expect(html).toContain("안내할 때 근거 규정");
  });

  it("예약금 문의(Q41): 시한이 지났으면 확정 대기 카드가 경보 색이고 지난 시간을 적는다", () => {
    const html = renderToStaticMarkup(<InquiryDetail id="Q41" />);
    expect(html).toContain('class="card alert"');
    expect(html).toContain("9/19(토) 15:00까지");
    expect(html).toContain("시한 1일 19시간 지남");
    expect(html).not.toContain("0분 남음");
  });

  // 미리 만든 AI 답이 들어오면 미리보기 대신 초안의 가격 칸이 보인다. 그때는 이 시험을 건너뛴다.
  it.skipIf(bundle.recording !== null)("가격 문의(Q02): AI 답 전에도 가격 칸 미리보기가 가격표 값으로", () => {
    const html = renderToStaticMarkup(<InquiryDetail id="Q02" />);
    expect(html).toContain("가격 칸 미리보기");
    expect(html).toContain("2,000원/모");
    expect(html).toContain("AI 초안은 아직 준비 전입니다");
  });
});

// 녹화 파일의 보낼 글은 녹화 때 채운 것이다. 화면은 AI가 쓴 글에 지금 코드로 칸을 다시 채워 보인다(src/demo/refill.ts).
describe.skipIf(bundle.recordingSource !== "file")("미리 만든 AI 답 — 지금 코드로 다시 채운 글", () => {
  const textarea = (html: string) => /<textarea[^>]*>([^<]*)<\/textarea>/.exec(html)?.[1] ?? "";
  const sentences = (html: string) => [...html.matchAll(/<p class="sentence[^"]*">(.*?)<\/p>/g)].map((m) => m[1].replace(/<[^>]+>/g, ""));

  it("가격 문의(Q02): 승인 패널·초안 문장에 단위 겹침이 없고, 다시 채웠다고 적고 녹화 때 글도 펼쳐 볼 수 있다", () => {
    const html = renderToStaticMarkup(<InquiryDetail id="Q02" />);
    expect(textarea(html)).toContain("모발이식은 모당 2,000원이며");
    expect(textarea(html)).toContain("예약금 30,000원을 받습니다");
    expect(textarea(html)).not.toMatch(/원\/(?:모|회)/);
    expect(sentences(html).join(" ")).not.toMatch(/원\/(?:모|회)/);
    expect(html).toContain("지금 코드로 다시 채운 글");
    expect(html).toContain("미리 만든 답을 만들 때 채운 글");
  });

  it("환자 답장(Q38): 링크 표기 대신 문서 제목, 환자가 열 수 없는 문서 이름이라고 알린다", () => {
    const html = renderToStaticMarkup(<InquiryDetail id="Q38" />);
    expect(textarea(html)).not.toContain("[[");
    expect(sentences(html).join(" ")).not.toContain("[[");
    expect(html).toContain("환자가 열어 볼 수 없는 병원 문서 이름");
  });
});
