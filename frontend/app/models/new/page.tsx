"use client";

import Link from "next/link";
import { CSSProperties, FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { DeskHero } from "@/components/desk/DeskHero";
import { ApiError, api } from "@/lib/api";

type SearchHit = {
  symbol: string;
  name: string;
  exchange: string;
  listing?: string;
  currency?: string;
  nse_equivalent?: string | null;
};

type ListingChoice = { adr: string; nse: string; name: string };

const UNIT_FACTOR: Record<string, number> = {
  millions: 1,
  crore: 10,
  thousands: 0.001,
  units: 0.000001,
};

function typed(fd: FormData, name: string): string {
  return String(fd.get(name) ?? "").trim();
}

function scaleAmount(raw: string, factor: number): number | null {
  if (raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return n * factor;
}

function yearSuffix(age: number): string {
  return age === 0 ? "0" : String(age);
}

export default function NewModelPage() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState("");
  const [yearCount, setYearCount] = useState(1);
  const [listingChoice, setListingChoice] = useState<ListingChoice | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    const needle = q.trim();
    if (needle.length < 2) {
      setHits([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const t = window.setTimeout(async () => {
      abort.current?.abort();
      const ac = new AbortController();
      abort.current = ac;
      try {
        const data = await api.searchCompanies(q);
        if (!ac.signal.aborted) setHits(data.results as SearchHit[]);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) router.replace("/login");
        else if (!ac.signal.aborted) setError(err instanceof Error ? err.message : "Search failed");
      } finally {
        if (!ac.signal.aborted) setSearching(false);
      }
    }, 280);
    return () => window.clearTimeout(t);
  }, [q, router]);

  async function createFromTicker(symbol: string) {
    const hit = hits.find((h) => h.symbol === symbol);
    const nse = hit?.nse_equivalent;
    if (nse && !symbol.includes(".")) {
      setListingChoice({ adr: symbol, nse, name: hit?.name || symbol });
      return;
    }
    await submitTicker(symbol);
  }

  async function submitTicker(symbol: string) {
    setListingChoice(null);
    setPending(true);
    setError("");
    setStatus(`Pulling filings for ${symbol}…`);
    try {
      const model = await api.createModel({ source: "ticker", ticker: symbol });
      router.push(`/models/${model.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not fetch that company.");
      setPending(false);
      setStatus("");
    }
  }

  async function createSample() {
    setPending(true);
    setError("");
    setStatus("Opening Orion Cloud Systems…");
    try {
      const model = await api.createModel({ source: "sample" });
      router.push(`/models/${model.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
      setPending(false);
      setStatus("");
    }
  }

  async function onManual(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const latestYear = Number(typed(fd, "year") || "2026");
    const factor = UNIT_FACTOR[typed(fd, "units") || "millions"] ?? 1;
    const companyType = typed(fd, "company_type") || "public";
    const income_statements: Record<string, unknown>[] = [];
    const balance_sheets: Record<string, unknown>[] = [];
    const cash_flows: Record<string, unknown>[] = [];

    for (let age = yearCount - 1; age >= 0; age--) {
      const s = yearSuffix(age);
      const year = latestYear - age;
      const period = `FY${year}`;
      const revenue = scaleAmount(typed(fd, `revenue_${s}`), factor);
      if (revenue == null || revenue === 0) {
        if (age === 0) {
          setError("Enter non-zero revenue for the latest year.");
          return;
        }
        continue;
      }
      const cogsRaw = typed(fd, `cogs_${s}`);
      if (age === 0 && cogsRaw === "") {
        setError("Enter COGS for the latest year. Gross margin is not inferred from EBITDA.");
        return;
      }
      const cogs = scaleAmount(cogsRaw, factor) ?? 0;
      const rnd = scaleAmount(typed(fd, `rnd_${s}`), factor);
      const sm = scaleAmount(typed(fd, `sm_${s}`), factor);
      const ga = scaleAmount(typed(fd, `ga_${s}`), factor);
      const ebitdaMemo = scaleAmount(typed(fd, `ebitda_${s}`), factor);
      const da = scaleAmount(typed(fd, `da_${s}`), factor) ?? 0;
      const interest = scaleAmount(typed(fd, `interest_${s}`), factor);
      const taxes = scaleAmount(typed(fd, `taxes_${s}`), factor);
      let otherOpex = 0;
      if (ebitdaMemo != null && rnd == null && sm == null && ga == null) {
        otherOpex = Math.max(revenue - cogs - ebitdaMemo, 0);
      }

      income_statements.push({
        period,
        revenue,
        cogs,
        rnd: rnd ?? 0,
        sm: sm ?? 0,
        ga: ga ?? 0,
        other_opex: otherOpex,
        da,
        interest_expense: interest ?? 0,
        taxes: taxes ?? 0,
        other_below_ebit: 0,
      });

      const cashRaw = typed(fd, `cash_${s}`);
      const debtRaw = typed(fd, `debt_${s}`);
      const stDebtRaw = typed(fd, `st_debt_${s}`);
      const arRaw = typed(fd, `ar_${s}`);
      const apRaw = typed(fd, `ap_${s}`);
      const invRaw = typed(fd, `inventory_${s}`);
      const cash = scaleAmount(cashRaw, factor);
      const debt = scaleAmount(debtRaw, factor);
      const stDebt = scaleAmount(stDebtRaw, factor);
      const ar = scaleAmount(arRaw, factor);
      const ap = scaleAmount(apRaw, factor);
      const inventory = scaleAmount(invRaw, factor);
      const ppe = scaleAmount(typed(fd, `ppe_${s}`), factor);
      const leases = scaleAmount(typed(fd, `leases_${s}`), factor);
      const accrued = scaleAmount(typed(fd, `accrued_${s}`), factor);
      const equity = scaleAmount(typed(fd, `equity_${s}`), factor);
      if (age === 0 && equity == null) {
        setError("Shareholders' equity is required for the latest year.");
        return;
      }
      const nwcTyped = arRaw !== "" && apRaw !== "";
      const debtTyped = debtRaw !== "" || stDebtRaw !== "";

      balance_sheets.push({
        period,
        cash: cash ?? 0,
        cash_status: cashRaw === "" ? "unavailable" : "available",
        cash_reported: cashRaw !== "",
        cash_source: cashRaw === "" ? "not entered on the snapshot form" : "manual snapshot",
        marketable_securities: 0,
        accounts_receivable: ar ?? 0,
        inventory: inventory ?? 0,
        other_current_assets: 0,
        ppe: ppe ?? 0,
        goodwill: 0,
        intangibles: 0,
        other_assets: 0,
        accounts_payable: ap ?? 0,
        accrued_liabilities: accrued ?? 0,
        short_term_debt: stDebt ?? 0,
        long_term_debt: debt ?? 0,
        lease_liabilities: leases ?? 0,
        other_liabilities: 0,
        shareholders_equity: equity ?? 0,
        nwc_status: nwcTyped ? "available" : "unavailable",
        operating_wc_complete: nwcTyped,
        debt_status: debtTyped ? "available" : "unavailable",
        debt_source: debtTyped ? "manual snapshot" : "not entered on the snapshot form",
      });

      const ni = scaleAmount(typed(fd, `ni_${s}`), factor);
      const capex = scaleAmount(typed(fd, `capex_${s}`), factor);
      const dnwc = scaleAmount(typed(fd, `dnwc_${s}`), factor);
      cash_flows.push({
        period,
        net_income: ni ?? 0,
        da,
        stock_based_comp: 0,
        other_noncash: 0,
        change_in_nwc: dnwc ?? 0,
        capex: capex ?? 0,
        acquisitions: 0,
        other_investing: 0,
        debt_issuance_repayment: 0,
        equity_issuance_repurchase: 0,
        dividends: 0,
      });
    }

    if (!income_statements.length) {
      setError("Enter at least one year of non-zero revenue.");
      return;
    }

    const priceRaw = typed(fd, "price");
    const sharesRaw = typed(fd, "shares");
    setPending(true);
    setError("");
    setStatus("Building from the snapshot…");
    try {
      const model = await api.createModel({
        source: "manual",
        company: {
          name: typed(fd, "name"),
          ticker: typed(fd, "ticker") || null,
          company_type: companyType,
          currency: typed(fd, "currency") || "USD",
          country: typed(fd, "country"),
          current_share_price: priceRaw === "" ? null : Number(priceRaw),
          diluted_shares_outstanding: sharesRaw === "" ? null : Number(sharesRaw),
          shares_status: sharesRaw === "" ? "unavailable" : "available",
        },
        historicals: { income_statements, balance_sheets, cash_flows },
      });
      router.push(`/models/${model.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create the model.");
      setPending(false);
      setStatus("");
    }
  }

  return (
    <AppShell>
      <main id="main" className="shell" style={{ maxWidth: 920 }}>
        <p className="crumb">
          <Link href="/models">Models</Link>
          <span className="muted"> / New</span>
        </p>
        <DeskHero
          compact
          n="02"
          kicker="Valuation · step by step"
          echo="Start a"
          title="New model"
          lead="Start from a live ticker. The sample is for learning the desk. Paste a snapshot only if the company is not listed."
        />
        {error ? <div className="banner bad">{error}</div> : null}
        {status ? <div className="banner ok">{status}</div> : null}

        {listingChoice ? (
          <section className="card listing-choice" style={{ marginBottom: "1rem" }}>
            <h2>Which listing?</h2>
            <p className="note">
              {listingChoice.name} trades as both a local India listing and a US ADR. These are different
              securities — different currency, statements, and terminal-growth defaults.
            </p>
            <div className="list search-hits">
              <div className="row">
                <div>
                  <strong>{listingChoice.name} (NSE, INR)</strong>
                  <div className="muted">{listingChoice.nse} · Screener.in statements in rupees</div>
                </div>
                <button type="button" className="btn small" disabled={pending} onClick={() => submitTicker(listingChoice.nse)}>
                  Use NSE
                </button>
              </div>
              <div className="row">
                <div>
                  <strong>{listingChoice.name} (ADR, USD)</strong>
                  <div className="muted">{listingChoice.adr} · Yahoo Finance statements in dollars</div>
                </div>
                <button type="button" className="btn small" disabled={pending} onClick={() => submitTicker(listingChoice.adr)}>
                  Use ADR
                </button>
              </div>
            </div>
            <button type="button" className="btn ghost small" onClick={() => setListingChoice(null)}>
              Cancel
            </button>
          </section>
        ) : null}

        <section className="card dk-step dk-in" style={{ marginBottom: "1rem", "--k": 0 } as CSSProperties}>
          <h2>
            <b>01</b>Live company
          </h2>
          <p className="note">
            Type at least two characters. A bare ticker like INFY is the US ADR (USD). India listings use .NS (INR).
          </p>
          <div className="live-search">
            <label htmlFor="ticker-search">Company or ticker</label>
            <input
              id="ticker-search"
              value={q}
              onChange={(e) => {
                setError("");
                setQ(e.target.value);
              }}
              placeholder="TCS, AAPL, Reliance"
              autoComplete="off"
              disabled={pending}
            />
          </div>
          {searching ? <p className="note">Searching…</p> : null}
          {!searching && q.trim().length >= 2 && hits.length === 0 ? (
            <p className="note">No listed match. Try the Yahoo ticker, or paste statements below.</p>
          ) : null}
          <div className="list search-hits">
            {hits.map((h) => (
              <div key={h.symbol} className="row">
                <div>
                  <strong>{h.name}</strong>
                  <div className="muted">
                    {h.symbol} · {h.listing || h.exchange || "listed"}
                  </div>
                </div>
                <button type="button" className="btn small" disabled={pending} onClick={() => createFromTicker(h.symbol)}>
                  Create model
                </button>
              </div>
            ))}
          </div>
        </section>

        <section className="card dk-step dk-in" style={{ marginBottom: "1rem", "--k": 1 } as CSSProperties}>
          <h2>
            <b>02</b>Sample
          </h2>
          <p className="muted">Orion Cloud Systems (ORCS) — fictional, so you can learn the workspace without a market feed.</p>
          <button type="button" className="btn secondary" disabled={pending} onClick={createSample}>
            Open sample model
          </button>
        </section>

        <details className="card dk-step dk-in" style={{ "--k": 2 } as CSSProperties}>
          <summary>
            <b>03</b>
            <strong>Paste a snapshot</strong>
            <span className="note summary-note">Up to three fiscal years. Blank lines stay unavailable — they are not stored as verified zeros.</span>
          </summary>
          <form className="grid snapshot-form" onSubmit={onManual} style={{ marginTop: "0.85rem" }}>
            <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
              <div>
                <label htmlFor="name">Company name</label>
                <input id="name" name="name" required disabled={pending} />
              </div>
              <div>
                <label htmlFor="ticker">Ticker (optional)</label>
                <input id="ticker" name="ticker" disabled={pending} />
              </div>
              <div>
                <label htmlFor="currency">Currency</label>
                <input id="currency" name="currency" defaultValue="USD" disabled={pending} />
              </div>
              <div>
                <label htmlFor="units">Statement units</label>
                <select id="units" name="units" defaultValue="millions" disabled={pending}>
                  <option value="millions">Millions</option>
                  <option value="crore">Crore (₹ 1 cr = 10 million)</option>
                  <option value="thousands">Thousands</option>
                  <option value="units">Units (absolute)</option>
                </select>
              </div>
              <div>
                <label htmlFor="country">Country</label>
                <input id="country" name="country" placeholder="India, United States…" disabled={pending} />
              </div>
              <div>
                <label htmlFor="company_type">Type</label>
                <select id="company_type" name="company_type" defaultValue="public" disabled={pending}>
                  <option value="public">Public</option>
                  <option value="private">Private</option>
                </select>
              </div>
              <div>
                <label htmlFor="year">Latest fiscal year</label>
                <input id="year" name="year" type="number" defaultValue={2026} disabled={pending} />
              </div>
              <div>
                <label htmlFor="year-count">Years of history</label>
                <select
                  id="year-count"
                  value={yearCount}
                  onChange={(e) => setYearCount(Number(e.target.value))}
                  disabled={pending}
                >
                  <option value={1}>1 year</option>
                  <option value={2}>2 years</option>
                  <option value={3}>3 years</option>
                </select>
              </div>
              <div>
                <label htmlFor="price">Share price (per share, not scaled)</label>
                <input id="price" name="price" type="number" step="any" disabled={pending} />
              </div>
              <div>
                <label htmlFor="shares">Diluted shares (millions of shares)</label>
                <input id="shares" name="shares" type="number" step="any" disabled={pending} />
              </div>
            </div>

            <p className="note">
              Enter statement figures in the units chosen above. Share price and diluted-share count are not
              multiplied. Leave a cell blank if you do not have the line — do not type 0 unless the filing
              shows zero. Gross margin uses the COGS you type; EBITDA is a memo and is not used to invent COGS.
              R&amp;D / S&amp;M / G&amp;A left blank stay unsplit. If you enter EBITDA without those opex lines,
              the residual (revenue − COGS − EBITDA) is stored as other opex so the EBITDA identity holds.
            </p>

            {Array.from({ length: yearCount }, (_, age) => {
              const s = yearSuffix(age);
              const title = age === 0 ? "Latest year" : age === 1 ? "Prior year" : "Two years prior";
              const required = age === 0;
              return (
                <fieldset key={s} className="year-block">
                  <legend>{title}</legend>
                  <h3 className="year-sub">Income statement</h3>
                  <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                    <Num id={`revenue_${s}`} label="Revenue" required={required} pending={pending} />
                    <Num id={`cogs_${s}`} label="COGS / cost of sales" required={required} pending={pending} />
                    <Num id={`rnd_${s}`} label="R&D" pending={pending} />
                    <Num id={`sm_${s}`} label="Sales & marketing" pending={pending} />
                    <Num id={`ga_${s}`} label="G&A" pending={pending} />
                    <Num id={`ebitda_${s}`} label="EBITDA (optional memo)" pending={pending} />
                    <Num id={`da_${s}`} label="D&A" pending={pending} />
                    <Num id={`interest_${s}`} label="Interest expense" pending={pending} />
                    <Num id={`taxes_${s}`} label="Taxes" pending={pending} />
                    <Num id={`ni_${s}`} label="Net income" pending={pending} />
                  </div>
                  <h3 className="year-sub">Balance sheet</h3>
                  <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                    <Num id={`cash_${s}`} label="Cash" pending={pending} />
                    <Num id={`ar_${s}`} label="Accounts receivable" pending={pending} />
                    <Num id={`inventory_${s}`} label="Inventory" pending={pending} />
                    <Num id={`ppe_${s}`} label="PP&E" pending={pending} />
                    <Num id={`ap_${s}`} label="Accounts payable" pending={pending} />
                    <Num id={`accrued_${s}`} label="Accrued liabilities" pending={pending} />
                    <Num id={`st_debt_${s}`} label="Short-term debt" pending={pending} />
                    <Num id={`debt_${s}`} label="Long-term debt" pending={pending} />
                    <Num id={`leases_${s}`} label="Lease liabilities" pending={pending} />
                    <Num id={`equity_${s}`} label="Shareholders' equity" required={required} pending={pending} />
                  </div>
                  <h3 className="year-sub">Cash flow</h3>
                  <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                    <Num id={`capex_${s}`} label="Capex" pending={pending} />
                    <Num id={`dnwc_${s}`} label="Change in NWC" pending={pending} />
                  </div>
                </fieldset>
              );
            })}

            <button type="submit" className="btn" disabled={pending}>
              {pending ? "Building…" : "Build model"}
            </button>
          </form>
        </details>
      </main>
    </AppShell>
  );
}

function Num({
  id,
  label,
  required,
  pending,
}: {
  id: string;
  label: string;
  required?: boolean;
  pending: boolean;
}) {
  return (
    <div>
      <label htmlFor={id}>{label}</label>
      <input id={id} name={id} type="number" step="any" required={required} disabled={pending} />
    </div>
  );
}
