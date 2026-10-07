"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { DeskHero } from "@/components/desk/DeskHero";
import { ModuleLoader, useLoaderHold } from "@/components/ModuleLoader";
import { ChartSkeleton, ValueChart } from "@/components/funds/FundCharts";
import { api, FundPortfolio } from "@/lib/api";
import { parseDay } from "@/lib/funds/analytics";
import { rupees, signedPoints, signedRupees, tone } from "@/lib/funds/format";
import { backfillWatch, useAlerts, useAnalyticsTourDone, useRecent, useWatchlist } from "@/lib/funds/local";
import { AnalysisState, useFundsBook } from "@/lib/funds/useFundsBook";
import { useQuotes } from "@/lib/funds/useQuotes";
import type { SeriesSet } from "@/lib/funds/analytics";
import { AddFund } from "./AddFund";
import { PortfolioOverview } from "./overview/PortfolioOverview";
import { NavQuote, TriggeredAlerts, useAlertCheck } from "./Alerts";
import { FUND_PALETTE } from "./chartTheme";
import { CompareTray, MAX_COMPARE } from "./CompareTray";
import { EmptyState, Sparkline } from "./FundAtoms";
import { RecentStrip } from "./FundCard";
import { FundScreener } from "./FundScreener";
import { FundsShell } from "./FundsShell";
import { TabList, TabPanel, useHashTab } from "./FundTabs";
import { useTaxProfile } from "@/components/costs/useTaxProfile";
import { useFundTax } from "@/lib/funds/useFundTax";
import type { TaxInfo } from "@/lib/funds/useFundInsights";
import type { TaxProfile } from "@/lib/costs/tax";

const pane = (title: string) => <div className="route-skeleton" aria-busy="true" aria-label={`Opening ${title}`}><span className="skel skel-line" style={{ width: "14rem", height: "1.4rem" }} /><span className="skel skel-line" style={{ width: "min(34rem, 90%)" }} /><span className="skel skel-line" style={{ width: "min(26rem, 70%)" }} /></div>;
// Each tab's code is fetched when the tab is first opened, so the Portfolio tab (the one everyone lands on) loads less.
const AnalysisPane = dynamic(() => import("./AnalysisPane").then((m) => m.AnalysisPane), { loading: () => pane("analysis") });
const PlanPane = dynamic(() => import("./AnalysisPane").then((m) => m.PlanPane), { loading: () => pane("the plan") });
const InsightsPane = dynamic(() => import("./InsightsPane").then((m) => m.InsightsPane), { loading: () => pane("insights") });
const TaxCostsPane = dynamic(() => import("./TaxCostsPane").then((m) => m.TaxCostsPane), { loading: () => pane("tax and costs") });
const WatchlistPane = dynamic(() => import("./Watchlist").then((m) => m.WatchlistPane), { loading: () => pane("the watchlist") });

type Tab = "portfolio" | "watchlist" | "analysis" | "tax" | "insights" | "plan";
const TAB_IDS: readonly Tab[] = ["portfolio", "watchlist", "analysis", "tax", "insights", "plan"];

