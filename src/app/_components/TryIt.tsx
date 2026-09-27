"use client";

/**
 * 직접 해 보기(PRD 3절 12~20초). 입력한 문장을 가림 → 게이트 → 검색까지 브라우저에서 바로 돌린다. 키가 필요 없다.
 * AI 초안(③)은 미리 녹화한 질문에만 있다 — 입력한 문장으로 모델을 부르지 않는다(방문자 비용 0, PRD F18).
 */

import { useState } from "react";
import { analyzeInquiry, type Analysis } from "@/demo/analyze";
import { DEMO_NOW_MS } from "@/demo/clock";
import { handoverInfo } from "@/demo/inbox";
import { engine } from "../_lib/data";
import { HandoverCard } from "./HandoverCard";
import { MaskedText } from "./MaskedText";
import { ExcerptPanel, RetrievalPanel } from "./Pipeline";
import { REPLY_MODE_LABEL } from "./Badges";

const EXAMPLES = [
  "이식한 지 열흘인데 부위가 뜨겁고 누르면 아파요",
  "모당 가격이랑 첫 상담비 알려 주세요",
  "예약금 냈는데 확정 문자가 안 왔어요. 010-0000-1111로 연락 주세요",
];

export function TryIt() {
  const { k, policies } = engine();
  const [channel, setChannel] = useState("kakao");
  const [text, setText] = useState("");
  const [result, setResult] = useState<{ text: string; channel: string; a: Analysis } | null>(null);

  const run = (t: string, ch = channel) => {
    if (t.trim() === "") return;
    setResult({ text: t, channel: ch, a: analyzeInquiry(k, ch, t) });
  };

  return (
    <section className="card" aria-labelledby="tryit-title">
      <h2 id="tryit-title">직접 해 보기</h2>
      <p className="small muted">문의 문장을 넣으면 가림 → 규칙 게이트 → 검색이 이 브라우저에서 바로 돕니다. API 키 없이 동작합니다.</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(text);
        }}
      >
        <label style={{ display: "flex" }}>
          문의 문장
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder={EXAMPLES[0]} />
        </label>
        <div className="row" style={{ marginTop: 8 }}>
          <label>
            들어온 창구
            <select value={channel} onChange={(e) => setChannel(e.target.value)}>
              {k.channels.map((c) => (
                <option key={c.channel} value={c.channel}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="primary" disabled={text.trim() === ""}>
            돌려 보기
          </button>
        </div>
      </form>
      <div className="row small" style={{ marginTop: 8 }}>
        <span className="muted">예시:</span>
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            className="link"
            onClick={() => {
              setText(ex);
              run(ex);
            }}
          >
            {ex.length > 18 ? `${ex.slice(0, 18)}…` : ex}
          </button>
        ))}
      </div>

      {result && (
        <div style={{ marginTop: 12 }} aria-live="polite">
          <MaskedText original={result.text} mask={result.a.decision.mask} />
          <details className="small">
            <summary>게이트 기록</summary>
            <ol>
              {result.a.decision.trace.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ol>
          </details>
          {result.a.decision.step === "handover" ? (
            <HandoverCard
              decision={result.a.decision}
              info={handoverInfo(DEMO_NOW_MS, null, policies.handover, k, DEMO_NOW_MS)}
              policy={policies.handover}
              postop={result.a.postopRead}
            />
          ) : result.a.decision.step === "public-template" ? (
            <div className="card">
              <h3>공개 창구 — 고정 문구만</h3>
              <p>이 창구({result.a.decision.channel?.label})는 V14 고정 문구만 쓸 수 있습니다. 답장 초안을 만들지 않습니다.</p>
            </div>
          ) : result.a.decision.step === "hold" ? (
            <div className="card">
              <h3>보류</h3>
              <p>{result.a.decision.holdReason}</p>
            </div>
          ) : (
            <>
              <p className="small">
                규칙 통과 → 다음 단계는 AI 분류입니다. 답장 방식: {result.a.decision.replyMode ? REPLY_MODE_LABEL[result.a.decision.replyMode] : "모름"}
                {result.a.postopRead && ` · 읽은 경과일 D+${result.a.postopRead.days}("${result.a.postopRead.text}")`}
              </p>
              {result.a.retrieval && <RetrievalPanel retrieval={result.a.retrieval} />}
              <ExcerptPanel docs={result.a.excerpts} highlight={new Set()} source="live" />
              <div className="card">
                <h3>③ 생성 · ④ 검증</h3>
                <p>준비된 질문만 AI 초안이 있습니다. 직접 넣은 문장으로는 모델을 부르지 않습니다 — 규칙과 검색 단계까지가 지금 바로 동작하는 부분입니다.</p>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
