import { Inbox } from "./_components/Inbox";
import { TryIt } from "./_components/TryIt";

// 첫 화면: 직접 해 보기(키 없이 규칙·검색) + 통합 목록(PRD F3).
export default function Home() {
  return (
    <>
      <TryIt />
      <Inbox />
    </>
  );
}
