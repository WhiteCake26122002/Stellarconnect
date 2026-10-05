"use client";

import Link from "next/link";
import { CSSProperties, memo, useState } from "react";
import { CompanyLogo } from "@/components/CompanyLogo";
import type { FundHolding } from "@/lib/api";
import { assetKind, categoryRisk, categoryShort, planType } from "@/lib/funds/category";
import { rupees, rupeesCompact, signedPoints, tone } from "@/lib/funds/format";
import { clearRecent, NavAlert, RecentItem } from "@/lib/funds/local";
import { CategoryChip, RiskBadge, StarButton } from "./FundAtoms";
import { BellIcon, CategoryIcon } from "./FundIcons";

function AmcMark({ house, size = 32 }: { house: string | null | undefined; size?: number }) {
  if (house && house !== "Unknown") return <CompanyLogo name={house} size={size} className="mf-card-logo" />;
  return <span className="mf-card-logo mf-card-mono" style={{ width: size, height: size }} aria-hidden />;
}

function planText(name: string) {
  const p = planType(name);
  return [p.plan, p.option].filter(Boolean).join(" · ");
}

export type FundCardProps = {
  h: FundHolding;
  color: string;
  weight: number;
  xirr: number | null;
  alpha: number | null;
  analysisLoaded: boolean;
  selected: boolean;
  compareFull: boolean;
  watched: boolean;
  busy: boolean;
  similarOpen: boolean;
  onToggleCompare: (code: number) => void;
  onRemove: (code: number) => Promise<void>;
  onSimilar: (code: number) => void;
};

/**
 * One holding. The headline number is the trailing 1Y return (the figure people compare funds on),
 * falling back to the gain since purchase when the scheme has less than a year of NAVs.
 * Memoised on primitives so an analysis refresh only repaints cards whose XIRR changed.
 */
export const FundCard = memo(function FundCard({
  h,
  color,
  weight,
  xirr,
  alpha,
  analysisLoaded,
  selected,
  compareFull,
  watched,
  busy,
  similarOpen,
  onToggleCompare,
  onRemove,
  onSimilar,
}: FundCardProps) {
  const [confirming, setConfirming] = useState(false);
  const code = h.scheme_code;
  const titleId = `mf-card-${code}`;
  const headline = h.return_1y != null ? { v: h.return_1y, label: "1Y return" } : { v: h.gain_pct, label: "Since you bought" };
  const risk = h.data_available ? categoryRisk(h.scheme_category, h.scheme_name) : null;

  return (
    <article className={`card mf-card${selected ? " picked" : ""}`} aria-labelledby={titleId} style={{ "--mf-swatch": color } as CSSProperties}>
      <header className="mf-card-top">
        <AmcMark house={h.fund_house} />
        <div className="mf-card-id">
          <h3 id={titleId}>
            <Link href={`/funds/${code}`}>{h.scheme_name}</Link>
          </h3>
          <p>
            {h.fund_house !== "Unknown" ? `${h.fund_house} · ` : ""}
            {planText(h.scheme_name)}
          </p>
        </div>
        <StarButton
          watched={watched}
          subject={{ code, name: h.scheme_name, house: h.fund_house, category: h.scheme_category, nav: h.current_nav, navDate: h.nav_date }}
        />
      </header>

      <div className="mf-card-hero">
        {h.data_available ? (
          <div className="mf-card-stat">
            <span className={`mf-card-big ${tone(headline.v)}`}>{signedPoints(headline.v, 1)}</span>
            <small>{headline.label}</small>
          </div>
        ) : (
          <div className="mf-card-stat">
            <span className="mf-card-big muted">—</span>
            <small>Live NAV unavailable</small>
          </div>
        )}
        <RiskBadge level={risk} />
      </div>

      <ul className="mf-card-chips" aria-label="Details">
        <li>
          <CategoryChip category={h.scheme_category} />
        </li>
        {h.current_nav != null ? (
          <li className="mf-meta">
            NAV {rupees(h.current_nav, 2)}
            {h.nav_date ? <span className="muted"> · {h.nav_date}</span> : null}
          </li>
        ) : null}
      </ul>

      <dl className="mf-card-facts">
        <div>
          <dt>Value</dt>
          <dd>{rupeesCompact(h.value)}</dd>
        </div>
        <div>
          <dt>Gain</dt>
          <dd className={tone(h.gain)}>{signedPoints(h.gain_pct, 1)}</dd>
        </div>
        <div>
          <dt title="Money-weighted return since your purchase date">Your XIRR</dt>
          <dd className={tone(xirr)}>{analysisLoaded ? signedPoints(xirr, 1) : <span className="skel mf-skel-num" aria-label="Loading" />}</dd>
        </div>
        <div>
          <dt title="Your XIRR minus Nifty 500 over the same dates">vs Nifty 500</dt>
          <dd className={tone(alpha)}>
            {analysisLoaded ? (alpha == null ? "n/a" : signedPoints(alpha, 1).replace("%", " pts")) : <span className="skel mf-skel-num" aria-label="Loading" />}
          </dd>
        </div>
      </dl>

      <div className="mf-card-weight" title={`${weight.toFixed(1)}% of your portfolio`}>
        <i aria-hidden>
          <i style={{ width: `${Math.min(100, weight)}%` }} />
        </i>
        <span>{weight.toFixed(1)}% of book</span>
      </div>

      <footer className="mf-card-actions">
        {confirming ? (
          <span className="funds-confirm" role="group" aria-label={`Remove ${h.scheme_name}?`}>
            <button type="button" className="btn small" disabled={busy} onClick={() => onRemove(code).then(() => setConfirming(false))}>
              {busy ? "Removing…" : "Remove"}
            </button>
            <button type="button" className="btn secondary small" onClick={() => setConfirming(false)}>
              Keep
            </button>
          </span>
        ) : (
          <>
            <label className={`mf-check${!selected && compareFull ? " off" : ""}`} title={!selected && compareFull ? "Up to 4 funds" : undefined}>
              <input type="checkbox" checked={selected} disabled={!selected && compareFull} onChange={() => onToggleCompare(code)} />
              Compare
            </label>
            <span className="mf-card-btns">
              <button type="button" className="btn ghost small" aria-expanded={similarOpen} aria-controls={`mf-sim-${code}`} onClick={() => onSimilar(code)}>
                Similar
              </button>
              <button type="button" className="btn ghost small" aria-label={`Remove ${h.scheme_name}`} onClick={() => setConfirming(true)}>
                Remove
              </button>
            </span>
          </>
        )}
      </footer>
    </article>
  );
});

