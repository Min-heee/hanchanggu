"use client";

/**
 * 사내 Q&A(PRD F14). 문의 초안과 같은 엔진(개인정보 가림 → ①문서 찾기 → ②발췌 → ③AI 초안 → ④근거·확인).
 * 직원 질문에는 적신호·약 규칙을 돌리지 않는다 — 인계할 환자·창구가 없고, 절차를 묻는 질문의 정답은
 * 근거를 단 절차 안내다(data/README.md).
 * ①②는 어떤 질문이든 바로, ③④는 미리 만든 답이 있는 질문만. 문서 빈칸에 쌓을지는 src/demo/qa.ts gapDecision이 정한다.
 * 시연 대본 질문은 맨 위 버튼과 링크(?q=G16)로 연다 — 대본 문장을 손으로 치면 한 글자만 달라도 미리 만든 답이 붙지 않는다.
 */

import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Fill } from "@/core/template";
import { chunkDoc } from "@/core/vault";
import { analyzeStaffQuestion } from "@/demo/analyze";
import { DEMO_NOW_MS, formatKst } from "@/demo/clock";
import { gapDecision, gapEntry, preparedFromParam } from "@/demo/qa";
import { draftDisplay } from "@/demo/refill";
import { addGap } from "@/demo/state";
import {
  draftSourceLabel,
  fillSourceChunk,
  liveExcerpts,
  maskedCaseForQuestion,
  maskedView,
  recordedExcerpts,
  recordedRetrievalView,
  replaceWikiLinks,
  retrievalView,
} from "@/demo/view";
import { bundle, driftFor, engine, goldenRecord, goldenRecordByQuestion } from "../_lib/data";
import { useDemoState } from "../_lib/useDemoState";
import { MaskedText } from "./MaskedText";
import { DraftPanel, ExcerptPanel, RetrievalPanel, VerifyPanel } from "./Pipeline";

const NOW_LABEL = formatKst(DEMO_NOW_MS);
const STATUS_LABEL = { approved: "승인", draft: "초안(찾기 제외)", superseded: "옛 판(찾기 제외)" } as const;
const TYPE_LABEL: Record<string, string> = { "patient-guide": "환자 안내", policy: "규정", procedure: "절차", template: "문구", reference: "참고" };

const prepared = bundle.golden.filter((g) => g.kind === "staff-qa" && g.question);
/** 30초 시연 20~26초의 두 질문: 근거 있는 질문, 근거 없는 질문(문서 빈칸). */
const SCRIPT = [
  { id: "G16", label: "수술 3일째 머리 감기" },
  { id: "G38", label: "와이파이 비밀번호 — 문서 빈칸 예시" },
];

interface Asked {
  text: string;
  goldenId: string | null;
}

