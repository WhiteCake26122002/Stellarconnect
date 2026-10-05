"use client";

import { useEffect, useState } from "react";
import { api, type MarketFinancials, type StatementTable } from "@/lib/api";
import { compactMoney, ratioText } from "@/lib/trading/format";
import { findSymbol } from "@/lib/trading/universe";

function hasStatement(table: StatementTable | undefined) {
  return Boolean(table?.columns?.length);
}

function Statement({ title, table, currency }: { title: string; table: StatementTable; currency: string }) {
  if (!table.columns.length) return <p className="empty-compact">{title}: Yahoo did not return this statement.</p>;
  return (
    <section className="fin-stmt">
      <h3>{title}</h3>
      <div className="fin-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Line</th>
              {table.columns.map((col) => (
                <th key={col}>{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row) => (
              <tr key={row.id}>
                <th scope="row">{row.label}</th>
                {row.values.map((value, i) => (
                  <td key={`${row.id}-${i}`}>{value == null ? "—" : compactMoney(value, currency)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function FinancialsPane({ symbol, onClose }: { symbol: string; onClose: () => void }) {
  const info = findSymbol(symbol);
  const [data, setData] = useState<MarketFinancials | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let gone = false;
    const ac = new AbortController();
    const timer = window.setTimeout(() => ac.abort(), 45_000);
    setLoading(true);
    setError(null);
    setData(null);
    api
      .marketFinancials(symbol, ac.signal)
      .then((payload) => {
        if (!gone) setData(payload);
      })
      .catch((err: { message?: string; name?: string }) => {
        if (gone) return;
        setError(err?.name === "AbortError" ? "Yahoo took too long. Try again." : err?.message || "Could not read financials.");
      })
      .finally(() => {
        if (!gone) setLoading(false);
      });
    return () => {
      gone = true;
      ac.abort();
      window.clearTimeout(timer);
    };
  }, [symbol, tick]);

  const ready = Boolean(
    data && (data.live || hasStatement(data.income) || hasStatement(data.balance) || hasStatement(data.cashflow) || data.ratios.some((row) => row.value != null)),
  );

  return (
    <div className="term-overlay" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="term-modal wide fin-modal" role="dialog" aria-label="Financials">
        <header>
          <h2>Financials · {data?.name || info.name}</h2>
          <button type="button" className="term-ico" aria-label="Close" onClick={onClose}>×</button>
        </header>
        <div className="body fin-body">
          {loading ? <p className="empty-compact">Reading Yahoo statements…</p> : null}
          {error ? (
            <p className="empty-compact">
              {error}{" "}
              <button type="button" className="btn ghost" onClick={() => setTick((n) => n + 1)}>
                Retry
              </button>
            </p>
          ) : null}
          {!loading && data && !ready ? (
            <p className="empty-compact">
              {data.message || "Yahoo has no financials for this symbol."}{" "}
              <button type="button" className="btn ghost" onClick={() => setTick((n) => n + 1)}>
                Retry
              </button>
            </p>
          ) : null}
          {!loading && ready && data ? (
            <>
              <section className="fin-ratios" aria-label="Key ratios">
                {data.ratios.map((row) => (
                  <div key={row.id}>
                    <span>{row.label}</span>
                    <strong>{ratioText(row.value, row.format, data.currency)}</strong>
                  </div>
                ))}
              </section>
              <Statement title="Profit & loss" table={data.income} currency={data.currency} />
              <Statement title="Balance sheet" table={data.balance} currency={data.currency} />
              <Statement title="Cash flow" table={data.cashflow} currency={data.currency} />
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
