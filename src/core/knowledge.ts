/**
 * 볼트 한 벌에서 파이프라인이 쓰는 모든 값을 한 번에 만든다.
 *
 * 규칙·가격·창구 지도가 하나라도 읽히지 않으면 부분적으로 돌지 않고 오류를 모아 돌려준다.
 * 예: 적신호 목록(V11)이 깨졌는데 나머지로 초안을 만들면, 게이트 없이 초안이 나가는 셈이다.
 */

import { parseAdConfig, type AdConfig } from "./adcheck";
import { parseToneConfig, type ToneConfig } from "./citations";
import { checkMedication, parseMedicationConfig, type MedicationConfig } from "./medication";
import { checkRedflags, parseRedflagConfig, type RedflagConfig } from "./redflag";
import { parseQuerySynonyms, stripSearchAlias, type QuerySynonym, type RetrievalIndex } from "./retrieve";
import { parseChannelMap, parsePublicTemplates, type ChannelEntry, type PublicTemplate } from "./route";
import { buildIndex } from "./search";
import { parseHours, parsePriceList, type Hours, type PriceItem } from "./template";
import { activeJson, chunkDoc, type Chunk, type LoadedVault } from "./vault";
import { approvedLinksOf, linkTitlesOf, type LinkTitles } from "./wikilink";

/** 기계가 읽는 json이 있어야 하는 문서. */
export const JSON_DOCS = { hours: "V02", prices: "V03", redflag: "V11", medication: "V17", tone: "V13", publicTemplates: "V14", ad: "V15", channels: "V19" } as const;

/**
 * 검색 순위 규칙(core/retrieve.ts)이 쓰는 문서.
 * - handover: 직원 질문에 적신호·약 말이 있을 때 함께 앞에 세울 인계 절차 문서.
 * - synonyms: 질의 넓히기(searchSynonyms) json을 둘 수 있는 문서. json이 없으면 넓히지 않는다 — 넓히기는 검색을 돕는 값이라
 *   없어도 안전 판정이 비지 않는다(적신호 목록과 다르다). 있는데 깨졌으면 다른 json 문서처럼 멈춘다.
 */
export const SEARCH_DOCS = { handover: "V12", synonyms: "V04" } as const;

/**
 * 인계 문의의 의료진 확인용 초안(2026-09-30 오너 결정, PRD v0.3)이 인용해도 되는 문서: 적신호 기준(V11)·인계 절차(V12)·
 * 약 원칙(V17)·수술 후 관리(V07). 병원이 승인한 안내 중 증상·약 문의에 닿는 것만 고른 값이다. 인용 대조가 이 밖의 인용을 막는다.
 * 모델에 보내는 문단은 이 문서들 안에서도 더 좁다(handoverExcerptChunkIds). 문의에 섞인 의료가 아닌 물음(예약·가격 등)의 답은
 * 아래 HANDOVER_GENERAL_DOCS에서 따로 온다(2026-09-30 오너 두 번째 결정).
 */
export const HANDOVER_DRAFT_DOCS = [JSON_DOCS.redflag, SEARCH_DOCS.handover, JSON_DOCS.medication, "V07"] as const;

/**
 * 인계 초안이 문의에 섞인 의료가 아닌 물음(진료시간·휴진·주차·가격·예약 변경·취소·쇼핑몰 반품)에 답할 때 인용해도 되는 문서
 * (2026-09-30 오너 두 번째 결정 '문의에 맞춰 조금 더 쓰게 푼다', PRD v0.3). 볼트를 읽고 의료 판단이 없는 행정 안내 문서만 골랐다:
 * 진료시간·오시는 길(V02), 가격표(V03), 예약 규정(V04), 쇼핑몰 문의 안내(V18).
 * 고르지 않은 것: 수술 후 날짜별 관리(V07 — 날짜별 관리 지시), 약 원칙(V17), 적신호 목록(V11), 수술 전 안내(V06 — 약·음주 지시),
 * 두피 주사·두피 관리(V08·V09 — 주사 후 불편·효과·수술 후 시작 시점), 첫 상담 안내(V05 — '감기 기운이 있어도 상담은 받을 수 있다'는
 * '병원에 와야 하는지'의 답이라 V11 '직원이 하지 않는 것'에 닿는다), 직원용 문서(V10·V13·V15·V19·V21).
 * 문단은 이 문서들 안에서도 더 좁다(handoverGeneralChunkIds). 가격은 지금처럼 가격표 문장을 인용한 가격 칸만 된다(core/pricecheck.ts).
 */
export const HANDOVER_GENERAL_DOCS = [JSON_DOCS.hours, JSON_DOCS.prices, "V04", "V18"] as const;

