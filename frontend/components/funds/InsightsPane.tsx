"use client";

import { useId } from "react";
import { FundHolding, FundInsight, FundInsights, FundPortfolio } from "@/lib/api";
import { categoryShort } from "@/lib/funds/category";
import { useFundInsights } from "@/lib/funds/useFundInsights";
import { concentration } from "@/lib/funds/viz";
import { VIZ } from "./viz/theme";
import { InvestorProfile, setInvestorProfile } from "@/lib/funds/local";
import { EmptyState, PanelSkeleton } from "./FundAtoms";

const AGE = [
  ["u25", "Under 25"],
  ["25-34", "25–34"],
  ["35-44", "35–44"],
  ["45-54", "45–54"],
  ["55+", "55+"],
] as const;
const HORIZON = [
  ["lt3", "Under 3 years"],
  ["3-5", "3–5 years"],
  ["5-10", "5–10 years"],
  ["10+", "10+ years"],
] as const;
const RISK = [
  ["conservative", "Conservative"],
  ["moderate", "Moderate"],
  ["aggressive", "Aggressive"],
] as const;
const OBJECTIVE = [
  ["wealth", "Wealth creation"],
  ["retirement", "Retirement"],
  ["preservation", "Capital preservation"],
  ["goal", "A short or medium-term goal"],
  ["tax", "Tax efficiency"],
  ["education", "Education"],
  ["other", "Other"],
] as const;

const SEVERITY: Record<FundInsight["severity"], string> = {
  high: "High priority",
  medium: "Worth reviewing",
  info: "Informational",
};

const TONE: Record<string, string> = { high: VIZ.red, medium: VIZ.gold, info: VIZ.teal, none: VIZ.teal };

function worst(data: FundInsights, category: string): FundInsight["severity"] | "none" {
  const hits = [...data.insights, ...data.also_noted].filter((i) => i.category === category);
  return hits.some((i) => i.severity === "high") ? "high" : hits.some((i) => i.severity === "medium") ? "medium" : hits.length ? "info" : "none";
}

/** One figure, one small bar and one line of meaning. The bar is the figure on a 0 to 100 scale, with a tick where it starts to matter. */
function Signal({ eyebrow, figure, label, fill, tick, tone, note }: { eyebrow: string; figure: string; label: string; fill: number | null; tick?: number; tone: string; note: string }) {
  return (
    <li className="vz-signal">
      <p className="vz-eyebrow">{eyebrow}</p>
      <p className="vz-signal-fig">{figure}</p>
      <p className="vz-signal-label">{label}</p>
      <div className="vz-signal-bar" aria-hidden>
        {fill != null ? <i style={{ width: `${Math.min(100, Math.max(0, fill))}%`, background: tone }} /> : null}
        {tick != null ? <b style={{ left: `${tick}%` }} /> : null}
      </div>
      <p className="vz-signal-note">{note}</p>
    </li>
  );
}

function Signals({ holdings, data }: { holdings: FundHolding[]; data: FundInsights }) {
  const conc = concentration(holdings);
  const live = holdings.filter((h) => h.data_available && h.value > 0);
  const groups = new Map<string, number>();
  for (const h of live) groups.set(categoryShort(h.scheme_category), (groups.get(categoryShort(h.scheme_category)) ?? 0) + 1);
  const biggest = [...groups.entries()].sort((a, b) => b[1] - a[1])[0];
  const suit = data.suitability;
  const regular = data.stats.regular_pct;
  return (
    <ul className="vz-signals" aria-label="Signals at a glance">
      {conc ? (
        <Signal eyebrow="Concentration" figure={`${conc.top1.toFixed(1)}%`} label="Largest fund weight" fill={conc.top1} tick={20} tone={TONE[worst(data, "Concentration")]} note={conc.top1 > 40 ? "A large share rides on one fund." : conc.top1 > 25 ? "Meaningful exposure to a single fund." : "No single fund dominates."} />
      ) : null}
      {biggest ? (
        <Signal eyebrow="Overlap" figure={`${biggest[1]} ${biggest[1] === 1 ? "fund" : "funds"}`} label={`in ${biggest[0]}`} fill={(biggest[1] / Math.max(1, live.length)) * 100} tone={TONE[worst(data, "Diversification")]} note={biggest[1] > 1 ? "Same category, so likely similar holdings. Stock-level overlap is not available here." : "No two funds share a category."} />
      ) : null}
      {suit ? (
        <Signal eyebrow="Risk" figure={`${suit.equity_pct.toFixed(0)}%`} label="Equity share of the portfolio" fill={suit.equity_pct} tick={suit.reference_high} tone={suit.status === "within" ? VIZ.teal : suit.status === "above" ? VIZ.red : VIZ.gold} note={`Reference band for your profile: ${suit.reference_low.toFixed(0)}–${suit.reference_high.toFixed(0)}%.`} />
      ) : (
        <Signal eyebrow="Risk" figure={data.stats.equity_pct != null ? `${data.stats.equity_pct.toFixed(0)}%` : "Unavailable"} label="Equity share of the portfolio" fill={data.stats.equity_pct ?? null} tone={VIZ.grey} note="Add your profile below to compare this with a reference range." />
      )}
      <Signal eyebrow="Cost" figure={regular != null ? `${regular.toFixed(0)}%` : "Unavailable"} label="Held in Regular plans" fill={regular ?? null} tone={TONE[worst(data, "Cost")]} note="Expense ratios are not published here; Direct versus Regular is the cost fact every holding has." />
    </ul>
  );
}

