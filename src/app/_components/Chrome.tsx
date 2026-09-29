"use client";

/**
 * 모든 화면 위의 띠와 탭, 그리고 이 브라우저의 시연 기록. 띠는 스크롤해도 보인다 — 방문자가 어느 화면을 캡처해도
 * 가상 의원·합성 데이터라는 것과 AI 초안이 준비됐는지, "사람이 검토 후 발송"이 함께 찍히게(PRD 3절·10절).
 * 띠 문구는 src/demo/view.ts bandText가 정한다(미리 만든 AI 답이 없으면 없다고 쓴다).
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { formatKst, DEMO_NOW_MS } from "@/demo/clock";
import { bandText } from "@/demo/view";
import { bundle } from "../_lib/data";
import { useDemoState, useStorageBlocked } from "../_lib/useDemoState";
import { ActionLog } from "./Approve";

const TABS = [
  { href: "/", label: "통합 목록" },
  { href: "/qa", label: "사내 Q&A" },
  { href: "/eval", label: "평가" },
];

export function Chrome() {
  const path = usePathname();
  const active = (href: string) => (href === "/" ? path === "/" || path.startsWith("/inquiry") : path.startsWith(href));
  const band = bandText(bundle);
  const blocked = useStorageBlocked();
  const { state } = useDemoState();
  const count = state.log.length + state.gaps.length;
  return (
    <>
      <div className="band" role="note" aria-label="시연 안내">
        <span>
          <strong>{band.main}</strong> · AI 초안은 사람이 검토 후 발송
        </span>
        <span>
          {band.fake ? <span className="fake">{band.ai}</span> : band.ai}
          <span className="band-now"> · 기준 시각 {formatKst(DEMO_NOW_MS)}</span>
        </span>
        {blocked && <span className="fake">이 브라우저는 기록을 저장하지 않습니다 — 새로 고치면 사라집니다</span>}
      </div>
      <header className="top">
        <div className="brand">
          <h1>한창구</h1>
          <small>가상 &lsquo;샘플의원&rsquo;의 여러 문의 창구를 한 화면에</small>
        </div>
        <nav className="tabs" aria-label="화면">
          {TABS.map((t) => (
            <Link key={t.href} href={t.href} aria-current={active(t.href) ? "page" : undefined}>
              {t.label}
            </Link>
          ))}
          <details className="records">
            <summary>
              <span className="wide-only">시연 </span>기록 {count}건
            </summary>
            <div className="records-panel">
              <ActionLog showReset />
            </div>
          </details>
        </nav>
      </header>
    </>
  );
}
