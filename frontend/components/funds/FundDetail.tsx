"use client";

import Link from "next/link";
import { CSSProperties, useEffect, useMemo, useState } from "react";
import { CompanyLogo } from "@/components/CompanyLogo";
import { ApiError, api, FundHistory, FundHolding, FundPortfolio, FundQuote, FundSchemeTax } from "@/lib/api";
import type { TaxProfile } from "@/lib/costs/tax";
import { parseDay, type SeriesSet } from "@/lib/funds/analytics";
import { assetClass, assetKind, categoryRisk, categoryShort, marketCapBucket, planType, RISK_LABELS, RiskLevel } from "@/lib/funds/category";
import { longDate, rupees, signedPoints, signedRupees, tone } from "@/lib/funds/format";
import { pushRecent } from "@/lib/funds/local";
import { benchView, BenchView, FundRow, pts, returnView, ReturnView, VERDICT_LABEL, verdictTone } from "@/lib/funds/returns";
import { useFundsBook } from "@/lib/funds/useFundsBook";
import { useFundHistory } from "@/lib/funds/useFundHistory";
import { weeklySet } from "@/lib/funds/viz";
import { FundDrawdown } from "./detail/FundDrawdown";
import { FundHero } from "./detail/FundHero";
import { FundTrailing } from "./detail/FundTrailing";
import { useTaxProfile } from "@/components/costs/useTaxProfile";
import { AlertEditor, NavQuote, useAlertCheck } from "./Alerts";
import { DirectVsRegular } from "./DirectRegular";
import { FactSheet, FactSheetActions } from "./FactSheet";
import { AnalyticsSource, DownMarketsPanel, GrowthOverlayPanel, RiskReturnPanel, RollingReturnsPanel } from "./FundAnalytics";
import { CategoryChip, DataGap, GapNote, KpiSkeletons, PanelSkeleton, RiskMeter, StarButton } from "./FundAtoms";
import { CategoryIcon } from "./FundIcons";
import { FundsShell } from "./FundsShell";
import { TabList, TabPanel, useHashTab } from "./FundTabs";
import { SimilarFunds } from "./SimilarFunds";
import { TaxPanel } from "./TaxPanel";

type QuoteState = { quote: FundQuote | null; error: string; loading: boolean };
type DetailTab = "overview" | "performance" | "holdings" | "risk" | "documents";
const DETAIL_TABS: readonly DetailTab[] = ["overview", "performance", "holdings", "risk", "documents"];
const TAB_DEFS: { id: DetailTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "performance", label: "Performance" },
  { id: "holdings", label: "Holdings" },
  { id: "risk", label: "Risk" },
  { id: "documents", label: "Documents" },
];
const RISK_STEPS: RiskLevel[] = [1, 2, 3, 4, 5, 6];

type Meta = { name: string; house: string; category: string; nav: number | null; navDate: string | null };

