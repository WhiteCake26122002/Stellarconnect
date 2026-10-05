"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { ChartSkeleton, ValueChart } from "@/components/funds/FundCharts";
import { api, FundPortfolio } from "@/lib/api";
import { parseDay } from "@/lib/funds/analytics";
import { rupees, signedPoints, signedRupees, tone } from "@/lib/funds/format";
import { backfillWatch, useAlerts, useAnalyticsTourDone, useRecent, useWatchlist } from "@/lib/funds/local";
import { AnalysisState, useFundsBook } from "@/lib/funds/useFundsBook";
import { useQuotes } from "@/lib/funds/useQuotes";
import type { SeriesSet } from "@/lib/funds/analytics";
import { AddFund } from "./AddFund";
import { NavQuote, TriggeredAlerts, useAlertCheck } from "./Alerts";
import { FUND_PALETTE } from "./chartTheme";
import { CompareTray, MAX_COMPARE } from "./CompareTray";
import { DownMarketsPanel, GrowthOverlayPanel, portfolioSource, RiskReturnPanel, RollingReturnsPanel } from "./FundAnalytics";
import { CardSkeletons, EmptyState, KpiSkeletons, Sparkline } from "./FundAtoms";
import { RecentStrip } from "./FundCard";
import { FundScreener } from "./FundScreener";
import { FundsShell } from "./FundsShell";
import { TabList, TabPanel, useHashTab } from "./FundTabs";
import { ExposureXRay, OverlapDetector, SipPlanner } from "./PortfolioTools";
import { WatchlistPane } from "./Watchlist";

const AnalyticsTour = dynamic(() => import("./AnalyticsTour").then((m) => m.AnalyticsTour), { ssr: false });

type Tab = "portfolio" | "watchlist" | "analysis" | "insights" | "plan";
const TAB_IDS: readonly Tab[] = ["portfolio", "watchlist", "analysis", "insights", "plan"];

