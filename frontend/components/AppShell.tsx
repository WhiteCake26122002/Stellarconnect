"use client";

import "../app/dcf.css";
import "../app/guide.css";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ApiError, ModelListItem, api } from "@/lib/api";
import { initials } from "@/lib/format";
import { useViewMode } from "@/lib/prefs";
import { AppSwitch } from "@/components/AppSwitch";
import { ConnectLogo } from "@/components/ConnectLogo";

export type ShellSurface =
  | "dashboard"
  | "financials"
  | "historical"
  | "forecast"
  | "dcf"
  | "scenarios"
  | "sensitivity"
  | "assumptions"
  | "quality"
  | "export";

export const WORKSPACE_TABS: { id: ShellSurface; label: string; hint: string }[] = [
  { id: "dashboard", label: "Dashboard", hint: "The answer: what one share is worth." },
  { id: "financials", label: "Financials", hint: "The company's reported numbers." },
  { id: "historical", label: "Historical Analysis", hint: "How the business did in past years." },
  { id: "forecast", label: "Forecast", hint: "The year-by-year guess at the future." },
  { id: "dcf", label: "DCF", hint: "The valuation math." },
  { id: "scenarios", label: "Scenarios", hint: "Pessimistic, middle and optimistic outcomes." },
  { id: "sensitivity", label: "Sensitivity", hint: "What if my assumptions were different?" },
  { id: "assumptions", label: "Assumptions", hint: "The inputs you can change." },
  { id: "quality", label: "Model Quality", hint: "How far to trust this result." },
  { id: "export", label: "Export", hint: "Download to Excel or PDF." },
];

