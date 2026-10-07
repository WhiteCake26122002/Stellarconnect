"use client";

import { useEffect, useState } from "react";
import "@/components/costs/cx.css";
import { api, type FundClassification } from "@/lib/api";

type Tier = { days: number; pct: number };

/**
 * What the data sources cannot tell us about a scheme, entered by the user and labelled as theirs: the
 * tax class where the AMFI category does not settle it, and the exit load from the scheme document.
 */
export function TaxSettings({
  code,
  classification,
  exitTerms,
  onSaved,
}: {
  code: number;
  classification: FundClassification;
  exitTerms: Tier[] | null;
  onSaved: () => void;
}) {
  const [cls, setCls] = useState<string>(classification.source === "override" ? classification.tax_class : "");
  const [days, setDays] = useState(exitTerms?.[0] ? String(exitTerms[0].days) : "");
  const [pct, setPct] = useState(exitTerms?.[0] ? String(exitTerms[0].pct) : "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    setCls(classification.source === "override" ? classification.tax_class : "");
  }, [classification]);
  useEffect(() => {
    setDays(exitTerms?.[0] ? String(exitTerms[0].days) : "");
    setPct(exitTerms?.[0] ? String(exitTerms[0].pct) : "");
  }, [exitTerms]);

  async function save(body: Parameters<typeof api.saveFundSettings>[1], done: string) {
    setBusy(true);
    setMsg("");
    try {
      await api.saveFundSettings(code, body);
      setMsg(done);
      onSaved();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Could not save that.");
    } finally {
      setBusy(false);
    }
  }

  const d = Number(days);
  const p = Number(pct);
  const tierOk = Number.isInteger(d) && d > 0 && Number.isFinite(p) && p >= 0 && p <= 10;

  return (
    <fieldset className="cx-profile">
      <legend>Your entries for this fund</legend>
      <div className="cx-fields">
        <label>
          <span>Tax class</span>
          <select
            value={cls}
            disabled={busy}
            onChange={(e) => {
              setCls(e.target.value);
              void save({ tax_class: (e.target.value || null) as "equity" | "specified" | "other" | null }, e.target.value ? "Tax class saved." : "Back to the AMFI category.");
            }}
          >
            <option value="">From the AMFI category ({classification.source === "override" ? "not in use" : classification.label})</option>
            <option value="equity">Equity-oriented fund</option>
            <option value="specified">Specified mutual fund</option>
            <option value="other">Other mutual fund</option>
          </select>
          <small>Choose one if the scheme document says the category is wrong.</small>
        </label>
        <label>
          <span>Exit load: days</span>
          <input inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} placeholder="365" />
          <small>Charged when units are redeemed before this many days.</small>
        </label>
        <label>
          <span>Exit load: %</span>
          <input inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} placeholder="1" />
          <small>From the scheme information document.</small>
        </label>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
        <button type="button" className="btn secondary small" disabled={busy || !tierOk} onClick={() => save({ exit_load: [{ days: d, pct: p }] }, "Exit load saved.")}>
          Save exit load
        </button>
        {exitTerms ? (
          <button type="button" className="btn secondary small" disabled={busy} onClick={() => save({ exit_load: null }, "Exit load cleared.")}>
            Clear it
          </button>
        ) : null}
      </div>
      <p className="cx-quiet-text" role="status">{msg || "Exit load is never assumed. Until you enter it, redemptions say the information is unavailable."}</p>
    </fieldset>
  );
}
