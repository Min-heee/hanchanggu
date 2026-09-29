/**
 * 미리 생성한 AI 응답(data/demo-responses.json)의 형식. **쓰는 쪽(scripts/record-demo.ts → src/demo/record.ts)과
 * 읽는 쪽(번들 생성 → 화면)이 이 파일 하나의 타입을 같이 쓴다.**
 *
 * 왜 타입만으로 끝내지 않고 zod로 한 번 더 읽나: 녹화 파일은 키가 있을 때 오너가 따로 만들어 커밋한다.
 * 코드가 바뀐 뒤 예전 파일이 남아 있으면 화면이 조용히 빈칸을 그린다. 번들을 만들 때 모양을 확인해
 * 틀리면 빌드를 멈춘다.
 *
 * 타입과 스키마가 서로 어긋나지 않게 세 겹으로 막는다.
 * 1. 스키마는 모두 strictObject다 — 쓰는 쪽이 필드를 더하고 스키마를 안 고치면, 녹화 파일을 읽을 때
 *    모르는 키로 번들 생성이 멈춘다(z.object였다면 조용히 버려서 화면이 undefined를 받는다).
 * 2. 아래 `_writerFits`: 쓰는 쪽 값이 스키마 입력으로 들어가는지(스키마가 타입보다 좁지 않은지) tsc가 본다.
 * 3. 아래 `_sameKeys*`: 타입과 스키마의 키 목록이 같은지 tsc가 본다(필드 추가·삭제 양쪽).
 * 그리고 recording.test.ts가 가짜 녹화를 JSON 왕복한 값과 parse 결과가 같은지(버려진 키가 없는지) 본다.
 */

import { z } from "zod";
import type { PinReason } from "../core/retrieve";
import type { RouteStep } from "../core/route";
import type { ClassifyResult } from "../llm/classify";
import type { DraftResult } from "../llm/draft";

/**
 * 녹화 때 검색 결과 한 줄. pin·postopBoost는 3회차 녹화부터 남는다(2회차 파일에는 없다 — 그때는 앞세우기 규칙이 경과일뿐이었다).
 * 없으면 화면은 '규칙으로 앞에 섬' 표시를 하지 않는다.
 */
export interface RecordedHit {
  chunkId: string;
  score: number;
  pin?: PinReason | null;
  postopBoost?: boolean;
}

/**
 * 녹화 때 검색의 부가 정보(3회차 녹화부터). 근거 강도(topScore·weak)는 넓히기 전 질의·찾는 말을 뺀 색인으로 재므로
 * 발췌 점수의 최댓값과 다를 수 있다 — 화면의 '근거 약함' 표시가 녹화 때 판정과 같게 따로 남긴다.
 */
export interface RetrievalMeta {
  expandedWith: string[];
  topScore: number;
  weak: boolean;
}

export interface InquiryRecord {
  id: string;
  route: { step: RouteStep; trace: string[]; holdReason: string | null; maskedText: string; ruleIds: string[] };
  /** 녹화 때 문의에서 읽은 경과일(검색 앞세우기에 쓴 값). */
  postopDay: number | null;
  classification: ClassifyResult | null;
  retrieval: RecordedHit[] | null;
  retrievalMeta?: RetrievalMeta | null;
  excludedMatches: { docId: string; reason: string }[] | null;
  draft: DraftResult | null;
}

export interface GoldenRecord {
  id: string;
  question: string;
  /** 모델에 보낸 질문(개인정보를 가린 것). 화면의 'AI가 받은 텍스트'는 이 값을 보인다. */
  maskedQuestion: string;
  retrieval: RecordedHit[];
  retrievalMeta?: RetrievalMeta | null;
  excludedMatches: { docId: string; reason: string }[];
  draft: DraftResult;
}

export interface DemoRecording {
  fictional: true;
  note: string;
  requestedModel: string;
  /** 실제로 답한 모델(서버 측 대체가 일어나면 요청한 모델과 다르다). */
  servedModels: string[];
  vaultAsOf: string;
  generatedAt: string;
  totalUsage: { input_tokens: number; output_tokens: number };
  inquiries: InquiryRecord[];
  golden: GoldenRecord[];
}

const Retrieval = z.array(
  z.strictObject({
    chunkId: z.string(),
    score: z.number(),
    pin: z.enum(["redflag", "handover", "medication", "day-base"]).nullable().optional(),
    postopBoost: z.boolean().optional(),
  }),
);
const RetrievalMetaSchema = z.strictObject({ expandedWith: z.array(z.string()), topScore: z.number(), weak: z.boolean() }).nullable().optional();
const Excluded = z.array(z.strictObject({ docId: z.string(), reason: z.string() }));

const Citation = z.strictObject({ docId: z.string(), chunkIds: z.array(z.string()), citedText: z.string() });

