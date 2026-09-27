import { Suspense } from "react";
import { QaView } from "../_components/QaView";

// ?q=G16 같은 링크를 읽으려면(useSearchParams) 정적 빌드에서 Suspense 경계가 있어야 한다.
export default function Page() {
  return (
    <Suspense fallback={<p className="muted">불러오는 중…</p>}>
      <QaView />
    </Suspense>
  );
}
