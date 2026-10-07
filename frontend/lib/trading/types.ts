import type { ChargeBreakdown } from "../costs/charges";

export type AssetClass =
  | "index"
  | "stock"
  | "etf"
  | "future"
  | "option"
  | "commodity"
  | "forex"
  | "crypto";

export type Exchange = "NSE" | "BSE" | "MCX" | "NFO" | "FX" | "CRYPTO" | "GLOBAL";

export type Timeframe = {
  id: string;
  label: string;
  seconds: number;
  group: "seconds" | "minutes" | "hours" | "days" | "weeks" | "months";
};

export type ChartType =
  | "candles"
  | "hollow"
  | "bars"
  | "line"
  | "area"
  | "baseline"
  | "heikin"
  | "renko"
  | "kagi"
  | "pnf"
  | "linebreak";

export type Side = "buy" | "sell";
/**
 * New orders are always delivery. "intraday" survives only so a position saved before the desk became
 * long-only can still be read and closed; nothing can open one.
 */
export type Product = "delivery" | "intraday";
/** Paper trading takes market orders only. The user never chooses a type. */
export type OrderType = "market";
export type OrderStatus = "pending" | "filled" | "partial" | "cancelled" | "rejected";
export type PositionStatus = "open" | "partial" | "closed";

export type Candle = {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
};

export type Quote = {
  symbol: string;
  last: number;
  bid: number;
  ask: number;
  open: number;
  high: number;
  low: number;
  change: number;
  changePct: number;
  volume: number;
  ts: number;
  live?: boolean;
};

export type SymbolInfo = {
  symbol: string;
  name: string;
  exchange: Exchange;
  assetClass: AssetClass;
  currency: "INR" | "USD";
  lotSize: number;
  tickSize: number;
  base: number;
  volatility: number;
  industry?: string;
  indices?: string[];
};

export type IndicatorKind =
  | "ema"
  | "sma"
  | "vwap"
  | "rsi"
  | "macd"
  | "stoch"
  | "cci"
  | "adx"
  | "atr"
  | "bbands"
  | "keltner"
  | "supertrend"
  | "ichimoku"
  | "volume"
  | "obv"
  | "cmf"
  | "bos"
  | "choch"
  | "orderblock"
  | "fvg";

export type IndicatorInstance = {
  id: string;
  kind: IndicatorKind;
  label: string;
  pane: "price" | "volume" | string;
  visible: boolean;
  locked: boolean;
  favorite: boolean;
  inputs: Record<string, number | string>;
  style: { color: string; width: number; opacity: number };
  showValue: boolean;
  showLegend: boolean;
};

export type DrawingKind =
  | "trend"
  | "ray"
  | "extended"
  | "hline"
  | "vline"
  | "channel"
  | "regression"
  | "fib"
  | "fibext"
  | "fibfan"
  | "fibchannel"
  | "fibtime"
  | "pitchfork"
  | "rect"
  | "circle"
  | "ellipse"
  | "triangle"
  | "polygon"
  | "brush"
  | "highlight"
  | "arrow"
  | "text"
  | "callout"
  | "measure"
  | "longpos"
  | "shortpos"
  | "daterange"
  | "pricerange"
  | "forecast";

export type DrawingPoint = { i: number; price: number };

export type Drawing = {
  id: string;
  kind: DrawingKind;
  points: DrawingPoint[];
  color: string;
  width: number;
  opacity: number;
  dash: "solid" | "dash" | "dot";
  extendLeft: boolean;
  extendRight: boolean;
  labels: boolean;
  text?: string;
  locked: boolean;
  hidden: boolean;
};

export type ToolGroupId = "cursor" | "trend" | "levels" | "channel" | "fib" | "shape" | "annotate" | "measure" | "position";

export type ActiveTool = {
  group: ToolGroupId;
  kind: DrawingKind | "cursor" | "crosshair";
};

