"use client";

/**
 * 문의 상세. 위에서 아래로 파이프라인 순서: 원문·가림(F10) → 게이트(F5) → 경과일(F17) → 확정 대기(F16) →
 * 인계 카드(F6) / 고정 문구(F11) / ①검색 ②발췌 ③생성 ④근거·검증(F7~F9, F12) → 승인·모의 발송(F13).
 */

import Link from "next/link";
import { useState } from "react";
import { checkAdExpressions } from "@/core/adcheck";
import { retrieve } from "@/core/retrieve";
import { analyzeInquiry } from "@/demo/analyze";
import { DEMO_NOW_MS, formatDuration, formatKst } from "@/demo/clock";
import { buildInboxItem, KIND_LABEL } from "@/demo/inbox";
import { addLog, sentTargets } from "@/demo/state";
import { bundle, engine, inquiryRecord } from "../_lib/data";
import { useDemoState } from "../_lib/useDemoState";
import { ApprovePanel, TemplatePicker } from "./Approve";
import { ChannelBadge, KindBadge, REPLY_MODE_LABEL, StatusBadge } from "./Badges";
import { HandoverCard } from "./HandoverCard";
import { MaskedText } from "./MaskedText";
import { AdSignals, DraftPanel, ExcerptPanel, RetrievalPanel, VerifyPanel } from "./Pipeline";

const NOW_LABEL = formatKst(DEMO_NOW_MS);

