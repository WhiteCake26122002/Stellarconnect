"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "@/lib/motion";

/**
 * Renders `format(value)` and eases from the previous value to the new one instead of snapping.
 * Adds `num-up` / `num-down` for the length of the tween so callers can tint the change.
 */
export function AnimatedNumber({
  value,
  format,
  className,
  duration = 650,
}: {
  value: number;
  format: (n: number) => string;
  className?: string;
  duration?: number;
}) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(value);
  const [dir, setDir] = useState<"up" | "down" | null>(null);
  const from = useRef(value);

  useEffect(() => {
    const start = from.current;
    if (!Number.isFinite(value) || !Number.isFinite(start) || start === value || reduce) {
      from.current = value;
      setShown(value);
      setDir(null);
      return;
    }
    setDir(value > start ? "up" : "down");
    const began = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - began) / duration);
      const eased = 1 - (1 - k) ** 3;
      const v = start + (value - start) * eased;
      from.current = v;
      setShown(v);
      if (k < 1) raf = requestAnimationFrame(step);
      else setDir(null);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, reduce, duration]);

  const cls = [className, dir ? `num-${dir}` : ""].filter(Boolean).join(" ");
  return <span className={cls || undefined}>{format(shown)}</span>;
}
