"use client";

import { CompanyLogo } from "@/components/CompanyLogo";
import { deskLogoTicker } from "@/lib/logo";
import type { SymbolInfo } from "@/lib/trading/types";

const BADGES: Record<string, string> = {
  NIFTY: "50",
  BANKNIFTY: "BN",
  SENSEX: "SX",
  FINNIFTY: "FN",
  CNXIT: "IT",
  CNX500: "500",
  CNXSMALLCAP: "SC",
  CNXAUTO: "AU",
  CNXPHARMA: "PH",
  CNXMETAL: "MT",
  CNXMIDCAP: "MD",
  CNXFMCG: "FG",
};

export function deskBadge(symbol: string) {
  if (BADGES[symbol]) return BADGES[symbol];
  const compact = symbol.replace(/[^A-Z0-9]/g, "");
  return compact.slice(0, compact.length <= 3 ? compact.length : 2);
}

/** Company logo for listed stocks and ETFs; the initials badge for everything else or when no logo is on file. */
export function DeskMark({ info, size = 18 }: { info: SymbolInfo; size?: number }) {
  const badge = (
    <i className={`wl-mark ${info.assetClass}`} style={size !== 18 ? { width: size, height: size } : undefined} aria-hidden>
      {deskBadge(info.symbol)}
    </i>
  );
  const ticker = deskLogoTicker(info);
  if (!ticker) return badge;
  return <CompanyLogo ticker={ticker} size={size} className="desk-logo" fallback={badge} />;
}
