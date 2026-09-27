"use client";

/**
 * 시연 상태(src/demo/state.ts)를 둔다. **기본 저장소는 이 모듈의 메모리 변수**이고, localStorage는 쓸 수 있을 때만 맞춰 둔다.
 *
 * 왜 메모리가 먼저인가: 저장이 막힌 브라우저(사생활 보호 모드, 저장 공간 가득 참 등)에서 쓰기가 실패한 뒤
 * localStorage를 다시 읽으면 상태가 그대로라, 승인·연락 시도·인계 표시 버튼이 아무 반응 없이 먹통이 된다.
 * 메모리에 먼저 쓰면 이번 방문 동안은 그대로 돌고, 새로 고치면 사라질 뿐이다. 그때는 띠에 한 번 알린다.
 *
 * useSyncExternalStore를 쓰는 이유: 서버에서 미리 그린 화면(빈 상태)과 브라우저의 저장값이 달라도
 * 하이드레이션이 깨지지 않고, 여러 컴포넌트·탭이 같은 값을 본다.
 */

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { EMPTY_STATE, parseState, STORAGE_KEY, type DemoState } from "@/demo/state";

const listeners = new Set<() => void>();
/** undefined = 아직 안 읽음. */
let memory: string | null | undefined;
let storageBlocked = false;

function notify() {
  listeners.forEach((l) => l());
}

function onStorage(e: StorageEvent) {
  // 다른 탭에서 바뀐 값. 이 탭의 메모리도 맞춘다.
  if (e.key !== null && e.key !== STORAGE_KEY) return;
  memory = e.newValue;
  notify();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  if (listeners.size === 1) window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

function snapshot(): string | null {
  if (memory === undefined) {
    try {
      memory = window.localStorage.getItem(STORAGE_KEY);
    } catch {
      memory = null;
      storageBlocked = true;
    }
  }
  return memory;
}

function write(v: string | null) {
  memory = v;
  try {
    if (v === null) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, v);
  } catch {
    storageBlocked = true;
  }
  notify();
}

export function useDemoState() {
  const raw = useSyncExternalStore(subscribe, snapshot, () => null);
  const state = useMemo(() => parseState(raw), [raw]);
  const update = useCallback((fn: (s: DemoState) => DemoState) => {
    write(JSON.stringify(fn(parseState(snapshot()))));
  }, []);
  const reset = useCallback(() => write(null), []);
  return { state, update, reset, empty: state === EMPTY_STATE };
}

/** 저장이 막혔는지(띠에 '이 브라우저는 기록을 저장하지 않습니다'를 보인다). */
export function useStorageBlocked(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => {
      snapshot();
      return storageBlocked;
    },
    () => false,
  );
}
