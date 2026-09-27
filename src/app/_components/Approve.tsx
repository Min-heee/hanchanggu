"use client";

/**
 * 승인·수정·모의 발송(PRD F13). 실제 전송은 없다. 누가(역할) 어떤 문장을 고쳤는지 방문자 브라우저에 남긴다.
 * 발송 버튼은 창구의 답장 방식(V19)을 따른다: 직접 / 복사 / 전화 / 고정 문구만.
 * 발송을 켤지는 src/demo/state.ts canSend가 정한다(마지막 승인이 마지막 수정보다 뒤이고 승인본 = 보낼 글).
 * 고친 글에 금지 광고 표현(V15 banned)이 생기면 발송 버튼을 막는다(F12).
 */

import { useState } from "react";
import { checkAdExpressions } from "@/core/adcheck";
import type { ReplyMode } from "@/core/route";
import { formatKst, DEMO_NOW_MS } from "@/demo/clock";
import { addLog, canSend, changedSentences, REVIEWER_ROLES, type LogEntry, type SendCheck } from "@/demo/state";
import { engine } from "../_lib/data";
import { useDemoState } from "../_lib/useDemoState";
import { AdSignals } from "./Pipeline";

const SEND_LABEL: Record<ReplyMode, string> = {
  direct: "보내기(모의)",
  copy: "복사하고 보낸 것으로 표시(모의)",
  callback: "전화로 안내한 것으로 표시(모의)",
  "template-only": "고정 문구로 답글 단 것으로 표시(모의)",
};

const SEND_BLOCK: Record<Exclude<SendCheck, { ok: true }>["reason"], string> = {
  unsaved: "고친 글을 먼저 저장하세요.",
  "not-approved": "승인한 뒤에 보낼 수 있습니다.",
  "edited-after-approval": "승인한 뒤 글이 바뀌었습니다. 다시 승인하세요.",
  "already-sent": "이미 보냈습니다. 다시 보내려면 다시 승인하세요.",
};

const NOW_LABEL = formatKst(DEMO_NOW_MS);

export function ApprovePanel({ target, initialText, replyMode }: { target: string; initialText: string; replyMode: ReplyMode | null }) {
  const { k } = engine();
  const { state, update } = useDemoState();
  const saved = state.edits[target] ?? initialText;
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? saved;
  const [by, setBy] = useState<string>(REVIEWER_ROLES[0]);
  const ad = checkAdExpressions(text, k.ad);
  const check = canSend(state.log, target, text, saved);
  const approvedOnce = state.log.some((e) => e.target === target && e.action === "승인");

  const log = (action: LogEntry["action"], detail: string, extra: Partial<LogEntry> = {}) =>
    update((s) => addLog(s, { target, action, by, at: NOW_LABEL, detail, ...extra }));

  const saveEdit = () => {
    const changes = changedSentences(saved, text);
    if (changes.length === 0) return;
    update((s) => addLog({ ...s, edits: { ...s.edits, [target]: text } }, { target, action: "수정", by, at: NOW_LABEL, detail: `${changes.length}문장`, changes }));
    setDraft(null);
  };

  return (
    <section className="card" aria-label="승인과 모의 발송">
      <h2>직원 검토 · 승인 · 모의 발송</h2>
      <p className="small muted">실제로 보내지 않습니다. 기록은 이 브라우저에만 남습니다.</p>
      <label style={{ display: "flex", marginBottom: 8 }}>
        검토자 역할(이름은 적지 않습니다)
        <select value={by} onChange={(e) => setBy(e.target.value)}>
          {REVIEWER_ROLES.map((r) => (
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
        <button type="button" onClick={saveEdit} disabled={text === saved}>
          수정 저장
        </button>
        <button type="button" onClick={() => log("승인", approvedOnce ? "다시 승인" : "초안 승인", { text: saved })} disabled={text !== saved}>
          {approvedOnce ? "다시 승인" : "승인"}
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
        {!check.ok ? SEND_BLOCK[check.reason] : "보낼 수 있습니다."} {ad.level === "banned" ? "금지 표현이 있어 보낼 수 없습니다." : ""}
      </p>
      <ActionLog target={target} />
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
              window.confirm("이 브라우저의 시연 기록(승인·수정·발송·연락 시도·인계 표시·경과일 수정·문서 빈칸)을 모두 지울까요?") ? reset() : undefined
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
