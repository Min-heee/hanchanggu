import Link from "next/link";
import { Inbox } from "./_components/Inbox";
import { TryIt } from "./_components/TryIt";

// 첫 화면: 한 줄 정의와 30초 둘러보기 → 직접 해 보기(한 줄) → 통합 목록(PRD F3).
// 목록이 첫 화면에 보이도록 위의 두 칸은 짧게 둔다(30초 시연 0~5초 장면).
export default function Home() {
  return (
    <>
      <section className="intro" aria-label="한창구 소개">
        <p>
          여러 문의 창구의 문의를 한 목록에 모으고, 병원 문서만 근거로 답장 초안을 만들어 <strong>직원이 검토한 뒤 보내게</strong> 하는 도구입니다.
          <span className="wide-only"> 증상·약 문의는 AI보다 안전 규칙이 먼저 잡아 의료진에게 넘깁니다.</span>
        </p>
        <nav aria-label="30초 둘러보기" className="tour">
          <span className="muted small">30초 둘러보기:</span>
          <a href="#inbox">① 적신호 목록</a>
          <Link href="/inquiry/Q02">② 가격 문의</Link>
          <a href="#tryit">③ 직접 해 보기</a>
          <Link href="/qa?q=G16">④ 사내 Q&amp;A</Link>
          <Link href="/eval">⑤ 평가</Link>
        </nav>
      </section>
      <TryIt />
      <Inbox />
    </>
  );
}
