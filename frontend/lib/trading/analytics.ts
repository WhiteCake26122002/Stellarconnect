// Every number the Paper Trading dashboard shows is computed here, from the engine state and the quotes, and
// nowhere else. Components receive these results and draw them; they never do their own sums.
//
//   data (engine state, quotes, candles)  →  transformation (holdings)  →  calculation (this file)  →  UI
import { lotsOf, openCharges, positionValue, unrealizedNet, type EngineState } from "./engine";
import { findSymbol } from "./universe";
import type { Candle, Quote, Trade } from "./types";

export const DAY_MS = 86_400_000;

// --- holdings -------------------------------------------------------------------------------------

export type Holding = {
  symbol: string;
  name: string;
  sector: string;
  qty: number;
  /** Average price paid per share, before charges. */
  avgPrice: number;
  last: number;
  /** False when no price has arrived yet: the holding is then valued at what was paid, and says so. */
  hasQuote: boolean;
  /** Market value now. */
  value: number;
  /** Money put in, including the charges paid to open the position. */
  invested: number;
  /** Open profit or loss after the charges already paid. */
  pnl: number;
  /** pnl / invested, as a fraction. */
  returnPct: number;
  /** Move since yesterday's close on what is held; for shares bought today, the move since the purchase. */
  dayPnl: number;
  /** Share of the whole portfolio value, as a fraction. */
  weight: number;
  side: "long" | "short";
};

/** The sector a holding is filed under. Indices and ETFs have none, and a stock the data provider has not classified says so. */
export function sectorOf(symbol: string): string {
  const info = findSymbol(symbol);
  if (info.assetClass === "index") return "Index";
  if (info.assetClass === "etf") return "ETFs";
  if (info.assetClass === "commodity" || info.assetClass === "forex" || info.assetClass === "crypto") return "Other assets";
  return info.industry?.trim() || "Unclassified";
}

function startOfLocalDay(ts: number) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** One row per symbol across every open position in it. */
export function calculateHoldings(engine: EngineState, quotes: Map<string, Quote>, now = Date.now()): Holding[] {
  const today = startOfLocalDay(now);
  const bySymbol = new Map<string, Omit<Holding, "weight" | "returnPct">>();
  for (const p of engine.positions) {
    if (p.status === "closed" || p.qty <= 0) continue;
    const q = quotes.get(p.symbol);
    const hasQuote = !!q && q.last > 0;
    const last = hasQuote ? q!.last : p.avgPrice;
    const dir = p.side === "long" ? 1 : -1;
    let day = 0;
    if (hasQuote) {
      for (const lot of lotsOf(p)) day += (lot.openedAt >= today ? last - lot.price : q!.change) * lot.qty * dir;
    }
    const value = positionValue(p, last);
    const invested = p.avgPrice * p.qty + openCharges(p);
    const prev = bySymbol.get(p.symbol);
    if (!prev) {
      bySymbol.set(p.symbol, {
        symbol: p.symbol,
        name: findSymbol(p.symbol).name,
        sector: sectorOf(p.symbol),
        qty: p.qty,
        avgPrice: p.avgPrice,
        last,
        hasQuote,
        value,
        invested,
        pnl: unrealizedNet(p, last),
        dayPnl: day,
        side: p.side,
      });
    } else {
      const qty = prev.qty + p.qty;
      prev.avgPrice = (prev.avgPrice * prev.qty + p.avgPrice * p.qty) / qty;
      prev.qty = qty;
      prev.value += value;
      prev.invested += invested;
      prev.pnl += unrealizedNet(p, last);
      prev.dayPnl += day;
    }
  }
  const rows = [...bySymbol.values()];
  const total = rows.reduce((s, r) => s + r.value, 0) + Math.max(0, engine.account.cash);
  return rows
    .map((r) => ({ ...r, weight: total > 0 ? r.value / total : 0, returnPct: r.invested > 0 ? r.pnl / r.invested : 0 }))
    .sort((a, b) => b.value - a.value);
}

// --- the summary -----------------------------------------------------------------------------------

export type PortfolioSummary = {
  value: number;
  cash: number;
  holdingsValue: number;
  invested: number;
  unrealized: number;
  realized: number;
  totalPnl: number;
  totalReturn: number;
  dayPnl: number;
  dayReturn: number;
  /** Every charge paid so far. */
  charges: number;
  holdingsCount: number;
  /** How many holdings are valued at cost because no price has arrived. */
  unpriced: number;
};

/** Portfolio value is cash plus the market value of what is held. */
export function calculatePortfolioValue(engine: EngineState, holdings: Holding[]): number {
  return engine.account.cash + holdings.reduce((s, h) => s + h.value, 0);
}

