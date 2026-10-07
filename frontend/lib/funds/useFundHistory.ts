"use client";

import { useEffect, useState } from "react";
import { api, type FundHistory } from "@/lib/api";

type Entry = { data: FundHistory | null; error: string; loading: boolean };

// One request per scheme per visit: the portfolio rows and the fund page both read from here.
const cache = new Map<number, Promise<FundHistory>>();

function load(code: number): Promise<FundHistory> {
  let hit = cache.get(code);
  if (!hit) {
    hit = api.fundHistory(code);
    hit.catch(() => cache.delete(code)); // a failure is retried next time, not remembered
    cache.set(code, hit);
  }
  return hit;
}

/** NAV histories for some schemes, filled in as they arrive. */
export function useFundHistories(codes: number[]): Map<number, Entry> {
  const key = codes.join(",");
  const [state, setState] = useState<Map<number, Entry>>(new Map());
  useEffect(() => {
    let live = true;
    setState(new Map(codes.map((c) => [c, { data: null, error: "", loading: true }])));
    for (const code of codes) {
      load(code)
        .then((data) => live && setState((cur) => new Map(cur).set(code, { data, error: "", loading: false })))
        .catch((err) => live && setState((cur) => new Map(cur).set(code, { data: null, error: err instanceof Error ? err.message : "Could not load the NAV history.", loading: false })));
    }
    return () => {
      live = false;
    };
    // `key` stands for the list of codes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state;
}

export function useFundHistory(code: number | null): Entry {
  const map = useFundHistories(code == null ? [] : [code]);
  return (code != null ? map.get(code) : null) ?? { data: null, error: "", loading: code != null };
}
