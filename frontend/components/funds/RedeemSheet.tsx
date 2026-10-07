"use client";

import { useEffect, useRef, useState } from "react";
import "@/components/costs/cx.css";
import { ConfidenceBadge, InfoTip } from "@/components/costs/CostDisclosure";
import { ApiError, api, type FundPortfolio, type FundRedeemPreview } from "@/lib/api";
import type { TaxProfile } from "@/lib/costs/tax";
import { inr, signedInr } from "@/lib/trading/format";

const day = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
const todayIso = () => new Date().toISOString().slice(0, 10);

/**
 * A redemption, shown before it is recorded: the units it uses (oldest first), the exit load and STT
 * it would take, the short- and long-term gains, an estimated tax on top of this year's realised gains
 * and what is left. Recording it stores the same exit load and STT the preview showed.
 */
export function RedeemSheet({
  code,
  name,
  held,
  profile,
  onClose,
  onDone,
}: {
  code: number;
  name: string;
  held: number;
  profile: TaxProfile;
  onClose: () => void;
  onDone: (book: FundPortfolio) => void;
}) {
  const [all, setAll] = useState(true);
  const [units, setUnits] = useState("");
  const [date, setDate] = useState("");
  const [preview, setPreview] = useState<FundRedeemPreview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const qty = Number(units);
  const ready = all || (Number.isFinite(qty) && qty > 0);

  useEffect(() => {
    if (!ready) {
      setPreview(null);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setBusy(true);
      setError("");
      api
        .fundRedeemPreview(
          code,
          { ...(all ? { all: true } : { units: qty }), ...(date ? { date } : {}), slab_rate_pct: profile.slabRatePct, income_band: profile.incomeBand, regime: profile.regime },
          controller.signal,
        )
        .then((p) => {
          setPreview(p);
          setBusy(false);
        })
        .catch((err) => {
          if (controller.signal.aborted) return;
          setPreview(null);
          setBusy(false);
          setError(err instanceof Error ? err.message : "Could not preview this redemption.");
        });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [code, all, qty, ready, date, profile.slabRatePct, profile.incomeBand, profile.regime]);

  async function record() {
    setSaving(true);
    setError("");
    try {
      onDone(await api.redeemFund(code, { ...(all ? { all: true } : { units: qty }), ...(date ? { date } : {}) }));
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : "Could not record the redemption.");
      setSaving(false);
    }
  }

  const p = preview;
  return (
    <div className="cx-overlay" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="cx-modal cx-wide" role="dialog" aria-modal="true" aria-label={`Redeem ${name}`}>
        <header className="cx-modal-head">
          <div>
            <h2>Redemption summary</h2>
            <p className="cx-sub">{name}</p>
          </div>
          <button ref={closeRef} type="button" className="cx-x" aria-label="Close" onClick={onClose}>×</button>
        </header>
        <div className="cx-body">
          <div className="cx-fields">
            <label>
              <span>Units</span>
              <select value={all ? "all" : "some"} onChange={(e) => setAll(e.target.value === "all")}>
                <option value="all">All {held.toLocaleString("en-IN", { maximumFractionDigits: 3 })} units</option>
                <option value="some">A number of units</option>
              </select>
            </label>
            {!all ? (
              <label>
                <span>Units to redeem</span>
                <input inputMode="decimal" value={units} onChange={(e) => setUnits(e.target.value)} placeholder={`up to ${held.toLocaleString("en-IN", { maximumFractionDigits: 3 })}`} />
              </label>
            ) : null}
            <label>
              <span>Date</span>
              <input type="date" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} />
              <small>Blank means the latest NAV.</small>
            </label>
          </div>

          {error ? <p className="cx-warn-note" role="alert">{error}</p> : null}
          {busy && !p ? <p className="cx-note" aria-live="polite">Working it out…</p> : null}

          {p ? (
            <div aria-live="polite" aria-busy={busy}>
              <dl className="cx-rows">
                <div className="cx-row"><dt>Units</dt><dd>{p.units.toLocaleString("en-IN", { maximumFractionDigits: 3 })}</dd></div>
                <div className="cx-row"><dt>NAV {day(p.date)}</dt><dd>{inr(p.nav)}</dd></div>
                <div className="cx-row cx-lead"><dt>Gross redemption</dt><dd>{inr(p.gross)}</dd></div>
                <div className="cx-row cx-quiet">
                  <dt>
                    Exit load
                    {p.exit_load.source ? <small>{p.exit_load.text} {p.exit_load.source}.</small> : null}
                  </dt>
                  <dd>{p.exit_load.amount == null ? "Exit load information unavailable." : inr(p.exit_load.amount)}</dd>
                </div>
                <div className="cx-row cx-quiet">
                  <dt>
                    STT
                    <InfoTip label="About STT on redemption">
                      {p.stt.note ?? "STT is charged only when equity-oriented units are redeemed. This fund's class has none."}
                    </InfoTip>
                  </dt>
                  <dd>{inr(p.stt.amount)}</dd>
                </div>
                <div className="cx-row cx-lead"><dt>Proceeds after charges</dt><dd>{inr(p.proceeds_after_charges)}</dd></div>
              </dl>

              <h3 className="cx-h">Estimated tax impact</h3>
              <dl className="cx-rows">
                <div className="cx-row"><dt>Short-term gain</dt><dd className={p.short_term_gain > 0 ? "cx-up" : p.short_term_gain < 0 ? "cx-down" : ""}>{signedInr(p.short_term_gain)}</dd></div>
                <div className="cx-row"><dt>Long-term gain</dt><dd className={p.long_term_gain > 0 ? "cx-up" : p.long_term_gain < 0 ? "cx-down" : ""}>{signedInr(p.long_term_gain)}</dd></div>
                <div className="cx-row">
                  <dt>
                    Estimated tax
                    <small>{p.tax_basis}, on top of gains already realised in {p.fy_label}</small>
                  </dt>
                  <dd>{p.estimated_tax == null ? "Not estimated" : inr(p.estimated_tax)}</dd>
                </div>
                <div className="cx-row cx-total">
                  <dt>Estimated net proceeds</dt>
                  <dd>{p.estimated_net_proceeds == null ? "—" : inr(p.estimated_net_proceeds)}</dd>
                </div>
              </dl>
              <p className="cx-quiet-text">{p.after_tax.label}{p.after_tax.return_pct != null ? `: ${p.after_tax.return_pct >= 0 ? "+" : "−"}${Math.abs(p.after_tax.return_pct).toFixed(2)}% on the cost of these units` : ""}.</p>

              <ConfidenceBadge confidence={p.confidence} />

              <div className="cx-table-wrap" style={{ marginTop: 10 }}>
                <table className="cx-table" aria-label="Units used, oldest first">
                  <thead>
                    <tr>{["Bought", "Units", "Cost", "Proceeds", "Held", "Class", "Gain", "Est. tax"].map((h) => <th key={h} scope="col">{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {p.lots.map((l) => (
                      <tr key={`${l.buy_date}-${l.units}`}>
                        <td>{day(l.buy_date)}</td>
                        <td>{l.units.toLocaleString("en-IN", { maximumFractionDigits: 3 })}</td>
                        <td>{inr(l.cost)}</td>
                        <td>{inr(l.proceeds)}</td>
                        <td>{l.held_text}</td>
                        <td>{l.deemed_short_term ? "Short-term (deemed)" : l.term === "long" ? "Long-term" : "Short-term"}</td>
                        <td className={l.taxable_gain >= 0 ? "cx-up" : "cx-down"}>{signedInr(l.taxable_gain)}</td>
                        <td>{inr(l.tax)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <ul className="cx-glist plain">
                {p.notes.map((n) => <li key={n}>{n}</li>)}
              </ul>
              <p className="cx-quiet-text">{p.history_note}</p>
            </div>
          ) : null}
        </div>
        <footer className="cx-foot">
          <p className="cx-quiet-text">{p ? p.disclosure : "Estimates for education, not tax advice."}</p>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
            <button type="button" className="btn secondary small" onClick={onClose}>Cancel</button>
            <button type="button" className="btn small" disabled={!p || saving} onClick={record}>
              {saving ? "Recording…" : "Record this redemption"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
