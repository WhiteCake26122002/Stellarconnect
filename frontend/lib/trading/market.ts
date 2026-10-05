import type { Candle, Quote } from "./types";
import { TIMEFRAMES, UNIVERSE, findSymbol } from "./universe";

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function candlesFor(symbol: string, tfId: string, count = 2400, endTs = Date.now()): Candle[] {
  const info = findSymbol(symbol);
  const tf = TIMEFRAMES.find((t) => t.id === tfId) || TIMEFRAMES.find((t) => t.id === "1D")!;
  const rand = mulberry32(hash(`${symbol}:${tfId}`));
  const step = tf.seconds * 1000;
  const out: Candle[] = [];
  let price = info.base * (0.72 + rand() * 0.2);
  const vol = info.volatility * Math.sqrt(tf.seconds / 86400) * 2.4;
  for (let i = 0; i < count; i++) {
    const t = endTs - (count - 1 - i) * step;
    const cycle = Math.sin(i / 38) * 0.35 + Math.sin(i / 140) * 0.55;
    const drift = vol * (0.08 * cycle + (rand() - 0.48) * 1.15);
    const shock = (rand() - 0.5) * vol * (rand() > 0.97 ? 4.2 : 1);
    const o = price;
    let c = Math.max(info.tickSize, o * (1 + drift + shock));
    const w = Math.abs(rand() - 0.5) * vol * o * 1.8;
    const h = Math.max(o, c) + w * rand();
    const l = Math.max(info.tickSize, Math.min(o, c) - w * rand());
    const v = Math.round(80_000 + rand() * 420_000 * (0.6 + Math.abs(c - o) / o * 40));
    out.push({ t, o, h, l, c, v });
    price = c;
  }
  const last = out[out.length - 1];
  if (last) {
    const scale = info.base / last.c;
    for (const c of out) {
      c.o *= scale;
      c.h *= scale;
      c.l *= scale;
      c.c *= scale;
    }
  }
  return out;
}

export function applyLiveLast(candles: Candle[], last: number): Candle[] {
  if (!candles.length || !(last > 0)) return candles;
  const next = candles.slice();
  const bar = { ...next[next.length - 1] };
  bar.c = last;
  bar.h = Math.max(bar.h, last);
  bar.l = Math.min(bar.l, last);
  next[next.length - 1] = bar;
  return next;
}

export function quoteFromLive(
  symbol: string,
  live: {
    last: number;
    prev_close: number;
    open: number;
    high: number;
    low: number;
    change: number;
    change_pct: number;
    volume: number;
    ts: number;
    live?: boolean;
  },
): Quote {
  const spread = Math.max(findSymbol(symbol).tickSize, live.last * 0.00012);
  return {
    symbol,
    last: live.last,
    bid: live.last - spread / 2,
    ask: live.last + spread / 2,
    open: live.open,
    high: live.high,
    low: live.low,
    change: live.change,
    changePct: live.change_pct,
    volume: live.volume,
    ts: live.ts,
    live: live.live !== false,
  };
}

export function quoteFromCandles(symbol: string, candles: Candle[]): Quote {
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2] || last;
  const dayOpen = candles[Math.max(0, candles.length - 80)]?.o ?? last.o;
  const change = last.c - prev.c;
  const spread = Math.max(findSymbol(symbol).tickSize, last.c * 0.00012);
  return {
    symbol,
    last: last.c,
    bid: last.c - spread / 2,
    ask: last.c + spread / 2,
    open: dayOpen,
    high: last.h,
    low: last.l,
    change,
    changePct: prev.c ? change / prev.c : 0,
    volume: last.v,
    ts: last.t,
  };
}

export function applyTick(candles: Candle[], tfSeconds: number, rand: () => number, vol: number): Candle[] {
  if (!candles.length) return candles;
  const next = candles.slice();
  const last = { ...next[next.length - 1] };
  const now = Date.now();
  const step = tfSeconds * 1000;
  if (now - last.t >= step) {
    const o = last.c;
    const drift = (rand() - 0.49) * vol * o;
    const c = Math.max(0.0001, o + drift);
    const h = Math.max(o, c);
    const l = Math.min(o, c);
    next.push({ t: last.t + step, o, h, l, c, v: Math.round(20_000 + rand() * 80_000) });
    if (next.length > 12000) next.shift();
    return next;
  }
  const delta = (rand() - 0.5) * vol * last.c * 0.35;
  last.c = Math.max(0.0001, last.c + delta);
  last.h = Math.max(last.h, last.c);
  last.l = Math.min(last.l, last.c);
  last.v += Math.round(rand() * 400);
  last.t = last.t;
  next[next.length - 1] = last;
  return next;
}

export function depthLadder(quote: Quote, rand: () => number): { bid: { px: number; qty: number }[]; ask: { px: number; qty: number }[] } {
  const tick = Math.max(0.05, quote.last * 0.00008);
  const bid = [];
  const ask = [];
  for (let i = 0; i < 8; i++) {
    bid.push({ px: quote.bid - i * tick, qty: Math.round(50 + rand() * 900) });
    ask.push({ px: quote.ask + i * tick, qty: Math.round(50 + rand() * 900) });
  }
  return { bid, ask };
}

export function allQuotes(series: Map<string, Candle[]>): Quote[] {
  return UNIVERSE.map((s) => {
    const c = series.get(`${s.symbol}|1D`);
    if (c?.length) return quoteFromCandles(s.symbol, c);
    return quoteFromCandles(s.symbol, candlesFor(s.symbol, "1D", 120));
  });
}

export function seedKey(symbol: string, tf: string) {
  return `${symbol}|${tf}`;
}
