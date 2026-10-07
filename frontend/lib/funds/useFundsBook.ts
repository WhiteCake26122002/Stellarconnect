"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, api, FundAnalysis, FundPortfolio } from "@/lib/api";
import { SeriesSet, seriesFromPerformance } from "@/lib/funds/analytics";
import { setFundsOwner } from "@/lib/funds/local";

export type AnalysisState = { report: FundAnalysis | null; busy: boolean; error: string };

export type FundsBook = {
  name: string;
  /** The signed-in account's id, for things kept in the browser per account. */
  userId: string | null;
  book: FundPortfolio | null;
  error: string;
  analysis: AnalysisState;
  /** Time-weighted portfolio index vs benchmarks, when the analysis has a usable value path. */
  series: SeriesSet | null;
  /** Swap in a portfolio returned by a mutation and re-run the analysis. */
  replaceBook: (next: FundPortfolio) => void;
};

export function useFundsBook(): FundsBook {
  const router = useRouter();
  const [name, setName] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const [book, setBook] = useState<FundPortfolio | null>(null);
  const [error, setError] = useState("");
  // The analysis does not depend on the portfolio response, so it starts with the first request instead of after it.
  const [tick, setTick] = useState(1);
  const [analysis, setAnalysis] = useState<AnalysisState>({ report: null, busy: false, error: "" });

  useEffect(() => {
    const controller = new AbortController();
    // Who you are and what you hold are independent, so they travel together.
    Promise.all([api.me(), api.fundPortfolio(controller.signal)])
      .then(([user, portfolio]) => {
        setName(user.display_name);
        setUserId(user.id);
        setFundsOwner(user.id);
        setBook(portfolio);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        if (err instanceof ApiError && err.status === 401) router.replace("/login");
        else setError(err instanceof Error ? err.message : "Could not open mutual funds.");
      });
    return () => controller.abort();
  }, [router]);

  useEffect(() => {
    const controller = new AbortController();
    setAnalysis((a) => ({ ...a, busy: true, error: "" }));
    api
      .fundAnalysis(controller.signal)
      .then((report) => setAnalysis({ report, busy: false, error: "" }))
      .catch((err) => {
        if (controller.signal.aborted) return;
        if (err instanceof ApiError && err.status === 401) router.replace("/login");
        else setAnalysis((a) => ({ ...a, busy: false, error: err instanceof Error ? err.message : "Could not build the analysis." }));
      });
    return () => controller.abort();
  }, [tick, router]);

  const series = useMemo(() => {
    const report = analysis.report;
    if (!report?.ready || !book || report.blocked?.includes("performance")) return null;
    return seriesFromPerformance(report.performance);
  }, [analysis.report, book]);

  const replaceBook = useCallback((next: FundPortfolio) => {
    setBook(next);
    setTick((n) => n + 1);
  }, []);

  return { name, userId, book, error, analysis, series, replaceBook };
}