export function FundDetail({ code }: { code: number }) {
  const { name, userId, book, error, analysis, series, replaceBook } = useFundsBook();
  const [taxProfile] = useTaxProfile(userId ?? undefined);
  const valid = Number.isInteger(code) && code > 0;
  const holding = book?.holdings.find((h) => h.scheme_code === code) ?? null;
  const [q, setQ] = useState<QuoteState>({ quote: null, error: "", loading: false });
  const [tab, setTab] = useHashTab<DetailTab>(DETAIL_TABS, "overview");
  const [schemeTax, setSchemeTax] = useState<FundSchemeTax | null>(null);
  const hist = useFundHistory(valid ? code : null);
  const fundSet = useMemo(() => weeklySet(hist.data), [hist.data]);

  // How the fund is taxed, for the printable fact sheet. The Overview tab loads the same rules for its own panel.
  useEffect(() => {
    if (!valid || !book) return;
    const controller = new AbortController();
    api
      .fundSchemeTax(code, controller.signal)
      .then(setSchemeTax)
      .catch(() => setSchemeTax(null));
    return () => controller.abort();
  }, [code, valid, book]);

  useEffect(() => {
    if (!valid || !book || holding) return;
    const controller = new AbortController();
    setQ({ quote: null, error: "", loading: true });
    api
      .fundQuote(code, controller.signal)
      .then((quote) => setQ({ quote, error: "", loading: false }))
      .catch((err) => {
        if (controller.signal.aborted) return;
        const msg = err instanceof ApiError && err.status === 404 ? `No live NAV for scheme ${code}.` : err instanceof Error ? err.message : "Could not load this scheme.";
        setQ({ quote: null, error: msg, loading: false });
      });
    return () => controller.abort();
  }, [code, valid, book, holding]);

  const meta: Meta | null = holding
    ? { name: holding.scheme_name, house: holding.fund_house, category: holding.scheme_category, nav: holding.current_nav, navDate: holding.nav_date }
    : q.quote
      ? { name: q.quote.scheme_name, house: q.quote.fund_house, category: q.quote.scheme_category, nav: q.quote.nav, navDate: q.quote.nav_date }
      : null;

  useEffect(() => {
    if (!meta) return;
    pushRecent({ code, name: meta.name, house: meta.house, category: meta.category, nav: meta.nav, navDate: meta.navDate });
    // Keyed on scheme and NAV so it records once per visit, not on every render.
  }, [code, meta?.name, meta?.nav]);

  const back = (
    <Link className="mf-back" href="/funds">
      <span aria-hidden>←</span> Mutual funds
    </Link>
  );

  if (!valid) {
    return (
      <FundsShell name={name}>
        {back}
        <div className="empty card">
          <h1>Not a scheme code</h1>
          <p className="muted">AMFI scheme codes are whole numbers, like 119598.</p>
        </div>
      </FundsShell>
    );
  }

  if (error || q.error) {
    return (
      <FundsShell name={name}>
        {back}
        <div className="banner bad">{error || q.error}</div>
      </FundsShell>
    );
  }

  if (!book || !meta) {
    return (
      <FundsShell name={name}>
        {back}
        <div aria-busy="true" aria-label="Loading fund" className="funds-analysis">
          <section className="card mf-hero">
            <div className="mf-hero-id">
              <span className="skel" style={{ width: 40, height: 40, borderRadius: 10 }} />
              <div style={{ flex: 1 }}>
                <span className="skel skel-line" style={{ display: "block", width: "60%", height: "1.4rem" }} />
                <span className="skel skel-line" style={{ display: "block", width: "35%" }} />
              </div>
            </div>
          </section>
          <div className="funds-tabs" aria-hidden="true">
            {TAB_DEFS.map((t) => (
              <span key={t.id} className="skel skel-line" style={{ width: "5rem" }} />
            ))}
          </div>
          <KpiSkeletons count={4} />
          <PanelSkeleton title="Key facts" />
        </div>
      </FundsShell>
    );
  }

  const live = book.holdings.filter((h) => h.data_available);
  const sole = holding && live.length === 1 && live[0].scheme_code === code;
  const risk = categoryRisk(meta.category, meta.name);
  const plan = planType(meta.name);
  const fund = analysis.report?.funds.find((f) => f.scheme_code === code) ?? null;
  const blocked = analysis.report?.blocked ?? [];
  const ret = returnView(fund, blocked);
  const bench = benchView(fund);

  let source: AnalyticsSource;
  if (fundSet) {
    source = { state: "ready", set: fundSet, basis: `This fund's published NAV, weekly, since ${longDate(fundSet.subject[0].t)}, from` };
  } else if (hist.loading) {
    source = { state: "loading" };
  } else {
    source = { state: "empty", message: hist.error ? `The NAV history could not load: ${hist.error}` : "Insufficient history: this appears once the fund has a few weeks of published NAV." };
  }
  void sole;

  return (
    <FundsShell name={name}>
      {back}
      <div className="funds-analysis">
        <section className="card mf-hero" aria-labelledby="mf-fund-title">
          <div className="mf-hero-id">
            {meta.house && meta.house !== "Unknown" ? <CompanyLogo name={meta.house} size={40} className="mf-hero-logo" /> : null}
            <div>
              <h1 id="mf-fund-title">{meta.name}</h1>
              <p className="mf-chips">
                <CategoryChip category={meta.category} />
                <span className={`chip mf-plan-chip${plan.plan === "Direct" ? " direct" : ""}`}>{[plan.plan, plan.option].filter(Boolean).join(" · ")}</span>
                {meta.house !== "Unknown" ? <span className="chip exch">{meta.house}</span> : null}
                <span className="chip exch">Scheme {code}</span>
              </p>
            </div>
          </div>
          <div className="mf-hero-side">
            <RiskMeter level={risk} size="lg" />
            <div className="mf-hero-nav">
              <small>Latest NAV</small>
              <strong>{meta.nav == null ? "n/a" : rupees(meta.nav, 4)}</strong>
              {meta.navDate ? <span className="muted">{meta.navDate}</span> : null}
            </div>
          </div>
          <div className="mf-hero-actions">
            <StarButton labelled subject={{ code, name: meta.name, house: meta.house, category: meta.category, nav: meta.nav, navDate: meta.navDate }} />
            {!holding ? (
              <Link className="btn secondary small" href={`/funds?add=${code}`}>
                + Add to portfolio
              </Link>
            ) : null}
            <FactSheetActions name={meta.name} compact />
          </div>
        </section>

        <TabList tabs={TAB_DEFS} current={tab} onChange={setTab} label="Fund sections" idPrefix="mf-fund" />
        <TabPanel idPrefix="mf-fund" current={tab}>
          <div className="funds-analysis">
            {tab === "overview" ? <Overview code={code} meta={meta} holding={holding} total={book.totals.value} ret={ret} bench={bench} perf={fund} analysisLoaded={!!analysis.report} holdings={book.holdings} risk={risk} taxProfile={taxProfile} onBook={replaceBook} history={hist.data} historyLoading={hist.loading} set={fundSet} /> : null}
            {tab === "performance" ? <Performance source={source} /> : null}
            {tab === "holdings" ? <Holdings meta={meta} holding={holding} /> : null}
            {tab === "risk" ? <RiskTab meta={meta} risk={risk} source={source} /> : null}
            {tab === "documents" ? <Documents code={code} meta={meta} /> : null}
          </div>
        </TabPanel>
      </div>
      <FactSheet data={{ code, name: meta.name, house: meta.house, category: meta.category, nav: meta.nav, navDate: meta.navDate, holding, ret, bench, verdict: fund ? VERDICT_LABEL[fund.verdict] : "", tax: schemeTax ? { label: schemeTax.classification.label, shortTerm: schemeTax.rules.short_term, longTerm: schemeTax.rules.long_term } : null }} />
    </FundsShell>
  );
}

