"use client";

import { ReactNode, useEffect, useRef } from "react";
import "@/components/costs/cx.css";

/** A side sheet for "how is this calculated?" style explanations; reuses the desk's dialog styling. */
export function InfoSheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="cx-overlay" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="cx-modal" role="dialog" aria-modal="true" aria-label={title}>
        <header className="cx-modal-head">
          <h2>{title}</h2>
          <button ref={closeRef} type="button" className="cx-x" aria-label="Close" onClick={onClose}>×</button>
        </header>
        <div className="cx-body">{children}</div>
      </div>
    </div>
  );
}
