"use client";

import Link from "next/link";
import { useState } from "react";
import type { FundHolding } from "@/lib/api";
import { assetClass, categoryShort, marketCapBucket } from "@/lib/funds/category";
import { FUND_PALETTE } from "./chartTheme";
import { GapNote, PanelEmpty } from "./FundAtoms";
import { HoldingsOverlapUnavailable } from "./AnalysisSections";

// ---------------------------------------------------------------------------------------------
// X-ray

type Bucket = { label: string; value: number; pct: number; funds: { h: FundHolding; pct: number }[] };

function bucketize(holdings: FundHolding[], key: (h: FundHolding) => string): Bucket[] {
  const total = holdings.reduce((a, h) => a + h.value, 0);
  if (total <= 0) return [];
  const map = new Map<string, FundHolding[]>();
  for (const h of holdings) map.set(key(h), [...(map.get(key(h)) ?? []), h]);
  return Array.from(map, ([label, list]) => {
    const value = list.reduce((a, h) => a + h.value, 0);
    return {
      label,
      value,
      pct: (value / total) * 100,
      funds: list.map((h) => ({ h, pct: (h.value / total) * 100 })).sort((a, b) => b.pct - a.pct),
    };
  }).sort((a, b) => b.value - a.value);
}

function ExposureRow({ title, buckets, note }: { title: string; buckets: Bucket[]; note?: string }) {
  const [active, setActive] = useState<string | null>(null);
  const current = buckets.find((b) => b.label === active) ?? buckets[0];
  if (!buckets.length) return null;
  return (
    <div className="mf-xray-row">
      <div className="mf-xray-title">
        <h3>{title}</h3>
        {note ? <span className="muted">{note}</span> : null}
      </div>
      <div className="alloc mf-xray-bar" role="group" aria-label={`${title} buckets`}>
        {buckets.map((b, i) => (
          <button
            key={b.label}
            type="button"
            aria-pressed={current.label === b.label}
            aria-label={`${b.label}, ${b.pct.toFixed(1)}%, from ${b.funds.length} ${b.funds.length === 1 ? "fund" : "funds"}`}
            style={{ flexGrow: Math.max(b.pct, 0.6), flexBasis: 0, background: FUND_PALETTE[i % FUND_PALETTE.length] }}
            onMouseEnter={() => setActive(b.label)}
            onFocus={() => setActive(b.label)}
            onClick={() => setActive(b.label)}
          >
            {b.pct >= 12 ? <span>{b.pct.toFixed(0)}%</span> : null}
          </button>
        ))}
      </div>
      <div className="mf-xray-detail" aria-live="polite">
        <p>
          <strong>{current.label}</strong> {current.pct.toFixed(1)}%
          {current.funds.length > 1 ? <span className="mf-tag warn">{current.funds.length} funds stacked here</span> : null}
        </p>
        <ul>
          {current.funds.map(({ h, pct }) => (
            <li key={h.scheme_code}>
              <Link href={`/funds/${h.scheme_code}`}>{h.scheme_name}</Link>
              <b>{pct.toFixed(1)}%</b>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function ExposureXRay({ holdings }: { holdings: FundHolding[] }) {
  const live = holdings.filter((h) => h.data_available && h.value > 0);
  if (!live.length) {
    return <PanelEmpty title="Portfolio X-ray">Add a fund with a live NAV to see where the money sits.</PanelEmpty>;
  }
  const equity = live.filter((h) => assetClass(h.scheme_category) === "Equity");
  const equityShare = (equity.reduce((a, h) => a + h.value, 0) / live.reduce((a, h) => a + h.value, 0)) * 100;
  return (
    <section className="card mf-panel mf-xray" aria-labelledby="mf-xray-title">
      <h2 id="mf-xray-title">Portfolio X-ray</h2>
      <p className="mf-basis">
        Every held fund folded into one view. Each fund is bucketed whole by its AMFI category, so a flexi-cap fund counts entirely as flexi-cap.
      </p>
      <ExposureRow title="Asset class" buckets={bucketize(live, (h) => assetClass(h.scheme_category))} />
      {equity.length ? (
        <ExposureRow title="Equity style" note={`within the ${equityShare.toFixed(0)}% in equity`} buckets={bucketize(equity, (h) => marketCapBucket(h.scheme_category))} />
      ) : null}
      <ExposureRow title="Fund house" buckets={bucketize(live, (h) => h.fund_house)} />
      <GapNote gaps={["holdings"]}>Sector and stock-level exposure are not shown.</GapNote>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Overlap

const TRACKED_INDICES: [RegExp, string][] = [
  [/nifty\s*next\s*50/i, "Nifty Next 50"],
  [/nifty\s*midcap\s*150/i, "Nifty Midcap 150"],
  [/nifty\s*smallcap\s*250/i, "Nifty Smallcap 250"],
  [/nifty\s*500/i, "Nifty 500"],
  [/nifty\s*100(?!\d)/i, "Nifty 100"],
  [/nifty\s*bank/i, "Nifty Bank"],
  [/nifty\s*50(?!\d)/i, "Nifty 50"],
  [/sensex/i, "Sensex"],
];

function trackedIndex(h: FundHolding): string | null {
  const c = h.scheme_category.toLowerCase();
  if (!c.includes("index") && !c.includes("etf")) return null;
  return TRACKED_INDICES.find(([re]) => re.test(h.scheme_name))?.[1] ?? null;
}

type Similar = { a: FundHolding; b: FundHolding; why: string };

/** Pairs that obviously cover the same ground. A shared category or index, not a measured overlap. */
function findSimilar(holdings: FundHolding[]): Similar[] {
  const out: Similar[] = [];
  for (let i = 0; i < holdings.length; i++) {
    for (let j = i + 1; j < holdings.length; j++) {
      const a = holdings[i];
      const b = holdings[j];
      const ia = trackedIndex(a);
      const ib = trackedIndex(b);
      if (ia && ia === ib) out.push({ a, b, why: `Both track the ${ia}.` });
      else if (a.scheme_category === b.scheme_category && a.scheme_category !== "Unknown") out.push({ a, b, why: `Same category: ${categoryShort(a.scheme_category)}.` });
    }
  }
  return out;
}

export function OverlapDetector({ holdings }: { holdings: FundHolding[] }) {
  const live = holdings.filter((h) => h.data_available);
  const similar = findSimilar(live);
  return (
    <>
      <HoldingsOverlapUnavailable />
      {similar.length ? (
        <section className="card mf-panel" aria-labelledby="mf-sim-t">
          <h2 id="mf-sim-t">Funds that cover the same ground</h2>
          <p className="mf-basis">A match on category or tracked index. Funds like these often hold many of the same stocks, but how many is not measured here.</p>
          <ul className="mf-overlaps">
            {similar.map((o) => (
              <li key={`${o.a.scheme_code}-${o.b.scheme_code}`}>
                <p>
                  <Link href={`/funds/${o.a.scheme_code}`}>{o.a.scheme_name}</Link>
                  <span aria-hidden> ↔ </span>
                  <span className="visually-hidden"> and </span>
                  <Link href={`/funds/${o.b.scheme_code}`}>{o.b.scheme_name}</Link>
                </p>
                <small>{o.why}</small>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
