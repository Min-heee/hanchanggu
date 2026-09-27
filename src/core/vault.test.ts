import { describe, expect, it } from "vitest";
import { activeJson, chunkDoc, extractJsonBlock, loadVault, parseVaultFile, selectCurrent, type VaultDoc } from "./vault";
import { fixture, fixtureFiles } from "./__fixtures__/load";

const FM = (lines: string) => `---\n${lines}\n---\n본문 한 줄.\n`;
const GOOD = [
  "id: V07",
  "title: 수술 후 관리",
  "type: patient-guide",
  "version: 3",
  "status: approved",
  "effective: 2026-07-01",
  "owner: 간호팀",
  "fictional: true",
];

function parsed(path: string, raw: string): VaultDoc {
  const r = parseVaultFile(path, raw);
  if (!r.ok) throw new Error(r.errors.join("; "));
  return r.doc;
}

describe("parseVaultFile — 모르는 키·따옴표", () => {
  it("모르는 키(오타 supercedes 등)는 거부한다", () => {
    const r = parseVaultFile("a.md", FM([...GOOD, "supercedes: V04b"].join("\n")));
    expect(r).toEqual({ ok: false, path: "a.md", errors: ["모르는 필드입니다: supercedes"] });
  });

  it("따옴표 값 뒤의 주석을 떼고 따옴표를 벗긴다. 닫는 따옴표 뒤에 다른 말이 있으면 거부한다", () => {
    const ok = parseVaultFile("a.md", FM(GOOD.map((l) => (l.startsWith("owner") ? 'owner: "간호팀" # 역할만' : l)).join("\n")));
    expect(ok.ok && ok.doc.meta.owner).toBe("간호팀");
    const bad = parseVaultFile("a.md", FM(GOOD.map((l) => (l.startsWith("owner") ? 'owner: "간호팀" 추가' : l)).join("\n")));
    expect(bad.ok).toBe(false);
  });
});

describe("parseVaultFile — 프런트매터", () => {
  it("규격대로인 프런트매터를 읽는다(주석·따옴표 처리 포함)", () => {
    const lines = GOOD.map((l) =>
      l === "id: V07" ? "id: V07            # 아래 ID 고정" : l === "title: 수술 후 관리" ? 'title: "수술 후 # 관리"' : l,
    );
    const r = parseVaultFile("a.md", FM(lines.join("\n")));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc.meta).toEqual({
      id: "V07",
      title: "수술 후 # 관리",
      type: "patient-guide",
      version: 3,
      status: "approved",
      effective: "2026-07-01",
      owner: "간호팀",
      fictional: true,
    });
  });

  it("필드가 빠지면 기본값을 채우지 않고 거부한다", () => {
    const r = parseVaultFile("a.md", FM(GOOD.filter((l) => !l.startsWith("status")).join("\n")));
    expect(r).toEqual({ ok: false, path: "a.md", errors: ["필수 필드 누락: status"] });
  });

  it("잘못된 status·type·version·날짜·fictional을 모두 모아 거부한다", () => {
    const lines = GOOD.map((l) =>
      l
        .replace("status: approved", "status: published")
        .replace("type: patient-guide", "type: memo")
        .replace("version: 3", "version: 0")
        .replace("2026-07-01", "2026-02-30")
        .replace("fictional: true", "fictional: yes"),
    );
    const r = parseVaultFile("a.md", FM(lines.join("\n")));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toEqual([
      "type 값이 틀렸습니다: memo",
      "version은 1 이상의 정수여야 합니다: 0",
      "status 값이 틀렸습니다: published",
      "effective 날짜가 틀렸습니다: 2026-02-30",
      "fictional은 true여야 합니다: yes",
    ]);
  });

  it("프런트매터로 시작하지 않거나 닫히지 않으면 거부한다", () => {
    expect(parseVaultFile("a.md", "# 제목\n").ok).toBe(false);
    expect(parseVaultFile("a.md", "---\nid: V01\n").ok).toBe(false);
  });

  it("자기 자신을 대체하는 supersedes는 거부한다", () => {
    const r = parseVaultFile("a.md", FM([...GOOD, "supersedes: V07"].join("\n")));
    expect(r.ok).toBe(false);
  });

  it("CRLF 파일도 LF 기준으로 읽는다", () => {
    const r = parseVaultFile("a.md", FM(GOOD.join("\n")).replace(/\n/g, "\r\n"));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.doc.source.includes("\r")).toBe(false);
  });
});