function NoData() {
  return <span className="mf-nodata">Not in the API</span>;
}

function Overview({
  code,
  meta,
  holding,
  total,
  ret,
  bench,
  perf,
  analysisLoaded,
  holdings,
  risk,
  taxProfile,
  onBook,
  history,
  historyLoading,
  set,
}: {
  taxProfile: TaxProfile;
  onBook: (b: FundPortfolio) => void;
  history: FundHistory | null;
  historyLoading: boolean;
  set: SeriesSet | null;
  code: number;
  meta: Meta;
  holding: FundHolding | null;
  total: number;
  ret: ReturnView;
  bench: BenchView;
  perf: FundRow | null;
  analysisLoaded: boolean;
  holdings: FundHolding[];
  risk: RiskLevel | null;
}) {
  const plan = planType(meta.name);
  const navs = useNavMap(code, meta.nav, meta.navDate);
  useAlertCheck(navs);

  return (
    <>
      <FundHero holding={holding} nav={meta.nav} navDate={meta.navDate} total={total} ret={ret} bench={bench} history={history} loading={historyLoading} set={set} />
      {!holding ? (
        <div className="banner mf-notheld">
          <span>Not in your portfolio. Watch it, or add the units you hold to track value, gain and XIRR here.</span>
          <Link className="btn small" href={`/funds?add=${code}`}>
            Add to portfolio
          </Link>
        </div>
      ) : null}

      <div className="mf-grid-2">
        <section className="card mf-panel" aria-labelledby="mf-facts-t">
          <h2 id="mf-facts-t">Key facts</h2>
          <dl className="mf-facts">
            <div>
              <dt>Category</dt>
              <dd>
                <CategoryChip category={meta.category} />
              </dd>
            </div>
            <div>
              <dt>Asset class</dt>
              <dd>{assetClass(meta.category)}</dd>
            </div>
            <div>
              <dt>Plan</dt>
              <dd>{[plan.plan, plan.option].filter(Boolean).join(" · ")}</dd>
            </div>
            <div>
              <dt>Fund house</dt>
              <dd>{meta.house}</dd>
            </div>
            <div>
              <dt>Risk (estimated)</dt>
              <dd>{risk ? RISK_LABELS[risk] : "Not estimated"}</dd>
            </div>
            <div>
              <dt>Latest NAV</dt>
              <dd>
                {meta.nav == null ? "n/a" : rupees(meta.nav, 4)}
                {meta.navDate ? <small className="muted"> · {meta.navDate}</small> : null}
              </dd>
            </div>
            <div>
              <dt>Expense ratio</dt>
              <dd>
                <NoData />
              </dd>
            </div>
            <div>
              <dt>AUM</dt>
              <dd>
                <NoData />
              </dd>
            </div>
            <div>
              <dt>Fund age</dt>
              <dd>
                <NoData />
              </dd>
            </div>
            <div>
              <dt>AMFI scheme code</dt>
              <dd>{code}</dd>
            </div>
          </dl>
          <GapNote gaps={["expense-ratio", "aum", "inception", "riskometer"]}>Cost, size and age are not published to this desk yet.</GapNote>
        </section>
        <TaxPanel code={code} name={meta.name} holding={holding} profile={taxProfile} onBook={onBook} />
      </div>

      <DirectVsRegular code={code} name={meta.name} nav={meta.nav} />

      <div className="mf-grid-2">
        <section className="card mf-panel">
          <AlertEditor code={code} name={meta.name} nav={meta.nav} navDate={meta.navDate} />
        </section>
        <DataGap title="Fund manager" gaps={["fund-manager"]}>
          <p className="muted">Who runs the fund, since when, and what else they manage, with each of those funds&apos; record. A long-tenured manager behind a long record is worth more than the record alone.</p>
        </DataGap>
      </div>

      <section className="card mf-panel">
        <SimilarFunds subject={{ code, name: meta.name, category: meta.category, return1y: holding?.return_1y ?? null }} holdings={holdings} />
      </section>
    </>
  );
}

