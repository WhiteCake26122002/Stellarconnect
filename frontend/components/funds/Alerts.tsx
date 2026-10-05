"use client";

import Link from "next/link";
import { FormEvent, useEffect, useId, useRef, useState } from "react";
import { rupees } from "@/lib/funds/format";
import { addAlert, alertHit, checkAlerts, NavAlert, rearmAlert, removeAlert, useAlerts } from "@/lib/funds/local";
import { GapNote } from "./FundAtoms";
import { BellIcon } from "./FundIcons";

export type NavQuote = { nav: number; date: string | null };

/** Fire any armed alert the NAVs on screen already satisfy. `navs` must be memoised by the caller. */
export function useAlertCheck(navs: Map<number, NavQuote>) {
  useEffect(() => {
    if (navs.size) checkAlerts(navs);
  }, [navs]);
}

export function AlertEditor({ code, name, nav, navDate, headingLevel = 2 }: { code: number; name: string; nav: number | null; navDate: string | null; headingLevel?: 2 | 3 }) {
  const ids = useId();
  const all = useAlerts();
  const mine = all.filter((a) => a.code === code);
  const [direction, setDirection] = useState<NavAlert["direction"]>("above");
  const [levelText, setLevelText] = useState(() => (nav ? (nav * 1.05).toFixed(2) : ""));
  const [error, setError] = useState("");
  const H = headingLevel === 2 ? "h2" : "h3";
  const level = Number(levelText);
  const immediate = nav != null && Number.isFinite(level) && level > 0 && alertHit({ direction, level }, nav);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!Number.isFinite(level) || level <= 0) {
      setError("Enter a NAV above zero.");
      return;
    }
    if (mine.some((a) => !a.firedAt && a.direction === direction && a.level === level)) {
      setError("That alert is already set.");
      return;
    }
    setError("");
    addAlert({ code, name, direction, level });
  }

  return (
    <div className="mf-alerts">
      <H className="mf-alerts-title">
        <BellIcon /> NAV alerts
      </H>
      <p className="mf-basis">
        {nav != null ? (
          <>
            Latest NAV {rupees(nav, 4)}
            {navDate ? ` on ${navDate}` : ""}.{" "}
          </>
        ) : null}
        Checked each time you open Mutual funds.
      </p>
      {mine.length ? (
        <ul className="mf-alert-list">
          {mine.map((a) => (
            <li key={a.id} className={a.firedAt ? "fired" : ""}>
              <span>
                NAV {a.direction} <strong>{rupees(a.level, 2)}</strong>
                {a.firedAt ? (
                  <span className="mf-tag warn">
                    Triggered at {rupees(a.firedNav, 2)}
                    {a.firedNavDate ? ` · ${a.firedNavDate}` : ""}
                  </span>
                ) : (
                  <span className="mf-tag">Watching</span>
                )}
              </span>
              <span className="mf-alert-actions">
                {a.firedAt ? (
                  <button type="button" className="btn ghost small" onClick={() => rearmAlert(a.id)}>
                    Watch again
                  </button>
                ) : null}
                <button type="button" className="btn ghost small" aria-label={`Delete alert: NAV ${a.direction} ${rupees(a.level, 2)}`} onClick={() => removeAlert(a.id)}>
                  Delete
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <form className="mf-alert-form" onSubmit={onSubmit} noValidate>
        <span className="mf-alert-sentence" id={`${ids}-lead`}>
          Tell me when NAV goes
        </span>
        <label className="mf-select">
          <span className="visually-hidden">Direction</span>
          <select value={direction} onChange={(e) => setDirection(e.target.value as NavAlert["direction"])} aria-describedby={`${ids}-lead`}>
            <option value="above">above</option>
            <option value="below">below</option>
          </select>
        </label>
        <span className="mf-input-prefix">
          <span aria-hidden>₹</span>
          <input
            inputMode="decimal"
            value={levelText}
            onChange={(e) => setLevelText(e.target.value)}
            aria-label="NAV level"
            aria-invalid={!!error}
            aria-describedby={error ? `${ids}-err` : immediate ? `${ids}-now` : undefined}
          />
        </span>
        <button type="submit" className="btn small">
          Add alert
        </button>
      </form>
      {error ? (
        <p className="error" id={`${ids}-err`}>
          {error}
        </p>
      ) : immediate ? (
        <p className="funds-sub warn-text" id={`${ids}-now`}>
          NAV is already {direction} this level, so it will trigger on your next visit.
        </p>
      ) : null}
      <fieldset className="mf-alert-more" disabled>
        <legend className="visually-hidden">Other alerts, not available yet</legend>
        <label>
          <input type="checkbox" /> Expense ratio changes
        </label>
        <label>
          <input type="checkbox" /> Rating changes
        </label>
        <span className="mf-tag">Needs backend data</span>
      </fieldset>
      <GapNote gaps={["alerts-service", "expense-ratio", "rating"]}>No email or push yet, and no expense-ratio or rating alerts.</GapNote>
    </div>
  );
}

/** Modal wrapper for the watchlist. Native <dialog> gives focus trap, Escape and inert background. */
export function AlertDialog({ subject, onClose }: { subject: { code: number; name: string; nav: number | null; navDate: string | null } | null; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (subject && !el.open) el.showModal();
    if (!subject && el.open) el.close();
  }, [subject]);

  return (
    <dialog
      ref={ref}
      className="mf-dialog mf-dialog-sm"
      aria-label={subject ? `Alerts for ${subject.name}` : "Alerts"}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {subject ? (
        <div className="mf-dialog-body">
          <div className="mf-dialog-head">
            <p className="mf-dialog-kicker">{subject.name}</p>
            <button type="button" className="ico-btn mf-close" aria-label="Close alerts" onClick={onClose}>
              ×
            </button>
          </div>
          <AlertEditor code={subject.code} name={subject.name} nav={subject.nav} navDate={subject.navDate} />
        </div>
      ) : null}
    </dialog>
  );
}

/** Alerts that fired, shown on every tab of the desk until dismissed or re-armed. */
export function TriggeredAlerts() {
  const fired = useAlerts().filter((a) => a.firedAt);
  if (!fired.length) return null;
  return (
    <section className="mf-fired" aria-labelledby="mf-fired-title" role="status">
      <h2 id="mf-fired-title" className="visually-hidden">
        Triggered alerts
      </h2>
      <ul>
        {fired.map((a) => (
          <li key={a.id}>
            <BellIcon />
            <span>
              <Link href={`/funds/${a.code}`}>{a.name}</Link> NAV is {a.direction} {rupees(a.level, 2)}: {rupees(a.firedNav, 2)}
              {a.firedNavDate ? ` on ${a.firedNavDate}` : ""}.
            </span>
            <span className="mf-alert-actions">
              <button type="button" className="btn ghost small" onClick={() => rearmAlert(a.id)}>
                Watch again
              </button>
              <button type="button" className="btn ghost small" onClick={() => removeAlert(a.id)}>
                Dismiss
              </button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
