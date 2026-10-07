"use client";

import { useMemo, useState } from "react";
import "@/components/costs/cx.css";
import { ConfidenceBadge, CostDisclosure, EstimateNote, InfoTip } from "@/components/costs/CostDisclosure";
import { CostImpactLadder } from "@/components/costs/CostImpactLadder";
import { TaxProfileForm } from "@/components/costs/TaxProfileForm";
import { calculateEquityTax, equityTaxYears, unrealizedLots, type TaxLotRow } from "@/lib/costs/equityTax";
import { fyLabel, rulesFor } from "@/lib/costs/rules";
import type { TaxProfile } from "@/lib/costs/tax";
import type { EngineState } from "@/lib/trading/engine";
import { inr, px, signedInr } from "@/lib/trading/format";
import type { Quote } from "@/lib/trading/types";

const day = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

type Group = { symbol: string; name: string; gain: number; tax: number; held: string; lots: number; label: string };

function groupBySymbol(rows: TaxLotRow[]): Group[] {
  const by = new Map<string, Group>();
  for (const r of rows) {
    const g = by.get(r.symbol) ?? { symbol: r.symbol, name: r.name, gain: 0, tax: 0, held: r.heldText, lots: 0, label: r.taxClassLabel };
    g.gain += r.gain;
    g.tax += r.tax;
    g.lots += 1;
    if (r.heldDays > 0 && g.lots > 1) g.held = "several lots";
    by.set(r.symbol, g);
  }
  return [...by.values()].sort((a, b) => b.gain - a.gain);
}

function GainList({ groups, kind, onPick }: { groups: Group[]; kind: "STCG" | "LTCG"; onPick: (symbol: string) => void }) {
  if (groups.length === 0) return <p className="cx-quiet-text">None realised in this financial year.</p>;
  return (
    <ul className="cx-glist">
      {groups.map((g) => (
        <li key={g.symbol}>
          <button type="button" className="cx-rowbtn" onClick={() => onPick(g.symbol)}>{g.name}</button>
          <dl>
            <div><dt>Gain</dt><dd className={g.gain >= 0 ? "cx-up" : "cx-down"}>{signedInr(g.gain)}</dd></div>
            <div><dt>Holding period</dt><dd>{g.held}</dd></div>
            <div><dt>{kind === "LTCG" ? "Eligible LTCG" : "Estimated tax"}</dt><dd>{kind === "LTCG" ? (g.tax > 0 ? `Tax ${inr(g.tax)}` : "Within the exemption") : inr(g.tax)}</dd></div>
          </dl>
        </li>
      ))}
    </ul>
  );
}

/**
 * Capital gains for the paper account, by financial year: realised short- and long-term gains per
 * stock, the unrealised gain on open lots, an estimated tax with its confidence, and the lot table
 * behind every number. Intraday and F&O results are listed as business income and left out of the tax.
 */
