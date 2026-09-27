"use client";

/**
 * ①검색 → ②발췌 → ③생성 → ④근거·검증 네 단계를 그대로 보인다(PRD 2절).
 * ①②는 브라우저에서 방금 돌린 결과, ③④는 미리 녹화한 결과다. 녹화가 없으면 그렇다고 쓴다.
 */

import type { Retrieval } from "@/core/retrieve";
import type { ExcludeReason } from "@/core/vault";
import type { DraftResult } from "@/llm/draft";
import { StepTitle } from "./Badges";
import { engine } from "../_lib/data";

const EXCLUDE_LABEL: Record<ExcludeReason, string> = {
  superseded: "옛 판",
  replaced: "새 판으로 대체됨",
  draft: "승인 전 초안",
  "not-yet-effective": "시행 전",
};

/** 검색 조각 이름(`w:예약금`, `g:예약`)을 사람이 읽는 말로. */
function termLabel(t: string): string {
  return t.replace(/^[wg]:/, "");
}

export function RetrievalPanel({ retrieval }: { retrieval: Retrieval }) {
  const { k } = engine();
  const shownExcluded = retrieval.excluded.filter((e) => e.matched);
  return (
    <section className="card" aria-label="① 검색">
      <StepTitle n="1">검색</StepTitle>
      <p className="small muted">
        승인된 최신 문서의 문단만 찾습니다(문자 2-gram BM25). 질의: &ldquo;{retrieval.query || "(빈 질의)"}&rdquo;
        {retrieval.postopDay !== null && ` · 경과일 D+${retrieval.postopDay} 구간 문단을 앞에 세움`}
      </p>
      {retrieval.hits.length === 0 ? (
        <p>걸린 문단이 없습니다. 모델을 부르지 않고 보류합니다(문서 빈칸).</p>
      ) : (
        <ol className="hits">
          {retrieval.hits.map((h) => (
            <li key={h.chunk.chunkId}>
              <div className="row small">
                <strong>{h.rank}위</strong>
                <span className="badge">{h.chunk.chunkId}</span>
                <span>
                  {k.titles.get(h.chunk.docId)}
                  {h.chunk.heading ? ` › ${h.chunk.heading}` : ""}
                </span>
                <span className="num">점수 {h.score.toFixed(2)}</span>
                {h.postopBoost && <span className="badge orange">경과일 구간</span>}
              </div>
              <div className="small muted">
                걸린 조각: {[...new Set(h.matchedTerms.map(termLabel))].slice(0, 12).join(" · ") || "없음(경과일 구간으로 앞에 섬)"}
              </div>
            </li>
          ))}
        </ol>
      )}
      {shownExcluded.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <h3>제외됨 — 관련은 있지만 쓰지 않는 문서</h3>
          <ul className="small">
            {shownExcluded.map((e) => (
              <li key={e.doc.id}>
                <span className="badge gray">제외됨 · {EXCLUDE_LABEL[e.doc.reason]}</span> {e.doc.id} {e.doc.title} (v{e.doc.version}
                {e.doc.supersededBy ? `, ${e.doc.supersededBy}로 대체` : ""}) · 가장 높은 점수 {e.bestScore.toFixed(2)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

export interface ExcerptDoc {
  docId: string;
  title: string;
  chunks: { chunkId: string; text: string }[];
}

export function ExcerptPanel({ docs, highlight, source }: { docs: ExcerptDoc[]; highlight: ReadonlySet<string>; source: "live" | "recorded" }) {
  return (
    <section className="card" aria-label="② 발췌">
      <StepTitle n="2">발췌</StepTitle>
      <p className="small muted">
        {source === "recorded"
          ? "녹화 때 모델이 실제로 받은 문단입니다. ③의 인용 번호를 누르면 해당 문단이 칠해집니다."
          : "검색된 문단을 문서별로 묶었습니다. 모델에는 이 문단만 보냅니다."}
      </p>
      {docs.length === 0 && <p>보낼 문단이 없습니다.</p>}
      {docs.map((d) => (
        <div key={d.docId} style={{ marginTop: 8 }}>
          <h3>
            {d.docId} {d.title}
          </h3>
          {d.chunks.map((c) => (
            <div key={c.chunkId} id={`para-${c.chunkId}`} className={`para${highlight.has(c.chunkId) ? " hl" : ""}`}>
              <span className="badge" style={{ marginRight: 6 }}>
                {c.chunkId}
              </span>
              {highlight.has(c.chunkId) && <span className="sr-only">(인용된 문단)</span>}
              {c.text}
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}

/** 문장 안의 자리표시자를 코드가 넣은 값으로 바꿔 보인다. 값은 초록 칸으로 칠해 "모델이 쓴 숫자가 아님"을 드러낸다. */
function withFills(text: string, fills: DraftResult["fills"]) {
  const parts = text.split(/(\{\{[^{}]*\}\})/g);
  return parts.map((p, i) => {
    const f = fills.find((x) => x.placeholder === p);
    if (!f) return <span key={i}>{p}</span>;
    return (
      <span key={i} className="fill" title={`${f.sourceDoc}에서 코드가 넣은 값`}>
        {f.value}
        <span className="sr-only">(가격표에서 코드가 넣은 값)</span>
      </span>
    );
  });
}

const KIND_LABEL = { cited: "인용", allowlisted: "인사·맺음", template: "가격·시간 칸", uncited: "인용 없음" } as const;

export function DraftPanel({ draft, onCite, notRecordedText }: { draft: DraftResult | null; onCite: (chunkIds: string[]) => void; notRecordedText: string }) {
  if (!draft) {
    return (
      <section className="card" aria-label="③ 생성">
        <StepTitle n="3">생성</StepTitle>
        <p>{notRecordedText}</p>
      </section>
    );
  }
  // 인용 번호는 문서에 보낸 문단 순서대로 1부터 붙인다(같은 문단은 같은 번호).
  const order: string[] = draft.documents.flatMap((d) => d.blocks.map((b) => b.chunkId));
  const numOf = (id: string) => order.indexOf(id) + 1;
  return (
    <section className="card" aria-label="③ 생성">
      <StepTitle n="3">생성</StepTitle>
      <p className="small muted">
        미리 생성한 AI 응답 · {draft.meta.model ?? "모델 정보 없음"}
        {draft.meta.servedByFallback ? " (대체 모델이 답함)" : ""}. 문장마다 인용 번호를 누르면 ②에서 원문 문단이 칠해집니다.
      </p>
      {draft.sentences.length === 0 ? (
        <p className="quote">{draft.modelText || "(빈 응답)"}</p>
      ) : (
        <div>
          {draft.sentences.map((s) => {
            const ids = [...new Set(s.citations.flatMap((c) => c.chunkIds))];
            return (
              <p key={s.index} className={`sentence${s.problems.length > 0 ? " bad" : ""}`}>
                {withFills(s.text, draft.fills)}
                {ids.map((id) => (
                  <button key={id} type="button" className="cite" onClick={() => onCite([id])} aria-label={`인용 ${numOf(id)}: ${id} 문단 보기`}>
                    [{numOf(id)}]
                  </button>
                ))}
                <span className="small muted"> · {KIND_LABEL[s.kind]}</span>
                {s.problems.length > 0 && <span className="badge red"> 막힘: {s.problems.join(", ")}</span>}
              </p>
            );
          })}
        </div>
      )}
    </section>
  );
}

const HOLD_TEXT: Record<string, string> = {
  empty: "빈 답",
  "no-evidence": "근거 없음(문서 빈칸)",
  "no-sources": "검색된 문단 없음(문서 빈칸)",
  "invalid-citation": "인용이 원문과 다름",
  "uncited-sentence": "인용 없는 문장",
  "uncited-tail": "인용 밖 말이 김",
  "unsupported-number": "원문에 없는 숫자",
  "low-overlap": "인용과 겹치는 말이 적음",
  refusal: "모델 거절",
  truncated: "응답 잘림",
  template: "가격·시간 칸 오류",
  "ad-banned": "금지 광고 표현",
  "api-error": "모델 호출 오류",
};

export function VerifyPanel({ draft }: { draft: DraftResult | null }) {
  return (
    <section className="card" aria-label="④ 근거·검증">
      <StepTitle n="4">근거·검증</StepTitle>
      {!draft ? (
        <p className="muted">생성 결과가 없어 검증할 것이 없습니다.</p>
      ) : (
        <div className="stack">
          <p>
            {draft.status === "ok" ? (
              <span className="badge green">검증 통과(ok) — 직원 검토 뒤 보낼 수 있음</span>
            ) : (
              <span className="badge gray">보류 — 초안을 보내지 않음</span>
            )}
          </p>
          {draft.holdReasons.length > 0 && (
            <ul>
              {draft.holdReasons.map((h, i) => (
                <li key={i}>
                  <strong>{HOLD_TEXT[h.code] ?? h.code}</strong> — {h.detail}
                </li>
              ))}
            </ul>
          )}
          {draft.fills.length > 0 && (
            <div>
              <h3>가격·시간 칸 (F9)</h3>
              <ul className="small">
                {draft.fills.map((f, i) => (
                  <li key={i}>
                    <code>{f.placeholder}</code> → <span className="fill">{f.value}</span> · {f.sourceDoc === "V03" ? "가격표 V03" : "진료시간 V02"}에서 코드가
                    넣은 값. 모델은 금액을 쓰지 않았습니다.
                  </li>
                ))}
              </ul>
            </div>
          )}
          <AdSignals hits={draft.adcheck?.hits ?? []} label="초안의 광고 표현 신호 (F12)" />
          <p className="small muted">
            코드가 확인한 것: 인용문이 볼트 문단과 글자 그대로 같은지, 문장 속 숫자가 인용 원문에 있는지, 인용 없는 문장이 없는지. &lsquo;해도 됩니다&rsquo;와
            &lsquo;하면 안 됩니다&rsquo;처럼 뜻이 뒤집힌 문장은 코드가 잡지 못하므로 보내는 사람이 확인합니다.
          </p>
        </div>
      )}
    </section>
  );
}

export function AdSignals({ hits, label }: { hits: { level: "banned" | "warn"; term: string; reason: string | null; matchedText: string }[]; label: string }) {
  if (hits.length === 0) return <p className="small muted">{label}: 없음</p>;
  return (
    <div>
      <h3>{label}</h3>
      <ul className="small">
        {hits.map((h, i) => (
          <li key={i}>
            <span className={`badge ${h.level === "banned" ? "red" : "orange"}`}>{h.level === "banned" ? "금지 — 발송 막힘" : "주의 — 다시 보기"}</span> &ldquo;
            {h.matchedText}&rdquo;
            {h.reason ? ` · ${h.reason}` : ""}
          </li>
        ))}
      </ul>
      <p className="small muted">적법성 판정이 아니라 사람이 다시 볼 신호입니다(V15).</p>
    </div>
  );
}
