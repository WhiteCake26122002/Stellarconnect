"use client";

import { useEffect, useState } from "react";

export function LevelField({
  label,
  value,
  step,
  onCommit,
}: {
  label: string;
  value?: number;
  step: number;
  onCommit: (next: number | undefined) => void;
}) {
  const shown = value == null ? "" : String(value);
  const [draft, setDraft] = useState(shown);

  useEffect(() => {
    setDraft(shown);
  }, [shown]);

  function commit() {
    const trimmed = draft.trim();
    if (!trimmed) {
      onCommit(undefined);
      return;
    }
    const n = Number(trimmed);
    if (!Number.isFinite(n) || n <= 0) {
      setDraft(shown);
      return;
    }
    onCommit(n);
  }

  return (
    <input
      className="compact"
      type="text"
      inputMode="decimal"
      aria-label={label}
      value={draft}
      step={step}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          (e.currentTarget as HTMLInputElement).blur();
        }
        if (e.key === "Escape") {
          setDraft(shown);
          (e.currentTarget as HTMLInputElement).blur();
        }
      }}
    />
  );
}