export function CapitalGainsBoard({
  engine,
  quotes,
  profile,
  onProfile,
  onPick,
  onBack,
}: {
  engine: EngineState;
  quotes: Map<string, Quote>;
  profile: TaxProfile;
  onProfile: (p: TaxProfile) => void;
  onPick: (symbol: string) => void;
  onBack: () => void;
}) {
  const years = useMemo(() => equityTaxYears(engine.trades), [engine.trades]);
  const [fy, setFy] = useState(years[0]);
  const year = useMemo(() => calculateEquityTax(engine.trades, fy, profile), [engine.trades, fy, profile]);
  const open = useMemo(() => unrealizedLots(engine.positions, quotes), [engine.positions, quotes]);
  const est = year.estimate;
  const months = rulesFor(fy)?.equity.holdingMonths;

  const shortRows = year.rows.filter((r) => r.term === "short");
  const longRows = year.rows.filter((r) => r.term === "long");
  const stcg = shortRows.reduce((s, r) => s + r.gain, 0);
  const ltcg = longRows.reduce((s, r) => s + r.gain, 0);
  const business = year.excluded.filter((e) => e.kind === "business_income");
  const replay = year.excluded.filter((e) => e.kind === "replay");

  return (
    <div className="board-page cg-page">
      <header className="board-head">
        <div>
          <h1>Capital gains</h1>
          <p>
            Realised and unrealised gains kept apart, lot by lot, with an estimated tax. Estimates for learning, not tax advice.
          </p>
        </div>
        <div className="cx-tabs" role="group" aria-label="Financial year">
          {years.map((y) => (
            <button key={y} type="button" aria-pressed={fy === y} onClick={() => setFy(y)}>{fyLabel(y)}</button>
          ))}
          <button type="button" onClick={onBack}>← Portfolio</button>
        </div>
      </header>

      {!est.supported ? (
        <p className="cx-warn-note" role="status">{est.reason} No tax is estimated for this year.</p>
      ) : null}

      <div className="cx-cards" aria-label={`Capital gains ${fyLabel(fy)}`}>
        <div className="cx-card">
          <h3>Realised STCG</h3>
          <div className={`cx-v ${stcg > 0 ? "cx-up" : stcg < 0 ? "cx-down" : ""}`}>{signedInr(stcg, 0)}</div>
          <p>Short-term, {fyLabel(fy)}</p>
        </div>
        <div className="cx-card">
          <h3>Realised LTCG</h3>
          <div className={`cx-v ${ltcg > 0 ? "cx-up" : ltcg < 0 ? "cx-down" : ""}`}>{signedInr(ltcg, 0)}</div>
          <p>{months ? `Held more than ${months} months` : "Held past the long-term threshold"}</p>
        </div>
        <div className="cx-card">
          <h3>Unrealised gains</h3>
          <div className={`cx-v ${open.total > 0 ? "cx-up" : open.total < 0 ? "cx-down" : ""}`}>{signedInr(open.total, 0)}</div>
          <p>Not taxed until sold</p>
        </div>
        <div className="cx-card">
          <h3>
            Estimated tax
            <InfoTip label="About the estimated tax">
              An estimate, not what you owe. {est.headline}. {est.includesSurchargeCess ? "" : "Add your tax details below to include surcharge and cess."}
            </InfoTip>
          </h3>
          <div className="cx-v">{est.supported ? inr(est.total, 0) : "—"}</div>
          <p>{est.supported ? est.headline : "Not estimated"}</p>
        </div>
      </div>

      <div className="cx-block">
        <ConfidenceBadge confidence={year.confidence} />
        <EstimateNote />
        {est.supported && est.exemptionLimit > 0 ? (
          <p className="cx-quiet-text">
            Long-term exemption this year: {inr(est.exemptionApplied, 0)} of {inr(est.exemptionLimit, 0)} used, {inr(est.exemptionRoom, 0)} left. It is shared by all your long-term equity gains in the year, not given to each sale.
          </p>
        ) : null}
        {est.slabGainNotEstimated > 0 ? (
          <p className="cx-warn-note">{inr(est.slabGainNotEstimated, 0)} of gain is taxed at your slab rate. Set a slab rate below to price it.</p>
        ) : null}
      </div>

      <div className="cx-block">
        <details open>
          <summary>STCG: short-term gains by stock</summary>
          <GainList groups={groupBySymbol(shortRows)} kind="STCG" onPick={onPick} />
        </details>
        <details>
          <summary>LTCG: long-term gains by stock</summary>
          <GainList groups={groupBySymbol(longRows)} kind="LTCG" onPick={onPick} />
        </details>
      </div>

      <CostImpactLadder
        gross={year.gross}
        charges={year.charges}
        tax={est.supported ? est.total : null}
        taxBasis={est.headline}
        grossLabel={`Gross trading gains, ${fyLabel(fy)}`}
        footnote="Delivery equity trades only. Charges are counted once, in the realised result; the tax estimate starts from the gain after deductible charges, so they are not taken off twice. STT is not deductible, so it lowers your result but not your taxable gain."
      />

      <section className="cx-block" aria-label="Realised tax lots">
        <h3>Tax lots, realised</h3>
        {year.rows.length === 0 ? (
          <p className="cx-empty">No delivery sales in {fyLabel(fy)}. Buy and later sell a share for delivery and each lot sold appears here.</p>
        ) : (
          <div className="cx-table-wrap">
            <table className="cx-table">
              <thead>
                <tr>{["Stock", "Bought", "Qty sold", "Buy price", "Sold", "Sell price", "Held", "Class", "Gain", "Est. tax"].map((h) => <th key={h} scope="col">{h}</th>)}</tr>
              </thead>
              <tbody>
                {year.rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.name}</td>
                    <td>{day(r.openedOn)}</td>
                    <td>{r.qty}</td>
                    <td>{px(r.buyPrice)}</td>
                    <td>{day(r.closedOn)}</td>
                    <td>{px(r.sellPrice)}</td>
                    <td>{r.heldText}</td>
                    <td>{r.classification}</td>
                    <td className={r.gain >= 0 ? "cx-up" : "cx-down"}>{signedInr(r.gain)}</td>
                    <td>{inr(r.tax)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="cx-block" aria-label="Open tax lots">
        <h3>Open lots, unrealised</h3>
        {open.lots.length === 0 ? (
          <p className="cx-empty">No delivery positions are open.</p>
        ) : (
          <div className="cx-table-wrap">
            <table className="cx-table">
              <thead>
                <tr>{["Stock", "Bought", "Qty", "Buy price", "Last", "Held", "Class today", "Long-term from", "Gain"].map((h) => <th key={h} scope="col">{h}</th>)}</tr>
              </thead>
              <tbody>
                {open.lots.map((l) => (
                  <tr key={l.id}>
                    <td>{l.name}</td>
                    <td>{day(l.openedOn)}</td>
                    <td>{l.qty}</td>
                    <td>{px(l.buyPrice)}</td>
                    <td>{px(l.last)}</td>
                    <td>{l.heldText}</td>
                    <td>{l.term === "long" ? "LTCG" : "STCG"}</td>
                    <td>{l.longTermOn ? day(l.longTermOn) : "Now"}</td>
                    <td className={l.gain >= 0 ? "cx-up" : "cx-down"}>{signedInr(l.gain)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="cx-quiet-text">An unrealised gain is not a taxable event. Exit charges are not guessed; they are known only when you sell.</p>
      </section>

      {business.length > 0 || replay.length > 0 ? (
        <section className="cx-block" aria-label="Not capital gains">
          <h3>Not counted as capital gains</h3>
          <ul className="cx-glist plain">
            {business.length > 0 ? (
              <li>
                <strong>{business.length} intraday or F&amp;O trade{business.length === 1 ? "" : "s"}</strong> ({signedInr(business.reduce((s, e) => s + e.gain, 0), 0)} after charges): {business[0].reason}
              </li>
            ) : null}
            {replay.length > 0 ? <li><strong>{replay.length} replay-mode trade{replay.length === 1 ? "" : "s"}</strong>: {replay[0].reason}</li> : null}
          </ul>
        </section>
      ) : null}

      <section className="cx-block" aria-label="Assumptions">
        <h3>What this estimate leaves out</h3>
        <ul className="cx-glist plain">
          {est.notes.map((n) => <li key={n}>{n}</li>)}
        </ul>
      </section>

      <TaxProfileForm profile={profile} onChange={onProfile} />
      <CostDisclosure fy={fy} />
    </div>
  );
}
