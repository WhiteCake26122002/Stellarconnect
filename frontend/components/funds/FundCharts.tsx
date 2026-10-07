"use client";

import { useId, useMemo, useState } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { FundAnalysis } from "@/lib/api";
import { longDate, rupees, rupeesCompact, shortDate } from "@/lib/funds/format";
import { useReducedMotion } from "@/lib/motion";
import { GRID, MUTED } from "./chartTheme";

const SERIES = [
  { key: "portfolio", label: "Your portfolio value", color: "#727272" },
  { key: "invested", label: "Money you put in (net)", color: "#8a8a8a" },
  { key: "n50", label: "Nifty 50, same rupees and dates", color: "#4a4a4a" },
  { key: "n500", label: "Nifty 500, same rupees and dates", color: "#626262" },
] as const;

const RANGES = [
  { id: "1M", days: 30 },
  { id: "6M", days: 182 },
  { id: "1Y", days: 365 },
  { id: "3Y", days: 1095 },
  { id: "All", days: null },
] as const;
type RangeId = (typeof RANGES)[number]["id"];

type Row = {
  t: number;
  date: string;
  portfolio: number | null;
  invested: number | null;
  n50: number | null;
  n500: number | null;
  /** Value minus net money put in: the profit so far, which new purchases cannot move. */
  profit: number | null;
};

function signed(v: number, body: string): string {
  return v > 0 ? `+${body}` : v < 0 ? `−${body}` : body;
}

function gradientId(raw: string) {
  return `g${raw.replace(/[^a-zA-Z0-9_-]/g, "")}`;
}

/** Skeleton used while /v1/funds/analysis is in flight, so the chart area never renders blank. */
export function ChartSkeleton({ title, height = 260 }: { title: string; height?: number }) {
  return (
    <section className="card fund-chart-card" aria-busy="true" aria-label={`${title}, loading`}>
      <h2>{title}</h2>
      <div className="skel skel-line" style={{ width: "40%", marginTop: "0.6rem" }} />
      <div className="skel fund-skel-plot" style={{ height }} />
    </section>
  );
}

/**
 * Portfolio value over time against the two index benchmarks, from the weekly `growth` series the
 * analysis endpoint returns. The range buttons slice that series client-side.
 */
