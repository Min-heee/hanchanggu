/**
 * 골든셋 검색 적중률@5 (PRD 7절 "검색 적중률 90% 이상"). 모델을 부르지 않으므로 키 없이 돈다.
 *
 *   npm run eval:retrieval
 *
 * - 질의: 직원 질문은 그대로, 문의 문항은 가림(maskPii) → queryFromInquiry(날짜·폼 칸 이름 제거) 뒤의 텍스트.
 *   record-demo.ts가 초안을 만들 때 쓰는 질의와 같다.
 * - 정답: expectedDocs 중 하나라도 상위 5개 안에 들면 적중. 문단 기준(상위 5개 문단)과 문서 기준(상위 5개 문서)을 함께 적는다.
 * - 인계가 정답인 문항(mustHandover)은 초안을 만들지 않으므로 검색을 하지 않는다. 그래서 따로 적는다.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildKnowledge } from "../src/core/knowledge";
import { maskPii } from "../src/core/mask";
import { queryFromInquiry, search } from "../src/core/search";
import { loadVault } from "../src/core/vault";
import { readVaultDir } from "../src/server/vault-files";

const ROOT = process.cwd();
const K_TOP = 5;

interface Golden {
  id: string;
  kind: "staff-qa" | "inquiry";
  question?: string;
  inquiryId?: string;
  expectedDocs: string[];
  mustHandover: boolean;
}

const kr = buildKnowledge(loadVault(readVaultDir(join(ROOT, "vault"))));
if (!kr.ok) throw new Error(kr.errors.join("\n"));
const k = kr.knowledge;
const inquiries = new Map<string, { text: string }>(
  (JSON.parse(readFileSync(join(ROOT, "data/inquiries.json"), "utf8")) as { id: string; text: string }[]).map((q) => [q.id, q]),
);
const golden = (JSON.parse(readFileSync(join(ROOT, "data/golden.json"), "utf8")) as Golden[]).filter((g) => g.expectedDocs.length > 0);

const rows = golden.map((g) => {
  const query = g.kind === "staff-qa" ? g.question! : queryFromInquiry(maskPii(inquiries.get(g.inquiryId!)!.text).masked);
  const hits = search(k.index, query, 1000).hits;
  const docs: string[] = [];
  for (const h of hits) if (!docs.includes(h.chunk.docId)) docs.push(h.chunk.docId);
  return {
    id: g.id,
    handover: g.mustHandover,
    chunk: hits.slice(0, K_TOP).some((h) => g.expectedDocs.includes(h.chunk.docId)),
    doc: docs.slice(0, K_TOP).some((d) => g.expectedDocs.includes(d)),
    docRank: docs.findIndex((d) => g.expectedDocs.includes(d)) + 1,
  };
});

function report(name: string, xs: typeof rows) {
  const pct = (n: number) => `${n}/${xs.length} = ${((100 * n) / xs.length).toFixed(1)}%`;
  const miss = (key: "chunk" | "doc") => xs.filter((x) => !x[key]).map((x) => `${x.id}(문서 ${x.docRank || "-"}위)`).join(", ") || "없음";
  console.log(`${name}\n  문단@${K_TOP} ${pct(xs.filter((x) => x.chunk).length)}  놓침: ${miss("chunk")}\n  문서@${K_TOP} ${pct(xs.filter((x) => x.doc).length)}  놓침: ${miss("doc")}`);
}

report(`정답 문서가 있는 문항 전체(${rows.length})`, rows);
report(`인계 문항 제외 — 초안 경로에서 실제로 검색하는 문항(${rows.filter((r) => !r.handover).length})`, rows.filter((r) => !r.handover));
