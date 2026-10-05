import type { AssetKind } from "@/lib/funds/category";

type IconProps = { size?: number; className?: string };

const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" } as const;

/** One glyph per asset family so a list can be scanned by shape, not just by label. */
export function CategoryIcon({ kind, size = 16, className }: IconProps & { kind: AssetKind }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" className={className}>
      {kind === "equity" ? (
        <>
          <path d="M2 12.5 6 8.5l2.6 2.6L14 5.5" {...stroke} />
          <path d="M10.5 5.5H14V9" {...stroke} />
        </>
      ) : kind === "debt" ? (
        <>
          <path d="M8 1.8 13.2 3.8v3.9c0 3.1-2.2 5.4-5.2 6.5-3-1.1-5.2-3.4-5.2-6.5V3.8Z" {...stroke} />
          <path d="M5.8 8.1 7.4 9.7l2.9-3" {...stroke} />
        </>
      ) : kind === "hybrid" ? (
        <>
          <circle cx="8" cy="8" r="5.8" {...stroke} />
          <path d="M8 2.2a5.8 5.8 0 0 1 0 11.6Z" fill="currentColor" />
        </>
      ) : kind === "index" ? (
        <>
          <circle cx="8" cy="8" r="5.8" {...stroke} />
          <circle cx="8" cy="8" r="2.9" {...stroke} />
          <circle cx="8" cy="8" r="0.9" fill="currentColor" />
        </>
      ) : (
        <>
          <rect x="2.6" y="2.6" width="4.4" height="4.4" rx="1.1" {...stroke} />
          <rect x="9" y="2.6" width="4.4" height="4.4" rx="1.1" {...stroke} />
          <rect x="2.6" y="9" width="4.4" height="4.4" rx="1.1" {...stroke} />
          <rect x="9" y="9" width="4.4" height="4.4" rx="1.1" {...stroke} />
        </>
      )}
    </svg>
  );
}

export function StarIcon({ filled, size = 18 }: IconProps & { filled: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="m10 2.4 2.35 4.76 5.25.77-3.8 3.7.9 5.23L10 14.39l-4.7 2.47.9-5.23-3.8-3.7 5.25-.77Z"
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function BellIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4 11.5V7.2a4 4 0 0 1 8 0v4.3l1.2 1.3H2.8ZM6.6 14.2a1.5 1.5 0 0 0 2.8 0" {...stroke} />
    </svg>
  );
}

export function ShareIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 10V2.2M5 5.2l3-3 3 3M3.2 8.5v4.3c0 .6.4 1 1 1h7.6c.6 0 1-.4 1-1V8.5" {...stroke} />
    </svg>
  );
}

export function DocIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4 1.8h5.4L12.6 5v8.2c0 .6-.4 1-1 1H4c-.6 0-1-.4-1-1V2.8c0-.6.4-1 1-1Z" {...stroke} />
      <path d="M9.2 1.8V5h3.3M5.5 8.2h5M5.5 10.8h3.4" {...stroke} />
    </svg>
  );
}

export function GridIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <rect x="2.2" y="2.2" width="5" height="5" rx="1.2" {...stroke} />
      <rect x="8.8" y="2.2" width="5" height="5" rx="1.2" {...stroke} />
      <rect x="2.2" y="8.8" width="5" height="5" rx="1.2" {...stroke} />
      <rect x="8.8" y="8.8" width="5" height="5" rx="1.2" {...stroke} />
    </svg>
  );
}

export function RowsIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.5 4h11M2.5 8h11M2.5 12h11" {...stroke} />
    </svg>
  );
}

export type ArtKind = "portfolio" | "search" | "watch" | "filter" | "recent";

/**
 * Small line illustrations for empty states. Ink follows `currentColor`, the accent follows
 * --mf-accent, so they sit correctly on either theme.
 */
export function EmptyArt({ kind }: { kind: ArtKind }) {
  const accent = { fill: "var(--mf-accent-soft)", stroke: "var(--mf-accent)", strokeWidth: 1.6 };
  return (
    <svg className="mf-empty-art" width="132" height="96" viewBox="0 0 132 96" aria-hidden="true">
      <ellipse cx="66" cy="88" rx="46" ry="4" fill="var(--line)" />
      {kind === "portfolio" ? (
        <>
          <rect x="22" y="22" width="60" height="44" rx="8" {...stroke} opacity="0.35" />
          <rect x="34" y="14" width="64" height="48" rx="9" {...stroke} fill="var(--surface)" />
          <path d="M44 48l10-10 7 7 13-14" {...stroke} stroke="var(--mf-accent)" strokeWidth="2" />
          <circle cx="98" cy="62" r="13" {...accent} />
          <path d="M98 56v12M92 62h12" {...stroke} stroke="var(--mf-accent)" strokeWidth="2" />
        </>
      ) : kind === "search" ? (
        <>
          <rect x="18" y="18" width="62" height="10" rx="5" {...stroke} opacity="0.35" />
          <rect x="18" y="36" width="48" height="10" rx="5" {...stroke} opacity="0.35" />
          <rect x="18" y="54" width="36" height="10" rx="5" {...stroke} opacity="0.35" />
          <circle cx="86" cy="46" r="17" {...stroke} fill="var(--surface)" />
          <circle cx="86" cy="46" r="10" {...accent} />
          <path d="m99 59 12 12" {...stroke} strokeWidth="3" />
        </>
      ) : kind === "watch" ? (
        <>
          <rect x="28" y="20" width="76" height="52" rx="10" {...stroke} fill="var(--surface)" />
          <path d="M40 34h30M40 44h20" {...stroke} opacity="0.45" />
          <path d="M40 60l9-7 7 4 10-9" {...stroke} opacity="0.45" />
          <path d="m92 10 4.9 9.9 10.9 1.6-7.9 7.7 1.9 10.8L92 34.9l-9.7 5.1 1.9-10.8-7.9-7.7 10.9-1.6Z" {...accent} strokeLinejoin="round" />
        </>
      ) : kind === "filter" ? (
        <>
          <path d="M26 20h80L78 50v22l-24 10V50Z" {...stroke} fill="var(--surface)" />
          <path d="M40 30h52" {...stroke} opacity="0.35" />
          <circle cx="98" cy="66" r="12" {...accent} />
          <path d="m93 61 10 10M103 61 93 71" {...stroke} stroke="var(--mf-accent)" strokeWidth="2" />
        </>
      ) : (
        <>
          <circle cx="66" cy="46" r="28" {...stroke} fill="var(--surface)" />
          <path d="M66 30v16l10 7" {...stroke} stroke="var(--mf-accent)" strokeWidth="2" />
          <path d="M34 28a36 36 0 0 1 10-10" {...stroke} opacity="0.4" />
        </>
      )}
    </svg>
  );
}
