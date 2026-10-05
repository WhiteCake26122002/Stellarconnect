"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { CompanyGuidancePanel } from "@/components/CompanyGuidancePanel";
import { GlossaryIcon, PlainNote } from "@/components/guide/Glossary";
import type { Drivers, Workspace } from "@/lib/api";
import { pct } from "@/lib/format";
import type { GlossaryId } from "@/lib/glossary";
import { useSimple } from "@/lib/prefs";

type DriverKey = keyof Omit<
  Drivers,
  | "year_overrides"
  | "risk_free_rate_source"
  | "beta_source"
  | "pretax_cost_of_debt_rationale"
  | "terminal_growth_ceiling"
  | "growth_method"
  | "company_guidance_revenue_growth"
  | "company_guidance_quote"
  | "company_guidance_period"
>;

type SectionId = "growth" | "profitability" | "risk" | "capital" | "longrun";

const SECTIONS: { id: SectionId; title: string; summary: string; keys: string[] }[] = [
  {
    id: "growth",
    title: "Growth",
    summary: "How fast sales grow, and for how long. Usually the biggest lever on the final value.",
    keys: ["growth_method", "forecast_years", "long_term_growth"],
  },
  {
    id: "profitability",
    title: "Profitability",
    summary: "How much of each sale is kept as operating profit.",
    keys: ["target_ebitda_margin"],
  },
  {
    id: "risk",
    title: "Risk & discount rate",
    summary: "How risky the company is. The riskier it is, the less its future cash is worth today.",
    keys: ["risk_free_rate", "beta", "equity_risk_premium", "size_premium"],
  },
  {
    id: "capital",
    title: "Capital structure",
    summary: "How the company is funded: what borrowing costs, and who gets paid before shareholders.",
    keys: ["pretax_cost_of_debt", "target_equity_weight", "preferred_stock"],
  },
  {
    id: "longrun",
    title: "Long-run value",
    summary: "What is assumed after the forecast ends. This part is often most of the value.",
    keys: ["terminal_growth", "exit_multiple"],
  },
];

