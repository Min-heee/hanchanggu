---
id: V19
title: 문의 창구와 답장 방식
type: reference
version: 1
status: approved
effective: 2026-07-01
owner: CS팀
fictional: true
---
## 창구별 답장 방식
창구마다 답장 방식이 다릅니다.

```json
[
  {"channel": "kakao", "label": "카카오 채널", "replyMode": "copy", "note": "상담 도구에 붙여넣기"},
  {"channel": "web_form", "replyMode": "callback", "note": "전화로 답함"},
  {"channel": "review", "label": "플레이스 리뷰", "replyMode": "template-only", "note": "공개 답글"},
  {"channel": "shop_qna", "label": "쇼핑몰 문의 게시판", "replyMode": "template-only", "note": "별도 사업자"}
]
```

가상 의원의 예시 문서이며 실제 의료 지침이 아닙니다.
