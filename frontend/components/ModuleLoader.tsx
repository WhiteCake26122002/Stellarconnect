"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "@/lib/motion";
import "./module-loader.css";

export type ModuleKind = "terminal" | "funds" | "dcf";

const COPY: Record<ModuleKind, { title: string; line: string }> = {
  terminal: { title: "Paper trading", line: "Warming up the tape" },
  funds: { title: "Mutual funds", line: "Marking your book to the latest NAV" },
  dcf: { title: "Valuation models", line: "Laying out the cash flows" },
};

/** Candles that grow one after another, then a price line that draws across them. */
function TerminalArt() {
  const bars = [
    { x: 14, top: 58, h: 26, up: true },
    { x: 38, top: 50, h: 30, up: true },
    { x: 62, top: 56, h: 22, up: false },
    { x: 86, top: 44, h: 32, up: true },
    { x: 110, top: 48, h: 20, up: false },
    { x: 134, top: 36, h: 34, up: true },
    { x: 158, top: 28, h: 30, up: true },
    { x: 182, top: 34, h: 18, up: false },
    { x: 206, top: 20, h: 32, up: true },
  ];
  return (
    <svg viewBox="0 0 224 100" className="ml-art" aria-hidden>
      {bars.map((b, i) => (
        <g key={b.x} className="ml-candle" style={{ animationDelay: `${i * 90}ms` }} data-up={b.up}>
          <line x1={b.x + 6} x2={b.x + 6} y1={b.top - 8} y2={b.top + b.h + 8} />
          <rect x={b.x} y={b.top} width={12} height={b.h} rx={2} />
        </g>
      ))}
      <path className="ml-pricepath" d="M14 78 C 50 64, 70 70, 96 54 S 150 44, 170 36 S 200 22, 212 18" />
    </svg>
  );
}

/** A book of three holdings: a bar that fills, and a ring that closes. */
function FundsArt() {
  return (
    <svg viewBox="0 0 224 100" className="ml-art" aria-hidden>
      <circle className="ml-ring-track" cx="48" cy="50" r="30" />
      <circle className="ml-ring" cx="48" cy="50" r="30" pathLength={100} />
      <g className="ml-stack">
        {[
          { y: 24, w: 128, d: 0 },
          { y: 46, w: 92, d: 140 },
          { y: 68, w: 64, d: 280 },
        ].map((r) => (
          <g key={r.y}>
            <rect className="ml-slot" x="92" y={r.y} width="128" height="10" rx="5" />
            <rect className="ml-fill" x="92" y={r.y} width={r.w} height="10" rx="5" style={{ animationDelay: `${r.d}ms` }} />
          </g>
        ))}
      </g>
    </svg>
  );
}

/** A cash-flow waterfall: the steps drop in left to right and the total lands last. */
function DcfArt() {
  const steps = [
    { x: 12, y: 26, h: 54 },
    { x: 50, y: 26, h: 16 },
    { x: 88, y: 42, h: 12 },
    { x: 126, y: 54, h: 14 },
    { x: 164, y: 26, h: 54, total: true },
  ];
  return (
    <svg viewBox="0 0 224 100" className="ml-art" aria-hidden>
      <line className="ml-base" x1="6" x2="218" y1="82" y2="82" />
      {steps.map((s, i) => (
        <rect key={s.x} className="ml-step" data-total={s.total ? "true" : "false"} x={s.x} y={s.y} width={34} height={s.h} rx={3} style={{ animationDelay: `${i * 130}ms` }} />
      ))}
      <path className="ml-link" d="M46 26 H50 M84 42 H88 M122 54 H126 M160 68 H164" />
    </svg>
  );
}

export function ModuleLoader({ kind, compact = false }: { kind: ModuleKind; compact?: boolean }) {
  const { title, line } = COPY[kind];
  return (
    <div className={`ml-root${compact ? " compact" : ""}`} data-page-busy="true" role="status" aria-label={`Opening ${title}`}>
      {kind === "terminal" ? <TerminalArt /> : kind === "funds" ? <FundsArt /> : <DcfArt />}
      <p className="ml-title">{title}</p>
      <p className="ml-line">
        {line}
        <span className="ml-dots" aria-hidden>
          <i />
          <i />
          <i />
        </span>
      </p>
    </div>
  );
}

/**
 * Holds a page's content back until its loader has been on screen long enough to be seen, so a fast
 * response shows a short animation, not a flash. Pass `ready` once the data is in; the result turns
 * true after both that and the minimum time. Reduced-motion users never wait.
 */
export function useLoaderHold(ready: boolean, ms = 520): boolean {
  const reduce = useReducedMotion();
  const started = useRef<number | null>(null);
  if (started.current === null && typeof performance !== "undefined") started.current = performance.now();
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!ready) return;
    if (reduce) {
      setHeld(true);
      return;
    }
    const left = Math.max(0, ms - (performance.now() - (started.current ?? 0)));
    const t = window.setTimeout(() => setHeld(true), left);
    return () => window.clearTimeout(t);
  }, [ready, reduce, ms]);
  return ready && held;
}
