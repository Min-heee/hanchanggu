/**
 * 화면 전체를 서버 렌더로 찍어 본다(renderToStaticMarkup). 뷰 모델 시험은 컴포넌트가 그 함수에 **어떤 값을 넘기는지**
 * (예: 상세 화면이 인계 카드에 V12 대신 AI 초안을 넘기거나, 목록이 가린 글 대신 원문을 넘기는 것)를 잡지 못한다.
 * 번들(src/generated/bundle.json)이 있어야 돈다 — npm test 앞의 pretest가 없으면 만든다.
 * 이 렌더는 localStorage가 없는 서버 쪽 첫 화면(시연 기록 없음)이다.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { readHandoverPolicy } from "@/demo/policy";
import { bundle, engine, inquiryRecord } from "../_lib/data";
import { Inbox } from "./Inbox";
import { InquiryDetail } from "./InquiryDetail";

const V12 = readHandoverPolicy(engine().k.chunks).patientMessage!.value;
/** 녹화에 인계 문의의 의료진 확인용 초안(PRD v0.3)이 들어 있나. 4회차 녹화에는 없다 — 녹화 뒤에도 시험이 깨지지 않게 양쪽으로 둔다. */
const handoverRecorded = bundle.recording?.inquiries.some((r) => r.handoverDraft) ?? false;

/** 목록에서 한 문의의 행(<a class="item" …>…</a>)만 잘라 낸다. */
function rowHtml(html: string, id: string): string {
  const start = html.lastIndexOf("<a", html.indexOf(`href="/inquiry/${id}"`));
  return html.slice(start, html.indexOf("</a>", start));
}

/** 한 행의 옅은 보조 줄 글(조각 사이 태그를 걷어 낸 것). */
function metaText(row: string): string {
  return (row.match(/<p class="item-meta">(.*?)<\/p>/)?.[1] ?? "").replace(/<[^>]+>/g, "");
}

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
    // 요약 숫자 칸: 보이는 글은 라벨·큰 숫자·시한 지남, 이름(스크린리더)은 한 문장.
    expect(html).toContain('aria-label="예약금 확정 대기 4건, 시한 지남 1건"');
    // 휴대폰은 짧은 이름(예약금), 넓은 화면은 전체 이름.
    expect(html).toMatch(
      /<span class="stat-label"><span class="narrow-only-inline">예약금<\/span><span class="wide-only">예약금 확정 대기<\/span><\/span><span class="stat-num">4<small>건<\/small><\/span><span class="stat-note over">시한 지남 1건<\/span>/,
    );
    expect(html).toContain("9/18(금) 16:40~9/21(월) 09:40에 받은 합성 문의");
    // 대본의 '주황 칸'은 이제 행이 아니라 상태 배지 하나가 주황이다. 시한 지남은 그 옆의 빨간 글자 하나.
    const q41 = rowHtml(html, "Q41");
    expect(q41).toContain('<span class="badge orange">예약금 확정 대기</span>');
    expect(q41).toContain('<span class="due over">확정 연락 시한 1일 19시간 지남</span>');
  });

  it("한 행에 색 배지는 하나(할 일을 글자로), 행 배경색·묶음 색 띠 없음, 창구·유형 세부·받은 시각은 옅은 보조 줄로", () => {
    const ids = [...html.matchAll(/href="\/inquiry\/(Q\d+)"/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(20);
    for (const id of ids) {
      const row = rowHtml(html, id);
      expect(row.match(/class="badge[^"]*"/g), id).toHaveLength(1);
      expect(row, id).not.toContain("상태: "); // 예전의 중복 배지 "상태: 인계 필요"
      expect(metaText(row), id).toMatch(new RegExp(`^${id} · .*받음 `));
      // 기다린 시간은 오른쪽 칸(시한이 없는 건)이나 보조 줄(시한이 있는 건) 중 한 곳에 꼭 있다.
      expect(/<span class="due wait">[^<]*기다림<\/span>/.test(row) || metaText(row).includes(" · 기다린 시간 "), id).toBe(true);
      // 빨강은 배지에만: 시한 글자에는 색 이름 클래스가 없다.
      expect(row, id).not.toMatch(/class="due[^"]*(red|orange)/);
    }
    expect(html).not.toMatch(/class="item g\d"/);
    // Q06(적신호): 칠한 빨간 배지에 할 일, 인계 시한 지남은 진한 글자(over), 창구·기다린 시간은 보조 줄에.
    const q06 = rowHtml(html, "Q06");
    expect(q06).toContain('<span class="badge red">적신호 · 인계 필요</span>');
    expect(q06).toContain('<span class="due over">인계 시한 1일 12시간 지남</span>');
    expect(metaText(q06)).toBe("Q06 · 카카오 채널 · 받음 9/19(토) 21:14 · 기다린 시간 1일 12시간 · 첨부 1");
    // Q25(약 문의 인계): 적신호보다 한 단계 약한 테두리 배지.
    expect(rowHtml(html, "Q25")).toContain('<span class="badge red-line">약 문의 · 인계 필요</span>');
    // Q05(홈페이지 상담 폼): 예전 '개인정보 가림 3곳' 배지는 보조 줄에 남는다.
    expect(metaText(rowHtml(html, "Q05"))).toMatch(/^Q05 · .*개인정보 가림 3곳/);
    // Q02: 시한이 없는 건은 오른쪽 칸에 기다린 시간(그 밖의 문의 묶음에서 오래 기다린 건이 묻히지 않게).
    expect(rowHtml(html, "Q02")).toContain('<span class="due wait">1일 15시간 기다림</span>');
  });

  it("묶음 제목은 요약 칸과 같은 이름에 건수, 시한 지남은 제목에 한 번, 접혔으면 몇 건만 보이는지", () => {
    expect(html).toContain('<li class="group-title">적신호 인계 <span class="count">16건</span><span class="gt-over"> · 모두 시한 지남</span><span class="count"> · 2건만 표시</span></li>');
    expect(html).toContain('<li class="group-title">약·분류 인계 <span class="count">5건</span><span class="gt-over"> · 모두 시한 지남</span></li>');
    expect(html).toContain('<li class="group-title">예약금 확정 대기 <span class="count">4건</span><span class="gt-over"> · 1건 시한 지남</span></li>');
    expect(html).toContain('<li class="group-title">그 밖의 문의 · 오래 기다린 순 <span class="count">16건</span></li>');
    expect(html).not.toContain("예약금 받음 · 확정 대기");
  });

  it("요약 칸: 묶음 칸만 눌림 상태가 있고 '전체'는 거르기를 푸는 버튼, 기준 시각이 목록 머리에 보인다", () => {
    expect(html).toContain('<button type="button" class="stat group" aria-pressed="false" aria-label="적신호 인계 16건, 모두 시한 지남">');
    expect(html).toContain('<button type="button" class="stat" aria-label="전체 41건">');
    expect(html).toContain('<span class="now">9/21(월) 10:00 기준</span>');
  });

  it("지시문이 섞인 문의(Q29)는 AI 초안이 검증을 통과해도 초록 '초안 준비'가 아니라 '지시문 섞임 · 확인'", () => {
    const q29 = rowHtml(html, "Q29");
    expect(q29).toContain('<span class="badge line">지시문 섞임 · 확인</span>');
    expect(q29).not.toContain("badge green");
  });

  it("보류에는 이유가 붙는다: 예약금 Q41은 미리 만든 AI 답이 문서 빈칸으로 보류", () => {
    const rec = inquiryRecord("Q41");
    if (!rec?.draft) return; // 녹화가 없으면 AI 답이 없어 보류 이유도 없다
    expect(rec.draft.holdReasons[0]?.code).toBe("no-evidence");
    expect(metaText(rowHtml(html, "Q41"))).toContain("초안 보류(문서 빈칸)");
  });
});

