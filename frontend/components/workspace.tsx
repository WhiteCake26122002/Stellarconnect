"use client";

import {
  Fragment,
  useEffect,
  useId,
  useRef,
  useState,
  type AnimationEvent,
  type FormEvent,
  type RefObject,
} from "react";
import type { ShellSurface } from "@/components/AppShell";
import {
  ComparePrices,
  Heatmap,
  LabeledBars,
  QualityRing,
  RevenueLine,
  SensitivityGrid,
  Waterfall,
  currentPrice,
  nearestValue,
  revenuePoints,
  type Point,
} from "@/components/charts";
import { CompanyGuidanceBadge } from "@/components/CompanyGuidancePanel";
import { flagsToReview } from "@/components/guide/DataCheckNotice";
import { GlossaryIcon, PlainNote, Term } from "@/components/guide/Glossary";
import { downloadExport } from "@/lib/api";
import type { GlossaryId } from "@/lib/glossary";
import { useSimple } from "@/lib/prefs";
import type { Drivers, Workspace } from "@/lib/api";
import {
  compactMoney,
  currencySymbol,
  fyLong,
  fyShort,
  lineLabel,
  pct,
  perShare,
  scaled,
  signedPct,
  signedPts,
} from "@/lib/format";
import {
  bridgeOf,
  erpForWacc,
  growthShiftOverrides,
  histFcff,
  intrinsicBlocked,
  num,
  residualNegative,
  seriesCagr,
  waccOf,
} from "@/lib/model";

/** Inputs as they were before the first what-if drag, so Reset can put them back. */
export type WhatIfBase = { growth: number[]; overrides: (number | null)[]; wacc: number; erp: number; g: number };

type WhatIfProps = {
  busy: boolean;
  base: RefObject<WhatIfBase | null>;
  onPatch: (body: Record<string, unknown>) => void;
};

function WhatIfStrip({ model, busy, base, onPatch }: { model: Workspace } & WhatIfProps) {
  const simple = useSimple();
  const years = model.forecast.years;
  const wacc0 = waccOf(model).wacc;
  const [touched, setTouched] = useState(() => base.current != null);
  const [dg, setDg] = useState(() => (base.current && years[0] ? num(years[0], "revenue_growth") - base.current.growth[0] : 0));
  const [wacc, setWacc] = useState(wacc0);
  const [g, setG] = useState(model.drivers.terminal_growth);
  const [msg, setMsg] = useState("");

  const from = base.current ?? { growth: years.map((y) => num(y, "revenue_growth")), wacc: wacc0, erp: model.drivers.equity_risk_premium, g };
  const slope = waccOf(model).equity_weight * model.drivers.beta;
  const waccMin = Math.max(g + 0.01, from.wacc - 0.03, slope > 0 ? from.wacc - from.erp * slope : -Infinity);
  const waccMax = from.wacc + 0.03;
  const gMax = Math.min(model.drivers.terminal_growth_ceiling || 0.06, wacc - 0.01);
  const erpNow = erpForWacc(model, wacc, { wacc: from.wacc, erp: from.erp });

  function snapshot(): WhatIfBase {
    if (!base.current) {
      base.current = {
        growth: years.map((y) => num(y, "revenue_growth")),
        overrides: [...model.drivers.year_overrides.revenue_growth],
        wacc: wacc0,
        erp: model.drivers.equity_risk_premium,
        g: model.drivers.terminal_growth,
      };
      setTouched(true);
    }
    return base.current;
  }

  function onGrowth(v: number) {
    const b = snapshot();
    setDg(v);
    setMsg("");
    onPatch({ year_overrides: { revenue_growth: Math.abs(v) < 1e-9 ? b.overrides : growthShiftOverrides(model, v, b.growth) } });
  }

  function onWacc(v: number) {
    const b = snapshot();
    const erp = erpForWacc(model, v, b);
    setWacc(v);
    if (erp == null) {
      setMsg(`WACC ${pct(v)} would need a negative equity risk premium.`);
      return;
    }
    setMsg("");
    onPatch({ equity_risk_premium: erp });
  }

  function onG(v: number) {
    snapshot();
    setG(v);
    setMsg("");
    onPatch({ terminal_growth: v });
  }

  function reset() {
    const b = base.current;
    if (!b) return;
    onPatch({ year_overrides: { revenue_growth: b.overrides }, equity_risk_premium: b.erp, terminal_growth: b.g });
    setDg(0);
    setWacc(b.wacc);
    setG(b.g);
    setMsg("");
    base.current = null;
    setTouched(false);
  }

  const y1 = (from.growth[0] ?? 0) + dg;
  return (
    <section className="whatif" aria-label="What-if sliders">
      <div className="whatif-head">
        <p className="rev-kicker">What if?</p>
        <p className="note" aria-live="polite">
          {busy ? "Recalculating…" : msg || (touched ? "Saved to this model." : "Drag to try your own numbers. Changes save to this model.")}
        </p>
        {touched ? (
          <button type="button" className="btn ghost small" onClick={reset} disabled={busy}>
            Reset to where you started
          </button>
        ) : null}
      </div>
      <div className="whatif-grid">
        <WhatIfSlider
          label={simple ? "Sales growth" : "Revenue growth"}
          value={dg}
          min={-0.05}
          max={0.05}
          step={0.0025}
          readout={signedPts(dg)}
          help={simple ? `Next year's growth becomes ${pct(y1)}.` : `Y1 ${pct(y1)}; every explicit year shifted, last stays at g.`}
          onChange={onGrowth}
        />
        <WhatIfSlider
          label="WACC"
          term="wacc"
          value={Math.min(Math.max(wacc, waccMin), waccMax)}
          min={waccMin}
          max={waccMax}
          step={0.001}
          readout={pct(wacc)}
          help={
            simple
              ? "The rate future cash is shrunk by. Set through the equity risk premium."
              : `Solved via ERP ${erpNow == null ? "n/a" : pct(erpNow)}; beta, weights and Kd held fixed.`
          }
          onChange={onWacc}
        />
        <WhatIfSlider
          label={simple ? "Terminal growth" : "Terminal g"}
          term="terminal_growth"
          value={Math.min(g, gMax)}
          min={0}
          max={gMax}
          step={0.001}
          readout={pct(g)}
          help={simple ? "Growth assumed forever after the forecast." : "Gordon g for the last explicit year and TV; kept below WACC."}
          onChange={onG}
        />
      </div>
    </section>
  );
}

function WhatIfSlider({
  label,
  term,
  value,
  min,
  max,
  step,
  readout,
  help,
  onChange,
}: {
  label: string;
  term?: GlossaryId;
  value: number;
  min: number;
  max: number;
  step: number;
  readout: string;
  help: string;
  onChange: (v: number) => void;
}) {
  const id = useId();
  return (
    <div className="whatif-field">
      <div className="whatif-label">
        <label htmlFor={id}>{term ? <Term id={term}>{label}</Term> : label}</label>
        <b>{readout}</b>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuetext={readout}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <p className="note">{help}</p>
    </div>
  );
}

export function Dashboard({
  model,
  onOpen,
  whatIf,
}: {
  model: Workspace;
  onOpen: (s: ShellSurface, driver?: string) => void;
  whatIf?: WhatIfProps;
}) {
  const [scenario, setScenario] = useState<"Bear" | "Base" | "Bull">("Base");
  const [revI, setRevI] = useState<number | null>(null);
  const simple = useSimple();
  const blocked = intrinsicBlocked(model);
  const residual = residualNegative(model);
  const bridge = bridgeOf(model);
  const impliedBase = blocked || residual ? null : bridge.equity_value_per_share;
  const implied = blocked || residual ? null : scenario === "Base" ? impliedBase : scenarioPrice(model, scenario);
  const sym = currencySymbol(model.display.currency);
  const div = model.display.scale_divisor;
  const rev = revenuePoints(model);
  const lastHist = rev.reduce((acc, p, i) => (p.kind === "hist" ? i : acc), Math.max(0, rev.length - 1));
  const active = revI == null ? lastHist : revI;
  const point = rev[active];
  const prior = active > 0 ? rev[active - 1] : null;
  const yoy =
    point && prior && Math.abs(prior.value) > 0 ? (point.value - prior.value) / Math.abs(prior.value) : null;
  const filed = rev[lastHist];
  const modeled = rev[rev.length - 1];
  const spanCagr = seriesCagr(rev.map((p) => p.value));
  const histN = rev.filter((p) => p.kind === "hist").length;
  const fwdN = rev.length - histN;

  return (
    <div>
      <div className="verdict-row">
        <VerdictBook model={model} onOpen={onOpen} />
        <article className="card iv-card" data-tour="answer">
          <ComparePrices
            name={model.ticker || model.name}
            implied={implied}
            market={bridge.current_share_price}
            symbol={sym}
            scenario={scenario}
            onScenario={setScenario}
            presentation={model.equity_presentation}
          />
          {whatIf && !blocked ? <WhatIfStrip model={model} {...whatIf} /> : null}
          {residual ? <NegativeEquityPanel model={model} /> : null}
          <ReliabilityStrip model={model} onOpen={onOpen} />
        </article>
      </div>

      <div className="dash-grid">
        <article className="card chart-card">
          <div className="chart-head">
            <div>
              <h2>Historical vs. Forecast Revenue</h2>
              <p className="note">
                Figures in {model.display.scale_label} · {spanLabel(model)}
              </p>
            </div>
            <div className="legend-dots">
              <span>
                <i className="hist" /> Historical
              </span>
              <span>
                <i className="fwd" /> Forecast
              </span>
            </div>
          </div>
          <RevenueLine
            points={rev}
            title="Historical vs forecast revenue"
            format={(v) => scaled(v, div)}
            hover={active}
            onHover={setRevI}
          />
        </article>
        <aside className="card rev-span">
          <p className="rev-kicker">{point?.kind === "forecast" ? "Forecast year" : "Filed year"}</p>
          <h2>{point ? fyLong(point.label) : "Revenue"}</h2>
          {point ? <p className="rev-figure">{scaled(point.value, div)}</p> : null}
          {yoy != null ? (
            <p className={`rev-yoy${yoy < 0 ? " down" : ""}`}>
              {signedPct(yoy)} vs {prior ? fyShort(prior.label) : "prior"}
            </p>
          ) : (
            <p className="rev-copy">First year in the series.</p>
          )}
          {filed && modeled ? (
            <div className="rev-bridge">
              <div>
                <span>{fyShort(filed.label)}</span>
                <b>{scaled(filed.value, div)}</b>
                <em>Last filing</em>
              </div>
              <i aria-hidden />
              <div>
                <span>{fyShort(modeled.label)}</span>
                <b>{scaled(modeled.value, div)}</b>
                <em>Last modeled</em>
              </div>
            </div>
          ) : null}
          <p className="rev-copy">
            {!simple ? (
              spanCagr != null ? `CAGR ${pct(spanCagr)} across ${rev.length} years.` : "No CAGR on this series."
            ) : spanCagr != null ? (
              <>
                <Term id="cagr">CAGR</Term>
                {` ${pct(spanCagr)} across ${rev.length} years.`}
              </>
            ) : (
              <>
                {"No "}
                <Term id="cagr">CAGR</Term>
                {" on this series."}
              </>
            )}{" "}
            {histN} reported, {fwdN} forecast. The year on the line stays put when you leave.
          </p>
        </aside>
      </div>
    </div>
  );
}

