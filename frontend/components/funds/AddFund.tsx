"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, forwardRef, useEffect, useState } from "react";
import { ApiError, api, FundPortfolio, FundQuote, FundSchemeHit } from "@/lib/api";
import { planType } from "@/lib/funds/category";
import { rupees } from "@/lib/funds/format";
import { useSchemeSearch } from "@/lib/funds/useSchemeSearch";
import { CategoryChip, StarButton } from "./FundAtoms";

type PlanFilter = "all" | "Direct" | "Regular";

export const AddFund = forwardRef<HTMLInputElement, { onAdded: (book: FundPortfolio) => void; initialCode?: number | null }>(function AddFund({ onAdded, initialCode }, searchRef) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [plan, setPlan] = useState<PlanFilter>("all");
  const [picked, setPicked] = useState<FundSchemeHit | null>(null);
  const [quote, setQuote] = useState<FundQuote | null>(null);
  const [quoteError, setQuoteError] = useState("");
  const [units, setUnits] = useState("");
  const [manual, setManual] = useState(false);
  const [paidNav, setPaidNav] = useState("");
  const [bought, setBought] = useState("");
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const search = useSchemeSearch(query, { skip: picked != null && query.trim() === picked.name, limit: 25 });
  const hits = search.hits.filter((h) => plan === "all" || planType(h.name).plan === plan);
  const hidden = search.hits.length - hits.length;

  useEffect(() => {
    if (!initialCode) return;
    const controller = new AbortController();
    api
      .fundQuote(initialCode, controller.signal)
      .then((q) => {
        setPicked({ code: q.scheme_code, name: q.scheme_name });
        setQuery(q.scheme_name);
        setQuote(q);
      })
      .catch(() => {
        /* the search box still works; nothing to prefill */
      });
    return () => controller.abort();
  }, [initialCode]);

  function choose(hit: FundSchemeHit) {
    setPicked(hit);
    setQuote(null);
    setQuoteError("");
    setQuery(hit.name);
    api
      .fundQuote(hit.code)
      .then(setQuote)
      .catch((err) => setQuoteError(err instanceof Error ? err.message : "Could not load the latest NAV."));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError("");
    if (!picked) {
      setFormError("Choose a scheme from the search results.");
      return;
    }
    const qty = Number(units);
    if (!Number.isFinite(qty) || qty <= 0) {
      setFormError("Units must be greater than zero.");
      return;
    }
    const body: { scheme_code: number; units: number; avg_nav?: number; purchase_date?: string } = {
      scheme_code: picked.code,
      units: qty,
    };
    if (manual) {
      const paid = Number(paidNav);
      if (!Number.isFinite(paid) || paid <= 0) {
        setFormError("Enter the NAV you paid.");
        return;
      }
      body.avg_nav = paid;
      if (bought) body.purchase_date = bought;
    }
    setSaving(true);
    try {
      const next = await api.addFund(body);
      onAdded(next);
      setUnits("");
      setPaidNav("");
      setBought("");
      setManual(false);
      setPicked(null);
      setQuote(null);
      setQuery("");
      if (window.location.search.includes("add=")) window.history.replaceState(null, "", window.location.pathname + window.location.hash);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) router.replace("/login");
      else setFormError(err instanceof Error ? err.message : "Could not add that fund.");
    } finally {
      setSaving(false);
    }
  }

  const qty = Number(units);
  const navUsed = manual ? Number(paidNav) : quote?.nav;
  const order = Number.isFinite(qty) && qty > 0 && navUsed && Number.isFinite(navUsed) ? qty * navUsed : null;
  const needle = query.trim();
  const showHits = !picked || needle !== picked.name;

  return (
    <form className="card funds-add" id="add-fund" onSubmit={onSubmit}>
      <div className="mf-panel-head">
        <h2>Add a fund</h2>
        <div className="seg mf-seg" role="group" aria-label="Plan in results">
          {(["all", "Direct", "Regular"] as PlanFilter[]).map((p) => (
            <button key={p} type="button" aria-pressed={plan === p} onClick={() => setPlan(p)}>
              {p === "all" ? "All plans" : p}
            </button>
          ))}
        </div>
      </div>
      <label htmlFor="fund-search">Search scheme name</label>
      <input
        id="fund-search"
        ref={searchRef}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setPicked(null);
          setQuote(null);
        }}
        placeholder="HDFC Flexi Cap"
        autoComplete="off"
        aria-describedby="fund-search-status"
      />
      <p className="muted funds-sub" id="fund-search-status" aria-live="polite">
        {search.error
          ? search.error
          : needle.length < 2
            ? "Search across every scheme AMFI publishes a NAV for. Tip: the fund house plus one word works best."
            : search.pending
              ? "Searching AMFI schemes…"
              : showHits && search.answered
                ? `${hits.length} ${hits.length === 1 ? "scheme" : "schemes"}${hidden ? `, ${hidden} hidden by the plan filter` : ""}`
                : ""}
      </p>
      {showHits && search.pending ? (
        <ul className="funds-hits mf-hits-skel" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <li key={i}>
              <span className="skel skel-line" style={{ width: `${72 - i * 14}%` }} />
            </li>
          ))}
        </ul>
      ) : showHits && search.answered && !search.error && hits.length === 0 ? (
        <div className="mf-nohits">
          <p>
            <strong>No {plan !== "all" ? `${plan} ` : ""}schemes match “{needle}”.</strong>
          </p>
          <ul>
            {hidden ? (
              <li>
                <button type="button" className="text-btn" onClick={() => setPlan("all")}>
                  Show all plans
                </button>{" "}
                ({hidden} {hidden === 1 ? "match" : "matches"} on the other plan)
              </li>
            ) : null}
            <li>Drop words like “fund”, “plan” or “growth”; names are matched as written.</li>
            <li>Try the fund house and one distinctive word, like “Axis Midcap”.</li>
          </ul>
        </div>
      ) : showHits && hits.length > 0 ? (
        <ul className="funds-hits mf-add-hits">
          {hits.map((hit) => {
            const p = planType(hit.name);
            return (
              <li key={hit.code}>
                <button type="button" className="mf-hit-name" onClick={() => choose(hit)}>
                  <strong>{hit.name}</strong>
                  <span>
                    <span className={`mf-plan-dot ${p.plan === "Direct" ? "direct" : ""}`} aria-hidden /> {p.plan}
                    {p.option ? ` · ${p.option}` : ""} · {hit.code}
                  </span>
                </button>
                <StarButton subject={{ code: hit.code, name: hit.name, house: null, category: null, nav: null, navDate: null }} />
              </li>
            );
          })}
        </ul>
      ) : null}
      {quote ? (
        <div className="funds-quote">
          <CategoryChip category={quote.scheme_category} />
          <span>
            Latest NAV <strong>{rupees(quote.nav, 4)}</strong>
            <span className="muted"> as of {quote.nav_date}</span>
          </span>
          <Link href={`/funds/${quote.scheme_code}`}>Fund page</Link>
        </div>
      ) : null}
      {quoteError ? <p className="error">{quoteError}</p> : null}
      <div className="funds-fields">
        <div>
          <label htmlFor="fund-units">Units</label>
          <input id="fund-units" inputMode="decimal" value={units} onChange={(e) => setUnits(e.target.value)} />
        </div>
        <fieldset>
          <legend>Purchase NAV</legend>
          <label>
            <input type="radio" name="nav-mode" checked={!manual} onChange={() => setManual(false)} /> Latest NAV
          </label>
          <label>
            <input type="radio" name="nav-mode" checked={manual} onChange={() => setManual(true)} /> NAV I paid
          </label>
        </fieldset>
        {manual ? (
          <>
            <div>
              <label htmlFor="fund-nav">Your purchase NAV</label>
              <input id="fund-nav" inputMode="decimal" value={paidNav} onChange={(e) => setPaidNav(e.target.value)} />
            </div>
            <div>
              <label htmlFor="fund-date">Purchase date</label>
              <input id="fund-date" type="date" value={bought} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setBought(e.target.value)} />
            </div>
          </>
        ) : null}
      </div>
      {order != null ? <p className="muted">Order value {rupees(order)}</p> : null}
      {formError ? <p className="error">{formError}</p> : null}
      <button type="submit" className="btn" disabled={saving || !picked}>
        {saving ? "Adding…" : "Add to portfolio"}
      </button>
      <p className="muted funds-sub">Adding the same scheme again blends a new average NAV and keeps the original purchase date.</p>
    </form>
  );
});
