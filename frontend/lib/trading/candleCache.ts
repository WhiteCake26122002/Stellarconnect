import { api } from "../api";
import type { Candle } from "./types";

/**
 * Candles already fetched this session, so going back to a timeframe or a symbol is instant and a fetch
 * that is already under way is shared instead of repeated. Entries refresh in the background once stale.
 */
type Entry = { at: number; candles: Candle[] };

const entries = new Map<string, Entry>();
const inflight = new Map<string, Promise<Candle[] | null>>();
const SLOW = new Set(["1D", "1W", "1M"]);
const key = (symbol: string, tf: string) => `${symbol}|${tf}`;

/** Daily and longer bars barely move within minutes; intraday bars are stale after a quiet half minute. */
export const ttlFor = (tf: string) => (SLOW.has(tf) ? 5 * 60_000 : 25_000);

export function peek(symbol: string, tf: string): Entry | undefined {
  return entries.get(key(symbol, tf));
}

export function isFresh(symbol: string, tf: string, now = Date.now()): boolean {
  const hit = entries.get(key(symbol, tf));
  return !!hit && now - hit.at < ttlFor(tf);
}

/** Fetch (or join the fetch of) a series. Null when the feed has nothing. */
export function load(symbol: string, tf: string): Promise<Candle[] | null> {
  const k = key(symbol, tf);
  const running = inflight.get(k);
  if (running) return running;
  const p = api
    .marketOhlc(symbol, tf)
    .then((data) => {
      if (!data.candles?.length) return null;
      const candles = data.candles.map((c) => ({ t: c.t, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v }));
      entries.set(k, { at: Date.now(), candles });
      return candles;
    })
    .catch(() => null)
    .finally(() => inflight.delete(k));
  inflight.set(k, p);
  return p;
}

/** Warm the series a user is likely to ask for next, one at a time so the feed is not hammered. */
export function prefetch(symbol: string, timeframes: string[]): () => void {
  let stopped = false;
  const run = async () => {
    for (const tf of timeframes) {
      if (stopped) return;
      if (!isFresh(symbol, tf)) await load(symbol, tf);
      await new Promise((r) => setTimeout(r, 250));
    }
  };
  const idle = (window as unknown as { requestIdleCallback?: (fn: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  const handle = idle ? idle(() => void run(), { timeout: 2500 }) : window.setTimeout(() => void run(), 800);
  return () => {
    stopped = true;
    if (idle) (window as unknown as { cancelIdleCallback?: (h: number) => void }).cancelIdleCallback?.(handle);
    else window.clearTimeout(handle);
  };
}
