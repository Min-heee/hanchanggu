"use client";

/**
 * 평가 탭(PRD 7절, F15). 숫자와 판정 배지는 src/demo/evaluation.ts가 번들에서 계산한다(모델 호출 없음).
 * 기준을 못 넘어도 그대로 싣는다. AI 답이 있어야 하는 지표는 "AI 답 준비 전"으로 두고 숫자를 채우지 않는다.
 * 배지는 metric.verdict를 그대로 그린다 — PRD 기준을 다 재지 않은 지표에 '기준 충족'을 달지 않는 판단은 거기 있다.
 */

import Link from "next/link";
import { useMemo } from "react";
import { computeMetrics, metricValue } from "@/demo/evaluation";
import { bundle, engine } from "../_lib/data";

const TONE = { good: "green", bad: "red", neutral: "gray" } as const;

function targetLink(id: string) {
  // 문의 ID는 상세 화면으로, 직원 질문 ID는 사내 Q&A로 잇는다.
  if (/^Q\d+$/.test(id)) return <Link href={`/inquiry/${id}`}>{id}</Link>;
  if (/^G\d+$/.test(id) && bundle.golden.find((g) => g.id === id)?.kind === "staff-qa") return <Link href={`/qa?q=${id}`}>{id}</Link>;
  return <span>{id}</span>;
}

export function EvalView() {
  const { k } = engine();
  const metrics = useMemo(() => computeMetrics(k, bundle.inquiries, bundle.golden, bundle.recording, bundle.recordingSource), [k]);
  const failures = metrics.filter((m) => m.failures.length > 0);
  return (
    <div>
      <section className="card">
        <h2>평가 (합성 데이터 기준)</h2>
        <ul className="small">
          <li>정답 라벨은 AI가 적은 초안이고 사람 검수 전입니다.</li>
          <li>적신호 규칙과 합성 문의를 같은 도구로 만들었습니다. &ldquo;누락 0&rdquo;은 규칙이 자기 시험을 통과했다는 뜻 이상이 아닙니다.</li>
          <li>검색 적중률을 올리려고 병원 문서(가상)의 표현을 골든셋에 맞춰 고친 곳이 있습니다. 그 변경도 검수 대상입니다.</li>
          <li>분모가 10보다 작은 지표는 퍼센트를 적지 않습니다.</li>
          {bundle.recordingSource === "fake-fixture" && (
            <li>
              <strong>지금은 시험용 가짜 AI 답이라 AI 답 지표의 숫자는 의미가 없습니다(판정 없음).</strong>
            </li>
          )}
        </ul>
        <div style={{ overflowX: "auto" }}>
          <table className="metrics">
            <thead>
              <tr>
                <th scope="col">지표</th>
                <th scope="col">값 (분자 / 분모)</th>
                <th scope="col">기준</th>
                <th scope="col">판정</th>
              </tr>
            </thead>
            <tbody>
              {metrics.map((m) => (
                <tr key={m.key}>
                  <td>
                    <strong>{m.name}</strong>
                    <div className="small muted">{m.definition}</div>
                    <div className="small muted">
                      근거: {m.basis === "녹화" ? "AI 답" : m.basis}
                      {m.note ? ` · ${m.note}` : ""}
                    </div>
                  </td>
                  <td className="num">{metricValue(m)}</td>
                  <td>{m.target}</td>
                  <td>
                    <span className={`badge wrap ${TONE[m.verdict.tone]}`}>{m.verdict.label}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>틀린 사례</h2>
        {failures.length === 0 ? (
          <p>없습니다.</p>
        ) : (
          failures.map((m) => (
            <div key={m.key} style={{ marginBottom: 8 }}>
              <h3>
                {m.name} · {m.failures.length}건
              </h3>
              <ul className="small">
                {m.failures.map((f) => (
                  <li key={f.id}>
                    {targetLink(f.id)} — {f.detail}
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
