"use client";

import { useEffect, useMemo, useState } from "react";
import * as candleCache from "@/lib/trading/candleCache";

/**
 * The last `count` daily closes for each symbol, from the market feed only. A symbol the feed cannot answer for has
 * no entry, so a sparkline is drawn from real prices or not at all; simulated bars are never used here.
 */
export function useCloses(symbols: string[], count = 30): Map<string, number[]> {
  const key = symbols.slice(0, 16).join("|");
  const [map, setMap] = useState<Map<string, number[]>>(() => new Map());
  useEffect(() => {
    let gone = false;
    const list = key ? key.split("|") : [];
    const tail = (candles: { c: number }[]) => candles.slice(-count).map((c) => c.c);
    const seeded = new Map<string, number[]>();
    for (const s of list) {
      const hit = candleCache.peek(s, "1D");
      if (hit) seeded.set(s, tail(hit.candles));
    }
    if (seeded.size) setMap((m) => new Map([...m, ...seeded]));
    (async () => {
      for (const s of list) {
        if (gone) return;
        if (candleCache.isFresh(s, "1D")) continue;
        const candles = await candleCache.load(s, "1D");
        if (gone || !candles) continue;
        setMap((m) => new Map(m).set(s, tail(candles)));
      }
    })();
    return () => {
      gone = true;
    };
  }, [key, count]);
  return useMemo(() => map, [map]);
}
