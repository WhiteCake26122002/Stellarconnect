"use client";

import { ReactNode, useCallback, useRef, useState } from "react";

type TipState = { x: number; y: number; w: number; node: ReactNode };

/**
 * A small dark tooltip that follows the pointer inside a relatively positioned wrapper. Attach `ref` to
 * the wrapper, call `show(event, content)` from move handlers and `hide()` on leave, and render `el`.
 */
export function useTip() {
  const ref = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<TipState | null>(null);
  const show = useCallback((e: { clientX: number; clientY: number }, node: ReactNode) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    setTip({ x: e.clientX - box.left, y: e.clientY - box.top, w: box.width, node });
  }, []);
  const hide = useCallback(() => setTip(null), []);
  const el = tip ? (
    <div className="vz-tip" role="presentation" style={{ left: tip.x, top: tip.y, transform: `translate(${tip.x > tip.w * 0.62 ? "calc(-100% - 12px)" : "12px"}, -50%)` }}>
      {tip.node}
    </div>
  ) : null;
  return { ref, show, hide, el };
}

export function TipRow({ color, label, value, tone }: { color?: string; label: string; value: ReactNode; tone?: "bull" | "bear" }) {
  return (
    <span className="vz-tip-row">
      {color ? <i style={{ background: color }} /> : null}
      <span>{label}</span>
      <b className={tone}>{value}</b>
    </span>
  );
}