/**
 * 의료가 아닌 물음용 문서에서도 빼는 절의 소제목: 문서 변경 이력('이 판에서 바뀐 것'), 직원·AI 규칙('이 문서의 원칙'·'가격을 물으면'),
 * 효과 질문('제품 효과에 관한 질문'), 증상 안내('휴진일에 급한 증상이 있을 때'), 직원·공개 창구 절, 수술 후 일정·비용 절('수술 후 경과 진료와 주사 일정',
 * '수술 후 경과 진료' — 수술 후 관리·두피 주사 문서로 안내하는 문단이라, 증상 초안이 날짜별 관리 문서를 보라고 하게 된다. V11 "증상이 적힌 문의에는
 * [[postop-care]]로 답하지 않습니다", 2026-09-30 적대 검증 Q06).
 */
export const HANDOVER_GENERAL_EXCLUDED_HEADINGS = /이\s*판에서|원칙|가격을\s*물으면|효과|증상|직원|공개\s*창구|수술\s*후/;

/**
 * 응답·응대가 늦어진다는 문장(점심시간 "접수와 전화 응대를 하지 않습니다 … 순서대로 답합니다", 휴진 "다음 진료일 오전에 순서대로 확인합니다",
 * 쇼핑몰 "병원 창구에서 답하지 않고"). 승인 문구의 "바로 전달했습니다"·V12의 5분 인계와 부딪치고 증상이 있는 환자를 기다리게 할 수 있어,
 * 이런 문장이 든 문단은 인계 초안에 보내지 않는다(2026-09-30 적대 검증: Q22 발췌에 V02#1이 들어가 되짚기 + 승인 문구 + 점심시간 문단 초안이 통과).
 */
export const HANDOVER_DELAY_TEXT = /순서대로\s*(?:답|확인)|응대를?\s*하지\s*않|답하지\s*않/;

/**
 * 인계 절차 문서에서 제목이 '고정 안내'인 문단(환자에게 보내는 승인 문구). 화면의 인계 카드(src/demo/policy.ts readHandoverPolicy)와
 * 인계 초안의 발췌·검사가 이 함수 하나로 고른다 — 따로 고르면 카드의 승인 문구와 초안이 인용한 문단이 어긋날 수 있다.
 */
export function handoverFixedChunk(chunks: readonly Chunk[], docId: string = SEARCH_DOCS.handover): Chunk | null {
  return chunks.find((c) => c.docId === docId && c.heading !== null && /고정\s*안내/.test(c.heading)) ?? null;
}

/**
 * 고정 안내 문단의 따옴표 안 문장(승인 문구). 인계 카드가 직원에게 보여 주는 문구와, 인계 초안에 통째로 들어 있어야 하는 문장이
 * 이 함수 하나에서 나온다(src/llm/handover-check.ts checkHandoverDraft). 따옴표 밖의 "인계한 뒤 환자에게는 다음 문장만 보냅니다."는 직원에게 하는 말이다.
 */
export function handoverFixedMessage(chunk: Chunk | null): string | null {
  const quoted = chunk ? /["“]([^"”]+)["”]/.exec(chunk.text) : null;
  return quoted ? quoted[1].trim() : null;
}

