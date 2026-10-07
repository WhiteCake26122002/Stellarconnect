"use client";

import { useEffect, useRef } from "react";
import { useReducedMotion } from "@/lib/motion";
import { clamp01, seeded } from "./useScroll";

/**
 * The checkerboard wipe between two sections. The strip starts as the colour of the section above; as it scrolls
 * through the window, squares of the next section's colour switch on in a scattered order until it is that colour
 * all over, so one section dissolves into the next. A few squares flash teal as they flip.
 */
export function PixelStrip({ from, to, accent = "#8a8a8a", height = 168, cell = 28, seed = 7 }: { from: string; to: string; accent?: string; height?: number; cell?: number; seed?: number }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const reduce = useReducedMotion();

  useEffect(() => {
    const host = wrap.current;
    const cv = canvas.current;
    if (!host || !cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    let cols = 0;
    let rows = 0;
    let thr: number[] = [];
    let last = -1;
    let raf = 0;
    const dpr = Math.min(2, window.devicePixelRatio || 1);

    const layout = () => {
      const w = host.clientWidth;
      cols = Math.ceil(w / cell);
      rows = Math.ceil(height / cell);
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(height * dpr);
      cv.style.width = `${w}px`;
      cv.style.height = `${height}px`;
      const rnd = seeded(seed);
      thr = Array.from({ length: cols * rows }, (_, i) => {
        const x = i % cols;
        const y = Math.floor(i / cols);
        // Mostly random, a little diagonal, so the wipe has a direction without looking like a sweep.
        return 0.72 * rnd() + 0.28 * ((x / cols) * 0.6 + (y / rows) * 0.4);
      });
      last = -1;
      paint(progress());
    };

    const progress = () => {
      if (reduce) return 1;
      const r = host.getBoundingClientRect();
      const vh = window.innerHeight;
      return clamp01((vh * 0.92 - r.top) / (vh * 0.62));
    };

    const paint = (p: number) => {
      const q = Math.round(p * 120) / 120;
      if (q === last) return;
      last = q;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = from;
      ctx.fillRect(0, 0, cols * cell, rows * cell);
      for (let i = 0; i < thr.length; i++) {
        const t = thr[i] * 0.86;
        const x = (i % cols) * cell;
        const y = Math.floor(i / cols) * cell;
        if (q > t + 0.14) {
          ctx.fillStyle = to;
          ctx.fillRect(x, y, cell, cell);
        } else if (q > t) {
          // a square caught mid-flip
          ctx.fillStyle = i % 9 === 0 ? accent : to;
          ctx.fillRect(x, y, cell, cell);
        }
      }
    };

    const tick = () => {
      raf = 0;
      paint(progress());
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(tick);
    };
    layout();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", layout);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", layout);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [from, to, accent, height, cell, seed, reduce]);

  return (
    <div ref={wrap} className="cn-strip" style={{ height, background: reduce ? to : from }} aria-hidden>
      <canvas ref={canvas} />
    </div>
  );
}
