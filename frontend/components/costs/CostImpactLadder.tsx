"use client";

import "./cx.css";
import { costImpact } from "@/lib/costs/pnl";
import { inr, signedInr } from "@/lib/trading/format";
import { InfoTip } from "./CostDisclosure";

/**
 * "Where did my returns go?": gross, less charges, the realised result, less estimated tax, the
 * estimated net gain. Each rung is subtracted once; the tax rung says what it could not include.
 */
export function CostImpactLadder({
  gross,
  charges,
  tax,
  taxBasis,
  grossLabel = "Gross gains",
  title = "Where did my returns go?",
  footnote,
}: {
  gross: number;
  charges: number;
  tax: number | null;
  taxBasis?: string;
  grossLabel?: string;
  title?: string;
  footnote?: string;
}) {
  const c = costImpact({ gross, charges, tax });
  return (
    <section className="cx-block" aria-label={title}>
      <h3>{title}</h3>
      <dl className="cx-ladder">
        <div className="cx-row cx-lead">
          <dt>{grossLabel}</dt>
          <dd className={c.gross >= 0 ? "cx-up" : "cx-down"}>{signedInr(c.gross)}</dd>
        </div>
        <div className="cx-row">
          <dt>Transaction charges</dt>
          <dd>{c.charges > 0 ? `−${inr(c.charges)}` : inr(0)}</dd>
        </div>
        <div className="cx-row cx-lead">
          <dt>Realised result after charges</dt>
          <dd className={c.netBeforeTax >= 0 ? "cx-up" : "cx-down"}>{signedInr(c.netBeforeTax)}</dd>
        </div>
        <div className="cx-row">
          <dt>
            Estimated tax
            <InfoTip label="About the estimated tax">
              An estimate, not what you owe. {taxBasis ?? "It is before surcharge and cess unless your tax details are set."} Actual liability depends on your complete tax position.
            </InfoTip>
          </dt>
          <dd>{c.tax == null ? "Not estimated" : c.tax > 0 ? `−${inr(c.tax)}` : inr(0)}</dd>
        </div>
        <div className="cx-row cx-total">
          <dt>Estimated net gain</dt>
          <dd className={c.netAfterTax == null ? "" : c.netAfterTax >= 0 ? "cx-up" : "cx-down"}>{c.netAfterTax == null ? "—" : signedInr(c.netAfterTax)}</dd>
        </div>
      </dl>
      <p className="cx-quiet-text">
        {footnote ?? "Headline returns are not what you keep: charges come out of every trade and tax comes out of what is left."}
      </p>
    </section>
  );
}
