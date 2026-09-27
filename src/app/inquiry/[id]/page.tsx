import raw from "@/generated/bundle.json";
import type { Bundle } from "@/demo/bundle";
import { InquiryDetail } from "../../_components/InquiryDetail";

// 문의 40건을 빌드 때 모두 미리 만든다(서버 없이 정적 페이지로 열린다).
export function generateStaticParams() {
  return (raw as unknown as Bundle).inquiries.map((q) => ({ id: q.id }));
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <InquiryDetail id={id} />;
}
