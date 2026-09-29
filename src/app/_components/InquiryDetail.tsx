"use client";

/**
 * 문의 상세. 위에서 아래로: 원문(가린 글이 기본) → 이 문의의 핵심 카드(확정 대기 / 인계 카드 / 고정 문구 / 보류) →
 * 경과일 → ①문서 찾기 ②발췌 ③AI 초안 ④근거·확인 → 승인·모의 발송.
 * 핵심 카드를 원문 바로 아래에 두는 이유: 가격·예약금·리뷰 문의에서 경과일 편집 카드가 먼저 나오면 할 일이 밀린다.
 *
 * 판단은 src/demo(inbox·view·analyze)의 순수 함수가 한다. 시각은 DEMO_NOW_MS 하나만 쓴다.
 */

import Link from "next/link";
import { useState } from "react";
import { checkAdExpressions } from "@/core/adcheck";
import type { Fill } from "@/core/template";
import { analyzeInquiry } from "@/demo/analyze";
import { DEMO_NOW_MS, formatDuration, formatKst } from "@/demo/clock";
import { buildInboxItem } from "@/demo/inbox";
import { draftDisplay } from "@/demo/refill";
import { addLog, sentTargets, templateChosenTargets } from "@/demo/state";
import {
  CATEGORY_LABEL,
  DEPOSIT_INTENTS,
  depositBasis,
  draftSourceLabel,
  fillSourceChunk,
  handoverCardModel,
  liveExcerpts,
  maskedCaseForInquiry,
  maskedView,
  postopEditorOpen,
  pricePreview,
  PRIORITY_LABEL,
  recordedExcerpts,
  recordedRetrievalView,
  retrievalView,
  staffOriginal,
  type DepositIntent,
} from "@/demo/view";
import { bundle, driftFor, engine, inquiryRecord } from "../_lib/data";
import { useDemoState } from "../_lib/useDemoState";
import { ActionLog, ApprovePanel, TemplatePicker } from "./Approve";
import { ChannelBadge, KindBadge, REPLY_MODE_LABEL, StatusBadge } from "./Badges";
import { HandoverCard } from "./HandoverCard";
import { MaskedText } from "./MaskedText";
import { AdSignals, DraftPanel, ExcerptPanel, PricePreviewCard, RetrievalPanel, VerifyPanel } from "./Pipeline";

const NOW_LABEL = formatKst(DEMO_NOW_MS);

async function copy(t: string) {
  try {
    await navigator.clipboard.writeText(t);
  } catch {
    // 복사가 막힌 환경에서는 문구를 직접 선택해 복사한다.
  }
}

