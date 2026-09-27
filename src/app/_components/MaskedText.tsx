/**
 * 개인정보 가림(F10). "모델이 실제로 받은 텍스트"를 펼쳐 볼 수 있게 한다.
 * 원문은 이 화면(브라우저)에만 있고 모델에는 가린 글만 간다.
 */

import type { MaskResult } from "@/core/mask";

const KIND: Record<string, string> = { rrn: "주민번호", phone: "전화", email: "이메일", birth: "생년월일", address: "주소", name: "이름" };

export function MaskedText({ original, mask }: { original: string; mask: MaskResult }) {
  return (
    <details>
      <summary>모델이 실제로 받은 텍스트 보기 {mask.items.length > 0 ? `(가린 곳 ${mask.items.length})` : "(가린 곳 없음)"}</summary>
      <pre className="masked">{mask.masked}</pre>
      {mask.items.length > 0 && <p className="small muted">가린 것: {[...new Set(mask.items.map((i) => KIND[i.kind] ?? i.kind))].join(", ")}</p>}
      {original !== mask.masked && <p className="small muted">원문은 이 화면에만 있고 모델에는 위 글만 보냅니다.</p>}
    </details>
  );
}
