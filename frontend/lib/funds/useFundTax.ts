"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, api, type FundTaxView } from "@/lib/api";
import { profileParams } from "@/lib/costs/profile";
import type { TaxProfile } from "@/lib/costs/tax";

export type FundTaxState = { view: FundTaxView | null; busy: boolean; error: string; reload: () => void };

/**
 * The tax view of the fund account for a financial year under the investor's tax details. Reloads when
 * either changes, and on demand after a purchase or a redemption.
 */
export function useFundTax(profile: TaxProfile, fy: string | null, enabled = true): FundTaxState {
  const [view, setView] = useState<FundTaxView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  const key = JSON.stringify([profile.slabRatePct, profile.incomeBand, profile.regime, fy]);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setBusy(true);
    setError("");
    const params = profileParams(profile);
    if (fy) params.fy = fy;
    api
      .fundTax(params, controller.signal)
      .then((v) => {
        setView(v);
        setBusy(false);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setBusy(false);
        if (err instanceof ApiError && err.status === 401) return;
        setError(err instanceof Error ? err.message : "Could not work out the tax view.");
      });
    return () => controller.abort();
    // `key` stands for the profile and the year
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick, enabled]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { view, busy, error, reload };
}
