"use client";

import { useEffect, useRef, useState } from "react";
import { equity, unrealized } from "@/lib/trading/engine";
import type { EngineState } from "@/lib/trading/engine";
import type { Quote } from "@/lib/trading/types";
import { findSymbol } from "@/lib/trading/universe";

/** One mark of the paper book, taken whenever live quotes land. Kept in memory for this tab only. */
export type PnlSample = {
  t: number;
  /** Equity change since the day anchor; the same number as the Day P&L readout. */
  day: number;
  /** Sum of trades closed today. */
  realized: number;
  /** Mark-to-market on open positions. */
  unrealized: number;
  /** Unrealized P&L per open position id. */
  byPos: Record<string, number>;
};

export type PnlEvent =
  | { kind: "milestone"; posId: string; name: string; threshold: number; ret: number }
  | { kind: "profitable"; posId: string; name: string; pnl: number }
  | { kind: "session-high" | "session-low"; value: number };

const MAX_SAMPLES = 1440;
const THRESHOLDS = [0.05, -0.05, 0.1, -0.1];
const EXTREME_COOLDOWN_MS = 60_000;

function startOfToday() {
  return new Date().setHours(0, 0, 0, 0);
}

/**
 * Records a P&L sample each time every open position has a live quote, and reports milestones:
 * first ±5% / ±10% crossing per position, a position turning profitable after a loss, and new
 * session highs/lows of Day P&L. Positions already past a threshold when first seen are not
 * announced, so a reload does not replay old milestones.
 */
export function usePnlSession(engine: EngineState, quotes: Map<string, Quote>, onEvent: (e: PnlEvent) => void) {
  const [samples, setSamples] = useState<PnlSample[]>([]);
  const crossed = useRef(new Set<string>());
  const lastSign = useRef(new Map<string, number>());
  const sawLoss = useRef(new Set<string>());
  const extremes = useRef<{ hi: number; lo: number; n: number; lastToast: number; toldHi: number; toldLo: number } | null>(null);
  const emit = useRef(onEvent);

  useEffect(() => {
    emit.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    const open = engine.positions.filter((p) => p.status !== "closed");
    if (open.some((p) => !quotes.get(p.symbol)?.live)) return;

    const now = Date.now();
    const since = startOfToday();
    const realized = engine.trades.reduce((s, t) => (t.closedAt >= since ? s + t.pnl : s), 0);
    const byPos: Record<string, number> = {};
    let unreal = 0;
    const events: PnlEvent[] = [];

    for (const p of open) {
      const last = quotes.get(p.symbol)!.last;
      const u = unrealized(p, last);
      const basis = p.avgPrice * p.qty;
      const ret = basis ? u / basis : 0;
      byPos[p.id] = u;
      unreal += u;
      const name = findSymbol(p.symbol).name;
      const firstSight = !lastSign.current.has(p.id);
      for (const thr of THRESHOLDS) {
        const key = `${p.id}:${thr}`;
        if (crossed.current.has(key)) continue;
        const past = thr > 0 ? ret >= thr : ret <= thr;
        if (!past) continue;
        crossed.current.add(key);
        if (!firstSight) events.push({ kind: "milestone", posId: p.id, name, threshold: thr, ret });
      }
      const prev = lastSign.current.get(p.id);
      if (!firstSight && prev != null && prev <= 0 && u > 0 && sawLoss.current.has(p.id)) {
        events.push({ kind: "profitable", posId: p.id, name, pnl: u });
      }
      if (u < 0) sawLoss.current.add(p.id);
      lastSign.current.set(p.id, Math.sign(u));
    }

    const day = equity(engine, quotes) - engine.account.dayPnlStartEquity;
    const ex = extremes.current;
    if (!ex) {
      extremes.current = { hi: day, lo: day, n: 1, lastToast: 0, toldHi: Math.max(0, day), toldLo: Math.min(0, day) };
    } else {
      ex.n += 1;
      const step = Math.max(100, engine.account.startingBalance * 0.0005);
      const cool = now - ex.lastToast > EXTREME_COOLDOWN_MS;
      if (day > ex.hi) {
        ex.hi = day;
        if (ex.n >= 3 && cool && day > 0 && day >= ex.toldHi + step) {
          events.push({ kind: "session-high", value: day });
          ex.lastToast = now;
          ex.toldHi = day;
        }
      } else if (day < ex.lo) {
        ex.lo = day;
        if (ex.n >= 3 && cool && day < 0 && day <= ex.toldLo - step) {
          events.push({ kind: "session-low", value: day });
          ex.lastToast = now;
          ex.toldLo = day;
        }
      }
    }

    const sample: PnlSample = { t: now, day, realized, unrealized: unreal, byPos };
    setSamples((prev) => {
      const next = prev.length && now - prev[prev.length - 1].t < 1500 ? [...prev.slice(0, -1), sample] : [...prev, sample];
      return next.length > MAX_SAMPLES ? next.slice(-MAX_SAMPLES) : next;
    });
    for (const e of events) emit.current(e);
  }, [engine, quotes]);

  return samples;
}

export function positionSeries(samples: PnlSample[], posId: string) {
  return samples.filter((s) => posId in s.byPos).map((s) => ({ t: s.t, v: s.byPos[posId] }));
}
