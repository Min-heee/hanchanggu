import type { NextConfig } from "next";

// 정적 내보내기(output: "export")를 쓰지 않는다.
// 라이브 모드는 서버 라우트에서만 API 키를 읽어야 하므로 서버 런타임이 필요하다(PRD F15).
const nextConfig: NextConfig = {};

export default nextConfig;
