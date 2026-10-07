"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppShell, WORKSPACE_TABS, type ShellSurface } from "@/components/AppShell";
import { Heatmap } from "@/components/charts";
import { CompanyLogo } from "@/components/CompanyLogo";
import { DriverDrawer } from "@/components/DriverDrawer";
import { ModuleLoader, useLoaderHold } from "@/components/ModuleLoader";
import { DataCheckNotice } from "@/components/guide/DataCheckNotice";
import { Term } from "@/components/guide/Glossary";
import { GuidedTour } from "@/components/guide/GuidedTour";
import { ViewModeToggle } from "@/components/guide/ViewModeToggle";
import { Build, Dashboard, DcfView, ExportPanel, Historical, Scenarios, Sources, Statements, TwoWaySensitivity, useFlash, type WhatIfBase } from "@/components/workspace";
import { ApiError, Workspace, api } from "@/lib/api";
import { currencySymbol, fyLong, perShare, relativeTime } from "@/lib/format";
import { initialsOf } from "@/lib/logo";
import { bridgeOf, needsStatementRefresh, fundamentalsSource } from "@/lib/model";
import { withViewTransition } from "@/lib/motion";
import { useSimple, useTourDone } from "@/lib/prefs";

export default function ModelWorkspacePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [model, setModel] = useState<Workspace | null>(null);
  const held = useLoaderHold(!!model);
  const [error, setError] = useState("");
  const [surface, setSurface] = useState<ShellSurface>("dashboard");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [highlight, setHighlight] = useState<string | null>(null);
  const [flagHighlight, setFlagHighlight] = useState<string | null>(null);
  const [tour, setTour] = useState(false);
  const tourDone = useTourDone();
  const simple = useSimple();
  const timer = useRef<number | null>(null);
  const pending = useRef<Record<string, unknown>>({});
  const repaired = useRef<string | null>(null);
  const whatIfBase = useRef<WhatIfBase | null>(null);

  useEffect(() => {
    let gone = false;
    api
      .me()
      .then(() => api.getModel(id))
      .then((next) => {
        if (!gone) setModel(next);
      })
      .catch((err) => {
        if (gone) return;
        if (err instanceof ApiError && err.status === 401) router.replace("/login");
        else setError(err instanceof Error ? err.message : "Failed to load");
      });
    return () => {
      gone = true;
    };
  }, [id, router]);

  async function refreshStatements() {
    if (!model?.ticker) return;
    setBusy(true);
    try {
      const next = await api.refreshIngest(model.id);
      setModel(next);
      setError("");
      const src = next.statement_source || fundamentalsSource(next);
      setToast(
        src === "screener"
          ? "Statements refreshed from Screener.in"
          : src === "yahoo"
            ? "Statements refreshed from Yahoo"
            : "Statements refreshed",
      );
      window.setTimeout(() => setToast(""), 1800);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not refresh statements");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!model || model.source !== "ticker" || !needsStatementRefresh(model)) return;
    if (repaired.current === model.id) return;
    repaired.current = model.id;
    void refreshStatements();
  }, [model]);

  function patch(partial: Record<string, unknown>) {
    if (!model) return;
    pending.current = { ...pending.current, ...partial };
    setBusy(true);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      const body = pending.current;
      pending.current = {};
      try {
        const next = await api.patchAssumptions(model.id, body);
        setModel(next);
        setError("");
        setToast("Assumptions saved");
        window.setTimeout(() => setToast(""), 1800);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Recalc failed");
      } finally {
        setBusy(false);
      }
    }, 300);
  }

  function changeSurface(next: ShellSurface) {
    withViewTransition(() => setSurface(next));
  }

  function openSurface(next: ShellSurface, driver?: string) {
    changeSurface(next);
    if (driver) {
      setHighlight(driver);
      window.setTimeout(() => document.getElementById(`driver-${driver}`)?.scrollIntoView({ block: "center" }), 80);
      window.setTimeout(() => setHighlight(null), 1600);
    }
  }

  function showFlag(code: string) {
    changeSurface("quality");
    setFlagHighlight(code);
    window.setTimeout(() => document.getElementById(`flag-${code}`)?.scrollIntoView({ block: "center" }), 80);
    window.setTimeout(() => setFlagHighlight(null), 2400);
  }

  const endTour = useCallback(() => setTour(false), []);

  function startTour() {
    changeSurface("dashboard");
    setTour(false);
    window.setTimeout(() => setTour(true), 120);
  }

  const modelReady = Boolean(model);
  useEffect(() => {
    if (!modelReady || tourDone !== false) return;
    const t = window.setTimeout(() => setTour(true), 700);
    return () => window.clearTimeout(t);
  }, [modelReady, tourDone]);

  if (error && !model) {
    return (
      <AppShell>
        <main id="main" className="shell">
          <div className="banner bad">{error}</div>
          <Link href="/models">Back to models</Link>
        </main>
      </AppShell>
    );
  }
  if (!model || !held) {
    return (
      <AppShell>
        <main id="main" className="shell" aria-busy="true">
          <ModuleLoader kind="dcf" />
        </main>
      </AppShell>
    );
  }

  const alerts = [...(model.ingest_warnings || []), ...(model.valuation_error ? [model.valuation_error] : [])];

  return (
    <AppShell
      activeModelId={model.id}
      surface={surface}
      onSurface={changeSurface}
      alerts={alerts}
      onTour={startTour}
    >
      <main id="main" className="shell wide">
        <CompanyHero
          model={model}
          busy={busy}
          onRefresh={model.source === "ticker" && model.ticker ? refreshStatements : undefined}
          refreshNote={
            model.source === "manual"
              ? "Manual models don't auto-refresh — edit Financials directly."
              : undefined
          }
        />
        {error ? <div className="banner bad">{error}</div> : null}
        {model.valuation_error ? <div className="banner bad">{model.valuation_error}</div> : null}
        {model.ingest_warnings?.map((w) => (
          <div className="banner warn" key={w}>
            {w}
          </div>
        ))}

        <div id="surface-panel" role="tabpanel">
          {simple ? <SurfaceIntro surface={surface} /> : null}
          {surface === "dashboard" && (
            <Dashboard model={model} onOpen={openSurface} whatIf={{ busy, base: whatIfBase, onPatch: patch }} />
          )}
          {surface === "financials" && (
            <Statements
              model={model}
              saving={busy}
              onSaveHistoricals={async (body) => {
                setBusy(true);
                try {
                  const next = await api.patchHistoricals(model.id, body);
                  setModel(next);
                  setError("");
                  setToast("Financials saved");
                  window.setTimeout(() => setToast(""), 1800);
                } catch (err) {
                  setError(err instanceof ApiError ? err.message : "Could not save financials");
                } finally {
                  setBusy(false);
                }
              }}
            />
          )}
          {surface === "historical" && <Historical model={model} onOpen={openSurface} />}
          {surface === "forecast" && (
            <Build key={model.forecast.years.map((y) => y.period).join()} model={model} onOverride={(year_overrides) => patch({ year_overrides })} />
          )}
          {surface === "dcf" && <DcfView model={model} onApplyGrowth={(terminal_growth) => patch({ terminal_growth })} onOpen={openSurface} />}
          {surface === "scenarios" && (
            <Scenarios
              model={model}
              onApplyGrowth={(terminal_growth) => patch({ terminal_growth })}
              onPick={() => changeSurface("dashboard")}
              onFocusDriver={(key, nextSurface) => {
                if (nextSurface) changeSurface(nextSurface);
                else openSurface("assumptions", key);
              }}
            />
          )}
          {surface === "sensitivity" && (
            <div className="grid">
              <div className="card">
                <Heatmap model={model} onApplyGrowth={(terminal_growth) => patch({ terminal_growth })} bare />
              </div>
              <TwoWaySensitivity model={model} against="margin" onPatch={patch} />
              <TwoWaySensitivity model={model} against="wacc" onPatch={patch} />
            </div>
          )}
          {surface === "assumptions" && (
            <DriverDrawer
              drivers={model.drivers}
              onChange={patch}
              highlight={highlight}
              page
              modelId={model.id}
              onWorkspace={(next) => {
                setModel(next);
                setError("");
              }}
            />
          )}
          {surface === "quality" && <Sources model={model} highlight={flagHighlight} />}
          {surface === "export" && <ExportPanel model={model} />}
        </div>
      </main>
      <DataCheckNotice
        model={model}
        onShowFlag={showFlag}
        onShowInput={openSurface}
        onHidden={() => {
          setToast("Notice hidden. The flags are still listed in Model Quality.");
          window.setTimeout(() => setToast(""), 3200);
        }}
      />
      <GuidedTour run={tour} onEnd={endTour} />
      {toast ? (
        <div className="toast" role="status">
          {toast}
        </div>
      ) : null}
    </AppShell>
  );
}

