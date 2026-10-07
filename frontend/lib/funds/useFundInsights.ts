"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type FundHolding, type FundInsights } from "@/lib/api";
import { useInvestorProfile } from "@/lib/funds/local";

export type TaxInfo = { slabRatePct: number | null; incomeBand: string | null; regime: string };
export type InsightsState = { data: FundInsights | null; error: string; loading: boolean };

/**
 * The insights for the current holdings and the investor profile kept in this browser. The Insights tab
 * and the portfolio's health score read the same response, so the two never disagree.
 */
export function useFundInsights(holdings: FundHolding[], taxProfile: TaxInfo) {
  const investor = useInvestorProfile();
  const profile = {
    ...investor,
    ...(taxProfile.slabRatePct != null ? { slab: String(taxProfile.slabRatePct) } : {}),
    ...(taxProfile.incomeBand ? { band: taxProfile.incomeBand } : {}),
    regime: taxProfile.regime,
  };
  const [state, setState] = useState<InsightsState>({ data: null, error: "", loading: true });
  const [attempt, setAttempt] = useState(0);
  const profileKey = JSON.stringify(profile);
  const holdingsKey = holdings.map((h) => `${h.scheme_code}:${h.units}`).join(",");
  const empty = holdings.length === 0;

  useEffect(() => {
    if (empty) return;
    const controller = new AbortController();
    setState((s) => ({ ...s, loading: true, error: "" }));
    api
      .fundInsights(profile, controller.signal)
      .then((data) => setState({ data, error: "", loading: false }))
      .catch((err) => {
        if (controller.signal.aborted) return;
        setState((s) => ({ ...s, loading: false, error: err instanceof Error ? err.message : "Could not build the insights." }));
      });
    return () => controller.abort();
    // profile is read through profileKey so an unrelated object identity change does not refetch
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileKey, holdingsKey, attempt, empty]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...state, investor, retry, empty };
}