export function calculateUnrealizedPnL(holdings: Holding[]): number {
  return holdings.reduce((s, h) => s + h.pnl, 0);
}

/** Profit and loss already booked, after the charges on both legs of each closed trade. */
export function calculateRealizedPnL(engine: Pick<EngineState, "account">): number {
  return engine.account.realizedPnl;
}

export function calculateSummary(engine: EngineState, holdings: Holding[]): PortfolioSummary {
  const value = calculatePortfolioValue(engine, holdings);
  const start = engine.account.startingBalance;
  const dayPnl = value - engine.account.dayPnlStartEquity;
  return {
    value,
    cash: engine.account.cash,
    holdingsValue: holdings.reduce((s, h) => s + h.value, 0),
    invested: holdings.reduce((s, h) => s + h.invested, 0),
    unrealized: calculateUnrealizedPnL(holdings),
    realized: calculateRealizedPnL(engine),
    totalPnl: value - start,
    totalReturn: start > 0 ? (value - start) / start : 0,
    dayPnl,
    dayReturn: engine.account.dayPnlStartEquity > 0 ? dayPnl / engine.account.dayPnlStartEquity : 0,
    charges: engine.fills.reduce((s, f) => s + f.charges.total, 0),
    holdingsCount: holdings.length,
    unpriced: holdings.filter((h) => !h.hasQuote).length,
  };
}

// --- where the money is ------------------------------------------------------------------------------

export type Slice = {
  id: string;
  label: string;
  value: number;
  /** Fraction of the whole, 0..1. */
  weight: number;
  /** The symbol to open when the slice is clicked; absent for cash and the grouped remainder. */
  symbol?: string;
};

const MAX_SLICES = 8;

/** Share of the portfolio in each holding and in cash. The weights add up to 1. */
export function calculatePortfolioAllocation(holdings: Holding[], cash: number): Slice[] {
  const money = Math.max(0, cash);
  const total = holdings.reduce((s, h) => s + h.value, 0) + money;
  if (total <= 0) return [];
  const rows: Slice[] = holdings
    .filter((h) => h.value > 0)
    .map((h) => ({ id: h.symbol, label: h.name, value: h.value, weight: h.value / total, symbol: h.symbol }));
  rows.sort((a, b) => b.value - a.value);
  const head = rows.slice(0, MAX_SLICES - 1);
  const tail = rows.slice(MAX_SLICES - 1);
  const out = rows.length > MAX_SLICES - 1 && tail.length > 1 ? [...head, groupOthers(tail, total)] : rows;
  if (money > 0) out.push({ id: "cash", label: "Cash", value: money, weight: money / total });
  return out;
}

function groupOthers(rows: Slice[], total: number): Slice {
  const value = rows.reduce((s, r) => s + r.value, 0);
  return { id: "others", label: `Others (${rows.length})`, value, weight: value / total };
}

export type SectorRow = { label: string; value: number; weight: number; holdings: string[] };

/** Share of the portfolio in each sector, with cash as its own row. The weights add up to 1. */
export function calculateSectorExposure(holdings: Holding[], cash: number): SectorRow[] {
  const money = Math.max(0, cash);
  const total = holdings.reduce((s, h) => s + h.value, 0) + money;
  if (total <= 0) return [];
  const by = new Map<string, SectorRow>();
  for (const h of holdings) {
    if (h.value <= 0) continue;
    const row = by.get(h.sector) ?? { label: h.sector, value: 0, weight: 0, holdings: [] };
    row.value += h.value;
    row.holdings.push(h.name);
    by.set(h.sector, row);
  }
  if (money > 0) by.set("Cash", { label: "Cash", value: money, weight: 0, holdings: [] });
  return [...by.values()].map((r) => ({ ...r, weight: r.value / total })).sort((a, b) => b.value - a.value);
}

export function calculateTopHoldings(holdings: Holding[], limit = 5): Holding[] {
  return holdings.slice().sort((a, b) => b.value - a.value).slice(0, limit);
}

export type Concentration = {
  /** Largest single holding as a fraction of the portfolio, or null with nothing held. */
  topHolding: { name: string; weight: number } | null;
  topSector: { label: string; weight: number } | null;
  holdingsCount: number;
  cashPct: number;
};

export function calculateConcentration(holdings: Holding[], cash: number): Concentration {
  const total = holdings.reduce((s, h) => s + h.value, 0) + Math.max(0, cash);
  const top = holdings.length ? holdings.reduce((a, b) => (b.value > a.value ? b : a)) : null;
  const sectors = calculateSectorExposure(holdings, 0);
  return {
    topHolding: top && total > 0 ? { name: top.name, weight: top.value / total } : null,
    topSector: sectors.length && total > 0 ? { label: sectors[0].label, weight: sectors[0].value / total } : null,
    holdingsCount: holdings.length,
    cashPct: total > 0 ? Math.max(0, cash) / total : 0,
  };
}

