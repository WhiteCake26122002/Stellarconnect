"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, forwardRef, useEffect, useMemo, useState } from "react";
import { ApiError, api, FundNavOn, FundPortfolio, FundQuote, FundSchemeHit } from "@/lib/api";
import { CHARGES, rateOn, roundPaise } from "@/lib/costs/rules";
import { parseDay } from "@/lib/funds/analytics";
import { planType } from "@/lib/funds/category";
import { longDate, rupees } from "@/lib/funds/format";
import { useSchemeSearch } from "@/lib/funds/useSchemeSearch";
import { CategoryChip, StarButton } from "./FundAtoms";

type PlanFilter = "all" | "Direct" | "Regular";
type When = "today" | "past";
type Mode = "units" | "amount" | "sip";

/** A typed NAV this far from the published one is queried before it is saved. */
const NAV_ENTRY_TOLERANCE = 0.015;
const todayIso = () => new Date().toISOString().slice(0, 10);

export const AddFund = forwardRef<HTMLInputElement, { onAdded: (book: FundPortfolio) => void; initialCode?: number | null }>(function AddFund({ onAdded, initialCode }, searchRef) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [plan, setPlan] = useState<PlanFilter>("all");
  const [picked, setPicked] = useState<FundSchemeHit | null>(null);
  const [quote, setQuote] = useState<FundQuote | null>(null);
  const [quoteError, setQuoteError] = useState("");
  const [units, setUnits] = useState("");
  const [mode, setMode] = useState<Mode>("units");
  const [amount, setAmount] = useState("");
  const [sipDay, setSipDay] = useState("5");
  const [sipStart, setSipStart] = useState("");
  const [sipCount, setSipCount] = useState("");
  const [when, setWhen] = useState<When>("today");
  const [bought, setBought] = useState("");
  const [dated, setDated] = useState<FundNavOn | null>(null);
  const [datedError, setDatedError] = useState("");
  const [datedLoading, setDatedLoading] = useState(false);
  const [override, setOverride] = useState(false);
  const [paidNav, setPaidNav] = useState("");
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

  // A historical purchase is priced from the NAV the scheme actually published that day.
  useEffect(() => {
    setDated(null);
    setDatedError("");
    if (when !== "past" || !picked || !bought || bought > todayIso()) return;
    const controller = new AbortController();
    setDatedLoading(true);
    api
      .fundNavOn(picked.code, bought, controller.signal)
      .then((d) => {
        setDated(d);
        setDatedLoading(false);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setDatedError(err instanceof Error ? err.message : "Could not find a NAV for that date.");
        setDatedLoading(false);
      });
    return () => controller.abort();
  }, [when, picked, bought]);

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

  const publishedNav = when === "today" ? (quote?.nav ?? null) : (dated?.nav ?? null);
  const typedNav = Number(paidNav);
  const typedOk = override && Number.isFinite(typedNav) && typedNav > 0;
  const navUsed = override ? (typedOk ? typedNav : null) : publishedNav;
  const gap = typedOk && publishedNav ? typedNav / publishedNav - 1 : null;
  const amt = Number(amount);
  const amountOk = Number.isFinite(amt) && amt > 0;
  // Stamp duty comes out of the money paid, so units are allotted on what is left.
  const dutyRate = rateOn(CHARGES.mutualFunds.stampDuty.ratePct, when === "past" && bought ? bought : todayIso());
  const duty = amountOk ? roundPaise((amt * dutyRate) / 100) : 0;
  const unitsFromAmount = amountOk && navUsed ? (amt - duty) / navUsed : null;
  const qty = mode === "amount" ? (unitsFromAmount ?? 0) : Number(units);
  const unitsValue = Number.isFinite(qty) && qty > 0 && navUsed ? qty * navUsed : null;
  // Units on a statement are already net of duty, so the amount paid is that value grossed up.
  const paid = mode === "amount" ? (amountOk ? amt : null) : unitsValue != null ? roundPaise(unitsValue / (1 - dutyRate / 100)) : null;
  const order = paid;
  const dutyShown = mode === "amount" ? duty : paid != null && unitsValue != null ? roundPaise(paid - unitsValue) : 0;
  const sipCountN = sipCount === "" ? undefined : Number(sipCount);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError("");
    if (!picked) {
      setFormError("Choose a scheme from the search results.");
      return;
    }
    if (mode === "sip") {
      const day = Number(sipDay);
      if (!amountOk) {
        setFormError("Enter the amount of each instalment.");
        return;
      }
      if (!sipStart || sipStart > todayIso()) {
        setFormError("Choose a start date that is not in the future.");
        return;
      }
      if (sipCountN != null && (!Number.isInteger(sipCountN) || sipCountN < 1)) {
        setFormError("The number of instalments must be a whole number.");
        return;
      }
      setSaving(true);
      try {
        const next = await api.fundSip({ scheme_code: picked.code, amount: amt, day_of_month: day, start_date: sipStart, ...(sipCountN ? { installments: sipCountN } : {}) });
        onAdded(next);
        setAmount("");
        setSipStart("");
        setSipCount("");
        setPicked(null);
        setQuote(null);
        setQuery("");
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) router.replace("/login");
        else setFormError(err instanceof Error ? err.message : "Could not add that SIP.");
      } finally {
        setSaving(false);
      }
      return;
    }
    if (mode === "amount" ? !amountOk : !Number.isFinite(qty) || qty <= 0) {
      setFormError(mode === "amount" ? "Enter the amount you paid." : "Units must be greater than zero.");
      return;
    }
    const body: { scheme_code: number; units?: number; amount?: number; avg_nav?: number; purchase_date?: string } = { scheme_code: picked.code };
    if (mode === "amount") body.amount = amt;
    else body.units = qty;
    if (when === "past") {
      if (!bought) {
        setFormError("Choose the purchase date.");
        return;
      }
      if (bought > todayIso()) {
        setFormError("The purchase date cannot be in the future.");
        return;
      }
      if (quote?.inception_date && bought < quote.inception_date) {
        setFormError(`This scheme's NAV history starts ${longDate(parseDay(quote.inception_date))}.`);
        return;
      }
      if (!override && !dated) {
        setFormError(datedError || "Wait for the NAV on that date to load, or enter the NAV you paid.");
        return;
      }
      body.purchase_date = bought;
    }
    if (override) {
      if (!typedOk) {
        setFormError("Enter the NAV you paid.");
        return;
      }
      body.avg_nav = typedNav;
    }
    setSaving(true);
    try {
      const next = await api.addFund(body);
      onAdded(next);
      setUnits("");
      setAmount("");
      setPaidNav("");
      setBought("");
      setOverride(false);
      setWhen("today");
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

  const needle = query.trim();
  const showHits = !picked || needle !== picked.name;
  const navLine = useMemo(() => {
    if (when === "today") return quote ? `The latest NAV, ${rupees(quote.nav, 4)} (${longDate(parseDay(quote.nav_date))}), will be used as your purchase NAV.` : "";
    if (!bought) return "Choose the date you bought.";
    if (datedLoading) return "Looking up the NAV for that date…";
    if (dated) {
      const same = dated.nav_date === dated.requested;
      return `AMFI published ${rupees(dated.nav, 4)} ${same ? "on" : `on ${longDate(parseDay(dated.nav_date))}, the last business day before`} ${longDate(parseDay(dated.requested))}. That will be your purchase NAV.`;
    }
    return "";
  }, [when, quote, bought, dated, datedLoading]);

  return (
    <form className="card funds-add mf-add" id="add-fund" onSubmit={onSubmit}>
      <div className="mf-panel-head">
        <div>
          <h2>Add a fund</h2>
          <p className="mf-basis">Search, then say when you bought. Every purchase is kept with its own date, which is what makes XIRR and the value path accurate.</p>
        </div>
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
                    {p.option ? ` · ${p.option}` : ""} · scheme {hit.code}
                  </span>
                </button>
                <StarButton subject={{ code: hit.code, name: hit.name, house: null, category: null, nav: null, navDate: null }} />
              </li>
            );
          })}
        </ul>
      ) : null}
      {quote ? (
        <div className="funds-quote mf-quote">
          <CategoryChip category={quote.scheme_category} />
          <span>
            {quote.fund_house} · latest NAV <strong>{rupees(quote.nav, 4)}</strong>
            <span className="muted"> as of {longDate(parseDay(quote.nav_date))}</span>
          </span>
          <Link href={`/funds/${quote.scheme_code}`}>Fund page</Link>
        </div>
      ) : null}
      {quoteError ? <p className="error">{quoteError}</p> : null}

      <div className="seg mf-seg" role="group" aria-label="How you are entering it" style={{ marginTop: 10 }}>
        {([["units", "By units"], ["amount", "By amount paid"], ["sip", "Monthly SIP"]] as const).map(([id, label]) => (
          <button key={id} type="button" aria-pressed={mode === id} onClick={() => setMode(id)}>{label}</button>
        ))}
      </div>
      {mode === "sip" ? (
        <div className="funds-fields mf-add-fields">
          <div>
            <label htmlFor="sip-amount">Amount of each instalment</label>
            <input id="sip-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 5000" />
          </div>
          <div>
            <label htmlFor="sip-day">Day of the month</label>
            <select id="sip-day" value={sipDay} onChange={(e) => setSipDay(e.target.value)}>
              {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="sip-start">First instalment on or after</label>
            <input id="sip-start" type="date" value={sipStart} min={quote?.inception_date} max={todayIso()} onChange={(e) => setSipStart(e.target.value)} />
          </div>
          <div>
            <label htmlFor="sip-count">Number of instalments</label>
            <input id="sip-count" inputMode="numeric" value={sipCount} onChange={(e) => setSipCount(e.target.value)} placeholder="until today" />
          </div>
        </div>
      ) : (
        <div className="funds-fields mf-add-fields">
          <div>
            {mode === "amount" ? (
              <>
                <label htmlFor="fund-amount">Amount you paid</label>
                <input id="fund-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 10000" />
              </>
            ) : (
              <>
                <label htmlFor="fund-units">Units you bought</label>
                <input id="fund-units" inputMode="decimal" value={units} onChange={(e) => setUnits(e.target.value)} placeholder="e.g. 125.5" />
              </>
            )}
          </div>
          <fieldset>
            <legend>When did you buy?</legend>
            <label>
              <input type="radio" name="buy-when" checked={when === "today"} onChange={() => setWhen("today")} /> Now, at the latest NAV
            </label>
            <label>
              <input type="radio" name="buy-when" checked={when === "past"} onChange={() => setWhen("past")} /> On an earlier date
            </label>
          </fieldset>
          {when === "past" ? (
            <div>
              <label htmlFor="fund-date">Purchase date</label>
              <input id="fund-date" type="date" value={bought} min={quote?.inception_date} max={todayIso()} onChange={(e) => setBought(e.target.value)} />
            </div>
          ) : null}
        </div>
      )}
      {mode === "sip" ? (
        <p className="mf-basis">
          Each instalment is bought at the NAV published on its date (the next business day if that is a holiday) and kept as its own lot, so each has its own holding period for tax. Instalments run up to today; nothing is projected.
        </p>
      ) : null}

      {picked && mode !== "sip" ? (
        <div className="mf-navbox" aria-live="polite">
          {navLine ? <p>{navLine}</p> : null}
          {datedError && when === "past" ? <p className="error">{datedError} You can still enter the NAV you paid.</p> : null}
          <label className="mf-override">
            <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} /> I paid a different NAV
          </label>
          {override ? (
            <div className="mf-override-field">
              <label htmlFor="fund-nav">NAV you paid</label>
              <span className="mf-input-prefix">
                <span aria-hidden>₹</span>
                <input id="fund-nav" inputMode="decimal" value={paidNav} onChange={(e) => setPaidNav(e.target.value)} />
              </span>
              {gap != null && Math.abs(gap) > NAV_ENTRY_TOLERANCE ? (
                <p className="warn-text">
                  That is {Math.abs(gap * 100).toFixed(1)}% {gap > 0 ? "above" : "below"} the published NAV. Check it; returns will follow what you enter.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {mode !== "sip" && order != null ? (
        <p className="mf-order">
          {mode === "amount" ? "You pay" : "Amount paid"} <strong>{rupees(order)}</strong>
          {dutyShown > 0 ? (
            <span className="muted">
              {" "}
              · includes {rupees(dutyShown)} stamp duty, taken out of the amount so {mode === "amount" ? `${qty.toLocaleString("en-IN", { maximumFractionDigits: 3 })} units are allotted` : "the units above are already net of it"}
            </span>
          ) : null}
        </p>
      ) : null}
      {formError ? (
        <p className="error" role="alert">
          {formError}
        </p>
      ) : null}
      <button type="submit" className="btn" disabled={saving || !picked}>
        {saving ? "Adding…" : mode === "sip" ? "Add the SIP" : "Add to portfolio"}
      </button>
      <p className="muted funds-sub">Adding the same scheme again records a second purchase on its own date. There is no distributor transaction charge: SEBI discontinued it in August 2025.</p>
    </form>
  );
});