export function AppShell({
  children,
  name,
  models: _models,
  activeModelId,
  surface,
  onSurface,
  alerts,
  onTour,
}: {
  children: React.ReactNode;
  name?: string;
  models?: ModelListItem[];
  activeModelId?: string;
  surface?: ShellSurface;
  onSurface?: (s: ShellSurface) => void;
  alerts?: string[];
  onTour?: () => void;
}) {
  const router = useRouter();
  const [menu, setMenu] = useState(false);
  const [me, setMe] = useState(name || "");
  const [hint, setHint] = useState<{ text: string; left: number; top: number } | null>(null);
  const mode = useViewMode();
  const simple = mode === "simple";
  const hintBase = useId();
  const inModel = Boolean(activeModelId);

  function showHint(text: string, el: HTMLElement) {
    if (!simple) return;
    const r = el.getBoundingClientRect();
    setHint({ text, left: Math.min(Math.max(8, r.left + r.width / 2), window.innerWidth - 8), top: r.bottom + 6 });
  }

  useEffect(() => {
    if (name) setMe(name);
  }, [name]);

  useEffect(() => {
    if (name) return;
    api
      .me()
      .then((u) => setMe(u.display_name))
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) router.replace("/login");
      });
  }, [name, router]);

  useEffect(() => {
    if (!menu) return;
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") setMenu(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu]);

  function goTab(id: ShellSurface, index: number, e?: KeyboardEvent<HTMLElement>) {
    if (e) {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      e.preventDefault();
      const dir = e.key === "ArrowRight" ? 1 : -1;
      const next = (index + dir + WORKSPACE_TABS.length) % WORKSPACE_TABS.length;
      onSurface?.(WORKSPACE_TABS[next].id);
      const root = e.currentTarget.closest("[role=tablist]") as HTMLElement | null;
      root?.querySelectorAll<HTMLButtonElement>("[role=tab]")[next]?.focus();
      return;
    }
    if (inModel && onSurface) onSurface(id);
    else if (inModel) router.push(`/models/${activeModelId}`);
    else router.push("/models");
    setMenu(false);
  }

  return (
    <div className="desk">
      {/* suppressHydrationWarning in the header: browser tooling adds data-* refs to these controls before hydration. */}
      <header className="masthead">
        <button
          type="button"
          className="btn ghost small menu-btn"
          aria-expanded={menu}
          aria-controls="workspace-tabs"
          onClick={() => setMenu((v) => !v)}
          suppressHydrationWarning
        >
          Menu
        </button>
        <Link className="brand-mark" href="/" aria-label="Connect home" suppressHydrationWarning>
          <ConnectLogo size="md" />
        </Link>
        {inModel ? (
          <nav
            id="workspace-tabs"
            className={`mast-tabs ${menu ? "open" : ""}`}
            role="tablist"
            aria-label="Workspace"
          >
            {WORKSPACE_TABS.map((item, i) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                className={`tab ${surface === item.id ? "active" : ""}`}
                aria-selected={surface === item.id}
                aria-describedby={simple ? `${hintBase}-${item.id}` : undefined}
                data-tour={`tab-${item.id}`}
                tabIndex={surface === item.id ? 0 : -1}
                onClick={() => goTab(item.id, i)}
                onKeyDown={(e) => goTab(item.id, i, e)}
                onMouseEnter={(e) => showHint(item.hint, e.currentTarget)}
                onMouseLeave={() => setHint(null)}
                onFocus={(e) => showHint(item.hint, e.currentTarget)}
                onBlur={() => setHint(null)}
              >
                {item.label}
              </button>
            ))}
          </nav>
        ) : (
          <div className="mast-tabs" aria-hidden="true" />
        )}
        <div className="mast-tools">
          {inModel && onTour ? <HelpMenu onTour={onTour} /> : null}
          <AppSwitch current="dcf" />
          <GlobalSearch />
          <AlertsBell items={alerts || []} />
          <UserMenu name={me} />
        </div>
      </header>
      {children}
      {menu ? <button type="button" className="scrim" aria-label="Close menu" onClick={() => setMenu(false)} /> : null}
      {inModel && simple ? (
        <div className="visually-hidden">
          {WORKSPACE_TABS.map((item) => (
            <span key={item.id} id={`${hintBase}-${item.id}`}>
              {item.hint}
            </span>
          ))}
        </div>
      ) : null}
      {hint && simple
        ? createPortal(
            <div className="tab-hint" role="presentation" style={{ left: hint.left, top: hint.top }}>
              {hint.text}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

function HelpMenu({ onTour }: { onTour: () => void }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div className="user-menu" ref={wrap}>
      <button
        type="button"
        className="ico-btn help-btn"
        aria-expanded={open}
        aria-controls="help-pop"
        aria-label="Help"
        onClick={() => setOpen((v) => !v)}
      >
        ?
      </button>
      {open ? (
        <div className="popover help-pop" id="help-pop" role="menu" aria-label="Help">
          <p>
            <strong>Help</strong>
          </p>
          <button
            type="button"
            role="menuitem"
            className="help-item"
            onClick={() => {
              setOpen(false);
              onTour();
            }}
          >
            Take the tour
            <span>Five stops: what a DCF is, where the answer lives, Bear/Base/Bull, and where to change inputs.</span>
          </button>
          <p className="note">
            Simple mode puts a (?) next to finance terms. Click it for a one-line definition.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function GlobalSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<{ symbol: string; name: string; exchange: string }[]>([]);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    const needle = q.trim();
    if (needle.length < 2) {
      setHits([]);
      return;
    }
    const t = window.setTimeout(async () => {
      try {
        const data = await api.searchCompanies(needle);
        setHits(data.results);
        setOpen(true);
        setErr("");
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) router.replace("/login");
        else setErr(e instanceof Error ? e.message : "Search failed");
      }
    }, 280);
    return () => window.clearTimeout(t);
  }, [q, router]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  async function create(symbol: string) {
    setPending(true);
    setErr("");
    try {
      const model = await api.createModel({ source: "ticker", ticker: symbol });
      router.push(`/models/${model.id}`);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not fetch that company.");
      setPending(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (hits[0]) void create(hits[0].symbol);
  }

  return (
    <div className="global-search" ref={box}>
      <form onSubmit={onSubmit}>
        <label className="visually-hidden" htmlFor="global-search" suppressHydrationWarning>
          Search ticker
        </label>
        <svg className="search-ico" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path d="M11 11l3 3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        <input
          id="global-search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => hits.length && setOpen(true)}
          placeholder="Search ticker..."
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          disabled={pending}
          suppressHydrationWarning
        />
      </form>
      {open && (hits.length > 0 || err) ? (
        <ul id={listId} className="search-pop" role="listbox">
          {err ? <li className="error">{err}</li> : null}
          {hits.map((h) => (
            <li key={h.symbol}>
              <button type="button" disabled={pending} onClick={() => create(h.symbol)}>
                <strong>{h.name}</strong>
                <span>
                  {h.symbol} · {h.exchange || "listed"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function AlertsBell({ items }: { items: string[] }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, []);
  return (
    <div className="user-menu" ref={wrap}>
      <button
        type="button"
        className="ico-btn"
        aria-expanded={open}
        aria-controls="alerts-pop"
        aria-label={items.length ? `${items.length} alerts` : "Alerts"}
        onClick={() => setOpen((v) => !v)}
        suppressHydrationWarning
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M8 2a4 4 0 00-4 4v2.2L2.6 11h10.8L12 8.2V6a4 4 0 00-4-4zM6.5 13a1.5 1.5 0 003 0" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        {items.length ? <span className="dot" /> : null}
      </button>
      {open ? (
        <div className="popover" id="alerts-pop" role="dialog" aria-label="Alerts">
          {items.length ? (
            items.map((a) => (
              <p key={a} className="note">
                {a}
              </p>
            ))
          ) : (
            <p className="note">No alerts. The live feed is quiet.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function UserMenu({ name }: { name: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, []);
  return (
    <div className="user-menu" ref={wrap}>
      <button
        type="button"
        className="ico-btn"
        aria-expanded={open}
        aria-label="Account"
        onClick={() => setOpen((v) => !v)}
        suppressHydrationWarning
      >
        <span className="avatar" aria-hidden="true">
          {initials(name || "Analyst")}
        </span>
      </button>
      {open ? (
        <div className="popover" role="menu">
          <p>
            <strong>{name || "Analyst"}</strong>
          </p>
          <p className="note">Not investment advice.</p>
          <button
            type="button"
            className="btn secondary small"
            style={{ marginTop: "0.55rem", width: "100%" }}
            onClick={async () => {
              await api.logout();
              router.push("/login");
            }}
          >
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}

