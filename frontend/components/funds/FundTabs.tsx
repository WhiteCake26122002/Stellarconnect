"use client";

import { KeyboardEvent, ReactNode, useCallback, useEffect, useState } from "react";

export type TabDef<T extends string> = { id: T; label: string; badge?: ReactNode };

/** Tab state mirrored into the URL hash so a tab can be linked and survives a reload. */
export function useHashTab<T extends string>(ids: readonly T[], fallback: T): [T, (next: T) => void] {
  const [tab, setTab] = useState<T>(fallback);

  useEffect(() => {
    const read = () => {
      const hash = window.location.hash.slice(1) as T;
      setTab(ids.includes(hash) ? hash : fallback);
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, [ids, fallback]);

  const select = useCallback(
    (next: T) => {
      setTab(next);
      const url = `${window.location.pathname}${window.location.search}${next === fallback ? "" : `#${next}`}`;
      window.history.replaceState(null, "", url);
    },
    [fallback],
  );

  return [tab, select];
}

/** Roving-tabindex tablist: arrows, Home and End move and select, as in the ARIA tabs pattern. */
export function TabList<T extends string>({ tabs, current, onChange, label, idPrefix }: { tabs: TabDef<T>[]; current: T; onChange: (id: T) => void; label: string; idPrefix: string }) {
  function onKey(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = -1;
    if (e.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    if (next < 0) return;
    e.preventDefault();
    onChange(tabs[next].id);
    const root = e.currentTarget.closest("[role=tablist]");
    root?.querySelectorAll<HTMLButtonElement>("[role=tab]")[next]?.focus();
  }

  return (
    <div className="funds-tabs" role="tablist" aria-label={label}>
      {tabs.map((item, index) => (
        <button
          key={item.id}
          id={`${idPrefix}-tab-${item.id}`}
          type="button"
          role="tab"
          className={current === item.id ? "on" : ""}
          aria-selected={current === item.id}
          aria-controls={`${idPrefix}-panel`}
          tabIndex={current === item.id ? 0 : -1}
          onClick={() => onChange(item.id)}
          onKeyDown={(e) => onKey(e, index)}
        >
          {item.label}
          {item.badge != null ? <span className="mf-tab-badge">{item.badge}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function TabPanel<T extends string>({ idPrefix, current, children }: { idPrefix: string; current: T; children: ReactNode }) {
  return (
    <div id={`${idPrefix}-panel`} role="tabpanel" aria-labelledby={`${idPrefix}-tab-${current}`} className="mf-tabpanel">
      {children}
    </div>
  );
}
