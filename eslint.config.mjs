import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: ["node_modules/**", ".next/**", "out/**", "build/**", "next-env.d.ts"],
  },
  // 시연 화면과 그 계산은 기준 시각(src/demo/clock.ts DEMO_NOW_MS) 하나로만 잰다. 실제 시계를 읽으면
  // 방문하는 날마다 기다린 시간·시한 경보가 달라지고, 서버·브라우저 렌더가 어긋난다.
  {
    files: ["src/app/**/*.{ts,tsx}", "src/demo/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-properties": ["error", { object: "Date", property: "now", message: "시연 기준 시각 DEMO_NOW_MS(src/demo/clock.ts)를 쓰세요." }],
      "no-restricted-syntax": [
        "error",
        { selector: "NewExpression[callee.name='Date'][arguments.length=0]", message: "인자 없는 new Date()는 실제 시계를 읽습니다. DEMO_NOW_MS를 쓰세요." },
      ],
    },
  },
];

export default eslintConfig;
