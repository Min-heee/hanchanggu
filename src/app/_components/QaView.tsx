"use client";

/**
 * 사내 Q&A(PRD F14). 문의 초안과 같은 엔진(가림 → ①검색 → ②발췌 → ③생성 → ④검증).
 * 직원 질문에는 적신호·약 게이트를 돌리지 않는다 — 인계할 환자·창구가 없고, 절차를 묻는 질문의 정답은
 * 근거를 단 절차 안내다(data/README.md).
 * ①②는 어떤 질문이든 바로, ③④는 녹화된 질문만. 근거 없는 질문은 '문서 빈칸'에 쌓인다(이 브라우저에만).
 */

import { useState } from "react";
import { chunkDoc } from "@/core/vault";
import { analyzeStaffQuestion } from "@/demo/analyze";
import { DEMO_NOW_MS, formatKst } from "@/demo/clock";
import { addGap } from "@/demo/state";
import { bundle, engine, goldenRecord, goldenRecordByQuestion } from "../_lib/data";
import { useDemoState } from "../_lib/useDemoState";
import { MaskedText } from "./MaskedText";
import { DraftPanel, ExcerptPanel, RetrievalPanel, VerifyPanel } from "./Pipeline";

const NOW_LABEL = formatKst(DEMO_NOW_MS);
const STATUS_LABEL = { approved: "승인", draft: "초안(검색 제외)", superseded: "옛 판(검색 제외)" } as const;
const TYPE_LABEL: Record<string, string> = { "patient-guide": "환자 안내", policy: "규정", procedure: "절차", template: "문구", reference: "참고" };

const prepared = bundle.golden.filter((g) => g.kind === "staff-qa" && g.question);

