"use client";

import { RefObject, useEffect, useRef } from "react";
import { useReducedMotion } from "@/lib/motion";

type Tick = () => void;

/** One scroll listener for the whole page: every scroll-driven section registers a tick and is run once per frame. */
const ticks = new Set<Tick>();
let frame = 0;
let bound = false;

function run() {
  frame = 0;
  ticks.forEach((t) => t());
}
function schedule() {
  if (!frame) frame = requestAnimationFrame(run);
}
function subscribe(t: Tick) {
  ticks.add(t);
  if (!bound) {
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    bound = true;
  }
  schedule();
  return () => {
    ticks.delete(t);
    if (!ticks.size && bound) {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      bound = false;
    }
  };
}

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * Progress of an element through the page, 0 to 1.
 *  - "pin": the element is taller than the screen and holds a sticky stage; 0 when its top reaches the top of the
 *    screen, 1 when its bottom reaches the bottom.
 *  - "pass": 0 as it enters at the bottom, 1 as it leaves at the top.
 * `apply` runs only when the value has moved, so it can write straight to the DOM without React re-rendering.
 * With reduced motion, `apply(1)` runs once: the finished state, with nothing scrubbing.
 */
export function useScrollProgress(ref: RefObject<HTMLElement | null>, apply: (p: number) => void, mode: "pin" | "pass" = "pin") {
  const reduce = useReducedMotion();
  const latest = useRef(apply);
  latest.current = apply;
  useEffect(() => {
    if (reduce) {
      latest.current(1);
      return;
    }
    let last = -1;
    const tick = () => {
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight;
      const p = mode === "pin" ? clamp01(-r.top / Math.max(1, r.height - vh)) : clamp01((vh - r.top) / Math.max(1, vh + r.height));
      if (Math.abs(p - last) < 0.0004) return;
      last = p;
      latest.current(p);
    };
    return subscribe(tick);
  }, [ref, mode, reduce]);
}

/** Linear map of `p` from [a, b] to [0, 1], clamped. A section uses it to give each effect its own slice of the scroll. */
export const slice = (p: number, a: number, b: number) => clamp01((p - a) / (b - a));

/** A small deterministic random number generator, so cell patterns are the same on every load and on the server. */
export function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
