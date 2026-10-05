"use client";

import Link from "next/link";
import { useId, useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { FundHolding } from "@/lib/api";
import { lumpsumProjection, riskStats, SeriesSet, sipProjection } from "@/lib/funds/analytics";
import { assetClass, categoryShort, marketCapBucket } from "@/lib/funds/category";
import { frac, rupees, rupeesCompact, yearsText } from "@/lib/funds/format";
import { useReducedMotion } from "@/lib/motion";
import { FUND_PALETTE, GRID, MUTED, SUBJECT_COLOR } from "./chartTheme";
import { DataGap, GapNote, PanelEmpty } from "./FundAtoms";

// ---------------------------------------------------------------------------------------------
// X-ray

type Bucket = { label: string; value: number; pct: number; funds: { h: FundHolding; pct: number }[] };

function bucketize(holdings: FundHolding[], key: (h: FundHolding) => string): Bucket[] {
  const total = holdings.reduce((a, h) => a + h.value, 0);
  if (total <= 0) return [];
  const map = new Map<string, FundHolding[]>();
  for (const h of holdings) map.set(key(h), [...(map.get(key(h)) ?? []), h]);
  return Array.from(map, ([label, list]) => {
    const value = list.reduce((a, h) => a + h.value, 0);
    return {
      label,
      value,
      pct: (value / total) * 100,
      funds: list.map((h) => ({ h, pct: (h.value / total) * 100 })).sort((a, b) => b.pct - a.pct),
    };
  }).sort((a, b) => b.value - a.value);
}

function ExposureRow({ title, buckets, note }: { title: string; buckets: Bucket[]; note?: string }) {
  const [active, setActive] = useState<string | null>(null);
  const current = buckets.find((b) => b.label === active) ?? buckets[0];
  if (!buckets.length) return null;
  return (
    <div className="mf-xray-row">
      <div className="mf-xray-title">
        <h3>{title}</h3>
        {note ? <span className="muted">{note}</span> : null}
      </div>
      <div className="alloc mf-xray-bar" role="group" aria-label={`${title} buckets`}>
        {buckets.map((b, i) => (
          <button
            key={b.label}
            type="button"
            aria-pressed={current.label === b.label}
            aria-label={`${b.label}, ${b.pct.toFixed(1)}%, from ${b.funds.length} ${b.funds.length === 1 ? "fund" : "funds"}`}
            style={{ flexGrow: Math.max(b.pct, 0.6), flexBasis: 0, background: FUND_PALETTE[i % FUND_PALETTE.length] }}
            onMouseEnter={() => setActive(b.label)}
            onFocus={() => setActive(b.label)}
            onClick={() => setActive(b.label)}
          >
            {b.pct >= 12 ? <span>{b.pct.toFixed(0)}%</span> : null}
          </button>
        ))}
      </div>
      <div className="mf-xray-detail" aria-live="polite">
        <p>
          <strong>{current.label}</strong> {current.pct.toFixed(1)}%
          {current.funds.length > 1 ? <span className="mf-tag warn">{current.funds.length} funds stacked here</span> : null}
        </p>
        <ul>
          {current.funds.map(({ h, pct }) => (
            <li key={h.scheme_code}>
              <Link href={`/funds/${h.scheme_code}`}>{h.scheme_name}</Link>
              <b>{pct.toFixed(1)}%</b>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function ExposureXRay({ holdings }: { holdings: FundHolding[] }) {
  const live = holdings.filter((h) => h.data_available && h.value > 0);
  if (!live.length) {
    return <PanelEmpty title="Portfolio X-ray">Add a fund with a live NAV to see where the money sits.</PanelEmpty>;
  }
  const equity = live.filter((h) => assetClass(h.scheme_category) === "Equity");
  const equityShare = (equity.reduce((a, h) => a + h.value, 0) / live.reduce((a, h) => a + h.value, 0)) * 100;
  return (
    <section className="card mf-panel mf-xray" aria-labelledby="mf-xray-title">
      <h2 id="mf-xray-title">Portfolio X-ray</h2>
      <p className="mf-basis">
        Every held fund folded into one view. Each fund is bucketed whole by its AMFI category, so a flexi-cap fund counts entirely as flexi-cap.
      </p>
      <ExposureRow title="Asset class" buckets={bucketize(live, (h) => assetClass(h.scheme_category))} />
      {equity.length ? (
        <ExposureRow title="Equity style" note={`within the ${equityShare.toFixed(0)}% in equity`} buckets={bucketize(equity, (h) => marketCapBucket(h.scheme_category))} />
      ) : null}
      <ExposureRow title="Fund house" buckets={bucketize(live, (h) => h.fund_house)} />
      <GapNote gaps={["holdings"]}>Sector and stock-level exposure are not shown.</GapNote>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Overlap

const TRACKED_INDICES: [RegExp, string][] = [
  [/nifty\s*next\s*50/i, "Nifty Next 50"],
  [/nifty\s*midcap\s*150/i, "Nifty Midcap 150"],
  [/nifty\s*smallcap\s*250/i, "Nifty Smallcap 250"],
  [/nifty\s*500/i, "Nifty 500"],
  [/nifty\s*100(?!\d)/i, "Nifty 100"],
  [/nifty\s*bank/i, "Nifty Bank"],
  [/nifty\s*50(?!\d)/i, "Nifty 50"],
  [/sensex/i, "Sensex"],
];

const LARGE_CAP_HEAVY = new Set(["Large Cap", "Flexi Cap", "Focused", "Large & Mid Cap", "ELSS (Tax Saver)", "Multi Cap"]);

function trackedIndex(h: FundHolding): string | null {
  const c = h.scheme_category.toLowerCase();
  if (!c.includes("index") && !c.includes("etf")) return null;
  return TRACKED_INDICES.find(([re]) => re.test(h.scheme_name))?.[1] ?? null;
}

type Overlap = { a: FundHolding; b: FundHolding; level: "high" | "possible"; why: string };

function findOverlaps(holdings: FundHolding[]): Overlap[] {
  const out: Overlap[] = [];
  for (let i = 0; i < holdings.length; i++) {
    for (let j = i + 1; j < holdings.length; j++) {
      const a = holdings[i];
      const b = holdings[j];
      const ia = trackedIndex(a);
      const ib = trackedIndex(b);
      if (ia && ia === ib) {
        out.push({ a, b, level: "high", why: `Both track the ${ia}, so they hold essentially the same stocks.` });
      } else if (a.scheme_category === b.scheme_category && a.scheme_category !== "Unknown") {
        out.push({ a, b, level: "high", why: `Same category (${categoryShort(a.scheme_category)}): same stock universe and benchmark, so top holdings usually repeat.` });
      } else if (assetClass(a.scheme_category) === "Equity" && assetClass(b.scheme_category) === "Equity") {
        const ca = marketCapBucket(a.scheme_category);
        const cb = marketCapBucket(b.scheme_category);
        if (LARGE_CAP_HEAVY.has(ca) && LARGE_CAP_HEAVY.has(cb)) {
          out.push({ a, b, level: "possible", why: `${ca} and ${cb} funds both lean on the largest listed companies.` });
        }
      }
    }
  }
  return out.sort((x, y) => (x.level === y.level ? 0 : x.level === "high" ? -1 : 1));
}

export function OverlapDetector({ holdings }: { holdings: FundHolding[] }) {
  const live = holdings.filter((h) => h.data_available);
  const overlaps = findOverlaps(live);
  return (
    <>
      <section className="card mf-panel" aria-labelledby="mf-overlap-title">
        <h2 id="mf-overlap-title">Overlap between your funds</h2>
        <p className="mf-basis">A proxy from categories and tracked indices. It flags pairs likely to share holdings; it does not measure the overlap.</p>
        {live.length < 2 ? (
          <p className="muted mf-empty-line">Overlap needs at least two funds with a live NAV.</p>
        ) : overlaps.length === 0 ? (
          <p className="banner ok mf-inline-banner">No pair shares a category, a tracked index, or a large-cap tilt.</p>
        ) : (
          <ul className="mf-overlaps">
            {overlaps.map((o) => (
              <li key={`${o.a.scheme_code}-${o.b.scheme_code}`} className={o.level}>
                <span className={`mf-tag ${o.level === "high" ? "bear" : "warn"}`}>{o.level === "high" ? "Likely overlap" : "Possible overlap"}</span>
                <p>
                  <Link href={`/funds/${o.a.scheme_code}`}>{o.a.scheme_name}</Link>
                  <span aria-hidden> ↔ </span>
                  <span className="visually-hidden"> and </span>
                  <Link href={`/funds/${o.b.scheme_code}`}>{o.b.scheme_name}</Link>
                </p>
                <small>{o.why}</small>
              </li>
            ))}
          </ul>
        )}
      </section>
      <DataGap title="Holding-level overlap check" gaps={["holdings"]}>
        <p className="muted">
          Once holdings are available, any two funds whose top-10 holdings share more than 30% of weight get flagged here, with the shared names listed.
        </p>
      </DataGap>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// SIP projection

type Basis = { id: string; label: string; rate: number; caution?: string };
type PlanMode = "sip" | "lump" | "compare";

const DURATIONS = [5, 10, 15, 20, 25];
const HIGH_RATE = 0.2;
const LUMP_COLOR = FUND_PALETTE[1];
const MODES: { id: PlanMode; label: string }[] = [
  { id: "sip", label: "SIP" },
  { id: "lump", label: "Lumpsum" },
  { id: "compare", label: "Compare both" },
];

type PlanRow = { year: number; invested: number; value: number | null; lump: number | null };

export function SipPlanner({ holdings, series, loading }: { holdings: FundHolding[]; series: SeriesSet | null; loading: boolean }) {
  const reduce = useReducedMotion();
  const ids = useId();
  const bases = useMemo<Basis[]>(() => {
    const out: Basis[] = [];
    if (series) {
      const s = riskStats(series, (iv) => iv.subject, series.subject, null);
      if (s.annualized != null) out.push({ id: "portfolio", label: `Your portfolio, time-weighted over ${yearsText(s.years)}`, rate: s.annualized });
    }
    for (const h of holdings) {
      if (h.return_1y == null) continue;
      out.push({ id: `f${h.scheme_code}`, label: `${h.scheme_name}, trailing 1Y`, rate: h.return_1y / 100, caution: "A single one-year window is a volatile basis for a multi-year projection." });
    }
    return out;
  }, [holdings, series]);

  const [monthlyText, setMonthlyText] = useState("10000");
  const [years, setYears] = useState(10);
  const [basisId, setBasisId] = useState<string | null>(null);
  const [customText, setCustomText] = useState("");
  const activeId = basisId ?? bases[0]?.id ?? "custom";
  const basis = bases.find((b) => b.id === activeId) ?? null;
  const custom = Number(customText) / 100;
  const rate = activeId === "custom" ? (customText.trim() !== "" && Number.isFinite(custom) ? custom : null) : (basis?.rate ?? null);
  const monthly = Number(monthlyText);
  const monthlyOk = Number.isFinite(monthly) && monthly >= 100 && monthly <= 10_000_000;
  const rateOk = rate != null && rate > -0.5 && rate < 0.6;
  const [mode, setMode] = useState<PlanMode>("sip");
  const [lumpText, setLumpText] = useState("500000");
  const lumpInput = Number(lumpText);
  const lumpOk = Number.isFinite(lumpInput) && lumpInput >= 1000 && lumpInput <= 1_000_000_000;
  // In "compare" the lumpsum is the SIP's whole outlay on day one, so both invest the same rupees.
  const lumpAmount = mode === "compare" ? monthly * Math.round(years * 12) : lumpInput;
  const sip = rateOk && monthlyOk && mode !== "lump" ? sipProjection(monthly, rate, years) : null;
  const lump = rateOk && (mode === "lump" ? lumpOk : mode === "compare" && monthlyOk) ? lumpsumProjection(lumpAmount, rate, years) : null;
  const ready = mode === "sip" ? !!sip : mode === "lump" ? !!lump : !!(sip && lump);
  const rows: PlanRow[] = !ready
    ? []
    : mode === "lump"
      ? lump!.path.map((p) => ({ year: p.year, invested: p.invested, value: null, lump: p.value }))
      : sip!.path.map((p, i) => ({ year: p.year, invested: p.invested, value: p.value, lump: lump?.path[i]?.value ?? null }));

  return (
    <section className="card mf-panel mf-sip" aria-labelledby={`${ids}-t`}>
      <div className="mf-panel-head">
        <div>
          <h2 id={`${ids}-t`}>Investment projection</h2>
          <p className="mf-basis">What money could grow to if a past return repeated every month. An estimate, not a guarantee: real returns arrive unevenly and can be negative for years.</p>
        </div>
        <div className="seg mf-seg" role="group" aria-label="Investment style">
          {MODES.map((m) => (
            <button key={m.id} type="button" aria-pressed={mode === m.id} onClick={() => setMode(m.id)}>
              {m.label}
            </button>
          ))}
        </div>
      </div>
      <div className="mf-sip-grid">
        <div className="mf-sip-inputs">
          {mode !== "lump" ? (
            <>
              <label htmlFor={`${ids}-m`}>Monthly SIP</label>
              <span className="mf-input-prefix">
                <span aria-hidden>₹</span>
                <input id={`${ids}-m`} inputMode="numeric" value={monthlyText} onChange={(e) => setMonthlyText(e.target.value.replace(/[^\d]/g, ""))} aria-invalid={!monthlyOk} />
              </span>
              {!monthlyOk ? <p className="error">Enter at least ₹100.</p> : null}
              {mode === "compare" && monthlyOk ? <p className="funds-sub muted">Lumpsum: the same {rupeesCompact(lumpAmount)}, all on day one.</p> : null}
            </>
          ) : (
            <>
              <label htmlFor={`${ids}-l`}>Lumpsum amount</label>
              <span className="mf-input-prefix">
                <span aria-hidden>₹</span>
                <input id={`${ids}-l`} inputMode="numeric" value={lumpText} onChange={(e) => setLumpText(e.target.value.replace(/[^\d]/g, ""))} aria-invalid={!lumpOk} />
              </span>
              {!lumpOk ? <p className="error">Enter at least ₹1,000.</p> : null}
            </>
          )}

          <label htmlFor={`${ids}-y`}>
            Duration <strong>{years} years</strong>
          </label>
          <input id={`${ids}-y`} type="range" min={1} max={30} step={1} value={years} onChange={(e) => setYears(Number(e.target.value))} />

          <label htmlFor={`${ids}-b`}>Return basis</label>
          <select id={`${ids}-b`} value={activeId} onChange={(e) => setBasisId(e.target.value)}>
            {bases.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}: {frac(b.rate)}
              </option>
            ))}
            <option value="custom">Custom rate</option>
          </select>
          {loading && !bases.some((b) => b.id === "portfolio") ? <p className="muted funds-sub">Your time-weighted return is still loading.</p> : null}
          {activeId === "custom" ? (
            <>
              <label htmlFor={`${ids}-c`}>Custom annual return</label>
              <span className="mf-input-suffix">
                <input id={`${ids}-c`} inputMode="decimal" value={customText} placeholder="e.g. 10" onChange={(e) => setCustomText(e.target.value)} />
                <span aria-hidden>%</span>
              </span>
            </>
          ) : null}
          {basis?.caution && activeId !== "custom" ? <p className="funds-sub warn-text">{basis.caution}</p> : null}
          {rate != null && rate > HIGH_RATE ? (
            <p className="funds-sub warn-text">
              Sustaining {frac(rate)} a year for {years} years would be exceptional. Treat this as an upper bound.
            </p>
          ) : null}
          {rate != null && !rateOk ? <p className="error">Use a rate between −50% and 60%.</p> : null}
        </div>

        <div className="mf-sip-out">
          {!ready ? (
            <p className="muted mf-empty-line">{activeId === "custom" && rate == null ? "Enter an expected annual return to project." : "Fix the inputs to see a projection."}</p>
          ) : (
            <>
              <div className="mf-sip-kpis">
                {mode === "compare" ? (
                  <>
                    <div>
                      <small>SIP corpus</small>
                      <b style={{ color: SUBJECT_COLOR }}>{rupeesCompact(sip!.value)}</b>
                    </div>
                    <div>
                      <small>Lumpsum corpus</small>
                      <b style={{ color: LUMP_COLOR }}>{rupeesCompact(lump!.value)}</b>
                    </div>
                    <div>
                      <small>{lump!.value >= sip!.value ? "Lumpsum ahead by" : "SIP ahead by"}</small>
                      <strong>{rupeesCompact(Math.abs(lump!.value - sip!.value))}</strong>
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <small>Estimated corpus</small>
                      <strong>{rupeesCompact((sip ?? lump)!.value)}</strong>
                    </div>
                    <div>
                      <small>You invest</small>
                      <b>{rupeesCompact((sip ?? lump)!.invested)}</b>
                    </div>
                    <div>
                      <small>Estimated gain</small>
                      <b className={(sip ?? lump)!.value >= (sip ?? lump)!.invested ? "bull" : "bear"}>{rupeesCompact((sip ?? lump)!.value - (sip ?? lump)!.invested)}</b>
                    </div>
                  </>
                )}
              </div>
              {mode === "compare" ? (
                <p className="mf-basis">
                  Both put in {rupeesCompact(lumpAmount)}. At a steady positive return the lumpsum always finishes ahead, because every rupee compounds from day one. A SIP pays off when
                  prices fall early and it buys cheaper units, which a constant-rate projection cannot show.
                </p>
              ) : null}
              <div className="fund-plot">
                <ResponsiveContainer width="100%" height={180}>
                  <AreaChart data={rows} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid vertical={false} stroke={GRID} />
                    <XAxis dataKey="year" type="number" domain={[0, "dataMax"]} tickFormatter={(v: number) => `${v}y`} tick={{ fontSize: 11, fill: MUTED }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <YAxis tickFormatter={(v: number) => rupeesCompact(v)} tick={{ fontSize: 11, fill: MUTED }} axisLine={false} tickLine={false} width={64} />
                    <Tooltip
                      content={({ active, payload }) => {
                        const row = active ? (payload?.[0]?.payload as PlanRow | undefined) : undefined;
                        if (!row) return null;
                        return (
                          <div className="fund-tip">
                            <strong>Year {row.year.toFixed(row.year % 1 ? 1 : 0)}</strong>
                            {row.value != null ? (
                              <span>
                                <i style={{ background: SUBJECT_COLOR }} /> {mode === "compare" ? "SIP" : "Estimated value"} <b>{rupees(row.value, 0)}</b>
                              </span>
                            ) : null}
                            {row.lump != null ? (
                              <span>
                                <i style={{ background: LUMP_COLOR }} /> {mode === "compare" ? "Lumpsum" : "Estimated value"} <b>{rupees(row.lump, 0)}</b>
                              </span>
                            ) : null}
                            <span>
                              <i style={{ background: MUTED }} /> {mode === "compare" ? "SIP invested" : "Invested"} <b>{rupees(row.invested, 0)}</b>
                            </span>
                          </div>
                        );
                      }}
                    />
                    <Area type="monotone" dataKey="invested" stroke={MUTED} fill={MUTED} fillOpacity={0.12} strokeWidth={1.4} isAnimationActive={!reduce} animationDuration={300} />
                    {mode !== "lump" ? (
                      <Area type="monotone" dataKey="value" stroke={SUBJECT_COLOR} fill={SUBJECT_COLOR} fillOpacity={0.16} strokeWidth={2} isAnimationActive={!reduce} animationDuration={300} />
                    ) : null}
                    {mode !== "sip" ? (
                      <Area type="monotone" dataKey="lump" stroke={LUMP_COLOR} fill={LUMP_COLOR} fillOpacity={mode === "compare" ? 0.06 : 0.16} strokeWidth={2} isAnimationActive={!reduce} animationDuration={300} />
                    ) : null}
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              {mode === "compare" ? (
                <ul className="alloc-legend">
                  <li>
                    <i style={{ background: SUBJECT_COLOR }} />
                    <span>SIP of {rupeesCompact(monthly)} a month</span>
                  </li>
                  <li>
                    <i style={{ background: LUMP_COLOR }} />
                    <span>Lumpsum of {rupeesCompact(lumpAmount)}</span>
                  </li>
                </ul>
              ) : null}
              {mode === "sip" ? <SipGrid monthly={monthly} rate={rate as number} years={years} /> : null}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function SipGrid({ monthly, rate, years }: { monthly: number; rate: number; years: number }) {
  const amounts = [monthly / 2, monthly, monthly * 2].map((a) => Math.round(a));
  return (
    <div className="mf-table-wrap">
      <table className="mf-sip-table">
        <caption>
          Estimated corpus at {frac(rate)} a year. Sensitivity: ±2 pts moves the {years}-year figure to {rupeesCompact(sipProjection(monthly, rate - 0.02, years).value)} –{" "}
          {rupeesCompact(sipProjection(monthly, rate + 0.02, years).value)}.
        </caption>
        <thead>
          <tr>
            <th scope="col">Monthly</th>
            {DURATIONS.map((d) => (
              <th key={d} scope="col" className={d === years ? "on" : ""}>
                {d}y
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {amounts.map((a) => (
            <tr key={a} className={a === Math.round(monthly) ? "on" : ""}>
              <th scope="row">{rupeesCompact(a)}</th>
              {DURATIONS.map((d) => (
                <td key={d} className={d === years && a === Math.round(monthly) ? "hit" : ""}>
                  {rupeesCompact(sipProjection(a, rate, d).value)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
