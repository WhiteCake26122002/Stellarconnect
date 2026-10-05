"use client";

import { useId, useState } from "react";
import { ApiError, type Drivers, type GuidanceExtraction, type Workspace, api } from "@/lib/api";
import { pct } from "@/lib/format";

export function isCompanyGuidanceSource(source?: string | null, method?: string | null) {
  const tokens = [source, method].map((v) => (v || "").toLowerCase().replace(/[\s-]+/g, "_"));
  return tokens.some((t) => t === "guidance" || t === "company_guidance" || t.includes("company_guidance"));
}

export function CompanyGuidanceBadge({ source, method }: { source?: string | null; method?: string | null }) {
  if (!isCompanyGuidanceSource(source, method)) return null;
  return <span className="chip source">Company guidance</span>;
}

function usableGuidance(extraction: GuidanceExtraction | null) {
  if (!extraction) return false;
  if (typeof extraction.has_usable_guidance === "boolean") return extraction.has_usable_guidance;
  return Boolean(extraction.revenue_growth_verified || extraction.ebitda_margin_verified);
}

function guidanceErrorText(err: unknown) {
  const message = err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Could not extract guidance.";
  const looksUnconfigured = /not configured|GROWTH_LLM|guidance llm/i.test(message);
  if (looksUnconfigured) {
    return `${message} Check GROWTH_LLM_API_KEY in the environment.`;
  }
  return message;
}

export function CompanyGuidancePanel({
  modelId,
  drivers,
  onWorkspace,
}: {
  modelId: string;
  drivers: Drivers;
  onWorkspace: (next: Workspace) => void;
}) {
  const uid = useId();
  const textId = `${uid}-source`;
  const labelId = `${uid}-label`;
  const hintId = `${uid}-hint`;
  const [sourceText, setSourceText] = useState("");
  const [sourceLabel, setSourceLabel] = useState("");
  const [extraction, setExtraction] = useState<GuidanceExtraction | null>(null);
  const [appliedThisRun, setAppliedThisRun] = useState<boolean | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"extract" | "clear" | "">("");

  const appliedGrowth = drivers.company_guidance_revenue_growth;
  const appliedQuote = extraction?.revenue_growth_quote || drivers.company_guidance_quote || null;
  const appliedPeriod = extraction?.revenue_growth_period || drivers.company_guidance_period || null;
  const hasApplied = appliedGrowth != null && Number.isFinite(appliedGrowth);
  const extractDisabled = busy !== "" || !sourceText.trim();

  async function extract() {
    if (extractDisabled) return;
    setBusy("extract");
    setError("");
    try {
      const next = await api.extractGuidance(modelId, sourceText.trim(), sourceLabel);
      setExtraction(next.extraction);
      setAppliedThisRun(next.applied);
      onWorkspace(next.workspace);
    } catch (err) {
      setError(guidanceErrorText(err));
    } finally {
      setBusy("");
    }
  }

  async function clear() {
    setBusy("clear");
    setError("");
    try {
      const next = await api.clearGuidance(modelId);
      setExtraction(null);
      setAppliedThisRun(null);
      onWorkspace(next);
    } catch (err) {
      setError(guidanceErrorText(err));
    } finally {
      setBusy("");
    }
  }

  return (
    <details className="drawer-group guidance-panel">
      <summary>Company Guidance (optional)</summary>
      <div className="field" aria-busy={busy !== ""}>
        <label htmlFor={textId}>Source text</label>
        <textarea
          id={textId}
          rows={6}
          value={sourceText}
          aria-describedby={hintId}
          placeholder="Earnings call transcript, MD&A excerpt, investor-deck outlook, or press release."
          onChange={(e) => setSourceText(e.target.value)}
        />
        <p id={hintId} className="note">
          Paste text containing forward-looking guidance. Only figures with a verbatim supporting quote found in this
          text will be applied.
        </p>
      </div>
      <div className="field">
        <label htmlFor={labelId}>Source label (optional)</label>
        <input
          id={labelId}
          type="text"
          value={sourceLabel}
          placeholder="Q3 FY26 earnings call"
          onChange={(e) => setSourceLabel(e.target.value)}
        />
      </div>
      <div className="guidance-actions">
        <button type="button" className="btn small" onClick={extract} disabled={extractDisabled}>
          {busy === "extract" ? "Extracting…" : "Extract Guidance"}
        </button>
        {hasApplied ? (
          <button type="button" className="btn ghost small" onClick={clear} disabled={busy !== ""}>
            {busy === "clear" ? "Clearing…" : "Clear guidance"}
          </button>
        ) : null}
      </div>
      {error ? (
        <p className="banner bad" role="alert">
          {error}
        </p>
      ) : null}
      {hasApplied ? (
        <div className="banner ok" role="status">
          Applied: Year-1 revenue growth set to {pct(appliedGrowth)}
          {appliedPeriod ? ` from ${appliedPeriod}` : ""}.
        </div>
      ) : null}
      {hasApplied && appliedQuote ? <blockquote className="guidance-quote">{appliedQuote}</blockquote> : null}
      {extraction && extraction.ebitda_margin_verified && extraction.ebitda_margin_pct != null ? (
        <div className="guidance-info">
          <p className="note">
            EBITDA margin {pct(extraction.ebitda_margin_pct)}
            {extraction.ebitda_margin_period ? ` (${extraction.ebitda_margin_period})` : ""} — extracted, not yet
            applied.
          </p>
          {extraction.ebitda_margin_quote ? (
            <blockquote className="guidance-quote">{extraction.ebitda_margin_quote}</blockquote>
          ) : null}
        </div>
      ) : null}
      {extraction && appliedThisRun === false && !usableGuidance(extraction) ? (
        <p className="note" role="status">
          No verifiable forward guidance found in this text.
          {extraction.notes ? ` ${extraction.notes}` : ""}
        </p>
      ) : null}
      {extraction?.rejected_reasons?.map((reason) => (
        <p className="banner warn" key={reason}>
          {reason}
        </p>
      ))}
    </details>
  );
}
