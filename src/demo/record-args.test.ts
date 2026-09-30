/**
 * scripts/record-demo.ts 인자 해석(src/demo/record-args.ts). 2026-09-30 검증: 모르는 인자를 거부하지 않아
 * "--handover-ony"(오타) 하나로 전체 재녹화(약 $1, 4회차 파일·수치를 덮어씀)가 돌 수 있었다.
 */

import { describe, expect, it } from "vitest";
import { parseRecordArgs } from "./record-args";

describe("record-demo 인자", () => {
  it("무엇을 녹화할지 고르지 않으면 멈춘다 — 인자 없이 전체 재녹화로 가지 않는다", () => {
    expect(() => parseRecordArgs([])).toThrow("--handover-only");
    expect(() => parseRecordArgs(["--limit", "3"])).toThrow("무엇을 녹화할지");
  });

  it("오타·모르는 인자는 거부한다(오타 단독도, 다른 인자와 함께여도)", () => {
    expect(() => parseRecordArgs(["--handover-ony"])).toThrow("모르는 인자입니다: --handover-ony");
    expect(() => parseRecordArgs(["--handover-only", "--dryrun"])).toThrow("모르는 인자입니다: --dryrun");
    expect(() => parseRecordArgs(["--all", "Q06"])).toThrow("모르는 인자입니다: Q06");
  });

  it("전체 재녹화는 --all로만, --handover-only와 함께 쓸 수 없다", () => {
    expect(parseRecordArgs(["--all"])).toEqual({ all: true, handoverOnly: false, dryRun: false, redo: false, limit: Infinity, only: null });
    expect(parseRecordArgs(["--all", "--limit", "3"]).limit).toBe(3);
    expect(() => parseRecordArgs(["--all", "--handover-only"])).toThrow("함께 쓸 수 없습니다");
  });

  it("--dry-run·--redo·--only는 --handover-only와 함께만", () => {
    expect(() => parseRecordArgs(["--all", "--dry-run"])).toThrow("--handover-only와 함께만");
    expect(() => parseRecordArgs(["--all", "--redo"])).toThrow("--handover-only와 함께만");
    expect(() => parseRecordArgs(["--all", "--only", "Q06"])).toThrow("--handover-only와 함께만");
  });

  it("--handover-only 조합: --only는 대문자로 모으고, --redo와 함께 쓰지 않는다", () => {
    expect(parseRecordArgs(["--handover-only", "--dry-run", "--only", "q06, Q11"])).toEqual({
      all: false,
      handoverOnly: true,
      dryRun: true,
      redo: false,
      limit: Infinity,
      only: ["Q06", "Q11"],
    });
    expect(parseRecordArgs(["--handover-only", "--redo"]).redo).toBe(true);
    expect(() => parseRecordArgs(["--handover-only", "--only", "Q06", "--redo"])).toThrow("함께 쓰지 않습니다");
    expect(() => parseRecordArgs(["--handover-only", "--only", ","])).toThrow("--only 뒤에 문의 ID");
  });

  it("값이 빠지거나 틀린 --limit·--only는 거부한다", () => {
    expect(() => parseRecordArgs(["--handover-only", "--limit"])).toThrow("--limit 뒤에 값을");
    expect(() => parseRecordArgs(["--handover-only", "--only", "--dry-run"])).toThrow("--only 뒤에 값을");
    expect(() => parseRecordArgs(["--handover-only", "--limit", "0"])).toThrow("1 이상의 정수");
    expect(() => parseRecordArgs(["--handover-only", "--limit", "2.5"])).toThrow("1 이상의 정수");
  });
});
