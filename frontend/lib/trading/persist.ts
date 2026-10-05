import type {
  Alert,
  ChartSlot,
  ChartType,
  Drawing,
  FeeConfig,
  IndicatorInstance,
  LayoutSave,
  Watchlist,
} from "./types";
import { cancelWorkingOrders, DEFAULT_FEES, freshAccount } from "./engine";
import type { EngineState } from "./engine";

export const STORE_KEY = "orbit-desk-v1";

export type PersistShape = {
  engine: EngineState;
  watchlists: Watchlist[];
  activeWatchlistId: string;
  recentSymbols: string[];
  favoriteIndicators: string[];
  recentIndicators: string[];
  layouts: LayoutSave[];
  alerts: Alert[];
  appearance: "professional" | "cosmic";
  bottomHeight: number;
  bottomCollapsed: boolean;
  rightWidth: number;
  quickTfs: string[];
  fees: FeeConfig;
  sync: { symbol: boolean; timeframe: boolean; crosshair: boolean; drawings: boolean };
  showPositionPnl: boolean;
  chartCount: 1 | 2 | 3 | 4;
  slots: ChartSlot[];
  learningMode: boolean;
  journals: Record<string, string>;
  /** Confetti and pulse on positive milestones. Toasts still show when this is off. */
  celebrate: boolean;
};

export function defaultWatchlists(): Watchlist[] {
  return [
    { id: "mine", name: "My Watchlist", symbols: ["NIFTY", "BANKNIFTY", "SENSEX", "RELIANCE", "TCS", "INFY"] },
    { id: "idx", name: "Indian Indices", symbols: ["NIFTY", "BANKNIFTY", "SENSEX", "FINNIFTY", "CNXIT"] },
    { id: "bank", name: "Banking", symbols: ["BANKNIFTY", "HDFCBANK", "ICICIBANK", "SBIN"] },
    { id: "it", name: "IT Stocks", symbols: ["TCS", "INFY", "CNXIT"] },
    { id: "pf", name: "Portfolio", symbols: [] },
    { id: "intraday", name: "Intraday", symbols: ["NIFTY", "BANKNIFTY", "FINNIFTY"] },
  ];
}

export function defaultSlots(): ChartSlot[] {
  return [
    { id: "c1", symbol: "NIFTY", timeframe: "1D", chartType: "candles" as ChartType },
    { id: "c2", symbol: "BANKNIFTY", timeframe: "1D", chartType: "candles" as ChartType },
    { id: "c3", symbol: "SENSEX", timeframe: "1D", chartType: "candles" as ChartType },
    { id: "c4", symbol: "FINNIFTY", timeframe: "1D", chartType: "candles" as ChartType },
  ];
}

export function defaultPersist(): PersistShape {
  const lists = defaultWatchlists();
  return {
    engine: { account: freshAccount(), orders: [], positions: [], trades: [], fees: DEFAULT_FEES },
    watchlists: lists,
    activeWatchlistId: lists[0].id,
    recentSymbols: ["NIFTY", "BANKNIFTY", "RELIANCE", "TCS", "INFY"],
    favoriteIndicators: ["ema", "rsi", "macd", "vwap"],
    recentIndicators: [],
    layouts: [],
    alerts: [],
    appearance: "professional",
    bottomHeight: 168,
    bottomCollapsed: false,
    rightWidth: 320,
    quickTfs: ["1m", "5m", "15m", "30m", "1H", "4H", "1D", "1W", "1M"],
    fees: DEFAULT_FEES,
    sync: { symbol: false, timeframe: false, crosshair: true, drawings: false },
    showPositionPnl: true,
    chartCount: 1,
    slots: defaultSlots(),
    learningMode: false,
    journals: {},
    celebrate: true,
  };
}

export function loadPersist(userId: string): PersistShape {
  try {
    const raw = localStorage.getItem(`${STORE_KEY}:${userId}`);
    if (!raw) return defaultPersist();
    const parsed = JSON.parse(raw) as PersistShape;
    const base = defaultPersist();
    return {
      ...base,
      ...parsed,
      engine: cancelWorkingOrders({ ...base.engine, ...parsed.engine }),
      journals: { ...base.journals, ...(parsed.journals || {}) },
      learningMode: Boolean(parsed.learningMode),
      celebrate: parsed.celebrate !== false,
    };
  } catch {
    return defaultPersist();
  }
}

export function savePersist(userId: string, data: PersistShape) {
  try {
    localStorage.setItem(`${STORE_KEY}:${userId}`, JSON.stringify(data));
  } catch {
    /* quota */
  }
}

export function cloneDrawings(items: Drawing[]) {
  return items.map((d) => ({ ...d, points: d.points.map((p) => ({ ...p })) }));
}

export function cloneIndicators(items: IndicatorInstance[]) {
  return items.map((i) => ({ ...i, inputs: { ...i.inputs }, style: { ...i.style } }));
}