export function DriverDrawer({
  drivers,
  onChange,
  highlight,
  page,
  modelId,
  onWorkspace,
}: {
  drivers: Drivers;
  onChange: (p: Record<string, unknown>) => void;
  highlight?: string | null;
  page?: boolean;
  modelId?: string;
  onWorkspace?: (next: Workspace) => void;
}) {
  const simple = useSimple();
  const [local, setLocal] = useState(drivers);
  useEffect(() => setLocal(drivers), [drivers]);

  function set<K extends DriverKey>(key: K, value: Drivers[K]) {
    setLocal({ ...local, [key]: value });
    onChange({ [key]: value });
  }

  const growthMethod = (
    <div className="field" id="driver-growth_method">
      <div className="field-head">
        {simple ? (
          <span className="field-label">
            <span id="growth-method-label">Revenue growth source</span>
            <GlossaryIcon id="growth_source" />
          </span>
        ) : (
          <span id="growth-method-label">Revenue growth source</span>
        )}
      </div>
      <div className="seg" role="radiogroup" aria-labelledby="growth-method-label">
        <button
          type="button"
          role="radio"
          aria-checked={local.growth_method !== "historical" && local.growth_method !== "llm"}
          aria-pressed={local.growth_method !== "historical" && local.growth_method !== "llm"}
          onClick={() => {
            setLocal({ ...local, growth_method: "evidence" });
            onChange({ growth_method: "evidence" });
          }}
        >
          Evidence
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={local.growth_method === "historical"}
          aria-pressed={local.growth_method === "historical"}
          onClick={() => {
            setLocal({ ...local, growth_method: "historical" });
            onChange({ growth_method: "historical" });
          }}
        >
          Historical
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={local.growth_method === "llm"}
          aria-pressed={local.growth_method === "llm"}
          onClick={() => {
            setLocal({ ...local, growth_method: "llm" });
            onChange({ growth_method: "llm" });
          }}
        >
          LLM explain
        </button>
      </div>
      {simple ? (
        <PlainNote
          plain="Where next year's sales growth comes from. Evidence, the default, uses the company's own track record and any guidance you paste."
          why={GROWTH_METHOD_NOTE}
        />
      ) : (
        <div className="note">{GROWTH_METHOD_NOTE}</div>
      )}
    </div>
  );

  const guidance =
    modelId && onWorkspace ? <CompanyGuidancePanel modelId={modelId} drivers={drivers} onWorkspace={onWorkspace} /> : null;

  const fields: Record<string, ReactNode> = {
    forecast_years: (
      <SliderField
        id="forecast_years"
        label="Horizon"
        value={local.forecast_years}
        min={3}
        max={10}
        step={1}
        format={(v) => `${v}y`}
        unit="y"
        term="forecast_horizon"
        plain={`The model forecasts ${local.forecast_years} years one by one, then assumes steady growth.`}
        highlight={highlight === "forecast_years"}
        onChange={(v) => set("forecast_years", v)}
      />
    ),
    long_term_growth: (
      <SliderField
        id="long_term_growth"
        label="Long-term growth"
        value={local.long_term_growth}
        min={0}
        max={0.15}
        step={0.005}
        format={pct}
        note="Synced to terminal g. The explicit path fades to Gordon g, not a separate 4% knob."
        term="long_term_growth"
        plain={`Sales growth settles toward ${pct(local.long_term_growth)} a year by the end of the forecast.`}
        highlight={highlight === "long_term_growth"}
        onChange={(v) => set("long_term_growth", v)}
      />
    ),
    target_ebitda_margin: (
      <SliderField
        id="target_ebitda_margin"
        label="Target EBITDA margin"
        value={local.target_ebitda_margin}
        min={0.05}
        max={0.6}
        step={0.005}
        format={pct}
        note="Default is the last-3-year median, not peak profitability."
        term="ebitda_margin"
        plain={`Operating profit: ${pct(local.target_ebitda_margin)} of every sale — based on recent years, not the best year.`}
        highlight={highlight === "target_ebitda_margin"}
        onChange={(v) => set("target_ebitda_margin", v)}
      />
    ),
    risk_free_rate: (
      <SliderField
        id="risk_free_rate"
        label="Risk-free rate"
        value={local.risk_free_rate}
        min={0}
        max={0.15}
        step={0.001}
        format={pct}
        note={local.risk_free_rate_source}
        term="risk_free_rate"
        plain={`Safe government bond return: ${pct(local.risk_free_rate)} — the floor every riskier investment must beat.`}
        highlight={highlight === "risk_free_rate"}
        onChange={(v) => set("risk_free_rate", v)}
      />
    ),
    beta: (
      <SliderField
        id="beta"
        label="Beta"
        value={local.beta}
        min={0.3}
        max={3}
        step={0.01}
        format={(v) => v.toFixed(2)}
        note={local.beta_source}
        term="beta"
        plain={`Price swings: ${local.beta.toFixed(2)} — ${
          local.beta < 0.95 ? "calmer than" : local.beta > 1.05 ? "jumpier than" : "about the same as"
        } the market as a whole.`}
        highlight={highlight === "beta"}
        onChange={(v) => set("beta", v)}
      />
    ),
    equity_risk_premium: (
      <SliderField
        id="equity_risk_premium"
        label="Equity risk premium"
        value={local.equity_risk_premium}
        min={0}
        max={0.15}
        step={0.001}
        format={pct}
        term="equity_risk_premium"
        plain={`Extra return for owning shares instead of bonds: ${pct(local.equity_risk_premium)} a year.`}
        highlight={highlight === "equity_risk_premium"}
        onChange={(v) => set("equity_risk_premium", v)}
      />
    ),
    pretax_cost_of_debt: (
      <SliderField
        id="pretax_cost_of_debt"
        label="Pre-tax cost of debt"
        value={local.pretax_cost_of_debt}
        min={0}
        max={0.2}
        step={0.001}
        format={pct}
        note={local.pretax_cost_of_debt_rationale}
        term="cost_of_debt"
        plain={`Cost of borrowing: ${pct(local.pretax_cost_of_debt)} — based on your company's credit strength.`}
        highlight={highlight === "pretax_cost_of_debt"}
        onChange={(v) => set("pretax_cost_of_debt", v)}
      />
    ),
    size_premium: (
      <SliderField
        id="size_premium"
        label="Size premium"
        value={local.size_premium}
        min={0}
        max={0.1}
        step={0.001}
        format={pct}
        term="size_premium"
        plain={
          local.size_premium > 0
            ? `Extra return added because the company is small: ${pct(local.size_premium)}.`
            : "No extra return added for company size."
        }
        highlight={highlight === "size_premium"}
        onChange={(v) => set("size_premium", v)}
      />
    ),
    terminal_growth: (
      <SliderField
        id="terminal_growth"
        label="Terminal growth g"
        value={local.terminal_growth}
        min={0}
        max={0.06}
        step={0.001}
        format={pct}
        note="Last explicit year and Gordon TV use this same g. Must stay below WACC."
        term="terminal_growth"
        plain={`Growth assumed forever after the forecast: ${pct(local.terminal_growth)} a year. It must stay below the rate used to discount future cash.`}
        highlight={highlight === "terminal_growth"}
        onChange={(v) => set("terminal_growth", v)}
      />
    ),
    exit_multiple: (
      <SliderField
        id="exit_multiple"
        label="Exit multiple"
        value={local.exit_multiple}
        min={1}
        max={40}
        step={0.5}
        format={(v) => `${v.toFixed(1)}x`}
        unit="x"
        term="exit_multiple"
        plain={`Cross-check: the business sold at ${local.exit_multiple.toFixed(1)}× its yearly operating profit.`}
        highlight={highlight === "exit_multiple"}
        onChange={(v) => set("exit_multiple", v)}
      />
    ),
    preferred_stock: (
      <SliderField
        id="preferred_stock"
        label="Preferred stock (millions)"
        value={local.preferred_stock}
        min={0}
        max={5000}
        step={1}
        format={(v) => v.toFixed(0)}
        unit=""
        term="preferred_stock"
        plain={
          local.preferred_stock > 0
            ? `${local.preferred_stock.toFixed(0)} million owed to preferred shareholders, paid before ordinary shares.`
            : "No preferred shareholders ahead of ordinary shares."
        }
        highlight={highlight === "preferred_stock"}
        onChange={(v) => set("preferred_stock", v)}
      />
    ),
    target_equity_weight:
      local.target_equity_weight != null ? (
        <SliderField
          id="target_equity_weight"
          label="Target equity weight"
          value={local.target_equity_weight}
          min={0}
          max={1}
          step={0.01}
          format={pct}
          term="equity_weight"
          plain={`${pct(local.target_equity_weight)} of funding comes from shareholders, the rest from lenders.`}
          highlight={highlight === "target_equity_weight"}
          onChange={(v) => set("target_equity_weight", v)}
        />
      ) : null,
  };

  if (simple && page) {
    return (
      <SimpleAssumptions
        highlight={highlight}
        render={(key) => (key === "growth_method" ? growthMethod : fields[key] ?? null)}
        extra={{ growth: guidance }}
        hasField={(key) => key === "growth_method" || fields[key] != null}
      />
    );
  }

  return (
    <aside className={page ? "drawer drawer-page" : "drawer"} id="drivers">
      <h2>{page ? "Assumptions" : "Drivers"}</h2>
      <p className="note">Numbers you type are yours. The model recalculates after you pause.</p>

      <details className="drawer-group" open>
        <summary>Growth</summary>
        {growthMethod}
        {guidance}
        {fields.forecast_years}
        {fields.long_term_growth}
        {fields.target_ebitda_margin}
      </details>

      <details className="drawer-group" open>
        <summary>Cost of capital</summary>
        {fields.risk_free_rate}
        {fields.beta}
        {fields.equity_risk_premium}
        {fields.pretax_cost_of_debt}
        {fields.size_premium}
      </details>

      <details className="drawer-group" open>
        <summary>Terminal & claims</summary>
        {fields.terminal_growth}
        {fields.exit_multiple}
        {fields.preferred_stock}
        {fields.target_equity_weight}
      </details>
    </aside>
  );
}

