"use client";

import Link from "next/link";
import { CSSProperties, memo, useState } from "react";
import { CompanyLogo } from "@/components/CompanyLogo";
import type { FundHolding } from "@/lib/api";
import { assetKind, categoryRisk, categoryShort, planType } from "@/lib/funds/category";
import { longDate, rupees, signedPoints, signedRupees, tone } from "@/lib/funds/format";
import { benchView, FundRow, pts, returnView, spanText, VERDICT_LABEL, verdictTone } from "@/lib/funds/returns";
import { parseDay } from "@/lib/funds/analytics";
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
  /** The server's measurement of this fund, once the analysis has loaded. */
  perf: FundRow | undefined;
  blocked: readonly string[];
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
 * One holding, read top to bottom as: what it is, what it is worth, what it has returned, how much
 * it matters to the book, and how it compares with its own benchmark over the same dates.
 * Memoised on primitives so an analysis refresh only repaints cards whose numbers changed.
 */
export const FundCard = memo(function FundCard({
  h,
  color,
  weight,
  perf,
  blocked,
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
  const risk = h.data_available ? categoryRisk(h.scheme_category, h.scheme_name) : null;
  const ret = returnView(perf, blocked);
  const bench = benchView(perf);
  const verdict = perf?.verdict ?? "unavailable";
  const held = h.days_held ?? perf?.days_held ?? null;

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

      {h.data_available ? (
        <>
          <div className="mf-card-money">
            <div className="mf-card-value">
              <small>Current value</small>
              <strong>{rupees(h.value, 0)}</strong>
              <span className="muted">Invested {rupees(h.invested, 0)}</span>
            </div>
            <div className="mf-card-gain">
              <small>Gain / loss</small>
              <strong className={tone(h.gain)}>{signedRupees(h.gain).replace(/\.\d\d$/, "")}</strong>
              <span className={tone(h.gain_pct)}>{signedPoints(h.gain_pct, 1)}</span>
            </div>
          </div>

          <div className="mf-card-weight" title={`${weight.toFixed(1)}% of your portfolio`}>
            <i aria-hidden>
              <i style={{ width: `${Math.min(100, weight)}%` }} />
            </i>
            <span>{weight.toFixed(1)}% of portfolio</span>
          </div>

          <dl className="mf-card-facts">
            <div>
              <dt>1Y return</dt>
              <dd className={tone(h.return_1y)}>{h.return_1y == null ? <span className="muted" title="Needs a year of NAV history">n/a</span> : signedPoints(h.return_1y, 1)}</dd>
            </div>
            <div>
              <dt title={ret.note || undefined}>{ret.short}</dt>
              <dd className={tone(ret.value)}>{analysisLoaded ? signedPoints(ret.value, 1) : <span className="skel mf-skel-num" aria-label="Loading" />}</dd>
            </div>
            <div>
              <dt>Held for</dt>
              <dd>{held == null ? "n/a" : spanText(held)}</dd>
            </div>
          </dl>

          <ul className="mf-card-chips" aria-label="Category and risk">
            <li>
              <CategoryChip category={h.scheme_category} />
            </li>
            <li>
              <RiskBadge level={risk} />
            </li>
          </ul>

          <div className={`mf-card-bench ${verdict}`} aria-label="Comparison with benchmark">
            {!analysisLoaded ? (
              <span className="skel mf-skel-line" aria-label="Loading comparison" />
            ) : bench.available && perf ? (
              <>
                <div className="mf-card-bench-head">
                  <span>
                    vs {bench.label}
                    {bench.proxy ? <em title={bench.note}> (proxy)</em> : null}
                  </span>
                  <b className={verdictTone(verdict)}>{pts(perf.relative_pp)}</b>
                </div>
                <p>
                  Fund {signedPoints(perf.fund_return_pct, 1)} · Index {signedPoints(bench.value, 1)}
                  <span className="muted"> · {perf.period.days} days</span>
                </p>
                <p className={`mf-verdict ${verdictTone(verdict)}`}>{perf.verdict_text || VERDICT_LABEL[verdict]}</p>
              </>
            ) : (
              <p className="muted" title={bench.note}>
                Benchmark unavailable. {bench.note}
              </p>
            )}
          </div>
        </>
      ) : (
        <div className="mf-card-down">
          <strong>Live NAV unavailable</strong>
          <p className="muted">This scheme is left out of totals and analysis until a NAV can be fetched. Invested {rupees(h.invested, 0)}.</p>
        </div>
      )}

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
      <p className="mf-card-since">
        Bought {longDate(parseDay(h.purchase_date))} · NAV {h.current_nav == null ? "n/a" : rupees(h.current_nav, 2)}
        {h.nav_date ? ` on ${longDate(parseDay(h.nav_date))}` : ""}
      </p>
    </article>
  );
});

// ---------------------------------------------------------------------------------------------

export type WatchCardProps = {
  code: number;
  changes: { d1: number | null; m1: number | null; y1: number | null } | null;
  selected: boolean;
  compareFull: boolean;
  onCompare: (code: number) => void;
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
export const WatchCard = memo(function WatchCard({ code, changes, selected, compareFull, onCompare, name, house, category, nav, navDate, navAtAdd, addedAt, loading, failed, held, alerts, onAlert }: WatchCardProps) {
  const titleId = `mf-watch-${code}`;
  const since = nav != null && navAtAdd ? ((nav - navAtAdd) / navAtAdd) * 100 : null;
  const armed = alerts.filter((a) => !a.firedAt);
  const fired = alerts.filter((a) => a.firedAt);
  const cat = category ?? "Unknown";

  return (
    <article className={`card mf-card mf-watch${selected ? " picked" : ""}`} aria-labelledby={titleId}>
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

      <dl className="mf-card-facts">
        <div>
          <dt>1 day</dt>
          <dd className={tone(changes?.d1)}>{changes?.d1 == null ? <span className="muted">n/a</span> : signedPoints(changes.d1, 2)}</dd>
        </div>
        <div>
          <dt>1 month</dt>
          <dd className={tone(changes?.m1)}>{changes?.m1 == null ? <span className="muted">n/a</span> : signedPoints(changes.m1, 1)}</dd>
        </div>
        <div>
          <dt>1 year</dt>
          <dd className={tone(changes?.y1)}>{changes?.y1 == null ? <span className="muted" title="Needs a year of NAV history">n/a</span> : signedPoints(changes.y1, 1)}</dd>
        </div>
      </dl>
      <p className="mf-card-since">
        Added {new Date(addedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
        {since != null ? <> · {signedPoints(since, 2)} since you added it</> : null}
      </p>

      <footer className="mf-card-actions">
        <label className={`mf-check${!selected && compareFull ? " off" : ""}`} title={!selected && compareFull ? "Up to 4 schemes" : undefined}>
          <input type="checkbox" checked={selected} disabled={!selected && compareFull} onChange={() => onCompare(code)} />
          Compare
        </label>
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
          {held ? null : (
            <Link className="btn small" href={`/funds?add=${code}`}>
              Add to portfolio
            </Link>
          )}
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
