"use client";

import { useEffect, useRef, useState } from "react";
import "./cx.css";
import type { ChargeBreakdown } from "@/lib/costs/charges";
import { netTransactionValue } from "@/lib/costs/charges";
import { CHARGES } from "@/lib/costs/rules";
import { inr } from "@/lib/trading/format";

/**
 * The estimated-charges sheet: brokerage on top, then the external charges and taxes, each with its
 * amount or its rate (the tabs). Opened from an order ticket before the order, and from a ledger row
 * after it. Every number is the breakdown's own; nothing is recalculated here.
 */
export function ChargeSheet({
  charges,
  title = "Estimated charges",
  subtitle,
  onClose,
}: {
  charges: ChargeBreakdown;
  title?: string;
  subtitle?: string;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"amount" | "rate">("amount");
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const line = (key: string) => charges.lines.find((l) => l.key === key);
  const cell = (key: string) => {
    const l = line(key);
    if (!l) return null;
    return tab === "amount" ? inr(l.amount) : l.rateText;
  };
  const external = charges.lines.filter((l) => l.key !== "brokerage");
  const verb = charges.side === "buy" ? "Debit" : "Credit";

  return (
    <div className="cx-overlay" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="cx-modal" role="dialog" aria-modal="true" aria-label={title}>
        <header className="cx-modal-head">
          <div>
            <h2>{title}</h2>
            {subtitle ? <p className="cx-sub">{subtitle}</p> : null}
          </div>
          <button ref={closeRef} type="button" className="cx-x" aria-label="Close" onClick={onClose}>×</button>
        </header>

        {!charges.modelled ? (
          <div className="cx-body">
            <p className="cx-note">{charges.notes[0]}</p>
          </div>
        ) : (
          <div className="cx-body">
            <div className="cx-seg" role="tablist" aria-label="Show amounts or rates">
              {(["amount", "rate"] as const).map((t) => (
                <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
                  {t === "amount" ? "Amount" : "Rate"}
                </button>
              ))}
            </div>

            <dl className="cx-rows">
              <div className="cx-row cx-lead">
                <dt>Trade value</dt>
                <dd>{inr(charges.turnover)}</dd>
              </div>
              <div className="cx-row cx-strong">
                <dt>Brokerage</dt>
                <dd>{cell("brokerage")}</dd>
              </div>
            </dl>

            <h3 className="cx-h">External charges/taxes</h3>
            <dl className="cx-rows cx-quiet">
              {external.map((l) => (
                <div className="cx-row" key={l.key}>
                  <dt>
                    {l.label}
                    {l.key === "exchange" && charges.exchange ? <small> {charges.exchange}</small> : null}
                    {l.key === "stt" && l.amount > 0 ? <small className="cx-tag">not deductible from a capital gain</small> : null}
                    {l.key === "gst" ? <small>on {inr(charges.gstBase)}</small> : null}
                  </dt>
                  <dd>{tab === "amount" ? inr(l.amount) : l.rateText}</dd>
                </div>
              ))}
            </dl>

            <dl className="cx-rows">
              <div className="cx-row cx-total">
                <dt>Total charges</dt>
                <dd>{tab === "amount" ? inr(charges.total) : charges.turnover > 0 ? `${((charges.total / charges.turnover) * 100).toFixed(4)}% of trade value` : "—"}</dd>
              </div>
              <div className="cx-row cx-lead">
                <dt>Net transaction value <small>{verb.toLowerCase()}</small></dt>
                <dd>{inr(netTransactionValue(charges))}</dd>
              </div>
            </dl>
          </div>
        )}

        <footer className="cx-foot">
          <p>The above are only the estimated charges. Please refer to the contract note for actual charges.</p>
          <p className="cx-quiet-text">
            {charges.modelled ? `${charges.profileLabel} profile · rates as configured on ${CHARGES.reviewedOn}. ` : ""}
            {CHARGES.disclaimer}
          </p>
        </footer>
      </div>
    </div>
  );
}
