"use client";

import { useState } from "react";
import type { Health } from "@/lib/funds/viz";
import { Gauge } from "../viz/Gauge";
import { HBars, type BarRow } from "../viz/HBars";
import { InfoSheet } from "../viz/InfoSheet";
import { VIZ } from "../viz/theme";

const barColor = (score: number) => (score >= 65 ? VIZ.teal : score >= 50 ? VIZ.gold : VIZ.red);

/** One score, five stated parts. Click the gauge for the rule behind each part, and for what is missing. */
export function HealthPanel({ health, pending }: { health: Health; pending?: boolean }) {
  const [open, setOpen] = useState(false);
  const rows: BarRow[] = health.parts.map((p) => ({
    id: p.id,
    label: p.label,
    sub: p.score == null ? p.detail : undefined,
    value: p.score ?? 0,
    valueText: p.score == null ? "—" : String(p.score),
    color: p.score == null ? VIZ.grey : barColor(p.score),
    tip: p.score != null ? [{ label: "Measured", value: p.detail }] : undefined,
  }));
  return (
    <section className="vz-section" aria-label="Portfolio health">
      <div className="vz-h-row">
        <h2 className="vz-h">Portfolio health</h2>
        <button type="button" className="vz-link" onClick={() => setOpen(true)}>
          How is this calculated?
        </button>
      </div>
      <div className="vz-health">
        <Gauge score={health.score} band={health.band} size={210} onClick={() => setOpen(true)} />
        <div className="vz-health-parts">
          <HBars rows={rows} max={100} dense ariaLabel="Parts of the health score" />
        </div>
      </div>
      <p className="vz-hint">
        {health.score == null
          ? "Unavailable: none of the five measures can be worked out yet."
          : `Average of the ${health.used} of 5 measures that can be worked out${pending ? " so far" : ""}; the others are shown as unavailable rather than guessed.`}
      </p>
      {open ? (
        <InfoSheet title="How the health score is calculated" onClose={() => setOpen(false)}>
          <p className="cx-note">
            Five plain measures, each scored 0 to 100. The score is their average, over only the measures that have data. It describes how the portfolio is built; it is not a forecast and not advice.
          </p>
          <ul className="vz-how">
            {health.parts.map((p) => (
              <li key={p.id}>
                <div className="vz-how-head">
                  <strong>{p.label}</strong>
                  <b className={p.score == null ? "na" : ""}>{p.score == null ? "Unavailable" : `${p.score} / 100`}</b>
                </div>
                <p>{p.score == null ? p.missing : p.detail}</p>
                {p.how ? <p className="vz-how-rule">{p.how}</p> : null}
              </li>
            ))}
          </ul>
          <p className="cx-note">Bands: 80 and above Strong, 65 to 79 Good, 50 to 64 Fair, below 50 Needs attention.</p>
        </InfoSheet>
      ) : null}
    </section>
  );
}
