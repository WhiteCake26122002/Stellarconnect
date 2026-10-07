"use client";

import { useEffect, useRef } from "react";
import { useReducedMotion } from "@/lib/motion";
import { Scene, type SceneId } from "@/components/home/cinema/Scenes";

/** The small drawing in a desk header. It wipes in from the left, then drifts a few pixels against the pointer, and its
 *  corner marks drift the other way, so it reads as sitting in front of the page. Still under reduced motion. */
export function DeskFigure({ scene, label }: { scene: SceneId; label: string }) {
  const reduce = useReducedMotion();
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (reduce) return;
    const el = root.current;
    if (!el) return;
    let frame = 0;
    const move = (e: PointerEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        const x = Math.max(-1.5, Math.min(1.5, ((e.clientX - (r.left + r.width / 2)) / window.innerWidth) * 2));
        const y = Math.max(-1.5, Math.min(1.5, ((e.clientY - (r.top + r.height / 2)) / window.innerHeight) * 2));
        el.style.setProperty("--mx", x.toFixed(3));
        el.style.setProperty("--my", y.toFixed(3));
      });
    };
    window.addEventListener("pointermove", move, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", move);
    };
  }, [reduce]);
  return (
    <div className="dk-fig" ref={root}>
      <Scene id={scene} label={label} />
    </div>
  );
}
