"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, FundQuote } from "@/lib/api";
import { lumpsumProjection, sipProjection } from "@/lib/funds/analytics";
import { planType } from "@/lib/funds/category";
import { rupees, rupeesCompact } from "@/lib/funds/format";
import { useReducedMotion } from "@/lib/motion";
import { FUND_PALETTE, GRID, MUTED, SUBJECT_COLOR } from "./chartTheme";
import { GapNote } from "./FundAtoms";

const PLAN_WORDS = /\b(direct|regular)\b|\bplan\b|\bgrowth\b|\boption\b|\bidcw\b|\bdividend\b|\bpayout\b|\breinvest(ment)?\b|\bincome distribution cum capital withdrawal\b/g;

/** Scheme name without plan / option wording, for matching the two plans of one scheme. */
function baseName(name: string): string {
  return name.toLowerCase().replace(PLAN_WORDS, " ").replace(/[^a-z0-9]+/g, " ").trim();
}

type Counterpart = { state: "loading" } | { state: "none" } | { state: "error"; message: string } | { state: "ok"; quote: FundQuote };

const REGULAR_COLOR = FUND_PALETTE[1];

export function DirectVsRegular({ code, name, nav }: { code: number; name: string; nav: number | null }) {
  const ids = useId();
  const reduce = useReducedMotion();
  const plan = planType(name);
  const other = plan.plan === "Direct" ? "Regular" : "Direct";
  const [cp, setCp] = useState<Counterpart>({ state: "loading" });
  const [mode, setMode] = useState<"sip" | "lump">("sip");
  const [amountText, setAmountText] = useState("10000");
  const [years, setYears] = useState(15);
  const [rateText, setRateText] = useState("12");
  const [gapText, setGapText] = useState("1");

  useEffect(() => {
    const controller = new AbortController();
    const target = baseName(name);
    const query = name.split(/\s*-\s*/)[0].trim().slice(0, 80);
    setCp({ state: "loading" });
    api
      .fundSchemes(query, controller.signal, 25)
      .then(async ({ results }) => {
        const match = results.find((hit) => {
          if (hit.code === code) return false;
          const p = planType(hit.name);
          return p.plan === other && (plan.option == null || p.option == null || p.option === plan.option) && baseName(hit.name) === target;
        });
        if (!match) {
          setCp({ state: "none" });
          return;
        }
        const quote = await api.fundQuote(match.code, controller.signal);
        setCp({ state: "ok", quote });
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setCp({ state: "error", message: err instanceof Error ? err.message : "Lookup failed." });
      });
    return () => controller.abort();
  }, [code, name, other, plan.option]);

  const amount = Number(amountText);
  const rate = Number(rateText) / 100;
  const gap = Number(gapText) / 100;
  const ok = Number.isFinite(amount) && amount >= 100 && Number.isFinite(rate) && rate > -0.3 && rate < 0.4 && Number.isFinite(gap) && gap >= 0 && gap <= 3 / 100;

  const result = useMemo(() => {
    if (!ok) return null;
    const run = (r: number) => (mode === "sip" ? sipProjection(amount, r, years) : lumpsumProjection(amount, r, years));
    const direct = run(rate);
    const regular = run(rate - gap);
    const path = direct.path.map((p, i) => ({ year: p.year, direct: p.value, regular: regular.path[i]?.value ?? null }));
    return { direct, regular, path, cost: direct.value - regular.value };
  }, [ok, mode, amount, rate, gap, years]);

  const directNav = plan.plan === "Direct" ? nav : cp.state === "ok" ? cp.quote.nav : null;
  const regularNav = plan.plan === "Regular" ? nav : cp.state === "ok" ? cp.quote.nav : null;
  const navGap = directNav != null && regularNav != null && regularNav > 0 ? (directNav / regularNav - 1) * 100 : null;

  return (
    <section className="card mf-panel mf-dvr" aria-labelledby={`${ids}-t`}>
      <h2 id={`${ids}-t`}>Direct vs Regular plan</h2>
      <p className="mf-basis">
        Same portfolio, same manager. Regular plans pay a distributor commission out of the fund every year, so they compound on a slightly lower return.
      </p>

      <div className="mf-dvr-plans">
        <div className={plan.plan === "Direct" ? "on" : ""}>
          <small>Direct{plan.plan === "Direct" ? " · this fund" : ""}</small>
          <strong>{directNav == null ? (cp.state === "loading" ? <span className="skel mf-skel-num" /> : "—") : rupees(directNav, 2)}</strong>
        </div>
        <div className={plan.plan === "Regular" ? "on" : ""}>
          <small>Regular{plan.plan === "Regular" ? " · this fund" : ""}</small>
          <strong>{regularNav == null ? (cp.state === "loading" ? <span className="skel mf-skel-num" /> : "—") : rupees(regularNav, 2)}</strong>
        </div>
        <p className="mf-dvr-verdict" aria-live="polite">
          {cp.state === "loading" ? (
            <span className="muted">Looking up the {other} plan…</span>
          ) : cp.state === "ok" ? (
            <>
              {navGap != null ? (
                <>
                  Direct NAV is <strong className={navGap >= 0 ? "bull" : "bear"}>{Math.abs(navGap).toFixed(1)}% {navGap >= 0 ? "higher" : "lower"}</strong>: part of that gap is the running cost difference, though the two plans may have launched at different times, so it is not a pure cost measure.{" "}
                </>
              ) : null}
              <Link href={`/funds/${cp.quote.scheme_code}`}>Open the {other} plan</Link>
            </>
          ) : cp.state === "none" ? (
            <span className="muted">No {other} plan of this scheme turned up in a name search.</span>
          ) : (
            <span className="error">{cp.message}</span>
          )}
        </p>
      </div>

      <div className="mf-dvr-grid">
        <div className="mf-sip-inputs">
          <div className="seg mf-seg" role="group" aria-label="Investment style">
            <button type="button" aria-pressed={mode === "sip"} onClick={() => setMode("sip")}>
              Monthly SIP
            </button>
            <button type="button" aria-pressed={mode === "lump"} onClick={() => setMode("lump")}>
              Lumpsum
            </button>
          </div>
          <label htmlFor={`${ids}-a`}>{mode === "sip" ? "Monthly amount" : "Amount"}</label>
          <span className="mf-input-prefix">
            <span aria-hidden>₹</span>
            <input id={`${ids}-a`} inputMode="numeric" value={amountText} onChange={(e) => setAmountText(e.target.value.replace(/[^\d]/g, ""))} />
          </span>
          <label htmlFor={`${ids}-y`}>
            Years <strong>{years}</strong>
          </label>
          <input id={`${ids}-y`} type="range" min={1} max={30} value={years} onChange={(e) => setYears(Number(e.target.value))} />
          <div className="mf-dvr-pair">
            <span>
              <label htmlFor={`${ids}-r`}>Direct plan return</label>
              <span className="mf-input-suffix">
                <input id={`${ids}-r`} inputMode="decimal" value={rateText} onChange={(e) => setRateText(e.target.value)} />
                <span aria-hidden>%</span>
              </span>
            </span>
            <span>
              <label htmlFor={`${ids}-g`}>Expense gap</label>
              <span className="mf-input-suffix">
                <input id={`${ids}-g`} inputMode="decimal" value={gapText} onChange={(e) => setGapText(e.target.value)} aria-describedby={`${ids}-gh`} />
                <span aria-hidden>%</span>
              </span>
            </span>
          </div>
          <p className="funds-sub muted" id={`${ids}-gh`}>
            Both are your assumptions. The scheme&apos;s real expense ratios are not in the API yet.
          </p>
          {!ok ? <p className="error">Use at least ₹100, a return between −30% and 40%, and a gap from 0 to 3%.</p> : null}
        </div>

        <div>
          {result ? (
            <>
              <div className="mf-sip-kpis">
                <div>
                  <small>Direct</small>
                  <b>{rupeesCompact(result.direct.value)}</b>
                </div>
                <div>
                  <small>Regular</small>
                  <b>{rupeesCompact(result.regular.value)}</b>
                </div>
                <div>
                  <small>Regular costs you</small>
                  <strong className="bear">{rupeesCompact(result.cost)}</strong>
                </div>
              </div>
              <p className="mf-basis">
                {(result.cost / result.direct.value * 100).toFixed(1)}% of the Direct corpus after {years} years, from a {gapText}% yearly gap. Invested either way:{" "}
                {rupeesCompact(result.direct.invested)}.
              </p>
              <div className="fund-plot">
                <ResponsiveContainer width="100%" height={170}>
                  <LineChart data={result.path} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid vertical={false} stroke={GRID} />
                    <XAxis dataKey="year" type="number" domain={[0, "dataMax"]} tickFormatter={(v: number) => `${v}y`} tick={{ fontSize: 11, fill: MUTED }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <YAxis tickFormatter={(v: number) => rupeesCompact(v)} tick={{ fontSize: 11, fill: MUTED }} axisLine={false} tickLine={false} width={64} />
                    <Tooltip
                      content={({ active, payload }) => {
                        const row = active ? (payload?.[0]?.payload as { year: number; direct: number; regular: number | null } | undefined) : undefined;
                        if (!row) return null;
                        return (
                          <div className="fund-tip">
                            <strong>Year {row.year.toFixed(row.year % 1 ? 1 : 0)}</strong>
                            <span>
                              <i style={{ background: SUBJECT_COLOR }} /> Direct <b>{rupees(row.direct, 0)}</b>
                            </span>
                            <span>
                              <i style={{ background: REGULAR_COLOR }} /> Regular <b>{row.regular == null ? "n/a" : rupees(row.regular, 0)}</b>
                            </span>
                          </div>
                        );
                      }}
                    />
                    <Line type="monotone" dataKey="direct" stroke={SUBJECT_COLOR} strokeWidth={2} dot={false} isAnimationActive={!reduce} animationDuration={300} />
                    <Line type="monotone" dataKey="regular" stroke={REGULAR_COLOR} strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={!reduce} animationDuration={300} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <ul className="alloc-legend">
                <li>
                  <i style={{ background: SUBJECT_COLOR }} />
                  <span>Direct plan</span>
                </li>
                <li>
                  <i style={{ background: REGULAR_COLOR }} />
                  <span>Regular plan (dashed)</span>
                </li>
              </ul>
            </>
          ) : null}
        </div>
      </div>
      <GapNote gaps={["expense-ratio"]}>The expense gap is an input, not the scheme&apos;s published figure.</GapNote>
    </section>
  );
}
