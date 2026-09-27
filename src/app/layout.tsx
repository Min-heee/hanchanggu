import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Chrome } from "./_components/Chrome";
import "./globals.css";

export const metadata: Metadata = {
  title: "한창구",
  description: "가상 의원 · 합성 데이터 · 미리 생성한 AI 응답. AI 초안, 사람이 검토 후 발송",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <Chrome />
        <main>{children}</main>
      </body>
    </html>
  );
}