export type Order = {
  id: string;
  time: number;
  symbol: string;
  side: Side;
  type: OrderType;
  qty: number;
  filledQty: number;
  price?: number;
  status: OrderStatus;
  rejectReason?: string;
  replay?: boolean;
  product?: Product;
};

/** One purchase inside a position: the unit that tax and FIFO work on. */
export type Lot = {
  id: string;
  /** Quantity still open in this lot. */
  qty: number;
  /** Execution price, before charges. */
  price: number;
  openedAt: number;
  /** Charges paid on the opening fill that belong to the quantity still open. */
  openCharges: number;
  /** The STT inside those charges. */
  openStt: number;
};

export type Position = {
  id: string;
  symbol: string;
  /** Always "long" for anything opened now. "short" only appears on a position saved before the desk was long-only. */
  side: "long" | "short";
  qty: number;
  avgPrice: number;
  openedAt: number;
  status: PositionStatus;
  product?: Product;
  /** Open lots, oldest first. Positions saved before lots existed get one lot built from avgPrice. */
  lots?: Lot[];
};

/** The part of a closing fill that matched one lot. */
export type TradeSlice = {
  qty: number;
  openedAt: number;
  openPrice: number;
  closePrice: number;
  openCharges: number;
  closeCharges: number;
  openStt: number;
  closeStt: number;
  /** Price move only. */
  gross: number;
  /** Gross less every charge on both legs. */
  net: number;
  /** Gross less the deductible charges: the capital gain for tax. */
  taxable: number;
};

export type Trade = {
  id: string;
  openedAt: number;
  closedAt: number;
  symbol: string;
  side: "long" | "short";
  qty: number;
  entry: number;
  exit: number;
  pnl: number;
  returnPct: number;
  durationMs: number;
  /** All charges on both legs of this trade. */
  fees: number;
  replay?: boolean;
  product?: Product;
  /** Price move only, before charges. `pnl` is after charges. */
  grossPnl?: number;
  slices?: TradeSlice[];
};

/** One execution in the ledger: what was traded and every charge on it. */
export type Fill = {
  id: string;
  time: number;
  orderId: string;
  symbol: string;
  side: Side;
  qty: number;
  price: number;
  product: Product;
  /** quantity x price. */
  gross: number;
  charges: ChargeBreakdown;
  /** Debit for a buy (gross + charges), credit for a sell (gross - charges). */
  net: number;
  replay?: boolean;
};

export type FeeConfig = {
  slippagePct: number;
  /** Key of the broker profile in the central charge configuration. */
  profileId: string;
  /** Your own brokerage numbers, used when profileId is 'custom'. */
  custom?: Partial<Record<"equityDelivery" | "equityIntraday" | "futures" | "options", { pct?: number; flat?: number; cap?: number; min?: number }>> & { dpChargePerScripSell?: number };
};

export type PaperAccount = {
  startingBalance: number;
  cash: number;
  realizedPnl: number;
  dayPnlStartEquity: number;
  dayAnchor: string;
};

export type AlertCond =
  | { kind: "price"; symbol: string; op: ">" | "<"; value: number }
  | { kind: "indicator"; indicatorId: string; op: ">" | "<"; value: number }
  | { kind: "pnl"; op: ">" | "<"; value: number };

export type Alert = {
  id: string;
  label: string;
  cond: AlertCond;
  enabled: boolean;
  fired: boolean;
};

export type Watchlist = {
  id: string;
  name: string;
  symbols: string[];
};

export type LayoutSave = {
  id: string;
  name: string;
  symbol: string;
  timeframe: string;
  chartType: ChartType;
  indicators: IndicatorInstance[];
  drawings: Drawing[];
  watchlistId: string;
  chartCount: 1 | 2 | 3 | 4;
};

export type ChartSlot = {
  id: string;
  symbol: string;
  timeframe: string;
  chartType: ChartType;
};

export type PaneLayout = { id: string; height: number; collapsed: boolean };
