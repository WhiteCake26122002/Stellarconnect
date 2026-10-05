"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { api, FundQuote } from "@/lib/api";

export type QuoteEntry = { quote: FundQuote | null; state: "loading" | "ok" | "failed" };

/**
 * Latest NAV for each code, fetched once per code per mount. The API caches scheme detail for six
 * hours, so re-asking within a session buys nothing.
 */
export function useQuotes(codes: readonly number[]): Map<number, QuoteEntry> {
  const [entries, setEntries] = useState<Record<number, QuoteEntry>>({});
  const requested = useRef(new Set<number>());
  const key = [...new Set(codes)].sort((a, b) => a - b).join(",");

  useEffect(() => {
    const wanted = key ? key.split(",").map(Number) : [];
    const fresh = wanted.filter((c) => !requested.current.has(c));
    if (!fresh.length) return;
    const controller = new AbortController();
    const pending = new Set(fresh);
    fresh.forEach((c) => requested.current.add(c));
    setEntries((cur) => {
      const next = { ...cur };
      for (const c of fresh) if (!next[c] || next[c].state !== "ok") next[c] = { quote: null, state: "loading" };
      return next;
    });
    for (const c of fresh) {
      api
        .fundQuote(c, controller.signal)
        .then((quote) => {
          pending.delete(c);
          setEntries((cur) => ({ ...cur, [c]: { quote, state: "ok" } }));
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          pending.delete(c);
          setEntries((cur) => ({ ...cur, [c]: { quote: null, state: "failed" } }));
        });
    }
    // Unfinished codes go back in the pool so the next run (new key, or Strict Mode's re-run) asks again.
    return () => {
      controller.abort();
      pending.forEach((c) => requested.current.delete(c));
    };
  }, [key]);

  return useMemo(() => new Map(Object.entries(entries).map(([k, v]) => [Number(k), v])), [entries]);
}
