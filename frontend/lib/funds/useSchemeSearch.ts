"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ApiError, api, FundSchemeHit } from "@/lib/api";

export type SchemeSearch = {
  hits: FundSchemeHit[];
  /** True from the first keystroke until the matching response lands, so skeletons never lag the input. */
  pending: boolean;
  error: string;
  /** The query the current hits answer; "" when nothing has been searched. */
  answered: string;
};

const DEBOUNCE_MS = 280;

/** Debounced AMFI scheme-name search. Pass `skip` to pause (e.g. once a hit is picked). */
export function useSchemeSearch(query: string, { skip = false, limit }: { skip?: boolean; limit?: number } = {}): SchemeSearch {
  const router = useRouter();
  const [state, setState] = useState<Omit<SchemeSearch, "pending">>({ hits: [], error: "", answered: "" });
  const needle = query.trim();

  useEffect(() => {
    if (skip || needle.length < 2) {
      setState({ hits: [], error: "", answered: "" });
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      api
        .fundSchemes(needle, controller.signal, limit)
        .then((data) => setState({ hits: data.results, error: "", answered: needle }))
        .catch((err) => {
          if (controller.signal.aborted) return;
          if (err instanceof ApiError && err.status === 401) router.replace("/login");
          else setState({ hits: [], error: err instanceof Error ? err.message : "Search failed.", answered: needle });
        });
    }, DEBOUNCE_MS);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [needle, skip, limit, router]);

  return { ...state, pending: !skip && needle.length >= 2 && state.answered !== needle };
}