function useNavMap(code: number, nav: number | null, date: string | null) {
  return useMemo(() => new Map<number, NavQuote>(nav == null ? [] : [[code, { nav, date }]]), [code, nav, date]);
}

function Performance({ source }: { source: AnalyticsSource }) {
  if (source.state !== "ready") {
    return (
      <section className="vz-section" aria-label="Performance">
        <h2 className="vz-h">Performance</h2>
        {source.state === "loading" ? <div className="skel vz-plot-skel" aria-label="Loading performance" /> : <p className="vz-unavailable">{source.state === "error" || source.state === "empty" ? source.message : "Unavailable."}</p>}
      </section>
    );
  }
  return (
    <>
      <FundTrailing set={source.set} />
      <RollingReturnsPanel source={source} />
    </>
  );
}

function Holdings({ meta, holding }: { meta: Meta; holding: FundHolding | null }) {
  const cls = assetClass(meta.category);
  const kind = assetKind(meta.category);
  return (
    <>
      <DataGap title="What the fund owns" gaps={["holdings"]}>
        <p className="muted">A sector treemap and the top ten holdings with weights and one-month change. It needs the AMC&apos;s monthly portfolio disclosure, which is not ingested.</p>
      </DataGap>
      <div className="mf-grid-2">
        <section className="card mf-panel" aria-labelledby="mf-bucket-t">
          <h2 id="mf-bucket-t">How it counts in your X-ray</h2>
          <p className="mf-basis">The portfolio X-ray buckets each fund whole by its AMFI category, since holdings are not available.</p>
          <ul className="mf-bucket">
            <li>
              <span className={`mf-recent-ico mf-cls-${kind}`} aria-hidden>
                <CategoryIcon kind={kind} size={16} />
              </span>
              <span>
                <small>Asset class</small>
                <strong>{cls}</strong>
              </span>
            </li>
            {cls === "Equity" ? (
              <li>
                <span className={`mf-recent-ico mf-cls-${kind}`} aria-hidden>
                  <CategoryIcon kind="equity" size={16} />
                </span>
                <span>
                  <small>Equity style</small>
                  <strong>{marketCapBucket(meta.category)}</strong>
                </span>
              </li>
            ) : null}
            <li>
              <span className="mf-recent-ico mf-cls-other" aria-hidden>
                <CategoryIcon kind="other" size={16} />
              </span>
              <span>
                <small>Category</small>
                <strong>{categoryShort(meta.category)}</strong>
              </span>
            </li>
          </ul>
        </section>
        <section className="card mf-panel" aria-labelledby="mf-units-t">
          <h2 id="mf-units-t">Your units</h2>
          {holding ? (
            <dl className="mf-facts">
              <div>
                <dt>Units</dt>
                <dd>{holding.units.toLocaleString("en-IN", { maximumFractionDigits: 3 })}</dd>
              </div>
              <div>
                <dt>Average NAV paid</dt>
                <dd>{rupees(holding.avg_nav, 4)}</dd>
              </div>
              <div>
                <dt>Invested</dt>
                <dd>{rupees(holding.invested)}</dd>
              </div>
              <div>
                <dt>Value</dt>
                <dd>{rupees(holding.value)}</dd>
              </div>
              <div>
                <dt>First bought</dt>
                <dd>{longDate(parseDay(holding.purchase_date))}</dd>
              </div>
            </dl>
          ) : (
            <p className="muted mf-empty-line">You do not hold this fund.</p>
          )}
          {holding ? <p className="cx-quiet-text">Every purchase and SIP instalment is kept as its own lot: see Tax and exit load on the Overview tab.</p> : null}
        </section>
      </div>
    </>
  );
}