export function DcfView({
  model,
  onApplyGrowth,
  onOpen,
}: {
  model: Workspace;
  onApplyGrowth: (g: number) => void;
  onOpen: (s: ShellSurface, driver?: string) => void;
}) {
  const div = model.display.scale_divisor;
  const india = model.display.is_india;
  const sym = currencySymbol(model.display.currency);
  const moneyOpts = { divisor: div, isIndia: india };
  const blocked = intrinsicBlocked(model);
  const bridge = bridgeOf(model);
  const hist = model.historicals.cash_flows.map((r) => ({
    label: String(r.period),
    value: histFcff(r),
    kind: "hist" as const,
  }));
  const fwd = model.forecast.years.map((r) => ({
    label: String(r.period),
    value: num(r, "fcff"),
    kind: "forecast" as const,
  }));
  const points = [...hist, ...fwd].filter((p) => Number.isFinite(p.value));
  const cagr = seriesCagr(points.map((p) => p.value));
  const pvFcf = Number(model.valuation?.pv_of_explicit_fcf);

  return (
    <div>
      <div className="dcf-grid">
        <article className="card chart-card">
          <div className="chart-head">
            <div>
              <h2>
                <Term id="fcff">Unlevered Free Cash Flow Projection</Term>
              </h2>
              <p className="note">
                {model.display.scale_label} · {spanLabel(model)}
                {cagr != null ? ` (CAGR: ${pct(cagr)})` : ""}
              </p>
            </div>
            <span className="pill">Forecast Active</span>
          </div>
          <LabeledBars points={points} title="Unlevered free cash flow projection" format={(v) => scaled(v, div)} onSelect={() => onOpen("forecast")} />
        </article>
        <article className="card">
          <Heatmap model={model} onApplyGrowth={onApplyGrowth} bare />
        </article>
      </div>
      <div className="dcf-grid">
        <article className="card">
          <h2>
            <Term id="equity_bridge">DCF Bridge &amp; Equity Value Buildup</Term>
          </h2>
          <p className="note">
            Step-by-step breakdown from PV of FCFs to final Equity Value ({model.display.scale_label}). Hover a bar for what it
            means.
          </p>
          <Waterfall
            divisor={div}
            items={[
              { label: `PV of ${fwd.length}Yr FCFs`, value: pvFcf, term: "pv_explicit_fcf" },
              { label: "PV of terminal value", value: Number(model.valuation?.pv_of_terminal_value), term: "terminal_value" },
              { label: "Enterprise value", value: Number(model.valuation?.enterprise_value), term: "enterprise_value" },
              { label: "Cash & cash-like", value: bridge.plus_cash_and_investments, term: "bridge_cash" },
              { label: "Non-operating investments", value: bridge.plus_non_operating_investments || 0, term: "non_operating_investments" },
              { label: "Total debt", value: -(bridge.less_total_debt || 0), term: "total_debt" },
              { label: "Leases", value: -(bridge.less_lease_liabilities || 0), term: "leases" },
              { label: "Minority interest", value: -(bridge.less_minority_interest || 0), term: "minority_interest" },
              { label: "Preferred", value: -(bridge.less_preferred_stock || 0), term: "preferred_stock" },
              { label: "Equity value", value: bridge.equity_value, term: "equity_value" },
            ]}
          />
          {blocked ? (
            <p className="iv-blocked">
              Intrinsic value: BLOCKED / NOT RELIABLE. Operating DCF and enterprise value remain visible.
              {bridge.block_reason ? ` ${bridge.block_reason}` : ""}
            </p>
          ) : residualNegative(model) ? (
            <NegativeEquityPanel model={model} />
          ) : null}
          {!blocked && model.bridge_substitutes?.length ? (
            <p className="note">{model.bridge_substitutes.join(" ")}</p>
          ) : null}
        </article>
        <article className="card">
          <h2>Model Verification &amp; Quality</h2>
          <QualityAudit model={model} compact onOpen={onOpen} />
          <p className="note" style={{ marginTop: "0.85rem" }}>
            {blocked
              ? bridge.block_reason || "Intrinsic value per share is blocked until required inputs are verified."
              : residualNegative(model)
                ? "Residual equity value is negative. This is not floored to zero and is not a stock target."
                : `Implied ${perShare(bridge.equity_value_per_share, sym)} vs market ${perShare(bridge.current_share_price, sym)}.`}
          </p>
        </article>
      </div>
      <div className="grid forensic-grid">
        {model.model_health ? <ModelHealthGate model={model} /> : null}
        {model.cyclical_normalization ? <CyclicalCard model={model} /> : null}
        <ScenarioRangeCard model={model} />
        {model.valuation_confidence ? <ValuationConfidenceCard model={model} /> : null}
        {model.asset_classification ? <AssetBridgeCard model={model} /> : null}
        {model.wacc_audit ? <WaccAuditCard model={model} /> : null}
      </div>
    </div>
  );
}

export function Historical({ model, onOpen }: { model: Workspace; onOpen: (s: ShellSurface) => void }) {
  const div = model.display.scale_divisor;
  const points = revenuePoints(model).filter((p) => p.kind === "hist");
  return (
    <div className="grid">
      <GrowthEvidenceCard model={model} />
      <article className="card">
        <div className="chart-head">
          <div>
            <h2>Historical revenue</h2>
            <p className="note">{model.display.scale_label}</p>
          </div>
        </div>
        <LabeledBars points={points} title="Historical revenue" format={(v) => scaled(v, div)} onSelect={() => onOpen("financials")} />
      </article>
      <Statements model={model} />
    </div>
  );
}

function lineUnavailable(key: string, raw: Record<string, unknown>): boolean {
  if (key === "cash") return raw.cash_status === "unavailable" || raw.cash_reported === false;
  if (key === "long_term_debt" || key === "short_term_debt") return raw.debt_status === "unavailable";
  if (key === "accounts_receivable" || key === "accounts_payable" || key === "inventory") {
    return raw.nwc_status === "unavailable" || raw.operating_wc_complete === false;
  }
  return false;
}

