"use client";

import Link from "next/link";
import { Fragment, useCallback, useMemo, useState } from "react";
import { CompanyLogo } from "@/components/CompanyLogo";
import type { FundAnalysis, FundHolding, FundPortfolio } from "@/lib/api";
import { assetClass, assetKind, categoryRisk, categoryShort, planType, RiskLevel } from "@/lib/funds/category";
import { rupees, signedPoints, tone } from "@/lib/funds/format";
import { benchView, FundRow, pts, returnView, VERDICT_LABEL, verdictTone } from "@/lib/funds/returns";
import { isWatched, setFundView, useFundView, useWatchlist } from "@/lib/funds/local";
import { MAX_COMPARE } from "./CompareTray";
import { FundCard } from "./FundCard";
import { HoldingRows } from "./HoldingRows";
import { CategoryChip, EmptyState, GapNote, RiskBadge } from "./FundAtoms";
import { CategoryIcon, GridIcon, RowsIcon } from "./FundIcons";
import { SimilarFunds } from "./SimilarFunds";

type SortKey = "name" | "category" | "risk" | "r1y" | "xirr" | "alpha" | "weight" | "value" | "gain";
type Sort = { key: SortKey; dir: "asc" | "desc" };
type RiskFilter = "any" | "low" | "mid" | "high";
type Preset = "all" | "steady" | "beating" | "lagging" | "bold";
type PlanFilter = "all" | "Direct" | "Regular";

const RISK_FILTERS: { id: RiskFilter; label: string; test: (r: RiskLevel | null) => boolean }[] = [
  { id: "any", label: "Any risk", test: () => true },
  { id: "low", label: "Low to moderate", test: (r) => r != null && r <= 3 },
  { id: "mid", label: "Moderately high / high", test: (r) => r === 4 || r === 5 },
  { id: "high", label: "Very high", test: (r) => r === 6 },
];

export type Row = {
  h: FundHolding;
  color: string;
  weight: number;
  risk: RiskLevel | null;
  asset: string;
  category: string;
  plan: "Direct" | "Regular";
  perf: FundRow | undefined;
  /** The return to show: annualized only when the server says a year of money allows it. */
  ret: number | null;
  retShort: string;
  /** Fund minus its own benchmark, in percentage points, over identical dates. */
  alpha: number | null;
  benchLabel: string | null;
};

const PRESETS: { id: Preset; label: string; hint: string; test: (r: Row, median1y: number | null) => boolean }[] = [
  { id: "all", label: "All funds", hint: "Every holding", test: () => true },
  {
    id: "steady",
    label: "Low risk + high return",
    hint: "Risk low to moderate, and a 1Y return in the top half of your funds",
    test: (r, m) => r.risk != null && r.risk <= 3 && r.h.return_1y != null && m != null && r.h.return_1y >= m,
  },
  { id: "beating", label: "Ahead of benchmark", hint: "Ahead of its own benchmark over the same dates, once there are at least 30 days of holding", test: (r) => r.perf?.verdict === "outperformed" },
  { id: "lagging", label: "Behind benchmark", hint: "Behind its own benchmark over the same dates (30+ days), or down over one year", test: (r) => r.perf?.verdict === "underperformed" || (r.h.return_1y != null && r.h.return_1y < 0) },
  { id: "bold", label: "Very high risk", hint: "Risk estimated at the top of the scale", test: (r) => r.risk === 6 },
];

const COLUMNS: { key: SortKey; label: string; numeric?: boolean; title?: string }[] = [
  { key: "category", label: "Category" },
  { key: "risk", label: "Risk", title: "Estimated from the AMFI category" },
  { key: "r1y", label: "1Y", numeric: true, title: "Trailing one-year NAV return" },
  { key: "xirr", label: "Return", numeric: true, title: "Annualized XIRR for money held a year or more, otherwise the plain return since purchase" },
  { key: "alpha", label: "vs benchmark", numeric: true, title: "Fund return minus its own benchmark over identical dates, in percentage points" },
  { key: "weight", label: "Weight", numeric: true },
  { key: "value", label: "Value", numeric: true },
  { key: "gain", label: "Gain", numeric: true },
];

