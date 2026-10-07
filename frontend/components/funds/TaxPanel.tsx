"use client";

import { useCallback, useEffect, useState } from "react";
import "@/components/costs/cx.css";
import { InfoTip } from "@/components/costs/CostDisclosure";
import { api, type FundHolding, type FundPortfolio, type FundSchemeTax } from "@/lib/api";
import type { TaxProfile } from "@/lib/costs/tax";
import { useFundTax } from "@/lib/funds/useFundTax";
import { FundTaxCard } from "./FundTaxCard";
import { RedeemSheet } from "./RedeemSheet";
import { TaxSettings } from "./TaxSettings";

/**
 * How this fund is taxed and what it costs to leave: its class and the rules for it, the exit load the
 * user entered (or that none is known), the expense-ratio note, and, if it is held, each lot's term and an
 * estimate of the tax a redemption would bring, with a redemption preview.
 */
export function TaxPanel({
  code,
  holding,
  profile,
  onBook,
}: {
  code: number;
  name: string;
  holding: FundHolding | null;
  profile: TaxProfile;
  onBook: (b: FundPortfolio) => void;
}) {
  const [scheme, setScheme] = useState<FundSchemeTax | null>(null);
  const [error, setError] = useState("");
  const [redeeming, setRedeeming] = useState(false);
  const tax = useFundTax(profile, null, holding != null);
  const fund = tax.view?.funds.find((f) => f.scheme_code === code) ?? null;

  const load = useCallback(() => {
    const controller = new AbortController();
    api
      .fundSchemeTax(code, controller.signal)
      .then((s) => {
        setScheme(s);
        setError("");
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Could not load the tax rules.");
      });
    return () => controller.abort();
  }, [code]);
  useEffect(() => load(), [load]);

  const refresh = useCallback(() => {
    load();
    tax.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, tax.reload]);

  if (error) {
    return (
      <section className="card mf-panel mf-tax">
        <h2>Tax and exit load</h2>
        <p className="muted">{error}</p>
      </section>
    );
  }
  if (!scheme) {
    return (
      <section className="card mf-panel mf-tax" aria-busy="true">
        <h2>Tax and exit load</h2>
        <p className="muted">Loading the tax rules…</p>
      </section>
    );
  }

  const c = scheme.classification;
  return (
    <section className="card mf-panel mf-tax" aria-labelledby="mf-tax-t">
      <div className="mf-panel-head">
        <div>
          <h2 id="mf-tax-t">Tax and exit load</h2>
          <p className="mf-basis">Estimates for education, not tax advice. Rules for {scheme.rules.fy.replace("FY", "FY ")}.</p>
        </div>
        <span className="mf-tag" title={c.reason}>
          {c.label}
          {c.certainty === "depends" ? " · check scheme" : c.certainty === "override" ? " · set by you" : ""}
        </span>
      </div>

      <dl className="mf-tax-rules">
        <div>
          <dt>Short-term</dt>
          <dd>{scheme.rules.short_term}</dd>
        </div>
        <div>
          <dt>Long-term</dt>
          <dd>{scheme.rules.long_term}</dd>
        </div>
      </dl>
      <p className="mf-basis">{c.reason} {c.detail}</p>

      {holding ? (
        fund ? (
          <FundTaxCard fund={fund} onRedeem={() => setRedeeming(true)} />
        ) : (
          <p className="muted mf-empty-line" aria-busy={tax.busy}>{tax.busy ? "Working out your lots…" : tax.error || "No lots to show."}</p>
        )
      ) : (
        <p className="muted mf-empty-line">Add this fund to your portfolio to see each lot&apos;s holding period and an estimate of the tax a redemption would bring.</p>
      )}

      <div className="mf-tax-exit">
        <strong>
          Exit load
          <InfoTip label="About exit load">{scheme.exit_load.note}</InfoTip>
        </strong>
        <span className={scheme.exit_load.status === "entered" ? "" : "mf-nodata"}>{scheme.exit_load.text}{scheme.exit_load.source ? ` ${scheme.exit_load.source}.` : ""}</span>
        <p className="muted">Many schemes charge a percentage if you redeem within a set period, and the terms differ by scheme. They are set out in the scheme information document.</p>
      </div>

      <p className="cx-quiet-text">{scheme.expense_ratio_note}</p>

      <TaxSettings code={code} classification={c} exitTerms={scheme.exit_load.terms} onSaved={refresh} />
      <p className="cx-quiet-text">{scheme.disclosure}</p>

      {redeeming && holding ? (
        <RedeemSheet
          code={code}
          name={holding.scheme_name}
          held={holding.units}
          profile={profile}
          onClose={() => setRedeeming(false)}
          onDone={(next) => {
            setRedeeming(false);
            onBook(next);
            refresh();
          }}
        />
      ) : null}
    </section>
  );
}
