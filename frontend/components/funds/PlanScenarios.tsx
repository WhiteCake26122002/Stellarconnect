"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { api, FundContext, FundHolding } from "@/lib/api";
import { blendedRates, DEFAULT_INFLATION, portfolioMix, project, SCENARIOS, ScenarioId } from "@/lib/funds/plan";
import { rupees, rupeesCompact } from "@/lib/funds/format";
import { LinesChart, type LineSeries } from "./viz/LinesChart";
import { StackedBar } from "./viz/StackedBar";
import { TipRow } from "./viz/Tip";
import { VIZ } from "./viz/theme";

type Mode = "sip" | "lumpsum";

const DURATIONS = [5, 10, 15, 20, 25, 30];
const COLORS: Record<ScenarioId, string> = { conservative: VIZ.gold, base: VIZ.teal, optimistic: VIZ.blue };

function parse(text: string): number | null {
  const n = Number(text);
  return text.trim() !== "" && Number.isFinite(n) ? n : null;
}

/** Past compounding of the broad index, to set the scenario rates against something measured. */
function IndexContext({ ctx }: { ctx: FundContext | null }) {
  if (!ctx) return null;
  const rows = ctx.indices.filter((i) => i.five_year || i.ten_year);
  if (!rows.length) return <p className="mf-basis">Index history is unavailable right now, so there is no measured long-term return to set the scenarios against.</p>;
  return (
    <p className="mf-basis">
      For context, the index has compounded at{" "}
      {rows.map((i, k) => (
        <span key={i.key}>
          {k ? "; " : ""}
          <strong>{i.label}</strong>{" "}
          {[i.five_year ? `${i.five_year.cagr_pct.toFixed(1)}% a year over 5 years` : null, i.ten_year ? `${i.ten_year.cagr_pct.toFixed(1)}% over 10 years` : null].filter(Boolean).join(", ")}
        </span>
      ))}
      . {ctx.basis} Past returns do not predict future ones.
    </p>
  );
}

