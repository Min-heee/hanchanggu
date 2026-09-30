/**
 * 인계 카드(PRD F5·F6). 그릴 값은 src/demo/view.ts handoverCardModel이 만든다(시험으로 고정).
 * 이 컴포넌트는 값을 그리기만 한다 — 환자에게 보낼 문구를 여기서 고르거나, 시각을 여기서 재지 않는다.
 * 카드가 쓰는 글에는 증상을 해석하는 말이 한 줄도 없다 — 한창구는 증상을 판단하지 않는다(PRD 3절 사용자 B).
 * 의료진 확인용 AI 초안(PRD v0.3)은 children으로 카드 안에 붙는다(src/app/_components/HandoverDraft.tsx). 그 초안도 맨 앞 되짚기 한 문장(코드가 검사)
 * 밖에는 병원 문서 인용만이고, 직원은 보낼 수 없다. 직원이 보내는 것은 아래 V12 승인 문구뿐이다.
 *
 * 훅을 쓰지 않는 순수 컴포넌트로 둔다: 시험(renderToStaticMarkup)에서 V12 문구가 그대로 찍히는지 본다.
 */

import type { PostopDayReading } from "@/core/postop";
import type { HandoverCardModel } from "@/demo/view";

export function HandoverCard({
  model,
  postop,
  handedAtLabel,
  onToggleHanded,
  onCopy,
  children,
}: {
  model: HandoverCardModel;
  postop?: PostopDayReading | null;
  handedAtLabel?: string | null;
  onToggleHanded?: () => void;
  onCopy?: (text: string) => void;
  children?: React.ReactNode;
}) {
  return (
    <section className="card alert" aria-label="의료진 인계 카드">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2>의료진 인계 카드</h2>
        <span className={`badge ${model.urgent ? "red" : "orange"}`}>{model.urgencyLabel}</span>
      </div>
      <p className="small muted">
        {model.byClassifier ? "AI 분류가 인계로 정했습니다." : "안전 규칙이 AI보다 먼저 잡았습니다."} {model.draftNote}
      </p>

      <dl className="kv">
        <dt>걸린 규칙</dt>
        <dd>
          {model.rules.length === 0
            ? "안전 규칙은 통과, AI 분류에서 인계"
            : model.rules.map((r) => (
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
        {postop !== undefined && (
          <>
            <dt>환자가 적은 경과일</dt>
            <dd>{postop ? `수술 후 ${postop.days}일째 ("${postop.text}")` : "적힌 경과일 없음"}</dd>
          </>
        )}
        <dt>담당</dt>
        <dd>
          {model.roleAtDeadline ? (
            <>
              <div>시한 당시 담당: {model.roleAtDeadline}</div>
              <div>
                지금 담당: {model.roleNow ?? "인계 절차 문서에서 읽지 못함"} <span className="muted small">({model.openNow ? "지금 진료 중" : "지금 진료시간 밖"})</span>
              </div>
            </>
          ) : (
            <>
              {model.roleNow ?? "인계 절차 문서에서 읽지 못함 — 문서를 확인하세요"}
              {model.openNow !== null && <span className="muted small"> ({model.openNow ? "지금 진료 중" : "지금 진료시간 밖"})</span>}
            </>
          )}
        </dd>
        <dt>응답 시한</dt>
        <dd>
          {model.deadline === null ? (
            "인계 절차 문서에서 읽지 못함"
          ) : (
            <>
              {model.deadline.rule} · {model.deadline.until}{" "}
              {model.deadline.overdue ? (
                <strong className="badge red" role="alert">
                  {model.deadline.overdue}
                </strong>
              ) : (
                <span className="badge green">{model.deadline.remaining}</span>
              )}
            </>
          )}
        </dd>
      </dl>

      {onToggleHanded && (
        <div className="row" style={{ marginTop: 10 }}>
          <button type="button" className={handedAtLabel ? "" : "primary"} onClick={onToggleHanded} aria-pressed={Boolean(handedAtLabel)}>
            {handedAtLabel ? `인계함 (${handedAtLabel}) — 취소` : "의료진에게 인계함으로 표시"}
          </button>
        </div>
      )}

      <h3 style={{ marginTop: 12 }}>직원이 환자에게 보낼 문구 (병원이 승인한 문구 그대로)</h3>
      {model.patientMessage ? (
        <>
          <p className="quote">{model.patientMessage.text}</p>
          <div className="row">
            {onCopy && (
              <button type="button" onClick={() => onCopy(model.patientMessage!.text)}>
                문구 복사
              </button>
            )}
            <span className="small muted">출처: {model.patientMessage.source} · 고쳐 쓰지 않습니다</span>
          </div>
        </>
      ) : (
        <p>인계 절차 문서에서 승인 문구를 읽지 못했습니다. 문구를 지어내지 않습니다 — 문서를 확인하세요.</p>
      )}
      {children}
    </section>
  );
}
