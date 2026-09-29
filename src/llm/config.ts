/**
 * 모델 호출 설정. 값의 근거는 Anthropic API 문서(2026-09 기준)다.
 *
 * - 모델: claude-sonnet-5-5. claude-opus-5로 시작했지만 녹화 비용 추정(전체 1회 $10~15)을 보고 저장소 주인이
 *   단가가 2.5배 낮은 Sonnet 5.5로 바꿨다(2026-09-29, PRD 6절).
 *   녹화로 잰 실제 비용은 전체 1회 $0.55(1회차)·$0.56(2회차)·$0.70(3회차)다(README '녹화로 잰 것').
 * - 사고: 적응형(`thinking: { type: "adaptive" }`). 모델 기본값에 기대지 않고 의도를 코드에 남긴다.
 * - 거절 대체: 서버 측 `fallbacks: "default"` + 베타 헤더 `server-side-fallback-2026-07-01`.
 *   배열형(`[{ model }]`)은 헤더가 `-2026-06-01`로 다르고, 섞으면 400이다.
 */
export const MODEL = "claude-sonnet-5-5";
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";
export const FALLBACKS = "default" as const;

/**
 * max_tokens는 사고 + 답 전체의 상한이다(적응형 사고를 켜므로 사고 몫이 포함된다).
 * 분류는 짧은 JSON이지만 사고 몫을 남기고, 초안은 비스트리밍 권장 상한(~16000)을 쓴다.
 */
export const CLASSIFY_MAX_TOKENS = 4000;
export const DRAFT_MAX_TOKENS = 16000;

/** 분류는 짧고 반복적인 일이라 medium으로 둔다. 초안은 기본값(high)을 쓴다. 조정은 측정 뒤에. */
export const CLASSIFY_EFFORT = "medium" as const;