/** 승인 문구를 감싼 것으로 보는 따옴표. */
const QUOTE_CHAR = /["“”'‘’「」『』]/;

/**
 * 글 속 승인 문구(고정 안내 문장)를 감싼 따옴표의 위치(글 안의 번호, 오름차순). 1차 인계 초안 녹화(2026-09-30)에서 20건 중 14건이
 * 승인 문구를 큰따옴표로 감싸 옮겼다 — 볼트 문단이 그 문장을 따옴표 안에 두기 때문이다. 환자에게 가는 글에 따옴표가 남지 않게 뺀다.
 * 승인 문구는 글자·숫자만 비교해 찾고(공백·문장부호 차이 허용), 찾은 자리 바로 앞(공백 허용)의 따옴표 하나와 바로 뒤(끝 문장부호·공백 허용)의
 * 따옴표 하나만 고른다. 승인 문구 밖의 따옴표와 승인 문구의 글자는 건드리지 않는다.
 */
export function fixedMessageQuoteIndices(text: string, message: string): number[] {
  const letters = [...message.normalize("NFC").replace(/[^\p{L}\p{N}]/gu, "")];
  if (letters.length === 0) return [];
  const re = new RegExp(letters.map((ch) => ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[^\\p{L}\\p{N}]*"), "gu");
  const out = new Set<number>();
  for (const m of text.matchAll(re)) {
    const at = m.index ?? 0;
    let i = at - 1;
    while (i >= 0 && /\s/.test(text[i])) i--;
    if (i >= 0 && QUOTE_CHAR.test(text[i])) out.add(i);
    let j = at + m[0].length;
    while (j < text.length && /[\s.!?。…]/.test(text[j])) j++;
    if (j < text.length && QUOTE_CHAR.test(text[j])) out.add(j);
  }
  return [...out].sort((a, b) => a - b);
}

/** 승인 문구를 감싼 따옴표를 뺀 글(fixedMessageQuoteIndices). 인계 초안의 보낼 글·화면 글에 쓴다 — 녹화 파일은 고치지 않는다. */
export function unquoteFixedMessage(text: string, message: string | null): string {
  if (!message) return text;
  let out = "";
  let prev = 0;
  for (const i of fixedMessageQuoteIndices(text, message)) {
    out += text.slice(prev, i);
    prev = i + 1;
  }
  return out + text.slice(prev);
}

/**
 * 적신호 기준 문서에서 즉시 조치 문장(급하면 119·응급실)이 든 문단 — 제목이 '문맥 없이도 인계하는 증상'인 문단. 인계 초안 발췌에서
 * 고정 안내 다음 자리에 세운다(core/retrieve.ts retrieveForHandover). 읽지 못하면 null(세우지 않는다).
 */
export function handoverUrgentChunk(chunks: readonly Chunk[], docId: string = JSON_DOCS.redflag): Chunk | null {
  return chunks.find((c) => c.docId === docId && c.heading !== null && /문맥\s*없이/.test(c.heading)) ?? null;
}

/** 수술 후 관리(V07)에서 인계 초안에 보내는 즉시 조치 문단의 제목. 날짜별 일반 관리 문단은 보내지 않는다. */
export const HANDOVER_CARE_HEADINGS = /수술\s*당일\s*밤|이상하면\s*연락/;

/**
 * 인계 초안에 보낼 수 있는 문단(2026-09-30 검증 반영). 인계 문서 묶음 안에서도 환자에게 할 말(승인 문구·즉시 조치)만 고른다 —
 * 볼트 V11 '직원이 하지 않는 것'이 "증상이 적힌 문의에는 [[postop-care]]로 답하지 않습니다"라고 적기 때문이다.
 * - 인계 절차(V12): 고정 안내 문단 하나. 누구에게·몇 분 안에·무엇을 기록하나는 직원이 할 일이다.
 * - 적신호 기준(V11): 즉시 조치 문단 하나(handoverUrgentChunk). 나머지는 목록을 고르는 기준·직원 방침이다.
 * - 수술 후 관리(V07): 즉시 조치 문단(HANDOVER_CARE_HEADINGS)만.
 * - 약 원칙(V17) 등 나머지: 소제목에 '직원'이 든 절(직원이 하는 일·직원이 답할 수 있는 것)과 '알아보는 말'(약 이름 목록)·'공개 창구' 절은 뺀다.
 * - 위 두 고정 문단(고정 안내·즉시 조치)을 빼고는 약 말(V17 terms)이 든 문단을 뺀다. 약 문의에 복용 안내("처방받은 약은 처방받은 대로
 *   복용합니다")가 붙지 않게 — 인용 뒤 검사(checkHandoverDraft)도 막지만, 막힐 문단을 보내지 않는 쪽이 초안이 덜 보류된다.
 * 지금 볼트에서는 V12 고정 안내 · V11 즉시 조치 · V07 '이상하면 연락'만 남는다(V07 '수술 당일 밤'과 V17 문단은 모두 약 말이 있다).
 */
export function handoverExcerptChunkIds(chunks: readonly Chunk[], docIds: readonly string[], medication: MedicationConfig): string[] {
  const fixed = handoverFixedChunk(chunks);
  const urgent = handoverUrgentChunk(chunks);
  const pinned = new Set([fixed?.chunkId, urgent?.chunkId].filter((x): x is string => typeof x === "string"));
  const allowedDocs = new Set(docIds);
  return chunks
    .filter((c) => {
      if (!allowedDocs.has(c.docId)) return false;
      if (pinned.has(c.chunkId)) return true;
      if (c.docId === SEARCH_DOCS.handover || c.docId === JSON_DOCS.redflag) return false;
      const heading = c.heading ?? "";
      if (c.docId === "V07" && !HANDOVER_CARE_HEADINGS.test(heading)) return false;
      if (/직원|알아보는\s*말|공개\s*창구/.test(heading)) return false;
      return checkMedication(c.text, medication).decision === "pass";
    })
    .map((c) => c.chunkId);
}

/**
 * 인계 초안이 의료가 아닌 물음에 답할 때 보낼 수 있는 문단(HANDOVER_GENERAL_DOCS 안). 어떤 문단을 실제로 보낼지는
 * core/retrieve.ts retrieveForHandover가 문의로 고른다(문의의 물음 절에 의료가 아닌 물음의 말이 있을 때만, BM25 점수가 근거 약함 기준 이상인 것 중 최대 2칸).
 * - 소제목이 HANDOVER_GENERAL_EXCLUDED_HEADINGS인 절은 뺀다.
 * - 응답이 늦어진다는 문장(HANDOVER_DELAY_TEXT)이 든 문단은 뺀다.
 * - 글에 '직원'이 있는 문단(직원 처리 순서 — V04 '예약금을 냈는데 확정 연락이 없을 때' 등)은 뺀다. 인계 초안 검사가 '직원' 문장을 막으므로 보내 봐야 보류만 는다.
 * - 약 말(V17)·증상 말(V11 symptoms·ambiguous)이 든 문단은 뺀다. 인계 초안 검사가 되짚기·승인 문구 밖 문장의 약·증상 말을 막는다.
 * 문단 끝에 다른 문서 링크가 든 문장이 있는 문단(가격표 두피 관리 "관리 내용은 [[scalp-care]]를 봅니다" 등)은 남긴다 — 금액 문장이 섞인 가격 물음의
 * 답이다. 링크 문장을 옮긴 초안은 인계 초안 검사가 보류한다(src/llm/handover-check.ts handover-link).
 */
export function handoverGeneralChunkIds(chunks: readonly Chunk[], docIds: readonly string[], medication: MedicationConfig, redflag: RedflagConfig): string[] {
  const allowedDocs = new Set(docIds);
  return chunks
    .filter((c) => {
      if (!allowedDocs.has(c.docId)) return false;
      if (HANDOVER_GENERAL_EXCLUDED_HEADINGS.test(c.heading ?? "") || HANDOVER_DELAY_TEXT.test(c.text) || c.text.includes("직원")) return false;
      const rf = checkRedflags(c.text, redflag);
      return rf.matchedSymptoms.length === 0 && rf.matchedAmbiguous.length === 0 && checkMedication(c.text, medication).decision === "pass";
    })
    .map((c) => c.chunkId);
}

export interface Knowledge {
  vault: LoadedVault;
  chunks: Chunk[];
  index: RetrievalIndex;
  allowedDocIds: ReadonlySet<string>;
  /**
   * 인계 초안이 인용해도 되는 문서(HANDOVER_DRAFT_DOCS·HANDOVER_GENERAL_DOCS 중 승인된 최신판). 인용 대조(verifyCitations)가 이 밖의 인용을 막는다.
   */
  handoverAllowedDocIds: ReadonlySet<string>;
  titles: ReadonlyMap<string, string>;
  /** 볼트 링크의 파일 이름 → 문서 제목(`[[booking-policy]]` → 예약 규정 제목). */
  linkTitles: LinkTitles;
  /** 환자 답장이 가리켜도 되는 문서(승인된 최신판)의 파일 이름. 이 밖을 가리키는 환자 글은 채우기에서 보류한다(core/template.ts). */
  approvedLinks: ReadonlySet<string>;
  hours: Hours;
  prices: PriceItem[];
  redflag: RedflagConfig;
  medication: MedicationConfig;
  tone: ToneConfig;
  ad: AdConfig;
  channels: ChannelEntry[];
  publicTemplates: PublicTemplate[];
}

export type KnowledgeResult = { ok: true; knowledge: Knowledge } | { ok: false; errors: string[] };

function read<T>(vault: LoadedVault, id: string, parse: (j: unknown) => { ok: true; value: T } | { ok: false; error: string }, errors: string[]): T | null {
  const j = activeJson(vault, id);
  if (!j.ok) {
    errors.push(j.error);
    return null;
  }
  const r = parse(j.value);
  if (!r.ok) {
    errors.push(r.error);
    return null;
  }
  return r.value;
}

function readSynonyms(vault: LoadedVault, errors: string[]): QuerySynonym[] {
  const doc = vault.active.find((d) => d.meta.id === SEARCH_DOCS.synonyms);
  if (!doc || !/^\s*```json/m.test(doc.source.slice(doc.bodyStart))) return [];
  const j = activeJson(vault, SEARCH_DOCS.synonyms);
  if (!j.ok) {
    errors.push(j.error);
    return [];
  }
  const r = parseQuerySynonyms(j.value, SEARCH_DOCS.synonyms);
  if (!r.ok) {
    errors.push(r.error);
    return [];
  }
  return r.synonyms;
}

export function buildKnowledge(vault: LoadedVault): KnowledgeResult {
  const errors = [...vault.errors];
  const hours = read(vault, JSON_DOCS.hours, parseHours, errors);
  const prices = read(vault, JSON_DOCS.prices, parsePriceList, errors);
  const redflag = read(vault, JSON_DOCS.redflag, (j) => {
    const r = parseRedflagConfig(j);
    return r.ok ? { ok: true, value: r.config } : r;
  }, errors);
  const medication = read(vault, JSON_DOCS.medication, (j) => {
    const r = parseMedicationConfig(j);
    return r.ok ? { ok: true, value: r.config } : r;
  }, errors);
  const tone = read(vault, JSON_DOCS.tone, (j) => {
    const r = parseToneConfig(j);
    return r.ok ? { ok: true, value: r.config } : r;
  }, errors);
  const ad = read(vault, JSON_DOCS.ad, (j) => {
    const r = parseAdConfig(j);
    return r.ok ? { ok: true, value: r.config } : r;
  }, errors);
  const channels = read(vault, JSON_DOCS.channels, (j) => {
    const r = parseChannelMap(j);
    return r.ok ? { ok: true, value: r.channels } : r;
  }, errors);

  const publicTemplates = read(vault, JSON_DOCS.publicTemplates, (j) => {
    const r = parsePublicTemplates(j);
    return r.ok ? { ok: true, value: r.templates } : r;
  }, errors);

  const synonyms = readSynonyms(vault, errors);

  if (errors.length > 0 || !hours || !prices || !redflag || !medication || !tone || !ad || !channels || !publicTemplates) return { ok: false, errors };

  const chunks = vault.active.flatMap(chunkDoc);
  const excluded = vault.excluded.map((e) => ({ doc: e, chunks: chunkDoc(vault.all.find((d) => d.meta.id === e.id)!) }));
  const activeIds = new Set(vault.active.map((d) => d.meta.id));
  const handoverDocIds = HANDOVER_DRAFT_DOCS.filter((id) => activeIds.has(id));
  const generalDocIds = HANDOVER_GENERAL_DOCS.filter((id) => activeIds.has(id));
  return {
    ok: true,
    knowledge: {
      vault,
      chunks,
      index: {
        ...buildIndex(chunks, excluded),
        rules: {
          strengthIndex: buildIndex(chunks.map((c) => ({ ...c, heading: stripSearchAlias(c.heading) }))),
          synonyms,
          staffPins: { redflag, medication, redflagDocId: JSON_DOCS.redflag, handoverDocId: SEARCH_DOCS.handover, medicationDocId: JSON_DOCS.medication },
          handoverDraft: {
            docIds: [...handoverDocIds, ...generalDocIds],
            chunkIds: handoverExcerptChunkIds(chunks, handoverDocIds, medication),
            generalChunkIds: handoverGeneralChunkIds(chunks, generalDocIds, medication, redflag),
            fixedChunkId: handoverFixedChunk(chunks)?.chunkId ?? null,
            fixedMessage: handoverFixedMessage(handoverFixedChunk(chunks)),
            urgentChunkId: handoverUrgentChunk(chunks)?.chunkId ?? null,
          },
        },
      },
      allowedDocIds: activeIds,
      handoverAllowedDocIds: new Set([...handoverDocIds, ...generalDocIds]),
      titles: new Map(vault.all.map((d) => [d.meta.id, d.meta.title])),
      linkTitles: linkTitlesOf(vault),
      approvedLinks: approvedLinksOf(vault),
      hours,
      prices,
      redflag,
      medication,
      tone,
      ad,
      channels,
      publicTemplates,
    },
  };
}

/** 검색 결과를 문서별로 묶는다(검색 순위상 처음 나온 문서 순, 문서 안에서는 문단 순). */
export function groupHitsByDoc(hits: { chunk: Chunk }[], titles: ReadonlyMap<string, string>) {
  const order: string[] = [];
  const byDoc = new Map<string, Chunk[]>();
  for (const { chunk } of hits) {
    if (!byDoc.has(chunk.docId)) {
      order.push(chunk.docId);
      byDoc.set(chunk.docId, []);
    }
    byDoc.get(chunk.docId)!.push(chunk);
  }
  return order.map((docId) => ({
    docId,
    title: titles.get(docId) ?? docId,
    chunks: byDoc
      .get(docId)!
      .sort((a, b) => a.index - b.index)
      .map((c) => ({ chunkId: c.chunkId, text: c.text })),
  }));
}
