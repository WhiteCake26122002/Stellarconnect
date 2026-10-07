"use client";

import { useMemo, useState } from "react";
import type { FundTaxFund, FundTaxLot, FundTaxView } from "@/lib/api";
import { inr, signedInr } from "@/lib/trading/format";
import { HBars, type BarRow } from "./viz/HBars";
import { Waterfall, type WaterfallStep } from "./viz/Waterfall";
import { TipRow, useTip } from "./viz/Tip";
import { VIZ } from "./viz/theme";

const short = (v: number) => {
  const a = Math.abs(v);
  const body = a >= 1e5 ? `₹${(a / 1e5).toFixed(a >= 1e6 ? 1 : 2)}L` : a >= 1e3 ? `₹${(a / 1e3).toFixed(1)}K` : `₹${a.toFixed(0)}`;
  return v < 0 ? `−${body}` : body;
};

/** Net short-term and long-term gains realised in the year, as two bars drawn to the same scale. */
export function GainsByTerm({ view }: { view: FundTaxView }) {
  const r = view.realized;
  const empty = r.stcg === 0 && r.ltcg === 0;
  const rows: BarRow[] = [
    { id: "stcg", label: "Short-term (STCG)", sub: "Held 12 months or less", value: Math.abs(r.stcg), valueText: signedInr(r.stcg, 0), color: r.stcg < 0 ? VIZ.red : VIZ.gold },
    { id: "ltcg", label: "Long-term (LTCG)", sub: "Held more than 12 months", value: Math.abs(r.ltcg), valueText: signedInr(r.ltcg, 0), color: r.ltcg < 0 ? VIZ.red : VIZ.teal },
  ];
  return (
    <section className="vz-section" aria-label="Realised gains by term">
      <h2 className="vz-h">Realised gains by term</h2>
      {empty ? (
        <p className="vz-unavailable">No gains realised in {view.fy_label}. Redeem a fund and the gain appears here, split by how long each lot was held.</p>
      ) : (
        <HBars rows={rows} max={Math.max(1, ...rows.map((x) => x.value))} ariaLabel={`Realised gains by term, ${view.fy_label}`} />
      )}
      <p className="vz-hint">Net of losses set off within the same term. The exemption and tax rates are applied once, below.</p>
    </section>
  );
}

/** From the gross gain on redemptions to what is left after costs and the estimated tax. */
export function NetBridge({ view }: { view: FundTaxView }) {
  const r = view.realized;
  const est = r.estimate;
  if (!r.items.length) {
    return (
      <section className="vz-section" aria-label="Gross to net">
        <h2 className="vz-h">From gross gain to net</h2>
        <p className="vz-unavailable">Unavailable: nothing was redeemed in {view.fy_label}, so there is no realised gain to carry through costs and tax.</p>
      </section>
    );
  }
  const taxKnown = est.supported;
  const tax = taxKnown ? est.total : 0;
  const steps: WaterfallStep[] = [
    { id: "gross", label: "Gross gain", kind: "total", value: r.gross, valueText: signedInr(r.gross, 0) },
    { id: "costs", label: "Costs", kind: "delta", value: -r.charges, valueText: r.charges ? `−${inr(r.charges, 0)}` : "₹0" },
    ...(taxKnown ? [{ id: "tax", label: "Est. tax", kind: "delta" as const, value: -tax, valueText: tax ? `−${inr(tax, 0)}` : "₹0" }] : []),
    { id: "net", label: taxKnown ? "Net gain" : "After costs", kind: "total", value: r.gross - r.charges - tax, valueText: signedInr(r.gross - r.charges - tax, 0) },
  ];
  return (
    <section className="vz-section" aria-label="Gross to net">
      <h2 className="vz-h">From gross gain to net</h2>
      <Waterfall steps={steps} ariaLabel={`Gross gain to net gain, ${view.fy_label}`} height={230} />
      <p className="vz-hint">
        {taxKnown ? "Estimated tax, not a bill; surcharge and cess are left out unless you set them." : `No tax is estimated for ${view.fy_label}.`} Costs are exit load and STT on redemptions; the expense ratio is already inside the NAV and is not taken off again.
      </p>
    </section>
  );
}

type LotPoint = { fund: FundTaxFund; lot: FundTaxLot; t: number };

const termColor = (l: FundTaxLot) => (l.deemed_short_term ? VIZ.grey : l.term === "long" ? VIZ.teal : VIZ.gold);

