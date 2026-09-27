"use client";

/**
 * 인계 카드(PRD F5·F6). 규칙 결과, 담당 역할·응답 시한(V12), 시한 경보(기준 시각), 환자에게 보낼 승인 문구(V12)만 보인다.
 * 증상을 해석하는 말은 한 줄도 쓰지 않는다 — 한창구는 증상을 판단하지 않는다(PRD 3절 사용자 B).
 */

import type { RouteDecision } from "@/core/route";
import type { PostopDayReading } from "@/core/postop";
import { formatDuration, formatKst, minutesBetween, DEMO_NOW_MS } from "@/demo/clock";
import type { HandoverInfo } from "@/demo/inbox";
import type { HandoverPolicy } from "@/demo/policy";

const RULE_TEXT: Record<string, string> = {
  "RF-01": "증상어 + 수술 후 문맥 → 긴급 인계",
  "RF-02": "증상어(문맥 없음) → 인계",
  "RF-03": "모호어 + 수술 후 문맥 → 인계",
  "MED-01": "약 문의(용량·중단·병용) → 인계",
};

export function HandoverCard({
  decision,
  info,
  policy,
  postop,
  handedAtLabel,
  onToggleHanded,
}: {
  decision: RouteDecision;
  info: HandoverInfo | null;
  policy: HandoverPolicy;
  postop?: PostopDayReading | null;
  handedAtLabel?: string | null;
  onToggleHanded?: () => void;
}) {
  const rules = [...decision.redflag.ruleIds, ...(decision.medication.decision === "handover" ? (["MED-01"] as const) : [])];
  const words = [...decision.redflag.matchedSymptoms, ...decision.redflag.matchedAmbiguous];
  const overdueMin = info?.deadlineMs != null ? minutesBetween(info.deadlineMs, DEMO_NOW_MS) : null;
  const copy = async (t: string) => {
    try {
      await navigator.clipboard.writeText(t);
    } catch {
      // 복사가 막힌 환경에서는 문구를 직접 선택해 복사한다.
    }
  };
  return (
    <section className="card alert" aria-label="의료진 인계 카드">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2>의료진 인계 카드</h2>
        <span className={`badge ${decision.redflag.urgency === "urgent" ? "red" : "orange"}`}>{decision.redflag.urgency === "urgent" ? "긴급" : "인계"}</span>
      </div>
      <p className="small muted">규칙이 모델보다 먼저 잡았습니다. 이 문의에는 AI 답장 초안을 만들지 않습니다.</p>

      <dl className="kv">
        <dt>걸린 규칙</dt>
        <dd>
          {rules.length === 0
            ? "분류 단계에서 인계"
            : rules.map((r) => (
                <div key={r}>
                  {r} · {RULE_TEXT[r] ?? ""}
                </div>
              ))}
        </dd>
        {words.length > 0 && (
          <>
            <dt>걸린 말</dt>
            <dd>{words.map((w) => `"${w}"`).join(", ")}</dd>
          </>
        )}
        {decision.redflag.matchedContext.length > 0 && (
          <>
            <dt>수술 후 문맥</dt>
            <dd>{decision.redflag.matchedContext.map((w) => `"${w}"`).join(", ")}</dd>
          </>
        )}
        {decision.medication.matchedTerms.length > 0 && (
          <>
            <dt>약 관련 말</dt>
            <dd>{decision.medication.matchedTerms.map((w) => `"${w}"`).join(", ")}</dd>
          </>
        )}
        {postop !== undefined && (
          <>
            <dt>환자가 적은 경과일</dt>
            <dd>{postop ? `D+${postop.days} ("${postop.text}")` : "적힌 경과일 없음"}</dd>
          </>
        )}
        <dt>담당</dt>
        <dd>
          {info?.role ?? "V12에서 읽지 못함 — 인계 절차 문서를 확인하세요"}
          {info && <span className="muted small"> ({info.openNow ? "지금 진료 중" : "지금 진료시간 밖"})</span>}
        </dd>
        <dt>응답 시한</dt>
        <dd>
          {info?.deadlineMs == null ? (
            "V12에서 읽지 못함"
          ) : (
            <>
              {info.phase === "to-handover"
                ? `인계: 받은 뒤 ${policy.handoverMinutes?.value}분 안`
                : `의료진 연락 목표: 인계 뒤 ${policy.contactMinutes?.value}분 안`}
              {" · "}
              {formatKst(info.deadlineMs)}까지
              {info.overdue ? (
                <div>
                  <strong className="badge red" role="alert">
                    시한 지남 · {formatDuration(overdueMin ?? 0)} 초과
                  </strong>
                </div>
              ) : (
                <span className="badge green">남음 {formatDuration(-(overdueMin ?? 0))}</span>
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

      <h3 style={{ marginTop: 12 }}>환자에게 보낼 문구 (V12 승인 문구 그대로)</h3>
      {policy.patientMessage ? (
        <>
          <p className="quote">{policy.patientMessage.value}</p>
          <div className="row">
            <button type="button" onClick={() => copy(policy.patientMessage!.value)}>
              문구 복사
            </button>
            <span className="small muted">출처: {policy.patientMessage.chunkId} · 고쳐 쓰지 않습니다</span>
          </div>
        </>
      ) : (
        <p>V12에서 승인 문구를 읽지 못했습니다. 문구를 지어내지 않습니다 — 인계 절차 문서를 확인하세요.</p>
      )}
      {decision.replyMode === "template-only" && (
        <p className="small" style={{ marginTop: 8 }}>
          공개 창구입니다. 공개 답글에는 증상을 언급하지 않고 고정 문구만 씁니다(V12·V14).
        </p>
      )}
    </section>
  );
}