const GROWTH_METHOD_NOTE =
  "Evidence sets Year-1 from a hierarchy (user override, then verified company guidance, then identity g = ROIC×RR, then a 3y/5y/median blend) and fades to terminal g. Historical is the legacy 2-year glide. LLM explain writes a narrative only — it cannot invent growth rates. Override any year on Forecast.";

function SimpleAssumptions({
  highlight,
  render,
  extra,
  hasField,
}: {
  highlight?: string | null;
  render: (key: string) => ReactNode;
  extra: Partial<Record<SectionId, ReactNode>>;
  hasField: (key: string) => boolean;
}) {
  const [open, setOpen] = useState<Set<SectionId>>(() => new Set());
  const uid = useId();
  const allOpen = open.size === SECTIONS.length;

  useEffect(() => {
    if (!highlight) return;
    const home = SECTIONS.find((s) => s.keys.includes(highlight));
    if (home) setOpen((prev) => (prev.has(home.id) ? prev : new Set(prev).add(home.id)));
  }, [highlight]);

  function toggle(id: SectionId) {
    setOpen((prev) => {
      if (prev.has(id)) {
        const next = new Set(prev);
        next.delete(id);
        return next;
      }
      return prev.size > 1 ? new Set(prev).add(id) : new Set([id]);
    });
  }

  function goNext(from: number) {
    const next = SECTIONS[from + 1];
    if (!next) return;
    setOpen(new Set([next.id]));
    window.setTimeout(() => document.getElementById(`${uid}-${next.id}-head`)?.scrollIntoView({ block: "start", behavior: "smooth" }), 60);
  }

  return (
    <aside className="drawer drawer-page drawer-simple" id="drivers">
      <div className="simple-head">
        <div>
          <h2>Assumptions</h2>
          <p className="note">
            Five groups of inputs. Open one at a time — each change recalculates the value after you pause.
          </p>
        </div>
        <button
          type="button"
          className="btn ghost small"
          aria-expanded={allOpen}
          onClick={() => setOpen(allOpen ? new Set() : new Set(SECTIONS.map((s) => s.id)))}
        >
          {allOpen ? "Collapse all" : "Expand all"}
        </button>
      </div>
      {SECTIONS.map((s, i) => {
        const isOpen = open.has(s.id);
        const keys = s.keys.filter(hasField);
        const count = keys.length + (extra[s.id] ? 1 : 0);
        const bodyId = `${uid}-${s.id}`;
        return (
          <section key={s.id} className={`guide-section${isOpen ? " open" : ""}`}>
            <h3 className="guide-section-title">
              <button
                type="button"
                id={`${bodyId}-head`}
                aria-expanded={isOpen}
                aria-controls={bodyId}
                onClick={() => toggle(s.id)}
              >
                <span className="guide-step">{i + 1}</span>
                <span className="guide-copy">
                  <b>{s.title}</b>
                  <span>{s.summary}</span>
                </span>
                <span className="guide-count">
                  {count} {count === 1 ? "input" : "inputs"}
                </span>
                <span className="guide-caret" aria-hidden>
                  ›
                </span>
              </button>
            </h3>
            {isOpen ? (
              <div id={bodyId} className="guide-section-body" role="region" aria-labelledby={`${bodyId}-head`}>
                <div className="guide-fields">
                  {keys.map((key) => (
                    <div key={key}>{render(key)}</div>
                  ))}
                  {extra[s.id] ? <div className="guide-extra">{extra[s.id]}</div> : null}
                </div>
                {i < SECTIONS.length - 1 && !allOpen ? (
                  <button type="button" className="guide-next" onClick={() => goNext(i)}>
                    Next: {SECTIONS[i + 1].title} <span aria-hidden>→</span>
                  </button>
                ) : null}
              </div>
            ) : null}
          </section>
        );
      })}
    </aside>
  );
}

