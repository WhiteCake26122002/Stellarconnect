"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { ShellSurface } from "@/components/AppShell";
import type { Workspace } from "@/lib/api";
import { setDataCheckHidden, useDataCheckHidden, useSimple } from "@/lib/prefs";

type Flag = NonNullable<Workspace["quality_flags"]>[number];

const CATEGORY_PLAIN: Record<string, string> = {
  growth: "Growth",
  margins: "Profit margin",
  terminal: "Long-run value",
  valuation: "Valuation result",
  data: "Source data",
  bridge: "Balance sheet",
};

/** Where the related input lives, when there is one. */
function inputFor(flag: Flag): { surface: ShellSurface; driver?: string; label: string } | null {
  switch (flag.code) {
    case "margin_expansion":
      return { surface: "assumptions", driver: "target_ebitda_margin", label: "Change the margin" };
    case "fade_vs_terminal":
    case "tv_share":
      return { surface: "assumptions", driver: "terminal_growth", label: "Change terminal growth" };
    case "growth_vs_hist_cagr":
    case "year1_vs_last":
    case "revenue_multiple":
    case "high_growth_evidence":
      return { surface: "forecast", label: "Open the growth path" };
    case "vs_market":
    case "high_valuation_sensitivity":
      return { surface: "sensitivity", label: "Open sensitivity" };
    case "negative_equity":
    case "negative_ev":
      return { surface: "dcf", label: "Open the DCF bridge" };
    default:
      return null;
  }
}

export function flagsToReview(model: Workspace): Flag[] {
  return (model.quality_flags || []).filter((f) => f.level !== "reasonable");
}

export function DataCheckNotice({
  model,
  onShowFlag,
  onShowInput,
  onHidden,
}: {
  model: Workspace;
  onShowFlag: (code: string) => void;
  onShowInput: (surface: ShellSurface, driver?: string) => void;
  onHidden: () => void;
}) {
  const simple = useSimple();
  const flags = flagsToReview(model);
  const signature = flags
    .map((f) => f.code)
    .sort()
    .join("|");
  const hiddenFor = useDataCheckHidden(model.id);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!flags.length || hiddenFor === signature) return null;

  const n = flags.length;
  const label = simple
    ? `Your data has ${n} ${n === 1 ? "thing" : "things"} worth double-checking`
    : `${n} model-quality ${n === 1 ? "flag" : "flags"} to review`;

  return (
    <div className="datacheck" ref={wrap}>
      {open ? (
        <div className="datacheck-panel" id={panelId} role="dialog" aria-label={label}>
          <p className="datacheck-lead">
            {simple
              ? "These don't stop the model from working. They're places where the data or an assumption deserves a second look."
              : "Flags at review or unrealistic level. Reasonable-level checks are listed in Model Quality."}
          </p>
          <ul>
            {flags.map((f) => {
              const input = inputFor(f);
              return (
                <li key={f.code + f.message} className={f.level === "unrealistic" ? "bad" : ""}>
                  <span className="datacheck-cat">
                    {simple ? CATEGORY_PLAIN[f.category] || f.category : `${f.level} · ${f.category}`}
                  </span>
                  <p>{f.message}</p>
                  <div className="datacheck-go">
                    <button
                      type="button"
                      onClick={() => {
                        setOpen(false);
                        onShowFlag(f.code);
                      }}
                    >
                      Show in Model Quality
                    </button>
                    {input ? (
                      <button
                        type="button"
                        onClick={() => {
                          setOpen(false);
                          onShowInput(input.surface, input.driver);
                        }}
                      >
                        {input.label}
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="datacheck-foot">Hiding this notice never hides the flags — they stay listed in Model Quality.</p>
        </div>
      ) : null}
      <div className="datacheck-bar">
        <button
          type="button"
          className="datacheck-pill"
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          onClick={() => setOpen((v) => !v)}
        >
          <i aria-hidden />
          {label}
        </button>
        <button
          type="button"
          className="datacheck-x"
          aria-label="Hide this notice (the flags stay in Model Quality)"
          onClick={() => {
            setDataCheckHidden(model.id, signature);
            setOpen(false);
            onHidden();
          }}
        >
          ×
        </button>
      </div>
    </div>
  );
}
