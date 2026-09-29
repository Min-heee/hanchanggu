/**
 * 실제 볼트(vault/)와 합성 데이터(data/)의 회귀 시험.
 * 코어 테스트는 작은 픽스처로 돌고, 여기서는 사람이 검수할 진짜 데이터가 코어 규칙과 어긋나지 않는지 본다.
 * 기대값(과잉 인계 목록, 가림 결과 등)은 손으로 적었다. 데이터를 고치면 이 값도 사람이 다시 적는다.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkAdExpressions } from "../core/adcheck";
import { buildKnowledge, type Knowledge } from "../core/knowledge";
import { maskPii } from "../core/mask";
import { checkMedication } from "../core/medication";
import { checkRedflags } from "../core/redflag";
import { decideRoute } from "../core/route";
import { chunkDoc, loadVault, DISCLAIMER } from "../core/vault";
import { readVaultDir } from "../server/vault-files";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "../..");

interface Inquiry {
  id: string;
  channel: string;
  text: string;
  labels: { redflag: boolean; route: string; expectedDocs: string[] };
}
interface Golden {
  id: string;
  kind: "staff-qa" | "inquiry";
  expectedDocs: string[];
  expectedEvidence: { doc: string; quote: string }[];
  mustHold: boolean;
  holdReason: string | null;
  mustHandover: boolean;
  noMedicalContent: boolean;
  mustNotCite: string[];
  notes: string;
}

const vault = loadVault(readVaultDir(join(ROOT, "vault")));
const kr = buildKnowledge(vault);
const K = (): Knowledge => {
  if (!kr.ok) throw new Error(kr.errors.join("\n"));
  return kr.knowledge;
};
const inquiries: Inquiry[] = JSON.parse(readFileSync(join(ROOT, "data/inquiries.json"), "utf8"));
const golden: Golden[] = JSON.parse(readFileSync(join(ROOT, "data/golden.json"), "utf8"));

describe("볼트 형식", () => {
  it("22편 모두 읽히고 파이프라인 값이 만들어진다", () => {
    expect(vault.errors).toEqual([]);
    expect(vault.all.length).toBe(22);
    expect(kr.ok).toBe(true);
    expect(vault.excluded.map((e) => [e.id, e.reason])).toEqual([
      ["V04b", "superseded"],
      ["V20", "draft"],
    ]);
  });

  it("모든 [[링크]] 대상 파일이 있고, 모든 파일이 면책 문장으로 끝난다", () => {
    for (const d of vault.all) {
      for (const m of d.source.matchAll(/\[\[([^\]|#]+)/g)) expect([d.path, existsSync(join(ROOT, "vault", `${m[1]}.md`))]).toEqual([d.path, true]);
      expect([d.path, d.source.trimEnd().split("\n").at(-1)]).toEqual([d.path, DISCLAIMER]);
    }
  });

  it("문단은 2~4문장이다(문단 단위 검색·인용 규격)", () => {
    const bad: string[] = [];
    for (const d of vault.all) {
      for (const c of chunkDoc(d)) {
        // 인용문(> …)은 문서 머리의 안내라 뺀다.
        if (c.text.startsWith(">")) continue;
        const n = c.text.split(/(?<=[.?!])\s+/).filter((x) => x.trim() !== "").length;
        if (n < 2 || n > 4) bad.push(`${c.chunkId}(${n})`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("승인 문서 본문에 금지 광고 표현이 없다(광고 검사와 같은 공백 무시 대조, V15 자신 제외)", () => {
    const hits = K()
      .chunks.filter((c) => c.docId !== "V15")
      .flatMap((c) => checkAdExpressions(c.text, K().ad).hits.filter((h) => h.level === "banned").map((h) => `${c.chunkId}:${h.term}`));
    expect(hits).toEqual([]);
  });
});

describe("합성 문의 × 규칙", () => {
  it("모든 문의 창구가 창구 지도(V19)에 있다", () => {
    const known = new Set(K().channels.map((c) => c.channel));
    expect(inquiries.filter((q) => !known.has(q.channel)).map((q) => q.id)).toEqual([]);
    expect(new Set(inquiries.map((q) => q.channel)).size).toBeGreaterThanOrEqual(8);
  });

  it("적신호 양성 15건은 모두 규칙이 인계한다(누락 0), 과잉 인계는 Q24 한 건", () => {
    const positives = inquiries.filter((q) => q.labels.redflag);
    expect(positives.length).toBe(15);
    expect(positives.filter((q) => checkRedflags(q.text, K().redflag).decision !== "handover").map((q) => q.id)).toEqual([]);
    const over = inquiries.filter((q) => !q.labels.redflag && checkRedflags(q.text, K().redflag).decision === "handover").map((q) => q.id);
    expect(over).toEqual(["Q24"]);
  });

  it("약 문의 규칙(MED-01)은 Q25를 잡고, 인계 라벨이 아닌 문의는 잡지 않는다", () => {
    const hits = inquiries.filter((q) => checkMedication(q.text, K().medication).decision === "handover").map((q) => q.id);
    expect(hits).toEqual(["Q09", "Q25"]);
  });

  it("규칙 단계의 경로가 라벨과 맞는다(분류가 필요한 문의는 'classify'에서 멈춘다)", () => {
    const expected: Record<string, string> = { handover: "handover", "public-template": "public-template", draft: "classify", hold: "classify", "shop-redirect": "classify" };
    const exceptions: Record<string, string> = { Q24: "handover" }; // 과잉 인계(허용, 따로 센다)
    const got = inquiries.map((q) => [q.id, decideRoute({ channel: q.channel, text: q.text, channels: K().channels, redflag: K().redflag, medication: K().medication }).step]);
    expect(got).toEqual(inquiries.map((q) => [q.id, exceptions[q.id] ?? expected[q.labels.route]]));
  });

  it("개인정보가 많은 문의 3건의 가림 결과(손으로 적은 기대값)", () => {
    const m = (id: string) => maskPii(inquiries.find((q) => q.id === id)!.text).masked;
    expect(m("Q05")).toBe(
      "이름: [이름] / 연락처: [전화] / 주소: [주소] / 문의: 두피 주사 4회차가 9월 29일(화)인데 출장 때문에 10월 1일(목)로 옮기고 싶습니다. 문자로 답 주세요.",
    );
    expect(m("Q17")).toBe(
      "안녕하세요. [이름]이고 [생년월일]입니다. 연락처 [전화], 이메일 [이메일] 입니다. 10월 2일 금요일 오후 3시 첫 상담을 10월 7일 수요일 같은 시간으로 바꾸고 싶어요. 본인 확인 필요하시면 주민번호 [주민번호] 입니다.",
    );
    expect(m("Q38")).toBe(
      "보호자 [이름]입니다([전화]). 저희 아버지 [이름]님([전화], [생년월일]) 모발이식 상담 받으려는데 모당 가격이랑 상담비가 얼마인가요? 아버지 대신 제가 예약해도 되나요?",
    );
  });
});

describe("골든셋", () => {
  const byId = new Map(vault.all.map((d) => [d.meta.id, d]));
  const allowed = new Set(vault.active.map((d) => d.meta.id));

  it("50문항, 묶음 구성과 필드 규칙", () => {
    expect(golden.length).toBe(50);
    const tag = (g: Golden) => /^\[(\w[\w-]*)\]/.exec(g.notes)?.[1];
    const count = (t: string) => golden.filter((g) => tag(g) === t).length;
    expect([count("answerable"), count("no-source"), count("trap"), count("medical")]).toEqual([30, 8, 5, 7]);
    for (const g of golden) {
      // 인계 정답은 문의 문항에만 쓴다(직원 질문에는 인계할 환자·창구가 없다).
      if (g.mustHandover) expect([g.id, g.kind]).toEqual([g.id, "inquiry"]);
      expect([g.id, g.mustHold === (g.holdReason !== null)]).toEqual([g.id, true]);
      for (const d of g.mustNotCite) expect([g.id, d, allowed.has(d)]).toEqual([g.id, d, false]);
    }
  });

  it("notes의 근거 조각은 승인 문서 본문에 글자 그대로 있고, 그 문서는 expectedDocs에 있다(근거 없음 문항 제외)", () => {
    let n = 0;
    for (const g of golden) {
      for (const m of g.notes.matchAll(/(V\d{2}b?) '([^']+)'/g)) {
        n++;
        const doc = byId.get(m[1]);
        // 근거 없음 문항은 '문서에 있는 것은 여기까지'를 보이려고 조각을 인용할 수 있다(expectedDocs는 비어 있다).
        const inExpected = g.holdReason === "no-source" || g.expectedDocs.includes(m[1]);
        expect([g.id, m[1], allowed.has(m[1]), inExpected]).toEqual([g.id, m[1], true, true]);
        expect([g.id, doc!.source.includes(m[2])]).toEqual([g.id, true]);
      }
    }
    expect(n).toBeGreaterThan(40);
  });

  it("expectedEvidence(정답 문단 조각)는 notes의 근거 조각과 같고, 각각 정답 문서의 문단 하나에 글자 그대로 있다", () => {
    const chunks = vault.active.flatMap(chunkDoc);
    const ns = (t: string) => t.replace(/\s+/g, "");
    for (const g of golden) {
      // 근거 없음 문항은 정답 문단이 없다.
      if (g.expectedDocs.length === 0) {
        expect([g.id, g.expectedEvidence]).toEqual([g.id, []]);
        continue;
      }
      const fromNotes = [...new Map([...g.notes.matchAll(/(V\d{2}b?) '([^']+)'/g)].map((m) => [`${m[1]}|${m[2]}`, { doc: m[1], quote: m[2] }])).values()];
      expect([g.id, g.expectedEvidence]).toEqual([g.id, fromNotes]);
      for (const e of g.expectedEvidence) {
        expect([g.id, e.doc, g.expectedDocs.includes(e.doc)]).toEqual([g.id, e.doc, true]);
        const hit = chunks.filter((c) => c.docId === e.doc && ns(c.text).includes(ns(e.quote)));
        expect([g.id, e.quote, hit.length]).toEqual([g.id, e.quote, 1]);
      }
    }
  });

  it("근거 없음 문항의 핵심어는 승인 문서에 없다", () => {
    const text = vault.active.map((d) => d.source).join("\n");
    for (const w of ["보험", "실손", "휴가", "할부", "통역", "숙소", "연차", "와이파이", "정산"]) expect([w, text.includes(w)]).toEqual([w, false]);
  });
});