export function FundsDesk() {
  const { name, userId, book, error, analysis, series, replaceBook } = useFundsBook();
  const [taxProfile, setTaxProfile] = useTaxProfile(userId ?? undefined);
  const [tab, setTab] = useHashTab<Tab>(TAB_IDS, "portfolio");
  const watchlist = useWatchlist();
  const alerts = useAlerts();
  const [addCode, setAddCode] = useState<number | null>(null);
  const opened = useLoaderHold(!!book || !!error);

  useEffect(() => {
    const code = Number(new URLSearchParams(window.location.search).get("add"));
    if (Number.isInteger(code) && code > 0) setAddCode(code);
  }, []);

  const heldCodes = useMemo(() => new Set(book?.holdings.map((h) => h.scheme_code) ?? []), [book]);
  const quoteCodes = useMemo(() => {
    if (!book) return [];
    return [...watchlist.map((w) => w.code), ...alerts.map((a) => a.code)].filter((c) => !heldCodes.has(c) || watchlist.some((w) => w.code === c));
  }, [book, watchlist, alerts, heldCodes]);
  const quotes = useQuotes(quoteCodes);

  const navs = useMemo(() => {
    const map = new Map<number, NavQuote>();
    for (const h of book?.holdings ?? []) if (h.current_nav != null) map.set(h.scheme_code, { nav: h.current_nav, date: h.nav_date });
    quotes.forEach((q, code) => {
      if (q.quote) map.set(code, { nav: q.quote.nav, date: q.quote.nav_date });
    });
    return map;
  }, [book, quotes]);
  useAlertCheck(navs);

  useEffect(() => {
    for (const w of watchlist) {
      if (w.navAtAdd != null && w.house && w.category) continue;
      const h = book?.holdings.find((x) => x.scheme_code === w.code);
      const q = quotes.get(w.code)?.quote;
      if (h?.current_nav != null) backfillWatch(w.code, { nav: h.current_nav, navDate: h.nav_date ?? "", house: h.fund_house, category: h.scheme_category });
      else if (q) backfillWatch(w.code, { nav: q.nav, navDate: q.nav_date, house: q.fund_house, category: q.scheme_category });
    }
  }, [watchlist, quotes, book]);

  const tabs = [
    { id: "portfolio" as const, label: "Portfolio" },
    { id: "watchlist" as const, label: "Watchlist", badge: watchlist.length || undefined },
    { id: "analysis" as const, label: "Analysis" },
    { id: "tax" as const, label: "Tax & costs" },
    { id: "insights" as const, label: "Insights" },
    { id: "plan" as const, label: "Plan" },
  ];

  return (
    <FundsShell name={name}>
      {opened ? <TabList tabs={tabs} current={tab} onChange={setTab} label="Mutual funds" idPrefix="mf" /> : null}
      {error ? <div className="banner bad">{error}</div> : null}
      {opened ? <TriggeredAlerts /> : null}
      {!opened && !error ? <ModuleLoader kind="funds" /> : null}
      {book && opened ? (
        <TabPanel idPrefix="mf" current={tab}>
          {tab === "portfolio" ? <PortfolioPane book={book} analysis={analysis} series={series} taxProfile={taxProfile} onBook={replaceBook} addCode={addCode} onWatchlist={() => setTab("watchlist")} /> : null}
          {tab === "watchlist" ? <WatchlistPane holdings={book.holdings} quotes={quotes} /> : null}
          {tab === "analysis" ? <AnalysisPane book={book} state={analysis} series={series} profile={taxProfile} /> : null}
          {tab === "tax" ? <TaxCostsPane book={book} profile={taxProfile} onProfile={setTaxProfile} onBook={replaceBook} /> : null}
          {tab === "insights" ? <InsightsPane book={book} taxProfile={taxProfile} /> : null}
          {tab === "plan" ? <PlanPane book={book} /> : null}
        </TabPanel>
      ) : null}
    </FundsShell>
  );
}

