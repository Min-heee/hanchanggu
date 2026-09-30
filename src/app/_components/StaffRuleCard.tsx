/**
 * 사내 Q&A의 규칙 카드. 그릴 값은 src/demo/qa.ts staffRuleCard가 만든다(시험으로 고정).
 * 문의함 인계 카드(HandoverCard)와 모양·말을 맞추되, 읽는 사람이 직원이라 "이 질문을 받은 직원이 할 일"로 쓴다.
 * 인계 절차는 문서 원문을 그대로 인용한다 — 코드가 절차를 요약해 쓰면 문서가 바뀌어도 카드만 옛 절차로 남는다.
 * 2026-09-30(PRD v0.3)부터 문의함의 인계 건에는 의료진 확인용 AI 초안이 붙지만, 직원이 할 일은 그대로다(인계하고 승인 문구만 보냄).
 * 그래서 이 카드의 동작과 머리말("직원은 증상·약에 답하지 않습니다")은 바꾸지 않고, 그 사실만 한 줄 덧붙인다.
 *
 * 훅을 쓰지 않는 순수 컴포넌트로 둔다: 시험(renderToStaticMarkup)에서 V12 문단이 그대로 찍히는지 본다.
 */

import type { StaffRuleCardModel } from "@/demo/qa";

export function StaffRuleCard({ model }: { model: StaffRuleCardModel }) {
  return (
    <section className="card alert" aria-label="적신호·약 규칙 카드">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2>의료진 인계 먼저</h2>
        <span className={`badge ${model.urgent ? "red" : "orange"}`}>{model.urgencyLabel}</span>
      </div>
      <p>
        <strong>{model.headline}</strong>
      </p>
      <p className="small muted">안전 규칙이 AI보다 먼저 잡았습니다. 아래 AI 답과 다르면 이 카드대로 하세요.</p>

      <dl className="kv">
        <dt>걸린 규칙</dt>
        <dd>
          {model.rules.map((r) => (
            <div key={r.id}>
              {r.text} <span className="muted small">({r.id})</span>
            </div>
          ))}
        </dd>
        {model.words.length > 0 && (
          <>
            <dt>걸린 말</dt>
            <dd>{model.words.map((w) => `"${w}"`).join(", ")}</dd>
          </>
        )}
        {model.context.length > 0 && (
          <>
            <dt>수술 뒤라는 말</dt>
            <dd>{model.context.map((w) => `"${w}"`).join(", ")}</dd>
          </>
        )}
        {model.medTerms.length > 0 && (
          <>
            <dt>약 관련 말</dt>
            <dd>{model.medTerms.map((w) => `"${w}"`).join(", ")}</dd>
          </>
        )}
        <dt>응답 시한</dt>
        <dd>{model.deadlineText}</dd>
      </dl>

      <h3 style={{ marginTop: 12 }}>인계 절차 (문서 원문 그대로)</h3>
      {model.quotes.length > 0 ? (
        <>
          {model.quotes.map((q) => (
            <p key={q.chunkId} className="quote" title={q.chunkId}>
              {q.heading ? <strong>{q.heading} · </strong> : null}
              {q.text}
            </p>
          ))}
          <p className="small muted">출처: {model.docTitle}</p>
        </>
      ) : (
        <p>{model.docTitle}에서 해당 문단을 읽지 못했습니다. 절차를 지어내지 않습니다 — 문서를 확인하세요.</p>
      )}

      <h3 style={{ marginTop: 12 }}>인계한 뒤 환자에게 보낼 문구 (병원이 승인한 문구 그대로)</h3>
      {model.patientMessage ? (
        <>
          <p className="quote">{model.patientMessage.text}</p>
          <p className="small muted">출처: {model.patientMessage.source} · 고쳐 쓰지 않습니다</p>
          <p className="small muted">문의함의 인계 건에는 AI가 병원 문서만 인용한 의료진 확인용 초안이 붙지만, 직원은 그 초안을 보내지 않습니다.</p>
        </>
      ) : (
        <p>인계 절차 문서에서 승인 문구를 읽지 못했습니다. 문구를 지어내지 않습니다 — 문서를 확인하세요.</p>
      )}
    </section>
  );
}
