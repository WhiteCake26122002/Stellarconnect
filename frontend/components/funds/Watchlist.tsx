"use client";

import Link from "next/link";
import { useCallback, useMemo, useRef, useState } from "react";
import type { FundHolding } from "@/lib/api";
import { assetClass, categoryRisk, categoryShort, planType, RISK_SHORT } from "@/lib/funds/category";
import { rupees, signedPoints, tone } from "@/lib/funds/format";
import { NavAlert, unwatch, useAlerts, useWatchlist } from "@/lib/funds/local";
import type { QuoteEntry } from "@/lib/funds/useQuotes";
import { useSchemeSearch } from "@/lib/funds/useSchemeSearch";
import { AlertDialog } from "./Alerts";
import { EmptyState, GapNote, StarButton } from "./FundAtoms";
import { WatchCard } from "./FundCard";

const NO_ALERTS: NavAlert[] = [];
const MAX_COMPARE = 4;

type SortKey = "added" | "name" | "d1" | "m1" | "y1" | "since";
const SORTS: { key: SortKey; label: string }[] = [
  { key: "added", label: "Recently added" },
  { key: "name", label: "Name" },
  { key: "d1", label: "1 day" },
  { key: "m1", label: "1 month" },
  { key: "y1", label: "1 year" },
  { key: "since", label: "Since added" },
];

type Row = {
  code: number;
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
  changes: { d1: number | null; m1: number | null; m3: number | null; y1: number | null } | null;
  since: number | null;
};

function sortValue(r: Row, key: SortKey): number | string | null {
  switch (key) {
    case "added":
      return r.addedAt;
    case "name":
      return r.name.toLowerCase();
    case "d1":
      return r.changes?.d1 ?? null;
    case "m1":
      return r.changes?.m1 ?? null;
    case "y1":
      return r.changes?.y1 ?? null;
    case "since":
      return r.since;
  }
}