export function QaView() {
  const { k } = engine();
  const { state, update } = useDemoState();
  const params = useSearchParams();
  const [asked, setAsked] = useState<Asked | null>(null);
  const [input, setInput] = useState("");
  const [highlight, setHighlight] = useState<Set<string>>(new Set());
  const [listOpen, setListOpen] = useState(false);
  const [askSeq, setAskSeq] = useState(0);
  const resultRef = useRef<HTMLHeadingElement>(null);

  const ask = (text: string, goldenId: string | null) => {
    setAsked({ text, goldenId });
    setHighlight(new Set());
    setListOpen(false);
    setAskSeq((n) => n + 1);
    const rec = goldenId ? goldenRecord(goldenId) : goldenRecordByQuestion(text);
    const a = analyzeStaffQuestion(k, text);
    const d = gapDecision(a.retrieval, rec);
    if (d.add) update((s) => addGap(s, gapEntry(a.mask, NOW_LABEL, d.reason)));
  };

  // ?q=G16 링크: 준비된 질문만 연다.
  const param = params.get("q");
  useEffect(() => {
    const g = preparedFromParam(prepared, param);
    if (g) ask(g.question!, g.id);
    // ask는 매 렌더 새로 만들어지지만, 링크는 값이 바뀔 때만 한 번 연다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [param]);

  // 질문을 고르면 결과로 옮겨 간다. 결과가 42개 목록 아래에 그려지면 눌렀는데 아무 일도 없는 것처럼 보였다.
  useEffect(() => {
    if (askSeq === 0) return;
    const el = resultRef.current;
    el?.scrollIntoView({ block: "start" });
    el?.focus({ preventScroll: true });
  }, [askSeq]);

  const a = asked ? analyzeStaffQuestion(k, asked.text) : null;
  const rec = asked ? (asked.goldenId ? goldenRecord(asked.goldenId) : goldenRecordByQuestion(asked.text)) : null;
  const inGaps = a ? state.gaps.some((g) => g.question === a.mask.masked) : false;
  const drift = asked?.goldenId ? driftFor(asked.goldenId) : [];

  const live = a ? retrievalView(k, a.retrieval, a.mask.masked) : null;
  const recorded = rec ? recordedRetrievalView(k, { retrieval: rec.retrieval, excludedMatches: rec.excludedMatches, retrievalMeta: rec.retrievalMeta }, "staff-qa", rec.maskedQuestion, null) : null;
  const liveDiffers = recorded && live && live.items.map((x) => x.chunkId).join() !== recorded.items.map((x) => x.chunkId).join();
  // 읽는 글은 녹화의 모델 글을 지금 코드로 다시 채운 것이다(src/demo/refill.ts).
  const display = rec ? draftDisplay(k, rec.draft, "staff-qa") : null;
  const fillSources = (display?.fills ?? []).map((f) => {
    const c = fillSourceChunk(k, f);
    const chunk = c ? k.chunks.find((x) => x.chunkId === c) : undefined;
    return { fill: f, chunk: chunk ? { chunkId: chunk.chunkId, text: chunk.text } : null };
  });
  const onFill = (f: Fill) => {
    const c = fillSourceChunk(k, f);
    if (!c) return;
    setHighlight(new Set([`price:${c}`]));
    document.getElementById(`price-src-${c}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  return (
    <div>
      <section className="card" aria-labelledby="qa-title">
        <h2 id="qa-title">사내 Q&amp;A</h2>
        <p className="small muted">
          병원 문서만 근거로 답합니다.{" "}
          {bundle.recording
            ? "준비된 질문은 미리 만든 AI 답이 있고, 직접 입력한 질문은 문서 찾기·발췌까지 바로 돕니다."
            : "AI 답은 아직 준비 전입니다. 어떤 질문이든 문서 찾기·발췌는 지금 바로 돕니다."}
        </p>
        <div className="row" role="group" aria-label="시연 질문">
          {SCRIPT.map((s) => {
            const g = prepared.find((x) => x.id === s.id);
            if (!g) return null;
            return (
              <button key={s.id} type="button" className="chip" aria-pressed={asked?.goldenId === s.id} onClick={() => ask(g.question!, g.id)}>
                {s.label}
              </button>
            );
          })}
        </div>
        <form
          className="row"
          style={{ marginTop: 8 }}
          onSubmit={(e) => {
            e.preventDefault();
            if (input.trim()) ask(input.trim(), null);
          }}
        >
          <label style={{ flex: "1 1 260px" }}>
            직접 질문하기
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="예: 점심시간에도 전화 받아요?" />
          </label>
          <button type="submit" className="primary" disabled={!input.trim()}>
            찾기
          </button>
        </form>
        <details style={{ marginTop: 8 }} open={listOpen} onToggle={(e) => setListOpen((e.target as HTMLDetailsElement).open)}>
          <summary>준비된 직원 질문 {prepared.length}개</summary>
          <ul className="plain">
            {prepared.map((g) => (
              <li key={g.id}>
                <button type="button" className="link" aria-pressed={asked?.goldenId === g.id} onClick={() => ask(g.question!, g.id)}>
                  {g.question}
                </button>
              </li>
            ))}
          </ul>
        </details>
      </section>

      {asked && a && live && (
        <div aria-live="polite">
          <section className="card">
            <h2 ref={resultRef} tabIndex={-1} className="result-title">
              질문
            </h2>
            <p className="quote">{a.mask.masked}</p>
            <MaskedText view={maskedView(maskedCaseForQuestion(rec, a.mask))} />
            {drift.length > 0 && (
              <div className="note warn" role="note">
                <strong>미리 만든 AI 답 이후 바뀐 곳이 있습니다.</strong>
                <ul className="small">
                  {drift.map((m, i) => (
                    <li key={i}>{m}</li>
                  ))}
                </ul>
              </div>
            )}
          </section>
          <RetrievalPanel view={recorded ?? live} compare={liveDiffers ? live : null} />
          <div className="two-col">
            <ExcerptPanel
              docs={rec && rec.draft.documents.length > 0 ? recordedExcerpts(k, rec.draft) : liveExcerpts(k, a.excerpts)}
              highlight={highlight}
              source={rec && rec.draft.documents.length > 0 ? "recorded" : "live"}
              weak={a.retrieval.weak}
            />
            <div className="sticky-col">
              <DraftPanel
                draft={rec?.draft ?? null}
                display={display}
                sourceLabel={rec ? draftSourceLabel(bundle.recordingSource, rec.draft.meta.model, rec.draft.meta.servedByFallback) : ""}
                onCite={(ids) => {
                  setHighlight(new Set(ids));
                  document.getElementById(`para-${ids[0]}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
                }}
                onFill={onFill}
                notReadyText={
                  a.retrieval.weak
                    ? "근거가 약해 AI를 부르지 않고 보류합니다. 아래 ‘문서 빈칸’에 쌓았습니다."
                    : bundle.recording
                      ? "준비된 질문만 AI 초안이 있습니다. 이 질문은 준비되지 않았습니다."
                      : "AI 초안은 아직 준비 전입니다 — 문서 찾기와 발췌는 지금 동작합니다."
                }
              />
              <VerifyPanel draft={rec?.draft ?? null} display={display} fillSources={fillSources} highlight={highlight} />
            </div>
          </div>
          {inGaps ? (
            <p className="note small">이 질문은 &lsquo;문서 빈칸&rsquo;에 있습니다(아래).</p>
          ) : (
            <p className="row small">
              <span>발췌에 답이 없나요?</span>
              <button type="button" onClick={() => update((s) => addGap(s, gapEntry(a.mask, NOW_LABEL, "직원이 근거 없음으로 표시")))}>
                문서 빈칸에 추가
              </button>
            </p>
          )}
        </div>
      )}

      <section className="card" aria-labelledby="gaps-title">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 id="gaps-title">문서 빈칸 · 주간 보고</h2>
          {state.gaps.length > 0 && (
            <button type="button" onClick={() => (window.confirm("문서 빈칸 목록을 비울까요?") ? update((s) => ({ ...s, gaps: [] })) : undefined)}>
              문서 빈칸 비우기
            </button>
          )}
        </div>
        <p className="small muted">
          근거 문서가 없는 질문입니다. 문서를 채울 곳을 알려 줍니다. 개인정보는 가린 글로만 남기고, 이 브라우저에만 쌓입니다. 근거가 약한 질문(예: 와이파이
          비밀번호)은 자동으로 쌓입니다.{" "}
          {bundle.recording
            ? "미리 만든 AI 답이 '근거 없음'인 질문도 자동으로 쌓입니다."
            : "AI가 '근거 없음'이라고 답해야 알 수 있는 질문(예: 실손보험)은 AI 답이 준비된 뒤부터 자동으로 쌓입니다. 지금은 '문서 빈칸에 추가'를 누르세요."}
        </p>
        {state.gaps.length === 0 ? (
          <p className="muted">아직 없습니다.</p>
        ) : (
          <ol>
            {state.gaps.map((g, i) => (
              <li key={i}>
                {g.question}
                {g.masked > 0 ? ` (가림 ${g.masked}곳)` : ""}{" "}
                <span className="small muted">
                  · {g.at} · {g.reason}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="card" aria-labelledby="vault-title">
        <h2 id="vault-title">병원 문서 {k.vault.all.length}편</h2>
        <p className="small muted">문서 찾기와 근거는 승인된 최신판만 씁니다. 초안과 옛 판은 &lsquo;제외됨&rsquo;으로만 보입니다. 문서를 누르면 펼쳐집니다.</p>
        <ul className="plain">
          {[...k.vault.all]
            .sort((a, b) => a.meta.id.localeCompare(b.meta.id, "en", { numeric: true }))
            .map((d) => (
              <li key={d.meta.id}>
                <details>
                  <summary>
                    <span className="row">
                      {d.meta.title}
                      <span className={`badge ${k.allowedDocIds.has(d.meta.id) ? "green" : "gray"}`}>
                        {k.allowedDocIds.has(d.meta.id) ? STATUS_LABEL.approved : d.meta.status === "approved" ? "새 판으로 바뀜(찾기 제외)" : STATUS_LABEL[d.meta.status]}
                      </span>
                    </span>
                  </summary>
                  <p className="small muted">
                    {TYPE_LABEL[d.meta.type] ?? d.meta.type} · {d.meta.version}판 · 시행 {d.meta.effective} · 담당 {d.meta.owner}
                  </p>
                  {chunkDoc(d).map((c) => (
                    <div key={c.chunkId} className="para small" title={c.chunkId}>
                      {c.heading ? <strong>{c.heading} · </strong> : null}
                      {replaceWikiLinks(c.text, k)}
                    </div>
                  ))}
                </details>
              </li>
            ))}
        </ul>
      </section>
    </div>
  );
}