const CATEGORY_LABEL: Record<string, string> = {
  booking: "예약",
  price: "가격",
  consultation: "첫 상담",
  postop: "수술 후 관리",
  injection: "두피 주사",
  "scalp-care": "두피 관리",
  medication: "약",
  shop: "쇼핑몰",
  complaint: "불만",
  other: "기타",
};

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
  const item = buildInboxItem(q, k, record, policies, { sent: sentTargets(state), handedOver: new Map(handedAt ? [[id, DEMO_NOW_MS]] : []) }, DEMO_NOW_MS);
  const override = Object.prototype.hasOwnProperty.call(state.postopDays, id) ? state.postopDays[id] : undefined;
  const a = analyzeInquiry(k, q.channel, q.text, override);
  const inquiryAd = checkAdExpressions(q.text, k.ad);
  const draft = record?.draft ?? null;

  const cite = (ids: string[]) => {
    setHighlight(new Set(ids));
    const el = document.getElementById(`para-${ids[0]}`);
    el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  const liveDiffersFromRecord = record && a.decision.step !== "classify" && a.decision.step !== record.route.step;

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
          {q.text}
        </p>
        <MaskedText original={q.text} mask={a.decision.mask} />
        <details>
          <summary>게이트 기록 (규칙이 모델보다 먼저)</summary>
          <ol className="small">
            {a.decision.trace.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
            {record && record.route.step !== a.decision.step && <li>녹화된 분류 뒤 경로: {record.route.trace.slice(-1)[0]}</li>}
          </ol>
        </details>
        {inquiryAd.hits.length > 0 && <AdSignals hits={inquiryAd.hits} label="문의 속 광고 유인 표현 (F12, 답장에 따라 쓰지 않도록)" />}
        {liveDiffersFromRecord && (
          <p className="badge orange">
            녹화 뒤 규칙이 바뀌어 지금 경로({a.decision.step})가 녹화 경로({record!.route.step})와 다릅니다. 지금 규칙을 따릅니다.
          </p>
        )}
      </section>

      <PostopEditor
        id={id}
        read={a.postopRead}
        used={a.postopUsed}
        overridden={override !== undefined}
        onSave={(v) =>
          update((s) =>
            addLog(
              { ...s, postopDays: { ...s.postopDays, [id]: v } },
              { target: id, action: "경과일 수정", by: "CS 직원", at: NOW_LABEL, detail: v === null ? "경과일 없음" : `D+${v}` },
            ),
          )
        }
        onReset={() =>
          update((s) => {
            const rest = { ...s.postopDays };
            delete rest[id];
            return addLog(
              { ...s, postopDays: rest },
              { target: id, action: "경과일 수정", by: "CS 직원", at: NOW_LABEL, detail: "문의에서 읽은 값으로 되돌림" },
            );
          })
        }
      />

      {item.deposit && <DepositCard id={id} />}

      {item.step === "handover" && (
        <HandoverCard
          decision={a.decision}
          info={item.handover}
          policy={policies.handover}
          postop={
            a.postopUsed === null
              ? null
              : { days: a.postopUsed, text: a.postopRead && a.postopRead.days === a.postopUsed ? a.postopRead.text : "직원이 고친 값" }
          }
          handedAtLabel={handedAt}
          onToggleHanded={() =>
            update((s) => {
              const next = { ...s.handedOver };
              if (next[id]) delete next[id];
              else next[id] = NOW_LABEL;
              return addLog(
                { ...s, handedOver: next },
                { target: id, action: s.handedOver[id] ? "인계 취소" : "인계 표시", by: "CS 직원", at: NOW_LABEL, detail: "" },
              );
            })
          }
        />
      )}
      {item.step === "handover" && record?.classification?.status === "classified" && (
        <p className="small muted">분류(녹화): {record.classification.classification.reason}</p>
      )}

      {item.step === "public-template" && <TemplatePicker target={id} />}

      {item.step === "hold" && !draft && (
        <section className="card">
          <h2>보류</h2>
          <p>{record?.route.holdReason ?? a.decision.holdReason ?? "초안을 만들지 않습니다."}</p>
        </section>
      )}

      {(item.step === "classify" || item.step === "draft" || item.step === "shop-redirect" || (item.step === "hold" && draft)) && (
        <>
          <ClassificationCard id={id} />
          {item.step === "shop-redirect" && (
            <section className="card warn">
              <h2>쇼핑몰 문의 — 연결 창구 안내</h2>
              <p>
                쇼핑몰은 별도 사업자가 운영합니다. 병원 창구에서 주문·배송·반품을 처리하지 않고 쇼핑몰 고객센터를 안내합니다(V18). 아래 검색 결과의 V18 문단을
                근거로 안내합니다.
              </p>
            </section>
          )}
          {a.retrieval && <RetrievalPanel retrieval={a.retrieval} />}
          {record && a.postopUsed !== record.postopDay && (
            <p className="badge orange">
              녹화된 초안은 경과일 {record.postopDay === null ? "없음" : `D+${record.postopDay}`}으로 검색한 결과입니다. 고친 경과일은 ① 검색에만 반영됩니다.
            </p>
          )}
          <div className="two-col">
            <ExcerptPanel
              docs={draft ? draft.documents.map((d) => ({ docId: d.docId, title: k.titles.get(d.docId) ?? d.docId, chunks: d.blocks })) : a.excerpts}
              highlight={highlight}
              source={draft ? "recorded" : "live"}
            />
            <div className="sticky-col">
              <DraftPanel
                draft={draft}
                onCite={cite}
                notRecordedText={
                  bundle.recording
                    ? item.step === "shop-redirect"
                      ? "쇼핑몰 안내 경로라 AI 초안을 만들지 않았습니다."
                      : "이 문의에는 녹화된 AI 초안이 없습니다."
                    : "AI 초안은 녹화 전입니다 — 규칙·검색 단계는 지금 바로 동작합니다."
                }
              />
              <VerifyPanel draft={draft} />
            </div>
          </div>
          {draft?.status === "ok" && draft.finalText && <ApprovePanel target={id} initialText={draft.finalText} replyMode={a.decision.replyMode} />}
        </>
      )}
    </div>
  );
}