export function FundsDesk() {
  const { name, book, error, analysis, series, replaceBook } = useFundsBook();
  const [tab, setTab] = useHashTab<Tab>(TAB_IDS, "portfolio");
  const watchlist = useWatchlist();
  const alerts = useAlerts();
  const [addCode, setAddCode] = useState<number | null>(null);

  useEffect(() => {
    const code = Number(new URLSearchParams(window.location.search).get("add"));
    if (Number.isInteger(code) && code > 0) setAddCode(code);
  }, []);

  const heldCodes = useMemo(() => new Set(book?.holdings.map((h) => h.scheme_code) ?? []), [book]);
  const quoteCodes = useMemo(() => {
    if (!book) return [];
    return [...watchlist.map((w) => w.code), ...alerts.map((a) => a.code)].filter((c) => !heldCodes.has(c));
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
    { id: "insights" as const, label: "Insights" },
    { id: "plan" as const, label: "Plan" },
  ];

  return (
    <FundsShell name={name}>
      <TabList tabs={tabs} current={tab} onChange={setTab} label="Mutual funds" idPrefix="mf" />
      {error ? <div className="banner bad">{error}</div> : null}
      <TriggeredAlerts />
      {!book && !error ? (
        <div aria-busy="true" aria-label="Opening your funds">
          <div className="page-head">
            <div style={{ width: "100%" }}>
              <span className="skel skel-line" style={{ display: "block", width: "12rem", height: "1.6rem" }} />
              <span className="skel skel-line" style={{ display: "block", width: "min(28rem, 80%)" }} />
            </div>
          </div>
          <KpiSkeletons />
          <CardSkeletons />
        </div>
      ) : null}
      {book ? (
        <TabPanel idPrefix="mf" current={tab}>
          {tab === "portfolio" ? <PortfolioPane book={book} analysis={analysis} onBook={replaceBook} addCode={addCode} onWatchlist={() => setTab("watchlist")} /> : null}
          {tab === "watchlist" ? <WatchlistPane holdings={book.holdings} quotes={quotes} /> : null}
          {tab === "analysis" ? <AnalysisPane book={book} state={analysis} series={series} /> : null}
          {tab === "insights" ? <InsightsPane book={book} /> : null}
          {tab === "plan" ? <PlanPane book={book} analysis={analysis} series={series} /> : null}
        </TabPanel>
      ) : null}
    </FundsShell>
  );
}

function PortfolioPane({
  book,
  analysis,
  onBook,
  addCode,
  onWatchlist,
}: {
  book: FundPortfolio;
  analysis: AnalysisState;
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
      <div className="page-head">
        <div>
          <h1>Mutual funds</h1>
          <p className="muted">Your schemes, marked to the latest AMFI NAV. {book.disclaimer}</p>
        </div>
        {!empty ? (
          <button type="button" className="btn secondary small" onClick={focusAdd}>
            + Add a fund
          </button>
        ) : null}
      </div>
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
        <div className="funds-kpis">
          <article className="kpi">
            <div className="kpi-top">Invested</div>
            <div className="v">
              <AnimatedNumber value={totals.invested} format={(v) => rupees(v)} />
            </div>
            <div className="kpi-foot">
              <span className="muted">
                {book.holdings.length} scheme{book.holdings.length === 1 ? "" : "s"}
              </span>
            </div>
          </article>
          <article className="kpi">
            <div className="kpi-top">Current value</div>
            <div className="v">
              <AnimatedNumber value={totals.value} format={(v) => rupees(v)} />
            </div>
            <div className="kpi-foot mf-kpi-spark">
              {path.length >= 2 ? (
                <Sparkline points={path} width={120} height={26} label="Portfolio value since your first purchase" />
              ) : analysis.busy ? (
                <span className="skel mf-skel-spark" aria-label="Loading value path" />
              ) : (
                <span className="muted">Units × latest NAV</span>
              )}
            </div>
          </article>
          <article className="kpi">
            <div className="kpi-top">Gain / loss</div>
            <div className={`v ${tone(totals.gain)}`}>
              <AnimatedNumber value={totals.gain} format={(v) => signedRupees(v)} />
            </div>
            <div className="kpi-foot">
              <span className={`delta ${tone(totals.gain_pct)}`}>{signedPoints(totals.gain_pct)}</span>
            </div>
          </article>
        </div>
      )}
      {formError ? <div className="banner bad">{formError}</div> : null}
      {!empty ? (
        analysis.report ? (
          analysis.report.ready ? (
            <ValueChart growth={analysis.report.growth} />
          ) : (
            <section className="card fund-chart-card">
              <h2>Value over time</h2>
              <p className="muted">None of these schemes has a live NAV right now, so there is no value history to draw.</p>
            </section>
          )
        ) : analysis.error ? (
          <section className="card fund-chart-card">
            <h2>Value over time</h2>
            <p className="muted">The value history could not load: {analysis.error}</p>
          </section>
        ) : (
          <ChartSkeleton title="Value over time" />
        )
      ) : null}
      {!empty ? (
        <FundScreener book={book} analysis={analysis.report} colorOf={colorOf} selected={selected} onToggle={toggle} busyCode={busyCode} onRemove={remove} />
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

function InsightsPane({ book }: { book: FundPortfolio }) {
  return (
    <div className="funds-analysis">
      <div className="page-head">
        <div>
          <h1>Insights</h1>
          <p className="muted">{book.disclaimer}</p>
        </div>
      </div>
      {book.holdings.length === 0 ? (
        <EmptyState art="portfolio" title="Nothing to check yet">
          <p className="muted">Add a fund on the Portfolio tab to see concentration, overlap and trailing-return notes here.</p>
        </EmptyState>
      ) : (
        <>
          {book.flags.length === 0 ? (
            <div className="banner ok">No concerns from these checks right now.</div>
          ) : (
            <ul className="funds-flags">
              {book.flags.map((flag) => (
                <li key={flag.title} className={flag.severity === "warning" ? "banner warn" : "banner"}>
                  <strong>{flag.title}</strong>
                  <p>{flag.detail}</p>
                </li>
              ))}
            </ul>
          )}
          <OverlapDetector holdings={book.holdings} />
        </>
      )}
    </div>
  );
}

function AnalysisPane({ book, state, series }: { book: FundPortfolio; state: AnalysisState; series: SeriesSet | null }) {
  const tourDone = useAnalyticsTourDone();
  const [touring, setTouring] = useState(false);
  const endTour = useCallback(() => setTouring(false), []);
  const { report, error } = state;
  const canTour = !!series && !!report?.ready;

  useEffect(() => {
    if (canTour && tourDone === false) setTouring(true);
  }, [canTour, tourDone]);

  if (error) return <div className="banner bad">{error}</div>;
  if (!report) {
    return (
      <div className="funds-analysis" aria-busy="true" aria-label="Comparing your holdings with Nifty">
        <KpiSkeletons />
        <ChartSkeleton title="Risk and return" height={200} />
      </div>
    );
  }
  if (!report.ready) {
    return (
      <EmptyState art="portfolio" title="Add a fund to see analysis">
        <p className="muted">{report.lookthrough}</p>
      </EmptyState>
    );
  }

  const source = portfolioSource(book.holdings.length, state, series);
  const compared = report.funds.filter((row) => row.xirr != null && row.benchmark_xirr != null);
  const ahead = compared.filter((row) => (row.xirr as number) > (row.benchmark_xirr as number));

  return (
    <div className="funds-analysis">
      <div className="page-head">
        <div>
          <h1>Analysis</h1>
          <p className="muted">Money-weighted return against Nifty, then risk measured on a time-weighted basis. {report.disclaimer}</p>
        </div>
        {canTour ? (
          <button type="button" className="btn secondary small" onClick={() => setTouring(true)}>
            Explain these metrics
          </button>
        ) : null}
      </div>
      <div className="funds-kpis">
        <article className="kpi">
          <div className="kpi-top">Your XIRR</div>
          <div className={`v ${tone(report.xirr)}`}>{signedPoints(report.xirr)}</div>
          <div className="kpi-foot">
            <span className="muted">
              {report.xirr == null
                ? "Not enough history yet"
                : report.benchmarks_compared
                  ? `Ahead of ${report.benchmarks_beaten}/${report.benchmarks_compared} benchmarks`
                  : "Annualized from your purchase dates"}
            </span>
          </div>
        </article>
        {report.benchmarks.map((bench) => (
          <article className="kpi" key={bench.label}>
            <div className="kpi-top">{bench.label}</div>
            <div className={`v ${tone(bench.xirr)}`}>{signedPoints(bench.xirr)}</div>
            <div className="kpi-foot">
              <span className="muted">Same rupees, same dates</span>
            </div>
          </article>
        ))}
      </div>
      {report.notes.map((note) => (
        <div className="banner warn" key={note}>
          {note}
        </div>
      ))}
      <div className="mf-grid-2">
        <div data-tour="mf-risk">
          <RiskReturnPanel source={source} />
        </div>
        <div data-tour="mf-down">
          <DownMarketsPanel source={source} />
        </div>
      </div>
      <GrowthOverlayPanel source={source} />
      <div data-tour="mf-rolling">
        <RollingReturnsPanel source={source} />
      </div>
      <ExposureXRay holdings={book.holdings} />
      <section className="card">
        <h2>Each fund vs Nifty 500</h2>
        {compared.length === 0 ? (
          <p className="muted">Not enough purchase history yet to compare individual funds.</p>
        ) : (
          <>
            <p className="muted">
              {ahead.length}/{compared.length} funds ahead of the Nifty 500 equivalent over the same dates.
            </p>
            <ul className="funds-vs">
              {compared.map((row) => {
                const beat = (row.xirr as number) > (row.benchmark_xirr as number);
                return (
                  <li key={row.scheme_name}>
                    <strong>{row.scheme_name}</strong>
                    <span className={beat ? "bull" : "bear"}>{beat ? "Ahead of benchmark" : "Trailing benchmark"}</span>
                    <span>You {signedPoints(row.xirr)}</span>
                    <span>Nifty 500 {signedPoints(row.benchmark_xirr)}</span>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>
      <p className="muted">{report.lookthrough}</p>
      {touring ? <AnalyticsTour run={touring} onEnd={endTour} /> : null}
    </div>
  );
}

function PlanPane({ book, analysis, series }: { book: FundPortfolio; analysis: AnalysisState; series: SeriesSet | null }) {
  return (
    <div className="funds-analysis">
      <div className="page-head">
        <div>
          <h1>Plan</h1>
          <p className="muted">What-if projections from returns this desk has actually measured. {book.disclaimer}</p>
        </div>
      </div>
      <SipPlanner holdings={book.holdings.filter((h) => h.data_available)} series={series} loading={!analysis.report && !analysis.error} />
    </div>
  );
}
