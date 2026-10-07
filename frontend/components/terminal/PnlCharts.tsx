"use client";

import { useEffect, useId, useState } from "react";
import { Area, AreaChart, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useReducedMotion } from "@/lib/motion";
import { pct, signedInr } from "@/lib/trading/format";
import type { Order, Trade } from "@/lib/trading/types";
import type { PnlSample } from "./usePnlSession";

const UP_FILL = "#3dd68c";
const DOWN_FILL = "#f07178";
const UP_LINE = "#1c8a55";
const DOWN_LINE = "#d94f5c";
const MUTED = "#6a6a6a";
const GRID = "rgba(17, 17, 17, 0.07)";
export const WEEKLY_PRACTICE_GOAL = 10;

type Pt = { t: number; v: number };

function safeId(raw: string) {
  return `p${raw.replace(/[^a-zA-Z0-9_-]/g, "")}`;
}

/** Fraction of the plot height that sits above zero, for a gradient that flips green → red at 0. */
function zeroOffset(values: number[]) {
  const max = Math.max(...values);
  const min = Math.min(...values);
  if (max <= 0) return 0;
  if (min >= 0) return 1;
  return max / (max - min);
}

/** SVG drops objectBoundingBox gradients on a zero-height path, so a flat line needs a solid stroke. */
function strokeFor(id: string, values: number[]) {
  const off = zeroOffset(values);
  if (off > 0 && off < 1) return `url(#${id})`;
  return off === 0 ? DOWN_LINE : UP_LINE;
}

function SplitGradient({ id, values, stroke }: { id: string; values: number[]; stroke?: boolean }) {
  const off = zeroOffset(values);
  return (
    <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
      <stop offset={0} stopColor={stroke ? UP_LINE : UP_FILL} stopOpacity={stroke ? 1 : 0.34} />
      <stop offset={off} stopColor={stroke ? UP_LINE : UP_FILL} stopOpacity={stroke ? 1 : 0.06} />
      <stop offset={off} stopColor={stroke ? DOWN_LINE : DOWN_FILL} stopOpacity={stroke ? 1 : 0.06} />
      <stop offset={1} stopColor={stroke ? DOWN_LINE : DOWN_FILL} stopOpacity={stroke ? 1 : 0.34} />
    </linearGradient>
  );
}

const clock = (t: number) => new Date(t).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
const clockSec = (t: number) => new Date(t).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

function compactSigned(v: number) {
  const abs = Math.abs(v);
  const sign = v > 0 ? "+" : v < 0 ? "−" : "";
  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(1)}Cr`;
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(1)}L`;
  if (abs >= 1e3) return `${sign}₹${(abs / 1e3).toFixed(1)}k`;
  return `${sign}₹${abs.toFixed(0)}`;
}

/** Tiny session P&L trend for a table row. Fixed size so rows never reflow as data arrives. */
export function PnlSpark({ points, label }: { points: Pt[]; label: string }) {
  const id = safeId(useId());
  if (points.length < 2) {
    return (
      <span className="pnl-spark empty" title="Draws after two live price updates">
        collecting…
      </span>
    );
  }
  const values = points.map((p) => p.v);
  const last = values[values.length - 1];
  return (
    <span className="pnl-spark" role="img" aria-label={`${label}: session P&L from ${signedInr(values[0], 0)} to ${signedInr(last, 0)}`}>
      <AreaChart width={96} height={26} data={points} margin={{ top: 2, right: 1, bottom: 2, left: 1 }}>
        <defs>
          <SplitGradient id={`${id}f`} values={values} />
          <SplitGradient id={`${id}s`} values={values} stroke />
        </defs>
        <YAxis hide domain={[(min: number) => Math.min(0, min), (max: number) => Math.max(0, max)]} />
        <ReferenceLine y={0} stroke={MUTED} strokeOpacity={0.35} strokeDasharray="2 2" />
        <Area type="linear" dataKey="v" baseValue={0} stroke={strokeFor(`${id}s`, values)} strokeWidth={1.4} fill={`url(#${id}f)`} dot={false} isAnimationActive={false} />
      </AreaChart>
    </span>
  );
}

