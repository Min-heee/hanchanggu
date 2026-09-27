/**
 * 배지. 색만으로 상태를 구분하지 않도록 언제나 글자 라벨을 함께 쓴다.
 * 배지는 짧은 라벨에만 쓴다(줄바꿈이 안 된다). 문장형 안내는 .note 상자로.
 */

import type { ReplyMode } from "@/core/route";
import { KIND_LABEL, STATUS_LABEL, type InboxKind, type InboxStatus } from "@/demo/inbox";
import { channelLabel } from "../_lib/data";

const STATUS_COLOR: Record<InboxStatus, string> = {
  new: "blue",
  template: "blue",
  draft: "green",
  "handover-needed": "red",
  "handed-over": "gray",
  hold: "gray",
  sent: "gray",
};
const KIND_COLOR: Partial<Record<InboxKind, string>> = { redflag: "red", medication: "red", "llm-handover": "red", deposit: "orange" };

export const REPLY_MODE_LABEL: Record<ReplyMode, string> = {
  direct: "직접 답장",
  copy: "복사해서 보냄",
  callback: "전화로 답",
  "template-only": "고정 문구만",
};

export function ChannelBadge({ channel }: { channel: string }) {
  return <span className="badge">{channelLabel(channel)}</span>;
}

export function StatusBadge({ status }: { status: InboxStatus }) {
  return <span className={`badge ${STATUS_COLOR[status]}`}>상태: {STATUS_LABEL[status]}</span>;
}

export function KindBadge({ kind }: { kind: InboxKind }) {
  return <span className={`badge ${KIND_COLOR[kind] ?? "gray"}`}>{KIND_LABEL[kind]}</span>;
}
