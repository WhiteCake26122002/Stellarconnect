"use client";

import type { SectorRow } from "@/lib/trading/analytics";
import { compactInr, weightPct } from "@/lib/trading/format";
import { EmptyState } from "./ui";

/**
 * Which sectors am I exposed to? Horizontal bars, longest first, cash included. The bars grow from zero with a 50ms
 * stagger when the section first appears; the figure beside each is the same number the bar shows.
 */
export function SectorExposure({ rows }: { rows: SectorRow[] }) {
  if (!rows.length) return <EmptyState title="No exposure yet" body="Sectors appear once you hold a position." />;
  const max = Math.max(...rows.map((r) => r.weight), 0.01);
  const unclassified = rows.find((r) => r.label === "Unclassified");
  return (
    <div className="pt-sectors">
      <ul aria-label="Sector breakdown">
        {rows.map((r, i) => (
          <li key={r.label} title={r.holdings.length ? r.holdings.join(", ") : undefined} className={r.label === "Cash" ? "cash" : undefined}>
            <span className="name">{r.label}</span>
            <span className="track" aria-hidden>
              <i style={{ transform: `scaleX(${r.weight / max})`, animationDelay: `${i * 50}ms` }} />
            </span>
            <b>{weightPct(r.weight, 0)}</b>
            <small className="pt-visually">{compactInr(r.value)}</small>
          </li>
        ))}
      </ul>
      {unclassified ? <p className="pt-fine">Some holdings have no sector from the data provider and are grouped as Unclassified.</p> : null}
    </div>
  );
}