function ProfileForm({ profile }: { profile: InvestorProfile }) {
  const id = useId();
  const field = (key: keyof InvestorProfile, label: string, options: readonly (readonly [string, string])[]) => (
    <label htmlFor={`${id}-${key}`} className="mf-profile-field">
      <span>{label}</span>
      <select id={`${id}-${key}`} value={profile[key] ?? ""} onChange={(e) => setInvestorProfile({ [key]: e.target.value || undefined })}>
        <option value="">Prefer not to say</option>
        {options.map(([value, text]) => (
          <option key={value} value={value}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
  const answered = Object.values(profile).filter(Boolean).length;
  return (
    <section className="card mf-panel mf-profile" aria-labelledby={`${id}-t`}>
      <div className="mf-panel-head">
        <div>
          <h2 id={`${id}-t`}>Your investing context</h2>
          <p className="mf-basis">
            Optional, and kept in this browser. It is used only to compare your allocation with a reference range for your stated risk tolerance and horizon. Nothing here is a recommendation.
          </p>
        </div>
        {answered ? (
          <button type="button" className="text-btn" onClick={() => setInvestorProfile({ age: undefined, horizon: undefined, risk: undefined, objective: undefined })}>
            Clear answers
          </button>
        ) : null}
      </div>
      <div className="mf-profile-grid">
        {field("risk", "Risk tolerance", RISK)}
        {field("horizon", "Investment horizon", HORIZON)}
        {field("objective", "Main objective", OBJECTIVE)}
        {field("age", "Age range", AGE)}
      </div>
    </section>
  );
}

function SuitabilityBar({ s }: { s: NonNullable<FundInsights["suitability"]> }) {
  const eq = Math.min(100, Math.max(0, s.equity_pct));
  return (
    <section className="card mf-panel mf-suit" aria-labelledby="mf-suit-t">
      <h2 id="mf-suit-t">Allocation against your profile</h2>
      <p className="mf-basis">{s.profile}</p>
      <div className="mf-suit-bar" role="img" aria-label={`Equity ${eq.toFixed(0)}%, reference range ${s.reference_low.toFixed(0)} to ${s.reference_high.toFixed(0)}%`}>
        <i className="mf-suit-range" style={{ left: `${s.reference_low}%`, width: `${s.reference_high - s.reference_low}%` }} />
        <i className={`mf-suit-dot ${s.status}`} style={{ left: `${eq}%` }} />
      </div>
      <div className="mf-suit-scale" aria-hidden="true">
        <span>0%</span>
        <span>Equity share of portfolio</span>
        <span>100%</span>
      </div>
      <p className="mf-suit-text">{s.text}</p>
      <p className="muted mf-suit-note">
        The shaded band is an educational reference range, not a target. Hybrid and debt funds are not counted as equity because their actual equity share is not published here.
      </p>
    </section>
  );
}

function InsightCard({ item }: { item: FundInsight }) {
  return (
    <li className={`mf-insight ${item.severity}`}>
      <div className="mf-insight-head">
        <span className={`mf-sev ${item.severity}`}>{SEVERITY[item.severity]}</span>
        <span className="mf-insight-cat">{item.category}</span>
      </div>
      <h3>{item.title}</h3>
      <dl>
        <div>
          <dt>Why this matters</dt>
          <dd>{item.why}</dd>
        </div>
        <div>
          <dt>What you can review</dt>
          <dd>{item.review}</dd>
        </div>
      </dl>
      {item.evidence.length ? (
        <ul className="mf-evidence" aria-label="Numbers behind this">
          {item.evidence.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function InsightsPane({ book, taxProfile }: { book: FundPortfolio; taxProfile: { slabRatePct: number | null; incomeBand: string | null; regime: string } }) {
  const { data, error, loading, investor, retry, empty } = useFundInsights(book.holdings, taxProfile);
  const state = { data, error, loading };
  const shown = data?.insights.length ?? 0;

  return (
    <div className="funds-analysis">
      <div className="page-head">
        <div>
          <h1>Insights</h1>
          <p className="muted">What stands out about the portfolio as a whole, in order of importance. {book.disclaimer}</p>
        </div>
      </div>
      {empty ? (
        <EmptyState art="portfolio" title="Nothing to check yet">
          <p className="muted">Add a fund on the Portfolio tab and this page will point out concentration, diversification and risk, with the numbers behind each point.</p>
        </EmptyState>
      ) : (
        <>
          <ProfileForm profile={investor} />
          {state.error ? (
            <div className="banner bad" role="alert">
              {state.error}{" "}
              <button type="button" className="text-btn" onClick={retry}>
                Try again
              </button>
            </div>
          ) : null}
          {!data && state.loading ? <PanelSkeleton title="Insights" height={220} /> : null}
          {data ? (
            <>
              <Signals holdings={book.holdings} data={data} />
              {data.suitability ? <SuitabilityBar s={data.suitability} /> : null}
              <section className="card mf-panel" aria-labelledby="mf-ins-t" aria-busy={state.loading}>
                <h2 id="mf-ins-t">{shown ? `Here ${shown === 1 ? "is the one thing" : `are the ${shown} things`} worth knowing` : "Nothing stands out"}</h2>
                <p className="mf-basis">
                  Each point says why it matters and what you might review. None of it says what to buy or sell, and short-term results are not treated as a reason to change anything.
                </p>
                {shown ? (
                  <ul className="mf-insights">
                    {data.insights.map((i) => (
                      <InsightCard key={i.id} item={i} />
                    ))}
                  </ul>
                ) : (
                  <p className="banner ok mf-inline-banner">None of these checks raised a concern for the funds you hold.</p>
                )}
                {data.also_noted.length ? (
                  <details className="mf-also">
                    <summary>Also noted ({data.also_noted.length})</summary>
                    <ul className="mf-insights">
                      {data.also_noted.map((i) => (
                        <InsightCard key={i.id} item={i} />
                      ))}
                    </ul>
                  </details>
                ) : null}
              </section>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