describe("chunkDoc — 문단 단위 청크", () => {
  it("소제목 아래 문단을 나누고, 면책 문장은 뺀다", () => {
    const doc = parsed("postop-care.md", fixture("postop-care.md").raw);
    const chunks = chunkDoc(doc);
    expect(chunks.map((c) => [c.chunkId, c.heading, c.text])).toEqual([
      ["V07#0", "D+1", "수술 다음 날 내원해 첫 세척을 받습니다. 이식 부위는 손으로 만지지 않습니다."],
      ["V07#1", "D+3", "D+3부터 안내받은 방법으로 가볍게 머리를 감을 수 있습니다.\n문지르지 말고 거품을 얹어 헹굽니다."],
      ["V07#2", "이상할 때", "평소와 다르다고 느끼면 기다리지 말고 의원으로 연락합니다."],
    ]);
  });

  it("모든 청크의 text는 원문 오프셋 slice와 같다", () => {
    for (const f of fixtureFiles()) {
      const doc = parsed(f.path, f.raw);
      for (const c of chunkDoc(doc)) expect(doc.source.slice(c.start, c.end)).toBe(c.text);
    }
  });

  it("json 코드블록은 청크에 넣지 않는다", () => {
    const doc = parsed("redflags.md", fixture("redflags.md").raw);
    expect(chunkDoc(doc).map((c) => c.text)).toEqual(["아래 표현이 보이면 직원이 답하지 않고 의료진에게 넘깁니다."]);
  });

  it("# 제목 뒤 ## 소제목이 오면 소제목을 쓰고, 위키 링크 문단도 남긴다", () => {
    const doc = parsed("booking-policy.md", fixture("booking-policy.md").raw);
    expect(chunkDoc(doc).map((c) => [c.heading, c.text])).toEqual([
      ["예약 변경", "예약 변경은 방문 전날 오후 6시까지 채널 상담으로 요청합니다. 당일 변경은 전화로만 받습니다."],
      ["예약금 환불", "예약금은 방문 2일 전까지 취소하면 전액 환불합니다. 그 이후 취소는 환불하지 않습니다."],
      ["예약금 환불", "관련 문서: [[consultation-guide]]"],
    ]);
  });
});

describe("extractJsonBlock", () => {
  it("json 코드블록 하나를 읽는다", () => {
    const r = extractJsonBlock(parsed("price-list.md", fixture("price-list.md").raw));
    expect(r.ok).toBe(true);
    if (r.ok) expect((r.value as unknown[]).length).toBe(3);
  });

  it("없으면, 둘이면, 깨졌으면 거부한다", () => {
    const base = FM(GOOD.join("\n"));
    expect(extractJsonBlock(parsed("a.md", base))).toEqual({ ok: false, error: "V07: json 코드블록이 없습니다" });
    const two = parsed("a.md", `${base}\n\`\`\`json\n{}\n\`\`\`\n\n\`\`\`json\n[]\n\`\`\`\n`);
    expect(extractJsonBlock(two)).toEqual({ ok: false, error: "V07: json 코드블록이 2개입니다(하나만 허용)" });
    const broken = extractJsonBlock(parsed("a.md", `${base}\n\`\`\`json\n{"a": }\n\`\`\`\n`));
    expect(broken.ok).toBe(false);
  });
});

