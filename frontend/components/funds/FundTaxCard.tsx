"use client";

import "@/components/costs/cx.css";
import { InfoTip } from "@/components/costs/CostDisclosure";
import type { FundTaxFund } from "@/lib/api";
import { inr, signedInr } from "@/lib/trading/format";

const day = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
const units = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 3 });

/**
 * One fund's tax picture: what it cost, what it is worth, the gain that has not been taxed because it has
 * not been realised, how its units split by term, and what redeeming it today would estimate to.
 */
export function FundTaxCard({ fund, onRedeem, onOpen }: { fund: FundTaxFund; onRedeem?: () => void; onOpen?: () => void }) {
  const c = fund.classification;
  return (
    <article className="cx-card cx-fundtax" aria-label={`${fund.scheme_name} tax view`}>
      <header className="cx-fundtax-head">
        <div>
          {onOpen ? (
            <button type="button" className="cx-rowbtn" onClick={onOpen}>{fund.scheme_name}</button>
          ) : (
            <strong>{fund.scheme_name}</strong>
          )}
          <p>
            {c.label}
            {c.certainty === "depends" ? " · check the scheme" : c.certainty === "override" ? " · set by you" : ""}
            <InfoTip label="Why this class">{c.reason} {c.detail}</InfoTip>
          </p>
        </div>
        {onRedeem ? <button type="button" className="btn secondary small" onClick={onRedeem}>Redeem…</button> : null}
      </header>

      <dl className="cx-ladder cx-compact">
        <div className="cx-row"><dt>Invested</dt><dd>{inr(fund.invested)}</dd></div>
        <div className="cx-row"><dt>Current value</dt><dd>{inr(fund.value)}</dd></div>
        <div className="cx-row cx-lead"><dt>Unrealised gain</dt><dd className={fund.unrealized_gain > 0 ? "cx-up" : fund.unrealized_gain < 0 ? "cx-down" : ""}>{signedInr(fund.unrealized_gain)}</dd></div>
      </dl>

      <h4 className="cx-h">Tax status</h4>
      <dl className="cx-rows cx-compact">
        <div className="cx-row">
          <dt>Holding period</dt>
          <dd>
            {fund.first_purchase ? `${fund.lot_count} lot${fund.lot_count === 1 ? "" : "s"} since ${day(fund.first_purchase)}` : "—"}
          </dd>
        </div>
        <div className="cx-row">
          <dt>Long-term units</dt>
          <dd>{units(fund.long_term_units)}</dd>
        </div>
        <div className="cx-row">
          <dt>Short-term units</dt>
          <dd>{units(fund.short_term_units)}</dd>
        </div>
        <div className="cx-row">
          <dt>Estimated taxable gain if redeemed</dt>
          <dd>{c.tax_class === "unknown" ? "Choose a tax class" : signedInr(fund.taxable_gain)}</dd>
        </div>
        <div className="cx-row cx-lead">
          <dt>
            Estimated tax impact if redeemed
            <small>{fund.tax_basis}</small>
          </dt>
          <dd>{fund.tax_if_redeemed == null ? "Not estimated" : inr(fund.tax_if_redeemed)}</dd>
        </div>
        <div className="cx-row cx-quiet">
          <dt>Exit load</dt>
          <dd>{fund.exit_load.amount_if_redeemed == null ? "Information unavailable" : fund.exit_load.amount_if_redeemed > 0 ? inr(fund.exit_load.amount_if_redeemed) : "None applies"}</dd>
        </div>
      </dl>
      <p className="cx-quiet-text">{fund.note}</p>

      {fund.lots.length > 0 ? (
        <details>
          <summary>Each purchase and SIP instalment is its own lot ({fund.lots.length})</summary>
          <div className="cx-table-wrap">
            <table className="cx-table">
              <thead>
                <tr>{["Bought", "Units", "Cost", "Value", "Held", "Class today", "Long-term from", "Gain"].map((h) => <th key={h} scope="col">{h}</th>)}</tr>
              </thead>
              <tbody>
                {fund.lots.map((l) => (
                  <tr key={`${l.buy_date}-${l.units}-${l.cost}`}>
                    <td>{day(l.buy_date)}{l.source === "sip" ? " · SIP" : l.source === "aggregated" ? " · blended" : ""}</td>
                    <td>{units(l.units)}</td>
                    <td>{inr(l.cost)}</td>
                    <td>{inr(l.value)}</td>
                    <td>{l.held_text}</td>
                    <td>{l.deemed_short_term ? "Short-term (deemed)" : l.term === "long" ? "Long-term" : "Short-term"}</td>
                    <td>{l.long_term_from ? day(l.long_term_from) : l.deemed_short_term ? "Never" : "Now"}</td>
                    <td className={l.gain >= 0 ? "cx-up" : "cx-down"}>{signedInr(l.gain)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}
    </article>
  );
}
