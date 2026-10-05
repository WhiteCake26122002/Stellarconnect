"use client";

import { CSSProperties, ReactNode, useId } from "react";
import type { Point } from "@/lib/funds/analytics";
import { assetKind, categoryShort, RISK_LABELS, RISK_SHORT, RiskLevel } from "@/lib/funds/category";
import { DATA_GAPS, GapId } from "@/lib/funds/gaps";
import { isWatched, toggleWatch, useWatchlist } from "@/lib/funds/local";
import { ArtKind, CategoryIcon, EmptyArt, StarIcon } from "./FundIcons";

const RISK_STEPS: RiskLevel[] = [1, 2, 3, 4, 5, 6];

function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = (deg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy - r * Math.sin(rad) };
}

/**
 * Riskometer-style gauge. The level is estimated from the AMFI category because the scheme's own
 * SEBI riskometer is not in the API, and the label says so.
 */
export function RiskMeter({ level, size = "sm" }: { level: RiskLevel | null; size?: "sm" | "lg" }) {
  const w = size === "lg" ? 76 : 34;
  const h = w / 2 + (size === "lg" ? 6 : 3);
  const stroke = size === "lg" ? 9 : 4.5;
  const cx = w / 2;
  const cy = w / 2;
  const r = w / 2 - stroke / 2 - 0.5;
  const gap = size === "lg" ? 2.2 : 3;
  const label = level ? RISK_LABELS[level] : "Not estimated";
  const needle = level ? polar(cx, cy, r - stroke * 0.2, 180 - (level - 0.5) * 30) : null;
  return (
    <span className={`mf-risk mf-risk-${size}${level ? "" : " none"}`} role="img" aria-label={`Risk: ${label}, estimated from the AMFI category`}>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
        {RISK_STEPS.map((step) => {
          const a = polar(cx, cy, r, 180 - (step - 1) * 30 - (step === 1 ? 0 : gap / 2));
          const b = polar(cx, cy, r, 180 - step * 30 + (step === 6 ? 0 : gap / 2));
          return (
            <path
              key={step}
              d={`M${a.x} ${a.y} A${r} ${r} 0 0 1 ${b.x} ${b.y}`}
              fill="none"
              strokeWidth={stroke}
              style={{ stroke: level ? `var(--risk-${step})` : "var(--line-strong)", opacity: level && step > level ? 0.28 : 1 }}
            />
          );
        })}
        {needle ? (
          <>
            <line x1={cx} y1={cy} x2={needle.x} y2={needle.y} strokeWidth={size === "lg" ? 2.4 : 1.6} strokeLinecap="round" style={{ stroke: "var(--ink)" }} />
            <circle cx={cx} cy={cy} r={size === "lg" ? 3.2 : 2} style={{ fill: "var(--ink)" }} />
          </>
        ) : null}
      </svg>
      <span className="mf-risk-text">
        {size === "lg" ? label : level ? RISK_SHORT[level] : "n/a"}
        {size === "lg" ? <small>Estimated from category</small> : null}
      </span>
    </span>
  );
}