// --- trading behaviour -------------------------------------------------------------------------------

export type TradeStats = {
  total: number;
  wins: number;
  losses: number;
  /** Closed at exactly no profit or loss. */
  flat: number;
  /** wins / total closed trades, as a fraction; null with no closed trade. */
  winRate: number | null;
  lossRate: number | null;
  avgWin: number | null;
  avgLoss: number | null;
  best: Trade | null;
  worst: Trade | null;
  grossProfit: number;
  grossLoss: number;
};

const closed = (trades: Trade[]) => trades.filter((t) => t.qty > 0);

export function calculateWinRate(trades: Trade[]): number | null {
  const c = closed(trades);
  return c.length ? c.filter((t) => t.pnl > 0).length / c.length : null;
}

export function calculateAverageWin(trades: Trade[]): number | null {
  const w = closed(trades).filter((t) => t.pnl > 0);
  return w.length ? w.reduce((s, t) => s + t.pnl, 0) / w.length : null;
}

export function calculateAverageLoss(trades: Trade[]): number | null {
  const l = closed(trades).filter((t) => t.pnl < 0);
  return l.length ? l.reduce((s, t) => s + t.pnl, 0) / l.length : null;
}

/** Results are net of the charges on both legs, so a trade that only just covers its charges counts as a loss. */
export function calculateTradeStats(trades: Trade[]): TradeStats {
  const c = closed(trades);
  const wins = c.filter((t) => t.pnl > 0);
  const losses = c.filter((t) => t.pnl < 0);
  const best = c.length ? c.reduce((a, b) => (b.pnl > a.pnl ? b : a)) : null;
  const worst = c.length ? c.reduce((a, b) => (b.pnl < a.pnl ? b : a)) : null;
  return {
    total: c.length,
    wins: wins.length,
    losses: losses.length,
    flat: c.length - wins.length - losses.length,
    winRate: calculateWinRate(trades),
    lossRate: c.length ? losses.length / c.length : null,
    avgWin: calculateAverageWin(trades),
    avgLoss: calculateAverageLoss(trades),
    best: best && best.pnl > 0 ? best : null,
    worst: worst && worst.pnl < 0 ? worst : null,
    grossProfit: wins.reduce((s, t) => s + t.pnl, 0),
    grossLoss: losses.reduce((s, t) => s + t.pnl, 0),
  };
}

// --- the trading journal --------------------------------------------------------------------------------

export type ThesisVerdict = "yes" | "partly" | "no";

export type JournalEntry = {
  why: string;
  expected: string;
  actual: string;
  learned: string;
  /** The trader's own answer to "did it play out the way I expected?" Never inferred from profit. */
  verdict?: ThesisVerdict;
};

export const EMPTY_ENTRY: JournalEntry = { why: "", expected: "", actual: "", learned: "" };

/** A note saved by an older version was a single string; it becomes the "what did I learn" field. */
export function normalizeEntry(raw: unknown): JournalEntry {
  if (typeof raw === "string") return { ...EMPTY_ENTRY, learned: raw };
  if (raw && typeof raw === "object") {
    const r = raw as Partial<JournalEntry>;
    return {
      why: String(r.why ?? ""),
      expected: String(r.expected ?? ""),
      actual: String(r.actual ?? ""),
      learned: String(r.learned ?? ""),
      verdict: r.verdict === "yes" || r.verdict === "partly" || r.verdict === "no" ? r.verdict : undefined,
    };
  }
  return { ...EMPTY_ENTRY };
}

export type JournalStats = {
  totalTrades: number;
  withThesis: number;
  /** Trades whose author has said whether the thesis played out. */
  judged: number;
  played: number;
  /** played / judged, as a fraction; null until at least one trade has been judged. */
  successRate: number | null;
};

export function calculateJournalStats(trades: Trade[], journals: Record<string, unknown>): JournalStats {
  const c = closed(trades);
  let withThesis = 0;
  let judged = 0;
  let played = 0;
  for (const t of c) {
    if (!(t.id in journals)) continue;
    const e = normalizeEntry(journals[t.id]);
    if (e.why.trim()) withThesis += 1;
    if (e.why.trim() && e.verdict) {
      judged += 1;
      if (e.verdict === "yes") played += 1;
    }
  }
  return { totalTrades: c.length, withThesis, judged, played, successRate: judged ? played / judged : null };
}

// --- value over time -------------------------------------------------------------------------------------

/** One reading of the portfolio value, saved while the desk is open. */
export type EquityPoint = {
  t: number;
  v: number;
  /** The day's opening value, the baseline the engine measures "today" from. */
  base: number;
  /** True when the prices behind this reading were simulated rather than from the market feed. */
  sim?: boolean;
};