export function Statements({
  model,
  onSaveHistoricals,
  saving,
}: {
  model: Workspace;
  onSaveHistoricals?: (body: Record<string, unknown>) => Promise<void>;
  saving?: boolean;
}) {
  const [book, setBook] = useState<"income" | "balance" | "cash">("income");
  const [editing, setEditing] = useState(false);
  const div = model.display.scale_divisor;
  const books = {
    income: {
      title: "Income statement",
      rows: model.historicals.income_statements,
      keys: ["revenue", "cogs", "rnd", "sm", "ga", "other_opex", "da", "interest_expense", "taxes"],
    },
    balance: {
      title: "Balance sheet",
      rows: model.historicals.balance_sheets,
      keys: [
        "cash",
        "marketable_securities",
        "accounts_receivable",
        "inventory",
        "ppe",
        "non_operating_investments",
        "other_assets",
        "accounts_payable",
        "short_term_debt",
        "long_term_debt",
        "lease_liabilities",
        "shareholders_equity",
      ],
    },
    cash: { title: "Cash flow", rows: model.historicals.cash_flows, keys: ["net_income", "da", "change_in_nwc", "capex", "dividends"] },
  } as const;
  const active = books[book];
  const classified = model.classified_lines || [];
  const nci = Number(model.company.minority_interest || 0);
  return (
    <div className="grid">
      <div className="card">
        <h2>
          <Term id={book === "income" ? "income_statement" : book === "balance" ? "balance_sheet" : "cash_flow_statement"}>
            {active.title} ({model.display.scale_label})
          </Term>
        </h2>
        <div className="stmt-switch" role="group" aria-label="Statement">
          {(
            [
              ["income", "Income"],
              ["balance", "Balance sheet"],
              ["cash", "Cash flow"],
            ] as const
          ).map(([key, label]) => (
            <button key={key} type="button" aria-pressed={book === key} onClick={() => setBook(key)}>
              {label}
            </button>
          ))}
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Line</th>
                {active.rows.map((r) => (
                  <th key={String(r.period)}>{fyShort(String(r.period))}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {active.keys.map((key) => (
                <tr key={key}>
                  <td>{lineLabel(key)}</td>
                  {active.rows.map((r) => {
                    const raw = r as Record<string, unknown>;
                    return (
                      <td key={String(r.period)}>{lineUnavailable(key, raw) ? "unavailable" : scaled(num(r, key), div)}</td>
                    );
                  })}
                </tr>
              ))}
              {book === "balance" ? (
                <tr>
                  <td>Minority interest (NCI)</td>
                  {active.rows.map((r, i) => (
                    <td key={String(r.period)}>
                      {i === active.rows.length - 1
                        ? model.company.minority_interest_reported === false
                          ? "unavailable"
                          : scaled(nci, div)
                        : "—"}
                    </td>
                  ))}
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {onSaveHistoricals ? (
          <p style={{ marginTop: "0.75rem" }}>
            <button type="button" className="btn ghost small" onClick={() => setEditing((v) => !v)}>
              {editing ? "Close editor" : "Edit financials"}
            </button>
          </p>
        ) : null}
        {editing && onSaveHistoricals ? (
          <EditHistoricalsForm model={model} onSave={onSaveHistoricals} saving={Boolean(saving)} />
        ) : null}
      </div>
      {classified.length || model.asset_classification ? (
        <ClassifiedLinesCard model={model} />
      ) : null}
    </div>
  );
}

function ClassifiedLinesCard({ model }: { model: Workspace }) {
  const div = model.display.scale_divisor;
  const lines = model.classified_lines || [];
  const assets = model.asset_classification;
  const rows = lines.length
    ? lines
    : (assets?.lines || []).map((ln) => ({
        name: ln.name,
        amount: ln.amount,
        classification: ln.operating,
        operating: ln.operating,
        included_in_ev: ln.already_in_ev,
        added_in_equity_bridge: ln.equity_adjustment,
        reason: ln.reason,
        source: ln.source,
        confidence: ln.confidence,
      }));
  if (!rows.length) return null;
  return (
    <div className="card">
      <h2>Classified bridge lines</h2>
      <p className="note">
        How cash, investments, inventory, NCI, and residual plugs were classified. Unclassified lines are not
        auto-added to equity.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Line</th>
              <th>Amount</th>
              <th>Class</th>
              <th>In equity bridge?</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((ln, i) => (
              <tr key={`${ln.name}-${i}`}>
                <td>{ln.name}</td>
                <td>{ln.amount == null ? "—" : scaled(Number(ln.amount), div)}</td>
                <td>{ln.classification || ln.operating || "—"}</td>
                <td>{ln.added_in_equity_bridge ? "Yes" : "No"}</td>
                <td className="wrap-cell">{ln.reason || ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {assets?.material_unclassified ? (
        <p className="note">Residual plug {scaled(assets.residual_unknown, div)} is flagged and is not auto-added.</p>
      ) : null}
    </div>
  );
}

function EditHistoricalsForm({
  model,
  onSave,
  saving,
}: {
  model: Workspace;
  onSave: (body: Record<string, unknown>) => Promise<void>;
  saving: boolean;
}) {
  const div = model.display.scale_divisor;
  const income = model.historicals.income_statements;
  const sheets = model.historicals.balance_sheets;
  const flows = model.historicals.cash_flows;

  function display(raw: unknown): string {
    if (raw == null || raw === "") return "";
    const n = Number(raw);
    if (!Number.isFinite(n)) return "";
    return String(n / div);
  }

  function readAmount(fd: FormData, name: string): number | null {
    const raw = String(fd.get(name) ?? "").trim();
    if (raw === "") return null;
    const n = Number(raw);
    if (!Number.isFinite(n)) return null;
    return n * div;
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const income_statements = income.map((row, i) => {
      const period = String(row.period);
      const cogs = readAmount(fd, `cogs_${i}`);
      return {
        ...row,
        revenue: readAmount(fd, `revenue_${i}`) ?? Number(row.revenue),
        cogs: cogs ?? Number(row.cogs),
        da: readAmount(fd, `da_${i}`) ?? Number(row.da || 0),
        interest_expense: readAmount(fd, `interest_${i}`) ?? Number(row.interest_expense || 0),
        taxes: readAmount(fd, `taxes_${i}`) ?? Number(row.taxes || 0),
        period,
      };
    });
    const balance_sheets = sheets.map((row, i) => {
      const cashRaw = String(fd.get(`cash_${i}`) ?? "").trim();
      const debtRaw = String(fd.get(`debt_${i}`) ?? "").trim();
      const arRaw = String(fd.get(`ar_${i}`) ?? "").trim();
      const apRaw = String(fd.get(`ap_${i}`) ?? "").trim();
      const cash = readAmount(fd, `cash_${i}`);
      const debt = readAmount(fd, `debt_${i}`);
      const ar = readAmount(fd, `ar_${i}`);
      const ap = readAmount(fd, `ap_${i}`);
      return {
        ...row,
        cash: cash ?? 0,
        cash_status: cashRaw === "" ? "unavailable" : "available",
        cash_reported: cashRaw !== "",
        accounts_receivable: ar ?? 0,
        accounts_payable: ap ?? 0,
        inventory: readAmount(fd, `inventory_${i}`) ?? Number(row.inventory || 0),
        ppe: readAmount(fd, `ppe_${i}`) ?? Number(row.ppe || 0),
        long_term_debt: debt ?? 0,
        short_term_debt: readAmount(fd, `st_debt_${i}`) ?? Number(row.short_term_debt || 0),
        lease_liabilities: readAmount(fd, `leases_${i}`) ?? Number(row.lease_liabilities || 0),
        shareholders_equity: readAmount(fd, `equity_${i}`) ?? Number(row.shareholders_equity),
        nwc_status: arRaw !== "" && apRaw !== "" ? "available" : "unavailable",
        operating_wc_complete: arRaw !== "" && apRaw !== "",
        debt_status: debtRaw === "" ? "unavailable" : "available",
        period: String(row.period),
      };
    });
    const cash_flows = flows.map((row, i) => ({
      ...row,
      net_income: readAmount(fd, `ni_${i}`) ?? Number(row.net_income || 0),
      capex: readAmount(fd, `capex_${i}`) ?? Number(row.capex || 0),
      change_in_nwc: readAmount(fd, `dnwc_${i}`) ?? Number(row.change_in_nwc || 0),
      period: String(row.period),
    }));
    await onSave({ historicals: { income_statements, balance_sheets, cash_flows } });
  }

  return (
    <form className="grid snapshot-form" onSubmit={onSubmit} style={{ marginTop: "0.85rem" }}>
      <p className="note">
        Figures in {model.display.scale_label}. Blank cash / debt / AR / AP stay unavailable, not verified zeros.
      </p>
      {income.map((row, i) => (
        <fieldset key={String(row.period)} className="year-block">
          <legend>{String(row.period)}</legend>
          <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
            <EditNum name={`revenue_${i}`} label="Revenue" defaultValue={display(row.revenue)} disabled={saving} />
            <EditNum name={`cogs_${i}`} label="COGS" defaultValue={display(row.cogs)} disabled={saving} />
            <EditNum name={`da_${i}`} label="D&A" defaultValue={display(row.da)} disabled={saving} />
            <EditNum name={`interest_${i}`} label="Interest" defaultValue={display(row.interest_expense)} disabled={saving} />
            <EditNum name={`taxes_${i}`} label="Taxes" defaultValue={display(row.taxes)} disabled={saving} />
            <EditNum
              name={`cash_${i}`}
              label="Cash"
              defaultValue={sheets[i] && (sheets[i] as Record<string, unknown>).cash_status === "unavailable" ? "" : display(sheets[i]?.cash)}
              disabled={saving}
            />
            <EditNum name={`ar_${i}`} label="AR" defaultValue={display(sheets[i]?.accounts_receivable)} disabled={saving} />
            <EditNum name={`ap_${i}`} label="AP" defaultValue={display(sheets[i]?.accounts_payable)} disabled={saving} />
            <EditNum name={`inventory_${i}`} label="Inventory" defaultValue={display(sheets[i]?.inventory)} disabled={saving} />
            <EditNum name={`ppe_${i}`} label="PP&E" defaultValue={display(sheets[i]?.ppe)} disabled={saving} />
            <EditNum name={`debt_${i}`} label="Long-term debt" defaultValue={display(sheets[i]?.long_term_debt)} disabled={saving} />
            <EditNum name={`st_debt_${i}`} label="Short-term debt" defaultValue={display(sheets[i]?.short_term_debt)} disabled={saving} />
            <EditNum name={`leases_${i}`} label="Leases" defaultValue={display(sheets[i]?.lease_liabilities)} disabled={saving} />
            <EditNum name={`equity_${i}`} label="Equity" defaultValue={display(sheets[i]?.shareholders_equity)} disabled={saving} />
            <EditNum name={`ni_${i}`} label="Net income" defaultValue={display(flows[i]?.net_income)} disabled={saving} />
            <EditNum name={`capex_${i}`} label="Capex" defaultValue={display(flows[i]?.capex)} disabled={saving} />
            <EditNum name={`dnwc_${i}`} label="ΔNWC" defaultValue={display(flows[i]?.change_in_nwc)} disabled={saving} />
          </div>
        </fieldset>
      ))}
      <button type="submit" className="btn" disabled={saving}>
        {saving ? "Saving…" : "Save financials"}
      </button>
    </form>
  );
}

function EditNum({
  name,
  label,
  defaultValue,
  disabled,
}: {
  name: string;
  label: string;
  defaultValue: string;
  disabled: boolean;
}) {
  return (
    <div>
      <label htmlFor={name}>{label}</label>
      <input id={name} name={name} type="number" step="any" defaultValue={defaultValue} disabled={disabled} />
    </div>
  );
}

export function Build({
  model,
  onOverride,
}: {
  model: Workspace;
  onOverride: (yo: Drivers["year_overrides"]) => void;
}) {
  const div = model.display.scale_divisor;
  const years = model.forecast.years;
  const dcf = ((model.valuation?.discounted_years || []) as Record<string, number | string>[]);
  const yo = model.drivers.year_overrides;

  function edit(field: keyof Drivers["year_overrides"], i: number, raw: string) {
    const next = { ...yo, [field]: [...yo[field]] };
    next[field][i] = raw === "" ? null : Number(raw) / 100;
    onOverride(next);
  }

  return (
    <div className="grid">
      <CompoundingCard model={model} />
      <GrowthEvidenceCard model={model} />
      <OperatingForecastTable model={model} />
      <div className="card">
        <h2>Per-year overrides (%)</h2>
        <p className="note">Type a percent and leave the cell. Highlighted cells are overrides of the glide path.</p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Driver</th>
                {years.map((y) => (
                  <th key={String(y.period)}>{fyShort(String(y.period))}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(
                [
                  ["revenue_growth", "Revenue growth"],
                  ["capex_pct_revenue", "Capex % rev"],
                  ["nwc_pct_revenue", "NWC % rev"],
                  ["tax_rate", "Tax rate"],
                ] as const
              ).map(([field, label]) => (
                <tr key={field}>
                  <td>
                    {field === "capex_pct_revenue" ? (
                      <Term id="capex">{label}</Term>
                    ) : field === "nwc_pct_revenue" ? (
                      <Term id="nwc">{label}</Term>
                    ) : (
                      label
                    )}
                  </td>
                  {years.map((y, i) => (
                    <td key={String(y.period)}>
                      <input
                        className="cell-input"
                        defaultValue={yo[field][i] != null ? String(Number(((yo[field][i] as number) * 100).toFixed(2))) : ""}
                        placeholder={placeholderPct(field, y)}
                        onBlur={(e) => edit(field, i, e.target.value)}
                        aria-label={`${label} ${String(y.period)}`}
                        style={{ background: yo[field][i] == null ? "var(--computed)" : "var(--input)" }}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="card">
        <h2>
          <Term id="fcff">FCFF / DCF ({model.display.scale_label})</Term>
        </h2>
        <LabeledBars
          points={years.map((r) => ({ label: String(r.period), value: num(r, "fcff"), kind: "forecast" as const }))}
          title="Forecast FCFF"
          format={(v) => scaled(v, div)}
        />
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Period</th>
                <th>
                  <Term id="fcff">FCFF</Term>
                </th>
                <th>
                  <Term id="discount_factor">Discount</Term>
                </th>
                <th>
                  <Term id="present_value">PV</Term>
                </th>
              </tr>
            </thead>
            <tbody>
              {years.map((y, i) => (
                <tr key={String(y.period)}>
                  <td>{fyShort(String(y.period))}</td>
                  <td>{scaled(Number(y.fcff), div)}</td>
                  <td>{dcf[i] ? Number(dcf[i].discount_factor).toFixed(3) : "—"}</td>
                  <td>{dcf[i] ? scaled(Number(dcf[i].present_value), div) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function placeholderPct(field: keyof Drivers["year_overrides"], y: Record<string, number | string>): string {
  const revenue = Number(y.revenue) || 0;
  if (field === "revenue_growth") return pct(Number(y.revenue_growth));
  if (field === "tax_rate") return pct(Number(y.tax_rate));
  if (field === "capex_pct_revenue") return pct(revenue ? Number(y.capex) / revenue : 0);
  return pct(revenue ? Number(y.nwc) / revenue : 0);
}

function categoryTone(status: string): string {
  if (status === "blocked" || status === "critical") return "critical";
  if (status === "warning") return "warning";
  return "verified";
}

function QualityAudit({
  model,
  compact,
  onOpen,
}: {
  model: Workspace;
  compact?: boolean;
  onOpen?: (s: ShellSurface) => void;
}) {
  const integrity = model.integrity;
  const blocked = intrinsicBlocked(model);
  const cats = integrity?.categories || [];
  const currentIssues = (integrity?.issues || []).filter((i) => i.scope !== "historical");
  const historicalIssues = (integrity?.issues || []).filter((i) => i.scope === "historical");
  return (
    <div>
      {compact ? null : <ModelReliabilityCard model={model} />}
      {compact ? null : model.model_health ? <ModelHealthGate model={model} /> : null}
      <div className="quality">
        <QualityRing score={integrity?.score ?? 0} max={integrity?.max_score || 100} status={integrity?.status} />
        <div className="trust-grid">
          <div>
            <strong>Can I trust the data?</strong>
            <p className="note">
              Current bridge {integrity?.current_bridge_coverage ?? "—"}/100 · historical completeness{" "}
              {integrity?.historical_coverage ?? "—"}/100. Missing older years do not automatically invalidate the current valuation.
            </p>
          </div>
          <div>
            <strong>Can I see why these assumptions were chosen?</strong>
            <p className="note">Every material driver is in the assumption ledger with source, method, and rationale.</p>
          </div>
          <div>
            <strong>Can I trust the intrinsic value?</strong>
            {blocked ? (
              <p className="iv-blocked">Intrinsic value: BLOCKED / NOT RELIABLE</p>
            ) : residualNegative(model) ? (
              <p className="iv-blocked">Residual equity value is negative — not floored to zero.</p>
            ) : (
              <TrustVerdict model={model} onOpen={onOpen} />
            )}
          </div>
        </div>
      </div>
      <p style={{ marginTop: "0.85rem" }}>
        <strong>
          {integrity?.score ?? 0} / {integrity?.max_score || 100}
        </strong>{" "}
        · {integrity?.band || "—"}
      </p>
      {cats.length ? (
        <div className="qcat-list">
          {cats.map((c) => (
            <button
              type="button"
              key={c.id}
              className={`qcat ${categoryTone(c.status)}`}
              onClick={() => onOpen?.(c.id === "forecast" || c.id === "growth" ? "forecast" : c.id === "data" || c.id === "bridge" ? "quality" : "assumptions")}
            >
              <span>
                {c.name}
                <small className={`qcat-status ${categoryTone(c.status)}`}>{c.status.replace(/_/g, " ")}</small>
              </span>
              <span>{c.score}/100</span>
              <div className={`qbar-track ${categoryTone(c.status)}`}>
                <i style={{ width: `${c.score}%` }} />
              </div>
              {!compact ? <p className="note">{c.reasons.slice(0, 3).join(" ")}</p> : null}
            </button>
          ))}
        </div>
      ) : null}
      {integrity?.blockers?.length ? (
        <ul className="checks">
          {integrity.blockers.map((b) => (
            <li key={b} className="error">
              Blocker: {b}
            </li>
          ))}
        </ul>
      ) : null}
      {currentIssues.length ? (
        <ul className="checks">
          {currentIssues.map((i) => (
            <li key={i.message} className={i.severity === "error" ? "error" : "muted"}>
              {i.severity}: {i.message}
            </li>
          ))}
        </ul>
      ) : (
        <p className="ok">No current-period data-quality blockers.</p>
      )}
      {!compact && historicalIssues.length ? (
        <div className="ingest-notes">
          <h3>Historical completeness (does not automatically block current IV)</h3>
          <ul className="checks">
            {historicalIssues.map((i) => (
              <li key={i.message} className="muted">
                {i.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
function TrustVerdict({ model, onOpen }: { model: Workspace; onOpen?: (s: ShellSurface) => void }) {
  const simple = useSimple();
  const n = flagsToReview(model).length;
  const status = model.integrity?.status;
  const clean = status === "VERIFIED" && n === 0;
  const items = `${n} ${n === 1 ? "item needs" : "items need"} review before you rely on this number.`;
  return (
    <>
      <p className={clean ? "ok" : "verdict-mid"}>
        {clean
          ? simple
            ? "Yes — every check passed."
            : "Yes — verified, no open review items."
          : simple
            ? "Mostly — check a few things first."
            : `Usable with review — ${model.integrity?.band || "review required"}.`}
      </p>
      {clean ? null : (
        <p className="note verdict-sub">
          {n ? items : "The quality check wants a closer look before you rely on this number."}{" "}
          {onOpen ? (
            <button type="button" className="why-btn" onClick={() => onOpen("quality")}>
              See {n === 1 ? "it" : "them"}
            </button>
          ) : null}
        </p>
      )}
    </>
  );
}

function asFinite(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function GrowthEvidenceCard({ model }: { model: Workspace }) {
  const ev = (model.growth_evidence || {}) as Record<string, unknown>;
  const profile = (model.company_profile || {}) as Record<string, unknown>;
  const stats: [string, number | null][] = [
    ["Historical 3Y CAGR", asFinite(ev.cagr_3y)],
    ["Historical 5Y CAGR", asFinite(ev.cagr_5y)],
    ["Median annual growth", asFinite(ev.median_annual)],
    ["Latest-year YoY", asFinite(ev.last_1y)],
    ["ROIC × reinvestment", asFinite(ev.implied_fundamental_g)],
    ["Volatility", asFinite(ev.volatility)],
  ];
  const regime = String(ev.regime || "unclassified").replace(/_/g, " ");
  const year1 = asFinite(ev.year1);
  const method = String(ev.year1_method || "n/a");
  return (
    <div className="card">
      <h2>Why is revenue growing at {year1 == null ? "n/a" : pct(year1)}?</h2>
      <p className="note">
        Historical growth is evidence, not the forecast. Regime: <strong>{regime}</strong>
        {profile.template ? ` · template ${String(profile.template).replace(/_/g, " ")}` : ""}.
        Selected Year-1 method: <strong>{method}</strong>{" "}
        <CompanyGuidanceBadge method={method} source={ev.year1_source ? String(ev.year1_source) : null} />
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {stats.map(([label]) => (
                <th key={label}>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              {stats.map(([label, value]) => (
                <td key={label}>{value == null ? "unavailable" : pct(value)}</td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <p className="note">{ev.year1_rationale ? String(ev.year1_rationale) : "Year 1 is a blend of verified historical statistics, not the latest year copied forward."}</p>
      {asFinite(ev.last_1y) != null && year1 != null && Math.abs((asFinite(ev.last_1y) as number) - year1) > 0.03 ? (
        <p className="note">
          Why not {pct(asFinite(ev.last_1y) as number)}? The latest year is treated as evidence. The forecast uses a
          normalized blend so one extraordinary year cannot dominate.
        </p>
      ) : null}
      {ev.high_growth_evidence_ok === false ? <p className="note">{String(ev.high_growth_evidence_note)}</p> : null}
    </div>
  );
}

function CompoundingCard({ model }: { model: Workspace }) {
  const div = model.display.scale_divisor;
  const c = model.compounding;
  if (!c) return null;
  const multiple = c.revenue_multiple;
  return (
    <div className="card">
      <h2>Revenue compounding</h2>
      <p className="note">
        Current {scaled(c.base_revenue, div)}
        {c.year_revenues.map((v, i) => ` → Y${i + 1} ${scaled(v, div)}`).join("")}.
        {multiple != null ? ` Revenue increases ${multiple.toFixed(1)}× over the explicit forecast.` : ""}
        {c.forecast_cagr != null ? ` Forecast CAGR ${pct(c.forecast_cagr)}.` : ""}
        {c.historical_cagr != null ? ` Historical CAGR ${pct(c.historical_cagr)}.` : ""}
      </p>
    </div>
  );
}

type ForecastRow = { label: string; hist: number | null; key: string; kind?: "pct"; terminal?: number | null };

type SummaryYear = {
  period: string;
  revenue: number;
  revenue_growth: number | null;
  ebitda_margin: number;
  ebit_margin: number;
  da_pct_revenue: number;
};

/** Filed-year values for a forecast row, from the backend's historical summary and statements. */
function rowHistory(model: Workspace, key: string): Point[] {
  const summary = ((model.summary as { years?: SummaryYear[] } | undefined)?.years || []) as SummaryYear[];
  const income = model.historicals.income_statements;
  const flows = model.historicals.cash_flows;
  const fromSummary = (pick: (y: SummaryYear) => number | null) =>
    summary.map((y) => ({ label: String(y.period), value: pick(y), kind: "hist" as const }));
  let out: { label: string; value: number | null; kind: "hist" }[] = [];
  if (key === "revenue") out = fromSummary((y) => y.revenue);
  else if (key === "revenue_growth") out = fromSummary((y) => y.revenue_growth);
  else if (key === "ebitda") out = fromSummary((y) => y.revenue * y.ebitda_margin);
  else if (key === "ebitda_margin") out = fromSummary((y) => y.ebitda_margin);
  else if (key === "ebit") out = fromSummary((y) => y.revenue * y.ebit_margin);
  else if (key === "ebit_margin") out = fromSummary((y) => y.ebit_margin);
  else if (key === "da_pct") out = fromSummary((y) => y.da_pct_revenue);
  else if (key === "da") out = income.map((r) => ({ label: String(r.period), value: num(r, "da"), kind: "hist" }));
  else if (key === "capex") out = flows.map((r) => ({ label: String(r.period), value: Math.abs(num(r, "capex")), kind: "hist" }));
  else if (key === "change_in_nwc") out = flows.map((r) => ({ label: String(r.period), value: num(r, "change_in_nwc"), kind: "hist" }));
  else if (key === "fcff") out = flows.map((r) => ({ label: String(r.period), value: histFcff(r), kind: "hist" }));
  return out.filter((p): p is Point & { kind: "hist" } => p.value != null && Number.isFinite(p.value));
}

function ForecastRowTrend({
  model,
  row,
  forecast,
}: {
  model: Workspace;
  row: ForecastRow;
  forecast: (number | null)[];
}) {
  const [hover, setHover] = useState<number | null>(null);
  const div = model.display.scale_divisor;
  const hist = rowHistory(model, row.key);
  const fwd = model.forecast.years
    .map((y, i) => ({ label: String(y.period), value: forecast[i], kind: "forecast" as const }))
    .filter((p): p is Point & { kind: "forecast" } => p.value != null && Number.isFinite(p.value));
  const points = [...hist, ...fwd];
  const format = (v: number) => (row.kind === "pct" ? pct(v) : scaled(v, div));
  return (
    <div className="drill-body">
      <div className="chart-head">
        <p className="note">
          {row.label} · {row.kind === "pct" ? "percent" : model.display.scale_label}
          {hist.length ? "" : " · no filed history for this line, forecast only"}
        </p>
        <div className="legend-dots">
          {hist.length ? (
            <span>
              <i className="hist" /> Historical
            </span>
          ) : null}
          <span>
            <i className="fwd" /> Forecast
          </span>
        </div>
      </div>
      <RevenueLine points={points} title={`${row.label} across all years`} format={format} hover={hover} onHover={setHover} />
    </div>
  );
}

function OperatingForecastTable({ model }: { model: Workspace }) {
  const [open, setOpen] = useState<string | null>(null);
  const div = model.display.scale_divisor;
  const hist = model.historicals.income_statements;
  const last = hist[hist.length - 1];
  const years = model.forecast.years;
  const dcf = ((model.valuation?.discounted_years || []) as Record<string, number | string>[]);
  const lastHistGrowth = asFinite((model.growth_evidence as Record<string, unknown> | undefined)?.last_1y);
  const ev = (model.growth_evidence || {}) as Record<string, unknown>;
  const terminalG = Number(model.valuation?.terminal_growth ?? model.drivers.terminal_growth);
  const lastYear = years[years.length - 1];
  const terminalFcff = lastYear ? Number(lastYear.fcff) * (1 + terminalG) : null;
  const terminalRev = lastYear ? Number(lastYear.revenue) * (1 + terminalG) : null;
  const rows: ForecastRow[] = [
    { label: "Revenue", hist: last ? num(last, "revenue") : null, key: "revenue", terminal: terminalRev },
    { label: "Growth", hist: lastHistGrowth, key: "revenue_growth", kind: "pct", terminal: terminalG },
    { label: "EBITDA", hist: null, key: "ebitda" },
    { label: "EBITDA margin", hist: null, key: "ebitda_margin", kind: "pct" },
    { label: "EBIT", hist: null, key: "ebit" },
    { label: "EBIT margin", hist: null, key: "ebit_margin", kind: "pct" },
    { label: "Tax on EBIT", hist: null, key: "taxes_on_ebit" },
    { label: "NOPAT", hist: null, key: "nopat" },
    { label: "D&A", hist: null, key: "da" },
    { label: "D&A / Revenue", hist: null, key: "da_pct", kind: "pct" },
    { label: "Capex", hist: null, key: "capex" },
    { label: "Change in NWC", hist: null, key: "change_in_nwc" },
    { label: "ΔNWC / ΔRevenue", hist: null, key: "nwc_ratio", kind: "pct" },
    { label: "FCFF", hist: null, key: "fcff", terminal: terminalFcff },
  ];
  const valueAt = (key: string, y: Record<string, number | string>, i: number): number | null => {
    if (key === "da_pct") {
      const rev = num(y, "revenue");
      return rev ? num(y, "da") / rev : null;
    }
    if (key === "nwc_ratio") {
      const rev = num(y, "revenue");
      const prior = i === 0 ? (last ? num(last, "revenue") : null) : num(years[i - 1], "revenue");
      const drev = prior != null ? rev - prior : null;
      return drev && Math.abs(drev) > 1e-9 ? num(y, "change_in_nwc") / drev : null;
    }
    return num(y, key);
  };
  const cols = years.length + 3;
  return (
    <div className="card">
      <h2>Explicit forecast ({model.display.scale_label})</h2>
      <p className="note">
        Trace from revenue to FCFF before the implied value. Last explicit growth equals terminal g
        {Number.isFinite(terminalG) ? ` (${pct(terminalG)})` : ""}. Terminal FCFF is FCFF_n × (1 + g),
        the same g used in TV = FCFF_n+1 / (WACC − g).
        {model.assumptions && (model.assumptions as { nwc_method?: string }).nwc_method === "cash_flow_derived"
          ? " NWC uses a cash-flow-derived substitute because the balance sheet is incomplete."
          : ""}{" "}
        Click a line to chart it across every year.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Line</th>
              <th>Latest hist.</th>
              {years.map((y) => (
                <th key={String(y.period)}>{fyShort(String(y.period))}</th>
              ))}
              <th>Terminal</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const values = years.map((y, i) => valueAt(row.key, y, i));
              const isOpen = open === row.key;
              return (
                <Fragment key={row.label}>
                  <tr className={isOpen ? "drill-open" : undefined}>
                    <td>
                      <button
                        type="button"
                        className="row-drill"
                        aria-expanded={isOpen}
                        aria-controls={`drill-${row.key}`}
                        onClick={() => setOpen(isOpen ? null : row.key)}
                      >
                        <span className="row-drill-caret" aria-hidden>
                          ›
                        </span>
                        {row.label}
                      </button>
                      {row.key === "revenue_growth" ? (
                        <>
                          {" "}
                          <CompanyGuidanceBadge
                            method={ev.year1_method ? String(ev.year1_method) : null}
                            source={ev.year1_source ? String(ev.year1_source) : null}
                          />
                        </>
                      ) : null}
                    </td>
                    <td>{row.hist == null ? "—" : row.kind === "pct" ? pct(row.hist) : scaled(row.hist, div)}</td>
                    {values.map((v, i) => (
                      <td key={String(years[i].period)}>{row.kind === "pct" ? pct(v) : scaled(v, div)}</td>
                    ))}
                    <td>
                      {row.terminal == null
                        ? "—"
                        : row.kind === "pct"
                          ? pct(row.terminal)
                          : scaled(row.terminal, div)}
                    </td>
                  </tr>
                  {isOpen ? (
                    <tr className="drill-row" id={`drill-${row.key}`}>
                      <td className="drill-cell" colSpan={cols}>
                        <ForecastRowTrend model={model} row={row} forecast={values} />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
            <tr>
              <td>Discount factor</td>
              <td>—</td>
              {years.map((y, i) => (
                <td key={String(y.period)}>{dcf[i] ? Number(dcf[i].discount_factor).toFixed(3) : "—"}</td>
              ))}
              <td>—</td>
            </tr>
            <tr>
              <td>PV of FCFF</td>
              <td>—</td>
              {years.map((y, i) => (
                <td key={String(y.period)}>{dcf[i] ? scaled(Number(dcf[i].present_value), div) : "—"}</td>
              ))}
              <td>
                {model.valuation?.pv_of_terminal_value != null
                  ? scaled(Number(model.valuation.pv_of_terminal_value), div)
                  : "—"}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Revenue growth × (EBIT margin | WACC) grid. Clicking a cell writes both inputs through the
 * same assumptions save the WACC × g grid uses.
 */
type TwoWayTable = NonNullable<Workspace["sensitivity_growth_margin"]>;

/** True when every row returns the same value in each column, i.e. the growth axis has no effect. */
function rowsAreFlat(table: TwoWayTable): boolean {
  if (table.row_range.length < 2) return false;
  const columns = table.col_range
    .map((c) =>
      table.cells
        .filter((x) => Math.abs(x.col - c) < 1e-9)
        .map((x) => x.equity_value_per_share)
        .filter((v): v is number => v != null && Number.isFinite(v)),
    )
    .filter((vs) => vs.length > 1);
  return columns.length > 0 && columns.every((vs) => vs.every((v) => Math.abs(v - vs[0]) < 1e-6));
}

export function TwoWaySensitivity({
  model,
  against,
  onPatch,
}: {
  model: Workspace;
  against: "margin" | "wacc";
  onPatch: (body: Record<string, unknown>) => void;
}) {
  const simple = useSimple();
  const margin = against === "margin";
  const title = margin ? "Revenue growth × EBIT margin" : "Revenue growth × WACC";
  const table = margin ? model.sensitivity_growth_margin : model.sensitivity_growth_wacc;
  const price = currentPrice(model);
  const sym = currencySymbol(model.display.currency);
  if (!table) return <p className="muted">{title}: unavailable until WACC exceeds terminal g.</p>;

  const growthWord = simple ? "Sales growth" : "Revenue growth";
  const note = margin
    ? simple
      ? "Each column moves profit margin by the same amount in every forecast year. Clicking moves your target margin by that amount, so the recalculated value can land slightly off the cell."
      : "Margin shifts move every explicit year equally; clicking shifts Target EBITDA margin (the glide-path end point) by the same amount, so the recomputed value can differ slightly from the cell."
    : simple
      ? "WACC is built from its inputs, so clicking sets it by adjusting the equity risk premium. The recalculated value matches the cell."
      : "WACC is derived, so clicking solves the equity risk premium that lands WACC on the column (beta, weights and Kd held fixed).";
  const flatRows = rowsAreFlat(table);
  const flatNote = simple
    ? `${growthWord} is set by hand for some years, so the rows don't change the value here. Clicking a cell only applies its column.`
    : "Rows are flat: revenue growth has manual overrides, which the grid's growth shift leaves in place. Clicks apply the column only.";

  function apply(dg: number, col: number): string {
    const body: Record<string, unknown> = {};
    const parts: string[] = [];
    if (!flatRows && Math.abs(dg) > 1e-9) {
      body.year_overrides = { revenue_growth: growthShiftOverrides(model, dg) };
      parts.push(`${growthWord.toLowerCase()} ${signedPts(dg)} in each forecast year except the last`);
    }
    if (margin && Math.abs(col) > 1e-9) {
      const next = model.drivers.target_ebitda_margin + col;
      body.target_ebitda_margin = next;
      parts.push(`target EBITDA margin ${pct(next)} (${signedPts(col)})`);
    }
    if (!margin && Math.abs(col - waccOf(model).wacc) > 1e-6) {
      const erp = erpForWacc(model, col);
      if (erp == null) return `Can't reach WACC ${pct(col)} without a negative equity risk premium.`;
      body.equity_risk_premium = erp;
      parts.push(`WACC ${pct(col)} by setting the equity risk premium to ${pct(erp)}`);
    }
    if (!parts.length) return "That's the current case.";
    onPatch(body);
    return `Applied ${parts.join(" and ")}. Recalculating…`;
  }

  return (
    <div className="card">
      <h2>
        <Term id="sensitivity">{title}</Term>
      </h2>
      <p className="note">
        Implied share price (Current Market: {perShare(price, sym)}). {growthWord} shifts apply to the forecast years; the last year
        stays at terminal g. {note}
      </p>
      {flatRows ? <p className="note verdict-mid">{flatNote}</p> : null}
      <SensitivityGrid
        corner={margin ? "Growth / margin" : "Growth / WACC"}
        rows={{ values: table.row_range, label: signedPts, base: nearestValue(table.row_range, 0) }}
        cols={
          margin
            ? { values: table.col_range, label: signedPts, base: nearestValue(table.col_range, 0) }
            : { values: table.col_range, label: pct, base: nearestValue(table.col_range, waccOf(model).wacc) }
        }
        valueAt={(r, c) => table.cells.find((x) => Math.abs(x.row - r) < 1e-9 && Math.abs(x.col - c) < 1e-9)?.equity_value_per_share}
        price={price}
        describe={(r, c) => `${growthWord} ${signedPts(r)}, ${margin ? `margin ${signedPts(c)}` : `WACC ${pct(c)}`}`}
        idle={`Hover a cell. Click to set both ${growthWord.toLowerCase()} and ${margin ? "margin" : "WACC"}.`}
        clickHint={`Click to set both ${growthWord.toLowerCase()} and ${margin ? "margin" : "WACC"}.`}
        onApply={apply}
      />
    </div>
  );
}

export function Scenarios({
  model,
  onApplyGrowth,
  onFocusDriver,
  onPick,
}: {
  model: Workspace;
  onApplyGrowth: (g: number) => void;
  onFocusDriver: (key: string, surface?: "forecast") => void;
  onPick?: (name: "Bear" | "Base" | "Bull") => void;
}) {
  const sym = currencySymbol(model.display.currency);
  const simple = useSimple();
  if (!model.scenarios) return <p className="muted">Scenarios need a valid WACC above g. Lower terminal growth or raise the cost of capital.</p>;
  const names = ["Bear Case", "Base Case", "Bull Case"] as const;
  const prices = names.map((n) => {
    const sc = model.scenarios![n];
    return (sc.valuation as { equity_bridge: { equity_value_per_share: number } }).equity_bridge.equity_value_per_share;
  });
  const max = Math.max(...prices.map((p) => Math.abs(p || 0)), 1);
  const ranking = model.driver_ranking || [];
  const rankMax = Math.max(...ranking.map((d) => d.impact_range_pct), 0.01);

  return (
    <div className="grid">
      {simple ? (
        <p className="note scenario-legend">
          <Term id="scenarios">Each case</Term> moves year-1 growth, <Term id="ebit_margin">EBIT margin</Term>,{" "}
          <Term id="wacc">WACC</Term> and <Term id="terminal_growth">g (terminal growth)</Term> together. Click a card to see it on
          the Dashboard.
        </p>
      ) : null}
      <div className="scenario-grid">
        {names.map((n, i) => {
          const sc = model.scenarios![n] as {
            definition?: { description?: string; key_drivers?: string[] };
            forecast?: { years: { revenue_growth: number; ebit_margin: number; capex: number; revenue: number; change_in_nwc: number }[] };
            wacc_result?: { wacc: number };
            terminal_growth?: number;
            valuation?: { enterprise_value: number; equity_bridge: { equity_value: number; equity_value_per_share: number } };
          };
          const y1 = sc.forecast?.years?.[0];
          return (
            <button
              type="button"
              key={n}
              className={`scenario ${n === "Base Case" ? "base" : ""}`}
              onClick={() => onPick?.(n.replace(" Case", "") as "Bear" | "Base" | "Bull")}
            >
              <h3>{n.replace(" Case", "")}</h3>
              <div className="v">{perShare(prices[i], sym)}</div>
              <p className="note">{sc.definition?.description}</p>
              {y1 ? (
                <p className="note">
                  Y1 growth {pct(y1.revenue_growth)} · EBIT margin {pct(y1.ebit_margin)} · WACC {pct(Number(sc.wacc_result?.wacc))} · g {pct(Number(sc.terminal_growth))}
                </p>
              ) : null}
              <div className="rank-bar" aria-hidden="true">
                <span style={{ width: `${(Math.abs(prices[i] || 0) / max) * 100}%` }} />
              </div>
            </button>
          );
        })}
      </div>
      <Heatmap model={model} onApplyGrowth={onApplyGrowth} />
      {ranking.length ? (
        <div className="card">
          <h2>Ranked drivers</h2>
          <p className="note">Impact is the swing in enterprise value from a standard shock. Click to jump to the control.</p>
          {ranking.map((d) => (
            <button
              type="button"
              className="rank-row"
              key={d.driver_name}
              onClick={() => {
                const mapped = mapRankedDriver(d.driver_name);
                onFocusDriver(mapped.key, mapped.surface);
              }}
            >
              <div>
                <div>{d.driver_name}</div>
                <div className="rank-bar">
                  <span style={{ width: `${(d.impact_range_pct / rankMax) * 100}%` }} />
                </div>
              </div>
              <div>{pct(d.impact_range_pct)}</div>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function mapRankedDriver(name: string): { key: string; surface?: "forecast" } {
  if (name.startsWith("Terminal Growth")) return { key: "terminal_growth" };
  if (name.startsWith("Revenue")) return { key: "long_term_growth" };
  if (name.startsWith("Terminal EBITDA")) return { key: "target_ebitda_margin" };
  if (name.startsWith("Capex")) return { key: "capex", surface: "forecast" };
  return { key: "risk_free_rate" };
}

function intelligenceCopy(intel: Workspace["growth_intelligence"]): string {
  if (!intel) return "";
  if (intel.status === "historical") {
    return "Using the legacy 2-year run-rate glide, faded to terminal growth.";
  }
  if (intel.status === "llm") {
    const model = intel.model ? ` Model: ${intel.model}.` : "";
    return `LLM narrative only.${model} Numeric growth is from the evidence engine; suggested LLM rates are not applied.`;
  }
  if (intel.status === "evidence" || intel.status === "local") {
    return "Year-1 growth is from the evidence hierarchy (user override, identity g = ROIC×RR, or 3y/5y/median blend), then faded to terminal g. The LLM is not the source of the numbers.";
  }
  return `Growth uses the evidence engine (${intel.fallback_reason || "default"}).`;
}

export function Sources({ model, highlight }: { model: Workspace; highlight?: string | null }) {
  const bag = model.assumptions as {
    revenue_growth?: { period: string; source: string; rationale: string }[];
    capex_pct_revenue?: { period: string; source: string; rationale: string }[];
  };
  const assumptionRows = [
    ...(bag.revenue_growth || []).map((a) => ({ ...a, driver: "Revenue growth" })),
    ...(bag.capex_pct_revenue || []).map((a) => ({ ...a, driver: "Capex % rev" })),
  ];
  const intel = model.growth_intelligence;
  const intelNote = intelligenceCopy(intel);
  return (
    <div className="grid">
      <div className="card">
        <h2>Model Verification &amp; Quality</h2>
        <QualityAudit model={model} />
        {model.quality_flags?.length ? (
          <div className="ingest-notes">
            <h3>Model-quality flags</h3>
            <p className="note">These are model-quality warnings, not investment recommendations.</p>
            <ul className="checks">
              {model.quality_flags.map((f) => (
                <li
                  key={f.code + f.message}
                  id={`flag-${f.code}`}
                  className={`${f.level === "unrealistic" ? "error" : "muted"}${highlight === f.code ? " flag-hot" : ""}`}
                >
                  {f.level}: {f.message}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {model.ingest_notes?.length ? (
          <div className="ingest-notes">
            <h3>Statement source</h3>
            <ul>
              {model.ingest_notes.map((note) => (
                <li key={note.slice(0, 80)}>{note}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      <ReliabilityDetail model={model} />
      <div className="card">
        <h2>Assumption ledger</h2>
        <p className="note">Every major number: value, source, method, and why it is used.</p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Assumption</th>
                <th>Value</th>
                <th>Source</th>
                <th>As-of</th>
                <th>Method</th>
                <th>Confidence</th>
                <th>Why</th>
              </tr>
            </thead>
            <tbody>
              {(model.assumption_ledger || []).map((row) => (
                <tr key={row.assumption}>
                  <td>{row.assumption}</td>
                  <td>
                    {row.value == null
                      ? row.unit || "unavailable"
                      : row.unit === "x"
                        ? Number(row.value).toFixed(2)
                        : pct(Number(row.value))}
                  </td>
                  <td>
                    {row.source} <CompanyGuidanceBadge source={row.source} method={row.method} />
                  </td>
                  <td>{row.as_of || "—"}</td>
                  <td>{row.method}</td>
                  <td>{row.confidence}</td>
                  <td style={{ textAlign: "left" }}>{row.rationale}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="card">
        {intelNote ? <p className="note">{intelNote}</p> : null}
        {intel?.thesis ? <p>{intel.thesis}</p> : null}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Driver</th>
                <th>Period</th>
                <th>Source</th>
                <th>Rationale</th>
              </tr>
            </thead>
            <tbody>
              {assumptionRows.map((a) => (
                <tr key={`${a.driver}-${a.period}`}>
                  <td>{a.driver}</td>
                  <td>{a.period}</td>
                  <td>
                    {a.source} <CompanyGuidanceBadge source={a.source} />
                  </td>
                  <td style={{ textAlign: "left" }}>{a.rationale}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export function ExportPanel({ model }: { model: Workspace }) {
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState<"xlsx" | "pdf" | "">("");
  async function go(format: "xlsx" | "pdf") {
    setMsg("");
    setBusy(format);
    try {
      await downloadExport(model.id, format);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Export failed");
    } finally {
      setBusy("");
    }
  }
  return (
    <div className="card">
      <h2>Export</h2>
      <p className="muted">One click. Excel is formula-driven; the PDF is the narrative companion.</p>
      {msg ? <p className="error">{msg}</p> : null}
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <button type="button" className="btn" onClick={() => go("xlsx")} disabled={!!model.valuation_error || !!busy}>
          {busy === "xlsx" ? "Preparing Excel…" : "Download Excel"}
        </button>
        <button type="button" className="btn secondary" onClick={() => go("pdf")} disabled={!!model.valuation_error || !!busy}>
          {busy === "pdf" ? "Preparing PDF…" : "Download PDF"}
        </button>
      </div>
    </div>
  );
}

export function useFlash(value: string) {
  const [on, setOn] = useState(false);
  const [prev, setPrev] = useState(value);
  useEffect(() => {
    if (prev !== value) {
      setOn(true);
      setPrev(value);
      const t = window.setTimeout(() => setOn(false), 450);
      return () => window.clearTimeout(t);
    }
  }, [prev, value]);
  return on;
}

function VerdictBook({
  model,
  onOpen,
}: {
  model: Workspace;
  onOpen: (s: ShellSurface, driver?: string) => void;
}) {
  const [page, setPage] = useState(0);
  const [turning, setTurning] = useState<{ from: number; to: number; dir: 1 | -1 } | null>(null);
  const reduce = useRef(false);
  const simple = useSimple();
  const pages = 4;
  const div = model.display.scale_divisor;
  const india = model.display.is_india;
  const sym = currencySymbol(model.display.currency);
  const moneyOpts = { divisor: div, isIndia: india };
  const wacc = waccOf(model);
  const bridge = bridgeOf(model);
  const blocked = intrinsicBlocked(model);
  const residual = residualNegative(model);
  const implied = blocked || residual ? null : bridge.equity_value_per_share;
  const upside = blocked ? null : bridge.upside_downside;
  const over = upside != null && upside < 0;
  const lastFwd = model.forecast.years[model.forecast.years.length - 1];
  const ebitdaM = lastFwd ? num(lastFwd, "ebitda_margin") : model.drivers.target_ebitda_margin;
  const tvPct = Number(model.valuation?.terminal_value_pct_of_ev);
  const pvTv = Number(model.valuation?.pv_of_terminal_value);
  const bear = scenarioPrice(model, "Bear");
  const bull = scenarioPrice(model, "Bull");
  const shown = turning?.from ?? page;
  const under = turning?.to ?? page;

  useEffect(() => {
    reduce.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  useEffect(() => {
    if (!turning) return;
    const t = window.setTimeout(() => {
      setPage(turning.to);
      setTurning(null);
    }, 820);
    return () => window.clearTimeout(t);
  }, [turning]);

  function go(to: number, dir: 1 | -1) {
    if (turning || to === page) return;
    if (reduce.current) {
      setPage(to);
      return;
    }
    setTurning({ from: page, to, dir });
  }

  function turn(delta: number, e?: { stopPropagation: () => void }) {
    e?.stopPropagation();
    const to = (page + delta + pages) % pages;
    go(to, delta > 0 ? 1 : -1);
  }

  function onFlipEnd(e: AnimationEvent<HTMLDivElement>) {
    if (e.target !== e.currentTarget || !turning) return;
    setPage(turning.to);
    setTurning(null);
  }

  function leaf(index: number) {
    return (
      <>
        <p className="book-kicker">Page {index + 1} of {pages}</p>
        {index === 0 ? (
          <>
            <h2>
              {blocked ? (
                <Term id="intrinsic_value">Intrinsic Value Blocked</Term>
              ) : residual ? (
                <Term id="equity_value">Residual Equity Value</Term>
              ) : (
                <Term id="base_case">DCF Base Case</Term>
              )}
            </h2>
            <p className="book-figure">{blocked ? "Not reliable" : residual ? "Negative" : perShare(implied, sym)}</p>
            {simple && !blocked && !residual ? (
              <p className="book-note">What one share is worth by this model. Not a price target.</p>
            ) : (
              <p className="book-note">
                {blocked
                  ? bridge.block_reason || "Required cash, debt, or share-count data is missing. Operating DCF is still shown."
                  : residual
                    ? `${String((model.equity_presentation as { status?: string } | undefined)?.status || "NEGATIVE RESIDUAL EQUITY").replaceAll("_", " ")}. This is not a distress label and not a stock target.`
                    : "Base-case DCF residual versus the market quote. This is not a target price."}
              </p>
            )}
            {blocked || residual ? null : (
              <Term id="undervalued">
                <span className={`badge ${over ? "over" : "under"}`}>{over ? "Overvalued" : "Undervalued"}</span>
              </Term>
            )}
            {residual ? <span className="badge over">{String((model.equity_presentation as { status?: string } | undefined)?.status || "NEGATIVE RESIDUAL").replaceAll("_", " ")}</span> : null}
          </>
        ) : null}
        {index === 1 ? (
          <>
            <h2>
              <Term id="scenarios">DCF scenario range</Term>
            </h2>
            <div className="book-cases">
              <button type="button" onClick={(e) => { e.stopPropagation(); onOpen("scenarios"); }}>
                <span>Best</span>
                <b>{blocked ? "—" : residual ? "Below 0" : perShare(bull, sym)}</b>
              </button>
              <button type="button" onClick={(e) => { e.stopPropagation(); onOpen("scenarios"); }}>
                <span>Base</span>
                <b>{blocked ? "—" : residual ? "Below 0" : perShare(implied, sym)}</b>
              </button>
              <button type="button" onClick={(e) => { e.stopPropagation(); onOpen("scenarios"); }}>
                <span>Bear</span>
                <b>{blocked ? "—" : residual ? "Below 0" : perShare(bear, sym)}</b>
              </button>
            </div>
          </>
        ) : null}
        {index === 2 ? (
          <>
            <h2>Enterprise and equity</h2>
            <div className="book-stats-row">
              <div className="book-stats">
                <span>
                  <Term id="enterprise_value">Enterprise value</Term>
                </span>
                <b>{blocked ? "—" : compactMoney(model.valuation?.enterprise_value as number, sym, moneyOpts)}</b>
              </div>
              <div className="book-stats">
                <span>
                  <Term id="equity_value">Equity value</Term>
                </span>
                <b>{blocked ? "—" : compactMoney(bridge.equity_value, sym, moneyOpts)}</b>
              </div>
            </div>
          </>
        ) : null}
        {index === 3 ? (
          <>
            <h2>Drivers and upside</h2>
            <div className="book-stats-row">
              <StatTerm id="wacc">
                <button type="button" className="book-stats" onClick={(e) => { e.stopPropagation(); onOpen("assumptions", "risk_free_rate"); }}>
                  <span>WACC</span>
                  <b>{pct(wacc.wacc)}</b>
                </button>
              </StatTerm>
              <StatTerm id="terminal_growth">
                <button type="button" className="book-stats" onClick={(e) => { e.stopPropagation(); onOpen("assumptions", "terminal_growth"); }}>
                  <span>Terminal growth</span>
                  <b>{pct(model.drivers.terminal_growth)}</b>
                </button>
              </StatTerm>
              <StatTerm id="terminal_value">
                <button type="button" className="book-stats" onClick={(e) => { e.stopPropagation(); onOpen("dcf"); }}>
                  <span>PV of terminal value</span>
                  <b>{blocked ? "—" : compactMoney(pvTv, sym, moneyOpts)}</b>
                  <span>{Number.isFinite(tvPct) ? pct(tvPct) : ""} of EV</span>
                </button>
              </StatTerm>
              <StatTerm id="upside">
                <button type="button" className="book-stats" onClick={(e) => { e.stopPropagation(); onOpen("scenarios"); }}>
                  <span>Upside / downside</span>
                  <b style={{ color: over ? "var(--over)" : "var(--bull)" }}>{blocked ? "—" : signedPct(upside)}</b>
                </button>
              </StatTerm>
            </div>
            {simple ? (
              <p className="book-note" style={{ marginTop: "0.6rem" }}>
                <Term id="ebitda_margin">EBITDA margin</Term> {pct(ebitdaM)}
              </p>
            ) : (
              <p className="book-note" style={{ marginTop: "0.6rem" }}>EBITDA margin {pct(ebitdaM)}</p>
            )}
          </>
        ) : null}
      </>
    );
  }

  return (
    <section className="verdict-book" aria-label="Valuation book">
      <div
        className={`book-stage ${turning ? (turning.dir > 0 ? "turning-next" : "turning-prev") : ""}`}
        tabIndex={0}
        aria-label={`Valuation book page ${page + 1} of ${pages}.`}
        onClick={() => turn(1)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " " || e.key === "ArrowRight") {
            e.preventDefault();
            turn(1);
          }
          if (e.key === "ArrowLeft") {
            e.preventDefault();
            turn(-1);
          }
        }}
      >
        <div className="book-thickness" aria-hidden />
        <div className="book-sheet under" aria-hidden>
          {turning ? leaf(under) : null}
        </div>
        <div
          className={`book-sheet leaf ${turning ? (turning.dir > 0 ? "turn-next" : "turn-prev") : ""}`}
          onAnimationEnd={onFlipEnd}
        >
          <div className="book-face front">{leaf(shown)}</div>
          <div className="book-face back" aria-hidden />
        </div>
        <button type="button" className="book-next" onClick={(e) => turn(1, e)}>
          Go to the next page
          <span aria-hidden>→</span>
        </button>
      </div>
    </section>
  );
}

function NegativeEquityPanel({ model }: { model: Workspace }) {
  const diag = (model.negative_equity_diagnostic || model.negative_iv_diagnostics || {}) as Record<string, unknown>;
  const div = model.display.scale_divisor;
  const india = model.display.is_india;
  const sym = currencySymbol(model.display.currency);
  const moneyOpts = { divisor: div, isIndia: india };
  const rows: { label: string; value: number | null | undefined; sign?: string }[] = [
    { label: "Enterprise value", value: diag.enterprise_value as number },
    { label: "Cash", value: diag.cash as number, sign: "+" },
    { label: "Investments", value: diag.non_operating_investments as number, sign: "+" },
    { label: "Debt", value: diag.debt as number, sign: "−" },
    { label: "Lease liabilities", value: diag.leases as number, sign: "−" },
    { label: "NCI", value: diag.minority_interest as number, sign: "−" },
    { label: "Other claims", value: diag.preferred as number, sign: "−" },
    { label: "Residual equity", value: diag.equity_value as number },
  ];
  const klass = String(diag.result_class || (model.equity_presentation as { status?: string } | undefined)?.status || "FORECAST_UNCERTAIN");
  const causes = Array.isArray(diag.causes) ? (diag.causes as string[]) : [];
  return (
    <article className="card residual-card">
      <h2>Why is the DCF negative?</h2>
      <p className="note">
        Classification: {klass.replaceAll("_", " ")}. Negative residual equity is not a distress filing
        and is not floored to zero.
      </p>
      <ul className="residual-bridge">
        {rows.map((row) => {
          const n = Number(row.value || 0);
          const prefix = row.sign === "+" ? "+" : row.sign === "−" ? "−" : n < 0 ? "−" : "";
          return (
            <li key={row.label}>
              <span>{row.label}</span>
              <b>
                {prefix}
                {compactMoney(Math.abs(n), sym, moneyOpts)}
              </b>
            </li>
          );
        })}
      </ul>
      <p className="iv-blocked">{String(diag.why || diag.primary_cause || "Residual equity is negative after the equity bridge.")}</p>
      {diag.situation_meaning ? <p className="note">{String(diag.situation_meaning)}</p> : null}
      {diag.high_valuation_sensitivity ? <p className="note">HIGH VALUATION SENSITIVITY — nearby WACC or margin cells change the sign.</p> : null}
      {causes.length > 1 ? (
        <ul className="note">
          {causes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

const SCORE_BARS = 10;

function ReliabilityStrip({
  model,
  onOpen,
}: {
  model: Workspace;
  onOpen: (s: ShellSurface, driver?: string) => void;
}) {
  const simple = useSimple();
  const rel = model.reliability;
  if (!rel) return null;
  const health = rel.health;
  const detail = health.primary_risk || health.valuation_status;
  const score = health.overall_score;
  return (
    <div className="rel-strip">
      <div className="rel-strip-head">
        <div>
          <p className="rev-kicker">
            <Term id="reliability">Model reliability</Term>
          </p>
          <strong className={`reliability-band band-${health.overall_status.toLowerCase()}`}>
            {rel.confidence_band} · {health.overall_score}/100
          </strong>
        </div>
        <button type="button" className="btn ghost small" onClick={() => onOpen("quality")}>
          Full audit
        </button>
      </div>
      {simple ? (
        <PlainNote
          plain={
            score >= 70
              ? "The data and assumptions behind this number look solid."
              : score >= 40
                ? "Usable, but some inputs are estimates. Treat the number as a range, not a point."
                : "Treat this number with caution — key inputs are missing or estimated."
          }
          why={detail}
        />
      ) : (
        <p className="note">{detail}</p>
      )}
    </div>
  );
}

/** Puts the (?) in the corner of a clickable stat card, so the button never nests inside another button. */
function StatTerm({ id, children }: { id: Parameters<typeof GlossaryIcon>[0]["id"]; children: React.ReactNode }) {
  const simple = useSimple();
  if (!simple) return <>{children}</>;
  return (
    <div className="stat-term">
      {children}
      <GlossaryIcon id={id} className="corner" />
    </div>
  );
}

function ScoreBar({ label, score, weight }: { label: string; score: number; weight?: number }) {
  const filled = Math.max(0, Math.min(SCORE_BARS, Math.round((score / 100) * SCORE_BARS)));
  return (
    <li className="score-row">
      <span className="score-label">{label}</span>
      <span className={`score-bar${score < 40 ? " low" : score < 70 ? " mid" : ""}`} aria-hidden>
        {"█".repeat(filled)}
        {"░".repeat(SCORE_BARS - filled)}
      </span>
      <b className="score-value">{score}</b>
      {weight == null ? null : <em className="score-weight">{Math.round(weight * 100)}%</em>}
    </li>
  );
}

function ModelReliabilityCard({ model }: { model: Workspace }) {
  const rel = model.reliability;
  if (!rel) return null;
  const health = rel.health;
  const warnings = health.warnings.slice(0, 6);
  const ranked = [...health.components]
    .sort((a, b) => (100 - b.score) * b.weight - (100 - a.score) * a.weight)
    .slice(0, 4);
  return (
    <section className="reliability-panel">
      <h2>Model reliability</h2>
      <div className="reliability-head">
        <div>
          <p className="rev-kicker">Overall</p>
          <h3 className={`reliability-band band-${health.overall_status.toLowerCase()}`}>
            {rel.confidence_band}
          </h3>
        </div>
        <div>
          <p className="rev-kicker">Score</p>
          <h3>{health.overall_score} / 100</h3>
        </div>
        <div>
          <p className="rev-kicker">Methodology</p>
          <h3>{String(health.methodology).replaceAll("_", " ")}</h3>
        </div>
      </div>
      <p className="note">{health.valuation_status}</p>

      <ul className="score-list">
        {health.components.map((c) => (
          <ScoreBar key={c.id} label={c.label} score={c.score} weight={c.weight} />
        ))}
      </ul>

      <h3 className="reliability-sub">Primary model risk</h3>
      <p className="iv-blocked">{health.primary_risk}</p>
      <p className="note">
        Main reasons: {ranked.map((c) => `${c.label} ${c.score}/100`).join(" · ")}
      </p>
      {health.secondary_risks.length ? (
        <p className="note">Also: {health.secondary_risks.join(" · ")}</p>
      ) : null}

      {health.critical_warnings.length ? (
        <>
          <h3 className="reliability-sub">Critical</h3>
          <ul className="note">
            {health.critical_warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </>
      ) : null}

      {warnings.length ? (
        <>
          <h3 className="reliability-sub">Key warnings</h3>
          <ul className="note">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </>
      ) : null}

      <h3 className="reliability-sub">Why this value</h3>
      <p className="note">{rel.value_explanation.primary_statement || "No valuation to explain."}</p>
      <dl className="cyc-grid">
        <div>
          <dt>Business category</dt>
          <dd>{rel.required_category.replaceAll("_", " ")}</dd>
        </div>
        <div>
          <dt>Capital intensity</dt>
          <dd>{rel.capital_intensity.category.replaceAll("_", " ")}</dd>
        </div>
        <div>
          <dt>Growth regime</dt>
          <dd>
            {rel.forecast_quality.regime.regime.replaceAll("_", " ")} · {rel.forecast_quality.regime.confidence}%
          </dd>
        </div>
        <div>
          <dt>Forecast vs historical CAGR</dt>
          <dd>
            {pct(rel.forecast_quality.forecast_cagr)} vs {pct(rel.forecast_quality.historical_cagr)}
          </dd>
        </div>
        <div>
          <dt>Terminal value / EV</dt>
          <dd>{pct(rel.terminal_value_quality.tv_pct_of_ev)}</dd>
        </div>
        <div>
          <dt>Margin stability</dt>
          <dd>
            {rel.forecast_quality.margin_stability_score}/100 · {rel.forecast_quality.margin_pattern.replaceAll("_", " ")}
          </dd>
        </div>
      </dl>
      <p className="note">{rel.forecast_quality.growth_gap_statement}</p>
      <p className="note">{health.note}</p>
    </section>
  );
}

function ReliabilityDetail({ model }: { model: Workspace }) {
  const rel = model.reliability;
  const [open, setOpen] = useState<string | null>(null);
  if (!rel) return null;
  const div = model.display.scale_divisor;
  const ve = rel.value_explanation;
  const d = (ve.drivers || {}) as Record<string, number | null>;
  const stability = rel.stability;

  const bridge: { id: string; label: string; value: number | null; money: boolean; detail: string }[] = [
    { id: "rev", label: "Revenue (terminal year)", value: null, money: true, detail: "" },
  ];
  bridge.length = 0;
  const push = (id: string, label: string, value: number | null, money: boolean, detail: string) =>
    bridge.push({ id, label, value, money, detail });
  push("g1", "Revenue growth Y1", d.revenue_growth_y1 ?? null, false, `Method: ${rel.forecast_quality.drivers[0]?.method || "—"}. ${rel.forecast_quality.drivers[0]?.rationale || ""}`);
  push("margin", "Terminal EBIT margin", d.terminal_ebit_margin ?? null, false, rel.forecast_quality.margin_method);
  push("fcff1", "FCFF Y1", d.fcff_y1 ?? null, true, "NOPAT + D&A − capex − ΔNWC, from the forecast engine.");
  push("fcffT", "FCFF terminal year", d.fcff_terminal ?? null, true, "Last explicit forecast year; its growth is pinned to terminal g so Gordon matches the path.");
  push("pvf", "PV of explicit FCFF", d.pv_explicit_fcff ?? null, true, `Discounted at WACC ${pct(d.wacc)}.`);
  push("pvtv", "PV of terminal value", d.pv_terminal_value ?? null, true, `Gordon: FCFF × (1+g) / (WACC − g), g = ${pct(d.terminal_growth)}. TV/EV ${pct(d.tv_pct_of_ev)}.`);
  push("ev", "Enterprise value", d.enterprise_value ?? null, true, "PV(FCFF) + PV(TV). This identity is verified every run.");
  push("cash", "+ Cash", d.cash ?? null, true, coverageNote(rel, "Cash and cash equivalents"));
  push("inv", "+ Investments", d.investments ?? null, true, coverageNote(rel, "Investments (non-operating)"));
  push("debt", "− Debt", d.debt ?? null, true, coverageNote(rel, "Debt (borrowings)"));
  push("lease", "− Lease liabilities", d.leases ?? null, true, coverageNote(rel, "Lease liabilities"));
  push("nci", "− NCI", d.nci ?? null, true, coverageNote(rel, "Non-controlling interest"));
  push("eq", "Equity value", d.equity_value ?? null, true, "Enterprise value plus cash and investments, less debt, leases and NCI.");
  push("sh", "÷ Diluted shares", d.shares ?? null, true, coverageNote(rel, "Diluted share count"));
  push("iv", "Intrinsic value / share", ve.intrinsic_value_per_share ?? null, false, "Equity value divided by diluted shares. Market price is never used to derive it.");

  return (
    <>
      <article className="card">
        <h2>Value bridge</h2>
        <p className="note">Click any line for its value, source, calculation and confidence.</p>
        <ul className="bridge-list">
          {bridge.map((row) => (
            <li key={row.id}>
              <button type="button" onClick={() => setOpen(open === row.id ? null : row.id)}>
                <span>{row.label}</span>
                <b>
                  {row.value == null
                    ? "unavailable"
                    : row.money
                      ? scaled(row.value, div)
                      : row.id === "iv"
                        ? perShare(row.value, currencySymbol(model.display.currency))
                        : pct(row.value)}
                </b>
              </button>
              {open === row.id ? <p className="note bridge-detail">{row.detail}</p> : null}
            </li>
          ))}
        </ul>
      </article>

      <article className="card">
        <h2>Data coverage</h2>
        <p className="note">Unavailable stays unavailable. It is never converted to zero.</p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Field</th>
                <th>Status</th>
                <th>Source</th>
                <th>As of</th>
              </tr>
            </thead>
            <tbody>
              {rel.data_quality.fields.map((f) => (
                <tr key={f.field}>
                  <td>{f.field}</td>
                  <td className={f.status === "UNAVAILABLE" ? "cov-bad" : f.status === "AVAILABLE" ? "cov-ok" : "cov-mid"}>
                    {f.status}
                  </td>
                  <td>{f.source || "—"}</td>
                  <td>{f.as_of || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>

      <article className="card">
        <h2>Forecast evidence</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Driver</th>
                <th>Value</th>
                <th>Method</th>
                <th>Evidence</th>
                <th>Confidence</th>
              </tr>
            </thead>
            <tbody>
              {rel.forecast_quality.drivers.map((dr) => (
                <tr key={dr.driver}>
                  <td>{dr.driver}</td>
                  <td>{dr.value == null ? "unavailable" : dr.unit === "x" ? dr.value.toFixed(2) : pct(dr.value)}</td>
                  <td>{dr.method}</td>
                  <td>{dr.evidence_strength}/100</td>
                  <td>{dr.confidence}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="note">
          Capital intensity: {rel.capital_intensity.evidence.join(" ")}{" "}
          {rel.capital_intensity.split_available
            ? `Maintenance ${pct(rel.capital_intensity.maintenance_capex_pct)} of revenue, growth capex ${pct(rel.capital_intensity.growth_capex_pct)}.`
            : "Maintenance and growth capex cannot be separated from the available data."}
        </p>
      </article>

      <article className="card">
        <h2>WACC inputs</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Input</th>
                <th>Value</th>
                <th>Source</th>
                <th>As of</th>
                <th>Method</th>
                <th>Confidence</th>
              </tr>
            </thead>
            <tbody>
              {rel.wacc_quality.inputs.map((row) => (
                <tr key={row.input}>
                  <td>{row.input}</td>
                  <td>{row.value == null ? "—" : row.input === "Beta" ? row.value.toFixed(2) : pct(row.value)}</td>
                  <td>{row.source}</td>
                  <td>{row.as_of || "—"}</td>
                  <td>{row.method}</td>
                  <td>{row.confidence}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rel.wacc_quality.warnings.length ? (
          <ul className="note">
            {rel.wacc_quality.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        ) : null}
      </article>

      {stability ? (
        <article className="card">
          <h2>Valuation stability</h2>
          <p className="note">
            Each shock re-runs the whole model. Score {stability.score}/100
            {stability.max_swing_pct == null ? "" : ` · largest single-driver swing ${pct(stability.max_swing_pct)}`}
            {stability.sign_flips ? " · equity value changes sign within the tested range" : ""}.
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Property</th>
                  <th>Expectation</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {stability.properties.map((p) => (
                  <tr key={p.property}>
                    <td>{p.property}</td>
                    <td>{p.expectation}</td>
                    <td className={p.status === "MODEL_ERROR" ? "cov-bad" : p.status === "PASS" ? "cov-ok" : "cov-mid"}>
                      {p.status.replaceAll("_", " ")}
                      {p.note ? <em className="note"> {p.note}</em> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      ) : null}
    </>
  );
}

function coverageNote(rel: NonNullable<Workspace["reliability"]>, field: string): string {
  const f = rel.data_quality.fields.find((x) => x.field === field);
  if (!f) return "";
  return `${f.status} · ${f.source || "no source"}${f.as_of ? ` · as of ${f.as_of}` : ""}. ${f.note}`;
}

function ModelHealthGate({ model }: { model: Workspace }) {
  const health = model.model_health;
  const items = health?.items || [];
  if (!items.length) return null;
  return (
    <article className="card">
      <h2>Model health</h2>
      <p className="note">
        {health?.passed
          ? "Critical identities passed. A precise intrinsic value may be shown."
          : health?.block_reason || "A critical item failed. Intrinsic value is blocked rather than shown as a misleading number."}
      </p>
      <ul className="health-list">
        {items.map((item) => (
          <li key={item.id}>
            <span>{item.ok ? "✓" : "✕"}</span>
            <b>{item.label}</b>
            {item.critical ? <em>critical</em> : <em>review</em>}
          </li>
        ))}
      </ul>
    </article>
  );
}

function CyclicalCard({ model }: { model: Workspace }) {
  const cyc = (model.cyclical_normalization || {}) as Record<string, unknown>;
  const conf = (cyc.forecast_confidence || {}) as Record<string, unknown>;
  const drivers = (model.revenue_driver_model || {}) as Record<string, unknown>;
  return (
    <article className="card">
      <h2>Cyclical mid-cycle economics</h2>
      <p className="note">{String(cyc.rationale || "Normalized margins are mid-cycle, not the latest year and not the peak.")}</p>
      <dl className="cyc-grid">
        <div><dt>Latest EBITDA</dt><dd>{pct(cyc.latest_ebitda_margin as number)}</dd></div>
        <div><dt>Normalized EBITDA</dt><dd>{pct(cyc.normalized_ebitda_margin as number)}</dd></div>
        <div><dt>Peak</dt><dd>{pct(cyc.peak_ebitda_margin as number)}</dd></div>
        <div><dt>Trough</dt><dd>{pct(cyc.trough_ebitda_margin as number)}</dd></div>
        <div><dt>Cycle state</dt><dd>{String(cyc.cycle_state || "unknown").replaceAll("_", " ")}</dd></div>
        <div><dt>Forecast confidence</dt><dd>{String(conf.band || cyc.confidence || "Low")}</dd></div>
        <div><dt>Revenue driver model</dt><dd>{String(drivers.model || "NOT AVAILABLE")}</dd></div>
        <div><dt>Revenue method</dt><dd>{String(drivers.method || "historical_normalized_growth")}</dd></div>
      </dl>
      {conf.note ? <p className="note">{String(conf.note)}</p> : null}
      {drivers.note ? <p className="note">{String(drivers.note)}</p> : null}
    </article>
  );
}

function ScenarioRangeCard({ model }: { model: Workspace }) {
  const blocked = intrinsicBlocked(model);
  const residual = residualNegative(model);
  const bridge = bridgeOf(model);
  const sym = currencySymbol(model.display.currency);
  const bear = scenarioPrice(model, "Bear");
  const bull = scenarioPrice(model, "Bull");
  const base = blocked || residual ? null : bridge.equity_value_per_share;
  const market = bridge.current_share_price;
  return (
    <article className="card">
      <h2>DCF scenario range</h2>
      <p className="note">
        This is not a target price. Bear / Base / Bull are assumption cases. Market price is a separate reference and is never used to calibrate the range.
      </p>
      <dl className="cyc-grid">
        <div><dt>Bear</dt><dd>{blocked ? "—" : perShare(bear, sym)}</dd></div>
        <div><dt>Base</dt><dd>{blocked ? "—" : residual ? "Below 0" : perShare(base, sym)}</dd></div>
        <div><dt>Bull</dt><dd>{blocked ? "—" : perShare(bull, sym)}</dd></div>
        <div><dt>Market (reference)</dt><dd>{perShare(market, sym)}</dd></div>
      </dl>
    </article>
  );
}

function ValuationConfidenceCard({ model }: { model: Workspace }) {
  const conf = model.valuation_confidence;
  if (!conf) return null;
  return (
    <article className="card">
      <h2>Valuation confidence ≠ model quality</h2>
      <p className="note">{conf.note}</p>
      <dl className="cyc-grid">
        <div><dt>Model quality</dt><dd>{model.integrity?.score ?? "—"} / 100 · {model.integrity?.status || "—"}</dd></div>
        <div><dt>Valuation confidence</dt><dd>{conf.score} / 100 · {conf.band}</dd></div>
      </dl>
      {conf.deductions.length ? (
        <ul className="note">
          {conf.deductions.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

function AssetBridgeCard({ model }: { model: Workspace }) {
  const assets = model.asset_classification;
  if (!assets) return null;
  const div = model.display.scale_divisor;
  return (
    <article className="card">
      <h2>Asset classification</h2>
      <p className="note">{assets.primary_statements_note}</p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Asset</th>
              <th>Amount</th>
              <th>Operating?</th>
              <th>Already in EV?</th>
              <th>Equity adj.?</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>
            {assets.lines.map((ln) => (
              <tr key={ln.name}>
                <td>{ln.name}</td>
                <td>{scaled(ln.amount, div)}</td>
                <td>{ln.operating}</td>
                <td>{ln.already_in_ev ? "Yes" : "No"}</td>
                <td>{ln.equity_adjustment ? "Yes" : "No"}</td>
                <td className="wrap-cell">{ln.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {assets.material_unclassified ? (
        <p className="note">Unclassified residual {scaled(assets.residual_unknown, div)} is flagged for review and is not auto-added.</p>
      ) : null}
    </article>
  );
}

function WaccAuditCard({ model }: { model: Workspace }) {
  const w = (model.wacc_audit || {}) as Record<string, unknown>;
  const tax = (model.tax_policy || {}) as Record<string, unknown>;
  const debt = (model.debt_reconciliation || {}) as Record<string, unknown>;
  const nci = (model.nci_policy || {}) as Record<string, unknown>;
  const group = (model.group_structure || {}) as Record<string, unknown>;
  const split = model.terminal_split;
  const div = model.display.scale_divisor;
  const sens = Array.isArray(w.sensitivity) ? (w.sensitivity as { wacc: number; iv: number | null }[]) : [];
  return (
    <article className="card">
      <h2>WACC / tax / claims audit</h2>
      <dl className="cyc-grid">
        <div><dt>Rf</dt><dd>{pct(w.rf as number)}</dd></div>
        <div><dt>ERP</dt><dd>{pct(w.erp as number)}</dd></div>
        <div><dt>βU</dt><dd>{w.unlevered_beta == null ? "—" : Number(w.unlevered_beta).toFixed(2)}</dd></div>
        <div><dt>βL</dt><dd>{w.relevered_beta == null ? "—" : Number(w.relevered_beta).toFixed(2)}</dd></div>
        <div><dt>Ke</dt><dd>{pct(w.ke as number)}</dd></div>
        <div><dt>Kd pre-tax</dt><dd>{pct(w.pretax_kd as number)}</dd></div>
        <div><dt>WACC</dt><dd>{pct(w.wacc as number)}</dd></div>
        <div><dt>Hamada T</dt><dd>{pct(tax.hamada_tax_rate as number)}</dd></div>
        <div><dt>FCFF T</dt><dd>{pct(tax.fcff_tax_rate as number)}</dd></div>
        <div><dt>Debt ex-leases</dt><dd>{scaled(debt.total_debt_ex_leases as number, div)}</dd></div>
        <div><dt>Leases separate</dt><dd>{debt.leases_separate ? "Yes" : "Review"}</dd></div>
        <div><dt>NCI deducted</dt><dd>{nci.deducted ? "Yes" : "No"}</dd></div>
      </dl>
      {sens.length ? (
        <p className="note">
          WACC sensitivity (IV/share):{" "}
          {sens.map((s) => `${pct(s.wacc)} → ${s.iv == null ? "—" : s.iv.toFixed(2)}`).join(" · ")}
        </p>
      ) : null}
      {split ? (
        <p className="note">
          PV explicit FCFF {scaled(split.pv_explicit_fcff, div)} · PV terminal {scaled(split.pv_terminal_value, div)} · TV/EV {pct(split.tv_pct_of_ev)}
        </p>
      ) : null}
      {typeof tax.rationale === "string" ? <p className="note">{tax.rationale}</p> : null}
      {typeof group.note === "string" ? <p className="note">{group.note}</p> : null}
    </article>
  );
}

function scenarioPrice(model: Workspace, name: "Bear" | "Bull"): number | null {
  const sc = model.scenarios?.[`${name} Case`];
  if (!sc) return null;
  return (sc.valuation as { equity_bridge: { equity_value_per_share: number } }).equity_bridge.equity_value_per_share;
}

function spanLabel(model: Workspace): string {
  const h = model.historicals.income_statements;
  const f = model.forecast.years;
  if (!h.length || !f.length) return "";
  return `${fyLong(String(h[0].period))}–${fyLong(String(h[h.length - 1].period))} · ${fyLong(String(f[0].period))}–${fyLong(String(f[f.length - 1].period))}`;
}