/** Minimal trend line. Colour follows the direction over the window shown. */
export function Sparkline({ points, width = 96, height = 28, label }: { points: Point[]; width?: number; height?: number; label: string }) {
  if (points.length < 2) return null;
  const vs = points.map((p) => p.v);
  const lo = Math.min(...vs);
  const hi = Math.max(...vs);
  const t0 = points[0].t;
  const span = points[points.length - 1].t - t0 || 1;
  const x = (t: number) => ((t - t0) / span) * (width - 2) + 1;
  const y = (v: number) => (hi === lo ? height / 2 : height - 2 - ((v - lo) / (hi - lo)) * (height - 4));
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)}`).join("");
  const up = vs[vs.length - 1] >= vs[0];
  return (
    <svg className={`mf-spark ${up ? "bull" : "bear"}`} width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
      <line x1={1} x2={width - 1} y1={y(vs[0])} y2={y(vs[0])} className="mf-spark-base" />
      <path d={d} fill="none" />
    </svg>
  );
}

function PlugIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="mf-gap-ico">
      <path d="M6 1.5v3M10 1.5v3M4.5 4.5h7v2.5a3.5 3.5 0 0 1-7 0V4.5ZM8 10.5v4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M2 14 14 2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeDasharray="1.5 2" />
    </svg>
  );
}

/**
 * Stand-in for a panel whose inputs the API does not provide. Names the missing data and the
 * proposed endpoint so the follow-up can be tracked, and never draws placeholder numbers.
 */
export function DataGap({ title, gaps, children, as: Tag = "section" }: { title: string; gaps: GapId[]; children?: ReactNode; as?: "section" | "div" }) {
  const id = useId();
  return (
    <Tag className="card mf-gap" aria-labelledby={`${id}-t`}>
      <div className="mf-gap-head">
        <h2 id={`${id}-t`}>{title}</h2>
        <span className="mf-tag">
          <PlugIcon /> Needs backend data
        </span>
      </div>
      {children ? <div className="mf-gap-body">{children}</div> : null}
      <ul className="mf-gap-list">
        {gaps.map((g) => (
          <li key={g}>
            <strong>{DATA_GAPS[g].title}.</strong> {DATA_GAPS[g].missing}
          </li>
        ))}
      </ul>
      <details className="mf-gap-more">
        <summary>Proposed API change</summary>
        <ul>
          {gaps.map((g) => (
            <li key={g}>
              <code>{DATA_GAPS[g].proposal}</code>
            </li>
          ))}
        </ul>
      </details>
    </Tag>
  );
}

/** Inline, one-line version for table footers and compare rows. */
export function GapNote({ gaps, children }: { gaps: GapId[]; children: ReactNode }) {
  return (
    <p className="mf-gap-note">
      <PlugIcon />
      <span>
        {children} <span className="muted">Needs: {gaps.map((g) => DATA_GAPS[g].title.toLowerCase()).join(", ")}.</span>
      </span>
    </p>
  );
}

export function PanelSkeleton({ title, height = 180 }: { title: string; height?: number }) {
  return (
    <section className="card mf-panel" aria-busy="true" aria-label={`${title}, loading`}>
      <h2>{title}</h2>
      <div className="skel skel-line" style={{ width: "45%", marginTop: "0.6rem" }} />
      <div className="skel" style={{ height, marginTop: "0.8rem", borderRadius: 12 }} />
    </section>
  );
}

export function PanelEmpty({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card mf-panel">
      <h2>{title}</h2>
      <p className="muted mf-empty-line">{children}</p>
    </section>
  );
}

/**
 * Compact risk pill: six rising bars lit up to the level, tinted by the level's colour. Estimated
 * from the AMFI category, like the gauge.
 */
export function RiskBadge({ level }: { level: RiskLevel | null }) {
  const label = level ? RISK_LABELS[level] : "Not estimated";
  const style = level ? ({ "--rb": `var(--risk-${level})` } as CSSProperties) : undefined;
  return (
    <span className={`mf-riskbadge${level ? "" : " none"}`} style={style} role="img" aria-label={`Risk: ${label}, estimated from the AMFI category`}>
      <span className="mf-riskbadge-bars" aria-hidden="true">
        {RISK_STEPS.map((step) => (
          <i key={step} className={level && step <= level ? "on" : ""} style={{ height: `${30 + step * 11.5}%` }} />
        ))}
      </span>
      <span aria-hidden="true">{level ? RISK_SHORT[level] : "Risk n/a"}</span>
    </span>
  );
}

/** Category label with its asset-family glyph and tint. */
export function CategoryChip({ category, short = true }: { category: string; short?: boolean }) {
  const kind = assetKind(category);
  return (
    <span className={`mf-cls mf-cls-${kind}`}>
      <CategoryIcon kind={kind} size={14} />
      {short ? categoryShort(category) : category}
    </span>
  );
}

export type StarSubject = { code: number; name: string; house: string | null; category: string | null; nav: number | null; navDate: string | null };

/**
 * Watchlist toggle. Pass `watched` when a parent already subscribes (keeps memoised cards cheap);
 * otherwise the button reads the store itself.
 */
export function StarButton({ subject, watched, labelled = false }: { subject: StarSubject; watched?: boolean; labelled?: boolean }) {
  const list = useWatchlist();
  const on = watched ?? isWatched(list, subject.code);
  return (
    <button
      type="button"
      className={`mf-star${on ? " on" : ""}${labelled ? " labelled" : ""}`}
      aria-pressed={on}
      aria-label={labelled ? undefined : on ? `Remove ${subject.name} from watchlist` : `Add ${subject.name} to watchlist`}
      title={on ? "On your watchlist" : "Watch without buying"}
      onClick={() =>
        toggleWatch({
          code: subject.code,
          name: subject.name,
          house: subject.house,
          category: subject.category,
          navAtAdd: subject.nav,
          navDateAtAdd: subject.navDate,
        })
      }
    >
      <StarIcon filled={on} />
      {labelled ? <span>{on ? "Watching" : "Watch"}</span> : null}
    </button>
  );
}

export function EmptyState({ art, title, children, actions, compact = false }: { art: ArtKind; title: string; children?: ReactNode; actions?: ReactNode; compact?: boolean }) {
  return (
    <div className={`card mf-empty${compact ? " compact" : ""}`}>
      <EmptyArt kind={art} />
      <h2>{title}</h2>
      {children ? <div className="mf-empty-copy">{children}</div> : null}
      {actions ? <div className="mf-empty-actions">{actions}</div> : null}
    </div>
  );
}

/** Placeholder cards shaped like FundCard, so the grid does not jump when data lands. */
export function CardSkeletons({ count = 3, label = "Loading funds" }: { count?: number; label?: string }) {
  return (
    <div className="mf-cards" aria-busy="true" aria-label={label}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="card mf-card mf-card-skel" aria-hidden="true">
          <div className="mf-card-top">
            <span className="skel" style={{ width: 32, height: 32, borderRadius: 9 }} />
            <span style={{ flex: 1 }}>
              <span className="skel skel-line" style={{ display: "block", width: "82%" }} />
              <span className="skel skel-line" style={{ display: "block", width: "48%" }} />
            </span>
          </div>
          <span className="skel" style={{ display: "block", width: "42%", height: "2rem", margin: "1rem 0 0.8rem" }} />
          <span className="skel skel-line" style={{ display: "block", width: "64%" }} />
          <span className="skel" style={{ display: "block", height: "3rem", marginTop: "0.9rem", borderRadius: 10 }} />
        </div>
      ))}
    </div>
  );
}

export function KpiSkeletons({ count = 3 }: { count?: number }) {
  return (
    <div className="funds-kpis" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="kpi">
          <span className="skel skel-line" style={{ display: "block", width: "40%" }} />
          <span className="skel" style={{ display: "block", width: "70%", height: "1.5rem", margin: "0.5rem 0" }} />
          <span className="skel skel-line" style={{ display: "block", width: "55%" }} />
        </div>
      ))}
    </div>
  );
}
