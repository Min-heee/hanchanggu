"use client";

/**
 * 통합 목록(PRD F3). 순서와 상태는 src/demo/inbox.ts가 정한다. 여기서는 그리고 거르기만 한다.
 */

import Link from "next/link";
import { useMemo, useState } from "react";
import { DEMO_NOW_MS, formatDuration, formatKst } from "@/demo/clock";
import {
  buildInboxItem,
  filterInbox,
  filterOptions,
  KIND_LABEL,
  sortInbox,
  STATUS_LABEL,
  type InboxFilter,
  type InboxItem,
  type InboxKind,
  type InboxStatus,
} from "@/demo/inbox";
import { sentTargets } from "@/demo/state";
import { bundle, channelLabel, engine, inquiryRecord } from "../_lib/data";
import { useDemoState } from "../_lib/useDemoState";
import { ChannelBadge, KindBadge, StatusBadge } from "./Badges";

function Deadline({ item }: { item: InboxItem }) {
  if (item.handover) {
    const h = item.handover;
    if (h.deadlineMs === null) return <span className="badge gray">시한 모름(V12)</span>;
    return h.overdue ? (
      <span className="badge red">{h.phase === "to-handover" ? "인계 시한 지남" : "의료진 연락 시한 지남"}</span>
    ) : (
      <span className="badge orange">
        {h.phase === "to-handover" ? "인계" : "의료진 연락"} {formatKst(h.deadlineMs)}까지
      </span>
    );
  }
  if (item.deposit) {
    const d = item.deposit;
    return (
      <span className={`badge ${d.overdue ? "red" : "orange"}`}>
        예약금 받음 · 확정 연락{" "}
        {d.deadlineMs === null
          ? "시한 모름"
          : d.overdue
            ? `시한 ${formatDuration(-(d.remainingMinutes ?? 0))} 지남`
            : `${formatDuration(d.remainingMinutes ?? 0)} 남음`}
      </span>
    );
  }
  return null;
}

/** 목록 위 요약: 적신호·확정 대기가 몇 건이고 시한이 지난 건이 몇 건인지 스크롤 없이 보인다(30초 시연 0~5초). */
function Summary({ items, onPick }: { items: InboxItem[]; onPick: (k: InboxKind | null) => void }) {
  const open = items.filter((i) => i.status !== "sent");
  const red = open.filter((i) => i.group === 0);
  const dep = open.filter((i) => i.group === 1);
  const redOver = red.filter((i) => i.handover?.overdue).length;
  const depOver = dep.filter((i) => i.deposit?.overdue).length;
  const nextDep = dep
    .map((i) => i.deposit?.remainingMinutes ?? null)
    .filter((m): m is number => m !== null && m >= 0)
    .sort((a, b) => a - b)[0];
  return (
    <div className="row" style={{ marginBottom: 8 }}>
      <button type="button" className="summary red" onClick={() => onPick("redflag")}>
        적신호 인계 {red.length}건{redOver > 0 ? ` · 시한 지남 ${redOver}` : ""}
      </button>
      <button type="button" className="summary orange" onClick={() => onPick("deposit")}>
        예약금 받음 · 확정 대기 {dep.length}건
        {depOver > 0 ? ` · 시한 지남 ${depOver}` : nextDep !== undefined ? ` · 가장 가까운 시한 ${formatDuration(nextDep)} 남음` : ""}
      </button>
      <button type="button" className="summary" onClick={() => onPick(null)}>
        전체 {items.length}건
      </button>
    </div>
  );
}

const GROUP_TITLE = ["적신호 인계", "예약금 받음 · 확정 대기", "기다린 시간 순"];

export function Inbox() {
  const { k, policies } = engine();
  const { state } = useDemoState();
  const [filter, setFilter] = useState<InboxFilter>({ channel: null, kind: null, status: null });

  const items = useMemo(() => {
    const marks = {
      sent: sentTargets(state),
      handedOver: new Map(Object.entries(state.handedOver).map(([id]) => [id, DEMO_NOW_MS])),
    };
    return sortInbox(bundle.inquiries.map((q) => buildInboxItem(q, k, inquiryRecord(q.id), policies, marks, DEMO_NOW_MS)));
  }, [state, k, policies]);
  const opts = filterOptions(items);
  const shown = filterInbox(items, filter);

  return (
    <section aria-labelledby="inbox-title">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2 id="inbox-title">통합 목록 · {items.length}건</h2>
        <span className="small muted">창구 {opts.channels.length}곳 · 주말(토 18:10~월 09:40)에 쌓인 합성 문의</span>
      </div>
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
      </div>
      <Summary items={items} onPick={(kind) => setFilter({ channel: null, kind, status: null })} />
      <p className="small muted" aria-live="polite">
        {shown.length}건 표시 · 순서: 적신호 인계 → 예약금 확정 대기 → 오래 기다린 순 · 발송한 건은 맨 아래
      </p>
      <ul className="inbox">
        {shown.map((it, i) => (
          <li key={it.id}>
            {(i === 0 || shown[i - 1].group !== it.group || (shown[i - 1].status === "sent") !== (it.status === "sent")) && (
              <div className="group-title">{it.status === "sent" ? "발송함" : GROUP_TITLE[it.group]}</div>
            )}
            <Link href={`/inquiry/${it.id}`} className={`item g${it.status === "sent" ? 2 : it.group}`}>
              <div className="meta">
                <strong style={{ color: "var(--text)" }}>{it.id}</strong>
                <ChannelBadge channel={it.inquiry.channel} />
                <KindBadge kind={it.kind} />
                <StatusBadge status={it.status} />
                <Deadline item={it} />
              </div>
              <p className="text">{it.inquiry.text}</p>
              <div className="meta">
                <span>받음 {formatKst(it.receivedMs)}</span>
                <span>· 기다린 시간 {formatDuration(it.waitMinutes)}</span>
                {it.inquiry.attachments.length > 0 && <span>· 첨부 {it.inquiry.attachments.length}</span>}
              </div>
            </Link>
          </li>
        ))}
      </ul>
      {shown.length === 0 && <p>조건에 맞는 문의가 없습니다.</p>}
    </section>
  );
}
