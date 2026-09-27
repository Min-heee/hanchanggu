/**
 * 개인정보 가림(F10) 펼치기. 제목과 설명은 src/demo/view.ts maskedView가 경우별로 정한다 —
 * AI를 부르지 않은 곳에서 "모델이 실제로 받은 텍스트"라고 쓰면, AI가 증상 문장을 본 것처럼 읽힌다.
 */

import type { MaskedView } from "@/demo/view";

export function MaskedText({ view }: { view: MaskedView }) {
  return (
    <details>
      <summary>{view.summary}</summary>
      <pre className="masked">{view.text}</pre>
      {view.kinds.length > 0 && <p className="small muted">가린 것: {view.kinds.join(", ")}</p>}
      <p className="small muted">{view.note}</p>
      {view.warn && (
        <div className="note warn" role="note">
          <p>{view.warn}</p>
          <pre className="masked">{view.compareText}</pre>
        </div>
      )}
    </details>
  );
}