export const DraftSchema = z.strictObject({
  status: z.enum(["ok", "hold"]),
  holdReasons: z.array(z.strictObject({ code: z.string(), detail: z.string() })),
  modelText: z.string(),
  finalText: z.string().nullable(),
  sentences: z.array(
    z.strictObject({
      index: z.number(),
      text: z.string(),
      start: z.number(),
      end: z.number(),
      kind: z.enum(["cited", "allowlisted", "template", "uncited"]),
      citations: z.array(Citation),
      problems: z.array(z.string()),
    }),
  ),
  fills: z.array(z.strictObject({ placeholder: z.string(), value: z.string(), sourceDoc: z.enum(["V03", "V02"]), key: z.string().nullable() })),
  adcheck: z
    .object({
      level: z.enum(["banned", "warn", "clean"]),
      hits: z.array(
        z.strictObject({
          level: z.enum(["banned", "warn"]),
          term: z.string(),
          reason: z.string().nullable(),
          start: z.number(),
          end: z.number(),
          matchedText: z.string(),
        }),
      ),
    })
    .nullable(),
  documents: z.array(z.strictObject({ docId: z.string(), kind: z.enum(["content", "text"]), blocks: z.array(z.strictObject({ chunkId: z.string(), text: z.string() })) })),
  meta: z.strictObject({ model: z.string().nullable(), servedByFallback: z.boolean(), stopReason: z.string().nullable(), usage: z.unknown() }),
});

const ClassificationSchema = z.union([
  z.strictObject({
    status: z.literal("classified"),
    classification: z.strictObject({ category: z.string(), priority: z.string(), handover: z.boolean(), evidence: z.array(z.string()), reason: z.string() }),
    evidence: z.array(z.string()),
    droppedEvidence: z.array(z.string()),
    model: z.string(),
    servedByFallback: z.boolean(),
    usage: z.unknown(),
  }),
  z.strictObject({ status: z.literal("unclassified"), reason: z.string(), model: z.string().nullable() }),
]);

export const DemoRecordingSchema = z.strictObject({
  fictional: z.literal(true),
  note: z.string(),
  requestedModel: z.string(),
  servedModels: z.array(z.string()),
  vaultAsOf: z.string(),
  generatedAt: z.string(),
  totalUsage: z.strictObject({ input_tokens: z.number(), output_tokens: z.number() }),
  inquiries: z.array(
    z.strictObject({
      id: z.string(),
      route: z.strictObject({
        step: z.enum(["handover", "public-template", "shop-redirect", "classify", "draft", "hold"]),
        trace: z.array(z.string()),
        holdReason: z.string().nullable(),
        maskedText: z.string(),
        ruleIds: z.array(z.string()),
      }),
      postopDay: z.number().nullable(),
      classification: ClassificationSchema.nullable(),
      retrieval: Retrieval.nullable(),
      retrievalMeta: RetrievalMetaSchema,
      excludedMatches: Excluded.nullable(),
      draft: DraftSchema.nullable(),
    }),
  ),
  golden: z.array(
    z.strictObject({
      id: z.string(),
      question: z.string(),
      maskedQuestion: z.string(),
      retrieval: Retrieval,
      retrievalMeta: RetrievalMetaSchema,
      excludedMatches: Excluded,
      draft: DraftSchema,
    }),
  ),
});

// 컴파일 때 확인 ①: 쓰는 쪽 타입(DemoRecording)의 값은 모두 스키마 입력으로 들어갈 수 있어야 한다(스키마가 좁으면 멈춤).
export const _writerFits = (r: DemoRecording): z.input<typeof DemoRecordingSchema> => r;

// 컴파일 때 확인 ②: 키 목록이 양쪽으로 같아야 한다. 타입에 필드를 더하고 스키마를 안 고치면(또는 반대) 여기서 멈춘다.
type SameKeys<A, B> = [Exclude<keyof A, keyof B>, Exclude<keyof B, keyof A>] extends [never, never] ? true : false;
type Out = z.output<typeof DemoRecordingSchema>;
export const _sameKeysRecording: SameKeys<DemoRecording, Out> = true;
export const _sameKeysInquiry: SameKeys<InquiryRecord, Out["inquiries"][number]> = true;
export const _sameKeysRoute: SameKeys<InquiryRecord["route"], Out["inquiries"][number]["route"]> = true;
export const _sameKeysGolden: SameKeys<GoldenRecord, Out["golden"][number]> = true;
export const _sameKeysDraft: SameKeys<DraftResult, z.output<typeof DraftSchema>> = true;
export const _sameKeysSentence: SameKeys<DraftResult["sentences"][number], z.output<typeof DraftSchema>["sentences"][number]> = true;

export type RecordingParse = { ok: true; value: DemoRecording } | { ok: false; errors: string[] };

/** 녹화 파일을 읽는다. 모양이 틀리면 어느 경로가 틀렸는지 모아 돌려준다(빌드를 멈추는 데 쓴다). */
export function parseDemoRecording(json: unknown): RecordingParse {
  const r = DemoRecordingSchema.safeParse(json);
  if (!r.success) {
    return { ok: false, errors: r.error.issues.slice(0, 20).map((i) => `${i.path.join(".") || "(최상위)"}: ${i.message}`) };
  }
  // 스키마 통과 = 화면이 읽는 필드는 모두 있다. 나머지(usage 등)는 쓰는 쪽 타입을 그대로 믿는다.
  return { ok: true, value: r.data as unknown as DemoRecording };
}

// 녹화와 지금 코드·데이터의 어긋남 검사는 src/demo/drift.ts(검색·가림 코어가 필요해서 형식 파일과 뗐다).
