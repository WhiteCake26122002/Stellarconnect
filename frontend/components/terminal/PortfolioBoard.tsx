"use client";

import { useState } from "react";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { equity, invested, unrealized } from "@/lib/trading/engine";
import type { EngineState } from "@/lib/trading/engine";
import { inr, pct, px, signedInr } from "@/lib/trading/format";
import { findSymbol } from "@/lib/trading/universe";
import type { Quote } from "@/lib/trading/types";
import { DeskMark } from "./DeskMark";
import { HoldingsPie } from "./HoldingsPie";
import { PnlHistoryChart, PnlSpark, PositionPnlChart, PracticeStrip } from "./PnlCharts";
import { positionSeries, type PnlSample } from "./usePnlSession";

const money0 = (v: number) => inr(v, 0);
const signed0 = (v: number) => signedInr(v, 0);

export function PortfolioBoard({
  engine,
  quotes,
  dayPnl,
  samples,
  cheer,
  onPick,
}: {
  engine: EngineState;
  quotes: Map<string, Quote>;
  dayPnl: number;
  samples: PnlSample[];
  cheer: boolean;
  onPick: (symbol: string) => void;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const eq = equity(engine, quotes);
  const cash = engine.account.cash;
  const open = engine.positions.filter((p) => p.status !== "closed");
  const totalPnl = eq - engine.account.startingBalance;
  const focusId = [hover, pinned].find((id) => id && open.some((p) => p.id === id)) ?? open[0]?.id ?? null;
  const focus = open.find((p) => p.id === focusId) ?? null;

  return (
    <div className="board-page port-page">
      <header className="board-head">
        <div>
          <h1>Portfolio</h1>
          <p>Cash and holdings. Hover a slice or a row to match them up; click a name to open its chart.</p>
        </div>
      </header>
      <dl className="port-strip" aria-label="Portfolio totals">
        <div>
          <dt>Equity</dt>
          <dd>
            <AnimatedNumber value={eq} format={money0} />
          </dd>
        </div>
        <div>
          <dt>Cash</dt>
          <dd>
            <AnimatedNumber value={cash} format={money0} />
          </dd>
        </div>
        <div>
          <dt>Invested</dt>
          <dd>
            <AnimatedNumber value={invested(engine)} format={money0} />
          </dd>
        </div>
        <div className={cheer ? "cheer" : undefined}>
          <dt>Day P&L</dt>
          <dd className={dayPnl >= 0 ? "up" : "down"}>
            <AnimatedNumber value={dayPnl} format={signed0} />
          </dd>
        </div>
        <div>
          <dt>Total P&L</dt>
          <dd className={totalPnl >= 0 ? "up" : "down"}>
            <AnimatedNumber value={totalPnl} format={signed0} />
          </dd>
        </div>
      </dl>
      <PracticeStrip trades={engine.trades} orders={engine.orders} />
      <div className="port-visuals">
        <HoldingsPie positions={engine.positions} quotes={quotes} cash={cash} onPick={onPick} hover={hover} onHover={setHover} />
        <PnlHistoryChart samples={samples} />
      </div>
      {open.length ? (
        <>
          <table className="term-table port-table">
            <thead>
              <tr>
                {["Symbol", "Side", "Qty", "Avg", "Last", "P&L", "P&L %", "Session"].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody onMouseLeave={() => setHover(null)}>
              {open.map((p) => {
                const last = quotes.get(p.symbol)?.last ?? p.avgPrice;
                const pnl = unrealized(p, last);
                const name = findSymbol(p.symbol).name;
                const basis = p.avgPrice * p.qty;
                const on = hover === p.id;
                return (
                  <tr key={p.id} className={`${on ? "on" : ""} ${focusId === p.id ? "focus" : ""}`.trim() || undefined} onMouseEnter={() => setHover(p.id)}>
                    <td>
                      <span className="pos-id">
                        <DeskMark info={findSymbol(p.symbol)} size={20} />
                        <button type="button" className="linkish" onClick={() => onPick(p.symbol)} onFocus={() => setHover(p.id)}>
                          {name}
                        </button>
                      </span>
                    </td>
                    <td>{p.side.toUpperCase()}</td>
                    <td>{p.qty}</td>
                    <td>{px(p.avgPrice)}</td>
                    <td>{px(last)}</td>
                    <td className={pnl >= 0 ? "up" : "down"}>
                      <AnimatedNumber value={pnl} format={(v) => signedInr(v)} />
                    </td>
                    <td className={pnl >= 0 ? "up" : "down"}>{basis ? pct(pnl / basis) : "—"}</td>
                    <td>
                      <button
                        type="button"
                        className="spark-btn"
                        aria-pressed={pinned === p.id}
                        aria-label={`Show the session P&L chart for ${name}`}
                        onClick={() => setPinned((cur) => (cur === p.id ? null : p.id))}
                        onFocus={() => setHover(p.id)}
                      >
                        <PnlSpark points={positionSeries(samples, p.id)} label={name} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {focus ? (
            <PositionPnlChart
              name={findSymbol(focus.symbol).name}
              points={positionSeries(samples, focus.id)}
              basis={focus.avgPrice * focus.qty}
            />
          ) : null}
        </>
      ) : (
        <div className="board-empty-note">
          <strong>No open positions</strong>
          <p>Buy something from the chart to see live P&L, allocation and streaks here.</p>
        </div>
      )}
    </div>
  );
}