const SORT_OPTIONS: { key: SortKey; label: string; ranked: boolean }[] = [
  { key: "weight", label: "Weight", ranked: true },
  { key: "r1y", label: "1Y return", ranked: true },
  { key: "xirr", label: "Return", ranked: true },
  { key: "alpha", label: "Vs benchmark", ranked: true },
  { key: "gain", label: "Gain", ranked: true },
  { key: "value", label: "Value", ranked: true },
  { key: "risk", label: "Risk", ranked: true },
  { key: "name", label: "Fund name", ranked: false },
];

function sortValue(row: Row, key: SortKey): number | string | null {
  switch (key) {
    case "name":
      return row.h.scheme_name.toLowerCase();
    case "category":
      return row.category.toLowerCase();
    case "risk":
      return row.risk;
    case "r1y":
      return row.h.return_1y;
    case "xirr":
      return row.ret;
    case "alpha":
      return row.alpha;
    case "weight":
      return row.weight;
    case "value":
      return row.h.value;
    case "gain":
      return row.h.gain_pct;
  }
}

function TableGlyph() {
  return (
    <svg width={15} height={15} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} aria-hidden>
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <path d="M2 7h12M6.5 3v10" />
    </svg>
  );
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function FundScreener({
  book,
  analysis,
  blocked,
  colorOf,
  selected,
  onToggle,
  busyCode,
  onRemove,
}: {
  book: FundPortfolio;
  analysis: FundAnalysis | null;
  blocked: readonly string[];
  colorOf: (code: number) => string;
  selected: number[];
  onToggle: (code: number) => void;
  busyCode: number | null;
  onRemove: (code: number) => Promise<void>;
}) {
  const view = useFundView();
  const watchlist = useWatchlist();
  const [sort, setSort] = useState<Sort>({ key: "weight", dir: "desc" });
  const [preset, setPreset] = useState<Preset>("all");
  const [asset, setAsset] = useState("All");
  const [risk, setRisk] = useState<RiskFilter>("any");
  const [house, setHouse] = useState("All");
  const [plan, setPlan] = useState<PlanFilter>("all");
  const [query, setQuery] = useState("");
  const [similar, setSimilar] = useState<number | null>(null);
  const [hot, setHot] = useState<number | null>(null);
  const total = book.totals.value;

  const rows = useMemo<Row[]>(() => {
    const byCode = new Map((analysis?.funds ?? []).map((f) => [f.scheme_code, f]));
    return book.holdings.map((h) => {
      const perf = byCode.get(h.scheme_code);
      const ret = returnView(perf, blocked);
      const bench = benchView(perf);
      return {
        h,
        color: colorOf(h.scheme_code),
        weight: total > 0 ? (h.value / total) * 100 : 0,
        risk: h.data_available ? categoryRisk(h.scheme_category, h.scheme_name) : null,
        asset: assetClass(h.scheme_category),
        category: categoryShort(h.scheme_category),
        plan: planType(h.scheme_name).plan,
        perf,
        ret: ret.value,
        retShort: ret.short,
        alpha: bench.available ? (perf?.relative_pp ?? null) : null,
        benchLabel: bench.label,
      };
    });
  }, [book, analysis, blocked, colorOf, total]);

  const median1y = useMemo(() => median(rows.map((r) => r.h.return_1y).filter((v): v is number => v != null)), [rows]);
  const classes = useMemo(() => Array.from(new Set(rows.map((r) => r.asset))).sort(), [rows]);
  const houses = useMemo(() => Array.from(new Set(rows.map((r) => r.h.fund_house).filter((h) => h && h !== "Unknown"))).sort(), [rows]);
  const plans = useMemo(() => new Set(rows.map((r) => r.plan)), [rows]);

  const presetTest = PRESETS.find((p) => p.id === preset)?.test ?? (() => true);
  const riskTest = RISK_FILTERS.find((f) => f.id === risk)?.test ?? (() => true);
  const needle = query.trim().toLowerCase();
  const matches = (r: Row) =>
    (!needle || `${r.h.scheme_name} ${r.h.fund_house} ${r.category} ${r.asset}`.toLowerCase().includes(needle)) &&
    presetTest(r, median1y) && (asset === "All" || r.asset === asset) && riskTest(r.risk) && (house === "All" || r.h.fund_house === house) && (plan === "all" || r.plan === plan);
  const visible = rows.filter(matches).sort((a, b) => {
    const va = sortValue(a, sort.key);
    const vb = sortValue(b, sort.key);
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    const cmp = typeof va === "string" ? va.localeCompare(vb as string) : va - (vb as number);
    return sort.dir === "asc" ? cmp : -cmp;
  });
  const filtered = needle !== "" || preset !== "all" || asset !== "All" || risk !== "any" || house !== "All" || plan !== "all";
  const hotRow = rows.find((r) => r.h.scheme_code === hot) ?? null;
  const full = selected.length >= MAX_COMPARE;

  const reset = useCallback(() => {
    setPreset("all");
    setAsset("All");
    setRisk("any");
    setHouse("All");
    setPlan("all");
    setQuery("");
  }, []);
  const toggleSimilar = useCallback((code: number) => setSimilar((s) => (s === code ? null : code)), []);

  return (
    <section className="card mf-screener" aria-labelledby="mf-screener-title">
      <div className="mf-panel-head">
        <div>
          <h2 id="mf-screener-title">Your schemes</h2>
          <p className="mf-basis">Tick up to {MAX_COMPARE} to compare side by side. Star a fund to keep it on your watchlist.</p>
        </div>
        <div className="seg mf-view" role="group" aria-label="Layout">
          <button type="button" aria-pressed={view === "list"} onClick={() => setFundView("list")}>
            <RowsIcon size={15} /> List
          </button>
          <button type="button" aria-pressed={view === "cards"} onClick={() => setFundView("cards")}>
            <GridIcon size={15} /> Cards
          </button>
          <button type="button" aria-pressed={view === "table"} onClick={() => setFundView("table")}>
            <TableGlyph /> Table
          </button>
        </div>
      </div>

      <div className="mf-presets" role="group" aria-label="Quick filters">
        {PRESETS.map((p) => {
          const count = p.id === "all" ? rows.length : rows.filter((r) => p.test(r, median1y)).length;
          return (
            <button key={p.id} type="button" className="mf-preset" aria-pressed={preset === p.id} title={p.hint} onClick={() => setPreset(p.id)}>
              {p.label}
              <span className="mf-count">{count}</span>
            </button>
          );
        })}
      </div>

      <div className="mf-toolbar">
        <div className="mf-filters">
          <label className="vz-search">
            <span className="visually-hidden">Search your funds</span>
            <input type="search" placeholder="Search funds…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <div className="seg mf-seg" role="group" aria-label="Asset class">
            {["All", ...classes].map((c) => (
              <button key={c} type="button" aria-pressed={asset === c} onClick={() => setAsset(c)}>
                {c !== "All" ? <CategoryIcon kind={assetKind(c)} size={13} /> : null}
                {c}
                <span className="mf-count">{c === "All" ? rows.length : rows.filter((r) => r.asset === c).length}</span>
              </button>
            ))}
          </div>
          <label className="mf-select">
            <span className="visually-hidden">Risk level</span>
            <select value={risk} onChange={(e) => setRisk(e.target.value as RiskFilter)}>
              {RISK_FILTERS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
          {houses.length > 1 ? (
            <label className="mf-select">
              <span className="visually-hidden">Fund house</span>
              <select value={house} onChange={(e) => setHouse(e.target.value)}>
                <option value="All">All fund houses</option>
                {houses.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {plans.size > 1 || plan !== "all" ? (
            <div className="seg mf-seg" role="group" aria-label="Plan">
              {(["all", "Direct", "Regular"] as PlanFilter[]).map((p) => (
                <button key={p} type="button" aria-pressed={plan === p} onClick={() => setPlan(p)}>
                  {p === "all" ? "Any plan" : p}
                </button>
              ))}
            </div>
          ) : null}
          {filtered ? (
            <button type="button" className="text-btn mf-reset" onClick={reset}>
              Reset filters
            </button>
          ) : null}
        </div>
        <label className={`mf-select${view === "table" ? " mf-sort-mobile" : ""}`}>
          <span className="visually-hidden">Sort by</span>
          <select
            value={`${sort.key}:${sort.dir}`}
            onChange={(e) => {
              const [key, dir] = e.target.value.split(":") as [SortKey, Sort["dir"]];
              setSort({ key, dir });
            }}
          >
            {SORT_OPTIONS.flatMap((c) => [
              <option key={`${c.key}:desc`} value={`${c.key}:desc`}>
                {c.label}, {c.ranked ? "high to low" : "Z to A"}
              </option>,
              <option key={`${c.key}:asc`} value={`${c.key}:asc`}>
                {c.label}, {c.ranked ? "low to high" : "A to Z"}
              </option>,
            ])}
          </select>
        </label>
      </div>

      <p className="visually-hidden" aria-live="polite">
        {visible.length} of {rows.length} funds shown
      </p>

      {visible.length === 0 ? (
        <EmptyState art="filter" title="No funds match these filters" compact actions={<button type="button" className="btn secondary small" onClick={reset}>Reset filters</button>}>
          <p className="muted">
            {preset !== "all" ? `${PRESETS.find((p) => p.id === preset)?.label}: ${PRESETS.find((p) => p.id === preset)?.hint}.` : "Try a wider asset class, risk band or plan."}
          </p>
        </EmptyState>
      ) : view === "list" ? (
        <HoldingRows rows={visible} book={book} selected={selected} full={full} onToggle={onToggle} busyCode={busyCode} onRemove={onRemove} similar={similar} toggleSimilar={toggleSimilar} />
      ) : view === "cards" ? (
        <div className="mf-cards" onMouseLeave={() => setHot(null)}>
          {visible.map((r) => {
            const code = r.h.scheme_code;
            return (
              <Fragment key={code}>
                <div className="mf-card-slot" onMouseEnter={() => setHot(code)}>
                  <FundCard
                    h={r.h}
                    color={r.color}
                    weight={r.weight}
                    perf={r.perf}
                    blocked={blocked}
                    analysisLoaded={analysis != null}
                    selected={selected.includes(code)}
                    compareFull={full}
                    watched={isWatched(watchlist, code)}
                    busy={busyCode === code}
                    similarOpen={similar === code}
                    onToggleCompare={onToggle}
                    onRemove={onRemove}
                    onSimilar={toggleSimilar}
                  />
                </div>
                {similar === code ? (
                  <div className="card mf-similar-slot" id={`mf-sim-${code}`}>
                    <SimilarFunds
                      subject={{ code, name: r.h.scheme_name, category: r.h.scheme_category, return1y: r.h.return_1y }}
                      holdings={book.holdings}
                      heading={`Similar to ${r.h.scheme_name}`}
                    />
                  </div>
                ) : null}
              </Fragment>
            );
          })}
        </div>
      ) : (
        <FundTable
          rows={visible}
          book={book}
          analysisLoaded={analysis != null}
          sort={sort}
          setSort={setSort}
          selected={selected}
          full={full}
          hot={hot}
          setHot={setHot}
          similar={similar}
          toggleSimilar={toggleSimilar}
          onToggle={onToggle}
          busyCode={busyCode}
          onRemove={onRemove}
        />
      )}
      <GapNote gaps={["expense-ratio", "rating", "aum"]}>
        Expense ratio, rating and AUM are not shown yet: the free data source does not publish them.
      </GapNote>
    </section>
  );
}

function FundTable({
  rows,
  book,
  analysisLoaded,
  sort,
  setSort,
  selected,
  full,
  hot,
  setHot,
  similar,
  toggleSimilar,
  onToggle,
  busyCode,
  onRemove,
}: {
  rows: Row[];
  book: FundPortfolio;
  analysisLoaded: boolean;
  sort: Sort;
  setSort: (s: Sort | ((cur: Sort) => Sort)) => void;
  selected: number[];
  full: boolean;
  hot: number | null;
  setHot: (code: number | null) => void;
  similar: number | null;
  toggleSimilar: (code: number) => void;
  onToggle: (code: number) => void;
  busyCode: number | null;
  onRemove: (code: number) => Promise<void>;
}) {
  const [pendingRemove, setPendingRemove] = useState<number | null>(null);
  const colCount = COLUMNS.length + 2;

  function toggleSort(key: SortKey) {
    setSort((cur) => (cur.key === key ? { key, dir: cur.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "name" || key === "category" ? "asc" : "desc" }));
  }

  function header(key: SortKey, label: string, title?: string, numeric?: boolean) {
    const on = sort.key === key;
    return (
      <th key={key} scope="col" aria-sort={on ? (sort.dir === "asc" ? "ascending" : "descending") : "none"} className={numeric ? "num" : ""}>
        <button type="button" onClick={() => toggleSort(key)} title={title}>
          {label}
          <span className={`mf-sort${on ? " on" : ""}`} aria-hidden>
            {on ? (sort.dir === "asc" ? "↑" : "↓") : "↕"}
          </span>
        </button>
      </th>
    );
  }

  return (
    <div className="mf-table-wrap">
      <table className="mf-table">
        <caption className="visually-hidden">Your mutual fund holdings. Column headers sort the table.</caption>
        <thead>
          <tr>
            {header("name", "Fund")}
            {COLUMNS.map((c) => header(c.key, c.label, c.title, c.numeric))}
            <th scope="col" className="mf-actions-col">
              <span className="visually-hidden">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody onMouseLeave={() => setHot(null)}>
          {rows.map((r) => {
            const code = r.h.scheme_code;
            const checked = selected.includes(code);
            const plan = planType(r.h.scheme_name);
            const simId = `mf-sim-${code}`;
            return (
              <Fragment key={code}>
                <tr className={`${hot === code ? "on" : ""}${checked ? " picked" : ""}`} onMouseEnter={() => setHot(code)}>
                  <th scope="row" className="mf-fund-cell">
                    <span className="mf-fund">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={!checked && full}
                        title={!checked && full ? `Up to ${MAX_COMPARE} funds` : undefined}
                        aria-label={`Compare ${r.h.scheme_name}`}
                        onChange={() => onToggle(code)}
                      />
                      <i className="funds-swatch" style={{ background: r.color }} aria-hidden />
                      <span className="mf-fund-id">
                        <Link href={`/funds/${code}`}>
                          {r.h.fund_house && r.h.fund_house !== "Unknown" ? <CompanyLogo name={r.h.fund_house} size={16} className="funds-amc" /> : null}
                          {r.h.scheme_name}
                        </Link>
                        <span className="muted">
                          {r.h.fund_house !== "Unknown" ? `${r.h.fund_house} · ` : ""}
                          {[plan.plan, plan.option].filter(Boolean).join(" · ")}
                          {!r.h.data_available ? " · Live NAV unavailable" : ""}
                        </span>
                      </span>
                    </span>
                  </th>
                  <td data-label="Category">
                    <CategoryChip category={r.h.scheme_category} />
                  </td>
                  <td data-label="Risk">
                    <RiskBadge level={r.risk} />
                  </td>
                  <td data-label="1Y" className={`num ${tone(r.h.return_1y)}`}>
                    {signedPoints(r.h.return_1y, 1)}
                  </td>
                  <td data-label="Return" className={`num ${tone(r.ret)}`}>
                    {analysisLoaded ? signedPoints(r.ret, 1) : <span className="skel mf-skel-num" aria-label="Loading" />}
                    {analysisLoaded ? <small>{r.retShort}</small> : null}
                  </td>
                  <td data-label="vs benchmark" className={`num ${verdictTone(r.perf?.verdict ?? "unavailable")}`}>
                    {analysisLoaded ? r.alpha == null ? "n/a" : pts(r.alpha) : <span className="skel mf-skel-num" aria-label="Loading" />}
                    {analysisLoaded ? <small title={r.perf?.verdict_text}>{r.alpha == null ? "No benchmark" : `${r.benchLabel} · ${VERDICT_LABEL[r.perf?.verdict ?? "unavailable"]}`}</small> : null}
                  </td>
                  <td data-label="Weight" className="num">
                    {r.weight.toFixed(1)}%
                    <i className="mf-weight" aria-hidden>
                      <i style={{ width: `${Math.min(100, r.weight)}%`, background: r.color }} />
                    </i>
                  </td>
                  <td data-label="Value" className="num">
                    {rupees(r.h.value, 0)}
                  </td>
                  <td data-label="Gain" className={`num ${tone(r.h.gain)}`}>
                    {signedPoints(r.h.gain_pct, 1)}
                    <small>{r.h.gain == null ? "" : rupees(Math.abs(r.h.gain), 0)}</small>
                  </td>
                  <td className="mf-actions-col">
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
                      <span className="mf-row-actions">
                        <button type="button" className="btn ghost small" aria-expanded={similar === code} aria-controls={simId} onClick={() => toggleSimilar(code)}>
                          Similar
                        </button>
                        <button type="button" className="btn ghost small" aria-label={`Remove ${r.h.scheme_name}`} onClick={() => setPendingRemove(code)}>
                          Remove
                        </button>
                      </span>
                    )}
                  </td>
                </tr>
                {similar === code ? (
                  <tr className="mf-sub-row" id={simId}>
                    <td colSpan={colCount}>
                      <SimilarFunds
                        subject={{ code, name: r.h.scheme_name, category: r.h.scheme_category, return1y: r.h.return_1y }}
                        holdings={book.holdings}
                        heading={`Similar to ${r.h.scheme_name}`}
                      />
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
