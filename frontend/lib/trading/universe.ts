import type { SymbolInfo, Timeframe } from "./types";
import { WORLD_MARKETS } from "./world-markets";

export const TIMEFRAMES: Timeframe[] = [
  { id: "1s", label: "1s", seconds: 1, group: "seconds" },
  { id: "5s", label: "5s", seconds: 5, group: "seconds" },
  { id: "15s", label: "15s", seconds: 15, group: "seconds" },
  { id: "1m", label: "1m", seconds: 60, group: "minutes" },
  { id: "5m", label: "5m", seconds: 300, group: "minutes" },
  { id: "15m", label: "15m", seconds: 900, group: "minutes" },
  { id: "30m", label: "30m", seconds: 1800, group: "minutes" },
  { id: "1H", label: "1H", seconds: 3600, group: "hours" },
  { id: "4H", label: "4H", seconds: 14400, group: "hours" },
  { id: "1D", label: "1D", seconds: 86400, group: "days" },
  { id: "1W", label: "1W", seconds: 604800, group: "weeks" },
  { id: "1M", label: "1M", seconds: 2592000, group: "months" },
];

export const QUICK_TFS_DEFAULT = ["1m", "5m", "15m", "30m", "1H", "4H", "1D", "1W", "1M"];

function s(
  symbol: string,
  name: string,
  exchange: SymbolInfo["exchange"],
  assetClass: SymbolInfo["assetClass"],
  base: number,
  opts?: Partial<SymbolInfo>,
): SymbolInfo {
  return {
    symbol,
    name,
    exchange,
    assetClass,
    currency: opts?.currency || "INR",
    lotSize: opts?.lotSize ?? (assetClass === "index" || assetClass === "future" ? 50 : 1),
    tickSize: opts?.tickSize ?? (base > 1000 ? 0.05 : base > 10 ? 0.05 : 0.0001),
    base,
    volatility: opts?.volatility ?? (assetClass === "crypto" ? 0.018 : assetClass === "index" ? 0.009 : 0.012),
  };
}

export const UNIVERSE: SymbolInfo[] = [
  s("NIFTY", "NIFTY 50", "NSE", "index", 23231.35, { lotSize: 25, volatility: 0.008 }),
  s("BANKNIFTY", "BANK NIFTY", "NSE", "index", 56241.85, { lotSize: 15, volatility: 0.01 }),
  s("SENSEX", "SENSEX", "BSE", "index", 76120.4, { lotSize: 10 }),
  s("FINNIFTY", "FINNIFTY", "NSE", "index", 23840.2, { lotSize: 25 }),
  s("CNXIT", "NIFTY IT", "NSE", "index", 37520.1),
  s("CNXAUTO", "NIFTY AUTO", "NSE", "index", 27129.0),
  s("CNXPHARMA", "NIFTY PHARMA", "NSE", "index", 26710.1),
  s("CNXMETAL", "NIFTY METAL", "NSE", "index", 13052.6),
  s("CNXMIDCAP", "NIFTY MIDCAP", "NSE", "index", 62191.25),
  s("CNXSMALLCAP", "NIFTY SMALLCAP", "NSE", "index", 19875.7),
  s("CNX500", "NIFTY 500", "NSE", "index", 22840.55),
  s("RELIANCE", "Reliance Industries", "NSE", "stock", 1384.2, { lotSize: 1 }),
  s("TCS", "Tata Consultancy Services", "NSE", "stock", 3921.5, { lotSize: 1 }),
  s("INFY", "Infosys", "NSE", "stock", 1612.4, { lotSize: 1 }),
  s("HDFCBANK", "HDFC Bank", "NSE", "stock", 1688.0, { lotSize: 1 }),
  s("ICICIBANK", "ICICI Bank", "NSE", "stock", 1244.6, { lotSize: 1 }),
  s("SBIN", "State Bank of India", "NSE", "stock", 812.3, { lotSize: 1 }),
  s("ITC", "ITC", "NSE", "stock", 492.8, { lotSize: 1 }),
  s("BHARTIARTL", "Bharti Airtel", "NSE", "stock", 1884.0, { lotSize: 1 }),
  s("LT", "Larsen & Toubro", "NSE", "stock", 3610.0, { lotSize: 1 }),
  s("HINDUNILVR", "Hindustan Unilever", "NSE", "stock", 2488.5, { lotSize: 1 }),
  s("NIFTYBEES", "Nippon India ETF Nifty BeES", "NSE", "etf", 268.4, { lotSize: 1 }),
  s("BANKBEES", "Nippon India ETF Bank BeES", "NSE", "etf", 542.1, { lotSize: 1 }),
  s("GOLDBEES", "Nippon India ETF Gold BeES", "NSE", "etf", 64.8, { lotSize: 1 }),
  s("NIFTYFUT", "NIFTY 50 Fut", "NFO", "future", 23248.0, { lotSize: 25 }),
  s("BNFUT", "BANKNIFTY Fut", "NFO", "future", 56280.0, { lotSize: 15 }),
  s("NIFTY24800CE", "NIFTY 24800 CE", "NFO", "option", 186.4, { lotSize: 25 }),
  s("NIFTY22800PE", "NIFTY 22800 PE", "NFO", "option", 94.2, { lotSize: 25 }),
  s("GOLD", "Gold", "MCX", "commodity", 72840, { lotSize: 1 }),
  s("SILVER", "Silver", "MCX", "commodity", 84210, { lotSize: 1 }),
  s("CRUDEOIL", "Crude Oil", "MCX", "commodity", 5920, { lotSize: 1 }),
  s("USDINR", "USD/INR", "FX", "forex", 83.72, { currency: "INR", lotSize: 1000, tickSize: 0.0025, volatility: 0.003 }),
  s("EURUSD", "EUR/USD", "FX", "forex", 1.0842, { currency: "USD", lotSize: 1000, tickSize: 0.0001, volatility: 0.004 }),
  s("BTCUSD", "Bitcoin", "CRYPTO", "crypto", 64210, { currency: "USD", lotSize: 0.001, tickSize: 0.5 }),
  s("ETHUSD", "Ethereum", "CRYPTO", "crypto", 2488, { currency: "USD", lotSize: 0.01, tickSize: 0.05 }),
  ...WORLD_MARKETS.filter((m) => m.symbol !== "NIFTY").map((m) =>
    s(m.symbol, m.name, "GLOBAL", "index", m.base, { currency: "USD", lotSize: 1, volatility: 0.008 }),
  ),
];

