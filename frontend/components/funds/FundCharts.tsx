"use client";

import { useId, useMemo, useState } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { FundAnalysis } from "@/lib/api";
import { longDate, rupees, rupeesCompact, shortDate } from "@/lib/funds/format";
import { useReducedMotion } from "@/lib/motion";
import { GRID, MUTED } from "./chartTheme";

const SERIES = [
  { key: "portfolio", label: "Your portfolio", color: "#0b9e96" },
  { key: "n50", label: "Nifty 50, same rupees and dates", color: "#3b6fbf" },
  { key: "n500", label: "Nifty 500, same rupees and dates", color: "#b8860b" },
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
  n50: number | null;
  n500: number | null;
  change: number | null;
  changePct: number | null;
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
export function ValueChart({ growth }: { growth: FundAnalysis["growth"] }) {
  const reduce = useReducedMotion();
  const gid = gradientId(useId());
  const all = useMemo<Row[]>(() => {
    const rows = growth
      .map((p) => ({
        t: new Date(`${p.date}T00:00:00`).getTime(),
        date: p.date,
        portfolio: p.portfolio,
        n50: p.benchmarks["NIFTY 50"] ?? null,
        n500: p.benchmarks["NIFTY 500"] ?? null,
        change: null as number | null,
        changePct: null as number | null,
      }))
      .filter((r) => Number.isFinite(r.t))
      .sort((a, b) => a.t - b.t);
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1].portfolio;
      const cur = rows[i].portfolio;
      if (prev != null && cur != null) {
        rows[i].change = cur - prev;
        rows[i].changePct = prev ? ((cur - prev) / prev) * 100 : null;
      }
    }
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

  if (all.length < 2) {
    return (
      <section className="card fund-chart-card">
        <h2>Value over time</h2>
        <p className="muted">A path appears once a holding has at least a week of NAV history after its purchase date.</p>
      </section>
    );
  }

  const start = rows.find((r) => r.portfolio != null)?.portfolio ?? null;
  const end = [...rows].reverse().find((r) => r.portfolio != null)?.portfolio ?? null;
  const moved = start != null && end != null ? end - start : null;
  const movedPct = moved != null && start ? (moved / start) * 100 : null;
  const hasN50 = rows.some((r) => r.n50 != null);
  const hasN500 = rows.some((r) => r.n500 != null);

  return (
    <section className="card fund-chart-card" aria-label="Portfolio value over time">
      <div className="fund-chart-head">
        <div>
          <h2>Value over time</h2>
          <p className="muted">
            Weekly marks from each scheme&apos;s AMFI NAV.{" "}
            {moved != null ? (
              <>
                Over this range:{" "}
                <strong className={moved >= 0 ? "bull" : "bear"}>
                  {signed(moved, rupees(Math.abs(moved)))}
                  {movedPct != null ? ` (${signed(movedPct, `${Math.abs(movedPct).toFixed(2)}%`)})` : ""}
                </strong>
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
                <stop offset="0%" stopColor="#0b9e96" stopOpacity={0.24} />
                <stop offset="100%" stopColor="#0b9e96" stopOpacity={0} />
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
                    {row.change != null ? (
                      <span>
                        Since last mark{" "}
                        <b className={row.change >= 0 ? "bull" : "bear"}>
                          {signed(row.change, rupees(Math.abs(row.change)))}
                          {row.changePct != null ? ` (${signed(row.changePct, `${Math.abs(row.changePct).toFixed(2)}%`)})` : ""}
                        </b>
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
              stroke="#0b9e96"
              strokeWidth={2.2}
              fill={`url(#${gid})`}
              dot={false}
              activeDot={{ r: 4, stroke: "#fff", strokeWidth: 2 }}
              connectNulls={false}
              isAnimationActive={!reduce}
              animationDuration={450}
            />
            {hasN50 ? (
              <Line type="monotone" dataKey="n50" stroke="#3b6fbf" strokeWidth={1.6} dot={false} activeDot={{ r: 3 }} isAnimationActive={!reduce} animationDuration={450} />
            ) : null}
            {hasN500 ? (
              <Line type="monotone" dataKey="n500" stroke="#b8860b" strokeWidth={1.6} dot={false} activeDot={{ r: 3 }} isAnimationActive={!reduce} animationDuration={450} />
            ) : null}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <ul className="alloc-legend">
        {SERIES.filter((s) => s.key === "portfolio" || (s.key === "n50" ? hasN50 : hasN500)).map((s) => (
          <li key={s.key}>
            <i style={{ background: s.color }} />
            <span>{s.label}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
