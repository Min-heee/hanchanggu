"use client";

/**
 * 인계 카드 안의 '의료진 확인용 AI 초안'(2026-09-30 오너 결정, PRD v0.4).
 *
 * 증상·약 문의도 AI가 답장 초안을 쓴다: [환자가 쓴 내용을 판단 없이 되짚는 한 문장(선택)] + [인계 절차의 고정 안내 문장(필수)] +
 * [문의에 섞인 예약·가격 같은 의료가 아닌 물음의 답(병원 문서 인용)] + [문서의 연락·내원 절차 안내]. 다만
 * - 규칙 게이트가 먼저 인계를 정하고, 인계 카드·응답 시한·직원이 보낼 V12 승인 문구는 그대로다(이 칸은 카드 안에 덧붙는다).
 * - 직원은 이 초안을 보낼 수 없다. 발송 버튼은 의료진 확인(모의) 기록이 있어야 켜진다(ApprovePanel clinicianOnly → canSend).
 * - 초안은 직원 발송 경로(InquiryRecord.draft)와 다른 칸(handoverDraft)에서 온다. 목록 상태·평가 지표는 이 초안을 보지 않는다.
 * 무엇을 그릴지(녹화 전·준비 전·녹화됨)는 src/demo/view.ts handoverDraftView가 정한다(시험으로 고정).
 */

import { useState } from "react";
import type { ReplyMode } from "@/core/route";
import { kstDate } from "@/demo/clock";
import { draftDisplay } from "@/demo/refill";
import { draftSourceLabel, handoverDraftNotice, recheckHandoverDraft, recordedExcerpts, HOLD_TEXT, type HandoverDraftView } from "@/demo/view";
import { bundle, engine } from "../_lib/data";
import { ApprovePanel } from "./Approve";
import { DraftPanel, ExcerptPanel, VerifyPanel } from "./Pipeline";

export function HandoverDraftSection({ id, view, replyMode }: { id: string; view: HandoverDraftView; replyMode: ReplyMode | null }) {
  const { k } = engine();
  const [highlight, setHighlight] = useState<Set<string>>(new Set());
  if (view.kind === "none") return null;

  if (view.kind !== "recorded") {
    return (
      <section className="handover-draft" aria-label="의료진 확인용 AI 초안">
        <div className="row">
          <h3 style={{ margin: 0 }}>의료진 확인용 AI 초안</h3>
          <span className="badge gray">{view.kind === "not-recorded" ? "녹화 전" : "준비 전"}</span>
        </div>
        <p className="small">{handoverDraftNotice(view)}</p>
      </section>
    );
  }

  // 녹화 때의 status를 믿지 않고 지금 볼트 값·검사 규칙으로 다시 검사한다(src/demo/view.ts recheckHandoverDraft). 녹화 뒤 규칙을 조였으면
  // 옛 기준으로 통과한 초안은 여기서 보류가 되어 발송 패널이 뜨지 않는다(막는 쪽으로 틀린다).
  const recorded = view.rec.draft;
  const draft = recheckHandoverDraft(k, view.rec);
  const heldNow = recorded.status === "ok" && draft.status !== "ok";
  // 인계 초안도 환자에게 가는 글이라 환자 답장과 같은 규칙으로 다시 채운다(링크는 제목으로, 승인 안 된 문서 링크는 막음).
  // 승인 문구를 감싼 따옴표는 화면 글·보낼 글에서 뺀다(1차 녹화 20건 중 14건이 감쌌다 — 녹화 파일은 그대로).
  const display = draftDisplay(k, draft, "reply", { unquote: k.index.rules?.handoverDraft?.fixedMessage });
  const run = bundle.recording?.handoverRun;
  const sourceLabel = `${draftSourceLabel(bundle.recordingSource, draft.meta.model, draft.meta.servedByFallback)}${
    run && bundle.recordingSource === "file" ? ` · 인계 초안 ${kstDate(Date.parse(run.generatedAt))} 생성` : ""
  } · 의료진 확인용`;
  const cite = (ids: string[]) => {
    setHighlight(new Set(ids));
    document.getElementById(`para-${ids[0]}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  return (
    <section className="handover-draft" aria-label="의료진 확인용 AI 초안">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h3 style={{ margin: 0 }}>의료진 확인용 AI 초안</h3>
        <span className="badge red">직원 발송 불가</span>
      </div>
      <p className="small muted">
        AI가 환자가 쓴 내용을 되짚는 한 문장(선택) 뒤에 병원이 승인한 안내(인계 절차의 고정 안내 문장)를 쓰고, 문의에 섞인 예약·가격 같은 물음은 병원
        문서 문장을 글자 그대로 인용해 답했습니다. 코드는 승인 문구가 통째로 없거나 앞뒤에 말을 붙인 초안, 되짚기 문장에 문의에 없는 말·부정 뒤집기·약·판단·지시·허락 말이
        있는 초안, 인용 원문을 바꿔 쓴 문장·문서 링크·가격 칸 밖 금액이 있는 초안을 보류합니다. 옮긴 문서 문장이 이 문의에 맞는 답인지와 되짚기가 문의의 뜻
        그대로인지는 코드가 다 보지 못하므로, 의료진이 문장마다 원문을 확인한 뒤에만 보낼 수 있습니다.
      </p>
      {draft.status !== "ok" && (
        <div className="note warn small" role="note">
          {heldNow
            ? `녹화 때는 통과했지만 지금 인계 초안 검사로는 보류됩니다(${[...new Set(draft.holdReasons.map((h) => HOLD_TEXT[h.code] ?? h.code))].join(", ")}) — 의료진이 직접 연락합니다. 사유는 아래 ④에 있습니다.`
            : "AI 초안이 검증에서 보류됐습니다 — 의료진이 직접 연락합니다. 사유는 아래 ④에 있습니다."}
        </div>
      )}
      <div className="two-col">
        <ExcerptPanel docs={recordedExcerpts(k, draft)} highlight={highlight} source="recorded" />
        <div className="sticky-col">
          <DraftPanel draft={draft} display={display} sourceLabel={sourceLabel} onCite={cite} onFill={() => {}} notReadyText="" />
          <VerifyPanel draft={draft} display={display} fillSources={[]} highlight={highlight} okLabel="확인 통과 — 의료진이 확인한 뒤에만 보낼 수 있음" />
        </div>
      </div>
      {draft.status === "ok" && display.text && <ApprovePanel target={id} initialText={display.text} replyMode={replyMode} clinicianOnly showLog={false} />}
    </section>
  );
}
