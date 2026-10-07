"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { compactMoney, pct, px, signedPx, vol } from "@/lib/trading/format";
import { placeTooltip } from "@/lib/trading/tooltip";

export type TipData = {
  symbol: string;
  name: string;
  last: number;
  changePct: number;
  sector?: string;
  /** Today's move in rupees, derived from the price and percentage. Absent when it cannot be worked out. */
  dayChange?: number;
  volume?: number;
  marketCap?: number;
};

/**
 * The heat map's tooltip. It lives in a portal on the page itself, so no parent can clip it, and it is placed by
 * `placeTooltip`, which keeps it inside the window at every corner and edge. It is measured before it is shown, so it
 * never appears in one place and then jumps to another.
 */
export function HeatmapTooltip({ data, anchor }: { data: TipData; anchor: { x: number; y: number } }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const p = placeTooltip(anchor, { w: el.offsetWidth, h: el.offsetHeight }, { w: vw, h: vh });
    setPos({ left: p.left, top: p.top });
  }, [anchor, data.symbol]);
  if (typeof document === "undefined") return null;
  const up = data.changePct >= 0;
  return createPortal(
    <div ref={ref} className={`pt-heat-tip${pos ? " ready" : ""}`} style={pos ?? { left: 0, top: 0 }} role="tooltip" id="pt-heat-tip">
      <strong>{data.name}</strong>
      <span className="sub">
        {data.symbol}
        {data.sector ? ` · ${data.sector}` : ""}
      </span>
      <b className="mono">{px(data.last)}</b>
      <i className={up ? "up" : "down"}>
        {up ? "▲" : "▼"} {pct(data.changePct)}
      </i>
      <dl>
        {data.dayChange != null && Number.isFinite(data.dayChange) ? (
          <div>
            <dt>Day change</dt>
            <dd className={up ? "up" : "down"}>{signedPx(data.dayChange)}</dd>
          </div>
        ) : null}
        {data.volume ? (
          <div>
            <dt>Volume</dt>
            <dd>{vol(data.volume)}</dd>
          </div>
        ) : null}
        {data.marketCap ? (
          <div>
            <dt>Market cap</dt>
            <dd>{compactMoney(data.marketCap)}</dd>
          </div>
        ) : null}
      </dl>
      <em>Click to trade →</em>
    </div>,
    document.body,
  );
}
