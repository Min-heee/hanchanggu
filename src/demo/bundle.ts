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
import { loadVault } from "../core/vault";
import { recordingDrift, type DriftIssue } from "./drift";
import { parseDemoRecording, type DemoRecording } from "./recording";

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
 *
 * 라벨의 `notes`(왜 이 라벨인지, 데이터를 어떻게 만들었는지)는 번들에 넣지 않는다. 화면·평가 어디에서도
 * 읽지 않는데, 번들은 방문자 브라우저로 그대로 내려가는 공개 JS다. 필요 없는 설명을 공개물에 싣지 않는다.
 */
type ParsedInquiry = z.infer<typeof InquirySchema>;
export type BundleInquiry = Omit<ParsedInquiry, "labels"> & { labels: Omit<ParsedInquiry["labels"], "notes"> };
export type BundleGolden = Omit<z.infer<typeof GoldenSchema>, "notes">;

function stripInquiryNotes(q: ParsedInquiry): BundleInquiry {
  const { notes: _notes, ...labels } = q.labels;
  void _notes;
  return { ...q, labels };
}

function stripGoldenNotes(g: z.infer<typeof GoldenSchema>): BundleGolden {
  const { notes: _notes, ...rest } = g;
  void _notes;
  return rest;
}

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
  /** 녹화와 지금 코드·데이터가 어긋난 곳(문의·질문별). 목록·상세에 '미리 만든 AI 답 뒤에 바뀜'으로 보인다. */
  recordingIssues: DriftIssue[];
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
  let recordingIssues: DriftIssue[] = [];
  if (input.recordingJson !== null) {
    const r = parseDemoRecording(input.recordingJson);
    if (!r.ok) errors.push(...r.errors.map((e) => `demo-responses.json ${e}`));
    else {
      recording = r.value;
      // 녹화와 화면이 같은 볼트 판을 봐야 한다. 시행일 기준이 다르면 녹화 때 모델이 받은 문서 묶음부터 다를 수 있다.
      if (recording.vaultAsOf !== input.asOf) {
        errors.push(`demo-responses.json: 녹화의 볼트 기준일(${recording.vaultAsOf})이 시연 기준일(${input.asOf})과 다릅니다. 기준일을 맞춰 다시 녹화하세요`);
      }
      if (kr.ok && inq.success && gold.success) recordingIssues = recordingDrift(recording, kr.knowledge, inq.data, gold.data);
    }
  }

  if (errors.length > 0 || !inq.success || !gold.success) return { ok: false, errors };
  return {
    ok: true,
    bundle: {
      version: 1,
      asOf: input.asOf,
      vaultFiles: input.vaultFiles,
      inquiries: inq.data.map(stripInquiryNotes),
      golden: gold.data.map(stripGoldenNotes),
      recording,
      recordingSource: recording ? (input.recordingSource ?? "file") : "none",
      recordingIssues,
    },
  };
}

/**
 * 배포 빌드에서 녹화를 확인한다(scripts/build-bundle.ts가 부른다). 순수 함수로 둔 이유: 환경변수 조합을 시험으로 고정하려고.
 *
 * - 가짜 녹화는 화면 시험용이다. 배포(Vercel·CI)나 `npm run build`(prebuild가 `--for-build`를 넘긴다)에서 요청되면 멈춘다 —
 *   가짜 녹화가 공개 링크에 'AI 응답'처럼 실리는 것을 막는다.
 * - 진짜 녹화 파일이 없으면 공개 배포(VERCEL_ENV=production)와 CI에서 멈춘다. 이 상태로 링크가 나가면
 *   30초 시연의 초안·인용 장면이 모두 비어 있다. 미리 보기 배포(preview)와 로컬 빌드는 막지 않는다.
 */
export function recordingGuard(env: {
  fakeRequested: boolean;
  hasRecordingFile: boolean;
  /** `npm run build` 앞의 번들인지. npm_lifecycle_event는 중첩 실행에서 'bundle'로 바뀌어 믿을 수 없어 인자로 받는다. */
  forBuild: boolean;
  vercel: string | undefined;
  vercelEnv: string | undefined;
  ci: string | undefined;
}): { ok: true } | { ok: false; error: string } {
  const deploying = Boolean(env.vercel) || Boolean(env.ci);
  if (env.fakeRequested && (deploying || env.forBuild)) {
    return { ok: false, error: "시험용 가짜 녹화는 배포·빌드(prebuild)에 넣을 수 없습니다. DEMO_FAKE_RECORDING을 지우세요(화면 시험은 DEMO_FAKE_RECORDING=1 npm run dev)." };
  }
  if (!env.fakeRequested && !env.hasRecordingFile && (env.vercelEnv === "production" || Boolean(env.ci))) {
    return { ok: false, error: "data/demo-responses.json(미리 만든 AI 답)이 없습니다. 공개 배포 전에 npm run record-demo로 만들어 커밋하세요." };
  }
  return { ok: true };
}