describe("selectCurrent / loadVault — 승인된 최신 버전만", () => {
  it("draft와 superseded를 빼고 제외 목록으로 돌려준다", () => {
    const v = loadVault(fixtureFiles());
    expect(v.errors).toEqual([]);
    expect(v.active.map((d) => d.meta.id).sort()).toEqual(["V02", "V03", "V04", "V07", "V11", "V13", "V14", "V15", "V17", "V19"]);
    expect(v.excluded).toEqual([
      { id: "V04b", title: "예약·변경·취소 규정(옛 버전)", status: "superseded", version: 2, reason: "superseded", supersededBy: "V04" },
      { id: "V20", title: "이벤트 초안", status: "draft", version: 1, reason: "draft" },
    ]);
  });

  it("옛 문서의 status를 approved로 둔 실수도 supersedes로 한 번 더 막는다", () => {
    const old = parsed("old.md", fixture("booking-policy-v2.md").raw.replace("status: superseded", "status: approved"));
    const cur = parsed("cur.md", fixture("booking-policy.md").raw);
    const sel = selectCurrent([old, cur]);
    expect(sel.active.map((d) => d.meta.id)).toEqual(["V04"]);
    expect(sel.excluded.map((e) => [e.id, e.reason, e.supersededBy])).toEqual([["V04b", "replaced", "V04"]]);
  });

  it("대체하는 문서의 판이 더 높지 않으면 오류로 알린다", () => {
    const old = parsed("old.md", fixture("booking-policy-v2.md").raw.replace("version: 2", "version: 5"));
    const cur = parsed("cur.md", fixture("booking-policy.md").raw);
    expect(selectCurrent([old, cur]).errors).toEqual(["V04(v3)가 더 높거나 같은 판 V04b(v5)를 대체한다고 적었습니다"]);
  });

  it("asOf를 주면 시행일이 그 뒤인 승인 문서는 빼고, 시행 전 새 판은 옛 판을 대체하지 않는다", () => {
    const old = parsed("old.md", fixture("booking-policy-v2.md").raw.replace("status: superseded", "status: approved"));
    const cur = parsed("cur.md", fixture("booking-policy.md").raw.replace("effective: 2026-07-01", "effective: 2026-12-01"));
    const sel = selectCurrent([old, cur], { asOf: "2026-09-28" });
    expect(sel.active.map((d) => d.meta.id)).toEqual(["V04b"]);
    expect(sel.excluded.map((e) => [e.id, e.reason])).toEqual([["V04", "not-yet-effective"]]);
    // 시행일 당일부터는 새 판이 쓰인다.
    expect(selectCurrent([old, cur], { asOf: "2026-12-01" }).active.map((d) => d.meta.id)).toEqual(["V04"]);
    expect(selectCurrent([cur], { asOf: "2026-02-30" }).errors).toEqual(["asOf 날짜가 틀렸습니다: 2026-02-30"]);
  });

  it("ID가 겹치면 둘 다 빼고 오류로 알린다", () => {
    const a = parsed("a.md", fixture("postop-care.md").raw);
    const b = parsed("b.md", fixture("postop-care.md").raw);
    const sel = selectCurrent([a, b]);
    expect(sel.active).toEqual([]);
    expect(sel.errors).toEqual(["문서 ID가 겹칩니다: V07 (a.md, b.md)"]);
  });

  it("파싱 실패 파일은 경로와 함께 오류로 모은다", () => {
    const v = loadVault([{ path: "bad.md", raw: "없음" }]);
    expect(v.errors).toEqual(["bad.md: 프런트매터(---)로 시작하지 않습니다"]);
  });

  it("activeJson은 승인 문서에서만 값을 꺼낸다", () => {
    const v = loadVault(fixtureFiles());
    expect(activeJson(v, "V03").ok).toBe(true);
    expect(activeJson(v, "V20")).toEqual({ ok: false, error: "V20: 승인된 문서가 없습니다" });
  });
});
