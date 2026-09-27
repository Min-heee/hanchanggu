"use client";

/**
 * 시연 상태(src/demo/state.ts)를 localStorage 한 칸에 둔다.
 * useSyncExternalStore를 쓰는 이유: 서버에서 미리 그린 화면(빈 상태)과 브라우저의 저장값이 달라도
 * 하이드레이션이 깨지지 않고, 여러 컴포넌트·탭이 같은 값을 본다.
 * 저장이 막힌 브라우저(사생활 보호 모드 등)에서는 읽기·쓰기 실패를 삼키고 빈 상태로 돈다.
 */

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { EMPTY_STATE, parseState, STORAGE_KEY, type DemoState } from "@/demo/state";

const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeRaw(v: string | null) {
  try {
    if (v === null) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, v);
  } catch {
    // 저장이 막혀 있어도 화면은 돈다. 이번 방문 동안만 기록이 남지 않는다.
  }
  listeners.forEach((l) => l());
}

export function useDemoState() {
  const raw = useSyncExternalStore(subscribe, readRaw, () => null);
  const state = useMemo(() => parseState(raw), [raw]);
  const update = useCallback((fn: (s: DemoState) => DemoState) => {
    writeRaw(JSON.stringify(fn(parseState(readRaw()))));
  }, []);
  const reset = useCallback(() => writeRaw(null), []);
  return { state, update, reset, empty: state === EMPTY_STATE };
}
