"use client";

import { useMemo } from "react";
import "@/components/costs/cx.css";
import { InfoTip } from "@/components/costs/CostDisclosure";
import { calculateEquityTax, equityTaxYears } from "@/lib/costs/equityTax";
import { calculateNetPnL } from "@/lib/costs/pnl";
import { financialYearOf, fyLabel } from "@/lib/costs/rules";
import type { TaxProfile } from "@/lib/costs/tax";
import { equity, totalCharges, type EngineState } from "@/lib/trading/engine";
import { inr, signedInr } from "@/lib/trading/format";
import type { Quote } from "@/lib/trading/types";

/**
 * Trading costs at a glance: gross P&L, the charges taken out of it, net P&L before tax, the
 * estimated tax on realised delivery gains, and the estimated net. Net P&L is what the account
 * actually has; gross is net with the charges added back, so nothing is counted twice.
 */
export function CostsCard({ engine, quotes, profile }: { engine: EngineState; quotes: Map<string, Quote>; profile: TaxProfile }) {
  const model = useMemo(() => {
    const net = equity(engine, quotes) - engine.account.startingBalance;
    const charges = totalCharges(engine);
    const pnl = calculateNetPnL({ gross: net + charges, charges });
    let tax = 0;
    let unsupported = false;
    let priced = true;
    let basis = "Estimated tax before surcharge and cess";
    for (const fy of equityTaxYears(engine.trades)) {
      const y = calculateEquityTax(engine.trades, fy, profile);
      if (!y.estimate.supported) {
        unsupported = true;
        continue;
      }
      tax += y.estimate.total;
      if (y.estimate.slabGainNotEstimated > 0) priced = false;
      basis = y.estimate.headline;
    }
    const fy = financialYearOf(Date.now());
    const thisYear = engine.fills.filter((f) => financialYearOf(f.time) === fy);
    return {
      ...pnl,
      tax,
      unsupported,
      priced,
      basis,
      fy,
      yearCharges: thisYear.reduce((s, f) => s + f.charges.total, 0),
      yearFills: thisYear.length,
      after: pnl.net - tax,
    };
  }, [engine, quotes, profile]);

  return (
    <section className="cx-block cx-costs" aria-label="Trading costs">
      <h3>
        Trading costs
        <InfoTip label="About trading costs">
          Gross P&amp;L is the price move before any charge. Net P&amp;L is after brokerage, STT, exchange charges, SEBI fees, stamp duty and GST. The tax line is an estimate on realised delivery gains only; unrealised gains are not taxed.
        </InfoTip>
      </h3>
      <dl className="cx-ladder">
        <div className="cx-row">
          <dt>Gross P&amp;L</dt>
          <dd className={model.gross >= 0 ? "cx-up" : "cx-down"}>{signedInr(model.gross, 0)}</dd>
        </div>
        <div className="cx-row">
          <dt>Trading charges</dt>
          <dd>{model.charges > 0 ? `−${inr(model.charges, 0)}` : inr(0, 0)}</dd>
        </div>
        <div className="cx-row cx-lead">
          <dt>Net P&amp;L before tax</dt>
          <dd className={model.net >= 0 ? "cx-up" : "cx-down"}>{signedInr(model.net, 0)}</dd>
        </div>
        <div className="cx-row">
          <dt>Estimated tax</dt>
          <dd>{model.tax > 0 ? `−${inr(model.tax, 0)}` : inr(0, 0)}</dd>
        </div>
        <div className="cx-row cx-total">
          <dt>Estimated net P&amp;L</dt>
          <dd className={model.after >= 0 ? "cx-up" : "cx-down"}>{signedInr(model.after, 0)}</dd>
        </div>
      </dl>
      <p className="cx-quiet-text">
        {model.basis}, on realised delivery gains in every financial year{model.priced ? "" : "; gains taxed at slab rate are not priced"}.
        {model.unsupported ? " A year with changed rates is not estimated." : ""} Based on available transaction history and current applicable tax rules; not tax advice.
      </p>
      {model.yearFills > 0 && model.yearCharges > 0 ? (
        <p className="cx-quiet-text">
          {fyLabel(model.fy)}: {model.yearFills} execution{model.yearFills === 1 ? "" : "s"} generated {inr(model.yearCharges, 0)} in estimated transaction charges.
        </p>
      ) : null}
    </section>
  );
}
