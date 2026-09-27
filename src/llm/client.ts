import Anthropic from "@anthropic-ai/sdk";

/**
 * 이 앱이 쓰는 SDK 표면만 뽑은 타입. 테스트는 이 모양의 모의 객체를 주입한다.
 * 베타 네임스페이스를 쓰는 이유: 서버 측 거절 대체(`fallbacks`)가 베타 파라미터다.
 */
export type ClaudeClient = {
  beta: { messages: Pick<Anthropic["beta"]["messages"], "create"> };
};

/**
 * 요청 자체가 틀렸을 때(400 형식·베타 헤더, 401 키, 403 권한, 404 모델 이름) 던진다.
 * 429·5xx·연결 오류와 달리 다시 해도 같은 결과라서, 조용히 "미분류"·"보류"로 뭉치면
 * 녹화 한 번이 전부 보류로 채워진 채 끝난다. 크게 실패해 사람이 설정을 고치게 한다.
 */
export class ClaudeConfigError extends Error {
  constructor(
    message: string,
    readonly status: number | undefined,
  ) {
    super(message);
    this.name = "ClaudeConfigError";
  }
}

/** 설정 오류면 ClaudeConfigError로 바꿔 던진다. 아니면 아무것도 하지 않는다. */
export function throwIfConfigError(e: unknown): void {
  if (
    e instanceof Anthropic.BadRequestError ||
    e instanceof Anthropic.AuthenticationError ||
    e instanceof Anthropic.PermissionDeniedError ||
    e instanceof Anthropic.NotFoundError
  ) {
    throw new ClaudeConfigError(`모델 호출 설정 오류(${String(e.status)}): 요청 형식, 베타 헤더, API 키, 모델 이름을 확인하세요 — ${e.message}`, e.status);
  }
}

/** 재시도해 볼 만한 오류(429, 연결, 그 밖의 5xx 등)를 화면에 보일 문구로 바꾼다. */
export function describeTransientError(e: unknown): string {
  if (e instanceof Anthropic.RateLimitError) return "호출 한도 초과(429)";
  // APIConnectionError는 APIError를 상속하므로 APIError보다 먼저 본다.
  if (e instanceof Anthropic.APIConnectionError) return "모델 서버에 연결하지 못했습니다";
  if (e instanceof Anthropic.APIError) return `모델 호출 오류(${String(e.status)})`;
  return `알 수 없는 오류: ${(e as Error).message}`;
}

/**
 * 응답에서 쓸 text 블록만 고른다. 서버 측 대체가 일어나면 `fallback` 블록이 경계를 표시하므로,
 * **마지막** 경계 뒤의 블록만 쓴다(대체가 두 번 일어나면 첫 경계 뒤에는 거절된 두 번째 모델의 조각이 남을 수 있다).
 */
export function finalTextBlocks(content: Anthropic.Beta.BetaContentBlock[]): Anthropic.Beta.BetaTextBlock[] {
  let from = 0;
  content.forEach((b, i) => {
    if (b.type === "fallback") from = i + 1;
  });
  return content.slice(from).filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text");
}

/**
 * 라이브 모드 여부. 서버 라우트는 이 값이 true일 때만 모델을 부른다.
 * 시연 모드(기본)는 미리 생성한 응답만 써서 방문자 비용이 0이다(PRD F15).
 */
export function isLiveMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.LIVE_MODE === "on" && Boolean(env.ANTHROPIC_API_KEY);
}

/**
 * 서버·스크립트에서만 부른다. 키는 SDK가 환경변수에서 읽는다(코드·로그에 키를 두지 않는다).
 * 키가 없으면 조용히 다른 자격 증명을 찾게 두지 않고 멈춘다 — 누구 돈으로 부르는지 분명해야 한다.
 */
export function createClaudeClient(env: NodeJS.ProcessEnv = process.env): ClaudeClient {
  if (!env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY가 없습니다");
  return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
}
