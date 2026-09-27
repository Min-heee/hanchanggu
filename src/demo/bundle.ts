/**
 * 화면용 데이터 번들(PRD F18). 빌드 전에 scripts/build-bundle.ts가 이 함수로 만든다.
 *
 * 무엇을 담나: 볼트 원문(md), 문의 40건, 골든셋 50문항, 녹화(있으면). 검색 색인·규칙 값은 담지 않는다.
 * 브라우저가 같은 원문으로 core의 loadVault·buildKnowledge를 다시 돌린다 — 색인(Map)을 JSON으로 옮기는
 * 두 번째 코드가 생기면 서버에서 잰 평가와 화면의 검색이 어긋날 수 있기 때문이다.
 *
 * 왜 빌드 때 한 번 더 읽나: 볼트가 깨졌거나(적신호 목록이 비는 등) 녹화 파일 모양이 틀렸으면
 * 화면이 빈칸으로 뜨기 전에 빌드를 멈춘다.
 */

import { z } from "zod";
import { buildKnowledge } from "../core/knowledge";
import { chunkDoc, loadVault } from "../core/vault";
import { parseDemoRecording, recordingDrift, type DemoRecording } from "./recording";

const InquirySchema = z.object({
  id: z.string(),
  channel: z.string(),
  externalId: z.string(),
  receivedAt: z.string().refine((s) => /[+-]\d{2}:\d{2}$|Z$/.test(s) && !Number.isNaN(Date.parse(s)), "시간대가 붙은 ISO 시각이어야 합니다"),
  author: z.object({ alias: z.string() }),
  text: z.string(),
  attachments: z.array(z.object({ kind: z.string(), note: z.string() })),
  meta: z.object({
    depositPaid: z.boolean().optional(),
    bookingConfirmed: z.boolean().optional(),
    bookingAt: z.string().optional(),
    postopDayMentioned: z.number().optional(),
  }),
  labels: z.object({
    type: z.string(),
    priority: z.number(),
    redflag: z.boolean(),
    route: z.string(),
    expectedDocs: z.array(z.string()),
    notes: z.string(),
  }),
});

const GoldenSchema = z.object({
  id: z.string(),
  kind: z.enum(["staff-qa", "inquiry"]),
  question: z.string().optional(),
  inquiryId: z.string().optional(),
  expectedDocs: z.array(z.string()),
  mustHold: z.boolean(),
  holdReason: z.string().nullable(),
  mustHandover: z.boolean(),
  noMedicalContent: z.boolean(),
  mustNotCite: z.array(z.string()),
  notes: z.string(),
});

/**
 * 문의 한 건. `labels`와 `meta.postopDayMentioned`는 사람이 적은 정답이라 **평가 탭만 읽는다**.
 * 목록·상세 화면이 정답을 보고 경로를 정하면 엔진을 시연하는 게 아니게 된다.
 */
export type BundleInquiry = z.infer<typeof InquirySchema>;
export type BundleGolden = z.infer<typeof GoldenSchema>;

export interface Bundle {
  version: 1;
  /** 볼트 시행일 필터 기준 날짜. */
  asOf: string;
  vaultFiles: { path: string; raw: string }[];
  inquiries: BundleInquiry[];
  golden: BundleGolden[];
  recording: DemoRecording | null;
  /** 녹화가 어디서 왔나. fake-fixture는 화면 시험용 가짜 녹화(모델 호출 없음)다. */
  recordingSource: "none" | "file" | "fake-fixture";
  /** 녹화와 지금 볼트가 어긋난 곳. 화면에 경고로 보인다. */
  recordingIssues: string[];
}

export interface BundleInput {
  asOf: string;
  vaultFiles: { path: string; raw: string }[];
  inquiriesJson: unknown;
  goldenJson: unknown;
  /** data/demo-responses.json을 읽은 값. 파일이 없으면 null. */
  recordingJson: unknown | null;
  recordingSource?: "file" | "fake-fixture";
}

export type BundleResult = { ok: true; bundle: Bundle } | { ok: false; errors: string[] };

export function buildBundle(input: BundleInput): BundleResult {
  const errors: string[] = [];
  const vault = loadVault(input.vaultFiles, { asOf: input.asOf });
  const kr = buildKnowledge(vault);
  if (!kr.ok) errors.push(...kr.errors.map((e) => `볼트: ${e}`));

  const inq = z.array(InquirySchema).safeParse(input.inquiriesJson);
  if (!inq.success) errors.push(...inq.error.issues.slice(0, 10).map((i) => `inquiries.json ${i.path.join(".")}: ${i.message}`));
  const gold = z.array(GoldenSchema).safeParse(input.goldenJson);
  if (!gold.success) errors.push(...gold.error.issues.slice(0, 10).map((i) => `golden.json ${i.path.join(".")}: ${i.message}`));

  if (kr.ok && inq.success) {
    const known = new Set(kr.knowledge.channels.map((c) => c.channel));
    const ids = new Set<string>();
    for (const q of inq.data) {
      // 모르는 창구는 route.ts가 보류로 보낸다. 데이터 오타라면 빌드에서 먼저 알린다.
      if (!known.has(q.channel)) errors.push(`${q.id}: 창구 지도(V19)에 없는 창구 ${q.channel}`);
      if (ids.has(q.id)) errors.push(`문의 ID가 겹칩니다: ${q.id}`);
      ids.add(q.id);
    }
  }
  if (inq.success && gold.success) {
    const ids = new Set(inq.data.map((q) => q.id));
    for (const g of gold.data) {
      if (g.kind === "inquiry" && (!g.inquiryId || !ids.has(g.inquiryId))) errors.push(`${g.id}: 없는 문의를 가리킵니다(${g.inquiryId ?? "-"})`);
      if (g.kind === "staff-qa" && !g.question) errors.push(`${g.id}: 직원 질문에 question이 없습니다`);
    }
  }

  let recording: DemoRecording | null = null;
  let recordingIssues: string[] = [];
  if (input.recordingJson !== null) {
    const r = parseDemoRecording(input.recordingJson);
    if (!r.ok) errors.push(...r.errors.map((e) => `demo-responses.json ${e}`));
    else {
      recording = r.value;
      if (kr.ok) {
        const text = new Map(kr.knowledge.vault.all.flatMap(chunkDoc).map((c) => [c.chunkId, c.text]));
        recordingIssues = recordingDrift(recording, text);
      }
    }
  }

  if (errors.length > 0 || !inq.success || !gold.success) return { ok: false, errors };
  return {
    ok: true,
    bundle: {
      version: 1,
      asOf: input.asOf,
      vaultFiles: input.vaultFiles,
      inquiries: inq.data,
      golden: gold.data,
      recording,
      recordingSource: recording ? (input.recordingSource ?? "file") : "none",
      recordingIssues,
    },
  };
}