// ---------------------------------------------------------------------------------------------

export type WatchCardProps = {
  code: number;
  name: string;
  house: string | null;
  category: string | null;
  nav: number | null;
  navDate: string | null;
  navAtAdd: number | null;
  addedAt: string;
  loading: boolean;
  failed: boolean;
  held: boolean;
  alerts: NavAlert[];
  onAlert: (code: number) => void;
};

/** A starred scheme. The move since starring is the one return this desk can measure for it. */
export const WatchCard = memo(function WatchCard({ code, name, house, category, nav, navDate, navAtAdd, addedAt, loading, failed, held, alerts, onAlert }: WatchCardProps) {
  const titleId = `mf-watch-${code}`;
  const since = nav != null && navAtAdd ? ((nav - navAtAdd) / navAtAdd) * 100 : null;
  const armed = alerts.filter((a) => !a.firedAt);
  const fired = alerts.filter((a) => a.firedAt);
  const cat = category ?? "Unknown";

  return (
    <article className="card mf-card mf-watch" aria-labelledby={titleId}>
      <header className="mf-card-top">
        <AmcMark house={house} />
        <div className="mf-card-id">
          <h3 id={titleId}>
            <Link href={`/funds/${code}`}>{name}</Link>
          </h3>
          <p>
            {house && house !== "Unknown" ? `${house} · ` : ""}
            {planText(name)}
          </p>
        </div>
        <StarButton watched subject={{ code, name, house, category, nav, navDate }} />
      </header>

      <div className="mf-card-hero">
        <div className="mf-card-stat">
          {loading ? (
            <span className="skel" style={{ display: "block", width: "7rem", height: "1.9rem" }} aria-label="Loading NAV" />
          ) : failed || nav == null ? (
            <>
              <span className="mf-card-big muted">—</span>
              <small>No live NAV right now</small>
            </>
          ) : (
            <>
              <span className="mf-card-big">{rupees(nav, 2)}</span>
              <small>Latest NAV{navDate ? ` · ${navDate}` : ""}</small>
            </>
          )}
        </div>
        <RiskBadge level={category ? categoryRisk(category, name) : null} />
      </div>

      <ul className="mf-card-chips" aria-label="Details">
        {category ? (
          <li>
            <CategoryChip category={cat} />
          </li>
        ) : null}
        {held ? <li className="mf-meta mf-meta-held">In your portfolio</li> : null}
      </ul>

      <dl className="mf-card-facts two">
        <div>
          <dt>Since you starred</dt>
          <dd className={tone(since)}>{since == null ? (loading ? "…" : "n/a") : signedPoints(since, 2)}</dd>
        </div>
        <div>
          <dt>Starred</dt>
          <dd>{new Date(addedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</dd>
        </div>
      </dl>

      <footer className="mf-card-actions">
        <span className="mf-alert-state">
          {fired.length ? (
            <span className="mf-tag warn">
              <BellIcon size={13} /> {fired.length} triggered
            </span>
          ) : armed.length ? (
            <span className="mf-tag">
              <BellIcon size={13} /> {armed.map((a) => `${a.direction === "above" ? "≥" : "≤"} ${rupees(a.level, 2)}`).join(", ")}
            </span>
          ) : (
            <span className="muted">No alert set</span>
          )}
        </span>
        <span className="mf-card-btns">
          <button type="button" className="btn ghost small" onClick={() => onAlert(code)}>
            {armed.length || fired.length ? "Edit alert" : "Set alert"}
          </button>
          <Link className="btn secondary small" href={`/funds/${code}`}>
            Open
          </Link>
        </span>
      </footer>
    </article>
  );
});

// ---------------------------------------------------------------------------------------------

/** "Continue where you left off": the last schemes opened on this browser. Hidden when empty. */
export function RecentStrip({ items }: { items: readonly RecentItem[] }) {
  if (!items.length) return null;
  return (
    <section className="mf-recent" aria-labelledby="mf-recent-title">
      <div className="mf-recent-head">
        <h2 id="mf-recent-title">Continue where you left off</h2>
        <button type="button" className="text-btn" onClick={clearRecent}>
          Clear
        </button>
      </div>
      <ul className="mf-recent-list">
        {items.map((r) => {
          const kind = assetKind(r.category);
          return (
            <li key={r.code}>
              <Link href={`/funds/${r.code}`} className="mf-recent-item">
                <span className={`mf-recent-ico mf-cls-${kind}`} aria-hidden>
                  <CategoryIcon kind={kind} size={16} />
                </span>
                <span className="mf-recent-text">
                  <strong>{r.name}</strong>
                  <span className="muted">
                    {categoryShort(r.category)}
                    {r.nav != null ? ` · NAV ${rupees(r.nav, 2)}` : ""}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
