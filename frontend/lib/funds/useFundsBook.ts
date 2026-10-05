"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, api, FundAnalysis, FundPortfolio } from "@/lib/api";
import { SeriesSet, seriesFromGrowth } from "@/lib/funds/analytics";
import { setFundsOwner } from "@/lib/funds/local";

export type AnalysisState = { report: FundAnalysis | null; busy: boolean; error: string };

export type FundsBook = {
  name: string;
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
  const [book, setBook] = useState<FundPortfolio | null>(null);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  const [analysis, setAnalysis] = useState<AnalysisState>({ report: null, busy: false, error: "" });

  useEffect(() => {
    const controller = new AbortController();
    api
      .me()
      .then((user) => {
        setName(user.display_name);
        setFundsOwner(user.id);
        return api.fundPortfolio(controller.signal);
      })
      .then((portfolio) => {
        setBook(portfolio);
        setTick((n) => n + 1);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        if (err instanceof ApiError && err.status === 401) router.replace("/login");
        else setError(err instanceof Error ? err.message : "Could not open mutual funds.");
      });
    return () => controller.abort();
  }, [router]);

  useEffect(() => {
    if (tick === 0) return;
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
    if (!report?.ready || !book) return null;
    const dates = book.holdings.filter((h) => h.data_available).map((h) => h.purchase_date);
    return seriesFromGrowth(report.growth, dates);
  }, [analysis.report, book]);

  const replaceBook = useCallback((next: FundPortfolio) => {
    setBook(next);
    setTick((n) => n + 1);
  }, []);

  return { name, book, error, analysis, series, replaceBook };
}