/** Larger live P&L chart for one position. */
export function PositionPnlChart({ name, points, basis }: { name: string; points: Pt[]; basis: number }) {
  const id = safeId(useId());
  if (points.length < 2) {
    return (
      <section className="pnl-card" aria-label={`${name} session P&L`}>
        <header>
          <h2>{name} · session P&L</h2>
        </header>
        <div className="pnl-empty">
          <span className="live-dot" aria-hidden />
          Recording. The line starts after two live price updates (the feed refreshes every 20 seconds).
        </div>
      </section>
    );
  }
  const values = points.map((p) => p.v);
  const last = values[values.length - 1];
  return (
    <section className="pnl-card" aria-label={`${name} session P&L`}>
      <header>
        <h2>{name} · session P&L</h2>
        <b className={last >= 0 ? "up" : "down"}>
          {signedInr(last)} {basis ? <em>{pct(last / basis)}</em> : null}
        </b>
      </header>
      <ResponsiveContainer width="100%" height={170}>
        <AreaChart data={points} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <SplitGradient id={`${id}f`} values={values} />
            <SplitGradient id={`${id}s`} values={values} stroke />
          </defs>
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={clock} tick={{ fontSize: 10, fill: MUTED }} axisLine={false} tickLine={false} minTickGap={40} />
          <YAxis tickFormatter={compactSigned} tick={{ fontSize: 10, fill: MUTED }} axisLine={false} tickLine={false} width={58} domain={[(min: number) => Math.min(0, min), (max: number) => Math.max(0, max)]} />
          <ReferenceLine y={0} stroke={MUTED} strokeOpacity={0.45} />
          <Tooltip
            cursor={{ stroke: MUTED, strokeDasharray: "3 3" }}
            content={({ active, payload }) => {
              const row = active ? (payload?.[0]?.payload as Pt | undefined) : undefined;
              if (!row) return null;
              return (
                <div className="pnl-tip">
                  <strong>{clockSec(row.t)}</strong>
                  <span>
                    P&L <b className={row.v >= 0 ? "up" : "down"}>{signedInr(row.v)}</b>
                  </span>
                  {basis ? (
                    <span>
                      Return <b>{pct(row.v / basis)}</b>
                    </span>
                  ) : null}
                </div>
              );
            }}
          />
          <Area type="linear" dataKey="v" baseValue={0} stroke={strokeFor(`${id}s`, values)} strokeWidth={1.8} fill={`url(#${id}f)`} dot={false} activeDot={{ r: 3.5 }} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </section>
  );
}

/** Day P&L across this session, split into realized (closed today) and unrealized (open). */
export function PnlHistoryChart({ samples, height = 190, compact }: { samples: PnlSample[]; height?: number; compact?: boolean }) {
  const id = safeId(useId());
  if (samples.length < 2) {
    return (
      <section className={`pnl-card ${compact ? "compact" : ""}`} aria-label="P&L history this session">
        <header>
          <h2>P&L this session</h2>
        </header>
        <div className="pnl-empty">
          <span className="live-dot" aria-hidden />
          Recording. Each live price update (every 20 seconds while this tab is open) adds a point.
        </div>
      </section>
    );
  }
  const values = samples.map((s) => s.day);
  const last = samples[samples.length - 1];
  return (
    <section className={`pnl-card ${compact ? "compact" : ""}`} aria-label="P&L history this session">
      <header>
        <h2>P&L this session</h2>
        <b className={last.day >= 0 ? "up" : "down"}>Day {signedInr(last.day, 0)}</b>
      </header>
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={samples} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <SplitGradient id={`${id}f`} values={values} />
            <SplitGradient id={`${id}s`} values={values} stroke />
          </defs>
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={clock} tick={{ fontSize: 10, fill: MUTED }} axisLine={false} tickLine={false} minTickGap={40} />
          <YAxis tickFormatter={compactSigned} tick={{ fontSize: 10, fill: MUTED }} axisLine={false} tickLine={false} width={58} />
          <ReferenceLine y={0} stroke={MUTED} strokeOpacity={0.45} />
          <Tooltip
            cursor={{ stroke: MUTED, strokeDasharray: "3 3" }}
            content={({ active, payload }) => {
              const row = active ? (payload?.[0]?.payload as PnlSample | undefined) : undefined;
              if (!row) return null;
              return (
                <div className="pnl-tip">
                  <strong>{clockSec(row.t)}</strong>
                  <span>
                    Day P&L <b className={row.day >= 0 ? "up" : "down"}>{signedInr(row.day)}</b>
                  </span>
                  <span>
                    Realized today <b>{signedInr(row.realized)}</b>
                  </span>
                  <span>
                    Unrealized <b>{signedInr(row.unrealized)}</b>
                  </span>
                </div>
              );
            }}
          />
          <Area type="linear" dataKey="day" name="Day P&L" baseValue={0} stroke={strokeFor(`${id}s`, values)} strokeWidth={1.8} fill={`url(#${id}f)`} dot={false} activeDot={{ r: 3.5 }} isAnimationActive={false} />
          <Line type="stepAfter" dataKey="realized" name="Realized today" stroke="#aaaaaa" strokeWidth={1.3} dot={false} isAnimationActive={false} />
          <Line type="linear" dataKey="unrealized" name="Unrealized" stroke="#4a4a4a" strokeWidth={1.3} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
      <ul className="pnl-legend">
        <li>
          <i className="swatch-day" aria-hidden /> Day P&L
        </li>
        <li>
          <i style={{ background: "#aaaaaa" }} aria-hidden /> Realized today
        </li>
        <li>
          <i className="swatch-dash" aria-hidden /> Unrealized
        </li>
        <li className="muted">This tab only; resets on reload.</li>
      </ul>
    </section>
  );
}

