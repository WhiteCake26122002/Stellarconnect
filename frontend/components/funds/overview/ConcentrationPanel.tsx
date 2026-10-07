"use client";

import type { FundHolding } from "@/lib/api";
import { assetClass, categoryShort } from "@/lib/funds/category";
import { rupees, signedPoints } from "@/lib/funds/format";
import { concentration } from "@/lib/funds/viz";
import { HBars, type BarRow } from "../viz/HBars";
import { classColor, VIZ } from "../viz/theme";

/**
 * How much rides on a few funds. The largest funds as bars (each opens its fund), then the share held by
 * the top one, three and five so the spread is readable at a glance.
 */
export function ConcentrationPanel({ holdings }: { holdings: FundHolding[] }) {
  const c = concentration(holdings);
  if (!c) {
    return (
      <section className="vz-section" aria-label="Concentration">
        <h2 className="vz-h">Concentration</h2>
        <p className="vz-unavailable">Unavailable: no fund has a live NAV right now.</p>
      </section>
    );
  }
  const live = holdings.filter((h) => h.data_available && h.value > 0);
  const total = live.reduce((a, h) => a + h.value, 0);
  const top = [...live].sort((a, b) => b.value - a.value).slice(0, 5);
  const rows: BarRow[] = top.map((h) => ({
    id: String(h.scheme_code),
    label: h.scheme_name.replace(/\s*-\s*(Direct|Regular).*$/i, ""),
    sub: `${categoryShort(h.scheme_category)} · ${h.plan === "Unknown" ? "Plan unknown" : h.plan}`,
    value: (h.value / total) * 100,
    valueText: `${((h.value / total) * 100).toFixed(1)}%`,
    color: classColor(assetClass(h.scheme_category)),
    href: `/funds/${h.scheme_code}`,
    tip: [
      { label: "Value", value: rupees(h.value, 0) },
      ...(h.gain_pct != null ? [{ label: "Gain", value: signedPoints(h.gain_pct) }] : []),
    ],
  }));
  const cum: BarRow[] = [
    { id: "t1", label: "Largest fund", value: c.top1, valueText: `${c.top1.toFixed(1)}%`, color: VIZ.teal },
    ...(c.n >= 2 ? [{ id: "t3", label: c.n <= 3 ? `All ${c.n} funds` : "Largest three", value: c.top3, valueText: `${c.top3.toFixed(1)}%`, color: VIZ.teal }] : []),
    ...(c.n > 3 ? [{ id: "t5", label: c.n <= 5 ? `All ${c.n} funds` : "Largest five", value: c.top5, valueText: `${c.top5.toFixed(1)}%`, color: VIZ.teal }] : []),
  ];

  return (
    <section className="vz-section" aria-label="Concentration">
      <h2 className="vz-h">Where it is concentrated</h2>
      <p className="vz-sub">Largest funds by share of value</p>
      <HBars rows={rows} max={Math.max(40, rows[0]?.value ?? 40)} ariaLabel="Largest funds by weight" />
      <p className="vz-sub vz-gap">Share held by the biggest few</p>
      <HBars rows={cum} max={100} dense ariaLabel="Cumulative share of the largest funds" />
      <p className="vz-hint">
        Equal weights across {c.n} {c.n === 1 ? "fund" : "funds"} would put {(100 / c.n).toFixed(1)}% in each; your holdings behave like {c.effective.toFixed(1)} equal-sized funds.
      </p>
    </section>
  );
}
