"use client";

import Link from "next/link";
import { Fragment, useMemo, useState } from "react";
import type { FundHistory, FundPortfolio } from "@/lib/api";
import { DAY, parseDay } from "@/lib/funds/analytics";
import { assetKind, planType } from "@/lib/funds/category";
import { longDate, rupees, signedPoints, signedRupees, tone } from "@/lib/funds/format";
import { isWatched, useWatchlist } from "@/lib/funds/local";
import { useFundHistories } from "@/lib/funds/useFundHistory";
import { CompanyLogo } from "@/components/CompanyLogo";
import { MAX_COMPARE } from "./CompareTray";
import { StarButton } from "./FundAtoms";
import { CategoryIcon } from "./FundIcons";
import type { Row } from "./FundScreener";
import { SimilarFunds } from "./SimilarFunds";
import { VIZ } from "./viz/theme";

const W = 116;
const H = 32;

/** A year of NAV as a small line: teal if it ended higher than it started, red if lower. */
function NavSpark({ history, loading, name }: { history: FundHistory | null; loading: boolean; name: string }) {
  const pts = useMemo(() => {
    if (!history || history.points.length < 2) return [];
    const last = new Date(`${history.points[history.points.length - 1].date}T00:00:00`).getTime();
    return history.points.map((p) => ({ t: new Date(`${p.date}T00:00:00`).getTime(), v: p.nav })).filter((p) => p.t >= last - 365 * DAY);
  }, [history]);
  if (loading) return <span className="skel vz-spark-skel" aria-label="Loading NAV trend" />;
  if (pts.length < 8) return <span className="vz-na" title="Fewer than a few weeks of NAV history">—</span>;
  const lo = Math.min(...pts.map((p) => p.v));
  const hi = Math.max(...pts.map((p) => p.v));
  const t0 = pts[0].t;
  const t1 = pts[pts.length - 1].t;
  const x = (t: number) => ((t - t0) / (t1 - t0 || 1)) * (W - 2) + 1;
  const y = (v: number) => H - 3 - ((v - lo) / (hi - lo || 1)) * (H - 6);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)}`).join("");
  const up = pts[pts.length - 1].v >= pts[0].v;
  const change = (pts[pts.length - 1].v / pts[0].v - 1) * 100;
  return (
    <svg className="vz-spark" width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${name}, NAV over the last year, ${signedPoints(change, 1)}`}>
      <path d={`${d}L${x(t1)} ${H}L${x(t0)} ${H}Z`} fill={up ? VIZ.teal : VIZ.red} fillOpacity={0.1} />
      <path className="vz-spark-line" d={d} fill="none" stroke={up ? VIZ.teal : VIZ.red} strokeWidth={1.5} strokeLinejoin="round" pathLength={1} />
    </svg>
  );
}

/**
 * Holdings as rows rather than tiles: what the fund is, its last year of NAV, how big a share of the
 * portfolio it is, and what it has made. Compare, star, similar and remove sit at the end of the row.
 */
export function HoldingRows({
  rows,
  book,
  selected,
  full,
  onToggle,
  busyCode,
  onRemove,
  similar,
  toggleSimilar,
}: {
  rows: Row[];
  book: FundPortfolio;
  selected: number[];
  full: boolean;
  onToggle: (code: number) => void;
  busyCode: number | null;
  onRemove: (code: number) => Promise<void>;
  similar: number | null;
  toggleSimilar: (code: number) => void;
}) {
  const watchlist = useWatchlist();
  const histories = useFundHistories(useMemo(() => rows.map((r) => r.h.scheme_code), [rows]));
  const [pendingRemove, setPendingRemove] = useState<number | null>(null);

  return (
    <ul className="vz-rows" aria-label="Your funds">
      {rows.map((r, i) => {
        const code = r.h.scheme_code;
        const plan = planType(r.h.scheme_name);
        const checked = selected.includes(code);
        const hist = histories.get(code);
        const name = r.h.scheme_name.replace(/\s*-\s*(Direct|Regular).*$/i, "");
        return (
          <Fragment key={code}>
            <li className={`vz-row${checked ? " picked" : ""}`} style={{ animationDelay: `${Math.min(i, 8) * 35}ms` }}>
              <input
                type="checkbox"
                className="vz-row-check"
                checked={checked}
                disabled={!checked && full}
                title={!checked && full ? `Up to ${MAX_COMPARE} funds` : "Compare"}
                aria-label={`Compare ${r.h.scheme_name}`}
                onChange={() => onToggle(code)}
              />
              <div className="vz-row-id">
                <CategoryIcon kind={assetKind(r.h.scheme_category)} size={15} className="vz-row-icon" />
                <div>
                  <Link href={`/funds/${code}`} className="vz-row-name" aria-label={r.h.scheme_name} title={r.h.scheme_name}>
                    {r.h.fund_house && r.h.fund_house !== "Unknown" ? <CompanyLogo name={r.h.fund_house} size={16} className="funds-amc" /> : null}
                    {name}
                  </Link>
                  <p className="vz-row-sub">
                    {r.asset} · {r.category} · {[plan.plan, plan.option].filter(Boolean).join(" ")} · Bought {longDate(parseDay(r.h.purchase_date))}
                    {!r.h.data_available ? " · Live NAV unavailable" : ""}
                  </p>
                </div>
              </div>
              <div className="vz-row-spark">
                <NavSpark history={hist?.data ?? null} loading={!hist || hist.loading} name={name} />
                <small>1Y NAV</small>
              </div>
              <div className="vz-row-value">
                <b>{rupees(r.h.value, 0)}</b>
                <span className="vz-row-weight" aria-label={`${r.weight.toFixed(1)}% of portfolio`}>
                  <i style={{ width: `${Math.min(100, r.weight)}%`, background: r.color }} />
                </span>
                <small>{r.weight.toFixed(1)}% of portfolio</small>
              </div>
              <div className={`vz-row-gain ${tone(r.h.gain)}`}>
                <b>{r.h.gain == null ? "n/a" : signedRupees(r.h.gain)}</b>
                <small>{signedPoints(r.h.gain_pct, 1)}</small>
              </div>
              <div className="vz-row-actions">
                <StarButton subject={{ code, name: r.h.scheme_name, house: r.h.fund_house, category: r.h.scheme_category, nav: r.h.current_nav, navDate: r.h.nav_date }} watched={isWatched(watchlist, code)} />
                {pendingRemove === code ? (
                  <span className="funds-confirm">
                    <button type="button" className="btn small" disabled={busyCode === code} onClick={() => onRemove(code).then(() => setPendingRemove(null))}>
                      {busyCode === code ? "Removing…" : "Confirm"}
                    </button>
                    <button type="button" className="btn secondary small" onClick={() => setPendingRemove(null)}>
                      Cancel
                    </button>
                  </span>
                ) : (
                  <span className="vz-row-more">
                    <button type="button" className="btn ghost small" aria-expanded={similar === code} onClick={() => toggleSimilar(code)}>
                      Similar
                    </button>
                    <button type="button" className="btn ghost small" aria-label={`Remove ${r.h.scheme_name}`} onClick={() => setPendingRemove(code)}>
                      Remove
                    </button>
                  </span>
                )}
              </div>
            </li>
            {similar === code ? (
              <li className="vz-row-sub-slot">
                <SimilarFunds subject={{ code, name: r.h.scheme_name, category: r.h.scheme_category, return1y: r.h.return_1y }} holdings={book.holdings} heading={`Similar to ${r.h.scheme_name}`} />
              </li>
            ) : null}
          </Fragment>
        );
      })}
    </ul>
  );
}
