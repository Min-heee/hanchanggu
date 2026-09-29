# 한창구

여러 창구로 들어온 환자 문의를 직원 화면 하나에 모으고, 병원 안내문에 적힌 내용으로만 답장 초안을 만드는 도구입니다.

> 가상 의원 '샘플의원'과 지어낸 문의 41건으로 만든 견본입니다. 실제 병원 문서나 환자 정보는 없습니다.

**시연:** https://hanchanggu.vercel.app (설치·로그인 없음. AI를 실시간으로 부르지 않고 미리 녹화한 답을 보여 줍니다)

| ① 통합 목록 | ② 답장 초안과 근거 | ③ 의료진 인계 카드 |
|---|---|---|
| [<img src="docs/screens/1-list.png" width="260" alt="통합 목록 화면">](docs/screens/1-list.png) | [<img src="docs/screens/2-draft.png" width="260" alt="가격 문의의 답장 초안과 근거 화면">](docs/screens/2-draft.png) | [<img src="docs/screens/3-handover.png" width="260" alt="의료진 인계 카드 화면">](docs/screens/3-handover.png) |
| 창구와 상관없이 급한 순서로 | 문장마다 근거 번호, 금액은 가격표 값 | "수술 9일째 고름" 문의. 초안 없이 카드만 |

## 기능

- 10개 창구(카카오, 네이버 톡톡, 홈페이지 폼, 전화 메모, 리뷰 등)의 문의를 급한 순서로 한 목록에 모읍니다.
- 병원 안내문 문단을 인용해 답장 초안을 만들고, 금액은 AI가 아니라 가격표에서 넣습니다.
- 증상·약 문의는 초안 대신 의료진 인계 카드(걸린 규칙, 담당, 응답 시한)를 띄웁니다.
- 직원 내부 질문에도 같은 안내문으로 답합니다(사내 Q&A).
- 공개 리뷰·댓글에는 정해진 문구만 제안합니다.

## 믿을 수 있게 만든 장치

- 증상·약 규칙이 AI보다 먼저 돌고, 규칙 목록이 비거나 깨지면 모든 문의를 의료진에게 넘깁니다.
- 인용이 안내문 원문과 다르거나 숫자·기간이 원문에 없으면 코드가 초안을 보류합니다.
- 자동 발송이 없습니다. 직원이 승인해야 보내기 버튼이 켜집니다.

## 숫자

지어낸 데이터로 잰 값입니다(AI 답은 4회차 녹화 기준).

| 무엇을 셌나 | 결과 |
|---|---|
| 답이 안내문에 있는데 AI가 멈춘 질문 | 0 / 39 |
| 답이 안내문에 없어서 지어내지 않고 멈춘 질문 | 8 / 8 |
| 인용이 안내문 원문과 다른 초안 | 0 / 46 |
| 의료진에게 넘겨야 하는데 놓친 증상 문의 | 0 / 15 (자기 시험) |

같은 질문을 보고 지시문과 검색을 고친 뒤 잰 값이라 편향이 있습니다. 세부: [docs/EVALUATION.md](docs/EVALUATION.md)

## 실행 방법

```bash
npm install
npm run dev      # http://localhost:3000
npm run verify   # test + typecheck + lint + build
```

Node `^20.19 || ^22.13 || >=24`. API 키 없이 돌아갑니다([AI 답 녹화 방법](docs/DETAILS.md#실행-방법-세부)).

## 한계

- 실제 병원에서 써 본 적이 없고, 카카오 등 실제 창구 연결과 로그인이 없습니다.
- "해도 됩니다"와 "하면 안 됩니다"처럼 뜻이 뒤집힌 문장은 코드가 못 잡습니다. 사람이 읽고 보내야 합니다.
- 평가 질문·정답 문단·테스트 기대값·초안 품질 판정은 AI가 쓴 초안이고, 사람이 아직 검수하지 않았습니다.

## 자세히

- [docs/EVALUATION.md](docs/EVALUATION.md) — 평가 세부, 회차별 추이, 문장 단위 검토, 비용
- [docs/DETAILS.md](docs/DETAILS.md) — 사용 흐름, 처리 경로, 한계 세부, AI와 사람이 나눈 일 등
- [docs/PRD.md](docs/PRD.md) — 요구사항과 설계 결정
- [data/README.md](data/README.md) — 합성 데이터 규칙과 검수할 곳
- 같은 가상 의원용 도구: [다시봄](https://github.com/Min-heee/dasibom)(수술 뒤 연락), [같은각도](https://github.com/Min-heee/same-angle)(경과 사진)

## 기술 스택

Next.js 15 · TypeScript · Claude API(`claude-sonnet-5-5`, 문서 인용) · 한국어 2-gram BM25 검색 · vitest · Vercel

조사·문서·데이터·코드 초안은 AI 코딩 도구(Claude Code)가 썼습니다. 아이디어와 채택 결정, 최종 책임은 제게 있습니다(GitHub [Min-heee](https://github.com/Min-heee)).