function ClassificationCard({ id }: { id: string }) {
  const record = inquiryRecord(id);
  const c = record?.classification;
  return (
    <section className="card" aria-label="분류">
      <h2>분류 (F4)</h2>
      {!c ? (
        <p className="muted">{bundle.recording ? "녹화된 분류가 없습니다." : "AI 분류는 녹화 전입니다. 규칙 게이트는 통과했습니다."}</p>
      ) : c.status === "unclassified" ? (
        <p>미분류 — {c.reason}. 초안을 만들지 않고 보류합니다.</p>
      ) : (
        <dl className="kv">
          <dt>유형</dt>
          <dd>{CATEGORY_LABEL[c.classification.category] ?? c.classification.category}</dd>
          <dt>우선순위</dt>
          <dd>{c.classification.priority}</dd>
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
  read,
  used,
  overridden,
  onSave,
  onReset,
}: {
  id: string;
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
  return (
    <section className="card" aria-label="경과일">
      <h2>경과일 (F17)</h2>
      <p className="small">
        문의에서 읽은 값: {read ? <strong>D+{read.days}</strong> : "없음"}
        {read && <span className="muted"> — &ldquo;{read.text}&rdquo;에서 읽음</span>}
        {overridden && (
          <span className="badge blue" style={{ marginLeft: 6 }}>
            직원이 고침: {used === null ? "없음" : `D+${used}`}
          </span>
        )}
      </p>
      <p className="small muted">
        환자가 쓴 문장에서만 읽습니다. 다른 문의와 합쳐 추정하지 않습니다. 틀렸으면 고치세요 — 검색이 그 구간 안내 문단을 앞에 세웁니다.
      </p>
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
          <input
            id={`postop-${id}`}
            inputMode="numeric"
            value={shown}
            onChange={(e) => setValue(e.target.value)}
            placeholder="없음"
            style={{ width: 120 }}
            aria-invalid={!valid}
          />
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
    </section>
  );
}

const DEPOSIT_INTENTS = [
  { key: "confirm", label: "확정 안내", query: "예약금 입금 확인 확정 연락" },
  { key: "change", label: "일정 변경 안내", query: "예약 변경 기한 예약금 옮겨" },
  { key: "refund", label: "환불 안내", query: "취소 예약금 환불" },
] as const;

function DepositCard({ id }: { id: string }) {
  const { k, policies } = engine();
  const { state, update } = useDemoState();
  const [intent, setIntent] = useState<(typeof DEPOSIT_INTENTS)[number]["key"]>("confirm");
  const q = bundle.inquiries.find((x) => x.id === id)!;
  const item = buildInboxItem(q, k, inquiryRecord(id), policies, { sent: new Set(), handedOver: new Map() }, DEMO_NOW_MS);
  const d = item.deposit!;
  const attempts = state.contactAttempts[id] ?? [];
  const src = policies.confirm.businessDays;
  const chosen = DEPOSIT_INTENTS.find((x) => x.key === intent)!;
  // 안내 초안의 근거는 예약 규정(V04)에서만 찾는다. 같은 retrieve를 쓰고 V04 문단만 남긴다.
  const basis = retrieve(k.index, "staff-qa", chosen.query, null, 20)
    .hits.filter((h) => h.chunk.docId === "V04")
    .slice(0, 2);
  return (
    <section className={`card ${d.overdue ? "alert" : "warn"}`} aria-label="예약금 확정 대기">
      <h2>예약금 받음 · 확정 대기 (F16)</h2>
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
          {src.chunkId ? `${src.chunkId} "입금을 확인하면 ${src.value}영업일 안에 확정 연락"` : `V04에서 읽지 못해 기본값 ${src.value}영업일`} · 받은 뒤 새로
          시작하는 진료일의 진료 종료까지로 계산
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
        <dd>
          {attempts.length === 0
            ? "없음"
            : attempts.map((t, i) => (
                <div key={i}>
                  {i + 1}회 · {t}
                </div>
              ))}
        </dd>
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
      <h3 style={{ marginTop: 12 }}>안내 초안 자리</h3>
      <div className="row" role="tablist" aria-label="안내 종류">
        {DEPOSIT_INTENTS.map((x) => (
          <button
            key={x.key}
            type="button"
            role="tab"
            aria-selected={intent === x.key}
            className={intent === x.key ? "primary" : ""}
            onClick={() => setIntent(x.key)}
          >
            {x.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" style={{ marginTop: 8 }}>
        <p className="small muted">
          예약 규정(V04)의 근거 문단입니다. AI 초안은 {inquiryRecord(id)?.draft ? "아래 ③에 녹화된 것이 있습니다" : "녹화된 것만 보입니다"}.
        </p>
        {basis.map((h) => (
          <div key={h.chunk.chunkId} className="para">
            <span className="badge" style={{ marginRight: 6 }}>
              {h.chunk.chunkId}
            </span>
            {h.chunk.text}
          </div>
        ))}
        <p className="small muted">{KIND_LABEL.deposit}: 적신호 다음 순서로 처리합니다(V04).</p>
      </div>
    </section>
  );
}
