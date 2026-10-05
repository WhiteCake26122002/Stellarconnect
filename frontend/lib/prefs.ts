"use client";

import { useSyncExternalStore } from "react";

export type ViewMode = "simple" | "detailed";

const MODE_KEY = "connect.viewMode";
const TOUR_KEY = "connect.tourDone";
const DATACHECK_PREFIX = "connect.dataCheckHidden.";

const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  const onStorage = (e: StorageEvent) => {
    if (!e.key || e.key.startsWith("connect.")) fn();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", onStorage);
  };
}

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value == null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* private mode: the choice lasts for this page only */
  }
  emit();
}

function useStored(key: string): string | null {
  return useSyncExternalStore(
    subscribe,
    () => read(key),
    () => null,
  );
}

export function setViewMode(mode: ViewMode) {
  write(MODE_KEY, mode);
}

/** Simple is the default until the user picks Detailed. */
export function useViewMode(): ViewMode {
  return useStored(MODE_KEY) === "detailed" ? "detailed" : "simple";
}

export function useSimple(): boolean {
  return useViewMode() === "simple";
}

export function useTourDone(): boolean | null {
  const raw = useSyncExternalStore(
    subscribe,
    () => read(TOUR_KEY) ?? "",
    () => null,
  );
  return raw == null ? null : raw !== "";
}

export function setTourDone(done: boolean) {
  write(TOUR_KEY, done ? new Date().toISOString() : null);
}

/** The notice stays hidden only while the set of flags it was dismissed for is unchanged. */
export function useDataCheckHidden(modelId: string): string | null {
  return useStored(DATACHECK_PREFIX + modelId);
}

export function setDataCheckHidden(modelId: string, signature: string | null) {
  write(DATACHECK_PREFIX + modelId, signature);
}
