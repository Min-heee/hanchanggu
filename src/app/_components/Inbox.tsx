"use client";

/**
 * 통합 목록(PRD F3). 순서·상태·시한 배지·요약·접기는 src/demo/inbox.ts가 정한다. 여기서는 그리고 거르기만 한다.
 * 미리보기 글은 개인정보를 가린 글이다 — 목록은 가장 먼저 보이는 화면이고, 링크의 이름(스크린리더)·복사한 글에도 들어간다.
 */

import Link from "next/link";
import { useMemo, useState } from "react";
import { DEMO_NOW_MS, formatDuration, formatKst } from "@/demo/clock";
import {
  buildInboxItem,
  deadlineBadge,
  filterInbox,
  filterOptions,
  inboxRows,
  inboxSummary,
  KIND_LABEL,
  receivedRangeText,
  sortInbox,
  STATUS_LABEL,
  type InboxFilter,
  type InboxItem,
  type InboxKind,
  type InboxStatus,
} from "@/demo/inbox";
import { sentTargets, templateChosenTargets } from "@/demo/state";
import { bundle, channelLabel, driftFor, engine, inquiryRecord } from "../_lib/data";
import { useDemoState } from "../_lib/useDemoState";
import { ChannelBadge, KindBadge, StatusBadge } from "./Badges";

function Deadline({ item }: { item: InboxItem }) {
  const b = deadlineBadge(item, DEMO_NOW_MS);
  return b ? <span className={`badge ${b.tone}`}>{b.text}</span> : null;
}

