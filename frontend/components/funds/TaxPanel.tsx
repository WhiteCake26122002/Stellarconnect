"use client";

import type { FundHolding } from "@/lib/api";
import { parseDay } from "@/lib/funds/analytics";
import { longDate, rupees } from "@/lib/funds/format";
import { holdingTax, taxRule } from "@/lib/funds/tax";
import { GapNote } from "./FundAtoms";

/**
 * Which capital-gains rules apply, where this holding sits on the short / long-term line, and
 * a rough tax on today's gain. Exit load is named as missing rather than guessed.
 */
export function TaxPanel({ category, name, holding }: { category: string; name: string; holding: FundHolding | null }) {
  const rule = taxRule(category, name);
  const status = holding ? holdingTax({ category, name, purchaseDate: holding.purchase_date, gain: holding.gain }) : null;
  const eff = status?.rule ?? rule;

  let progress: number | null = null;
  if (status && eff.ltMonths != null) {
    const start = parseDay(holding!.purchase_date);
    const end = status.longTermOn ?? start + status.heldDays * 86_400_000;
    progress = status.term === "long" ? 100 : Math.min(100, Math.max(2, ((Date.now() - start) / (end - start)) * 100));
  }

  return (
    <section className="card mf-panel mf-tax" aria-labelledby="mf-tax-t">
      <div className="mf-panel-head">
        <div>
          <h2 id="mf-tax-t">Tax and exit load</h2>
          <p className="mf-basis">Indicative, for units sold on or after 23 Jul 2024. Not tax advice.</p>
        </div>
        <span className={`mf-tag${eff.certainty === "depends" ? " warn" : ""}`} title={eff.note}>
          {eff.label}
          {eff.certainty === "depends" ? " · check scheme" : ""}
        </span>
      </div>

      <dl className="mf-tax-rules">
        <div>
          <dt>Short-term</dt>
          <dd>{eff.shortTerm}</dd>
        </div>
        <div>
          <dt>Long-term</dt>
          <dd>{eff.longTerm}</dd>
        </div>
      </dl>
      <p className="mf-basis">{eff.note}</p>

      {status ? (
        <div className="mf-tax-status">
          {progress != null ? (
            <>
              <div className="mf-tax-line" aria-hidden="true">
                <i className={status.term === "long" ? "long" : ""} style={{ width: `${progress}%` }} />
              </div>
              <div className="mf-tax-ends" aria-hidden="true">
                <span>Bought {longDate(parseDay(holding!.purchase_date))}</span>
                <span>{status.longTermOn ? `Long-term from ${longDate(status.longTermOn)}` : "Long-term"}</span>
              </div>
            </>
          ) : null}
          <p className="mf-tax-now">
            {status.term === "slab" ? (
              <>
                <strong>Every gain at your slab rate</strong>, however long you hold. Held {status.heldDays.toLocaleString("en-IN")} days.
              </>
            ) : status.term === "long" ? (
              <>
                <strong className="bull">Long-term now.</strong> Held {status.heldDays.toLocaleString("en-IN")} days.
              </>
            ) : (
              <>
                <strong className="warn-text">Short-term for {status.daysToLong?.toLocaleString("en-IN")} more days.</strong> Selling before then is taxed at the short-term rate.
              </>
            )}
          </p>
          <p className="mf-tax-est">
            <span>Rough tax if sold today</span>
            <strong>{status.estTax == null ? (holding!.gain != null && holding!.gain > 0 ? "Slab rate" : "₹0") : rupees(status.estTax, 0)}</strong>
            <small>{status.estBasis}</small>
          </p>
        </div>
      ) : (
        <p className="muted mf-empty-line">Add this fund to your portfolio to see your holding period and a rough tax on your gain.</p>
      )}

      <div className="mf-tax-exit">
        <strong>Exit load</strong>
        <span className="mf-nodata">Not in the API</span>
        <p className="muted">Many schemes charge a percentage if you redeem within a set period. Check the scheme information document before an early sale.</p>
      </div>
      <GapNote gaps={holding ? ["exit-load", "lots"] : ["exit-load"]}>Exit load is not shown{holding ? ", and top-ups share the first purchase date" : ""}.</GapNote>
    </section>
  );
}
