"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, FundHolding, FundSchemeHit } from "@/lib/api";
import { assetClass, categoryRisk, categoryShort, planType, samePlan } from "@/lib/funds/category";
import { signedPoints, tone } from "@/lib/funds/format";
import { GapNote } from "./FundAtoms";

export type FundSubject = { code: number; name: string; category: string; return1y: number | null };

type Peer = { h: FundHolding; reason: string; distance: number };

const COMPARABLE_1Y_PTS = 5;

function peersFor(subject: FundSubject, holdings: FundHolding[]): Peer[] {
  const risk = categoryRisk(subject.category, subject.name);
  const cls = assetClass(subject.category);
  const peers: Peer[] = [];
  for (const h of holdings) {
    if (h.scheme_code === subject.code || !h.data_available) continue;
    const sameCategory = h.scheme_category === subject.category;
    const sameRisk = risk != null && categoryRisk(h.scheme_category, h.scheme_name) === risk && assetClass(h.scheme_category) === cls;
    if (!sameCategory && !sameRisk) continue;
    const gap = subject.return1y != null && h.return_1y != null ? Math.abs(subject.return1y - h.return_1y) : null;
    const reasons = [sameCategory ? "Same category" : "Same risk band"];
    if (gap != null && gap <= COMPARABLE_1Y_PTS) reasons.push("comparable 1Y");
    peers.push({ h, reason: reasons.join(", "), distance: (sameCategory ? 0 : 100) + (gap ?? 50) });
  }
  return peers.sort((a, b) => a.distance - b.distance).slice(0, 4);
}

export function SimilarFunds({ subject, holdings, heading = "Similar funds" }: { subject: FundSubject; holdings: FundHolding[]; heading?: string }) {
  const peers = peersFor(subject, holdings);
  const keyword = categoryShort(subject.category);
  const canBrowse = keyword !== "Unknown category" && keyword.length >= 2;
  const [browse, setBrowse] = useState(false);
  const [hits, setHits] = useState<FundSchemeHit[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!browse || !canBrowse) return;
    const controller = new AbortController();
    setHits(null);
    setError("");
    // The endpoint is a capped substring match, so a bare category word mostly returns other plans of
    // one AMC. Asking for the plan wording too surfaces more schemes that survive the plan filter.
    const plan = planType(subject.name).plan;
    const queries = [`${keyword} Fund - ${plan}`, keyword].map((q) => q.slice(0, 80));
    Promise.all(queries.map((q) => api.fundSchemes(q, controller.signal, 25)))
      .then((pages) => {
        const held = new Set(holdings.map((h) => h.scheme_code));
        const seen = new Set<number>();
        const merged = pages.flatMap((p) => p.results).filter((hit) => !seen.has(hit.code) && seen.add(hit.code));
        setHits(merged.filter((hit) => hit.code !== subject.code && !held.has(hit.code) && samePlan(subject.name, hit.name)).slice(0, 6));
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Search failed.");
      });
    return () => controller.abort();
  }, [browse, canBrowse, keyword, holdings, subject.code, subject.name]);

  return (
    <div className="mf-similar">
      <h3>{heading}</h3>
      <div className="mf-similar-cols">
        <div>
          <h4>In your portfolio</h4>
          {peers.length ? (
            <ul className="mf-peer-list">
              {peers.map(({ h, reason }) => (
                <li key={h.scheme_code}>
                  <Link href={`/funds/${h.scheme_code}`}>{h.scheme_name}</Link>
                  <span className="muted">
                    {categoryShort(h.scheme_category)} · {reason}
                  </span>
                  <b className={tone(h.return_1y)}>1Y {signedPoints(h.return_1y, 1)}</b>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No other holding shares this category or risk band.</p>
          )}
        </div>
        <div>
          <h4>Other {canBrowse ? keyword : ""} schemes</h4>
          {!canBrowse ? (
            <p className="muted">The category is unknown, so there is nothing to search on.</p>
          ) : !browse ? (
            <button type="button" className="btn secondary small" onClick={() => setBrowse(true)}>
              Search AMFI for “{keyword}”
            </button>
          ) : error ? (
            <p className="error">{error}</p>
          ) : hits == null ? (
            <ul className="mf-peer-list" aria-busy="true" aria-label="Searching scheme names">
              {[0, 1, 2].map((i) => (
                <li key={i} aria-hidden="true">
                  <span className="skel skel-line" style={{ width: `${80 - i * 15}%` }} />
                </li>
              ))}
            </ul>
          ) : hits.length === 0 ? (
            <p className="muted">No other schemes with “{keyword}” in the name on the same plan.</p>
          ) : (
            <ul className="mf-peer-list">
              {hits.map((hit) => (
                <li key={hit.code}>
                  <Link href={`/funds/${hit.code}`}>{hit.name}</Link>
                  <span className="muted">Scheme {hit.code}</span>
                </li>
              ))}
            </ul>
          )}
          {browse ? <GapNote gaps={["screener"]}>Matched on scheme name, not screened on risk or return.</GapNote> : null}
        </div>
      </div>
    </div>
  );
}
