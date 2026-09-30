"use client";

/**
 * 직접 해 보기(PRD 3절 12~20초). 입력한 문장을 개인정보 가림 → 안전 규칙 → 문서 찾기까지 브라우저에서 바로 돌린다.
 * AI 초안(③)은 준비된 질문에만 있다 — 입력한 문장으로 AI를 부르지 않는다(방문자 비용 0, PRD F18).
 * 인계 카드도 같다: 준비된 인계 문의에는 의료진 확인용 AI 초안(PRD v0.3)이 붙지만, 직접 넣은 문장에는 카드만 뜬다.
 * 첫 화면을 차지하지 않게 한 줄 입력과 예시만 두고, 결과는 누른 뒤에 펼친다.
 */

import { useState } from "react";
import { analyzeInquiry, type Analysis } from "@/demo/analyze";
import { DEMO_NOW_MS } from "@/demo/clock";
import { handoverDraftAllowed } from "@/core/route";
import { handoverInfo } from "@/demo/inbox";
import { handoverCardModel, liveExcerpts, maskedCaseForTry, maskedView, retrievalView } from "@/demo/view";
import { engine } from "../_lib/data";
import { HandoverCard } from "./HandoverCard";
import { MaskedText } from "./MaskedText";
import { ExcerptPanel, RetrievalPanel } from "./Pipeline";
import { REPLY_MODE_LABEL } from "./Badges";

const EXAMPLES = [
  { label: "수술 후 열감·통증", text: "이식한 지 열흘인데 부위가 뜨겁고 누르면 아파요" },
  { label: "가격 문의", text: "모당 가격이랑 첫 상담비 알려 주세요" },
  { label: "예약금 + 전화번호", text: "예약금 냈는데 확정 문자가 안 왔어요. 010-0000-1111로 연락 주세요" },
];

export function TryIt() {
  const { k, policies } = engine();
  const [channel, setChannel] = useState("kakao");
  // 첫 예시를 값으로 채워 둔다. 자리표시자로 두면 이미 채워진 것처럼 보이는데 버튼은 꺼져 있어 고장처럼 보였다.
  const [text, setText] = useState(EXAMPLES[0].text);
  const [result, setResult] = useState<{ text: string; channel: string; a: Analysis } | null>(null);

  const run = (t: string, ch = channel) => {
    if (t.trim() === "") return;
    setResult({ text: t, channel: ch, a: analyzeInquiry(k, ch, t) });
  };

  return (
    <section className="card tryit" aria-labelledby="tryit-title" id="tryit">
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          run(text);
        }}
      >
        <h2 id="tryit-title" className="tryit-title" title="환자 문의 문장을 넣으면 개인정보 가림 → 안전 규칙 → 문서 찾기가 이 브라우저에서 바로 돕니다. AI는 부르지 않습니다.">
          직접 해 보기
        </h2>
        <label style={{ flex: "1 1 240px" }}>
          <span className="sr-only">환자 문의 문장(AI 호출 없이 안전 규칙과 문서 찾기만 돕니다)</span>
          <input value={text} onChange={(e) => setText(e.target.value)} />
        </label>
        <select className="wide-only" value={channel} onChange={(e) => setChannel(e.target.value)} aria-label="들어온 창구">
          {k.channels.map((c) => (
            <option key={c.channel} value={c.channel}>
              {c.label}
            </option>
          ))}
        </select>
        <button type="submit" className="primary" disabled={text.trim() === ""}>
          확인하기
        </button>
        <div className="chips" role="group" aria-label="예시 문장">
          <span className="muted small wide-only">예시:</span>
          {EXAMPLES.map((ex) => (
          <button
            key={ex.text}
            type="button"
            className="chip"
            onClick={() => {
              setText(ex.text);
              run(ex.text);
            }}
          >
            {ex.label}
          </button>
          ))}
        </div>
      </form>

      {result && (
        <div style={{ marginTop: 12 }} aria-live="polite">
          <MaskedText view={maskedView(maskedCaseForTry(result.a.decision.step, result.a.decision.mask, handoverDraftAllowed(result.a.decision)))} />
          {result.a.decision.step === "handover" ? (
            <HandoverCard
              model={handoverCardModel(result.a.decision, handoverInfo(DEMO_NOW_MS, null, policies.handover, k, DEMO_NOW_MS), policies.handover, DEMO_NOW_MS, k.titles)}
              postop={result.a.postopRead}
            >
              <p className="small muted" style={{ marginTop: 8 }}>
                직접 넣은 문장으로는 AI를 부르지 않습니다 — 준비된 인계 문의에는 의료진 확인용 초안이 붙습니다.
              </p>
            </HandoverCard>
          ) : result.a.decision.step === "public-template" ? (
            <div className="card">
              <h3>공개 창구 — 고정 문구만</h3>
              <p>이 창구({result.a.decision.channel?.label})는 병원이 정한 고정 문구만 쓸 수 있습니다. 답장 초안을 만들지 않습니다.</p>
            </div>
          ) : result.a.decision.step === "hold" ? (
            <div className="card">
              <h3>보류</h3>
              <p>{result.a.decision.holdReason}</p>
            </div>
          ) : (
            <>
              <div className="note" role="note">
                <p>
                  <strong>안전 규칙 통과.</strong> 다음 단계는 AI 분류입니다. AI 분류가 이 문의를 의료진 인계로 바꿀 수 있습니다 — 이 시연에서는 AI를 부르지
                  않아 여기까지만 보입니다.
                </p>
                <p className="small muted">
                  답장 방식: {result.a.decision.replyMode ? REPLY_MODE_LABEL[result.a.decision.replyMode] : "모름"}
                  {result.a.postopRead && ` · 읽은 경과일: 수술 후 ${result.a.postopRead.days}일째("${result.a.postopRead.text}")`}
                </p>
              </div>
              {result.a.retrieval && <RetrievalPanel view={retrievalView(k, result.a.retrieval, result.a.decision.mask.masked)} />}
              <ExcerptPanel docs={liveExcerpts(k, result.a.excerpts)} highlight={new Set()} source="live" weak={result.a.retrieval?.weak ?? false} />
              <div className="card">
                <h3>③ AI 초안 · ④ 근거·확인</h3>
                <p>준비된 문의·질문만 AI 초안이 있습니다. 직접 넣은 문장으로는 AI를 부르지 않습니다 — 안전 규칙과 문서 찾기까지가 지금 바로 동작하는 부분입니다.</p>
              </div>
            </>
          )}
          <details className="dev">
            <summary>안전 규칙 기록(개발자용)</summary>
            <ol className="small">
              {result.a.decision.trace.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ol>
          </details>
        </div>
      )}
    </section>
  );
}
