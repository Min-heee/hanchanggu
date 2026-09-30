"use client";

/**
 * 통합 목록(PRD F3). 순서·상태 배지·시한·요약·접기는 src/demo/inbox.ts가 정한다. 여기서는 그리고 거르기만 한다.
 * 미리보기 글은 개인정보를 가린 글이다 — 목록은 가장 먼저 보이는 화면이고, 링크의 이름(스크린리더)·복사한 글에도 들어간다.
 *
 * 한 행의 위계(오너 피드백 "정신 사나워, 가독성이 없어"): 눈에 먼저 들어오는 것은 ① 상태 배지 하나(할 일을 글자로, 색은 여기에만)
 * ② 문의 원문 ③ 오른쪽 칸 — 시한(지났으면 진한 글자) 또는 기다린 시간. 번호·창구·유형 세부·받은 시각·첨부·개인정보 가림은 옅은 보조 줄 하나에 모은다.
 * 빨강은 배지에만 쓴다: 시한 지남까지 빨갛게 칠하면 위쪽 인계 21행이 모두 빨간 덩어리 둘씩이 되어 순서가 안 보였다.
 * '시한 지남'은 묶음 제목에 한 번 적는다. 행 배경색·묶음 색 띠는 쓰지 않는다 — 묶음은 제목과 순서로 나눈다.
 */

