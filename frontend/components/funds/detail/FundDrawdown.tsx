"use client";

import { useMemo } from "react";
import { maxDrawdown, type SeriesSet } from "@/lib/funds/analytics";
import { longDate, monthYear, signedFrac } from "@/lib/funds/format";
import { drawdownSeries } from "@/lib/funds/viz";
import { LinesChart } from "../viz/LinesChart";
import { TipRow } from "../viz/Tip";
import { VIZ } from "../viz/theme";

/** How far the NAV sat below its previous high at every point, with the deepest fall named in words. */
export function FundDrawdown({ set, title = "Drawdown" }: { set: SeriesSet; title?: string }) {
  const dd = useMemo(() => drawdownSeries(set.subject), [set]);
  const worst = useMemo(() => maxDrawdown(set.subject), [set]);
  return (
    <section className="vz-section" aria-label={title}>
      <h2 className="vz-h">{title}</h2>
      <p className="vz-sub">
        {worst && worst.depth < 0 ? (
          <>
            Deepest fall <b className="bear">{signedFrac(worst.depth)}</b>: peak {longDate(worst.peak)}, bottom {longDate(worst.trough)},{" "}
            {worst.recovered ? `back at the old high by ${longDate(worst.recovered)}` : "not yet back at the old high"}
          </>
        ) : (
          "No fall from a previous high in this history"
        )}
      </p>
      <LinesChart
        series={[{ id: "dd", label: "Below peak", color: VIZ.red, points: dd.map((d) => ({ t: d.t, v: d.dd })), area: true, width: 1.6 }]}
        height={170}
        drawdown
        yFormat={(v) => `${(v * 100).toFixed(0)}%`}
        xFormat={monthYear}
        title={(t) => longDate(t)}
        ariaLabel="Drawdown over time"
        rows={(_, values) => <TipRow color={VIZ.red} label="Below peak" value={values.dd == null ? "n/a" : signedFrac(values.dd)} />}
      />
      <p className="vz-hint">Measured on weekly NAV marks, so a one-day dip inside a week can be deeper than shown.</p>
    </section>
  );
}
