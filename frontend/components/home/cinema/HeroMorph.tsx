"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useReducedMotion } from "@/lib/motion";
import { SCENES, type SceneId } from "./Scenes";
import { seeded } from "./useScroll";

const DESKS: { id: SceneId; n: string; name: string; line: string }[] = [
  { id: "tape", n: "01", name: "Paper trading", line: "Buy and sell at market prices with ₹10,00,000 of practice cash." },
  { id: "dcf", n: "02", name: "Private DCF", line: "Value a company from its filings and your own drivers." },
  { id: "funds", n: "03", name: "Mutual funds", line: "Mark the schemes you hold to the daily AMFI NAV." },
];

const COLS = 20;
const ROWS = 15;
const CELL = 20;
const HOLD_MS = 3400;
const DISSOLVE_MS = 1100;
// How soft each square's own flip is, as a share of the dissolve. Squares fade through their flip instead of snapping, so
// nothing flickers, and every square always shows exactly one desk: the old one fading out as the new one fades in.
const EDGE = 0.22;
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/**
 * The hero figure. It shows one desk, then every few seconds dissolves into the next through a field of squares that
 * flip in a scattered order, the way the helmet gives way to the face in the reference. The scenes are drawn in SVG and
 * the dissolve is a pair of complementary SVG masks (the incoming desk shows where a square has flipped, the outgoing
 * desk shows where it has not), so the two never overlap and there is no frame where both or neither are visible.
 * With reduced motion it simply stays on the first desk.
 */
export function HeroMorph() {
  const reduce = useReducedMotion();
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [index, setIndex] = useState(0);
  const [next, setNext] = useState<number | null>(null);
  const cellsIn = useRef<(SVGRectElement | null)[]>([]);
  const cellsOut = useRef<(SVGRectElement | null)[]>([]);
  const root = useRef<HTMLDivElement>(null);
  const thresholds = useMemo(() => {
    const rnd = seeded(5);
    return Array.from({ length: COLS * ROWS }, (_, i) => 0.66 * rnd() + 0.34 * (((i % COLS) / COLS) * 0.5 + (Math.floor(i / COLS) / ROWS) * 0.5));
  }, []);

  useEffect(() => {
    if (reduce) return;
    let raf = 0;
    let timer = 0;
    let cancelled = false;
    const run = (from: number) => {
      const to = (from + 1) % DESKS.length;
      setNext(to);
      const began = performance.now();
      const step = (now: number) => {
        const p = ease(Math.min(1, (now - began) / DISSOLVE_MS));
        for (let i = 0; i < thresholds.length; i++) {
          const v = Math.min(1, Math.max(0, (p * (1 + EDGE) - thresholds[i]) / EDGE)).toFixed(3);
          const a = cellsIn.current[i];
          const b = cellsOut.current[i];
          if (a) a.style.opacity = v;
          if (b) b.style.opacity = v;
        }
        if (now - began < DISSOLVE_MS) raf = requestAnimationFrame(step);
        else {
          if (cancelled) return;
          // The masks are cleared in the layout effect below, in the same commit that swaps the layers.
          setIndex(to);
          setNext(null);
          timer = window.setTimeout(() => run(to), HOLD_MS);
        }
      };
      raf = requestAnimationFrame(step);
    };
    timer = window.setTimeout(() => run(0), HOLD_MS);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
    };
  }, [reduce, thresholds]);

  // Once the new desk is the base layer, the masks go back to "all old" for the next dissolve. This runs before paint, so
  // there is never a frame with the base swapped but the masks still half-open.
  useLayoutEffect(() => {
    for (const el of cellsIn.current) if (el) el.style.opacity = "0";
    for (const el of cellsOut.current) if (el) el.style.opacity = "0";
  }, [index]);

  // The figure leans a little toward the pointer.
  useEffect(() => {
    if (reduce) return;
    const el = root.current;
    if (!el) return;
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      el.style.setProperty("--mx", (((e.clientX - r.left) / r.width - 0.5) * 2).toFixed(3));
      el.style.setProperty("--my", (((e.clientY - r.top) / r.height - 0.5) * 2).toFixed(3));
    };
    window.addEventListener("pointermove", move, { passive: true });
    return () => window.removeEventListener("pointermove", move);
  }, [reduce]);

  const Base = SCENES[DESKS[index].id];
  const Incoming = next != null ? SCENES[DESKS[next].id] : null;
  const shown = DESKS[index];

  return (
    <div className="cn-morph" ref={root}>
      <svg viewBox="0 0 400 300" role="img" aria-label={`${shown.name}: ${shown.line}`}>
        <defs>
          <mask id={`in${uid}`} maskUnits="userSpaceOnUse" x="-40" y="-40" width="480" height="380">
            <rect x="-40" y="-40" width="480" height="380" fill="#000" />
            {thresholds.map((_, i) => (
              <rect
                key={i}
                ref={(el) => {
                  cellsIn.current[i] = el;
                }}
                x={(i % COLS) * CELL}
                y={Math.floor(i / COLS) * CELL}
                width={CELL + 0.5}
                height={CELL + 0.5}
                fill="#fff"
                style={{ opacity: 0 }}
              />
            ))}
          </mask>
          <mask id={`out${uid}`} maskUnits="userSpaceOnUse" x="-40" y="-40" width="480" height="380">
            <rect x="-40" y="-40" width="480" height="380" fill="#fff" />
            {thresholds.map((_, i) => (
              <rect
                key={i}
                ref={(el) => {
                  cellsOut.current[i] = el;
                }}
                x={(i % COLS) * CELL}
                y={Math.floor(i / COLS) * CELL}
                width={CELL + 0.5}
                height={CELL + 0.5}
                fill="#000"
                style={{ opacity: 0 }}
              />
            ))}
          </mask>
        </defs>
        <g className="cn-morph-layer" mask={`url(#out${uid})`}>
          <Base />
        </g>
        {Incoming ? (
          <g className="cn-morph-layer" mask={`url(#in${uid})`}>
            <Incoming />
          </g>
        ) : null}
      </svg>
      <ol className="cn-morph-key" aria-label="The three desks">
        {DESKS.map((d, i) => (
          <li key={d.id} className={i === (next ?? index) ? "on" : ""}>
            <span>{d.n}</span>
            {d.name}
          </li>
        ))}
      </ol>
    </div>
  );
}
