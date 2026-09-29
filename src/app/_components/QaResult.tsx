/**
 * 사내 Q&A의 결과 한 묶음(규칙 카드 → 질문 → ①검색 → ②발췌 → ③AI 답 → ④확인).
 * QaView에서 떼어 낸 이유: QaView는 링크(?q=)·클릭으로 정한 질문을 effect로 받아서 renderToStaticMarkup으로는 결과를 그릴 수 없다.
 * 결과를 값만 받는 컴포넌트로 두면 "녹화가 없어도 규칙 카드가 뜬다"를 시험으로 고정할 수 있다(적대 검증: 녹화가 있을 때만
 * 카드를 그리게 바꿔도 기존 시험이 통과했다). 그래서 규칙 카드 판정도 여기서 한다 — 호출하는 쪽이 녹화 유무로 막을 틈을 두지 않는다.
 * 녹화·번들 값(data.ts)은 읽지 않고 받는다. 받지 않고 읽으면 시험이 '녹화 없음'을 만들 수 없다.
 */

import { useState, type Ref } from "react";
import type { Knowledge } from "@/core/knowledge";
import type { Fill } from "@/core/template";
import type { analyzeStaffQuestion } from "@/demo/analyze";
import type { Bundle } from "@/demo/bundle";
import type { HandoverPolicy } from "@/demo/policy";
import { staffRuleCard } from "@/demo/qa";
import type { GoldenRecord } from "@/demo/recording";
import { draftDisplay } from "@/demo/refill";
import {
  draftSourceLabel,
  fillSourceChunk,
  liveExcerpts,
  maskedCaseForQuestion,
  maskedView,
  recordedExcerpts,
  recordedRetrievalView,
  retrievalView,
} from "@/demo/view";
import { MaskedText } from "./MaskedText";
import { DraftPanel, ExcerptPanel, RetrievalPanel, VerifyPanel } from "./Pipeline";
import { StaffRuleCard } from "./StaffRuleCard";

export interface QaResultProps {
  k: Knowledge;
  handoverPolicy: HandoverPolicy;
  a: ReturnType<typeof analyzeStaffQuestion>;
  /** 이 질문의 미리 만든 AI 답. 없으면 null — 규칙 카드는 이 값과 상관없이 뜬다. */
  rec: GoldenRecord | null;
  recordingSource: Bundle["recordingSource"];
  drift: string[];
  inGaps: boolean;
  onAddGap: () => void;
  /** 결과 맨 위(규칙 카드가 있으면 카드). 질문을 고르면 여기로 스크롤한다. */
  topRef?: Ref<HTMLDivElement>;
  titleRef?: Ref<HTMLHeadingElement>;
}

export function QaResult({ k, handoverPolicy, a, rec, recordingSource, drift, inGaps, onAddGap, topRef, titleRef }: QaResultProps) {
  // 새 질문마다 강조를 지운다 — 부르는 쪽이 key로 다시 만든다.
  const [highlight, setHighlight] = useState<Set<string>>(new Set());
  const hasRecording = recordingSource !== "none";

  // 규칙 카드는 AI 답(녹화)과 상관없이 지금 볼트 규칙으로 판정한다. 녹화가 없어도 뜬다.
  const ruleCard = staffRuleCard(k, handoverPolicy, a.mask.masked);

  const live = retrievalView(k, a.retrieval, a.mask.masked);
  const recorded = rec ? recordedRetrievalView(k, { retrieval: rec.retrieval, excludedMatches: rec.excludedMatches, retrievalMeta: rec.retrievalMeta }, "staff-qa", rec.maskedQuestion, null) : null;
  const liveDiffers = recorded && live.items.map((x) => x.chunkId).join() !== recorded.items.map((x) => x.chunkId).join();
  // 읽는 글은 녹화의 모델 글을 지금 코드로 다시 채운 것이다(src/demo/refill.ts).
  const display = rec ? draftDisplay(k, rec.draft, "staff-qa") : null;
  const fillSources = (display?.fills ?? []).map((f) => {
    const c = fillSourceChunk(k, f);
    const chunk = c ? k.chunks.find((x) => x.chunkId === c) : undefined;
    return { fill: f, chunk: chunk ? { chunkId: chunk.chunkId, text: chunk.text } : null };
  });
  const onFill = (f: Fill) => {
    const c = fillSourceChunk(k, f);
    if (!c) return;
    setHighlight(new Set([`price:${c}`]));
    document.getElementById(`price-src-${c}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  return (
    <div aria-live="polite" ref={topRef} className="result-top">
      {ruleCard && <StaffRuleCard model={ruleCard} />}
      <section className="card">
        <h2 ref={titleRef} tabIndex={-1} className="result-title">
          질문
        </h2>
        <p className="quote">{a.mask.masked}</p>
        <MaskedText view={maskedView(maskedCaseForQuestion(rec, a.mask))} />
        {drift.length > 0 && (
          <div className="note warn" role="note">
            <strong>미리 만든 AI 답 이후 바뀐 곳이 있습니다.</strong>
            <ul className="small">
              {drift.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          </div>
        )}
      </section>
      <RetrievalPanel view={recorded ?? live} compare={liveDiffers ? live : null} />
      <div className="two-col">
        <ExcerptPanel
          docs={rec && rec.draft.documents.length > 0 ? recordedExcerpts(k, rec.draft) : liveExcerpts(k, a.excerpts)}
          highlight={highlight}
          source={rec && rec.draft.documents.length > 0 ? "recorded" : "live"}
          weak={a.retrieval.weak}
        />
        <div className="sticky-col">
          {ruleCard && (
            <p className="note warn small" role="note">
              <strong>규칙 카드가 우선합니다.</strong> 아래 AI 답에 인계 절차가 빠져 있어도 맨 위 카드대로 의료진에게 넘기세요.
            </p>
          )}
          <DraftPanel
            draft={rec?.draft ?? null}
            display={display}
            sourceLabel={rec ? draftSourceLabel(recordingSource, rec.draft.meta.model, rec.draft.meta.servedByFallback) : ""}
            onCite={(ids) => {
              setHighlight(new Set(ids));
              document.getElementById(`para-${ids[0]}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
            }}
            onFill={onFill}
            notReadyText={
              a.retrieval.weak
                ? "근거가 약해 AI를 부르지 않고 보류합니다. 아래 ‘문서 빈칸’에 쌓았습니다."
                : hasRecording
                  ? "준비된 질문만 AI 초안이 있습니다. 이 질문은 준비되지 않았습니다."
                  : "AI 초안은 아직 준비 전입니다 — 문서 찾기와 발췌는 지금 동작합니다."
            }
          />
          <VerifyPanel draft={rec?.draft ?? null} display={display} fillSources={fillSources} highlight={highlight} />
        </div>
      </div>
      {inGaps ? (
        <p className="note small">이 질문은 &lsquo;문서 빈칸&rsquo;에 있습니다(아래).</p>
      ) : (
        <p className="row small">
          <span>발췌에 답이 없나요?</span>
          <button type="button" onClick={onAddGap}>
            문서 빈칸에 추가
          </button>
        </p>
      )}
    </div>
  );
}
