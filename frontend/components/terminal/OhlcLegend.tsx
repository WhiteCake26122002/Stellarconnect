"use client";

import { useSyncExternalStore } from "react";
import { px, vol } from "@/lib/trading/format";
import type { Candle } from "@/lib/trading/types";

/**
 * The bar under the crosshair, kept outside React state: moving the mouse across a chart changes this
 * many times a second, and re-rendering the whole terminal for each move is what made the chart feel heavy.
 */
export type HoverStore = {
  get: () => number | null;
  set: (index: number | null) => void;
  subscribe: (fn: () => void) => () => void;
};

export function createHoverStore(): HoverStore {
  let value: number | null = null;
  const subs = new Set<() => void>();
  return {
    get: () => value,
    set(next) {
      if (next === value) return;
      value = next;
      subs.forEach((fn) => fn());
    },
    subscribe(fn) {
      subs.add(fn);
      return () => {
        subs.delete(fn);
      };
    },
  };
}

/** O, H, L, C and volume for the hovered bar, or the latest bar when the pointer is off the chart. */
export function OhlcLegend({ candles, store }: { candles: Candle[]; store: HoverStore }) {
  const hovered = useSyncExternalStore(store.subscribe, store.get, () => null);
  const last = candles.length - 1;
  const at = hovered != null && hovered >= 0 && hovered <= last ? hovered : last;
  const bar = candles[at];
  if (!bar) return null;
  const prev = candles[at - 1] ?? bar;
  const tone = (v: number) => (v >= prev.c ? "up" : "down");
  return (
    <div className="term-ohlc" aria-live="off">
      <span>O <b className={tone(bar.o)}>{px(bar.o)}</b></span>
      <span>H <b className={tone(bar.h)}>{px(bar.h)}</b></span>
      <span>L <b className={tone(bar.l)}>{px(bar.l)}</b></span>
      <span>C <b className={tone(bar.c)}>{px(bar.c)}</b></span>
      <span>Vol <b>{vol(bar.v)}</b></span>
    </div>
  );
}