export function WatchlistPane({ holdings, quotes }: { holdings: FundHolding[]; quotes: Map<number, QuoteEntry> }) {
  const list = useWatchlist();
  const alerts = useAlerts();
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [alertFor, setAlertFor] = useState<number | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "added", dir: "desc" });
  const [asset, setAsset] = useState("All");
  const [picked, setPicked] = useState<number[]>([]);
  const search = useSchemeSearch(query);
  const held = useMemo(() => new Map(holdings.map((h) => [h.scheme_code, h])), [holdings]);
  const alertsByCode = useMemo(() => {
    const map = new Map<number, NavAlert[]>();
    for (const a of alerts) map.set(a.code, [...(map.get(a.code) ?? []), a]);
    return map;
  }, [alerts]);

  const rows = useMemo<Row[]>(
    () =>
      list.map((w) => {
        const h = held.get(w.code);
        const q = quotes.get(w.code);
        const nav = h?.current_nav ?? q?.quote?.nav ?? null;
        const loading = h?.current_nav == null && (!q || q.state === "loading");
        return {
          code: w.code,
          name: w.name,
          house: w.house ?? h?.fund_house ?? q?.quote?.fund_house ?? null,
          category: w.category ?? h?.scheme_category ?? q?.quote?.scheme_category ?? null,
          nav,
          navDate: h?.current_nav != null ? h.nav_date : (q?.quote?.nav_date ?? null),
          navAtAdd: w.navAtAdd,
          addedAt: w.addedAt,
          loading,
          failed: h?.current_nav == null && q?.state === "failed",
          held: !!h,
          changes: q?.quote?.changes ?? null,
          since: nav != null && w.navAtAdd ? ((nav - w.navAtAdd) / w.navAtAdd) * 100 : null,
        };
      }),
    [list, held, quotes],
  );

  const classes = useMemo(() => Array.from(new Set(rows.map((r) => (r.category ? assetClass(r.category) : "Other")))).sort(), [rows]);
  const visible = useMemo(() => {
    const out = rows.filter((r) => asset === "All" || (r.category ? assetClass(r.category) : "Other") === asset);
    out.sort((a, b) => {
      const va = sortValue(a, sort.key);
      const vb = sortValue(b, sort.key);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      const cmp = typeof va === "string" ? va.localeCompare(vb as string) : (va as number) - (vb as number);
      return sort.dir === "asc" ? cmp : -cmp;
    });
    return out;
  }, [rows, asset, sort]);

  const toggle = useCallback((code: number) => setPicked((cur) => (cur.includes(code) ? cur.filter((c) => c !== code) : cur.length >= MAX_COMPARE ? cur : [...cur, code])), []);
  const openAlert = useCallback((code: number) => setAlertFor(code), []);
  const alertItem = list.find((w) => w.code === alertFor) ?? null;
  const alertRow = alertItem ? rows.find((r) => r.code === alertItem.code) : null;
  const needle = query.trim();
  const chosen = picked.map((c) => rows.find((r) => r.code === c)).filter((r): r is Row => !!r);

  return (
    <div className="funds-analysis">
      <div className="page-head">
        <div>
          <h1>Watchlist</h1>
          <p className="muted">Track schemes before you commit money. Starring does not add anything to your portfolio.</p>
        </div>
      </div>

      <section className="card mf-watch-search" aria-labelledby="mf-watch-search-t">
        <h2 id="mf-watch-search-t">Find a scheme to watch</h2>
        <label htmlFor="mf-watch-q" className="visually-hidden">
          Scheme name
        </label>
        <input id="mf-watch-q" ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. Parag Parikh Flexi Cap" autoComplete="off" />
        <p className="visually-hidden" aria-live="polite">
          {search.pending ? "Searching" : search.answered ? `${search.hits.length} schemes found` : ""}
        </p>
        {search.error ? <p className="error">{search.error}</p> : null}
        {search.pending ? (
          <ul className="funds-hits mf-hits-skel" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <li key={i}>
                <span className="skel skel-line" style={{ width: `${70 - i * 12}%` }} />
              </li>
            ))}
          </ul>
        ) : search.answered && search.hits.length === 0 && !search.error ? (
          <p className="mf-nohits">No scheme names contain “{needle}”. Try the fund house plus a word from the name, like “Axis Midcap”.</p>
        ) : search.hits.length ? (
          <ul className="funds-hits mf-watch-hits">
            {search.hits.map((hit) => {
              const p = planType(hit.name);
              return (
                <li key={hit.code}>
                  <Link href={`/funds/${hit.code}`} className="mf-hit-name">
                    <strong>{hit.name}</strong>
                    <span>
                      {p.plan}
                      {p.option ? ` · ${p.option}` : ""} · scheme {hit.code}
                    </span>
                  </Link>
                  <StarButton labelled subject={{ code: hit.code, name: hit.name, house: null, category: null, nav: null, navDate: null }} />
                </li>
              );
            })}
          </ul>
        ) : null}
      </section>

      {list.length === 0 ? (
        <EmptyState
          art="watch"
          title="Nothing on your watchlist yet"
          actions={
            <button type="button" className="btn" onClick={() => searchRef.current?.focus()}>
              Search a scheme
            </button>
          }
        >
          <p className="muted">
            Star a scheme from search, from any fund page or from your portfolio cards. Each one shows its NAV, its 1-day, 1-month and 1-year change, and how far it has moved since you added it. Set a NAV alert, compare up to four, or add one to your portfolio when you are ready.
          </p>
        </EmptyState>
      ) : (
        <>
          <div className="mf-toolbar mf-watch-bar">
            <div className="mf-filters">
              <div className="seg mf-seg" role="group" aria-label="Asset class">
                {["All", ...classes].map((c) => (
                  <button key={c} type="button" aria-pressed={asset === c} onClick={() => setAsset(c)}>
                    {c}
                    <span className="mf-count">{c === "All" ? rows.length : rows.filter((r) => (r.category ? assetClass(r.category) : "Other") === c).length}</span>
                  </button>
                ))}
              </div>
            </div>
            <label className="mf-select">
              <span className="visually-hidden">Sort by</span>
              <select
                value={`${sort.key}:${sort.dir}`}
                onChange={(e) => {
                  const [key, dir] = e.target.value.split(":") as [SortKey, "asc" | "desc"];
                  setSort({ key, dir });
                }}
              >
                {SORTS.flatMap((s) => [
                  <option key={`${s.key}:desc`} value={`${s.key}:desc`}>
                    {s.label}, {s.key === "name" ? "Z to A" : "high to low"}
                  </option>,
                  <option key={`${s.key}:asc`} value={`${s.key}:asc`}>
                    {s.label}, {s.key === "name" ? "A to Z" : "low to high"}
                  </option>,
                ])}
              </select>
            </label>
          </div>
          <p className="visually-hidden" aria-live="polite">
            {visible.length} of {rows.length} schemes shown
          </p>

          {visible.length === 0 ? (
            <EmptyState art="filter" title="No watched schemes in this class" compact actions={<button type="button" className="btn secondary small" onClick={() => setAsset("All")}>Show all</button>} />
          ) : (
            <div className="mf-cards">
              {visible.map((r) => (
                <WatchCard
                  key={r.code}
                  code={r.code}
                  changes={r.changes}
                  selected={picked.includes(r.code)}
                  compareFull={picked.length >= MAX_COMPARE}
                  onCompare={toggle}
                  name={r.name}
                  house={r.house}
                  category={r.category}
                  nav={r.nav}
                  navDate={r.navDate}
                  navAtAdd={r.navAtAdd}
                  addedAt={r.addedAt}
                  loading={r.loading}
                  failed={r.failed}
                  held={r.held}
                  alerts={alertsByCode.get(r.code) ?? NO_ALERTS}
                  onAlert={openAlert}
                />
              ))}
            </div>
          )}

          {chosen.length >= 2 ? (
            <section className="card mf-panel" aria-labelledby="mf-wcmp-t">
              <div className="mf-panel-head">
                <h2 id="mf-wcmp-t">Side by side</h2>
                <button type="button" className="text-btn" onClick={() => setPicked([])}>
                  Clear
                </button>
              </div>
              <div className="mf-table-wrap">
                <table className="mf-watch-compare">
                  <thead>
                    <tr>
                      <th scope="col">Scheme</th>
                      <th scope="col" className="num">NAV</th>
                      <th scope="col" className="num">1 day</th>
                      <th scope="col" className="num">1 month</th>
                      <th scope="col" className="num">1 year</th>
                      <th scope="col">Category</th>
                      <th scope="col">Risk (estimated)</th>
                      <th scope="col">Plan</th>
                      <th scope="col" />
                    </tr>
                  </thead>
                  <tbody>
                    {chosen.map((r) => {
                      const risk = r.category ? categoryRisk(r.category, r.name) : null;
                      return (
                        <tr key={r.code}>
                          <th scope="row">
                            <Link href={`/funds/${r.code}`}>{r.name}</Link>
                          </th>
                          <td className="num">{r.nav == null ? "n/a" : rupees(r.nav, 2)}</td>
                          <td className={`num ${tone(r.changes?.d1)}`}>{r.changes?.d1 == null ? "n/a" : signedPoints(r.changes.d1, 2)}</td>
                          <td className={`num ${tone(r.changes?.m1)}`}>{r.changes?.m1 == null ? "n/a" : signedPoints(r.changes.m1, 1)}</td>
                          <td className={`num ${tone(r.changes?.y1)}`}>{r.changes?.y1 == null ? "n/a" : signedPoints(r.changes.y1, 1)}</td>
                          <td>{r.category ? categoryShort(r.category) : "n/a"}</td>
                          <td>{risk ? RISK_SHORT[risk] : "n/a"}</td>
                          <td>{planType(r.name).plan}</td>
                          <td>
                            <button type="button" className="btn ghost small" aria-label={`Remove ${r.name} from the watchlist`} onClick={() => unwatch(r.code)}>
                              Remove
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <GapNote gaps={["category-average"]}>Changes are point-to-point NAV moves, not annualized, and there is no category average to set them against.</GapNote>
            </section>
          ) : null}
        </>
      )}
      <GapNote gaps={["watchlist-sync"]}>Saved in this browser only.</GapNote>

      <AlertDialog
        subject={alertItem ? { code: alertItem.code, name: alertItem.name, nav: alertRow?.nav ?? null, navDate: alertRow?.navDate ?? null } : null}
        onClose={() => setAlertFor(null)}
      />
    </div>
  );
}
