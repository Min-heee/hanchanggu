import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * 코어(src/core)는 DOM도 네트워크도 시계도 쓰지 않는 순수 함수다.
 * LLM 계층(src/llm)도 SDK 클라이언트를 주입받으므로 모의 객체로 돈다.
 * 그래서 테스트 환경은 node 하나로 충분하다.
 * 화면 컴포넌트 중 훅 없이 값만 그리는 것(인계 카드, ① 검색 칸)은 renderToStaticMarkup으로 글자를 확인한다(*.test.tsx).
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
  // tsconfig의 jsx: "preserve"(Next용)를 시험에서는 React 자동 런타임으로 바꾼다.
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
