"use client";

import { useEffect, useId, useRef, useState } from "react";
import "./cx.css";
import { HISTORY_BASIS, IMPORTANT, NOT_ADVICE, chargeExplainers, sources, taxExplainers } from "@/lib/costs/explain";
import type { Confidence } from "@/lib/costs/tax";

/**
 * The educational disclosure, in the open rather than in small grey type: one visible paragraph and an
 * expandable "How are charges and taxes calculated?" with every rate read from the configuration.
 */
export function CostDisclosure({ fy, scope = "all", defaultOpen = false }: { fy?: string; scope?: "charges" | "tax" | "all"; defaultOpen?: boolean }) {
  const blocks = [...(scope !== "tax" ? chargeExplainers() : []), ...(scope !== "charges" ? taxExplainers(fy) : [])];
  return (
    <section className="cx-disclosure" aria-label="Important">
      <div className="cx-important">
        <strong>Important</strong>
        <p>{IMPORTANT}</p>
        <p>{NOT_ADVICE}</p>
      </div>
      <details open={defaultOpen}>
        <summary>How are charges and taxes calculated?</summary>
        <div className="cx-explain">
          {blocks.map((b) => (
            <div key={b.title}>
              <h4>{b.title}</h4>
              {b.body.map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </div>
          ))}
          <div>
            <h4>Where the rates come from</h4>
            <ul>
              {sources().map((s) => (
                <li key={s.id}>
                  <a href={s.url} target="_blank" rel="noreferrer noopener">{s.title}</a>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </details>
    </section>
  );
}

/** A small ⓘ that opens a short explanation beside the figure it belongs to. */
export function InfoTip({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span className="cx-tip" ref={ref}>
      <button type="button" className="cx-info" aria-label={label} aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        i
      </button>
      {open ? (
        <span id={id} role="note" className="cx-pop">
          {children}
        </span>
      ) : null}
    </span>
  );
}

/** High confidence / Estimated / Incomplete, with the share of the history it rests on. */
export function ConfidenceBadge({ confidence, compact = false }: { confidence: Pick<Confidence, "level" | "label" | "reasons" | "basis">; compact?: boolean }) {
  return (
    <div className={`cx-conf cx-conf-${confidence.level}`}>
      <span className="cx-conf-pill">{confidence.label}</span>
      {compact ? null : <p>{confidence.basis}</p>}
      {compact || confidence.reasons.length === 0 ? null : (
        <ul>
          {confidence.reasons.slice(0, 4).map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The sentence every estimate carries: it is an estimate, not what anyone owes. */
export function EstimateNote() {
  return <p className="cx-quiet-text">{HISTORY_BASIS}</p>;
}
