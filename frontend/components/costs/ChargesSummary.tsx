"use client";

import { useState } from "react";
import "./cx.css";
import { netTransactionValue, type ChargeBreakdown } from "@/lib/costs/charges";
import { CHARGES } from "@/lib/costs/rules";
import { inr } from "@/lib/trading/format";
import { ChargeSheet } from "./ChargeSheet";

/**
 * "Estimated charges" as a small expandable line: the trade value, each charge, the total and what
 * the account will be debited or credited, with the full amount/rate sheet one click further.
 */
export function ChargesSummary({ charges, open = false }: { charges: ChargeBreakdown; open?: boolean }) {
  const [sheet, setSheet] = useState(false);
  const buy = charges.side === "buy";

  if (!charges.modelled) {
    return <p className="cx-note">{charges.notes[0]}</p>;
  }

  return (
    <div className="cx-summary">
      <details open={open}>
        <summary>
          <span>Estimated charges</span>
          <b>{inr(charges.total)}</b>
        </summary>
        <dl className="cx-rows cx-compact">
          <div className="cx-row"><dt>Trade value</dt><dd>{inr(charges.turnover)}</dd></div>
          {charges.lines.map((l) => (
            <div className="cx-row cx-quiet" key={l.key}>
              <dt>{l.label}</dt>
              <dd>{inr(l.amount)}</dd>
            </div>
          ))}
          <div className="cx-row cx-total"><dt>Total charges</dt><dd>{inr(charges.total)}</dd></div>
          <div className="cx-row cx-lead"><dt>Net transaction value</dt><dd>{inr(netTransactionValue(charges))}</dd></div>
        </dl>
        <button type="button" className="cx-link" onClick={() => setSheet(true)}>Amount and rate for each charge</button>
      </details>
      <dl className="cx-rows">
        <div className="cx-row cx-lead cx-after">
          <dt>{buy ? "Estimated total debit" : "Estimated net proceeds"}</dt>
          <dd>{inr(netTransactionValue(charges))}</dd>
        </div>
      </dl>
      <p className="cx-quiet-text">{CHARGES.disclaimer}</p>
      {sheet ? <ChargeSheet charges={charges} onClose={() => setSheet(false)} /> : null}
    </div>
  );
}