export function ValueChart({ growth, blocked = [] }: { growth: FundAnalysis["growth"]; blocked?: readonly string[] }) {
  const reduce = useReducedMotion();
  const gid = gradientId(useId());
  const all = useMemo<Row[]>(() => {
    const rows = growth
      .map((p) => ({
        t: new Date(`${p.date}T00:00:00`).getTime(),
        date: p.date,
        portfolio: p.portfolio,
        invested: p.invested ?? null,
        n50: p.benchmarks["NIFTY 50"] ?? null,
        n500: p.benchmarks["NIFTY 500"] ?? null,
        profit: p.portfolio != null && p.invested != null ? p.portfolio - p.invested : null,
      }))
      .filter((r) => Number.isFinite(r.t))
      .sort((a, b) => a.t - b.t);
    return rows;
  }, [growth]);

  const latest = all.length ? all[all.length - 1].t : 0;
  const first = all.length ? all[0].t : 0;
  const slice = (days: number | null) => (days == null ? all : all.filter((r) => r.t >= latest - days * 86400000));
  const usable = (days: number | null) => {
    if (days == null) return all.length >= 2;
    return first <= latest - days * 86400000 && slice(days).length >= 2;
  };
  const [range, setRange] = useState<RangeId>(() => (usable(365) ? "1Y" : "All"));
  const picked = RANGES.find((r) => r.id === range) ?? RANGES[RANGES.length - 1];
  const rows = usable(picked.days) ? slice(picked.days) : all;

  if (blocked.includes("growth")) {
    return (
      <section className="card fund-chart-card">
        <h2>Value over time</h2>
        <p className="muted">Withheld: the chart ended at a different value from the portfolio total, so it is not drawn until the two agree.</p>
      </section>
    );
  }

  if (all.length < 2) {
    return (
      <section className="card fund-chart-card">
        <h2>Value over time</h2>
        <p className="muted">A path appears once a holding has at least a week of NAV history after its purchase date.</p>
      </section>
    );
  }

  // Gain made inside this range. New purchases raise value and net money in by the same amount, so
  // they cancel; dividing value-at-end by value-at-start instead would read new money as return.
  const startRow = rows.find((r) => r.profit != null);
  const endRow = [...rows].reverse().find((r) => r.profit != null);
  const moved = startRow && endRow ? (endRow.profit as number) - (startRow.profit as number) : null;
  const base = startRow && endRow ? (startRow.portfolio as number) + ((endRow.invested as number) - (startRow.invested as number)) : null;
  const movedPct = moved != null && base && base > 0 ? (moved / base) * 100 : null;
  const addedInRange = startRow && endRow ? (endRow.invested as number) - (startRow.invested as number) : 0;
  const hasN50 = rows.some((r) => r.n50 != null);
  const hasN500 = rows.some((r) => r.n500 != null);

  return (
    <section className="card fund-chart-card" aria-label="Portfolio value over time">
      <div className="fund-chart-head">
        <div>
          <h2>Value over time</h2>
          <p className="muted">
            Your value against the money you put in; the gap between the lines is gain or loss, and a purchase lifts both together.{" "}
            {moved != null ? (
              <>
                Gain made in this range:{" "}
                <strong className={moved >= 0 ? "bull" : "bear"}>
                  {signed(moved, rupees(Math.abs(moved)))}
                  {movedPct != null ? ` (${signed(movedPct, `${Math.abs(movedPct).toFixed(2)}%`)})` : ""}
                </strong>
                {addedInRange > 1 ? <> after setting aside {rupees(addedInRange, 0)} of new money.</> : "."}
              </>
            ) : null}
          </p>
        </div>
        <div className="fund-range" role="group" aria-label="Time range">
          {RANGES.map((r) => {
            const ok = usable(r.days);
            return (
              <button
                key={r.id}
                type="button"
                aria-pressed={range === r.id}
                disabled={!ok}
                title={ok ? undefined : "Not enough history for this range yet"}
                onClick={() => setRange(r.id)}
              >
                {r.id}
              </button>
            );
          })}
        </div>
      </div>
      <div className="fund-plot">
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={rows} margin={{ top: 8, right: 10, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#727272" stopOpacity={0.24} />
                <stop offset="100%" stopColor="#727272" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={["dataMin", "dataMax"]}
              tickFormatter={shortDate}
              tick={{ fontSize: 11, fill: MUTED }}
              axisLine={false}
              tickLine={false}
              minTickGap={36}
            />
            <YAxis
              tickFormatter={rupeesCompact}
              tick={{ fontSize: 11, fill: MUTED }}
              axisLine={false}
              tickLine={false}
              width={68}
              domain={["auto", "auto"]}
            />
            <Tooltip
              cursor={{ stroke: MUTED, strokeDasharray: "3 3" }}
              content={({ active, payload }) => {
                const row = active ? (payload?.[0]?.payload as Row | undefined) : undefined;
                if (!row) return null;
                return (
                  <div className="fund-tip">
                    <strong>{longDate(row.t)}</strong>
                    <span>
                      Value <b>{row.portfolio == null ? "n/a" : rupees(row.portfolio)}</b>
                    </span>
                    {row.invested != null ? (
                      <span>
                        Money put in <b>{rupees(row.invested)}</b>
                      </span>
                    ) : null}
                    {row.profit != null ? (
                      <span>
                        Gain so far{" "}
                        <b className={row.profit >= 0 ? "bull" : "bear"}>{signed(row.profit, rupees(Math.abs(row.profit)))}</b>
                      </span>
                    ) : null}
                    {row.n50 != null ? (
                      <span>
                        Nifty 50 <b>{rupees(row.n50)}</b>
                      </span>
                    ) : null}
                    {row.n500 != null ? (
                      <span>
                        Nifty 500 <b>{rupees(row.n500)}</b>
                      </span>
                    ) : null}
                  </div>
                );
              }}
            />
            <Area
              type="monotone"
              dataKey="portfolio"
              name="Your portfolio"
              stroke="#727272"
              strokeWidth={2.2}
              fill={`url(#${gid})`}
              dot={false}
              activeDot={{ r: 4, stroke: "#fff", strokeWidth: 2 }}
              connectNulls={false}
              isAnimationActive={!reduce}
              animationDuration={450}
            />
            <Line type="stepAfter" dataKey="invested" stroke="#8a8a8a" strokeWidth={1.4} strokeDasharray="5 4" dot={false} activeDot={{ r: 3 }} isAnimationActive={!reduce} animationDuration={450} />
            {hasN50 ? (
              <Line type="monotone" dataKey="n50" stroke="#4a4a4a" strokeWidth={1.6} dot={false} activeDot={{ r: 3 }} isAnimationActive={!reduce} animationDuration={450} />
            ) : null}
            {hasN500 ? (
              <Line type="monotone" dataKey="n500" stroke="#626262" strokeWidth={1.6} dot={false} activeDot={{ r: 3 }} isAnimationActive={!reduce} animationDuration={450} />
            ) : null}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <ul className="alloc-legend">
        {SERIES.filter((s) => s.key === "portfolio" || s.key === "invested" || (s.key === "n50" ? hasN50 : hasN500)).map((s) => (
          <li key={s.key}>
            <i style={{ background: s.color }} />
            <span>{s.label}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
