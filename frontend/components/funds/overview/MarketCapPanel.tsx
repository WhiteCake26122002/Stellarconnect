"use client";

import type { FundAnalysis } from "@/lib/api";
import { StackedBar, type StackSegment } from "../viz/StackedBar";
import { VIZ } from "../viz/theme";

const COLORS: Record<string, string> = {
  "Large Cap": VIZ.teal,
  "Large & Mid Cap": "#333333",
  "Mid Cap": VIZ.blue,
  "Small Cap": VIZ.purple,
  "Flexi Cap": VIZ.gold,
  "Multi Cap": "#a0a0a0",
};
const FALLBACK = [VIZ.grey, "#a9a9a9", "#c4c4c4", "#6f6f6f"];

/** The equity part of the book by fund category: large, mid, small and the funds that roam across them. */
export function MarketCapPanel({ report }: { report: FundAnalysis | null }) {
  const slices = report?.market_cap ?? [];
  if (!report) return null;
  if (!slices.length) {
    return (
      <section className="vz-section" aria-label="Market-cap exposure">
        <h2 className="vz-h">Market-cap exposure</h2>
        <p className="vz-unavailable">Unavailable: no equity fund with a live NAV.</p>
      </section>
    );
  }
  let spare = 0;
  const segments: StackSegment[] = slices.map((s) => ({
    id: s.label,
    label: s.label,
    value: s.pct,
    color: COLORS[s.label] ?? FALLBACK[spare++ % FALLBACK.length],
    valueText: `${s.pct.toFixed(s.pct < 10 ? 1 : 0)}%`,
    note: s.label === "Flexi Cap" || s.label === "Multi Cap" ? "These funds hold large, mid and small companies in a mix their manager chooses; the mix is not published here." : undefined,
  }));
  return (
    <section className="vz-section" aria-label="Market-cap exposure">
      <h2 className="vz-h">Market-cap exposure</h2>
      <p className="vz-sub">Equity funds only, by fund category</p>
      <StackedBar segments={segments} ariaLabel="Equity by market-cap category" height={26} />
      <p className="vz-hint">{report.lookthrough}</p>
    </section>
  );
}
