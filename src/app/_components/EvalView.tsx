"use client";

/**
 * 평가 탭(PRD 7절, F15). 숫자는 src/demo/evaluation.ts가 번들에서 계산한다(모델 호출 없음).
 * 기준을 못 넘어도 그대로 싣는다. 녹화가 필요한 지표는 "녹화 전"으로 두고 숫자를 채우지 않는다.
 */

import Link from "next/link";
import { useMemo } from "react";
import { computeMetrics, type Metric } from "@/demo/evaluation";
import { bundle, engine } from "../_lib/data";

const STATE_LABEL: Record<Metric["state"], string> = { computed: "계산함", "needs-recording": "녹화 전", human: "사람이 확인" };

function value(m: Metric) {
  if (m.numerator === null || m.denominator === null) return m.state === "needs-recording" ? "녹화 전" : "—";
  const pct = m.denominator === 0 ? "—" : `${((100 * m.numerator) / m.denominator).toFixed(1)}%`;
  return `${m.numerator} / ${m.denominator} (${pct})`;
}

function targetLink(id: string) {
  // 문의 ID는 상세 화면으로 잇는다. 골든셋 ID는 사내 Q&A에서 고를 수 있다.
  return /^Q\d+$/.test(id) ? <Link href={`/inquiry/${id}`}>{id}</Link> : <span>{id}</span>;
}

export function EvalView() {
  const { k } = engine();
  const metrics = useMemo(() => computeMetrics(k, bundle.inquiries, bundle.golden, bundle.recording), [k]);
  const failures = metrics.filter((m) => m.failures.length > 0);
  return (
    <div>
      <section className="card">
        <h2>평가 (합성 데이터 기준)</h2>
        <p className="small">
          정답 라벨은 AI가 적은 초안이고 사람 검수 전입니다. 적신호 규칙과 합성 문의를 같은 도구로 만들었으므로 &ldquo;누락 0&rdquo;은 규칙이 자기 시험을
          통과했다는 뜻 이상이 아닙니다.
          {bundle.recordingSource === "fake-fixture" && <strong> 지금 번들은 시험용 가짜 녹화라 녹화 지표 숫자는 의미가 없습니다.</strong>}
        </p>
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
                      근거: {m.basis}
                      {m.note ? ` · ${m.note}` : ""}
                    </div>
                  </td>
                  <td className="num">{value(m)}</td>
                  <td>{m.target}</td>
                  <td>
                    {m.pass === true ? (
                      <span className="badge green">기준 충족</span>
                    ) : m.pass === false ? (
                      <span className="badge red">기준 미달</span>
                    ) : (
                      <span className="badge gray">{STATE_LABEL[m.state]}</span>
                    )}
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
