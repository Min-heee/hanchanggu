"use client";

/**
 * 승인·수정·모의 발송(PRD F13). 실제 전송은 없다. 누가(역할) 어떤 문장을 고쳤는지 방문자 브라우저에 남긴다.
 * 발송 버튼은 창구의 답장 방식(V19)을 따른다: 직접 / 복사 / 전화 / 고정 문구만.
 * 발송을 켤지는 src/demo/state.ts canSend가 정한다(마지막 승인이 마지막 수정보다 뒤이고 승인본 = 보낼 글).
 * 고친 글에 금지 광고 표현(V15 banned)이 생기면 발송 버튼을 막는다(F12).
 *
 * clinicianOnly: 인계 문의의 의료진 확인용 AI 초안(PRD v0.3). '승인' 대신 '의료진 확인(모의)'이 있고, 역할이 의료진(간호사·의사)일 때만 켜진다.
 * 발송은 마지막 의료진 확인이 의료진 역할로 남아 있고, 보내는 사람의 역할도 의료진이어야 켜진다(canSend의 clinicianOnly·sender) —
 * 직원은 이 초안을 보낼 수 없다. '수정 저장'도 의료진 역할만 누른다: 직원이 고친 글은 인용 재검증 없이 의료진 확인 대상이 되므로,
 * 직원이 쓴 판단 문장이 '의료진 확인' 한 번으로 나가는 길을 막는다.
 */

import { useState } from "react";
import { checkAdExpressions } from "@/core/adcheck";
import type { ReplyMode } from "@/core/route";
import { formatKst, DEMO_NOW_MS } from "@/demo/clock";
import { addLog, canSend, changedSentences, HANDOVER_REVIEWER_ROLES, isClinician, REVIEWER_ROLES, type LogEntry, type SendCheck } from "@/demo/state";
import { engine } from "../_lib/data";
import { useDemoState } from "../_lib/useDemoState";
import { AdSignals } from "./Pipeline";

const SEND_LABEL: Record<ReplyMode, string> = {
  direct: "보내기(모의)",
  copy: "복사하고 보낸 것으로 표시(모의)",
  callback: "전화로 안내한 것으로 표시(모의)",
  "template-only": "고정 문구로 답글 단 것으로 표시(모의)",
};

type BlockReason = Exclude<SendCheck, { ok: true }>["reason"];

const SEND_BLOCK: Record<BlockReason, string> = {
  unsaved: "고친 글을 먼저 저장하세요.",
  "not-approved": "승인한 뒤에 보낼 수 있습니다.",
  "not-clinician-checked": "의료진이 확인한 뒤에 보낼 수 있습니다.",
  "edited-after-approval": "승인한 뒤 글이 바뀌었습니다. 다시 승인하세요.",
  "already-sent": "이미 보냈습니다. 다시 보내려면 다시 승인하세요.",
  "sender-not-clinician": "의료진만 보낼 수 있습니다.",
};

/** 인계 초안(의료진 확인용)의 막힌 이유. 직원이 무엇을 대신 보내는지까지 적는다. */
export const CLINICIAN_SEND_BLOCK: Record<BlockReason, string> = {
  unsaved: "고친 글을 먼저 저장하세요.",
  "not-approved": "의료진이 확인하기 전에는 보낼 수 없습니다.",
  "not-clinician-checked": "의료진이 확인하기 전에는 보낼 수 없습니다. 직원(CS 직원·코디네이터·상담실장)은 이 초안을 보내지 않고 위 승인 문구만 보냅니다.",
  "edited-after-approval": "의료진이 확인한 뒤 글이 바뀌었습니다. 의료진이 다시 확인해야 보낼 수 있습니다.",
  "already-sent": "이미 보냈습니다. 다시 보내려면 의료진이 다시 확인하세요.",
  "sender-not-clinician": "의료진이 확인했지만, 보내는 것도 의료진(간호사·의사)만 합니다. 직원은 이 초안을 보내지 않고 위 승인 문구만 보냅니다.",
};

/** 인계 초안 패널에서 직원 역할로 글을 고쳤을 때. 저장 버튼이 꺼진 까닭을 적는다. */
export const STAFF_CANNOT_EDIT = "직원 역할은 이 초안을 고쳐 저장할 수 없습니다. 의료진(간호사·의사)만 고치고 확인합니다.";

const NOW_LABEL = formatKst(DEMO_NOW_MS);