export function Inbox() {
  const { k, policies } = engine();
  const { state } = useDemoState();
  const [filter, setFilter] = useState<InboxFilter>({ channel: null, kind: null, status: null });
  const [expanded, setExpanded] = useState(false);

  const items = useMemo(() => {
    const marks = {
      sent: sentTargets(state),
      handedOver: new Map(Object.keys(state.handedOver).map((id) => [id, DEMO_NOW_MS])),
      templateChosen: templateChosenTargets(state),
    };
    return sortInbox(bundle.inquiries.map((q) => buildInboxItem(q, k, inquiryRecord(q.id), policies, marks, DEMO_NOW_MS)));
  }, [state, k, policies]);
  const opts = filterOptions(items);
  const shown = filterInbox(items, filter);
  const sum = inboxSummary(items);
  const range = receivedRangeText(items);
  const filtered = filter.channel !== null || filter.kind !== null || filter.status !== null;
  // 적신호는 앞 2건만 보이고 접는다 — 노트북 첫 화면에 약 인계·확정 대기 묶음까지 들어오게.
  const rows = inboxRows(shown, { collapseRedflag: !expanded && !filtered });
  const pick = (kind: InboxKind | null) => setFilter({ channel: null, kind, status: null });

  return (
    <section aria-labelledby="inbox-title" id="inbox">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2 id="inbox-title">통합 목록 · {items.length}건</h2>
        <span className="small muted wide-only">창구 {opts.channels.length}곳 · {range ? `${range}에 받은 ` : ""}합성 문의</span>
      </div>
      <div className="row summary-row">
        <button type="button" className="summary red" onClick={() => pick("redflag")}>
          적신호 인계 {sum.redflag}건{sum.redflagOverdue > 0 ? ` · 시한 지남 ${sum.redflagOverdue}` : ""}
        </button>
        {sum.otherHandover > 0 && (
          <button type="button" className="summary red" onClick={() => pick("medication")}>
            약·분류 인계 {sum.otherHandover}건{sum.otherHandoverOverdue > 0 ? ` · 시한 지남 ${sum.otherHandoverOverdue}` : ""}
          </button>
        )}
        <button type="button" className="summary orange" onClick={() => pick("deposit")}>
          예약금 받음 · 확정 대기 {sum.deposit}건
          {sum.depositOverdue > 0 ? ` · 시한 지남 ${sum.depositOverdue}` : sum.nextDepositMinutes !== null ? ` · 가장 가까운 시한 ${formatDuration(sum.nextDepositMinutes)} 남음` : ""}
        </button>
        <button type="button" className="summary" onClick={() => pick(null)}>
          전체 {sum.total}건
        </button>
      </div>
      <p className="small muted">
        적신호 건수는 안전 규칙이 잡은 수라 과잉 인계가 섞일 수 있습니다(정답과 비교는 <Link href="/eval">평가</Link> 탭).
        <span className="wide-only"> 순서: 적신호 → 약·분류 인계 → 예약금 확정 대기 → 오래 기다린 순, 발송한 건은 맨 아래.</span>
      </p>
      <details className="filters-fold">
        <summary>
          거르기 — 창구·유형·상태 <span className="muted small">({filtered ? `적용 중 · ${shown.length}건` : `${shown.length}건 모두 표시`})</span>
        </summary>
        <div className="filters" role="group" aria-label="목록 거르기">
          <label>
            창구
            <select value={filter.channel ?? ""} onChange={(e) => setFilter({ ...filter, channel: e.target.value || null })}>
              <option value="">전체</option>
              {opts.channels.map((c) => (
                <option key={c} value={c}>
                  {channelLabel(c)}
                </option>
              ))}
            </select>
          </label>
          <label>
            유형
            <select value={filter.kind ?? ""} onChange={(e) => setFilter({ ...filter, kind: (e.target.value || null) as InboxKind | null })}>
              <option value="">전체</option>
              {opts.kinds.map((c) => (
                <option key={c} value={c}>
                  {KIND_LABEL[c]}
                </option>
              ))}
            </select>
          </label>
          <label>
            상태
            <select value={filter.status ?? ""} onChange={(e) => setFilter({ ...filter, status: (e.target.value || null) as InboxStatus | null })}>
              <option value="">전체</option>
              {opts.statuses.map((c) => (
                <option key={c} value={c}>
                  {STATUS_LABEL[c]}
                </option>
              ))}
            </select>
          </label>
          {filtered && (
            <button type="button" onClick={() => pick(null)}>
              거르기 풀기
            </button>
          )}
        </div>
      </details>
      <p className="sr-only" aria-live="polite">
        {shown.length}건 표시
      </p>
      <ul className="inbox">
        {rows.map((r) =>
          r.type === "title" ? (
            <li key={r.key} className="group-title">
              {r.text}
            </li>
          ) : r.type === "more" ? (
            <li key={r.key}>
              <button type="button" className="more" onClick={() => setExpanded(true)}>
                적신호 인계 {r.hidden}건 더 보기
              </button>
            </li>
          ) : (
            <li key={r.key}>
              <Row it={r.item} />
            </li>
          ),
        )}
      </ul>
      {expanded && !filtered && (
        <button type="button" onClick={() => setExpanded(false)}>
          적신호 인계 접기
        </button>
      )}
      {shown.length === 0 && <p>조건에 맞는 문의가 없습니다.</p>}
    </section>
  );
}

function Row({ it }: { it: InboxItem }) {
  const drift = driftFor(it.id).length > 0;
  const maskedCount = it.decision.mask.items.length;
  return (
    <Link href={`/inquiry/${it.id}`} className={`item g${it.status === "sent" ? 3 : it.group}`}>
      <div className="meta">
        <strong style={{ color: "var(--text)" }}>{it.id}</strong>
        <ChannelBadge channel={it.inquiry.channel} />
        <KindBadge kind={it.kind} />
        <StatusBadge status={it.status} />
        <Deadline item={it} />
        {maskedCount > 0 && <span className="badge gray">개인정보 가림 {maskedCount}곳</span>}
        {drift && <span className="badge orange">AI 답 이후 바뀜</span>}
        <span className="when">
          받음 {formatKst(it.receivedMs)} · 기다린 시간 {formatDuration(it.waitMinutes)}
          {it.inquiry.attachments.length > 0 && ` · 첨부 ${it.inquiry.attachments.length}`}
        </span>
      </div>
      <p className="text">{it.decision.mask.masked}</p>
    </Link>
  );
}
