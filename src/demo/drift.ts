/**
 * 미리 만든 AI 답(녹화)과 지금 코드·데이터가 어긋난 곳을 찾는다.
 *
 * 왜 필요한가: 화면의 ① 검색·가림 결과는 지금 코드로, ③ 초안은 녹화에서 온다. 녹화 뒤에 볼트 문단을 더하거나,
 * 검색·가림 규칙이나 문의 원문을 고치면 ①과 ③이 조용히 서로 다른 이야기를 한다(① 에는 답 문단이 있는데
 * ③은 '근거 없음'). 번들을 만들 때 문의·질문마다 녹화 때의 입력(가린 글, 경과일, 규칙 경로)과 검색 순위를
 * 지금 값과 대조하고, 어긋난 건을 화면에 '미리 만든 AI 답 뒤에 바뀜'으로 표시한다. 빌드를 멈추지는 않는다 —
 * 녹화는 키가 있을 때만 새로 만들 수 있어서, 멈추면 볼트 오타 하나 고치는 데도 키가 필요해진다.
 */

import type { Knowledge } from "../core/knowledge";
import { maskPii } from "../core/mask";
import { readPostopDay } from "../core/postop";
import { retrieve } from "../core/retrieve";
import { decideRoute } from "../core/route";
import type { DraftResult } from "../llm/draft";
import type { DemoRecording } from "./recording";

export interface DriftIssue {
  /** 문의 ID(Q01) 또는 골든셋 질문 ID(G16). */
  target: string;
  message: string;
}

function sameOrder(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

export function recordingDrift(
  rec: DemoRecording,
  k: Knowledge,
  inquiries: { id: string; channel: string; text: string }[],
  golden: { id: string; question?: string }[],
): DriftIssue[] {
  const issues: DriftIssue[] = [];
  const add = (target: string, message: string) => issues.push({ target, message });
  const chunkText = new Map(k.chunks.map((c) => [c.chunkId, c.text]));

  const checkDraft = (target: string, draft: DraftResult | null) => {
    if (!draft) return;
    for (const d of draft.documents) {
      if (!k.allowedDocIds.has(d.docId)) add(target, `초안이 쓴 문서 ${d.docId}는 지금 검색 대상(승인된 최신판)이 아닙니다`);
      for (const b of d.blocks) {
        const now = chunkText.get(b.chunkId);
        if (now === undefined) add(target, `초안이 쓴 문단 ${b.chunkId}가 지금 문서에 없습니다`);
        else if (now !== b.text) add(target, `초안이 쓴 문단 ${b.chunkId}가 그 뒤에 바뀌었습니다`);
      }
    }
  };

  for (const r of rec.inquiries) {
    const q = inquiries.find((x) => x.id === r.id);
    if (!q) {
      add(r.id, "이 문의가 지금 데이터에 없습니다");
      continue;
    }
    const masked = maskPii(q.text).masked;
    if (masked !== r.route.maskedText) add(r.id, "AI가 받은 글(문의 원문 또는 개인정보 가림 결과)이 지금과 다릅니다");
    const now = decideRoute({ channel: q.channel, text: q.text, channels: k.channels, redflag: k.redflag, medication: k.medication });
    // 분류를 불렀다 = 그때 안전 규칙은 통과시켰다. 안 불렀다 = 그때 규칙이 경로를 정했다.
    const ruleStepThen = r.classification === null ? r.route.step : "classify";
    if (now.step !== ruleStepThen) add(r.id, `안전 규칙 경로가 바뀌었습니다(그때 ${ruleStepThen} → 지금 ${now.step})`);
    const postop = readPostopDay(q.text)?.days ?? null;
    if (postop !== r.postopDay) add(r.id, `문의에서 읽은 경과일이 다릅니다(그때 ${r.postopDay ?? "없음"} → 지금 ${postop ?? "없음"})`);
    if (r.retrieval) {
      const live = retrieve(k.index, "reply", masked, postop).hits.map((h) => h.chunk.chunkId);
      if (!sameOrder(live, r.retrieval.map((h) => h.chunkId))) add(r.id, "문서 찾기(①) 결과가 그때와 다릅니다");
    }
    checkDraft(r.id, r.draft);
  }

  for (const g of rec.golden) {
    const now = golden.find((x) => x.id === g.id);
    if (!now?.question) {
      add(g.id, "이 질문이 지금 데이터에 없습니다");
      continue;
    }
    if (now.question !== g.question) add(g.id, "질문 문장이 그때와 다릅니다");
    const masked = maskPii(now.question).masked;
    if (masked !== g.maskedQuestion) add(g.id, "AI가 받은 글(개인정보 가림 결과)이 지금과 다릅니다");
    const live = retrieve(k.index, "staff-qa", masked).hits.map((h) => h.chunk.chunkId);
    if (!sameOrder(live, g.retrieval.map((h) => h.chunkId))) add(g.id, "문서 찾기(①) 결과가 그때와 다릅니다");
    checkDraft(g.id, g.draft);
  }
  return issues;
}