/**
 * Every unredeemed lot on a time axis: where it was bought, how big it is (height is its value) and whether
 * it is long-term yet. Pick a lot for its holding period, gain and the date it turns long-term.
 */
export function LotTimeline({ funds }: { funds: FundTaxFund[] }) {
  const { ref, show, hide, el } = useTip();
  const lots = useMemo<LotPoint[]>(
    () =>
      funds
        .flatMap((fund) => fund.lots.map((lot) => ({ fund, lot, t: new Date(`${lot.buy_date}T00:00:00`).getTime() })))
        .filter((p) => Number.isFinite(p.t))
        .sort((a, b) => a.t - b.t),
    [funds],
  );
  const [pick, setPick] = useState<number | null>(null);
  if (!lots.length) return null;
  const t0 = lots[0].t;
  const t1 = Math.max(Date.now(), lots[lots.length - 1].t);
  const top = Math.max(1, ...lots.map((p) => p.lot.value));
  const years: number[] = [];
  for (let y = new Date(t0).getFullYear(); y <= new Date(t1).getFullYear(); y++) years.push(y);
  const x = (t: number) => ((t - t0) / (t1 - t0 || 1)) * 100;
  const chosen = pick != null ? lots[pick] : null;

  return (
    <section className="vz-section" aria-label="Tax lots over time">
      <h2 className="vz-h">Your tax lots over time</h2>
      <p className="vz-sub">Each bar is one purchase or SIP instalment still held; taller means more value</p>
      <div className="vz-lots" ref={ref} onPointerLeave={hide}>
        <div className="vz-lots-plot" role="group" aria-label="Lots by purchase date">
          {years.map((y) => {
            const left = x(new Date(y, 0, 1).getTime());
            return left >= 0 && left <= 100 ? (
              <span key={y} className="vz-lots-year" style={{ left: `${left}%` }}>
                <i />
                {y}
              </span>
            ) : null;
          })}
          {lots.map((p, i) => (
            <button
              key={`${p.fund.scheme_code}-${p.lot.buy_date}-${i}`}
              type="button"
              className={`vz-lot${pick === i ? " on" : ""}`}
              style={{ left: `${x(p.t)}%`, height: `${Math.max(6, (p.lot.value / top) * 100)}%`, background: termColor(p.lot), animationDelay: `${Math.min(i, 20) * 25}ms` }}
              aria-label={`${p.fund.scheme_name}, bought ${p.lot.buy_date}, ${short(p.lot.value)}, ${p.lot.deemed_short_term ? "short-term (deemed)" : p.lot.term === "long" ? "long-term" : "short-term"}`}
              aria-pressed={pick === i}
              onClick={() => setPick(pick === i ? null : i)}
              onPointerMove={(e) =>
                show(
                  e,
                  <>
                    <strong>{p.lot.buy_date}</strong>
                    <TipRow label="Value" value={short(p.lot.value)} />
                    <TipRow label="Held" value={p.lot.held_text} />
                  </>,
                )
              }
            />
          ))}
        </div>
        <ul className="vz-legend">
          <li><i style={{ background: VIZ.teal }} /> Long-term</li>
          <li><i style={{ background: VIZ.gold }} /> Short-term</li>
          <li><i style={{ background: VIZ.grey }} /> Short-term by rule (deemed)</li>
        </ul>
        {el}
      </div>
      {chosen ? (
        <dl className="vz-lot-detail" aria-live="polite">
          <div><dt>Fund</dt><dd>{chosen.fund.scheme_name}</dd></div>
          <div><dt>Bought</dt><dd>{chosen.lot.buy_date} · held {chosen.lot.held_text}</dd></div>
          <div><dt>Units</dt><dd>{chosen.lot.units.toLocaleString("en-IN", { maximumFractionDigits: 3 })}</dd></div>
          <div><dt>Cost → value</dt><dd>{inr(chosen.lot.cost, 0)} → {inr(chosen.lot.value, 0)}</dd></div>
          <div><dt>Gain</dt><dd className={chosen.lot.gain >= 0 ? "bull" : "bear"}>{signedInr(chosen.lot.gain, 0)}</dd></div>
          <div><dt>Class</dt><dd>{chosen.lot.bucket_label}{chosen.lot.long_term_from && chosen.lot.term === "short" ? ` · long-term from ${chosen.lot.long_term_from}` : ""}</dd></div>
        </dl>
      ) : (
        <p className="vz-hint">Select a bar to see that lot&apos;s holding period, gain and the date it turns long-term.</p>
      )}
    </section>
  );
}