function SurfaceIntro({ surface }: { surface: ShellSurface }) {
  const tab = WORKSPACE_TABS.find((t) => t.id === surface);
  if (!tab) return null;
  return (
    <p className="surface-intro">
      <b>{tab.label}</b>
      <span>{tab.hint}</span>
    </p>
  );
}

function CompanyHero({
  model,
  busy,
  onRefresh,
  refreshNote,
}: {
  model: Workspace;
  busy: boolean;
  onRefresh?: () => void;
  refreshNote?: string;
}) {
  const industry = String(model.company.industry || "");
  const hist = model.historicals.income_statements;
  const fwd = model.forecast.years;
  const histSpan = hist.length ? `${fyLong(String(hist[0].period))}–${fyLong(String(hist[hist.length - 1].period))} Historical` : "";
  const fwdSpan = fwd.length ? `${fyLong(String(fwd[0].period))}–${fyLong(String(fwd[fwd.length - 1].period))} Forecast` : "";
  const source = fundamentalsSource(model);
  const connected = Boolean(model.ticker && bridgeOf(model).current_share_price);
  const bridge = bridgeOf(model);
  const sym = currencySymbol(model.display.currency);
  const simple = useSimple();
  useFlash(busy ? "busy" : "idle");

  return (
    <section className="company-hero" aria-busy={busy}>
      <div className="hero-top">
        <div>
          <div className="hero-meta">
            <CompanyLogo
              website={String(model.company.website || "")}
              ticker={model.ticker}
              size={40}
              fallback={
                <span className="co-initials" style={{ width: 40, height: 40 }} aria-hidden>
                  {initialsOf(model.name)}
                </span>
              }
            />
            <h1>{model.name}</h1>
            {model.ticker ? <span className="chip">{model.ticker}</span> : <span className="chip">manual</span>}
            {industry ? <span className="chip sector">{industry}</span> : null}
            <span className="chip exch">{model.display.is_india ? "NSE India" : model.display.country || model.display.currency}</span>
            {source === "screener" ? <span className="chip source">Screener</span> : null}
            {source === "yahoo" ? <span className="chip source">Yahoo</span> : null}
            <ViewModeToggle />
          </div>
          <p className="hero-sub">
            {simple ? (
              <>
                <Term id="dcf">DCF Valuation</Term> &amp; Financial Analysis | Currency: {model.display.currency}
              </>
            ) : (
              <>DCF Valuation &amp; Financial Analysis | Currency: {model.display.currency}</>
            )}
            {histSpan ? ` | ${histSpan}` : ""}
            {fwdSpan ? ` | ${fwdSpan}` : ""}
            {source === "screener"
              ? " | Statements: Screener.in (refresh after results)"
              : source === "yahoo"
                ? " | Statements: Yahoo Finance"
                : ""}
          </p>
        </div>
        <div className="hero-status">
          <div className={`connected ${connected ? "" : "off"}`}>
            <i />
            {busy ? "Updating" : connected ? "Connected" : "Manual"}
          </div>
          {onRefresh ? (
            <button type="button" className="btn ghost small" onClick={onRefresh} disabled={busy}>
              Refresh statements
            </button>
          ) : refreshNote ? (
            <p className="note">{refreshNote}</p>
          ) : null}
          <p className="note">{relativeTime(model.updated_at)}</p>
        </div>
      </div>
      <div className="hero-price" aria-label="Current market price">
        <span>Current market price</span>
        <b>{perShare(bridge.current_share_price, sym)}</b>
      </div>
    </section>
  );
}
