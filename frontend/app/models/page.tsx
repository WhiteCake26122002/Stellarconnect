"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { CompanyLogo } from "@/components/CompanyLogo";
import { ApiError, api, ModelListItem } from "@/lib/api";
import { initialsOf } from "@/lib/logo";
import { currencySymbol, perShare, relativeTime, signedPct } from "@/lib/format";

export default function ModelsPage() {
  const router = useRouter();
  const [me, setMe] = useState<{ display_name: string } | null>(null);
  const [items, setItems] = useState<ModelListItem[] | null>(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");

  useEffect(() => {
    api
      .me()
      .then((u) => {
        setMe(u);
        return api.listModels();
      })
      .then((data) => setItems(data.items))
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) router.replace("/login");
        else setError(err instanceof Error ? err.message : "Failed to load");
      });
  }, [router]);

  const filtered = useMemo(() => {
    if (!items) return [];
    const needle = q.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((m) => `${m.name} ${m.ticker || ""}`.toLowerCase().includes(needle));
  }, [items, q]);

  if (error) {
    return (
      <AppShell>
        <main id="main" className="shell">
          <div className="banner bad">{error}</div>
        </main>
      </AppShell>
    );
  }
  if (!items || !me) {
    return (
      <AppShell>
        <main id="main" className="shell" aria-busy="true">
          <div className="skel skel-line" style={{ width: "30%" }} />
          <div className="skel skel-block" />
          <p className="muted">Loading models…</p>
        </main>
      </AppShell>
    );
  }

  return (
    <AppShell name={me.display_name} models={items}>
      <main id="main" className="shell">
        <div className="page-head">
          <div>
            <h1>Models</h1>
            <p className="muted">Saved DCFs. Switch to paper trading or mutual funds from the header.</p>
          </div>
          <Link href="/models/new" className="btn">
            New model
          </Link>
        </div>
        {items.length === 0 ? (
          <div className="empty card">
            <h2>Nothing on the desk yet</h2>
            <p className="muted">Search a listed company, open the sample, or paste one year of statements.</p>
            <Link href="/models/new" className="btn">
              Create your first model
            </Link>
          </div>
        ) : (
          <>
            <label htmlFor="filter" className="muted">
              Filter
            </label>
            <input
              id="filter"
              className="filter"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Name or ticker"
            />
            <div className="card list">
              {filtered.length === 0 ? (
                <p className="muted">No model matches “{q}”.</p>
              ) : (
                filtered.map((m) => <ModelRow key={m.id} model={m} />)
              )}
            </div>
          </>
        )}
      </main>
    </AppShell>
  );
}

function ModelRow({ model: m }: { model: ModelListItem }) {
  const sym = currencySymbol(m.currency);
  const upside = m.upside;
  return (
    <Link href={`/models/${m.id}`} className="row">
      <div className="model-id">
        <CompanyLogo
          ticker={m.ticker}
          size={36}
          fallback={
            <span className="co-initials" style={{ width: 36, height: 36 }} aria-hidden>
              {initialsOf(m.name)}
            </span>
          }
        />
        <div>
          <strong>{m.name}</strong>
          <div className="model-meta">
            <span className="chip">{m.ticker || "manual"}</span>
            <span className="chip">{m.currency}</span>
            {m.integrity_band ? <span className="chip">{m.integrity_band}</span> : null}
            {m.valuation_error ? <span className="chip warn">Blocked</span> : null}
          </div>
          <div className="note">{relativeTime(m.updated_at)}</div>
        </div>
      </div>
      <div style={{ textAlign: "right" }}>
        <div style={{ fontFamily: "var(--font-mono)", fontWeight: 650 }}>
          {m.implied_share_price != null && m.implied_share_price < 0 ? "Below 0" : perShare(m.implied_share_price, sym)}
        </div>
        <div className={upside != null && upside >= 0 ? "ok" : "error"}>{signedPct(upside)}</div>
      </div>
    </Link>
  );
}
