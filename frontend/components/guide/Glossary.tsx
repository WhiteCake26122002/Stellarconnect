"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
  type SyntheticEvent,
} from "react";
import { createPortal } from "react-dom";
import { GLOSSARY, type GlossaryEntry, type GlossaryId } from "@/lib/glossary";
import { useSimple } from "@/lib/prefs";

const POP_WIDTH = 288;

type PopPos = { top: number; left: number; above: boolean };

function stop(e: SyntheticEvent) {
  e.stopPropagation();
}

/** Keeps a portalled popover pinned to its anchor through scroll and resize. */
function usePopPosition(anchor: RefObject<HTMLElement | null>, open: boolean, align: "center" | "start"): PopPos | null {
  const [pos, setPos] = useState<PopPos | null>(null);
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    function place() {
      const r = anchor.current?.getBoundingClientRect();
      if (!r) return;
      const want = align === "start" ? r.left : r.left + r.width / 2 - POP_WIDTH / 2;
      const left = Math.min(Math.max(8, want), window.innerWidth - POP_WIDTH - 8);
      const above = window.innerHeight - r.bottom < 170;
      setPos({ left, top: above ? window.innerHeight - r.top + 8 : r.bottom + 8, above });
    }
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [anchor, open, align]);
  return pos;
}

function GlossaryCard({
  id,
  pos,
  popId,
  popRef,
  role,
}: {
  id: GlossaryId;
  pos: PopPos;
  popId: string;
  popRef?: RefObject<HTMLDivElement | null>;
  role: "dialog" | "tooltip";
}) {
  const simple = useSimple();
  const entry: GlossaryEntry = GLOSSARY[id];
  const text = simple ? entry.def : entry.tech ?? entry.def;
  return createPortal(
    <div
      ref={popRef}
      id={popId}
      role={role}
      aria-label={role === "dialog" ? entry.term : undefined}
      className={`gloss-pop${role === "tooltip" ? " gloss-tip" : ""}`}
      style={pos.above ? { bottom: pos.top, left: pos.left, width: POP_WIDTH } : { top: pos.top, left: pos.left, width: POP_WIDTH }}
      onClick={stop}
      onMouseDown={stop}
      onKeyDown={stop}
    >
      <strong>{entry.term}</strong>
      <p>{text}</p>
    </div>,
    document.body,
  );
}

/** The (?) button. Its popover is portalled so card overflow and the 3D book never clip it. */
export function GlossaryIcon({ id, className }: { id: GlossaryId; className?: string }) {
  const entry = GLOSSARY[id];
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const popId = useId();
  const pos = usePopPosition(btn, open, "center");

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (btn.current?.contains(t) || pop.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <>
      <button
        ref={btn}
        type="button"
        className={`gloss-btn${className ? ` ${className}` : ""}`}
        aria-label={`What is ${entry.term}?`}
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          setOpen((v) => !v);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") setOpen(false);
        }}
      >
        ?
      </button>
      {open && pos ? <GlossaryCard id={id} pos={pos} popId={popId} popRef={pop} role="dialog" /> : null}
    </>
  );
}

/**
 * Shows the glossary definition while the pointer or focus is on `children`, in both view modes:
 * plain text in Simple mode, the technical line in Detailed mode.
 */
export function GlossaryHover({ id, className, children }: { id: GlossaryId; className?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  const popId = useId();
  const pos = usePopPosition(anchor, open, "start");
  return (
    <div
      ref={anchor}
      className={className}
      tabIndex={0}
      aria-describedby={open ? popId : undefined}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onKeyDown={(e) => {
        if (e.key === "Escape") setOpen(false);
      }}
    >
      {children}
      {open && pos ? <GlossaryCard id={id} pos={pos} popId={popId} role="tooltip" /> : null}
    </div>
  );
}

/** In Simple mode, appends a (?) definition to the term. In Detailed mode it renders the children untouched. */
export function Term({ id, children }: { id: GlossaryId; children?: ReactNode }) {
  const simple = useSimple();
  if (!simple) return <>{children}</>;
  return (
    <span className="gloss-term">
      {children}
      <GlossaryIcon id={id} />
    </span>
  );
}

/** A plain-English one-liner with the original rationale kept behind "Why?". */
export function PlainNote({ plain, why }: { plain: ReactNode; why?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="note plain-note">
      <span>{plain}</span>
      {why ? (
        <>
          {" "}
          <button type="button" className="why-btn" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)}>
            {open ? "Hide why" : "Why?"}
          </button>
          {open ? (
            <div id={id} className="why-text">
              {why}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
