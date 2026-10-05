"use client";

import { setViewMode, useViewMode } from "@/lib/prefs";

export function ViewModeToggle() {
  const mode = useViewMode();
  return (
    <div className="view-mode" role="radiogroup" aria-label="View" data-tour="view-mode">
      {(
        [
          ["simple", "Simple", "Plain English, with the full reasoning one click away"],
          ["detailed", "Detailed", "Every rationale shown in full"],
        ] as const
      ).map(([id, label, title]) => (
        <button key={id} type="button" role="radio" aria-checked={mode === id} title={title} onClick={() => setViewMode(id)}>
          {label}
        </button>
      ))}
    </div>
  );
}