import Link from "next/link";
import { Fragment, useMemo, useState } from "react";
import { DEMO_NOW_MS, formatDuration, formatKst } from "@/demo/clock";
import {
  buildInboxItem,
  filterInbox,
  filterOptions,
  inboxRows,
  inboxSummary,
  KIND_LABEL,
  receivedRangeText,
  rowBadge,
  rowDue,
  rowMeta,
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
import { RowBadge } from "./Badges";

const NO_FILTER: InboxFilter = { channel: null, kind: null, status: null, group: null };

/**
 * 목록 위 요약 숫자 한 칸. 묶음 칸은 누르면 그 묶음만 거르고 다시 누르면 푼다(aria-pressed). '전체' 칸은 켜고 끄는 버튼이 아니라
 * 거르기를 푸는 버튼이라 눌림 상태를 두지 않는다(화면에 눌림 표시가 없는데 스크린리더만 "눌림"이라고 읽었다).
 * 이름(aria-label)은 보이는 라벨로 시작한다.
 */
function Stat(props: { label: string; short?: string; n: number; note: string | null; over: boolean; pressed?: boolean; onClick: () => void }) {
  const { label, short, n, note, over, pressed, onClick } = props;
  return (
    <button type="button" className={pressed === undefined ? "stat" : "stat group"} aria-pressed={pressed} onClick={onClick} aria-label={`${label} ${n}건${note ? `, ${note}` : ""}`}>
      <span className="stat-label">
        {short ? (
          <>
            <span className="narrow-only-inline">{short}</span>
            <span className="wide-only">{label}</span>
          </>
        ) : (
          label
        )}
      </span>
      <span className="stat-num">
        {n}
        <small>건</small>
      </span>
      <span className={over ? "stat-note over" : "stat-note"}>{note ?? "\u00a0"}</span>
    </button>
  );
}

export function Inbox() {
  const { k, policies } = engine();
  const { state } = useDemoState();
  const [filter, setFilter] = useState<InboxFilter>(NO_FILTER);
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
  const group = filter.group ?? null;
  const filtered = filter.channel !== null || filter.kind !== null || filter.status !== null || group !== null;
  // 적신호는 앞 2건만 보이고 접는다 — 노트북 첫 화면에 약 인계·확정 대기 묶음까지 들어오게.
  const rows = inboxRows(shown, { collapseRedflag: !expanded && !filtered });
  const inGroup = (key: string) => shown.filter((i) => (i.status === "sent" ? "sent" : String(i.group)) === key);
  // 묶음 제목: 건수 · 시한 지남(행마다 칠하지 않고 여기 한 번) · 접혔으면 몇 건만 보이는지.
  const groupNote = (key: string, hidden: number) => {
    const g = inGroup(key);
    const over = g.filter((i) => rowDue(i, DEMO_NOW_MS)?.over).length;
    return {
      n: g.length,
      over: over === 0 ? null : over === g.length ? "모두 시한 지남" : `${over}건 시한 지남`,
      peek: hidden > 0 ? `${g.length - hidden}건만 표시` : null,
    };
  };
  const more = rows.find((r) => r.type === "more");
  const hiddenIn = (key: string) => (key === "0" && more?.type === "more" ? more.hidden : 0);
  const pickGroup = (g: InboxItem["group"] | null) => setFilter(g === null || g === group ? NO_FILTER : { ...NO_FILTER, group: g });
  const overdue = (n: number, of: number) => (n === 0 ? null : n === of ? "모두 시한 지남" : `시한 지남 ${n}건`);

  return (
    <section aria-labelledby="inbox-title" id="inbox">
      <div className="inbox-head">
        <h2 id="inbox-title">통합 목록</h2>
        <span className="small muted">
          <span className="now">{formatKst(DEMO_NOW_MS)} 기준</span>
          <span className="wide-only">
            {" "}
            · 창구 {opts.channels.length}곳 · {range ? `${range}에 받은 ` : ""}합성 문의
          </span>
        </span>
      </div>
      <div className="stats" role="group" aria-label="할 일 요약 — 누르면 그 묶음만 봅니다">
        <Stat label="적신호 인계" short="적신호" n={sum.redflag} note={overdue(sum.redflagOverdue, sum.redflag)} over={sum.redflagOverdue > 0} pressed={group === 0} onClick={() => pickGroup(0)} />
        <Stat
          label="약·분류 인계"
          short="약·분류"
          n={sum.otherHandover}
          note={overdue(sum.otherHandoverOverdue, sum.otherHandover)}
          over={sum.otherHandoverOverdue > 0}
          pressed={group === 1}
          onClick={() => pickGroup(1)}
        />
        <Stat
          label={KIND_LABEL.deposit}
          short="예약금"
          n={sum.deposit}
          note={
            sum.depositOverdue > 0 ? overdue(sum.depositOverdue, sum.deposit) : sum.nextDepositMinutes !== null ? `가장 가까운 시한 ${formatDuration(sum.nextDepositMinutes)} 남음` : null
          }
          over={sum.depositOverdue > 0}
          pressed={group === 2}
          onClick={() => pickGroup(2)}
        />
        <Stat label="전체" n={sum.total} note={filtered ? `지금 ${shown.length}건 표시` : null} over={false} onClick={() => pickGroup(null)} />
      </div>
      <p className="small muted inbox-note">
        <span className="wide-only">적신호 수는 안전 규칙이 잡은 수라 과잉 인계가 섞일 수 있습니다(정답과 비교는 </span>
        <span className="narrow-only-inline">적신호 수에는 과잉 인계가 섞일 수 있습니다(</span>
        <Link href="/eval">평가</Link> 탭).
      </p>
      <details className="filters-fold">
        <summary>
          거르기 · 정렬 기준 <span className="muted small">({filtered ? `적용 중 · ${shown.length}건` : `${shown.length}건 모두 표시`})</span>
        </summary>
        <p className="small muted">
          순서: 적신호 → 약·분류 인계 → 예약금 확정 대기 → 오래 기다린 순, 발송한 건은 맨 아래(인계 건은 초안을 보내도 인계 묶음에 남음).
        </p>
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
            <button type="button" onClick={() => setFilter(NO_FILTER)}>
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
            <GroupTitle key={r.key} text={r.text} {...groupNote(r.key.slice(2), hiddenIn(r.key.slice(2)))} />
          ) : r.type === "more" ? (
            <li key={r.key} className="more-row">
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
        <button type="button" className="fold-back" onClick={() => setExpanded(false)}>
          적신호 인계 접기
        </button>
      )}
      {shown.length === 0 && <p>조건에 맞는 문의가 없습니다.</p>}
    </section>
  );
}

function GroupTitle({ text, n, over, peek }: { text: string; n: number; over: string | null; peek: string | null }) {
  return (
    <li className="group-title">
      {text} <span className="count">{n}건</span>
      {over && <span className="gt-over"> · {over}</span>}
      {peek && <span className="count"> · {peek}</span>}
    </li>
  );
}

function Row({ it }: { it: InboxItem }) {
  const badge = rowBadge(it);
  const due = rowDue(it, DEMO_NOW_MS);
  const meta = rowMeta(it, { channel: channelLabel(it.inquiry.channel), drift: driftFor(it.id).length > 0, nowMs: DEMO_NOW_MS });
  return (
    <Link href={`/inquiry/${it.id}`} className="item">
      <span className="item-badge">
        <RowBadge badge={badge} />
      </span>
      <p className="text">{it.decision.mask.masked}</p>
      {due && <span className={due.over ? "due over" : due.wait ? "due wait" : "due"}>{due.text}</span>}
      <p className="item-meta">
        {meta.map((m, i) => (
          <Fragment key={i}>
            {i > 0 && " · "}
            <span className={m.warn ? "m warn" : "m"}>{m.text}</span>
          </Fragment>
        ))}
      </p>
    </Link>
  );
}