export function PlanScenarios({ holdings }: { holdings: FundHolding[] }) {
  const ids = useId();
  const [real, setReal] = useState(false);
  const mix = useMemo(() => portfolioMix(holdings), [holdings]);
  const defaults = useMemo(() => blendedRates(mix), [mix]);
  const [mode, setMode] = useState<Mode>("sip");
  const [amountText, setAmountText] = useState("10000");
  const [years, setYears] = useState(15);
  const [inflationText, setInflationText] = useState(String(DEFAULT_INFLATION));
  const [edited, setEdited] = useState<Partial<Record<ScenarioId, string>>>({});
  const [ctx, setCtx] = useState<FundContext | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    api
      .fundContext(controller.signal)
      .then(setCtx)
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  useEffect(() => {
    setAmountText((cur) => (mode === "lumpsum" && cur === "10000" ? "500000" : mode === "sip" && cur === "500000" ? "10000" : cur));
  }, [mode]);

  const amount = parse(amountText);
  const amountOk = amount != null && (mode === "sip" ? amount >= 100 && amount <= 10_000_000 : amount >= 1000 && amount <= 1_000_000_000);
  const inflation = parse(inflationText);
  const inflationOk = inflation != null && inflation >= 0 && inflation <= 20;
  const rateOf = (id: ScenarioId, i: number) => {
    const v = parse(edited[id] ?? String(defaults[i]));
    return v != null && v > -20 && v < 40 ? v : null;
  };
  const rates = SCENARIOS.map((s, i) => rateOf(s.id, i));
  const ordered = rates.every((r): r is number => r != null) && rates[0]! <= rates[1]! && rates[1]! <= rates[2]!;
  const ready = amountOk && inflationOk && rates.every((r) => r != null) && ordered;

  const results = useMemo(
    () => (ready ? SCENARIOS.map((s, i) => ({ id: s.id, ...project(mode, amount as number, years, rates[i] as number, inflation as number) })) : null),
    // rates is rebuilt each render; its serialised form is the real dependency
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ready, mode, amount, years, inflation, rates.join("|")],
  );

  const lines = useMemo<LineSeries[]>(() => {
    if (!results) return [];
    const at = (i: number) => results[i].path.map((p) => ({ t: p.year, v: real ? p.real : p.value }));
    return [
      { id: "optimistic", label: "Optimistic", color: COLORS.optimistic, points: at(2), width: 1.8 },
      { id: "base", label: "Base", color: COLORS.base, points: at(1), area: true, width: 2.6 },
      { id: "conservative", label: "Conservative", color: COLORS.conservative, points: at(0), width: 1.8 },
      { id: "invested", label: "Rupees put in", color: VIZ.grey, points: results[0].path.map((p) => ({ t: p.year, v: p.invested })), dash: "5 4", width: 1.4 },
    ];
  }, [results, real]);
  const yearTicks = useMemo(() => Array.from(new Set(Array.from({ length: 6 }, (_, i) => Math.round((years * i) / 5)))), [years]);

  const mixText = mix
    ? (["equity", "hybrid", "debt"] as const)
        .filter((k) => mix[k] > 0.005)
        .map((k) => `${Math.round(mix[k] * 100)}% ${k}`)
        .join(", ")
    : "no live funds, so equity is assumed";

  return (
    <section className="card mf-panel mf-plan" aria-labelledby={`${ids}-t`}>
      <div className="mf-panel-head">
        <div>
          <h2 id={`${ids}-t`}>Where this could lead</h2>
          <p className="mf-basis">
            Three scenarios, not one forecast. They show the range that different long-run returns would produce; real returns arrive unevenly and can be negative for years. These are scenarios, not predictions or guaranteed returns.
          </p>
        </div>
        <div className="seg mf-seg" role="group" aria-label="Investment style">
          <button type="button" aria-pressed={mode === "sip"} onClick={() => setMode("sip")}>
            Monthly SIP
          </button>
          <button type="button" aria-pressed={mode === "lumpsum"} onClick={() => setMode("lumpsum")}>
            Lumpsum
          </button>
        </div>
      </div>

      <div className="mf-plan-inputs">
        <label htmlFor={`${ids}-a`}>
          <span>{mode === "sip" ? "Monthly amount" : "Amount invested today"}</span>
          <span className="mf-input-prefix">
            <span aria-hidden>₹</span>
            <input id={`${ids}-a`} inputMode="numeric" value={amountText} onChange={(e) => setAmountText(e.target.value.replace(/[^\d]/g, ""))} aria-invalid={!amountOk} />
          </span>
          {!amountOk ? <small className="error">{mode === "sip" ? "Enter at least ₹100." : "Enter at least ₹1,000."}</small> : null}
        </label>
        <label htmlFor={`${ids}-y`}>
          <span>
            Duration <strong>{years} years</strong>
          </span>
          <input id={`${ids}-y`} type="range" min={1} max={30} step={1} value={years} onChange={(e) => setYears(Number(e.target.value))} list={`${ids}-ticks`} />
          <datalist id={`${ids}-ticks`}>
            {DURATIONS.map((d) => (
              <option key={d} value={d} />
            ))}
          </datalist>
        </label>
        <label htmlFor={`${ids}-i`}>
          <span>Inflation assumed</span>
          <span className="mf-input-suffix">
            <input id={`${ids}-i`} inputMode="decimal" value={inflationText} onChange={(e) => setInflationText(e.target.value)} aria-invalid={!inflationOk} />
            <span aria-hidden>%</span>
          </span>
          {!inflationOk ? <small className="error">Use 0 to 20%.</small> : <small className="muted">Used only for the today&apos;s-money figures</small>}
        </label>
      </div>

      <fieldset className="mf-plan-rates">
        <legend>Return assumed for each scenario, a year</legend>
        <div>
          {SCENARIOS.map((s, i) => (
            <label key={s.id} htmlFor={`${ids}-r-${s.id}`}>
              <span>
                <i style={{ background: COLORS[s.id] }} aria-hidden /> {s.label}
              </span>
              <span className="mf-input-suffix">
                <input
                  id={`${ids}-r-${s.id}`}
                  inputMode="decimal"
                  value={edited[s.id] ?? String(defaults[i])}
                  onChange={(e) => setEdited((cur) => ({ ...cur, [s.id]: e.target.value }))}
                  aria-invalid={rates[i] == null}
                />
                <span aria-hidden>%</span>
              </span>
            </label>
          ))}
        </div>
        <p className="mf-basis">
          Defaults blend round planning assumptions by what you hold ({mixText}): equity 8 / 11 / 14%, hybrid 6.5 / 9 / 11.5%, debt 5 / 6.5 / 7.5%. They are conventions you can overwrite, not measurements.
          {Object.keys(edited).length ? (
            <>
              {" "}
              <button type="button" className="text-btn" onClick={() => setEdited({})}>
                Reset to defaults
              </button>
            </>
          ) : null}
        </p>
        {!ordered && rates.every((r) => r != null) ? <p className="error">Keep the scenarios in order: conservative at or below base, base at or below optimistic.</p> : null}
      </fieldset>
      <IndexContext ctx={ctx} />

      {results ? (
        <>
          <div className="mf-scenarios" role="group" aria-label={`Estimated value after ${years} years`}>
            {results.map((r, i) => (
              <article key={r.id} className={`mf-scenario ${r.id}`}>
                <header>
                  <i style={{ background: COLORS[r.id] }} aria-hidden />
                  <h3>{SCENARIOS[i].label}</h3>
                  <span className="muted">{r.rate}% a year</span>
                </header>
                <strong>{rupeesCompact(r.value)}</strong>
                <p className="mf-scenario-real">≈ {rupeesCompact(r.real)} in today&apos;s money</p>
                <p className="muted">
                  Of which you put in {rupeesCompact(r.invested)}; the model adds {rupeesCompact(r.value - r.invested)}.
                </p>
              </article>
            ))}
          </div>
          <p className="mf-basis">
            At these assumptions the model estimates between {rupeesCompact(results[0].value)} and {rupeesCompact(results[2].value)} after {years} years (about {rupeesCompact(results[0].real)} to{" "}
            {rupeesCompact(results[2].real)} in today&apos;s purchasing power at {inflation}% inflation). That is a range under stated assumptions, not a forecast.
          </p>
          <div className="vz-h-row vz-plan-head">
            <p className="vz-sub">Projected value of the portfolio</p>
            <div className="seg mf-seg" role="group" aria-label="Rupee basis">
              <button type="button" aria-pressed={!real} onClick={() => setReal(false)}>
                Nominal
              </button>
              <button type="button" aria-pressed={real} onClick={() => setReal(true)}>
                Inflation adjusted
              </button>
            </div>
          </div>
          <LinesChart
            series={lines}
            height={300}
            xTickValues={yearTicks}
            yFormat={rupeesCompact}
            xFormat={(v) => `${v}y`}
            title={(t) => `After ${t} ${t === 1 ? "year" : "years"}${real ? ", in today's money" : ""}`}
            ariaLabel={`Three scenarios over ${years} years`}
            drawKey={`p:${mode}:${years}:${real}:${rates.join("|")}:${amount}`}
            rows={(_, values) => (
              <>
                {lines.map((l) => (values[l.id] != null ? <TipRow key={l.id} color={l.color} label={l.label} value={rupees(values[l.id] as number, 0)} /> : null))}
              </>
            )}
          />
          <p className="vz-hint">
            {real ? `Scenario values are divided by compounded ${inflation}% inflation to show today's purchasing power. The dashed line is the rupees you pay in, which are not adjusted.` : "Rupees at the end of each year, not adjusted for inflation."} These are scenarios under the assumptions above, not predictions.
          </p>
          <div className="vz-split-block">
            <h3 className="vz-h">Where the final amount comes from</h3>
            {results.map((r, i) => {
              const total = real ? r.real : r.value;
              const put = Math.min(r.invested, total);
              return (
                <div key={r.id} className="vz-contrib">
                  <p className="vz-sub">
                    {SCENARIOS[i].label} · {r.rate}% a year · {rupeesCompact(total)}
                  </p>
                  <StackedBar
                    ariaLabel={`Money paid in against growth at ${r.rate}% a year`}
                    height={16}
                    segments={[
                      { id: "put", label: "You put in", value: put, color: VIZ.grey, valueText: `${rupeesCompact(put)} · ${((put / total) * 100).toFixed(0)}%` },
                      { id: "grow", label: "Investment growth", value: Math.max(0, total - put), color: COLORS[r.id], valueText: `${rupeesCompact(Math.max(0, total - put))} · ${(((total - put) / total) * 100).toFixed(0)}%` },
                    ]}
                  />
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <p className="muted mf-empty-line">Fix the inputs above to see the three scenarios.</p>
      )}
    </section>
  );
}
