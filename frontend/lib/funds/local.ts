"use client";

import { useSyncExternalStore } from "react";

/**
 * Browser-only stores for the funds desk: watchlist, recently viewed and NAV alerts. The API has no
 * endpoints for these yet (see gaps.ts: watchlist-sync, alerts-service), so they live in
 * localStorage, keyed by the signed-in account so two people sharing a browser do not mix lists.
 */

export type WatchItem = {
  code: number;
  name: string;
  house: string | null;
  category: string | null;
  /** NAV when the fund was starred, so the card can show the move since. */
  navAtAdd: number | null;
  navDateAtAdd: string | null;
  addedAt: string;
};

export type RecentItem = {
  code: number;
  name: string;
  house: string;
  category: string;
  nav: number | null;
  navDate: string | null;
  at: string;
};

export type NavAlert = {
  id: string;
  code: number;
  name: string;
  direction: "above" | "below";
  level: number;
  createdAt: string;
  firedAt: string | null;
  firedNav: number | null;
  firedNavDate: string | null;
};

const PREFIX = "connect.mf.";
const RECENT_CAP = 8;
const EMPTY: readonly never[] = Object.freeze([]);

let owner: string | null = null;
const listeners = new Set<() => void>();
const cache = new Map<string, { raw: string | null; value: unknown }>();

function emit() {
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  const onStorage = (e: StorageEvent) => {
    if (!e.key || e.key.startsWith(PREFIX)) fn();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", onStorage);
  };
}

/** Called once the account is known; lists stay empty until then. */
export function setFundsOwner(id: string | null) {
  if (owner === id) return;
  owner = id;
  emit();
}

function keyFor(name: string, scoped: boolean): string | null {
  if (!scoped) return PREFIX + name;
  return owner ? `${PREFIX}${owner}.${name}` : null;
}

function readRaw(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Parsed value, cached on the raw string so useSyncExternalStore sees a stable reference. */
function readList<T>(name: string): readonly T[] {
  const key = keyFor(name, true);
  if (!key) return EMPTY;
  const raw = readRaw(key);
  const hit = cache.get(key);
  if (hit && hit.raw === raw) return hit.value as T[];
  let value: T[] = [];
  try {
    const parsed = raw ? JSON.parse(raw) : [];
    value = Array.isArray(parsed) ? parsed : [];
  } catch {
    value = [];
  }
  cache.set(key, { raw, value });
  return value;
}

function writeList<T>(name: string, list: T[]) {
  const key = keyFor(name, true);
  if (!key) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(list));
  } catch {
    /* private mode or quota: there is nowhere to keep the change */
  }
  emit();
}

function useList<T>(name: string): readonly T[] {
  return useSyncExternalStore(
    subscribe,
    () => readList<T>(name),
    () => EMPTY,
  );
}

// ---- Watchlist ---------------------------------------------------------------------------------

export const useWatchlist = () => useList<WatchItem>("watchlist");

export function isWatched(list: readonly WatchItem[], code: number) {
  return list.some((w) => w.code === code);
}

export function toggleWatch(item: Omit<WatchItem, "addedAt">) {
  const list = readList<WatchItem>("watchlist");
  if (isWatched(list, item.code)) writeList("watchlist", list.filter((w) => w.code !== item.code));
  else writeList("watchlist", [{ ...item, addedAt: new Date().toISOString() }, ...list]);
}

export function unwatch(code: number) {
  writeList("watchlist", readList<WatchItem>("watchlist").filter((w) => w.code !== code));
}

/** Fill fields a star saved as null (e.g. starred from a search hit, before any NAV was known). */
export function backfillWatch(code: number, data: { nav: number; navDate: string; house: string; category: string }) {
  const list = readList<WatchItem>("watchlist");
  const item = list.find((w) => w.code === code);
  if (!item || (item.navAtAdd != null && item.house && item.category)) return;
  writeList(
    "watchlist",
    list.map((w) =>
      w.code === code
        ? {
            ...w,
            navAtAdd: w.navAtAdd ?? data.nav,
            navDateAtAdd: w.navDateAtAdd ?? data.navDate,
            house: w.house ?? data.house,
            category: w.category ?? data.category,
          }
        : w,
    ),
  );
}

// ---- Recently viewed ---------------------------------------------------------------------------

export const useRecent = () => useList<RecentItem>("recent");

export function pushRecent(item: Omit<RecentItem, "at">) {
  const list = readList<RecentItem>("recent").filter((r) => r.code !== item.code);
  writeList("recent", [{ ...item, at: new Date().toISOString() }, ...list].slice(0, RECENT_CAP));
}

export function clearRecent() {
  writeList("recent", []);
}

// ---- NAV alerts --------------------------------------------------------------------------------

export const useAlerts = () => useList<NavAlert>("alerts");

export function addAlert(input: Pick<NavAlert, "code" | "name" | "direction" | "level">) {
  const alert: NavAlert = {
    ...input,
    id: `${input.code}-${Date.now().toString(36)}`,
    createdAt: new Date().toISOString(),
    firedAt: null,
    firedNav: null,
    firedNavDate: null,
  };
  writeList("alerts", [...readList<NavAlert>("alerts"), alert]);
}

export function removeAlert(id: string) {
  writeList("alerts", readList<NavAlert>("alerts").filter((a) => a.id !== id));
}

export function rearmAlert(id: string) {
  writeList(
    "alerts",
    readList<NavAlert>("alerts").map((a) => (a.id === id ? { ...a, firedAt: null, firedNav: null, firedNavDate: null } : a)),
  );
}

export function alertHit(alert: Pick<NavAlert, "direction" | "level">, nav: number): boolean {
  return alert.direction === "above" ? nav >= alert.level : nav <= alert.level;
}

/** Mark every armed alert whose condition the given NAVs meet. One write for the batch. */
export function checkAlerts(navs: Map<number, { nav: number; date: string | null }>) {
  const list = readList<NavAlert>("alerts");
  let changed = false;
  const next = list.map((a) => {
    if (a.firedAt) return a;
    const quote = navs.get(a.code);
    if (!quote || !alertHit(a, quote.nav)) return a;
    changed = true;
    return { ...a, firedAt: new Date().toISOString(), firedNav: quote.nav, firedNavDate: quote.date };
  });
  if (changed) writeList("alerts", next);
}

// ---- Unscoped UI prefs -------------------------------------------------------------------------

function useFlag(name: string): string | null {
  return useSyncExternalStore(
    subscribe,
    () => {
      const key = keyFor(name, false);
      return key ? readRaw(key) : null;
    },
    () => null,
  );
}

function writeFlag(name: string, value: string | null) {
  const key = keyFor(name, false);
  if (!key) return;
  try {
    if (value == null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
  emit();
}

export type FundView = "cards" | "table";

export function useFundView(): FundView {
  return useFlag("view") === "table" ? "table" : "cards";
}

export function setFundView(view: FundView) {
  writeFlag("view", view);
}

/** null on the server and before hydration, so the tour never flashes during SSR. */
export function useAnalyticsTourDone(): boolean | null {
  const raw = useSyncExternalStore(
    subscribe,
    () => readRaw(PREFIX + "analyticsTour") ?? "",
    () => null,
  );
  return raw == null ? null : raw !== "";
}

export function setAnalyticsTourDone(done: boolean) {
  writeFlag("analyticsTour", done ? new Date().toISOString() : null);
}
