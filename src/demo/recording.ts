/**
 * 미리 생성한 AI 응답(data/demo-responses.json)의 형식. **쓰는 쪽(scripts/record-demo.ts → src/demo/record.ts)과
 * 읽는 쪽(번들 생성 → 화면)이 이 파일 하나의 타입을 같이 쓴다.**
 *
 * 왜 타입만으로 끝내지 않고 zod로 한 번 더 읽나: 녹화 파일은 키가 있을 때 오너가 따로 만들어 커밋한다.
 * 코드가 바뀐 뒤 예전 파일이 남아 있으면 화면이 조용히 빈칸을 그린다. 번들을 만들 때 모양을 확인해
 * 틀리면 빌드를 멈춘다.
 *
 * 스키마가 타입보다 좁아지지 않게(쓰는 쪽이 만든 값을 읽는 쪽이 거부하지 않게) 아래 `_writerFits`로
 * 컴파일 때 확인한다. 반대 방향(스키마가 받는데 타입엔 없는 값)은 화면이 읽지 않는 필드뿐이다.
 */

import { z } from "zod";
import type { RouteStep } from "../core/route";
import type { ClassifyResult } from "../llm/classify";
import type { DraftResult } from "../llm/draft";

export interface InquiryRecord {
  id: string;
  route: { step: RouteStep; trace: string[]; holdReason: string | null; maskedText: string; ruleIds: string[] };
  /** 녹화 때 문의에서 읽은 경과일(검색 앞세우기에 쓴 값). */
  postopDay: number | null;
  classification: ClassifyResult | null;
  retrieval: { chunkId: string; score: number }[] | null;
  excludedMatches: { docId: string; reason: string }[] | null;
  draft: DraftResult | null;
}

export interface GoldenRecord {
  id: string;
  question: string;
  retrieval: { chunkId: string; score: number }[];
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

const Retrieval = z.array(z.object({ chunkId: z.string(), score: z.number() }));
const Excluded = z.array(z.object({ docId: z.string(), reason: z.string() }));

const Citation = z.object({ docId: z.string(), chunkIds: z.array(z.string()), citedText: z.string() });

export const DraftSchema = z.object({
  status: z.enum(["ok", "hold"]),
  holdReasons: z.array(z.object({ code: z.string(), detail: z.string() })),
  modelText: z.string(),
  finalText: z.string().nullable(),
  sentences: z.array(
    z.object({
      index: z.number(),
      text: z.string(),
      start: z.number(),
      end: z.number(),
      kind: z.enum(["cited", "allowlisted", "template", "uncited"]),
      citations: z.array(Citation),
      problems: z.array(z.string()),
    }),
  ),
  fills: z.array(z.object({ placeholder: z.string(), value: z.string(), sourceDoc: z.enum(["V03", "V02"]), key: z.string().nullable() })),
  adcheck: z
    .object({
      level: z.enum(["banned", "warn", "clean"]),
      hits: z.array(
        z.object({
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
  documents: z.array(z.object({ docId: z.string(), kind: z.enum(["content", "text"]), blocks: z.array(z.object({ chunkId: z.string(), text: z.string() })) })),
  meta: z.object({ model: z.string().nullable(), servedByFallback: z.boolean(), stopReason: z.string().nullable(), usage: z.unknown() }),
});

const ClassificationSchema = z.union([
  z.object({
    status: z.literal("classified"),
    classification: z.object({ category: z.string(), priority: z.string(), handover: z.boolean(), evidence: z.array(z.string()), reason: z.string() }),
    evidence: z.array(z.string()),
    droppedEvidence: z.array(z.string()),
    model: z.string(),
    servedByFallback: z.boolean(),
    usage: z.unknown(),
  }),
  z.object({ status: z.literal("unclassified"), reason: z.string(), model: z.string().nullable() }),
]);

export const DemoRecordingSchema = z.object({
  fictional: z.literal(true),
  note: z.string(),
  requestedModel: z.string(),
  servedModels: z.array(z.string()),
  vaultAsOf: z.string(),
  generatedAt: z.string(),
  totalUsage: z.object({ input_tokens: z.number(), output_tokens: z.number() }),
  inquiries: z.array(
    z.object({
      id: z.string(),
      route: z.object({
        step: z.enum(["handover", "public-template", "shop-redirect", "classify", "draft", "hold"]),
        trace: z.array(z.string()),
        holdReason: z.string().nullable(),
        maskedText: z.string(),
        ruleIds: z.array(z.string()),
      }),
      postopDay: z.number().nullable(),
      classification: ClassificationSchema.nullable(),
      retrieval: Retrieval.nullable(),
      excludedMatches: Excluded.nullable(),
      draft: DraftSchema.nullable(),
    }),
  ),
  golden: z.array(z.object({ id: z.string(), question: z.string(), retrieval: Retrieval, excludedMatches: Excluded, draft: DraftSchema })),
});

// 컴파일 때 확인: 쓰는 쪽 타입(DemoRecording)의 값은 모두 스키마 입력으로 들어갈 수 있어야 한다.
// 타입을 바꾸고 스키마를 안 바꾸면 여기서 tsc가 멈춘다.
export const _writerFits = (r: DemoRecording): z.input<typeof DemoRecordingSchema> => r;

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

/**
 * 녹화와 지금 볼트가 어긋난 곳을 찾는다. 녹화 뒤에 볼트 문단을 고치면, 화면의 인용 번호를 눌렀을 때
 * 칠해지는 문단이 모델이 실제로 받은 문단과 달라진다. 빌드를 멈추지는 않고 화면에 경고로 보인다.
 */
export function recordingDrift(rec: DemoRecording, chunkText: ReadonlyMap<string, string>): string[] {
  const issues: string[] = [];
  const check = (owner: string, draft: DraftResult | null) => {
    if (!draft) return;
    for (const d of draft.documents) {
      for (const b of d.blocks) {
        const now = chunkText.get(b.chunkId);
        if (now === undefined) issues.push(`${owner}: 녹화에 쓴 문단 ${b.chunkId}가 지금 볼트에 없습니다`);
        else if (now !== b.text) issues.push(`${owner}: 문단 ${b.chunkId}가 녹화 뒤에 바뀌었습니다`);
      }
    }
  };
  for (const r of rec.inquiries) check(r.id, r.draft);
  for (const g of rec.golden) check(g.id, g.draft);
  return issues;
}
