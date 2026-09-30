import Link from "next/link";
import { Inbox } from "./_components/Inbox";
import { TryIt } from "./_components/TryIt";

// 첫 화면: 한 줄 정의와 30초 둘러보기(작은 링크 한 줄) → 통합 목록(PRD F3) → 직접 해 보기.
// 목록이 첫 화면에 먼저 보이게 위 칸은 짧게 두고, 직접 해 보기는 목록 아래로 내린다(둘러보기 ③이 바로 데려간다).
// 휴대폰은 정의를 한 줄로 줄이고, 둘러보기 링크는 줄을 바꿔 다섯 개가 다 보이게 한다(가로로 밀면 ④·⑤가 잘린 줄 몰랐다).
export default function Home() {
  return (
    <>
      <section className="intro" aria-label="한창구 소개">
        <p className="wide-only">
          여러 문의 창구의 문의를 한 목록에 모으고, 병원 문서만 근거로 답장 초안을 만들어 <strong>직원이 검토한 뒤 보내게</strong> 하는 도구입니다. 증상·약
          문의는 AI보다 안전 규칙이 먼저 잡아 의료진에게 넘깁니다.
        </p>
        <p className="narrow-only">
          문의를 한 목록에 모아 답장 초안을 만듭니다.
        </p>
        <nav aria-label="30초 둘러보기" className="tour">
          <span className="muted small">30초 둘러보기</span>
          <a href="#inbox">① 통합 목록</a>
          <Link href="/inquiry/Q02">② 가격 문의</Link>
          <a href="#tryit">③ 직접 해 보기</a>
          <Link href="/qa?q=G16">④ 사내 Q&amp;A</Link>
          <Link href="/eval">⑤ 평가</Link>
        </nav>
      </section>
      <Inbox />
      <TryIt />
    </>
  );
}
