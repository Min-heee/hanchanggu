/**
 * 모델 호출 설정. 값의 근거는 claude-api 스킬 문서(2026-09 기준)다.
 *
 * - 모델: claude-opus-5. 더 싼 모델로 바꿀지는 비용을 재 본 뒤 오너가 정한다(PRD 5절).
 * - 사고: 적응형(`thinking: { type: "adaptive" }`). Opus 5는 생략해도 적응형이지만 의도를 코드에 남긴다.
 * - 거절 대체: 서버 측 `fallbacks: "default"` + 베타 헤더 `server-side-fallback-2026-07-01`.
 *   배열형(`[{ model }]`)은 헤더가 `-2026-06-01`로 다르고, 섞으면 400이다.
 */
export const MODEL = "claude-opus-5";
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";
export const FALLBACKS = "default" as const;

/**
 * max_tokens는 사고 + 답 전체의 상한이다(Opus 5는 사고가 기본으로 켜진다).
 * 분류는 짧은 JSON이지만 사고 몫을 남기고, 초안은 비스트리밍 권장 상한(~16000)을 쓴다.
 */
export const CLASSIFY_MAX_TOKENS = 4000;
export const DRAFT_MAX_TOKENS = 16000;

/** 분류는 짧고 반복적인 일이라 medium으로 둔다. 초안은 기본값(high)을 쓴다. 조정은 측정 뒤에. */
export const CLASSIFY_EFFORT = "medium" as const;
