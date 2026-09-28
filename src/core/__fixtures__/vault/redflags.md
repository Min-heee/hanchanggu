---
id: V11
title: 적신호 증상 목록
type: procedure
version: 1
status: approved
effective: 2026-07-01
owner: 간호팀
fictional: true
---
## 즉시 인계 원칙
아래 표현이 보이면 직원이 답하지 않고 의료진에게 넘깁니다.

```json
{
  "symptoms": ["고름", "열이", "심한 출혈", "숨이 차", "붓기가 심해"],
  "postopContext": ["수술 후", "이식 부위", "D+", "일째"],
  "postopContextPatterns": ["\\d{1,3}\\s*(일|주)\\s*(째|차)"],
  "feverThresholdCelsius": 38,
  "ambiguous": ["붓기", "가려", "빨개"],
  "nonSymptomWords": ["두피"]
}
```

가상 의원의 예시 문서이며 실제 의료 지침이 아닙니다.
