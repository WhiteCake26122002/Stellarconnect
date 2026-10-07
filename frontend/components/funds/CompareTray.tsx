"use client";

import Link from "next/link";
import { ReactNode, useEffect, useRef, useState } from "react";
import type { FundAnalysis, FundHolding } from "@/lib/api";
import { categoryRisk, categoryShort, planType } from "@/lib/funds/category";
import { rupees, signedPoints, tone } from "@/lib/funds/format";
import { benchView, pts, returnView, spanText, VERDICT_LABEL, verdictTone } from "@/lib/funds/returns";
import { GapNote, RiskMeter } from "./FundAtoms";

export const MAX_COMPARE = 4;

type Cell = { text: ReactNode; value?: number | null };
type CompareRow = { label: string; cells: Cell[]; best?: "max" | "min" };

export function CompareTray({
  holdings,
  selected,
  analysis,
  total,
  colorOf,
  onToggle,
  onClear,
}: {
  holdings: FundHolding[];
  selected: number[];
  analysis: FundAnalysis | null;
  total: number;
  colorOf: (code: number) => string;
  onToggle: (code: number) => void;
  onClear: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const chosen = selected.map((code) => holdings.find((h) => h.scheme_code === code)).filter((h): h is FundHolding => !!h);

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  useEffect(() => {
    if (chosen.length < 2) setOpen(false);
  }, [chosen.length]);

  if (!chosen.length) return null;

  const perfByCode = new Map((analysis?.funds ?? []).map((f) => [f.scheme_code, f]));
  const perf = (h: FundHolding) => perfByCode.get(h.scheme_code);
  const blocked = analysis?.blocked ?? [];
  const ret = (h: FundHolding) => returnView(perf(h), blocked);
  const bench = (h: FundHolding) => benchView(perf(h));
  const pct = (v: number | null): Cell => ({ text: <span className={tone(v)}>{signedPoints(v)}</span>, value: v });
  const rows: CompareRow[] = [
    { label: "Category", cells: chosen.map((h) => ({ text: categoryShort(h.scheme_category) })) },
    { label: "Fund house", cells: chosen.map((h) => ({ text: h.fund_house })) },
    {
      label: "Plan",
      cells: chosen.map((h) => {
        const p = planType(h.scheme_name);
        return { text: [p.plan, p.option].filter(Boolean).join(" · ") };
      }),
    },
    { label: "Risk (estimated)", cells: chosen.map((h) => ({ text: <RiskMeter level={categoryRisk(h.scheme_category, h.scheme_name)} /> })) },
    { label: "1Y return", best: "max", cells: chosen.map((h) => pct(h.return_1y)) },
    {
      label: "Return since purchase",
      best: "max",
      cells: chosen.map((h) => {
        const r = ret(h);
        return { text: <span className={tone(r.value)}>{signedPoints(r.value)}<small className="muted"> {r.annualized ? "XIRR, annualized" : `over ${spanText(perf(h)?.days_held ?? 0)}`}</small></span>, value: r.value };
      }),
    },
    {
      label: "Own benchmark",
      cells: chosen.map((h) => {
        const b = bench(h);
        return { text: b.available ? <span>{b.label}{b.proxy ? " (proxy)" : ""} {signedPoints(b.value)}</span> : <span className="muted">Unavailable</span> };
      }),
    },
    {
      label: "Versus benchmark",
      best: "max",
      cells: chosen.map((h) => {
        const p = perf(h);
        const v = bench(h).available ? (p?.relative_pp ?? null) : null;
        return {
          text: <span className={verdictTone(p?.verdict ?? "unavailable")}>{v == null ? "n/a" : pts(v)}<small className="muted"> {p ? VERDICT_LABEL[p.verdict] : ""}</small></span>,
          value: v,
        };
      }),
    },
    { label: "Since you bought", best: "max", cells: chosen.map((h) => pct(h.gain_pct)) },
    { label: "Weight in book", cells: chosen.map((h) => ({ text: total > 0 ? `${((h.value / total) * 100).toFixed(1)}%` : "n/a" })) },
    {
      label: "Latest NAV",
      cells: chosen.map((h) => ({
        text: (
          <>
            {h.current_nav == null ? "n/a" : rupees(h.current_nav, 4)}
            {h.nav_date ? <small className="muted"> {h.nav_date}</small> : null}
          </>
        ),
      })),
    },
  ];

  function bestIndex(row: CompareRow): number {
    if (!row.best) return -1;
    let idx = -1;
    row.cells.forEach((c, i) => {
      if (c.value == null) return;
      if (idx < 0 || (row.best === "max" ? c.value > (row.cells[idx].value as number) : c.value < (row.cells[idx].value as number))) idx = i;
    });
    const counted = row.cells.filter((c) => c.value != null).length;
    return counted >= 2 ? idx : -1;
  }

  return (
    <>
      <div className="mf-tray" role="region" aria-label="Comparison tray">
        <span className="mf-tray-count">
          {chosen.length}/{MAX_COMPARE} selected
        </span>
        <ul className="mf-tray-list">
          {chosen.map((h) => (
            <li key={h.scheme_code}>
              <i style={{ background: colorOf(h.scheme_code) }} aria-hidden />
              <span>{h.scheme_name}</span>
              <button type="button" aria-label={`Remove ${h.scheme_name} from comparison`} onClick={() => onToggle(h.scheme_code)}>
                ×
              </button>
            </li>
          ))}
        </ul>
        <div className="mf-tray-actions">
          <button type="button" className="btn secondary small" onClick={onClear}>
            Clear
          </button>
          <button
            ref={opener}
            type="button"
            className="btn small"
            disabled={chosen.length < 2}
            title={chosen.length < 2 ? "Pick at least two funds" : undefined}
            onClick={() => setOpen(true)}
          >
            Compare {chosen.length > 1 ? chosen.length : ""}
          </button>
        </div>
      </div>
      <dialog
        ref={dialog}
        className="mf-dialog"
        aria-labelledby="mf-compare-title"
        onClose={() => {
          setOpen(false);
          opener.current?.focus();
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) setOpen(false);
        }}
      >
        <div className="mf-dialog-body">
          <div className="mf-dialog-head">
            <h2 id="mf-compare-title">Side by side</h2>
            <button type="button" className="ico-btn mf-close" aria-label="Close comparison" onClick={() => setOpen(false)}>
              ×
            </button>
          </div>
          <div className="mf-compare-wrap">
            <table className="mf-compare">
              <thead>
                <tr>
                  <td />
                  {chosen.map((h) => (
                    <th key={h.scheme_code} scope="col">
                      <i style={{ background: colorOf(h.scheme_code) }} aria-hidden />
                      <Link href={`/funds/${h.scheme_code}`}>{h.scheme_name}</Link>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const best = bestIndex(row);
                  return (
                    <tr key={row.label}>
                      <th scope="row">{row.label}</th>
                      {row.cells.map((c, i) => (
                        <td key={chosen[i].scheme_code} className={i === best ? "mf-best" : ""}>
                          {c.text}
                          {i === best ? <span className="visually-hidden"> (highest)</span> : null}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <GapNote gaps={["nav-history", "expense-ratio", "rating"]}>Volatility, Sharpe, max drawdown, expense ratio and rating are not compared yet.</GapNote>
        </div>
      </dialog>
    </>
  );
}
