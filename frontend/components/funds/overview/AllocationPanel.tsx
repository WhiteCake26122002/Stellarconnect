"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { FundHolding } from "@/lib/api";
import { rupeesCompact } from "@/lib/funds/format";
import { allocationTree, type AllocNode } from "@/lib/funds/viz";
import { Donut, type DonutSlice } from "../viz/Donut";
import { HBars, type BarRow } from "../viz/HBars";
import { classColor } from "../viz/theme";

const SHADES = [1, 0.78, 0.6, 0.46, 0.34];

/**
 * Where the money is, as a donut you can open: asset class, then the AMFI category inside it, then the
 * funds in that category. Hover calls a slice out in the middle; click goes one level in; a fund opens its page.
 */
export function AllocationPanel({ holdings }: { holdings: FundHolding[] }) {
  const router = useRouter();
  const tree = useMemo(() => allocationTree(holdings), [holdings]);
  const [path, setPath] = useState<string[]>([]);

  let nodes: AllocNode[] = tree;
  let parent: AllocNode | null = null;
  const crumbs: { id: string | null; label: string }[] = [{ id: null, label: "Portfolio" }];
  const trail: string[] = [];
  for (const id of path) {
    const hit = nodes.find((n) => n.id === id);
    if (!hit) break;
    parent = hit;
    nodes = hit.children;
    trail.push(id);
    crumbs.push({ id, label: hit.label });
  }
  const level = trail.length;
  const rootClass = trail.length ? tree.find((n) => n.id === trail[0])?.label ?? "" : "";
  const whole = parent ? parent.value : nodes.reduce((a, n) => a + n.value, 0);
  const share = (n: AllocNode) => (whole > 0 ? (n.value / whole) * 100 : 0);

  const slices: DonutSlice[] = nodes.map((n, i) => ({
    id: n.id,
    label: n.label,
    pct: share(n),
    color: classColor(level === 0 ? n.label : rootClass),
    opacity: level === 0 ? 1 : SHADES[i % SHADES.length],
    valueText: rupeesCompact(n.value),
  }));

  const open = (n: AllocNode) => {
    if (n.code != null) router.push(`/funds/${n.code}`);
    else setPath([...trail, n.id]);
  };
  const openById = (id: string) => {
    const n = nodes.find((x) => x.id === id);
    if (n) open(n);
  };

  const rows: BarRow[] = nodes.map((n, i) => ({
    id: n.id,
    label: n.label,
    sub: level === 0 ? `${n.children.length} ${n.children.length === 1 ? "category" : "categories"}` : level === 1 ? `${n.children.length} ${n.children.length === 1 ? "fund" : "funds"}` : undefined,
    value: share(n),
    valueText: `${share(n).toFixed(share(n) < 10 ? 1 : 0)}% · ${rupeesCompact(n.value)}`,
    color: classColor(level === 0 ? n.label : rootClass),
    tip: level > 0 ? [{ label: "Of the whole portfolio", value: `${n.pct.toFixed(1)}%` }] : undefined,
    onClick: () => open(n),
  }));
  void SHADES;

  if (!tree.length) {
    return (
      <section className="vz-section" aria-label="Portfolio allocation">
        <h2 className="vz-h">Portfolio allocation</h2>
        <p className="vz-unavailable">Unavailable: no fund has a live NAV right now.</p>
      </section>
    );
  }

  const largest = tree[0];
  const total = parent
    ? { top: rupeesCompact(parent.value), bottom: parent.label }
    : { top: `${largest.pct.toFixed(0)}%`, bottom: largest.label };

  return (
    <section className="vz-section" aria-label="Portfolio allocation">
      <div className="vz-h-row">
        <h2 className="vz-h">Portfolio allocation</h2>
        <nav className="vz-crumbs" aria-label="Allocation level">
          {crumbs.map((c, i) => (
            <span key={c.id ?? "root"}>
              {i > 0 ? <i aria-hidden>›</i> : null}
              {i === crumbs.length - 1 ? (
                <b>{c.label}</b>
              ) : (
                <button type="button" onClick={() => setPath(trail.slice(0, i))}>
                  {c.label}
                </button>
              )}
            </span>
          ))}
        </nav>
      </div>
      <div className="vz-alloc">
        <Donut slices={slices} onSelect={openById} total={total} ariaLabel={`${parent ? parent.label : "Portfolio"} split`} />
        <div className="vz-alloc-list">
          <HBars rows={rows} max={100} ariaLabel={`${parent ? parent.label : "Portfolio"} breakdown`} />
          <p className="vz-hint">{level < 2 ? "Click a slice or a row to look inside it." : "Click a fund to open it."} Splits follow each scheme&apos;s AMFI category.</p>
        </div>
      </div>
    </section>
  );
}