function SliderField({
  id,
  label,
  value,
  min,
  max,
  step,
  format,
  note,
  highlight,
  unit,
  term,
  plain,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  note?: string;
  highlight?: boolean;
  unit?: string;
  term?: GlossaryId;
  plain?: string;
  onChange: (v: number) => void;
}) {
  const simple = useSimple();
  const uid = useId();
  const labelId = `${uid}-label`;
  const percentish = max <= 1;
  const display = percentish ? Number((value * 100).toFixed(2)) : value;
  const suffix = unit ?? (percentish ? "%" : "");
  const labelEl = (
    <label id={labelId} htmlFor={id}>
      {label}
    </label>
  );

  return (
    <div className={`field ${highlight ? "highlight" : ""}`} id={`driver-${id}`}>
      <div className="field-head">
        {simple && term ? (
          <span className="field-label">
            {labelEl}
            <GlossaryIcon id={term} />
          </span>
        ) : (
          labelEl
        )}
        <div className="field-row">
          <input
            className="compact"
            id={id}
            type="number"
            step={percentish ? step * 100 : step}
            min={percentish ? min * 100 : min}
            max={percentish ? max * 100 : max}
            value={Number.isFinite(display) ? display : 0}
            aria-labelledby={labelId}
            onChange={(e) => {
              const raw = Number(e.target.value);
              onChange(percentish ? raw / 100 : raw);
            }}
          />
          {suffix ? <span className="note">{suffix}</span> : null}
        </div>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-labelledby={labelId}
        aria-valuetext={format(value)}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {simple && plain ? <PlainNote plain={plain} why={note} /> : note ? <div className="note">{note}</div> : null}
    </div>
  );
}
