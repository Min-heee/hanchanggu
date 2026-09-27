import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * 코어(src/core)는 DOM도 네트워크도 시계도 쓰지 않는 순수 함수다.
 * LLM 계층(src/llm)도 SDK 클라이언트를 주입받으므로 모의 객체로 돈다.
 * 그래서 테스트 환경은 node 하나로 충분하다.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