export function ApprovePanel({
  target,
  initialText,
  replyMode,
  clinicianOnly = false,
  showLog = true,
}: {
  target: string;
  initialText: string;
  replyMode: ReplyMode | null;
  /** 인계 문의의 의료진 확인용 AI 초안: 의료진 확인 기록이 있어야 발송이 켜진다. */
  clinicianOnly?: boolean;
  /** 기록 목록을 이 패널에 붙일지(인계 카드는 카드 아래에 이미 붙인다). */
  showLog?: boolean;
}) {
  const { k } = engine();
  const { state, update } = useDemoState();
  const saved = state.edits[target] ?? initialText;
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? saved;
  const roles: readonly string[] = clinicianOnly ? HANDOVER_REVIEWER_ROLES : REVIEWER_ROLES;
  const [by, setBy] = useState<string>(roles[0]);
  const ad = checkAdExpressions(text, k.ad);
  // 인계 초안은 확인도 발송도 의료진 역할로만(보내는 사람의 역할을 함께 넘긴다).
  const check = canSend(state.log, target, text, saved, clinicianOnly ? { clinicianOnly: true, sender: by } : {});
  const approveAction: LogEntry["action"] = clinicianOnly ? "의료진 확인" : "승인";
  const approvedOnce = state.log.some((e) => e.target === target && e.action === approveAction);
  // 의료진 확인과 수정 저장은 의료진 역할만 누를 수 있다. 직원 역할을 고르면 버튼이 꺼진다.
  const roleOk = !clinicianOnly || isClinician(by);
  const canApprove = text === saved && roleOk;
  const block = clinicianOnly ? CLINICIAN_SEND_BLOCK : SEND_BLOCK;
  const approveLabel = clinicianOnly ? (approvedOnce ? "다시 확인(모의)" : "의료진 확인(모의)") : approvedOnce ? "다시 승인" : "승인";

  const log = (action: LogEntry["action"], detail: string, extra: Partial<LogEntry> = {}) =>
    update((s) => addLog(s, { target, action, by, at: NOW_LABEL, detail, ...extra }));

  const saveEdit = () => {
    if (!roleOk) return;
    const changes = changedSentences(saved, text);
    if (changes.length === 0) return;
    update((s) => addLog({ ...s, edits: { ...s.edits, [target]: text } }, { target, action: "수정", by, at: NOW_LABEL, detail: `${changes.length}문장`, changes }));
    setDraft(null);
  };

  return (
    <section className="card" aria-label={clinicianOnly ? "의료진 확인과 모의 발송" : "승인과 모의 발송"}>
      <h2>{clinicianOnly ? "의료진 확인 · 모의 발송" : "직원 검토 · 승인 · 모의 발송"}</h2>
      <p className="small muted">
        실제로 보내지 않습니다. 기록은 이 브라우저에만 남습니다.
        {clinicianOnly && " 이 초안은 의료진(간호사·의사)이 확인해야만 보낼 수 있습니다. 역할은 로그인 없이 스스로 고르는 모의 확인입니다. 직원 역할을 고르면 수정 저장·확인·발송 버튼이 꺼집니다."}
      </p>
      <label style={{ display: "flex", marginBottom: 8 }}>
        {clinicianOnly ? "확인하는 사람의 역할(이름은 적지 않습니다)" : "검토자 역할(이름은 적지 않습니다)"}
        <select value={by} onChange={(e) => setBy(e.target.value)}>
          {roles.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </label>
      <label style={{ display: "flex" }}>
        보낼 글(고칠 수 있음)
        <textarea value={text} onChange={(e) => setDraft(e.target.value)} rows={6} />
      </label>
      <AdSignals hits={ad.hits} label="고친 글의 광고 표현 신호" />
      <div className="row" style={{ marginTop: 8 }}>
        <button type="button" onClick={saveEdit} disabled={text === saved || !roleOk}>
          수정 저장
        </button>
        <button
          type="button"
          onClick={() => log(approveAction, clinicianOnly ? (approvedOnce ? "다시 확인" : "인계 초안 확인") : approvedOnce ? "다시 승인" : "초안 승인", { text: saved })}
          disabled={!canApprove}
        >
          {approveLabel}
        </button>
        <button
          type="button"
          className="primary"
          disabled={!check.ok || ad.level === "banned" || !replyMode}
          onClick={() => log("모의 발송", replyMode ? SEND_LABEL[replyMode] : "", { text: saved })}
        >
          {replyMode ? SEND_LABEL[replyMode] : "답장 방식 모름"}
        </button>
      </div>
      <p className="small muted" aria-live="polite">
        {!check.ok ? (check.reason === "unsaved" && !roleOk ? STAFF_CANNOT_EDIT : block[check.reason]) : "보낼 수 있습니다."}{" "}
        {ad.level === "banned" ? "금지 표현이 있어 보낼 수 없습니다." : ""}
      </p>
      {showLog && <ActionLog target={target} />}
    </section>
  );
}

/**
 * 시연 기록. target이 있으면 그 문의 것만. showReset이면 전체 초기화 버튼을 붙인다(머리의 '시연 기록'에서).
 * 인계 카드·확정 대기·경과일 카드도 이 목록을 붙여, 기록을 만든 자리에서 본다.
 */
export function ActionLog({
  target,
  showReset = false,
  title = "기록",
  actions,
  hideWhenEmpty = false,
}: {
  target?: string;
  showReset?: boolean;
  title?: string;
  actions?: LogEntry["action"][];
  hideWhenEmpty?: boolean;
}) {
  const { state, reset } = useDemoState();
  const entries = state.log.filter((e) => (!target || e.target === target) && (!actions || actions.includes(e.action))).sort((a, b) => b.seq - a.seq);
  if (hideWhenEmpty && entries.length === 0) return null;
  return (
    <div style={{ marginTop: 12 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h3>{title}</h3>
        {showReset && (
          <button
            type="button"
            onClick={() =>
              window.confirm("이 브라우저의 시연 기록(승인·의료진 확인·수정·발송·연락 시도·인계 표시·경과일 수정·문서 빈칸)을 모두 지울까요?") ? reset() : undefined
            }
          >
            시연 기록 초기화
          </button>
        )}
      </div>
      {showReset && <p className="small muted">문서 빈칸 {state.gaps.length}건도 함께 지웁니다. 기록은 이 브라우저에만 있습니다.</p>}
      {entries.length === 0 ? (
        <p className="small muted">아직 기록이 없습니다.</p>
      ) : (
        <ol className="small" reversed>
          {entries.map((e) => (
            <li key={e.seq}>
              {e.at} · {e.by} · {!target && `${e.target} · `}
              <strong>{e.action}</strong>
              {e.detail ? ` · ${e.detail}` : ""}
              {e.changes && (
                <ul>
                  {e.changes.map((c, i) => (
                    <li key={i}>
                      {c.before ? <del>{c.before}</del> : "(없음)"} → {c.after ? <ins>{c.after}</ins> : "(삭제)"}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** 공개 창구(리뷰·댓글) 고정 문구 고르기(F11). 문구를 고쳐 쓰지 않는다(V14). */
export function TemplatePicker({ target }: { target: string }) {
  const { k } = engine();
  const { state, update } = useDemoState();
  // 고른 문구는 글 그대로 기록한다(문구 키 'review-thanks' 같은 기계 이름은 직원에게 뜻이 없다).
  const chosenText = [...state.log].reverse().find((e) => e.target === target && e.action === "고정 문구 선택")?.text ?? null;
  const chosen = k.publicTemplates.find((t) => t.text === chosenText)?.key ?? null;
  return (
    <section className="card warn" aria-label="공개 창구 고정 문구">
      <h2>공개 창구 — 고정 문구만</h2>
      <p className="small muted">공개 답글은 치료 내용·방문 사실·개인 상황을 언급하지 않습니다. 병원이 정한 문구 중 하나를 고르고, 고쳐 쓰지 않습니다.</p>
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="sr-only">고정 문구</legend>
        {k.publicTemplates.map((t, i) => (
          <label key={t.key} className="radio-row">
            <input
              type="radio"
              name={`tpl-${target}`}
              checked={chosen === t.key}
              onChange={() => update((s) => addLog(s, { target, action: "고정 문구 선택", by: "CS 직원", at: NOW_LABEL, detail: `문구 ${i + 1}`, text: t.text }))}
            />
            <span>
              <strong>문구 {i + 1}</strong> {t.text}
            </span>
          </label>
        ))}
      </fieldset>
      <div className="row" style={{ marginTop: 8 }}>
        <button
          type="button"
          className="primary"
          disabled={!chosen}
          onClick={() =>
            update((s) =>
              addLog(s, { target, action: "모의 발송", by: "CS 직원", at: NOW_LABEL, detail: SEND_LABEL["template-only"], ...(chosenText ? { text: chosenText } : {}) }),
            )
          }
        >
          {SEND_LABEL["template-only"]}
        </button>
        {!chosen && <span className="small muted">문구를 먼저 고르세요.</span>}
      </div>
      <ActionLog target={target} />
    </section>
  );
}
