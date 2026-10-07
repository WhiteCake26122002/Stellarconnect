"use client";

import Link from "next/link";
import { useState } from "react";
import "@/components/costs/cx.css";
import { ConfidenceBadge, CostDisclosure, EstimateNote, InfoTip } from "@/components/costs/CostDisclosure";
import { CostImpactLadder } from "@/components/costs/CostImpactLadder";
import { TaxProfileForm } from "@/components/costs/TaxProfileForm";
import type { FundPortfolio, FundTaxFund, FundTaxView } from "@/lib/api";
import type { TaxProfile } from "@/lib/costs/tax";
import { useFundTax } from "@/lib/funds/useFundTax";
import { inr, signedInr } from "@/lib/trading/format";
import { EmptyState } from "./FundAtoms";
import { FundTaxCard } from "./FundTaxCard";
import { RedeemSheet } from "./RedeemSheet";
import { GainsByTerm, LotTimeline, NetBridge } from "./TaxVisuals";

const day = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
const tone = (n: number) => (n > 0 ? "cx-up" : n < 0 ? "cx-down" : "");

/** Tax and costs for the fund account: realised against unrealised, per fund, per lot, with the confidence of each estimate. */
export function TaxCostsPane({
  book,
  profile,
  onProfile,
  onBook,
}: {
  book: FundPortfolio;
  profile: TaxProfile;
  onProfile: (p: TaxProfile) => void;
  onBook: (b: FundPortfolio) => void;
}) {
  const [fy, setFy] = useState<string | null>(null);
  const [redeem, setRedeem] = useState<FundTaxFund | null>(null);
  const tax = useFundTax(profile, fy);
  const v = tax.view;

  if (book.holdings.length === 0 && !v?.realized.items.length) {
    return (
      <EmptyState art="portfolio" title="Tax and costs appear once you hold a fund">
        <p className="muted">
          Add a fund, with the date of each purchase or a monthly SIP, and every lot gets its own holding period, an estimated tax if you redeemed it, and the costs on the way in and out.
        </p>
      </EmptyState>
    );
  }
  if (!v) {
    return (
      <div className="funds-analysis" aria-busy="true">
        <div className="page-head">
          <div>
            <h1>Tax &amp; costs</h1>
            <p className="muted">{tax.error || "Working out the tax view…"}</p>
          </div>
        </div>
      </div>
    );
  }

  const r = v.realized;
  const est = r.estimate;
  return (
    <div className="funds-analysis">
      <div className="page-head">
        <div>
          <h1>Tax &amp; costs</h1>
          <p className="muted">
            Estimated for {v.fy_label}. Gains are worked out lot by lot under the rules for that financial year. {v.disclosure.split(". ").slice(-2).join(". ")}
          </p>
        </div>
      </div>

      <div className="cx-tabs" role="group" aria-label="Financial year">
        {v.years.map((y) => (
          <button key={y.fy} type="button" aria-pressed={v.fy === y.fy} onClick={() => setFy(y.fy)}>{y.label}</button>
        ))}
      </div>

      {!est.supported ? <p className="cx-warn-note" role="status">{est.reason} No tax is estimated for this year.</p> : null}

      <div className="cx-cards" aria-label={`Realised gains ${v.fy_label}`}>
        <div className="cx-card">
          <h3>Realised gains</h3>
          <div className={`cx-v ${tone(r.gain)}`}>{signedInr(r.gain, 0)}</div>
          <p>After set-off, {v.fy_label}</p>
        </div>
        <div className="cx-card">
          <h3>STCG</h3>
          <div className={`cx-v ${tone(r.stcg)}`}>{inr(r.stcg, 0)}</div>
          <p>Short-term, net</p>
        </div>
        <div className="cx-card">
          <h3>LTCG</h3>
          <div className={`cx-v ${tone(r.ltcg)}`}>{inr(r.ltcg, 0)}</div>
          <p>Long-term, net</p>
        </div>
        <div className="cx-card">
          <h3>
            Estimated tax
            <InfoTip label="About the estimated tax">An estimate on gains already realised, not a bill. {est.headline}. Actual liability depends on your complete tax position.</InfoTip>
          </h3>
          <div className="cx-v">{est.supported ? inr(est.total, 0) : "—"}</div>
          <p>{est.supported ? est.headline : "Not estimated"}</p>
        </div>
        <div className="cx-card">
          <h3>Unrealised gains</h3>
          <div className={`cx-v ${tone(v.unrealized.gain)}`}>{signedInr(v.unrealized.gain, 0)}</div>
          <p>Not taxed until redeemed</p>
        </div>
      </div>

      <div className="vz-split even">
        <GainsByTerm view={v} />
        <NetBridge view={v} />
      </div>

      <div className="cx-block">
        <ConfidenceBadge confidence={r.confidence} />
        <EstimateNote />
        {est.supported && est.exemption_limit > 0 ? (
          <p className="cx-quiet-text">
            Long-term equity exemption in {v.fy_label}: {inr(est.exemption_applied, 0)} of {inr(est.exemption_limit, 0)} used, {inr(est.exemption_room, 0)} left. It is applied once to the year&apos;s long-term equity gains, not to each redemption.
          </p>
        ) : null}
        {est.slab_gain_not_estimated > 0 ? (
          <p className="cx-warn-note">{inr(est.slab_gain_not_estimated, 0)} of gain is taxed at your slab rate. Set a slab rate below to price it.</p>
        ) : null}
      </div>

      <section className="cx-block" aria-label="Tax on redemption">
        <h3>If everything were redeemed today</h3>
        <div className="cx-cards">
          <div className="cx-card">
            <h3>Potential tax exposure on redemption</h3>
            <div className="cx-v">{v.unrealized.potential_tax == null ? "—" : inr(v.unrealized.potential_tax, 0)}</div>
            <p>{v.unrealized.potential_tax_basis}, on top of gains already realised this year</p>
          </div>
          <div className="cx-card">
            <h3>Short-term / long-term gain</h3>
            <div className="cx-v">{signedInr(v.unrealized.short_term_gain, 0)} / {signedInr(v.unrealized.long_term_gain, 0)}</div>
            <p>By lot, as of today</p>
          </div>
        </div>
        <ConfidenceBadge confidence={v.unrealized.confidence} />
        <p className="cx-quiet-text">This estimate assumes the currently selected tax classification and available transaction history. {v.unrealized.note}</p>
      </section>

      <CostImpactLadder
        gross={r.gross}
        charges={r.charges}
        tax={est.supported ? est.total : null}
        taxBasis={est.headline}
        grossLabel={`Gross gains on redemptions, ${v.fy_label}`}
        footnote="Redemption costs (exit load and STT) come out of the proceeds once. The tax estimate starts from the gain after the exit load; STT is not deductible. The expense ratio is already in the NAV and is not taken off again."
      />

      <section className="cx-block" aria-label="Costs">
        <h3>What fund transactions cost in {v.fy_label}</h3>
        <dl className="cx-ladder">
          <div className="cx-row"><dt>Stamp duty on purchases <small>taken out of the amount invested, so it lowers the units allotted</small></dt><dd>{inr(r.costs.stamp_duty)}</dd></div>
          <div className="cx-row"><dt>STT on redemptions <small>equity-oriented units only</small></dt><dd>{inr(r.costs.stt)}</dd></div>
          <div className="cx-row"><dt>Exit load <small>only where you entered the scheme&apos;s terms</small></dt><dd>{inr(r.costs.exit_load)}</dd></div>
        </dl>
        <ul className="cx-glist plain">
          <li>{v.cost_notes.expense_ratio}</li>
          <li>{v.cost_notes.distributor_charge}</li>
          <li>{v.cost_notes.stamp_duty}</li>
        </ul>
      </section>

      <section className="cx-block" aria-label="Funds">
        <h3>Each fund</h3>
        <div className="cx-fundgrid">
          {v.funds.map((f) => (
            <FundTaxCard
              key={f.scheme_code}
              fund={f}
              onRedeem={() => setRedeem(f)}
              onOpen={undefined}
            />
          ))}
        </div>
        <p className="cx-quiet-text">
          Choose a different tax class or enter an exit load on the fund&apos;s own page, under Tax and exit load.{" "}
          {v.funds.map((f) => (
            <Link key={f.scheme_code} href={`/funds/${f.scheme_code}`} className="cx-inline">{f.scheme_name.split(" - ")[0]}</Link>
          )).reduce<React.ReactNode[]>((acc, el, i) => (i ? [...acc, " · ", el] : [el]), [])}
        </p>
      </section>

      <LotTimeline funds={v.funds} />

      <section className="cx-block" aria-label="Realised redemptions">
        <h3>Redemptions in {v.fy_label}, lot by lot</h3>
        {r.items.length === 0 ? (
          <p className="cx-empty">No redemptions in {v.fy_label}.</p>
        ) : (
          <div className="cx-table-wrap">
            <table className="cx-table">
              <thead>
                <tr>{["Fund", "Bought", "Redeemed", "Units", "Held", "Class", "Exit load", "STT", "Gain", "Est. tax"].map((h) => <th key={h} scope="col">{h}</th>)}</tr>
              </thead>
              <tbody>
                {r.items.map((i) => (
                  <tr key={i.id}>
                    <td>{i.label}</td>
                    <td>{day(i.opened_on)}</td>
                    <td>{day(i.closed_on)}</td>
                    <td>{i.units.toLocaleString("en-IN", { maximumFractionDigits: 3 })}</td>
                    <td>{i.held_text}</td>
                    <td>{i.deemed_short_term ? "Short-term (deemed)" : i.term === "long" ? "Long-term" : "Short-term"}</td>
                    <td>{inr(i.exit_load)}</td>
                    <td>{inr(i.stt)}</td>
                    <td className={tone(i.gain)}>{signedInr(i.gain)}</td>
                    <td>{inr(i.tax)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="cx-block" aria-label="What this estimate leaves out">
        <h3>What this estimate leaves out</h3>
        <ul className="cx-glist plain">
          {est.notes.map((n) => <li key={n}>{n}</li>)}
        </ul>
      </section>

      <TaxProfileForm profile={profile} onChange={onProfile} />
      <CostDisclosure fy={v.fy} scope="tax" />

      {redeem ? (
        <RedeemSheet
          code={redeem.scheme_code}
          name={redeem.scheme_name}
          held={redeem.lots.reduce((s, l) => s + l.units, 0)}
          profile={profile}
          onClose={() => setRedeem(null)}
          onDone={(next) => {
            setRedeem(null);
            onBook(next);
            tax.reload();
          }}
        />
      ) : null}
    </div>
  );
}

/** A short tax-efficiency block for the Analysis page, from the same tax view. */
export function TaxEfficiencySection({ view }: { view: FundTaxView }) {
  const r = view.realized;
  const u = view.unrealized;
  return (
    <section className="card mf-panel" aria-labelledby="mf-taxeff-t">
      <div className="mf-panel-head">
        <div>
          <h2 id="mf-taxeff-t">Tax efficiency</h2>
          <p className="mf-basis">Estimated for {view.fy_label}. {view.history_note}</p>
        </div>
      </div>
      <div className="cx-cards">
        <div className="cx-card"><h3>Estimated realised gains</h3><div className={`cx-v ${tone(r.gain)}`}>{signedInr(r.gain, 0)}</div></div>
        <div className="cx-card"><h3>STCG</h3><div className={`cx-v ${tone(r.stcg)}`}>{inr(r.stcg, 0)}</div></div>
        <div className="cx-card"><h3>LTCG</h3><div className={`cx-v ${tone(r.ltcg)}`}>{inr(r.ltcg, 0)}</div></div>
        <div className="cx-card"><h3>Potential tax exposure on redemption</h3><div className="cx-v">{u.potential_tax == null ? "—" : inr(u.potential_tax, 0)}</div></div>
      </div>
      <ConfidenceBadge confidence={u.confidence} />
      <p className="cx-quiet-text">This estimate assumes the currently selected tax classification and available transaction history. {view.disclosure}</p>
    </section>
  );
}
