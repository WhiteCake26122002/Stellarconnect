"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { pct, px } from "@/lib/trading/format";
import type { Candle, Quote } from "@/lib/trading/types";
import { findSymbol } from "@/lib/trading/universe";

const INDEX_BOARD = [
  { symbol: "NIFTY", label: "NIFTY 50" },
  { symbol: "SENSEX", label: "SENSEX" },
  { symbol: "BANKNIFTY", label: "Bank Nifty" },
  { symbol: "CNXIT", label: "Nifty IT" },
] as const;

function Spark({ candles, up }: { candles: Candle[]; up: boolean }) {
  if (candles.length < 2) return <svg className="board-spark" viewBox="0 0 120 36" aria-hidden />;
  const slice = candles.slice(-48);
  const ys = slice.map((c) => c.c);
  const min = Math.min(...ys);
  const max = Math.max(...ys);
  const span = max - min || 1;
  const d = slice
    .map((c, i) => {
      const x = (i / (slice.length - 1)) * 120;
      const y = 34 - ((c.c - min) / span) * 30;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg className="board-spark" viewBox="0 0 120 36" aria-hidden>
      <path d={d} fill="none" stroke={up ? "var(--term-up)" : "var(--term-down)"} strokeWidth="1.6" />
    </svg>
  );
}

function heatColor(chg: number) {
  const mag = Math.min(1, Math.abs(chg) / 0.03);
  if (chg >= 0) return `rgba(61, 214, 140, ${0.18 + mag * 0.72})`;
  return `rgba(240, 113, 120, ${0.18 + mag * 0.72})`;
}

export function MarketsBoard({
  quotes,
  watchlist,
  onPick,
}: {
  quotes: Map<string, Quote>;
  watchlist: string[];
  onPick: (symbol: string) => void;
}) {
  const [series, setSeries] = useState<Record<string, Candle[]>>({});

  useEffect(() => {
    const ac = new AbortController();
    (async () => {
      const next: Record<string, Candle[]> = {};
      for (const row of INDEX_BOARD) {
        try {
          const data = await api.marketOhlc(row.symbol, "1D", ac.signal);
          if (data.candles?.length) next[row.symbol] = data.candles;
        } catch {
          /* keep empty spark */
        }
      }
      if (!ac.signal.aborted) setSeries(next);
    })();
    return () => ac.abort();
  }, []);

  const heat = useMemo(() => {
    return watchlist
      .map((sym) => ({ sym, q: quotes.get(sym), meta: findSymbol(sym) }))
      .filter((row) => row.meta.assetClass === "stock" || row.meta.assetClass === "etf" || row.meta.assetClass === "index");
  }, [quotes, watchlist]);

  const gainers = useMemo(() => {
    return [...quotes.values()]
      .filter((q) => Number.isFinite(q.changePct))
      .sort((a, b) => b.changePct - a.changePct)
      .slice(0, 6);
  }, [quotes]);

  const tape = useMemo(() => {
    return [...quotes.values()]
      .filter((q) => q.last > 0)
      .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))
      .slice(0, 8);
  }, [quotes]);

  return (
    <section className="markets-board" aria-label="Markets">
      <div className="board-row">
        <article className="board-card">
          <header>
            <h2>Indexes</h2>
          </header>
          <div className="board-indexes">
            {INDEX_BOARD.map((row) => {
              const q = quotes.get(row.symbol);
              const up = (q?.changePct || 0) >= 0;
              return (
                <button key={row.symbol} type="button" className="idx-chip" onClick={() => onPick(row.symbol)}>
                  <span className="idx-name">{row.label}</span>
                  <span className={`idx-px ${up ? "up" : "down"}`}>{q ? px(q.last) : "—"}</span>
                  <span className={up ? "up" : "down"}>{q ? pct(q.changePct) : ""}</span>
                </button>
              );
            })}
          </div>
          <div className="board-sparks">
            {INDEX_BOARD.slice(0, 3).map((row) => {
              const q = quotes.get(row.symbol);
              return <Spark key={row.symbol} candles={series[row.symbol] || []} up={(q?.changePct || 0) >= 0} />;
            })}
          </div>
        </article>
        <article className="board-card">
          <header>
            <h2>India board</h2>
          </header>
          <p className="muted">NSE / BSE session — this desk does not plot a world map.</p>
          <div className="india-bubbles">
            {INDEX_BOARD.map((row, i) => {
              const q = quotes.get(row.symbol);
              const up = (q?.changePct || 0) >= 0;
              return (
                <button
                  key={row.symbol}
                  type="button"
                  className={`bubble b${i} ${up ? "up" : "down"}`}
                  onClick={() => onPick(row.symbol)}
                >
                  <b>{row.label}</b>
                  <span>{q ? pct(q.changePct) : "—"}</span>
                </button>
              );
            })}
          </div>
        </article>
      </div>
      <div className="board-row three">
        <article className="board-card">
          <header>
            <h2>Heat Map</h2>
          </header>
          <div className="heat-grid">
            {heat.length === 0 ? (
              <p className="muted">Add stocks to the watchlist to fill the map.</p>
            ) : (
              heat.map((row) => (
                <button
                  key={row.sym}
                  type="button"
                  className="heat-cell"
                  style={{ background: heatColor(row.q?.changePct || 0) }}
                  onClick={() => onPick(row.sym)}
                >
                  <b>{row.sym}</b>
                  <span>{row.q ? pct(row.q.changePct) : "—"}</span>
                </button>
              ))
            )}
          </div>
        </article>
        <article className="board-card">
          <header>
            <h2>Tape</h2>
          </header>
          <p className="muted">Movers on this desk from live quotes — not a news wire.</p>
          <ul className="tape-list">
            {tape.map((q) => {
              const meta = findSymbol(q.symbol);
              return (
                <li key={q.symbol}>
                  <button type="button" onClick={() => onPick(q.symbol)}>
                    <span>
                      <b>{meta.symbol}</b> {q.changePct >= 0 ? "up" : "down"} {pct(q.changePct)}
                    </span>
                    <span className="muted">{px(q.last)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </article>
        <article className="board-card">
          <header>
            <h2>Top Gainers</h2>
          </header>
          <table className="gainer-table">
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Name</th>
                <th>Last</th>
                <th>% Chg</th>
              </tr>
            </thead>
            <tbody>
              {gainers.map((q) => {
                const meta = findSymbol(q.symbol);
                return (
                  <tr key={q.symbol} onClick={() => onPick(q.symbol)}>
                    <td>{meta.symbol}</td>
                    <td>{meta.name}</td>
                    <td>{px(q.last)}</td>
                    <td className={q.changePct >= 0 ? "up" : "down"}>{pct(q.changePct)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </article>
      </div>
    </section>
  );
}
