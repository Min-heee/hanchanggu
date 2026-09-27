---
id: V02
title: 진료시간·오시는 길
type: reference
version: 1
status: approved
effective: 2026-07-01
owner: 원무팀
fictional: true
---
## 진료시간
진료시간은 아래 표를 따릅니다.

```json
{
  "weekly": {
    "mon": { "open": "10:00", "close": "19:00" },
    "tue": { "open": "10:00", "close": "19:00" },
    "wed": null,
    "thu": { "open": "10:00", "close": "19:00" },
    "fri": { "open": "10:00", "close": "19:00" },
    "sat": { "open": "10:00", "close": "15:00" },
    "sun": null
  },
  "lunch": { "start": "13:00", "end": "14:00", "days": ["mon", "tue", "thu", "fri"] },
  "lastEntryMinutesBeforeClose": 30,
  "closed": ["wed", "sun", "public-holiday"],
  "extraClosedDates": [{ "date": "2026-10-16", "reason": "내부 교육" }],
  "noSurgeryDays": ["sat"]
}
```

가상 의원의 예시 문서이며 실제 의료 지침이 아닙니다.