describe("문의 상세", () => {
  // 인계 초안 녹화 전(지금 4회차 녹화): 인계 카드에 '녹화 전'을 정직하게 보이고, 발송 패널은 없다.
  it.skipIf(handoverRecorded)("인계 카드(Q06, 인계 초안 녹화 전): V12 승인 문구 + '녹화 전' 배지, 발송 패널 없음, 'AI에 보낸다면'", () => {
    const html = renderToStaticMarkup(<InquiryDetail id="Q06" />);
    const qs = quotes(html);
    expect(qs).toContain(V12);
    expect(qs).toHaveLength(2);
    expect(html).toContain("의료진 확인용 AI 초안");
    expect(html).toContain("녹화 전");
    expect(html).toContain("인계 초안 녹화 전");
    expect(html).not.toContain("<textarea");
    expect(html).toContain("AI에 보낸다면");
    expect(html).not.toContain("AI가 받은 글");
    expect(html).not.toContain("AI 답장 초안을 만들지 않습니다");
  });

  it("공개 창구 인계(Q16): 초안 칸 없이 '공개 창구라 AI 초안을 만들지 않습니다', AI에 보내지 않음", () => {
    const html = renderToStaticMarkup(<InquiryDetail id="Q16" />);
    expect(html).toContain("공개 창구라 AI 초안을 만들지 않습니다");
    expect(html).not.toContain("의료진 확인용 AI 초안");
    expect(html).toContain("AI에 보내지 않음 — 공개 창구는 고정 문구만");
    expect(quotes(html)).toContain(V12);
  });

  it("주민번호가 든 문의(Q17)는 원문 인용도 가린 글이 기본이고, 원문 보기에서도 주민번호는 가린다", () => {
    const html = renderToStaticMarkup(<InquiryDetail id="Q17" />);
    expect(html).not.toContain("900101-1234567");
    expect(html).toContain("원문 보기(직원만 · 주민번호는 계속 가림)");
  });

  it("예약금 문의(Q01): 확정 대기 카드가 경과일 카드보다 먼저, 경과일은 접힌 한 줄", () => {
    const html = renderToStaticMarkup(<InquiryDetail id="Q01" />);
    expect(html.indexOf("<h2>예약금 확정 대기</h2>")).toBeLessThan(html.indexOf("경과일: 문의에 적힌 값 없음"));
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

// 인계 초안이 녹화된 뒤(record-demo --handover-only): 의료진 확인용 초안이 붙고, 첫 화면(시연 기록 없음)에서는 발송이 꺼져 있다.
describe.skipIf(!handoverRecorded)("인계 초안이 녹화됐을 때(PRD v0.3)", () => {
  it("Q06: '의료진 확인용 AI 초안'·'직원 발송 불가', 초안 상태에 따라 발송 패널(꺼진 채) 또는 보류 안내", () => {
    const html = renderToStaticMarkup(<InquiryDetail id="Q06" />);
    expect(html).toContain("의료진 확인용 AI 초안");
    expect(html).toContain("직원 발송 불가");
    expect(quotes(html)).toContain(V12);
    expect(html).not.toMatch(/<button[^>]*>승인<\/button>/);
    // 초안 상태를 먼저 단언한다 — 조건 없이 건너뛰면 보류 녹화에서 발송 패널 시험이 조용히 사라진다.
    const status = inquiryRecord("Q06")!.handoverDraft!.draft.status;
    if (status === "ok") {
      expect(html).toContain("<textarea");
      expect(html).toContain("의료진이 확인하기 전에는 보낼 수 없습니다");
      expect(html).toMatch(/<button[^>]*disabled[^>]*>의료진 확인\(모의\)<\/button>/);
      // 1차 인계 초안 녹화의 Q06은 승인 문구를 큰따옴표로 감쌌다. 보낼 글과 초안 문장 표시에는 따옴표가 없어야 한다(변이 C5).
      const textarea = /<textarea[^>]*>([^<]*)<\/textarea>/.exec(html)?.[1] ?? "";
      expect(textarea).not.toMatch(/&quot;|“|”/);
      const section = html.slice(html.indexOf('aria-label="의료진 확인용 AI 초안"'));
      const sentences = [...section.matchAll(/<p class="sentence[^"]*">(.*?)<\/p>/g)].map((m) => m[1].replace(/<[^>]+>/g, ""));
      expect(sentences.length).toBeGreaterThan(0);
      expect(sentences.join(" ")).not.toMatch(/&quot;|“|”/);
    } else {
      expect(status).toBe("hold");
      expect(html).not.toContain("<textarea");
      expect(html).toContain("AI 초안이 검증에서 보류됐습니다");
    }
  });
});

// 녹화 파일의 보낼 글은 녹화 때 채운 것이다. 화면은 AI가 쓴 글에 지금 코드로 칸을 다시 채워 보인다(src/demo/refill.ts).
// 다시 채우기 표시(“지금 코드로 다시 채운 글”)와 Q38 링크 처리는 2회차 녹화 사본으로 src/demo/refill.test.ts가 고정한다.
// 여기서는 지금 시연 녹화가 무엇이든 화면에 나가는 글에 단위 겹침·링크 표기가 없다는 것만 본다.
describe.skipIf(bundle.recordingSource !== "file")("미리 만든 AI 답 — 보낼 글", () => {
  const textarea = (html: string) => /<textarea[^>]*>([^<]*)<\/textarea>/.exec(html)?.[1] ?? "";
  const sentences = (html: string) => [...html.matchAll(/<p class="sentence[^"]*">(.*?)<\/p>/g)].map((m) => m[1].replace(/<[^>]+>/g, ""));

  it("가격 문의(Q02): 승인 패널·초안 문장에 가격이 가격표 값으로 들어가고 단위가 겹치지 않는다", () => {
    const html = renderToStaticMarkup(<InquiryDetail id="Q02" />);
    expect(textarea(html)).toContain("모당 2,000원");
    expect(textarea(html)).not.toMatch(/원\/(?:모|회)/);
    expect(sentences(html).join(" ")).not.toMatch(/원\/(?:모|회)/);
  });

  it("어느 문의의 승인 패널·초안 문장에도 볼트 링크 표기([[…]])가 그대로 나가지 않는다", () => {
    for (const q of bundle.inquiries) {
      const html = renderToStaticMarkup(<InquiryDetail id={q.id} />);
      expect(textarea(html), q.id).not.toContain("[[");
      expect(sentences(html).join(" "), q.id).not.toContain("[[");
    }
  });
});
