/**
 * 볼트 한 벌에서 파이프라인이 쓰는 모든 값을 한 번에 만든다.
 *
 * 규칙·가격·창구 지도가 하나라도 읽히지 않으면 부분적으로 돌지 않고 오류를 모아 돌려준다.
 * 예: 적신호 목록(V11)이 깨졌는데 나머지로 초안을 만들면, 게이트 없이 초안이 나가는 셈이다.
 */

import { parseAdConfig, type AdConfig } from "./adcheck";
import { parseToneConfig, type ToneConfig } from "./citations";
import { parseMedicationConfig, type MedicationConfig } from "./medication";
import { parseRedflagConfig, type RedflagConfig } from "./redflag";
import { parseChannelMap, parsePublicTemplates, type ChannelEntry, type PublicTemplate } from "./route";
import { buildIndex, type SearchIndex } from "./search";
import { parseHours, parsePriceList, type Hours, type PriceItem } from "./template";
import { activeJson, chunkDoc, type Chunk, type LoadedVault } from "./vault";

/** 기계가 읽는 json이 있어야 하는 문서. */
export const JSON_DOCS = { hours: "V02", prices: "V03", redflag: "V11", medication: "V17", tone: "V13", publicTemplates: "V14", ad: "V15", channels: "V19" } as const;

export interface Knowledge {
  vault: LoadedVault;
  chunks: Chunk[];
  index: SearchIndex;
  allowedDocIds: ReadonlySet<string>;
  titles: ReadonlyMap<string, string>;
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

  if (errors.length > 0 || !hours || !prices || !redflag || !medication || !tone || !ad || !channels || !publicTemplates) return { ok: false, errors };

  const chunks = vault.active.flatMap(chunkDoc);
  const excluded = vault.excluded.map((e) => ({ doc: e, chunks: chunkDoc(vault.all.find((d) => d.meta.id === e.id)!) }));
  return {
    ok: true,
    knowledge: {
      vault,
      chunks,
      index: buildIndex(chunks, excluded),
      allowedDocIds: new Set(vault.active.map((d) => d.meta.id)),
      titles: new Map(vault.all.map((d) => [d.meta.id, d.meta.title])),
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
