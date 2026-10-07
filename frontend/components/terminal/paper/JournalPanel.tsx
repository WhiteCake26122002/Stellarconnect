"use client";

import { useMemo } from "react";
import { calculateJournalStats, normalizeEntry, type JournalEntry, type ThesisVerdict } from "@/lib/trading/analytics";
import { pct, px, signedInr, weightPct } from "@/lib/trading/format";
import type { Trade } from "@/lib/trading/types";
import { findSymbol } from "@/lib/trading/universe";
import { EmptyState } from "./ui";

const VERDICTS: { id: ThesisVerdict; label: string }[] = [
  { id: "yes", label: "Yes" },
  { id: "partly", label: "Partly" },
  { id: "no", label: "No" },
];

/**
 * A trading journal: the reason for a trade, what was expected, what happened and what was learned. The thesis score
 * is the trader's own answer to "did it play out?", never inferred from whether the trade made money.
 */
export function JournalPanel({
  trades,
  journals,
  selectedId,
  onSelect,
  onEntry,
}: {
  trades: Trade[];
  journals: Record<string, JournalEntry | string>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onEntry: (id: string, entry: JournalEntry) => void;
}) {
  const stats = useMemo(() => calculateJournalStats(trades, journals), [trades, journals]);
  const selected = trades.find((t) => t.id === selectedId) ?? trades[0] ?? null;
  if (!selected) {
    return <EmptyState title="No closed trades yet" body="After you sell, a journal opens here so you can write why you bought, what you expected and what you learned." />;
  }
  const entry = normalizeEntry(journals[selected.id]);
  const set = (patch: Partial<JournalEntry>) => onEntry(selected.id, { ...entry, ...patch });
  const info = findSymbol(selected.symbol);
  return (
    <div className="pt-journal">
      <dl className="pt-kv journal-stats" aria-label="Journal summary">
        <div>
          <dt>Total trades</dt>
          <dd>{stats.totalTrades}</dd>
        </div>
        <div>
          <dt>Trades with thesis</dt>
          <dd>{stats.withThesis}</dd>
        </div>
        <div>
          <dt>Thesis played out</dt>
          <dd>{stats.played}</dd>
        </div>
        <div>
          <dt>Success rate</dt>
          <dd title={stats.judged ? `${stats.played} of ${stats.judged} judged` : "Mark whether a thesis played out to see this"}>{stats.successRate == null ? "—" : weightPct(stats.successRate, 0)}</dd>
        </div>
      </dl>
      <div className="journal-grid">
        <ul className="journal-list" aria-label="Closed trades">
          {trades.map((t) => (
            <li key={t.id}>
              <button type="button" className={t.id === selected.id ? "on" : ""} onClick={() => onSelect(t.id)}>
                <span>{findSymbol(t.symbol).symbol}</span>
                <b className={t.pnl >= 0 ? "up" : "down"}>{signedInr(t.pnl, 0)}</b>
              </button>
            </li>
          ))}
        </ul>
        <div className="journal-editor">
          <p className="journal-meta">
            {info.name} · {px(selected.entry)} → {px(selected.exit)} · {selected.qty} {selected.qty === 1 ? "share" : "shares"} · {signedInr(selected.pnl)} ({pct(selected.returnPct)}) after charges
          </p>
          <label>
            Why did I buy?
            <textarea rows={2} value={entry.why} onChange={(e) => set({ why: e.target.value })} placeholder="The reason, in a sentence" />
          </label>
          <label>
            Expected outcome
            <textarea rows={2} value={entry.expected} onChange={(e) => set({ expected: e.target.value })} placeholder="What I thought would happen" />
          </label>
          <label>
            What actually happened?
            <textarea rows={2} value={entry.actual} onChange={(e) => set({ actual: e.target.value })} />
          </label>
          <label>
            What did I learn?
            <textarea aria-label="Trade journal note" rows={2} value={entry.learned} onChange={(e) => set({ learned: e.target.value })} />
          </label>
          <fieldset className="pt-verdict" disabled={!entry.why.trim()}>
            <legend>Did the thesis play out?</legend>
            {VERDICTS.map((v) => (
              <button key={v.id} type="button" aria-pressed={entry.verdict === v.id} onClick={() => set({ verdict: entry.verdict === v.id ? undefined : v.id })}>
                {v.label}
              </button>
            ))}
            {!entry.why.trim() ? <small>Write your reason first.</small> : null}
          </fieldset>
        </div>
      </div>
    </div>
  );
}
