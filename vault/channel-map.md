---
id: V19
title: 문의 창구와 답장 방식
type: reference
version: 2
status: approved
effective: 2026-07-01
owner: CS팀
fictional: true
---

# 문의 창구와 답장 방식

## 이 문서의 목적

샘플의원에는 문의가 들어오는 창구가 여러 개이고, 창구마다 답장할 수 있는 방식이 다릅니다. 이 문서는 창구별로 누가 어떤 방식으로 답하는지 정합니다. 통합 목록의 보내기 버튼은 이 표의 답장 방식을 따릅니다.

## 답장 방식 네 가지

'직접'은 통합 도구에서 승인한 답장을 그 창구로 바로 보내는 방식입니다. '복사'는 승인한 답장을 복사해 직원이 그 창구의 앱에서 붙여 넣어 보내는 방식입니다. '전화'는 답장을 글로 보낼 수 없어 직원이 전화로 연락하는 방식이고, '고정 문구만'은 [[public-reply-templates]]의 문구만 쓸 수 있는 방식입니다.

## 메신저

네이버 톡톡과 인스타그램 DM은 직접 답장합니다. 인스타그램 DM은 받은 지 오래된 문의에는 답장이 제한될 수 있으니 먼저 확인합니다. 카카오 채널은 통합 도구와 연결되어 있지 않아 복사해서 카카오 채널 관리자 화면에서 보냅니다.

## 폼과 예약 요청사항

홈페이지 상담 폼, 모발이식 상담 신청 폼, 네이버 예약 요청사항에는 글로 답장할 수 없습니다. 적힌 연락처로 전화하거나, 환자가 원하면 문자로 확정 연락을 보냅니다. 예약금 입금과 확정 여부는 [[booking-policy]]를 따릅니다.

## 전화와 문자

대표전화의 부재중 기록과 음성 메시지는 직원이 메모로 옮긴 뒤 전화로 다시 연락합니다. 업무용 휴대폰으로 온 문자는 승인한 답장을 복사해 업무용 휴대폰에서 보냅니다.

## 리뷰와 유튜브 댓글

리뷰와 유튜브 댓글은 공개 창구이므로 고정 문구만 씁니다. 질문이 있어도 공개 답글로 답하지 않고 비공개 창구로 안내합니다. 증상이 적혀 있으면 [[handover-procedure]]를 따릅니다.

## 쇼핑몰

쇼핑몰 게시판은 별도 사업자가 운영하므로 병원이 답하지 않고, 통합 목록에 모으지도 않습니다. 병원과 쇼핑몰은 고객 정보를 함께 쓰지 않기 때문입니다. 병원 창구로 쇼핑몰 문의가 오면 [[shop-inquiries]]에 따라 쇼핑몰 고객센터를 안내합니다.

## 기계가 읽는 값

```json
[
  { "channel": "kakao", "label": "카카오 채널", "replyMode": "copy", "note": "통합 도구와 미연결, 관리자 화면에서 붙여 넣어 보냄" },
  { "channel": "naver_talktalk", "label": "네이버 톡톡", "replyMode": "direct", "note": "승인 후 바로 보냄" },
  { "channel": "instagram_dm", "label": "인스타그램 DM", "replyMode": "direct", "note": "오래된 문의는 답장이 제한될 수 있음" },
  { "channel": "web_form", "label": "홈페이지 상담 폼", "replyMode": "callback", "note": "적힌 연락처로 전화, 원하면 문자" },
  { "channel": "landing_form", "label": "모발이식 상담 신청 폼", "replyMode": "callback", "note": "적힌 연락처로 전화, 원하면 문자" },
  { "channel": "booking_note", "label": "네이버 예약 요청사항", "replyMode": "callback", "note": "예약 요청사항에는 답장 불가, 전화나 문자로 확정 연락" },
  { "channel": "phone_memo", "label": "전화(부재중·음성 메시지 메모)", "replyMode": "callback", "note": "직원이 다시 전화" },
  { "channel": "sms", "label": "업무용 휴대폰 문자", "replyMode": "copy", "note": "업무용 휴대폰에서 붙여 넣어 보냄" },
  { "channel": "review", "label": "플레이스 리뷰", "replyMode": "template-only", "note": "고정 문구만, 치료 내용 언급 금지" },
  { "channel": "youtube_comment", "label": "유튜브 댓글", "replyMode": "template-only", "note": "고정 문구만, 비공개 창구 안내" }
]
```

가상 의원의 예시 문서이며 실제 의료 지침이 아닙니다.
