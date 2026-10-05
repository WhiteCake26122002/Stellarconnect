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
export type OrderType = "market" | "limit" | "stop" | "stop_limit";
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
  trigger?: number;
  status: OrderStatus;
  rejectReason?: string;
  replay?: boolean;
};

export type Position = {
  id: string;
  symbol: string;
  side: "long" | "short";
  qty: number;
  avgPrice: number;
  sl?: number;
  tp?: number;
  openedAt: number;
  status: PositionStatus;
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
  fees: number;
  replay?: boolean;
};

export type FeeConfig = {
  brokeragePct: number;
  txnPct: number;
  taxPct: number;
  slippagePct: number;
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