export function InquiryDetail({ id }: { id: string }) {
  const { k, policies } = engine();
  const { state, update } = useDemoState();
  const [highlight, setHighlight] = useState<Set<string>>(new Set());
  const q = bundle.inquiries.find((x) => x.id === id);
  if (!q) {
    return (
      <p>
        없는 문의입니다. <Link href="/">목록으로</Link>
      </p>
    );
  }
  const record = inquiryRecord(id);
  const handedAt = state.handedOver[id] ?? null;
  const marks = { sent: sentTargets(state), handedOver: new Map(handedAt ? [[id, DEMO_NOW_MS]] : []), templateChosen: templateChosenTargets(state) };
  const item = buildInboxItem(q, k, record, policies, marks, DEMO_NOW_MS);
  const override = Object.prototype.hasOwnProperty.call(state.postopDays, id) ? state.postopDays[id] : undefined;
  const a = analyzeInquiry(k, q.channel, q.text, override);
  const inquiryAd = checkAdExpressions(q.text, k.ad);
  const draft = record?.draft ?? null;
  // 보낼 글은 녹화의 모델 글을 지금 코드로 다시 채운 것이다(src/demo/refill.ts). 화면이 녹화 때 글과 다르면 그렇다고 적는다.
  const display = draft ? draftDisplay(k, draft, "reply") : null;
  const drift = driftFor(id);
  const masked = maskedView(maskedCaseForInquiry(item.step, record, a.decision.mask));

  const cite = (ids: string[]) => {
    setHighlight(new Set(ids));
    document.getElementById(`para-${ids[0]}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };
  const onFill = (f: Fill) => {
    const c = fillSourceChunk(k, f);
    if (!c) return;
    setHighlight(new Set([`price:${c}`]));
    document.getElementById(`price-src-${c}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  const pipeline = item.step === "classify" || item.step === "draft" || item.step === "shop-redirect" || (item.step === "hold" && draft);
  const live = a.retrieval ? retrievalView(k, a.retrieval, a.decision.mask.masked) : null;
  const recorded = record?.retrieval ? recordedRetrievalView(k, { retrieval: record.retrieval, excludedMatches: record.excludedMatches ?? [], retrievalMeta: record.retrievalMeta }, "reply", record.route.maskedText, record.postopDay) : null;
  const liveDiffers = recorded && live && live.items.map((x) => x.chunkId).join() !== recorded.items.map((x) => x.chunkId).join();
  const prices = !draft && live ? pricePreview(k, a.decision.mask.masked, live.items.map((x) => x.docId)) : [];
  const fillSources = (display?.fills ?? []).map((f) => {
    const c = fillSourceChunk(k, f);
    const chunk = c ? k.chunks.find((x) => x.chunkId === c) : undefined;
    return { fill: f, chunk: chunk ? { chunkId: chunk.chunkId, text: chunk.text } : null };
  });

  return (
    <div>
      <p className="small">
        <Link href="/">← 통합 목록</Link>
      </p>

      <section className="card" aria-label="문의 원문">
        <div className="row">
          <h2 style={{ margin: 0 }}>{q.id}</h2>
          <ChannelBadge channel={q.channel} />
          <KindBadge kind={item.kind} />
          <StatusBadge status={item.status} />
          {drift.length > 0 && <span className="badge orange">AI 답 이후 바뀜</span>}
        </div>
        <dl className="kv" style={{ marginTop: 8 }}>
          <dt>보낸 사람</dt>
          <dd>{q.author.alias}</dd>
          <dt>받은 시각</dt>
          <dd>{formatKst(item.receivedMs)}</dd>
          <dt>기다린 시간</dt>
          <dd>
            {formatDuration(item.waitMinutes)} <span className="small muted">(기준 시각 {NOW_LABEL})</span>
          </dd>
          <dt>답장 방식</dt>
          <dd>
            {a.decision.replyMode ? REPLY_MODE_LABEL[a.decision.replyMode] : "모름"}
            {a.decision.channel?.note ? <span className="small muted"> · {a.decision.channel.note}</span> : null}
          </dd>
          {q.attachments.length > 0 && (
            <>
              <dt>첨부</dt>
              <dd>
                {q.attachments.map((x, i) => (
                  <div key={i}>
                    {x.kind}: {x.note}
                  </div>
                ))}
              </dd>
            </>
          )}
        </dl>
        <p className="quote" style={{ marginTop: 8 }}>
          {a.decision.mask.masked}
        </p>
        {a.decision.mask.items.length > 0 && (
          <details>
            <summary>원문 보기(직원만 · 주민번호는 계속 가림)</summary>
            <p className="quote">{staffOriginal(q.text)}</p>
          </details>
        )}
        <MaskedText view={masked} />
        {inquiryAd.hits.length > 0 && <AdSignals hits={inquiryAd.hits} label="문의 속 광고 유인 표현 (답장에 따라 쓰지 않도록)" />}
        {drift.length > 0 && (
          <div className="note warn" role="note">
            <strong>미리 만든 AI 답 이후 바뀐 곳이 있습니다.</strong> 아래 ①·③이 서로 다른 입력에서 나왔을 수 있습니다. AI 답을 다시 만들어야 합니다.
            <ul className="small">
              {drift.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          </div>
        )}
        <details className="dev">
          <summary>안전 규칙 기록(개발자용)</summary>
          <ol className="small">
            {a.decision.trace.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
            {record && record.route.step !== a.decision.step && <li>AI 분류 뒤 경로: {record.route.trace.slice(-1)[0]}</li>}
          </ol>
        </details>
      </section>

      {item.deposit && <DepositCard id={id} />}

      {item.step === "handover" && (
        <HandoverCard
          model={handoverCardModel(a.decision, item.handover, policies.handover, DEMO_NOW_MS, k.titles)}
          postop={
            a.postopUsed === null ? null : { days: a.postopUsed, text: a.postopRead && a.postopRead.days === a.postopUsed ? a.postopRead.text : "직원이 고친 값" }
          }
          handedAtLabel={handedAt}
          onCopy={copy}
          onToggleHanded={() =>
            update((s) => {
              const next = { ...s.handedOver };
              if (next[id]) delete next[id];
              else next[id] = NOW_LABEL;
              return addLog({ ...s, handedOver: next }, { target: id, action: s.handedOver[id] ? "인계 취소" : "인계 표시", by: "CS 직원", at: NOW_LABEL, detail: "" });
            })
          }
        >
          {a.decision.replyMode === "template-only" && (
            <p className="small" style={{ marginTop: 8 }}>
              공개 창구입니다. 공개 답글에는 증상을 언급하지 않고 고정 문구만 씁니다.
            </p>
          )}
          {record?.classification?.status === "classified" && <p className="small muted">AI 분류 이유: {record.classification.classification.reason}</p>}
          <ActionLog target={id} title="이 문의 기록" />
        </HandoverCard>
      )}

      {item.step === "public-template" && <TemplatePicker target={id} />}

      {item.step === "hold" && !draft && (
        <section className="card">
          <h2>보류</h2>
          <p>{record?.route.holdReason ?? a.decision.holdReason ?? "초안을 만들지 않습니다."}</p>
        </section>
      )}

      <PostopEditor
        id={id}
        open={postopEditorOpen(item.step, a.postopRead?.days ?? null, override !== undefined)}
        read={a.postopRead}
        used={a.postopUsed}
        overridden={override !== undefined}
        onSave={(v) =>
          update((s) =>
            addLog({ ...s, postopDays: { ...s.postopDays, [id]: v } }, { target: id, action: "경과일 수정", by: "CS 직원", at: NOW_LABEL, detail: v === null ? "경과일 없음" : `D+${v}` }),
          )
        }
        onReset={() =>
          update((s) => {
            const rest = { ...s.postopDays };
            delete rest[id];
            return addLog({ ...s, postopDays: rest }, { target: id, action: "경과일 수정", by: "CS 직원", at: NOW_LABEL, detail: "문의에서 읽은 값으로 되돌림" });
          })
        }
      />

      {pipeline && (
        <>
          <ClassificationCard id={id} />
          {item.step === "shop-redirect" && (
            <section className="card warn">
              <h2>쇼핑몰 문의 — 연결 창구 안내</h2>
              <p>쇼핑몰은 별도 사업자가 운영합니다. 병원 창구에서 주문·배송·반품을 처리하지 않고 쇼핑몰 고객센터를 안내합니다. 아래 쇼핑몰 안내 문서 문단을 근거로 안내합니다.</p>
            </section>
          )}
          {recorded ? <RetrievalPanel view={recorded} compare={liveDiffers ? live : null} /> : live && <RetrievalPanel view={live} />}
          {record && a.postopUsed !== record.postopDay && (
            <div className="note warn" role="note">
              미리 만든 AI 답은 경과일 {record.postopDay === null ? "없음" : `D+${record.postopDay}`}으로 찾은 결과입니다. 고친 경과일은 &lsquo;지금 다시 찾으면&rsquo;에만 반영됩니다.
            </div>
          )}
          <PricePreviewCard items={prices} />
          <div className="two-col">
            <ExcerptPanel
              docs={draft && draft.documents.length > 0 ? recordedExcerpts(k, draft) : liveExcerpts(k, a.excerpts)}
              highlight={highlight}
              source={draft && draft.documents.length > 0 ? "recorded" : "live"}
              weak={a.retrieval?.weak ?? false}
            />
            <div className="sticky-col">
              <DraftPanel
                draft={draft}
                display={display}
                sourceLabel={draft ? draftSourceLabel(bundle.recordingSource, draft.meta.model, draft.meta.servedByFallback) : ""}
                onCite={cite}
                onFill={onFill}
                notReadyText={
                  bundle.recording
                    ? item.step === "shop-redirect"
                      ? "쇼핑몰 안내 경로라 AI 초안을 만들지 않았습니다."
                      : "이 문의에는 미리 만든 AI 답이 없습니다."
                    : a.retrieval?.weak
                      ? "근거가 약해 AI를 부르지 않고 보류합니다(문서 빈칸)."
                      : "AI 초안은 아직 준비 전입니다 — 안전 규칙과 문서 찾기는 지금 동작합니다."
                }
              />
              <VerifyPanel draft={draft} display={display} fillSources={fillSources} highlight={highlight} />
            </div>
          </div>
          {draft?.status === "ok" && display?.text && <ApprovePanel target={id} initialText={display.text} replyMode={a.decision.replyMode} />}
        </>
      )}
    </div>
  );
}

function ClassificationCard({ id }: { id: string }) {
  const record = inquiryRecord(id);
  const c = record?.classification;
  return (
    <section className="card" aria-label="AI 분류">
      <h2>AI 분류</h2>
      {!c ? (
        <p className="muted">
          {bundle.recording ? "미리 만든 AI 분류가 없습니다." : "AI 분류는 아직 준비 전입니다. 안전 규칙은 통과했습니다."} AI 분류는 이 문의를 의료진 인계로 바꿀 수 있습니다(인계 쪽으로만).
        </p>
      ) : c.status === "unclassified" ? (
        <p>분류하지 못함 — {c.reason}. 초안을 만들지 않고 보류합니다.</p>
      ) : (
        <dl className="kv">
          <dt>유형</dt>
          <dd>{CATEGORY_LABEL[c.classification.category] ?? c.classification.category}</dd>
          <dt>우선순위</dt>
          <dd>{PRIORITY_LABEL[c.classification.priority] ?? c.classification.priority}</dd>
          <dt>근거 표현</dt>
          <dd>{c.evidence.length > 0 ? c.evidence.map((e) => `"${e}"`).join(", ") : "없음"}</dd>
          {c.droppedEvidence.length > 0 && (
            <>
              <dt>원문에 없던 근거</dt>
              <dd>{c.droppedEvidence.map((e) => `"${e}"`).join(", ")} (버림)</dd>
            </>
          )}
          <dt>이유</dt>
          <dd>{c.classification.reason}</dd>
        </dl>
      )}
    </section>
  );
}

function PostopEditor({
  id,
  open,
  read,
  used,
  overridden,
  onSave,
  onReset,
}: {
  id: string;
  open: boolean;
  read: { days: number; text: string } | null;
  used: number | null;
  overridden: boolean;
  onSave: (v: number | null) => void;
  onReset: () => void;
}) {
  const [value, setValue] = useState<string | null>(null);
  const shown = value ?? (used === null ? "" : String(used));
  const parsed = shown.trim() === "" ? null : Number(shown);
  const valid = parsed === null || (Number.isInteger(parsed) && parsed >= 0 && parsed <= 3650);
  const body = (
    <>
      <p className="small">
        문의에서 읽은 값: {read ? <strong>수술 후 {read.days}일째</strong> : "없음"}
        {read && <span className="muted"> — &ldquo;{read.text}&rdquo;에서 읽음</span>}
        {overridden && (
          <span className="badge blue" style={{ marginLeft: 6 }}>
            직원이 고침: {used === null ? "없음" : `D+${used}`}
          </span>
        )}
      </p>
      <p className="small muted">환자가 쓴 문장에서만 읽습니다. 다른 문의와 합쳐 추정하지 않습니다. 틀렸으면 고치세요 — 그 구간의 안내 문단을 앞에 세웁니다.</p>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid) return;
          onSave(parsed);
          setValue(null);
        }}
      >
        <label>
          수술 후 며칠째(D+)
          <input id={`postop-${id}`} inputMode="numeric" value={shown} onChange={(e) => setValue(e.target.value)} placeholder="없음" style={{ width: 120 }} aria-invalid={!valid} />
        </label>
        <button type="submit" disabled={!valid}>
          저장
        </button>
        {overridden && (
          <button type="button" onClick={onReset}>
            읽은 값으로 되돌리기
          </button>
        )}
      </form>
      {!valid && (
        <p className="small" role="alert">
          0 이상의 정수로 적거나 비워 두세요.
        </p>
      )}
      <ActionLog target={id} actions={["경과일 수정"]} title="경과일 고친 기록" hideWhenEmpty />
    </>
  );
  if (!open) {
    return (
      <details className="card fold">
        <summary>경과일: 문의에 적힌 값 없음 — 고치기</summary>
        {body}
      </details>
    );
  }
  return (
    <section className="card" aria-label="경과일">
      <h2>경과일</h2>
      {body}
    </section>
  );
}

function DepositCard({ id }: { id: string }) {
  const { k, policies } = engine();
  const { state, update } = useDemoState();
  const [intent, setIntent] = useState<DepositIntent>("confirm");
  const q = bundle.inquiries.find((x) => x.id === id)!;
  const item = buildInboxItem(q, k, inquiryRecord(id), policies, { sent: new Set(), handedOver: new Map() }, DEMO_NOW_MS);
  const d = item.deposit!;
  const attempts = state.contactAttempts[id] ?? [];
  const src = policies.confirm.businessDays;
  const basis = depositBasis(k, intent);
  return (
    <section className={`card ${d.overdue ? "alert" : "warn"}`} aria-label="예약금 확정 대기">
      <h2>예약금 받음 · 확정 대기</h2>
      <dl className="kv">
        <dt>확정 연락 시한</dt>
        <dd>
          {d.deadlineMs === null ? "계산할 수 없음(진료시간 표 확인)" : `${formatKst(d.deadlineMs)}까지`}{" "}
          {d.deadlineMs !== null &&
            (d.overdue ? (
              <span className="badge red" role="alert">
                시한 {formatDuration(-(d.remainingMinutes ?? 0))} 지남
              </span>
            ) : (
              <span className="badge orange">{formatDuration(d.remainingMinutes ?? 0)} 남음</span>
            ))}
        </dd>
        <dt>근거</dt>
        <dd className="small">
          {src.chunkId ? `예약 규정 "입금을 확인하면 ${src.value}영업일 안에 확정 연락"` : `예약 규정에서 읽지 못해 기본값 ${src.value}영업일`} · 받은 뒤 새로 시작하는 진료일의 진료
          종료까지로 계산
        </dd>
        <dt>입금 문의 뒤 경과</dt>
        <dd>{formatDuration(d.elapsedMinutes)}</dd>
        {d.bookingAtMs !== null && (
          <>
            <dt>요청한 방문 시각</dt>
            <dd>{formatKst(d.bookingAtMs)}</dd>
          </>
        )}
        <dt>연락 시도</dt>
        <dd>{attempts.length === 0 ? "없음" : attempts.map((t, i) => <div key={i}>{`${i + 1}회 · ${t}`}</div>)}</dd>
      </dl>
      <div className="row" style={{ marginTop: 8 }}>
        <button
          type="button"
          className="primary"
          onClick={() =>
            update((s) =>
              addLog(
                { ...s, contactAttempts: { ...s.contactAttempts, [id]: [...(s.contactAttempts[id] ?? []), NOW_LABEL] } },
                { target: id, action: "연락 시도", by: "CS 직원", at: NOW_LABEL, detail: `${attempts.length + 1}회째` },
              ),
            )
          }
        >
          연락 시도 기록
        </button>
      </div>
      <h3 style={{ marginTop: 12 }}>안내할 때 근거 규정</h3>
      <div className="row" role="tablist" aria-label="안내 종류">
        {DEPOSIT_INTENTS.map((x) => (
          <button key={x.key} type="button" role="tab" aria-selected={intent === x.key} className={intent === x.key ? "primary" : ""} onClick={() => setIntent(x.key)}>
            {x.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" style={{ marginTop: 8 }}>
        <p className="small muted">예약 규정에서 이 안내의 근거가 되는 문단입니다. 안내 글은 이 문단을 근거로 씁니다.</p>
        {basis.map((h) => (
          <div key={h.chunkId} className="para" title={h.chunkId}>
            {h.heading ? <strong>{h.heading} · </strong> : null}
            {h.text}
          </div>
        ))}
      </div>
      <ActionLog target={id} title="이 문의 기록" />
    </section>
  );
}
