"use client";

import { ReactNode, useEffect, useId, useRef, useState } from "react";
import { useReducedMotion } from "@/lib/motion";
import { STAGGER_MS } from "@/lib/trading/motion";

/** Section headings share one look so the dashboard reads as sections, not as a wall of cards. */
export function SectionHead({ title, sub, right, id }: { title: string; sub?: ReactNode; right?: ReactNode; id?: string }) {
  return (
    <header className="pt-head">
      <div>
        <h2 id={id}>{title}</h2>
        {sub ? <p>{sub}</p> : null}
      </div>
      {right ? <div className="pt-head-right">{right}</div> : null}
    </header>
  );
}

/** Fades a section up as the page loads. `index` staggers siblings by 50ms; under reduced motion nothing moves. */
export function Reveal({ index = 0, children, className, as: Tag = "section", ...rest }: { index?: number; children: ReactNode; className?: string; as?: "section" | "div" | "article"; "aria-label"?: string; "aria-labelledby"?: string }) {
  return (
    <Tag className={`pt-reveal${className ? ` ${className}` : ""}`} style={{ ["--i" as string]: Math.min(index, 8), ["--stagger" as string]: `${STAGGER_MS}ms` }} {...rest}>
      {children}
    </Tag>
  );
}

export function Skeleton({ w = "100%", h = 14, className, label }: { w?: number | string; h?: number | string; className?: string; label?: string }) {
  return <span className={`pt-skel${className ? ` ${className}` : ""}`} style={{ width: w, height: h }} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} />;
}

/** The loading shape of a block: a few grey bars where the text will be. */
export function SkeletonBlock({ rows = 3, label }: { rows?: number; label: string }) {
  return (
    <div className="pt-skel-block" role="status" aria-busy="true" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} h={i === 0 ? 22 : 12} w={i === 0 ? "42%" : `${88 - i * 14}%`} />
      ))}
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div className="pt-empty">
      <strong>{title}</strong>
      <p>{body}</p>
      {action ? (
        <button type="button" className="pt-btn" onClick={action.onClick}>
          {action.label}
        </button>
      ) : null}
    </div>
  );
}

/** Never shows a raw error: a plain sentence, what to do, and a way to try again. */
export function ErrorState({ title, body, onRetry }: { title: string; body: string; onRetry?: () => void }) {
  return (
    <div className="pt-empty pt-error" role="alert">
      <strong>{title}</strong>
      <p>{body}</p>
      {onRetry ? (
        <button type="button" className="pt-btn" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}

/** A signed amount that is readable without colour: the sign is in the text and a triangle repeats it. */
export function Delta({ text, value, className }: { text: string; value: number; className?: string }) {
  const tone = value > 0 ? "up" : value < 0 ? "down" : "flat";
  return (
    <span className={`pt-delta ${tone}${className ? ` ${className}` : ""}`}>
      <i aria-hidden>{tone === "up" ? "▲" : tone === "down" ? "▼" : "–"}</i>
      {text}
    </span>
  );
}

/**
 * A small line. It is drawn left to right once when it first appears and never again, so a sparkline that
 * only receives a new last point does not replay. Fewer than two points draws nothing rather than a dash.
 */
export function Sparkline({ values, width = 84, height = 26, label }: { values: number[]; width?: number; height?: number; label: string }) {
  const id = useId();
  const reduce = useReducedMotion();
  const clean = values.filter((v) => Number.isFinite(v));
  if (clean.length < 2) return <span className="pt-spark-none" style={{ width, height }} aria-label={`${label}: no trend yet`} />;
  const lo = Math.min(...clean);
  const hi = Math.max(...clean);
  const x = (i: number) => 1 + (i / (clean.length - 1)) * (width - 2);
  const y = (v: number) => height - 2 - ((v - lo) / (hi - lo || 1)) * (height - 4);
  const d = clean.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join("");
  const up = clean[clean.length - 1] >= clean[0];
  const change = clean[0] ? (clean[clean.length - 1] / clean[0] - 1) * 100 : 0;
  return (
    <svg className={`pt-spark ${up ? "up" : "down"}${reduce ? " still" : ""}`} width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${label}: ${change >= 0 ? "up" : "down"} ${Math.abs(change).toFixed(1)}%`} data-id={id}>
      <path d={d} fill="none" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" pathLength={1} />
    </svg>
  );
}

/** Tracks whether a value just rose or fell, for a brief tint. Returns null when idle. */
export function useFlash(value: number | null | undefined, ms = 480): "up" | "down" | null {
  const prev = useRef<number | null>(null);
  const [flash, setFlash] = useState<"up" | "down" | null>(null);
  useEffect(() => {
    if (value == null || !Number.isFinite(value)) return;
    const was = prev.current;
    prev.current = value;
    if (was == null || was === value) return;
    setFlash(value > was ? "up" : "down");
    const t = window.setTimeout(() => setFlash(null), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return flash;
}

/** True when the viewport is at least `px` wide. False on the server and until measured. */
export function useMinWidth(px: number): boolean {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${px}px)`);
    const on = () => setOk(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [px]);
  return ok;
}

/** Keeps focus inside a dialog, closes it on Escape, and hands focus back to whatever opened it. */
export function useDialog(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const node = ref.current;
    const opener = document.activeElement as HTMLElement | null;
    const focusables = () => Array.from(node?.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])') ?? []).filter((el) => !el.hasAttribute("disabled"));
    const first = node?.querySelector<HTMLElement>("[data-autofocus]") ?? focusables()[0];
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusables();
      if (!items.length) return;
      const a = items[0];
      const z = items[items.length - 1];
      if (e.shiftKey && document.activeElement === a) {
        e.preventDefault();
        z.focus();
      } else if (!e.shiftKey && document.activeElement === z) {
        e.preventDefault();
        a.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      opener?.focus?.();
    };
  }, []);
  return ref;
}