function startOfWeek(now = new Date()) {
  const d = new Date(now);
  const day = (d.getDay() + 6) % 7;
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - day);
  return d.getTime();
}

/** Win streak and weekly practice progress, derived from the trades and orders already saved in this browser. */
export function PracticeStrip({ trades, orders }: { trades: Trade[]; orders: Order[] }) {
  let streak = 0;
  for (const t of trades) {
    if (t.pnl > 0) streak += 1;
    else break;
  }
  const weekStart = startOfWeek();
  const thisWeek = orders.filter((o) => o.status === "filled" && o.time >= weekStart).length;
  const progress = Math.min(1, thisWeek / WEEKLY_PRACTICE_GOAL);
  const last = trades[0];
  const hot = streak >= 3;
  return (
    <section className="practice" aria-label="Practice progress">
      <div className={`streak ${hot ? "hot" : streak ? "warm" : ""}`}>
        <span className="streak-n">{streak}</span>
        <span>
          <strong>{streak === 1 ? "win in a row" : "wins in a row"}</strong>
          <em>
            {!last
              ? "Close a trade to start a streak."
              : hot
                ? "Hot streak. Keep the same discipline."
                : streak
                  ? `${3 - streak} more for a hot streak.`
                  : "Last close was not a win. The streak restarts on the next winner."}
          </em>
        </span>
      </div>
      <div className="goal">
        <div className="goal-top">
          <strong>Weekly practice</strong>
          <span>
            {thisWeek} of {WEEKLY_PRACTICE_GOAL} trades
          </span>
        </div>
        <div
          className="goal-bar"
          role="progressbar"
          aria-label="Trades placed this week"
          aria-valuemin={0}
          aria-valuemax={WEEKLY_PRACTICE_GOAL}
          aria-valuenow={Math.min(thisWeek, WEEKLY_PRACTICE_GOAL)}
        >
          <i style={{ transform: `scaleX(${progress})` }} className={progress >= 1 ? "done" : ""} />
        </div>
        <em>{progress >= 1 ? "Goal met for this week." : "Filled orders since Monday."}</em>
      </div>
    </section>
  );
}

const PARTICLES = Array.from({ length: 14 }, (_, i) => {
  const angle = (i / 14) * Math.PI * 2;
  const dist = 26 + (i % 3) * 10;
  return {
    dx: Math.cos(angle) * dist,
    dy: Math.sin(angle) * dist - 10,
    rot: (i * 47) % 360,
    color: ["#111111", "#777777", "#aaaaaa", "#555555"][i % 4],
  };
});

/** Short confetti burst anchored to its parent. Re-fires whenever `burst` changes; skipped for reduced motion. */
export function Confetti({ burst }: { burst: number }) {
  const reduce = useReducedMotion();
  const [live, setLive] = useState(0);
  useEffect(() => {
    if (!burst || reduce) return;
    setLive(burst);
    const t = window.setTimeout(() => setLive(0), 1000);
    return () => window.clearTimeout(t);
  }, [burst, reduce]);
  if (!live) return null;
  return (
    <span className="confetti" aria-hidden key={live}>
      {PARTICLES.map((p, i) => (
        <i
          key={i}
          style={
            {
              background: p.color,
              "--dx": `${p.dx}px`,
              "--dy": `${p.dy}px`,
              "--rot": `${p.rot}deg`,
            } as React.CSSProperties
          }
        />
      ))}
    </span>
  );
}