export const UNIVERSE_MAP = new Map(UNIVERSE.map((x) => [x.symbol, x]));
const CORE_SYMBOLS = new Set(UNIVERSE.map((x) => x.symbol));

const EQUITIES: SymbolInfo[] = [];
const INDEX_MEMBERS = new Map<string, string[]>();

export const NSE_INDEX_FILTERS = [
  { id: "", label: "All" },
  { id: "Nifty 50", label: "Nifty 50" },
  { id: "Nifty Next 50", label: "Next 50" },
  { id: "Nifty Midcap 150", label: "Midcap 150" },
  { id: "Nifty LargeMidcap 250", label: "Midcap 250" },
  { id: "Nifty Smallcap 250", label: "Smallcap 250" },
  { id: "Nifty Microcap 250", label: "Microcap 250" },
  { id: "Nifty 500", label: "Nifty 500" },
  { id: "Nifty Total Market", label: "Total Market" },
] as const;

export type EquityHit = {
  symbol: string;
  name: string;
  industry?: string;
  lot_size?: number;
  indices?: string[];
};

export function isPlaceholderSymbol(symbol: string) {
  return /^DUMMY/i.test(symbol || "");
}

function synthesize(id: string): SymbolInfo {
  const symbol = id.trim().toUpperCase();
  return s(symbol, symbol, "NSE", "stock", 100, { lotSize: 1 });
}

export function registerEquities(rows: EquityHit[]) {
  EQUITIES.length = 0;
  INDEX_MEMBERS.clear();
  for (const row of rows) {
    const symbol = (row.symbol || "").trim().toUpperCase();
    if (!symbol || isPlaceholderSymbol(symbol)) continue;
    const indices = [...(row.indices || [])];
    const existing = UNIVERSE_MAP.get(symbol);
    if (existing) {
      existing.industry = row.industry || existing.industry;
      existing.indices = indices;
      if (row.lot_size && row.lot_size > 1) existing.lotSize = row.lot_size;
      if (!CORE_SYMBOLS.has(symbol)) EQUITIES.push(existing);
    } else {
      const info = s(symbol, row.name || symbol, "NSE", "stock", 100, { lotSize: row.lot_size || 1 });
      info.industry = row.industry;
      info.indices = indices;
      UNIVERSE_MAP.set(symbol, info);
      EQUITIES.push(info);
    }
    for (const indexName of indices) {
      const list = INDEX_MEMBERS.get(indexName) || [];
      list.push(symbol);
      INDEX_MEMBERS.set(indexName, list);
    }
  }
}

export function indexSymbols(indexName: string): string[] {
  return INDEX_MEMBERS.get(indexName) || [];
}

export function equityCount() {
  return EQUITIES.length;
}

export function findSymbol(id: string): SymbolInfo {
  const symbol = (id || "").trim().toUpperCase();
  if (!symbol) return UNIVERSE[0];
  return UNIVERSE_MAP.get(symbol) || synthesize(symbol);
}

function matches(info: SymbolInfo, needle: string) {
  if (!needle) return true;
  return (
    info.symbol.toLowerCase().includes(needle) ||
    info.name.toLowerCase().includes(needle) ||
    info.exchange.toLowerCase().includes(needle) ||
    info.assetClass.toLowerCase().includes(needle) ||
    (info.industry || "").toLowerCase().includes(needle) ||
    (info.indices || []).some((name) => name.toLowerCase().includes(needle))
  );
}

export function searchSymbols(q: string, indexName = ""): SymbolInfo[] {
  const needle = q.trim().toLowerCase();
  if (indexName) {
    return (INDEX_MEMBERS.get(indexName) || []).map((sym) => findSymbol(sym)).filter((info) => matches(info, needle));
  }
  if (!needle) return UNIVERSE;
  const coreHits = UNIVERSE.filter((info) => matches(info, needle));
  const seen = new Set(coreHits.map((info) => info.symbol));
    const equityHits = EQUITIES.filter((info) => !seen.has(info.symbol) && !isPlaceholderSymbol(info.symbol) && matches(info, needle));
  const hits = [...coreHits, ...equityHits].slice(0, 250);
  const upper = q.trim().toUpperCase();
  if (/^[A-Z0-9.&-]{2,24}$/.test(upper) && !hits.some((info) => info.symbol === upper)) {
    hits.unshift(findSymbol(upper));
  }
  return hits;
}

export const CLASS_LABEL: Record<SymbolInfo["assetClass"], string> = {
  index: "INDICES",
  stock: "STOCKS",
  etf: "ETFs",
  future: "FUTURES",
  option: "OPTIONS",
  commodity: "COMMODITIES",
  forex: "FOREX",
  crypto: "CRYPTO",
};
