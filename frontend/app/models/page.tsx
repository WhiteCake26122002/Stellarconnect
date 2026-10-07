"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { CSSProperties, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { DeskHero } from "@/components/desk/DeskHero";
import { Scene } from "@/components/home/cinema/Scenes";
import { ModuleLoader, useLoaderHold } from "@/components/ModuleLoader";
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
  const [sort, setSort] = useState<"recent" | "upside" | "name">("recent");
  const held = useLoaderHold(!!items && !!me);

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
    const rows = needle ? items.filter((m) => `${m.name} ${m.ticker || ""}`.toLowerCase().includes(needle)) : [...items];
    if (sort === "name") rows.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === "upside") rows.sort((a, b) => (b.upside ?? -Infinity) - (a.upside ?? -Infinity));
    return rows;
  }, [items, q, sort]);

  if (error) {
    return (
      <AppShell>
        <main id="main" className="shell">
          <div className="banner bad">{error}</div>
        </main>
      </AppShell>
    );
  }
  if (!items || !me || !held) {
    return (
      <AppShell>
        <main id="main" className="shell" aria-busy="true">
          <ModuleLoader kind="dcf" />
        </main>
      </AppShell>
    );
  }

  return (
    <AppShell name={me.display_name} models={items}>
      <main id="main" className="shell">
        <DeskHero
          n="02"
          kicker="Valuation"
          echo="Saved"
          title="Models"
          lead="Saved DCFs. Switch to paper trading or mutual funds from the header."
          stats={
            items.length
              ? [
                  { k: "Models", v: String(items.length) },
                  { k: "Implied above price", v: `${items.filter((m) => (m.upside ?? 0) > 0).length} of ${items.length}` },
                  { k: "Last edited", v: relativeTime(items[0].updated_at) },
                ]
              : undefined
          }
          scene="dcf"
          sceneLabel="Cash flows stepping up to an implied value"
          actions={
            <Link href="/models/new" className="dk-pill">
              New model
            </Link>
          }
        />
        {items.length === 0 ? (
          <div className="dk-empty">
            <Scene id="dcf" label="" />
            <h2>Nothing on the desk yet</h2>
            <p className="muted">Search a listed company, open the sample, or paste one year of statements.</p>
            <Link href="/models/new" className="dk-pill">
              Create your first model
            </Link>
          </div>
        ) : (
          <>
            <div className="dk-find">
              <label htmlFor="filter">Filter</label>
              <input id="filter" className="filter" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or ticker" />
              <div className="dk-sort" role="group" aria-label="Sort models">
                {([["recent", "Recent"], ["upside", "Upside"], ["name", "Name"]] as const).map(([id, label]) => (
                  <button key={id} type="button" aria-pressed={sort === id} onClick={() => setSort(id)}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="card list dk-list">
              {filtered.length === 0 ? (
                <p className="muted">No model matches “{q}”.</p>
              ) : (
                filtered.map((m, i) => <ModelRow key={m.id} model={m} index={i} />)
              )}
            </div>
          </>
        )}
      </main>
    </AppShell>
  );
}

function ModelRow({ model: m, index }: { model: ModelListItem; index: number }) {
  const sym = currencySymbol(m.currency);
  const upside = m.upside;
  return (
    <Link href={`/models/${m.id}`} className="row dk-in" style={{ "--k": index } as CSSProperties}>
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
      <div style={{ textAlign: "right", display: "grid", justifyItems: "end", gap: 4 }}>
        <div style={{ fontFamily: "var(--font-mono)", fontWeight: 650 }}>
          {m.implied_share_price != null && m.implied_share_price < 0 ? "Below 0" : perShare(m.implied_share_price, sym)}
        </div>
        <div className="dk-up">
          <div className={upside != null && upside >= 0 ? "ok" : "error"}>{signedPct(upside)}</div>
          {upside != null ? (
            <span className="dk-bar" aria-hidden>
              <i className={upside >= 0 ? "pos" : "neg"} style={{ width: `${Math.min(50, (Math.abs(upside) / 0.6) * 50)}%` }} />
            </span>
          ) : null}
        </div>
      </div>
    </Link>
  );
}
