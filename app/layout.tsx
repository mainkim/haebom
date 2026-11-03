import type { Metadata } from "next";
import { ResearcherBoundary } from "@/components/ResearcherGate";
import "./globals.css";

export const metadata: Metadata = {
  title: "해봄 | AI 노코드 연구 실행 플랫폼",
  description:
    "사회과학 연구자의 가설을 AI로 실제 온라인 실험으로 만들고, 설문과 행동 데이터를 하나로 연결하는 노코드 연구 플랫폼",
  icons: {
    icon: "/favicon.svg",
    apple: "/haebom-symbol.png"
  }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <ResearcherBoundary>{children}</ResearcherBoundary>
      </body>
    </html>
  );
}