const MIN_GAP_MS = 5 * 60_000;
const KEEP_FINE_MS = 14 * DAY_MS;
const MAX_POINTS = 1500;

const dayKey = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/**
 * Adds a reading. Readings within five minutes of the last one on the same day replace it, so history is a
 * sample of the day and not a log of every tick; readings older than two weeks keep only the day's last.
 */
export function recordEquity(history: EquityPoint[], p: EquityPoint): EquityPoint[] {
  if (!Number.isFinite(p.v) || !Number.isFinite(p.t)) return history;
  let next = history;
  const last = history[history.length - 1];
  if (last && p.t < last.t) return history;
  if (last && p.t - last.t < MIN_GAP_MS && dayKey(p.t) === dayKey(last.t)) next = [...history.slice(0, -1), p];
  else next = [...history, p];
  const cut = p.t - KEEP_FINE_MS;
  const old = new Map<string, EquityPoint>();
  const recent: EquityPoint[] = [];
  for (const x of next) {
    if (x.t < cut) old.set(dayKey(x.t), x);
    else recent.push(x);
  }
  const out = [...old.values(), ...recent];
  return out.length > MAX_POINTS ? out.slice(out.length - MAX_POINTS) : out;
}

export type RangeId = "1D" | "1W" | "1M" | "3M" | "6M" | "1Y" | "ALL";
export const RANGES: RangeId[] = ["1D", "1W", "1M", "3M", "6M", "1Y", "ALL"];

const RANGE_DAYS: Record<Exclude<RangeId, "1D" | "ALL">, number> = { "1W": 7, "1M": 30, "3M": 91, "6M": 182, "1Y": 365 };

export function rangeStart(range: RangeId, now = Date.now()): number {
  if (range === "ALL") return 0;
  if (range === "1D") return startOfLocalDay(now);
  return now - RANGE_DAYS[range] * DAY_MS;
}

export type RangeView = {
  points: EquityPoint[];
  /** First and last reading in the window. */
  from: number | null;
  /** True when the history starts after the window does, so the chart shows less than the range name says. */
  partial: boolean;
  change: number;
  changePct: number | null;
  anySimulated: boolean;
};

export function sliceHistory(history: EquityPoint[], range: RangeId, now = Date.now()): RangeView {
  const start = rangeStart(range, now);
  const points = history.filter((p) => p.t >= start);
  const first = points[0];
  const last = points[points.length - 1];
  const change = first && last ? last.v - first.v : 0;
  return {
    points,
    from: first ? first.t : null,
    partial: range !== "ALL" && !!history.length && history[0].t > start + DAY_MS * (range === "1D" ? 0 : 1),
    change,
    changePct: first && last && first.v > 0 ? change / first.v : null,
    anySimulated: points.some((p) => p.sim),
  };
}

export type DayPnl = { day: string; t: number; pnl: number; sim: boolean };

/** Profit or loss per day: the day's last reading against its opening value. Only days the desk was open appear. */
export function calculateDailyPnl(history: EquityPoint[], limit = 30): DayPnl[] {
  const last = new Map<string, EquityPoint>();
  for (const p of history) last.set(dayKey(p.t), p);
  return [...last.entries()]
    .map(([day, p]) => ({ day, t: p.t, pnl: p.v - p.base, sim: !!p.sim }))
    .sort((a, b) => a.t - b.t)
    .slice(-limit);
}

export type BenchmarkPoint = { t: number; v: number };

/**
 * A market index rebased to the portfolio's value at the window's first reading, so the two lines start in the
 * same place and only the difference in growth shows. Uses the index close of each reading's day; a reading
 * before the index data begins gets no point rather than a guessed one.
 */
export function rebaseBenchmark(points: EquityPoint[], candles: Candle[]): BenchmarkPoint[] {
  if (points.length < 2 || candles.length < 2) return [];
  const closes = candles.map((c) => ({ day: dayKey(c.t < 1e12 ? c.t * 1000 : c.t), c: c.c }));
  const at = (t: number) => {
    const key = dayKey(t);
    let found: number | null = null;
    for (const x of closes) {
      if (x.day <= key) found = x.c;
      else break;
    }
    return found;
  };
  const base = at(points[0].t);
  if (!base) return [];
  const out: BenchmarkPoint[] = [];
  for (const p of points) {
    const c = at(p.t);
    if (c) out.push({ t: p.t, v: points[0].v * (c / base) });
  }
  return out.length >= 2 ? out : [];
}

/** True when every open position has a price, so a reading of the portfolio value is not just cost. */
export function allPriced(holdings: Holding[]): boolean {
  return holdings.every((h) => h.hasQuote);
}
