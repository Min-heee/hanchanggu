"use client";

/**
 * 승인·수정·모의 발송(PRD F13). 실제 전송은 없다. 누가 어떤 문장을 고쳤는지 방문자 브라우저에 남긴다.
 * 발송 버튼은 창구의 답장 방식(V19)을 따른다: 직접 / 복사 / 전화 / 고정 문구만.
 * 고친 글에 금지 광고 표현(V15 banned)이 생기면 발송 버튼을 막는다(F12).
 */

import { useState } from "react";
import { checkAdExpressions } from "@/core/adcheck";
import type { ReplyMode } from "@/core/route";
import { formatKst, DEMO_NOW_MS } from "@/demo/clock";
import { addLog, changedSentences, type LogEntry } from "@/demo/state";
import { engine } from "../_lib/data";
import { useDemoState } from "../_lib/useDemoState";
import { AdSignals } from "./Pipeline";

const SEND_LABEL: Record<ReplyMode, string> = {
  direct: "보내기(모의)",
  copy: "복사하고 보낸 것으로 표시(모의)",
  callback: "전화로 안내한 것으로 표시(모의)",
  "template-only": "고정 문구로 답글 단 것으로 표시(모의)",
};

const NOW_LABEL = formatKst(DEMO_NOW_MS);

export function ApprovePanel({ target, initialText, replyMode }: { target: string; initialText: string; replyMode: ReplyMode | null }) {
  const { k } = engine();
  const { state, update } = useDemoState();
  const saved = state.edits[target];
  const current = saved ?? initialText;
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? current;
  const [by, setBy] = useState("CS 직원");
  const ad = checkAdExpressions(text, k.ad);
  const sent = state.log.some((e) => e.target === target && e.action === "모의 발송");
  const approved = state.log.some((e) => e.target === target && e.action === "승인");

  const log = (action: LogEntry["action"], detail: string, changes?: LogEntry["changes"]) =>
    update((s) => addLog(s, { target, action, by: by.trim() || "이름 없음", at: NOW_LABEL, detail, ...(changes ? { changes } : {}) }));

  const saveEdit = () => {
    const changes = changedSentences(current, text);
    if (changes.length === 0) return;
    update((s) =>
      addLog(
        { ...s, edits: { ...s.edits, [target]: text } },
        { target, action: "수정", by: by.trim() || "이름 없음", at: NOW_LABEL, detail: `${changes.length}문장`, changes },
      ),
    );
    setDraft(null);
  };

  return (
    <section className="card" aria-label="승인과 모의 발송">
      <h2>직원 검토 · 승인 · 모의 발송</h2>
      <p className="small muted">실제로 보내지 않습니다. 기록은 이 브라우저에만 남습니다.</p>
      <label style={{ display: "flex", marginBottom: 8 }}>
        검토자
        <input value={by} onChange={(e) => setBy(e.target.value)} />
      </label>
      <label style={{ display: "flex" }}>
        보낼 글(고칠 수 있음)
        <textarea value={text} onChange={(e) => setDraft(e.target.value)} rows={6} />
      </label>
      <AdSignals hits={ad.hits} label="고친 글의 광고 표현 신호" />
      <div className="row" style={{ marginTop: 8 }}>
        <button type="button" onClick={saveEdit} disabled={text === current}>
          수정 저장
        </button>
        <button type="button" onClick={() => log("승인", approved ? "다시 승인" : "초안 승인")} disabled={text !== current}>
          {approved ? "다시 승인" : "승인"}
        </button>
        <button
          type="button"
          className="primary"
          disabled={!approved || text !== current || ad.level === "banned" || !replyMode}
          onClick={() => log("모의 발송", replyMode ? SEND_LABEL[replyMode] : "")}
        >
          {replyMode ? SEND_LABEL[replyMode] : "답장 방식 모름"}
        </button>
      </div>
      <p className="small muted">
        {text !== current ? "고친 글을 먼저 저장하세요. " : ""}
        {!approved ? "승인한 뒤에 보낼 수 있습니다. " : ""}
        {ad.level === "banned" ? "금지 표현이 있어 보낼 수 없습니다. " : ""}
        {sent ? "모의 발송 기록이 있습니다." : ""}
      </p>
      <ActionLog target={target} />
    </section>
  );
}

export function ActionLog({ target }: { target?: string }) {
  const { state, reset } = useDemoState();
  const entries = state.log.filter((e) => !target || e.target === target).sort((a, b) => b.seq - a.seq);
  return (
    <div style={{ marginTop: 12 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h3>기록</h3>
        <button
          type="button"
          onClick={() => (window.confirm("이 브라우저의 시연 기록(승인·수정·발송·연락 시도·인계 표시·문서 빈칸)을 모두 지울까요?") ? reset() : undefined)}
        >
          기록 초기화
        </button>
      </div>
      {entries.length === 0 ? (
        <p className="small muted">아직 기록이 없습니다.</p>
      ) : (
        <ol className="small" reversed>
          {entries.map((e) => (
            <li key={e.seq}>
              #{e.seq} {e.at} · {e.by} · {!target && `${e.target} · `}
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
  const chosen = [...state.log].reverse().find((e) => e.target === target && e.action === "고정 문구 선택")?.detail ?? null;
  return (
    <section className="card" aria-label="공개 창구 고정 문구">
      <h2>공개 창구 — 고정 문구만 (F11)</h2>
      <p className="small muted">공개 답글은 치료 내용·방문 사실·개인 상황을 언급하지 않습니다. V14 문구 중 하나를 고르고, 고쳐 쓰지 않습니다.</p>
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="sr-only">고정 문구</legend>
        {k.publicTemplates.map((t) => (
          <label
            key={t.key}
            style={{ flexDirection: "row", alignItems: "flex-start", gap: 8, minHeight: 44, padding: "6px 0", color: "var(--text)", fontSize: "1rem" }}
          >
            <input
              type="radio"
              name={`tpl-${target}`}
              checked={chosen === t.key}
              onChange={() => update((s) => addLog(s, { target, action: "고정 문구 선택", by: "CS 직원", at: NOW_LABEL, detail: t.key }))}
              style={{ minHeight: 24, width: 24 }}
            />
            <span>
              <span className="badge">{t.key}</span> {t.text}
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
            update((s) => addLog(s, { target, action: "모의 발송", by: "CS 직원", at: NOW_LABEL, detail: `${SEND_LABEL["template-only"]} · ${chosen}` }))
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
