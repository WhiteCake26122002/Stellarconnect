"use client";

import { useState } from "react";
import type { FundHolding } from "@/lib/api";
import { parseDay } from "@/lib/funds/analytics";
import { assetClass, categoryRisk, categoryShort, planType, RISK_LABELS } from "@/lib/funds/category";
import { longDate, rupees, signedPoints, signedRupees } from "@/lib/funds/format";
import { DATA_GAPS, GapId } from "@/lib/funds/gaps";
import type { BenchView, ReturnView } from "@/lib/funds/returns";
import { DocIcon, ShareIcon } from "./FundIcons";

export type FactSheetData = {
  code: number;
  name: string;
  house: string;
  category: string;
  nav: number | null;
  navDate: string | null;
  holding: FundHolding | null;
  ret: ReturnView;
  bench: BenchView;
  verdict: string;
  /** How the fund is taxed, from the server's rules; null until loaded. */
  tax?: { label: string; shortTerm: string; longTerm: string } | null;
};

const SHEET_GAPS: GapId[] = ["expense-ratio", "aum", "inception", "exit-load", "fund-manager", "holdings", "riskometer"];

/** Print / Save-as-PDF, and share the page link. The browser's print pipeline does the PDF. */
export function FactSheetActions({ name, compact = false }: { name: string; compact?: boolean }) {
  const [shareNote, setShareNote] = useState("");

  async function share() {
    const url = window.location.href.split("#")[0];
    try {
      if (navigator.share) {
        await navigator.share({ title: name, text: `${name} on Connect`, url });
        setShareNote("");
        return;
      }
      await navigator.clipboard.writeText(url);
      setShareNote("Link copied");
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setShareNote("Could not copy. The link is in the address bar.");
    }
    window.setTimeout(() => setShareNote(""), 2400);
  }

  return (
    <span className="mf-doc-actions">
      <button type="button" className={`btn ${compact ? "ghost" : "secondary"} small`} onClick={() => window.print()}>
        <DocIcon size={15} /> {compact ? "Fact sheet" : "Download fact sheet (PDF)"}
      </button>
      <button type="button" className="btn ghost small" onClick={share} aria-describedby="mf-share-note">
        <ShareIcon size={15} /> Share
      </button>
      <span id="mf-share-note" className="mf-share-note" role="status">
        {shareNote}
      </span>
    </span>
  );
}

/** Hidden on screen; the only thing on the page when printing. Plain HTML so it paginates well. */
export function FactSheet({ data }: { data: FactSheetData }) {
  const { holding } = data;
  const plan = planType(data.name);
  const risk = categoryRisk(data.category, data.name);
  const rule = data.tax;
  const generated = longDate(Date.now());

  return (
    <article className="mf-factsheet">
      <header>
        <p className="mf-fs-kicker">Fund fact sheet · generated {generated}</p>
        <h1>{data.name}</h1>
        <p>
          {data.house} · {categoryShort(data.category)} · {[plan.plan, plan.option].filter(Boolean).join(" · ")} · AMFI scheme {data.code}
        </p>
      </header>

      <section>
        <h2>Key facts</h2>
        <table>
          <tbody>
            <tr>
              <th>Latest NAV</th>
              <td>
                {data.nav == null ? "n/a" : rupees(data.nav, 4)}
                {data.navDate ? ` (${data.navDate})` : ""}
              </td>
            </tr>
            <tr>
              <th>AMFI category</th>
              <td>{data.category}</td>
            </tr>
            <tr>
              <th>Asset class</th>
              <td>{assetClass(data.category)}</td>
            </tr>
            <tr>
              <th>Risk (estimated from category)</th>
              <td>{risk ? RISK_LABELS[risk] : "Not estimated"}</td>
            </tr>
            <tr>
              <th>Tax treatment</th>
              <td>
                {rule ? `${rule.label}. Short-term: ${rule.shortTerm}. Long-term: ${rule.longTerm}. Estimates, not tax advice.` : "See Tax and exit load on the fund page."}
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      {holding ? (
        <section>
          <h2>Your holding</h2>
          <table>
            <tbody>
              <tr>
                <th>Units</th>
                <td>{holding.units.toLocaleString("en-IN", { maximumFractionDigits: 3 })}</td>
              </tr>
              <tr>
                <th>Average NAV paid</th>
                <td>{rupees(holding.avg_nav, 4)}</td>
              </tr>
              <tr>
                <th>Invested / value</th>
                <td>
                  {rupees(holding.invested)} / {rupees(holding.value)}
                </td>
              </tr>
              <tr>
                <th>Gain</th>
                <td>
                  {signedRupees(holding.gain)} ({signedPoints(holding.gain_pct)})
                </td>
              </tr>
              <tr>
                <th>1Y return (point to point)</th>
                <td>{signedPoints(holding.return_1y)}</td>
              </tr>
              <tr>
                <th>{data.ret.label} / {data.bench.label ?? "benchmark"}, same dates</th>
                <td>
                  {signedPoints(data.ret.value)} / {data.bench.available ? signedPoints(data.bench.value) : "unavailable"}
                  {data.verdict ? ` · ${data.verdict}` : ""}
                </td>
              </tr>
              <tr>
                <th>Bought</th>
                <td>
                  {longDate(parseDay(holding.purchase_date))} (first purchase)
                </td>
              </tr>
            </tbody>
          </table>
        </section>
      ) : null}

      <section>
        <h2>Not included yet</h2>
        <ul>
          {SHEET_GAPS.map((g) => (
            <li key={g}>
              <strong>{DATA_GAPS[g].title}:</strong> {DATA_GAPS[g].missing}
            </li>
          ))}
        </ul>
      </section>

      <footer>
        NAVs from AMFI via mfapi.in. Risk and tax treatment are estimated from the AMFI category label and are indicative only. Not investment or tax advice.
      </footer>
    </article>
  );
}