export function QaView() {
  const { k } = engine();
  const { state, update } = useDemoState();
  const [question, setQuestion] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [highlight, setHighlight] = useState<Set<string>>(new Set());

  const ask = (q: string, goldenId: string | null) => {
    setQuestion(q);
    setHighlight(new Set());
    const rec = goldenId ? goldenRecord(goldenId) : goldenRecordByQuestion(q);
    const a = analyzeStaffQuestion(k, q);
    // 근거 없음이 확실한 경우만 자동으로 쌓는다: 검색된 문단이 없거나, 녹화된 답이 '근거 없음'으로 보류됐을 때.
    const noEvidence = rec?.draft.holdReasons.some((h) => h.code === "no-evidence" || h.code === "no-sources");
    if (a.retrieval.hits.length === 0 || noEvidence) {
      update((s) => addGap(s, { question: q, at: NOW_LABEL, reason: a.retrieval.hits.length === 0 ? "검색된 문단 없음" : "AI가 '근거 없음'으로 답함(녹화)" }));
    }
  };

  const a = question ? analyzeStaffQuestion(k, question) : null;
  const rec = question
    ? prepared.find((g) => g.question === question)
      ? goldenRecord(prepared.find((g) => g.question === question)!.id)
      : goldenRecordByQuestion(question)
    : null;
  const inGaps = question ? state.gaps.some((g) => g.question === question) : false;

  return (
    <div>
      <section className="card" aria-labelledby="qa-title">
        <h2 id="qa-title">사내 Q&amp;A</h2>
        <p className="small muted">병원 문서(볼트)만 근거로 답합니다. 준비된 질문은 AI 답이 녹화돼 있고, 직접 입력한 질문은 검색·발췌까지 바로 돕니다.</p>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            if (input.trim()) ask(input.trim(), null);
          }}
        >
          <label style={{ flex: "1 1 260px" }}>
            질문
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="예: 대기실 와이파이 비밀번호가 뭐예요?" />
          </label>
          <button type="submit" className="primary" disabled={!input.trim()}>
            찾기
          </button>
        </form>
        <details style={{ marginTop: 8 }}>
          <summary>준비된 질문 {prepared.length}개 (골든셋 직원 질문)</summary>
          <ul style={{ listStyle: "none", padding: 0 }}>
            {prepared.map((g) => (
              <li key={g.id}>
                <button type="button" className="link" style={{ textAlign: "left", minHeight: 44 }} onClick={() => ask(g.question!, g.id)}>
                  {g.id} · {g.question}
                </button>
              </li>
            ))}
          </ul>
        </details>
      </section>

      {question && a && (
        <div aria-live="polite">
          <section className="card">
            <h2>질문</h2>
            <p className="quote">{question}</p>
            <MaskedText original={question} mask={a.mask} />
          </section>
          <RetrievalPanel retrieval={a.retrieval} />
          <div className="two-col">
            <ExcerptPanel
              docs={rec ? rec.draft.documents.map((d) => ({ docId: d.docId, title: k.titles.get(d.docId) ?? d.docId, chunks: d.blocks })) : a.excerpts}
              highlight={highlight}
              source={rec ? "recorded" : "live"}
            />
            <div className="sticky-col">
              <DraftPanel
                draft={rec?.draft ?? null}
                onCite={(ids) => {
                  setHighlight(new Set(ids));
                  document.getElementById(`para-${ids[0]}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
                }}
                notRecordedText={
                  bundle.recording
                    ? "준비된 질문만 AI 초안이 있습니다. 이 질문은 녹화되지 않았습니다."
                    : "AI 초안은 녹화 전입니다 — 규칙·검색 단계는 지금 바로 동작합니다."
                }
              />
              <VerifyPanel draft={rec?.draft ?? null} />
            </div>
          </div>
          {!inGaps && (
            <p className="row small">
              <span>발췌에 답이 없나요?</span>
              <button type="button" onClick={() => update((s) => addGap(s, { question, at: NOW_LABEL, reason: "직원이 근거 없음으로 표시" }))}>
                문서 빈칸에 추가
              </button>
            </p>
          )}
        </div>
      )}

      <section className="card" aria-labelledby="gaps-title">
        <h2 id="gaps-title">문서 빈칸 · 주간 보고</h2>
        <p className="small muted">
          근거 문서가 없는 질문입니다. 문서를 채울 곳을 알려 줍니다. 이 브라우저에만 쌓입니다(초기화는 목록의 &lsquo;기록 초기화&rsquo;).
        </p>
        {state.gaps.length === 0 ? (
          <p className="muted">
            아직 없습니다. 준비된 질문 중 근거 없는 질문(예: 와이파이, 실손보험)을 고르거나, 발췌에 답이 없을 때 &lsquo;문서 빈칸에 추가&rsquo;를 누르면
            쌓입니다.
          </p>
        ) : (
          <ol>
            {state.gaps.map((g, i) => (
              <li key={i}>
                {g.question}{" "}
                <span className="small muted">
                  · {g.at} · {g.reason}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="card" aria-labelledby="vault-title">
        <h2 id="vault-title">볼트 문서 {k.vault.all.length}편</h2>
        <p className="small muted">검색·인용은 승인된 최신판만 씁니다. 초안과 옛 판은 &lsquo;제외됨&rsquo;으로만 보입니다.</p>
        <ul style={{ listStyle: "none", padding: 0 }}>
          {[...k.vault.all]
            .sort((a, b) => a.meta.id.localeCompare(b.meta.id, "en", { numeric: true }))
            .map((d) => (
              <li key={d.meta.id} style={{ borderTop: "1px solid var(--line)" }}>
                <details>
                  <summary>
                    <span className="row">
                      <span className="badge">{d.meta.id}</span>
                      {d.meta.title}
                      <span className={`badge ${d.meta.status === "approved" && k.allowedDocIds.has(d.meta.id) ? "green" : "gray"}`}>
                        {k.allowedDocIds.has(d.meta.id)
                          ? STATUS_LABEL.approved
                          : d.meta.status === "approved"
                            ? "대체됨(검색 제외)"
                            : STATUS_LABEL[d.meta.status]}
                      </span>
                    </span>
                  </summary>
                  <p className="small muted">
                    {TYPE_LABEL[d.meta.type] ?? d.meta.type} · {d.meta.version}판 · 시행 {d.meta.effective} · 담당 {d.meta.owner}
                    {d.meta.supersedes ? ` · ${d.meta.supersedes}를 대체` : ""}
                  </p>
                  {chunkDoc(d).map((c) => (
                    <div key={c.chunkId} className="para small">
                      <span className="badge" style={{ marginRight: 6 }}>
                        {c.chunkId}
                      </span>
                      {c.heading ? <strong>{c.heading} · </strong> : null}
                      {c.text}
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