function PortfolioPane({
  book,
  analysis,
  series,
  taxProfile,
  onBook,
  addCode,
  onWatchlist,
}: {
  book: FundPortfolio;
  analysis: AnalysisState;
  series: SeriesSet | null;
  taxProfile: TaxInfo;
  onBook: (book: FundPortfolio) => void;
  addCode: number | null;
  onWatchlist: () => void;
}) {
  const [busyCode, setBusyCode] = useState<number | null>(null);
  const [formError, setFormError] = useState("");
  const [selected, setSelected] = useState<number[]>([]);
  const recent = useRecent();
  const searchRef = useRef<HTMLInputElement>(null);

  const colorOf = useCallback(
    (code: number) => {
      const index = book.holdings.findIndex((row) => row.scheme_code === code);
      return FUND_PALETTE[Math.max(0, index) % FUND_PALETTE.length];
    },
    [book.holdings],
  );

  useEffect(() => {
    setSelected((cur) => cur.filter((code) => book.holdings.some((h) => h.scheme_code === code)));
  }, [book.holdings]);

  useEffect(() => {
    if (!addCode) return;
    document.getElementById("add-fund")?.scrollIntoView({ block: "start" });
  }, [addCode]);

  const remove = useCallback(
    async (code: number) => {
      setBusyCode(code);
      setFormError("");
      try {
        onBook(await api.removeFund(code));
      } catch (err) {
        setFormError(err instanceof Error ? err.message : "Could not remove that fund.");
      } finally {
        setBusyCode(null);
      }
    },
    [onBook],
  );

  const toggle = useCallback((code: number) => {
    setSelected((cur) => (cur.includes(code) ? cur.filter((c) => c !== code) : cur.length >= MAX_COMPARE ? cur : [...cur, code]));
  }, []);

  const focusAdd = useCallback(() => {
    const input = searchRef.current;
    if (!input) return;
    input.scrollIntoView({ block: "center" });
    input.focus({ preventScroll: true });
  }, []);

  const { totals } = book;
  const empty = book.holdings.length === 0;
  const path = (analysis.report?.growth ?? []).filter((p) => p.portfolio != null).map((p) => ({ t: parseDay(p.date), v: p.portfolio as number }));

  return (
    <div className={selected.length ? "mf-has-tray" : ""}>
      <RecentStrip items={recent} />
      <DeskHero
        n="03"
        kicker="Holdings"
        echo="Your"
        title="Mutual funds"
        lead={empty ? "Your schemes, marked to the latest AMFI NAV." : `Your portfolio at a glance · ${book.holdings.length} scheme${book.holdings.length === 1 ? "" : "s"}`}
        stats={
          empty
            ? undefined
            : [
                { k: "Value", v: rupees(totals.value, 0) },
                { k: "Gain", v: totals.gain_pct == null ? "—" : `${totals.gain_pct >= 0 ? "+" : "−"}${Math.abs(totals.gain_pct).toFixed(1)}%` },
                { k: "Schemes", v: String(book.holdings.length) },
              ]
        }
        scene="funds"
        sceneLabel="An allocation donut and its legend"
        actions={
          !empty ? (
            <button type="button" className="dk-pill ghost" onClick={focusAdd}>
              + Add a fund
            </button>
          ) : undefined
        }
      />
      {empty ? (
        <EmptyState
          art="portfolio"
          title="Start your fund desk"
          actions={
            <>
              <button type="button" className="btn" onClick={focusAdd}>
                Add your first fund
              </button>
              <button type="button" className="btn secondary" onClick={onWatchlist}>
                Just watch a few
              </button>
            </>
          }
        >
          <p className="muted">
            Record the units you hold and every scheme is marked to AMFI&apos;s daily NAV, then compared with the Nifty on the same dates. Not ready to add money? Star funds on your watchlist first.
          </p>
        </EmptyState>
      ) : (
        <PortfolioOverview book={book} analysis={analysis} series={series} taxProfile={taxProfile} />
      )}
      {formError ? <div className="banner bad">{formError}</div> : null}
      {!empty ? (
        <FundScreener book={book} analysis={analysis.report} blocked={analysis.report?.blocked ?? []} colorOf={colorOf} selected={selected} onToggle={toggle} busyCode={busyCode} onRemove={remove} />
      ) : null}
      <AddFund ref={searchRef} onAdded={onBook} initialCode={addCode} />
      <CompareTray
        holdings={book.holdings}
        selected={selected}
        analysis={analysis.report}
        total={totals.value}
        colorOf={colorOf}
        onToggle={toggle}
        onClear={() => setSelected([])}
      />
    </div>
  );
}

