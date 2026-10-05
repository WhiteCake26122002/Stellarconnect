"use client";

import Link from "next/link";
import { useCallback, useMemo, useRef, useState } from "react";
import type { FundHolding } from "@/lib/api";
import { planType } from "@/lib/funds/category";
import { NavAlert, useAlerts, useWatchlist } from "@/lib/funds/local";
import type { QuoteEntry } from "@/lib/funds/useQuotes";
import { useSchemeSearch } from "@/lib/funds/useSchemeSearch";
import { AlertDialog } from "./Alerts";
import { EmptyState, GapNote, StarButton } from "./FundAtoms";
import { WatchCard } from "./FundCard";

const NO_ALERTS: NavAlert[] = [];

export function WatchlistPane({ holdings, quotes }: { holdings: FundHolding[]; quotes: Map<number, QuoteEntry> }) {
  const list = useWatchlist();
  const alerts = useAlerts();
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [alertFor, setAlertFor] = useState<number | null>(null);
  const search = useSchemeSearch(query);
  const held = useMemo(() => new Map(holdings.map((h) => [h.scheme_code, h])), [holdings]);
  const alertsByCode = useMemo(() => {
    const map = new Map<number, NavAlert[]>();
    for (const a of alerts) map.set(a.code, [...(map.get(a.code) ?? []), a]);
    return map;
  }, [alerts]);

  const navOf = useCallback(
    (code: number) => {
      const h = held.get(code);
      if (h?.current_nav != null) return { nav: h.current_nav, date: h.nav_date, loading: false, failed: false };
      const q = quotes.get(code);
      return { nav: q?.quote?.nav ?? null, date: q?.quote?.nav_date ?? null, loading: !q || q.state === "loading", failed: q?.state === "failed" };
    },
    [held, quotes],
  );

  const openAlert = useCallback((code: number) => setAlertFor(code), []);
  const alertItem = list.find((w) => w.code === alertFor) ?? null;
  const alertNav = alertItem ? navOf(alertItem.code) : null;
  const needle = query.trim();

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
          <p className="mf-nohits">
            No scheme names contain “{needle}”. Try the fund house plus a word from the name, like “Axis Midcap”.
          </p>
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
                      {p.option ? ` · ${p.option}` : ""} · {hit.code}
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
          <p className="muted">Star a scheme from search, from any fund page or from your portfolio cards. You will see its NAV and how far it has moved since you starred it.</p>
        </EmptyState>
      ) : (
        <div className="mf-cards">
          {list.map((w) => {
            const n = navOf(w.code);
            return (
              <WatchCard
                key={w.code}
                code={w.code}
                name={w.name}
                house={w.house ?? held.get(w.code)?.fund_house ?? quotes.get(w.code)?.quote?.fund_house ?? null}
                category={w.category ?? held.get(w.code)?.scheme_category ?? quotes.get(w.code)?.quote?.scheme_category ?? null}
                nav={n.nav}
                navDate={n.date}
                navAtAdd={w.navAtAdd}
                addedAt={w.addedAt}
                loading={n.loading}
                failed={n.failed}
                held={held.has(w.code)}
                alerts={alertsByCode.get(w.code) ?? NO_ALERTS}
                onAlert={openAlert}
              />
            );
          })}
        </div>
      )}
      <GapNote gaps={["watchlist-sync"]}>Saved in this browser only.</GapNote>

      <AlertDialog
        subject={alertItem ? { code: alertItem.code, name: alertItem.name, nav: alertNav?.nav ?? null, navDate: alertNav?.date ?? null } : null}
        onClose={() => setAlertFor(null)}
      />
    </div>
  );
}
