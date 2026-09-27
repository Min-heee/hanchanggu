"use client";

/**
 * 모든 화면 위의 띠와 탭. 띠는 스크롤해도 보인다 — 심사자가 어느 화면을 캡처해도
 * "가상 의원 · 합성 데이터 · 미리 생성한 AI 응답"과 "사람이 검토 후 발송"이 함께 찍히게(PRD 3절·10절).
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { formatKst, DEMO_NOW_MS } from "@/demo/clock";
import { bundle } from "../_lib/data";

const TABS = [
  { href: "/", label: "통합 목록" },
  { href: "/qa", label: "사내 Q&A" },
  { href: "/eval", label: "평가" },
];

function recordingLabel(): string {
  if (bundle.recordingSource === "fake-fixture") return "시험용 가짜 녹화(모델 호출 없음)";
  if (!bundle.recording) return "AI 응답 녹화 전";
  return `${bundle.recording.servedModels.join(", ") || bundle.recording.requestedModel} · ${bundle.recording.generatedAt.slice(0, 10)} 생성`;
}

export function Chrome() {
  const path = usePathname();
  const active = (href: string) => (href === "/" ? path === "/" || path.startsWith("/inquiry") : path.startsWith(href));
  return (
    <>
      <div className="band" role="note" aria-label="시연 안내">
        <span>
          <strong>가상 의원 · 합성 데이터 · 미리 생성한 AI 응답</strong> — AI 초안, 사람이 검토 후 발송
        </span>
        <span>
          기준 시각 {formatKst(DEMO_NOW_MS)} · {bundle.recordingSource === "fake-fixture" ? <span className="fake">{recordingLabel()}</span> : recordingLabel()}
        </span>
      </div>
      <header className="top">
        <div className="brand">
          <h1>한창구</h1>
          <small>가상 &lsquo;샘플의원&rsquo; 문의 창구 모음 · 규칙·검색은 브라우저에서 바로 동작</small>
        </div>
        <nav className="tabs" aria-label="화면">
          {TABS.map((t) => (
            <Link key={t.href} href={t.href} aria-current={active(t.href) ? "page" : undefined}>
              {t.label}
            </Link>
          ))}
        </nav>
      </header>
    </>
  );
}
