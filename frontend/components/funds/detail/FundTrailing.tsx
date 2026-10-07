"use client";

import type { SeriesSet } from "@/lib/funds/analytics";
import { signedFrac } from "@/lib/funds/format";
import { trailing } from "@/lib/funds/viz";

const WINDOWS = [
  { years: 1, label: "1Y", suffix: "total" },
  { years: 3, label: "3Y", suffix: "a year" },
  { years: 5, label: "5Y", suffix: "a year" },
  { years: 10, label: "10Y", suffix: "a year" },
] as const;

const pretty = (label: string) => label.replace("NIFTY", "Nifty");

/** Trailing returns of the fund and its benchmark over the same windows; a window longer than the history is "Insufficient history". */
export function FundTrailing({ set }: { set: SeriesSet }) {
  const bench = set.benchmarks[0] ?? null;
  const shown = WINDOWS.filter((w) => w.years <= 5 || trailing(set.subject, w.years, set));
  return (
    <section className="vz-section" aria-label="Trailing returns">
      <h2 className="vz-h">Trailing returns</h2>
      <table className="vz-ptable">
        <thead>
          <tr>
            <th scope="col" />
            <th scope="col">Fund</th>
            <th scope="col">{bench ? pretty(bench.label) : "Benchmark"}</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((w) => {
            const mine = trailing(set.subject, w.years, set);
            const theirs = bench ? trailing(bench.points, w.years, set) : null;
            const cell = (r: ReturnType<typeof trailing>) => (r ? <span className={r.value >= 0 ? "bull" : "bear"}>{signedFrac(r.value)}</span> : <span className="vz-na">Insufficient history</span>);
            return (
              <tr key={w.label}>
                <th scope="row">
                  {w.label}
                  <small>{w.suffix}</small>
                </th>
                <td>{cell(mine)}</td>
                <td>{bench ? cell(theirs) : <span className="vz-na">Unavailable</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="vz-hint">Point to point on published NAV; the benchmark is a price index, so it leaves out dividends.</p>
    </section>
  );
}
