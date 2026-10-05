import type { SymbolInfo } from "@/lib/trading/types";

const TOKEN = process.env.NEXT_PUBLIC_LOGO_TOKEN || "";
const BASE = "https://img.logo.dev";

export type LogoQuery = {
  /** Company website; the most accurate lookup when we have it. */
  website?: string | null;
  /** Yahoo-style ticker such as TCS.NS, 500325.BO or AAPL. */
  ticker?: string | null;
  /** Brand name, for things with no ticker (fund houses). */
  name?: string | null;
};

export function logosEnabled() {
  return Boolean(TOKEN);
}

function domainOf(website: string) {
  const host = website
    .trim()
    .replace(/^[a-z]+:\/\//i, "")
    .split(/[/?#]/)[0]
    .replace(/^www\./i, "")
    .toLowerCase();
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : "";
}

/** Logo.dev image URL, or null when no key is configured or nothing identifies the company. */
export function logoUrl(q: LogoQuery, size = 64): string | null {
  if (!TOKEN) return null;
  let path = "";
  const domain = q.website ? domainOf(q.website) : "";
  if (domain) path = domain;
  else if (q.ticker?.trim()) path = `ticker/${encodeURIComponent(q.ticker.trim().toUpperCase())}`;
  else if (q.name?.trim()) path = `name/${encodeURIComponent(q.name.trim())}`;
  if (!path) return null;
  const params = new URLSearchParams({ token: TOKEN, size: String(size), format: "png", retina: "true", fallback: "404" });
  return `${BASE}/${path}?${params}`;
}

export function initialsOf(name: string) {
  const words = name.replace(/[^A-Za-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  const picked = words.filter((w) => !/^(ltd|limited|inc|corp|the|and|of)$/i.test(w));
  const use = picked.length ? picked : words;
  return (use.length > 1 ? use[0][0] + use[1][0] : (use[0] || "?").slice(0, 2)).toUpperCase();
}

/** Logo.dev ticker for a paper-desk symbol. Indices, derivatives, FX and commodities have no company logo. */
export function deskLogoTicker(info: SymbolInfo): string | null {
  if (info.assetClass !== "stock" && info.assetClass !== "etf") return null;
  if (info.exchange === "NSE") return `${info.symbol}.NS`;
  if (info.exchange === "BSE") return `${info.symbol}.BO`;
  return null;
}