const RISK_MEANING: Record<RiskLevel, string> = {
  1: "Capital is rarely at risk; returns track short-term rates.",
  2: "Small, short-lived dips are possible.",
  3: "Can fall in a bad year, usually modestly.",
  4: "Expect occasional losses of several percent.",
  5: "Can lose a fifth or more in a sell-off.",
  6: "Moves with the stock market; falls of 30% or more have happened.",
};

function RiskTab({ meta, risk, source }: { meta: Meta; risk: RiskLevel | null; source: AnalyticsSource }) {
  return (
    <>
      <section className="card mf-panel mf-riskcard" aria-labelledby="mf-riskscale-t">
        <div className="mf-panel-head">
          <div>
            <h2 id="mf-riskscale-t">Where it sits on the risk scale</h2>
            <p className="mf-basis">Estimated from the AMFI category “{categoryShort(meta.category)}”. The AMC&apos;s own SEBI riskometer is set monthly and can differ.</p>
          </div>
          <RiskMeter level={risk} size="lg" />
        </div>
        <ol className="mf-riskscale">
          {RISK_STEPS.map((step) => (
            <li key={step} className={risk === step ? "on" : ""} style={{ "--rb": `var(--risk-${step})` } as CSSProperties} aria-current={risk === step ? "true" : undefined}>
              <i aria-hidden />
              <strong>{RISK_LABELS[step]}</strong>
              <span>{RISK_MEANING[step]}</span>
            </li>
          ))}
        </ol>
        <GapNote gaps={["riskometer"]}>The official riskometer level is not in the API.</GapNote>
      </section>
      {source.state === "ready" ? <FundDrawdown set={source.set} /> : null}
      <div className="mf-grid-2">
        <RiskReturnPanel source={source} />
        <DownMarketsPanel source={source} />
      </div>
    </>
  );
}

function Documents({ code, meta }: { code: number; meta: Meta }) {
  return (
    <>
      <section className="card mf-panel" aria-labelledby="mf-docs-t">
        <h2 id="mf-docs-t">Fact sheet</h2>
        <p className="mf-basis">A one-page summary of this fund and your holding: key facts, tax treatment, returns, and what data is still missing. Choose “Save as PDF” in the print dialog.</p>
        <FactSheetActions name={meta.name} />
      </section>
      <section className="card mf-panel" aria-labelledby="mf-src-t">
        <h2 id="mf-src-t">Where the numbers come from</h2>
        <dl className="mf-facts">
          <div>
            <dt>NAV</dt>
            <dd>AMFI daily NAV file, via mfapi.in{meta.navDate ? `, last ${meta.navDate}` : ""}</dd>
          </div>
          <div>
            <dt>Benchmarks</dt>
            <dd>Nifty 50 and Nifty 500 daily closes</dd>
          </div>
          <div>
            <dt>Risk and tax class</dt>
            <dd>Estimated from the AMFI category label</dd>
          </div>
          <div>
            <dt>Scheme code</dt>
            <dd>{code}</dd>
          </div>
        </dl>
      </section>
      <DataGap title="Scheme documents" gaps={["documents"]}>
        <p className="muted">Links to the scheme information document (SID), key information memorandum (KIM) and the AMC&apos;s monthly factsheet, with their dates.</p>
      </DataGap>
    </>
  );
}
