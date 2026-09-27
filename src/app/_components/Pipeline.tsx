/**
 * ①문서 찾기 → ②발췌 → ③AI 초안 → ④근거·확인 네 단계를 그대로 보인다(PRD 2절).
 * 그릴 값은 src/demo/view.ts가 만든다(retrievalView 등). 이 파일의 컴포넌트는 훅·데이터 입구를 쓰지 않아
 * 시험(renderToStaticMarkup)으로 '제외됨' 표시 같은 화면 약속을 확인할 수 있다.
 */

import type { Fill } from "@/core/template";
import type { DraftResult } from "@/llm/draft";
import { HOLD_TEXT, type PricePreview, type RetrievalView, type Segment } from "@/demo/view";

function StepTitle({ n, children }: { n: string; children: React.ReactNode }) {
  return (
    <h2 className="step-title">
      <span className="step-num" aria-hidden="true">
        {n}
      </span>
      <span className="sr-only">{n}단계 </span>
      {children}
    </h2>
  );
}

function Marked({ segs }: { segs: Segment[] }) {
  return (
    <>
      {segs.map((s, i) =>
        s.hit ? (
          <mark key={i} className="hit">
            {s.text}
          </mark>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </>
  );
}

export function RetrievalPanel({ view, compare }: { view: RetrievalView; compare?: RetrievalView | null }) {
  return (
    <section className="card" aria-label="① 문서 찾기">
      <StepTitle n="1">문서 찾기</StepTitle>
      <p className="small muted">
        {view.source === "recorded" ? "미리 만든 AI 답을 만들 때 찾은 결과입니다. " : "지금 이 브라우저에서 찾은 결과입니다. "}
        병원이 승인한 최신 문서의 문단만 찾습니다.
        {view.queryNote ? ` ${view.queryNote}` : ""}
        {view.postopDay !== null && ` 수술 후 ${view.postopDay}일째 구간의 안내 문단을 앞에 세웠습니다.`}
      </p>
      {view.weak && (
        <div className="note warn" role="note">
          <strong>근거 약함 — 문서 빈칸.</strong> 찾은 문단의 관련도가 기준보다 낮아 AI를 부르지 않고 보류합니다. 병원 문서에 이 내용이 없을 수 있습니다.
        </div>
      )}
      {view.items.length === 0 ? (
        <p>찾은 문단이 없습니다.</p>
      ) : (
        <ol className="hits">
          {view.items.map((h, i) => (
            <li key={h.chunkId}>
              <div className="row small">
                <strong>{i + 1}위</strong>
                <span>
                  {h.title}
                  {h.heading ? ` › ${h.heading}` : ""}
                </span>
                <span className={`badge ${h.relevance === "높음" ? "green" : h.relevance === "낮음" ? "gray" : h.relevance === "경과일 구간" ? "orange" : "blue"}`}>
                  관련도 {h.relevance}
                </span>
              </div>
              <p className="small snippet">
                <Marked segs={h.snippet} />
              </p>
            </li>
          ))}
        </ol>
      )}
      {view.missing.length > 0 && <p className="note warn small">그때 찾은 문단 중 {view.missing.length}개가 지금 문서에 없습니다.</p>}
      {view.excluded.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <h3>제외됨 — 관련은 있지만 쓰지 않는 문서</h3>
          <ul className="small">
            {view.excluded.map((e) => (
              <li key={e.docId}>
                <span className="badge gray">{e.label}</span> {e.title}
              </li>
            ))}
          </ul>
        </div>
      )}
      {compare && (
        <details>
          <summary>지금 다시 찾으면</summary>
          <ol className="small">
            {compare.items.map((h) => (
              <li key={h.chunkId}>
                {h.title}
                {h.heading ? ` › ${h.heading}` : ""} · 관련도 {h.relevance}
              </li>
            ))}
          </ol>
        </details>
      )}
      <details className="dev">
        <summary>자세히(개발자용)</summary>
        <p className="small muted">
          검색: 한국어 문자 2-gram + 단어 BM25. 질의: &ldquo;{view.query || "(빈 질의)"}&rdquo;. 근거 약함 기준은 최고 점수 9 미만(src/core/retrieve.ts).
        </p>
        <ul className="small">
          {view.items.map((h) => (
            <li key={h.chunkId}>
              {h.chunkId} · 점수 {h.score.toFixed(2)}
              {h.postopBoost ? " · 경과일 구간으로 앞에 섬" : ""}
            </li>
          ))}
          {view.excluded.map((e) => (
            <li key={`x-${e.docId}`}>
              제외 {e.docId} v{e.version ?? "?"}
              {e.supersededBy ? ` → ${e.supersededBy}로 대체` : ""}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}

export interface ExcerptDoc {
  docId: string;
  title: string;
  chunks: { chunkId: string; text: string }[];
}

export function ExcerptPanel({ docs, highlight, source, weak = false }: { docs: ExcerptDoc[]; highlight: ReadonlySet<string>; source: "live" | "recorded"; weak?: boolean }) {
  return (
    <section className="card" aria-label="② 발췌">
      <StepTitle n="2">발췌</StepTitle>
      <p className="small muted">
        {source === "recorded"
          ? "AI가 받은 문단입니다(글 속 문서 링크는 제목으로 바꿔 보입니다). ③의 번호를 누르면 해당 문단이 칠해집니다."
          : weak
            ? "근거가 약해 AI에 보내지 않습니다. 찾은 문단은 참고로만 보입니다."
            : "찾은 문단을 문서별로 묶었습니다. AI를 부른다면 이 문단만 보냅니다."}
      </p>
      {docs.length === 0 && <p>보낼 문단이 없습니다.</p>}
      {docs.map((d) => (
        <div key={d.docId} style={{ marginTop: 8 }}>
          <h3>{d.title}</h3>
          {d.chunks.map((c) => (
            <div key={c.chunkId} id={`para-${c.chunkId}`} className={`para${highlight.has(c.chunkId) ? " hl" : ""}`} title={c.chunkId}>
              {highlight.has(c.chunkId) && <span className="sr-only">(인용된 문단) </span>}
              {c.text}
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}

/** 문장 안의 자리표시자를 코드가 넣은 값으로 바꿔 보인다. 값은 초록 칸 — 누르면 가격표 문단이 칠해진다. */
function withFills(text: string, fills: Fill[], onFill: (f: Fill) => void) {
  const parts = text.split(/(\{\{[^{}]*\}\})/g);
  return parts.map((p, i) => {
    const f = fills.find((x) => x.placeholder === p);
    if (!f) return <span key={i}>{p}</span>;
    return (
      <button key={i} type="button" className="fill" onClick={() => onFill(f)} aria-label={`${f.value} — ${f.sourceDoc === "V03" ? "가격표" : "진료시간"}에서 코드가 넣은 값, 원문 보기`}>
        {f.value}
      </button>
    );
  });
}

const SENTENCE_KIND = { cited: "근거 있음", allowlisted: "인사·맺음", template: "가격·시간 칸", uncited: "근거 없음" } as const;

export function DraftPanel({
  draft,
  sourceLabel,
  onCite,
  onFill,
  notReadyText,
}: {
  draft: DraftResult | null;
  sourceLabel: string;
  onCite: (chunkIds: string[]) => void;
  onFill: (f: Fill) => void;
  notReadyText: string;
}) {
  if (!draft) {
    return (
      <section className="card" aria-label="③ AI 초안">
        <StepTitle n="3">AI 초안</StepTitle>
        <p>{notReadyText}</p>
      </section>
    );
  }
  // 인용 번호는 문서에 보낸 문단 순서대로 1부터 붙인다(같은 문단은 같은 번호).
  const order: string[] = draft.documents.flatMap((d) => d.blocks.map((b) => b.chunkId));
  const numOf = (id: string) => order.indexOf(id) + 1;
  return (
    <section className="card" aria-label="③ AI 초안">
      <StepTitle n="3">AI 초안</StepTitle>
      <p className="small muted">{sourceLabel}. 문장 끝 번호를 누르면 ②에서 원문 문단이 칠해집니다.</p>
      {draft.sentences.length === 0 ? (
        <p className="quote">{draft.modelText || (draft.status === "hold" ? "AI를 부르지 않았습니다." : "(빈 응답)")}</p>
      ) : (
        <div>
          {draft.sentences.map((s) => {
            const ids = [...new Set(s.citations.flatMap((c) => c.chunkIds))];
            return (
              <p key={s.index} className={`sentence${s.problems.length > 0 ? " bad" : ""}`}>
                {withFills(s.text, draft.fills, onFill)}
                {ids.map((id) => (
                  <button key={id} type="button" className="cite" onClick={() => onCite([id])} aria-label={`근거 ${numOf(id)}번 문단 보기`}>
                    [{numOf(id)}]
                  </button>
                ))}
                <span className="small muted"> · {SENTENCE_KIND[s.kind]}</span>
                {s.problems.length > 0 && <span className="badge red">막힘</span>}
                {s.problems.length > 0 && <span className="small"> {s.problems.map((p) => HOLD_TEXT[p] ?? p).join(", ")}</span>}
              </p>
            );
          })}
        </div>
      )}
    </section>
  );
}

export interface FillSource {
  fill: Fill;
  chunk: { chunkId: string; text: string } | null;
}

export function VerifyPanel({ draft, fillSources, highlight }: { draft: DraftResult | null; fillSources: FillSource[]; highlight: ReadonlySet<string> }) {
  return (
    <section className="card" aria-label="④ 근거·확인">
      <StepTitle n="4">근거·확인</StepTitle>
      {!draft ? (
        <p className="muted">AI 초안이 없어 확인할 것이 없습니다.</p>
      ) : (
        <div className="stack">
          <p>
            {draft.status === "ok" ? (
              <span className="badge green">확인 통과 — 직원 검토 뒤 보낼 수 있음</span>
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
          {fillSources.length > 0 && (
            <div>
              <h3>가격·시간 칸</h3>
              <ul className="small">
                {fillSources.map(({ fill: f, chunk }, i) => (
                  <li key={i}>
                    <span className="fill">{f.value}</span> — {f.sourceDoc === "V03" ? "가격표" : "진료시간 문서"}에서 코드가 넣은 값. AI는 금액을 쓰지 않고 칸 이름(
                    <code>{f.placeholder}</code>)만 썼습니다.
                    {chunk && (
                      <div id={`price-src-${chunk.chunkId}`} className={`para${highlight.has(`price:${chunk.chunkId}`) ? " hl" : ""}`}>
                        {chunk.text}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <AdSignals hits={draft.adcheck?.hits ?? []} label="초안의 광고 표현 신호" />
          <p className="small muted">
            코드가 확인한 것: 근거로 단 글이 병원 문서 문단과 글자 그대로 같은지, 문장 속 숫자가 근거 원문에 있는지, 근거 없는 문장이 없는지. &lsquo;해도
            됩니다&rsquo;와 &lsquo;하면 안 됩니다&rsquo;처럼 뜻이 뒤집힌 문장은 코드가 잡지 못하므로 보내는 사람이 확인합니다.
          </p>
        </div>
      )}
    </section>
  );
}

/** AI 답이 준비되기 전에도 가격 칸 구조를 보인다(모델 없이 코드만으로). */
export function PricePreviewCard({ items }: { items: PricePreview[] }) {
  if (items.length === 0) return null;
  return (
    <section className="card" aria-label="가격 칸 미리보기">
      <h2>가격 칸 미리보기</h2>
      <p className="small muted">AI는 금액을 쓰지 않고 칸 이름만 씁니다. 금액은 코드가 가격표에서 넣습니다. AI가 실제로 어느 칸을 쓸지는 AI 답이 준비되면 보입니다.</p>
      <ul className="small">
        {items.map((p) => (
          <li key={p.placeholder}>
            {p.label}: <code>{p.placeholder}</code> → <span className="fill">{p.value}</span> <span className="muted">(가격표에서 코드가 넣음)</span>
          </li>
        ))}
      </ul>
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
      <p className="small muted">적법성 판정이 아니라 사람이 다시 볼 신호입니다(광고 표현 기준 문서).</p>
    </div>
  );
}
