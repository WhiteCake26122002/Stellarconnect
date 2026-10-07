import type { Candle, IndicatorInstance, IndicatorKind } from "./types";

export const INDICATOR_CATALOG: {
  kind: IndicatorKind;
  name: string;
  category: string;
  pane: "price" | "osc";
  defaults: Record<string, number | string>;
  info: string;
}[] = [
  { kind: "ema", name: "EMA", category: "TREND", pane: "price", defaults: { length: 20, source: "close", offset: 0 }, info: "Exponential moving average of the selected source." },
  { kind: "sma", name: "SMA", category: "TREND", pane: "price", defaults: { length: 50, source: "close", offset: 0 }, info: "Simple moving average." },
  { kind: "supertrend", name: "Supertrend", category: "TREND", pane: "price", defaults: { atr: 10, multiplier: 3 }, info: "ATR-based trend follower." },
  { kind: "ichimoku", name: "Ichimoku", category: "TREND", pane: "price", defaults: { tenkan: 9, kijun: 26, senkou: 52 }, info: "Cloud equilibrium system." },
  { kind: "adx", name: "ADX", category: "TREND", pane: "osc", defaults: { length: 14 }, info: "Average directional index." },
  { kind: "rsi", name: "RSI", category: "MOMENTUM", pane: "osc", defaults: { length: 14 }, info: "Relative strength, 0–100." },
  { kind: "macd", name: "MACD", category: "MOMENTUM", pane: "osc", defaults: { fast: 12, slow: 26, signal: 9 }, info: "MACD line, signal, histogram." },
  { kind: "stoch", name: "Stochastic", category: "MOMENTUM", pane: "osc", defaults: { k: 14, d: 3 }, info: "Stochastic oscillator." },
  { kind: "cci", name: "CCI", category: "MOMENTUM", pane: "osc", defaults: { length: 20 }, info: "Commodity channel index." },
  { kind: "atr", name: "ATR", category: "VOLATILITY", pane: "osc", defaults: { length: 14 }, info: "Average true range." },
  { kind: "bbands", name: "Bollinger Bands", category: "VOLATILITY", pane: "price", defaults: { length: 20, mult: 2 }, info: "SMA ± standard deviations." },
  { kind: "keltner", name: "Keltner Channels", category: "VOLATILITY", pane: "price", defaults: { length: 20, atr: 10, mult: 2 }, info: "EMA ± ATR." },
  { kind: "volume", name: "Volume", category: "VOLUME", pane: "osc", defaults: {}, info: "Traded volume." },
  { kind: "vwap", name: "VWAP", category: "VOLUME", pane: "price", defaults: {}, info: "Volume-weighted average price." },
  { kind: "obv", name: "OBV", category: "VOLUME", pane: "osc", defaults: {}, info: "On-balance volume." },
  { kind: "cmf", name: "CMF", category: "VOLUME", pane: "osc", defaults: { length: 20 }, info: "Chaikin money flow." },
  { kind: "bos", name: "BOS", category: "MARKET STRUCTURE", pane: "price", defaults: { lookback: 5 }, info: "Break of structure swings." },
  { kind: "choch", name: "CHoCH", category: "MARKET STRUCTURE", pane: "price", defaults: { lookback: 5 }, info: "Change of character swings." },
  { kind: "orderblock", name: "Order Blocks", category: "MARKET STRUCTURE", pane: "price", defaults: { lookback: 8 }, info: "Last opposing candle before impulse." },
  { kind: "fvg", name: "Fair Value Gap", category: "MARKET STRUCTURE", pane: "price", defaults: {}, info: "Three-candle imbalance gaps." },
];

const COLORS = ["#111111", "#555555", "#888888", "#333333", "#aaaaaa", "#6b6b6b", "#222222"];

export function catalogEntry(kind: IndicatorKind) {
  return INDICATOR_CATALOG.find((x) => x.kind === kind)!;
}

export function createIndicator(kind: IndicatorKind, existing: number): IndicatorInstance {
  const cat = catalogEntry(kind);
  const length = cat.defaults.length;
  const label =
    kind === "ema" || kind === "sma" ? `${cat.name} ${length}` : cat.name;
  const pane = cat.pane === "osc" ? (kind === "volume" ? "volume" : `${kind}-${existing}`) : "price";
  return {
    id: `${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    kind,
    label,
    pane,
    visible: true,
    locked: false,
    favorite: ["ema", "rsi", "macd", "vwap"].includes(kind),
    inputs: { ...cat.defaults },
    style: { color: COLORS[existing % COLORS.length], width: 1.5, opacity: 1 },
    showValue: true,
    showLegend: true,
  };
}

function src(c: Candle, source: string) {
  if (source === "open") return c.o;
  if (source === "high") return c.h;
  if (source === "low") return c.l;
  if (source === "hl2") return (c.h + c.l) / 2;
  if (source === "hlc3") return (c.h + c.l + c.c) / 3;
  return c.c;
}

function sma(values: number[], n: number): (number | null)[] {
  const out: (number | null)[] = Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= n) sum -= values[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

function ema(values: number[], n: number): (number | null)[] {
  const out: (number | null)[] = Array(values.length).fill(null);
  const k = 2 / (n + 1);
  let prev: number | null = null;
  for (let i = 0; i < values.length; i++) {
    prev = prev == null ? values[i] : values[i] * k + prev * (1 - k);
    if (i >= n - 1) out[i] = prev;
  }
  return out;
}

function stdev(values: number[], n: number): (number | null)[] {
  const out: (number | null)[] = Array(values.length).fill(null);
  for (let i = n - 1; i < values.length; i++) {
    let m = 0;
    for (let j = 0; j < n; j++) m += values[i - j];
    m /= n;
    let v = 0;
    for (let j = 0; j < n; j++) v += (values[i - j] - m) ** 2;
    out[i] = Math.sqrt(v / n);
  }
  return out;
}

function atr(candles: Candle[], n: number): (number | null)[] {
  const tr: number[] = candles.map((c, i) => {
    if (i === 0) return c.h - c.l;
    const prev = candles[i - 1].c;
    return Math.max(c.h - c.l, Math.abs(c.h - prev), Math.abs(c.l - prev));
  });
  return ema(tr, n);
}

export type SeriesMap = Record<string, (number | null)[]>;

export function computeIndicator(ind: IndicatorInstance, candles: Candle[]): SeriesMap {
  const close = candles.map((c) => src(c, String(ind.inputs.source || "close")));
  const n = Number(ind.inputs.length || 14);
  switch (ind.kind) {
    case "ema":
      return { line: ema(close, n) };
    case "sma":
      return { line: sma(close, n) };
    case "vwap": {
      const out: (number | null)[] = [];
      let pv = 0;
      let vol = 0;
      let day = "";
      for (const c of candles) {
        const d = new Date(c.t).toDateString();
        if (d !== day) {
          pv = 0;
          vol = 0;
          day = d;
        }
        const tp = (c.h + c.l + c.c) / 3;
        pv += tp * c.v;
        vol += c.v;
        out.push(vol ? pv / vol : null);
      }
      return { line: out };
    }
    case "rsi": {
      const out: (number | null)[] = Array(candles.length).fill(null);
      let avgG = 0;
      let avgL = 0;
      for (let i = 1; i < candles.length; i++) {
        const ch = candles[i].c - candles[i - 1].c;
        const g = Math.max(ch, 0);
        const l = Math.max(-ch, 0);
        if (i <= n) {
          avgG += g;
          avgL += l;
          if (i === n) {
            avgG /= n;
            avgL /= n;
            const rs = avgL === 0 ? 100 : avgG / avgL;
            out[i] = 100 - 100 / (1 + rs);
          }
        } else {
          avgG = (avgG * (n - 1) + g) / n;
          avgL = (avgL * (n - 1) + l) / n;
          const rs = avgL === 0 ? 100 : avgG / avgL;
          out[i] = 100 - 100 / (1 + rs);
        }
      }
      return { line: out };
    }
    case "macd": {
      const fast = ema(close, Number(ind.inputs.fast || 12));
      const slow = ema(close, Number(ind.inputs.slow || 26));
      const macd = close.map((_, i) =>
        fast[i] != null && slow[i] != null ? (fast[i] as number) - (slow[i] as number) : null,
      );
      const signal = ema(
        macd.map((v) => v ?? 0),
        Number(ind.inputs.signal || 9),
      );
      const hist = macd.map((v, i) => (v != null && signal[i] != null ? v - (signal[i] as number) : null));
      return { macd, signal, hist };
    }
    case "stoch": {
      const kLen = Number(ind.inputs.k || 14);
      const k: (number | null)[] = Array(candles.length).fill(null);
      for (let i = kLen - 1; i < candles.length; i++) {
        let hh = -Infinity;
        let ll = Infinity;
        for (let j = 0; j < kLen; j++) {
          hh = Math.max(hh, candles[i - j].h);
          ll = Math.min(ll, candles[i - j].l);
        }
        k[i] = hh === ll ? 50 : ((candles[i].c - ll) / (hh - ll)) * 100;
      }
      const d = sma(
        k.map((v) => v ?? 0),
        Number(ind.inputs.d || 3),
      );
      return { k, d };
    }
    case "cci": {
      const tp = candles.map((c) => (c.h + c.l + c.c) / 3);
      const m = sma(tp, n);
      const out: (number | null)[] = tp.map((v, i) => {
        if (m[i] == null) return null;
        let mad = 0;
        for (let j = 0; j < n; j++) mad += Math.abs(tp[i - j] - (m[i] as number));
        mad /= n;
        return mad ? (v - (m[i] as number)) / (0.015 * mad) : 0;
      });
      return { line: out };
    }
    case "adx": {
      const len = n;
      const plus: number[] = [];
      const minus: number[] = [];
      const tr: number[] = [];
      for (let i = 0; i < candles.length; i++) {
        if (i === 0) {
          plus.push(0);
          minus.push(0);
          tr.push(candles[i].h - candles[i].l);
          continue;
        }
        const up = candles[i].h - candles[i - 1].h;
        const dn = candles[i - 1].l - candles[i].l;
        plus.push(up > dn && up > 0 ? up : 0);
        minus.push(dn > up && dn > 0 ? dn : 0);
        const prev = candles[i - 1].c;
        tr.push(Math.max(candles[i].h - candles[i].l, Math.abs(candles[i].h - prev), Math.abs(candles[i].l - prev)));
      }
      const atrE = ema(tr, len);
      const pdi = plus.map((v, i) => (atrE[i] ? (100 * (ema(plus, len)[i] as number)) / (atrE[i] as number) : null));
      const mdi = minus.map((v, i) => (atrE[i] ? (100 * (ema(minus, len)[i] as number)) / (atrE[i] as number) : null));
      const dx = pdi.map((p, i) => {
        const m = mdi[i];
        if (p == null || m == null || p + m === 0) return 0;
        return (100 * Math.abs(p - m)) / (p + m);
      });
      return { line: ema(dx, len), plus: pdi, minus: mdi };
    }
    case "atr":
      return { line: atr(candles, n) };
    case "bbands": {
      const mid = sma(close, n);
      const sd = stdev(close, n);
      const m = Number(ind.inputs.mult || 2);
      return {
        mid,
        upper: mid.map((v, i) => (v != null && sd[i] != null ? v + m * (sd[i] as number) : null)),
        lower: mid.map((v, i) => (v != null && sd[i] != null ? v - m * (sd[i] as number) : null)),
      };
    }
    case "keltner": {
      const mid = ema(close, n);
      const a = atr(candles, Number(ind.inputs.atr || 10));
      const m = Number(ind.inputs.mult || 2);
      return {
        mid,
        upper: mid.map((v, i) => (v != null && a[i] != null ? v + m * (a[i] as number) : null)),
        lower: mid.map((v, i) => (v != null && a[i] != null ? v - m * (a[i] as number) : null)),
      };
    }
    case "supertrend": {
      const a = atr(candles, Number(ind.inputs.atr || 10));
      const m = Number(ind.inputs.multiplier || 3);
      const line: (number | null)[] = [];
      let dir = 1;
      let st = candles[0]?.c ?? 0;
      for (let i = 0; i < candles.length; i++) {
        const hl2 = (candles[i].h + candles[i].l) / 2;
        if (a[i] == null) {
          line.push(null);
          continue;
        }
        const basicU = hl2 + m * (a[i] as number);
        const basicL = hl2 - m * (a[i] as number);
        if (dir === 1) {
          st = Math.max(basicL, st);
          if (candles[i].c < st) {
            dir = -1;
            st = basicU;
          }
        } else {
          st = Math.min(basicU, st);
          if (candles[i].c > st) {
            dir = 1;
            st = basicL;
          }
        }
        line.push(st);
      }
      return { line };
    }
    case "ichimoku": {
      const tenkanN = Number(ind.inputs.tenkan || 9);
      const kijunN = Number(ind.inputs.kijun || 26);
      const span = (len: number) =>
        candles.map((_, i) => {
          if (i < len - 1) return null;
          let hh = -Infinity;
          let ll = Infinity;
          for (let j = 0; j < len; j++) {
            hh = Math.max(hh, candles[i - j].h);
            ll = Math.min(ll, candles[i - j].l);
          }
          return (hh + ll) / 2;
        });
      return { tenkan: span(tenkanN), kijun: span(kijunN), senkou: span(Number(ind.inputs.senkou || 52)) };
    }
    case "volume":
      return { line: candles.map((c) => c.v) };
    case "obv": {
      const out: number[] = [];
      let v = 0;
      for (let i = 0; i < candles.length; i++) {
        if (i === 0) v = candles[i].v;
        else if (candles[i].c > candles[i - 1].c) v += candles[i].v;
        else if (candles[i].c < candles[i - 1].c) v -= candles[i].v;
        out.push(v);
      }
      return { line: out };
    }
    case "cmf": {
      const out: (number | null)[] = Array(candles.length).fill(null);
      for (let i = n - 1; i < candles.length; i++) {
        let mfv = 0;
        let vol = 0;
        for (let j = 0; j < n; j++) {
          const c = candles[i - j];
          const range = c.h - c.l;
          mfv += range ? (((c.c - c.l) - (c.h - c.c)) / range) * c.v : 0;
          vol += c.v;
        }
        out[i] = vol ? mfv / vol : 0;
      }
      return { line: out };
    }
    case "bos":
    case "choch": {
      const lb = Number(ind.inputs.lookback || 5);
      const marks: (number | null)[] = Array(candles.length).fill(null);
      for (let i = lb; i < candles.length - lb; i++) {
        let isHigh = true;
        let isLow = true;
        for (let j = 1; j <= lb; j++) {
          if (candles[i].h <= candles[i - j].h || candles[i].h <= candles[i + j].h) isHigh = false;
          if (candles[i].l >= candles[i - j].l || candles[i].l >= candles[i + j].l) isLow = false;
        }
        if (isHigh) marks[i] = candles[i].h;
        if (isLow) marks[i] = candles[i].l;
      }
      return { marks };
    }
    case "orderblock": {
      const lb = Number(ind.inputs.lookback || 8);
      const marks: (number | null)[] = Array(candles.length).fill(null);
      for (let i = 2; i < candles.length; i++) {
        const impulse = candles[i].c - candles[i].o;
        if (Math.abs(impulse) > (candles[i].h - candles[i].l) * 0.6 && i >= lb) {
          marks[i - 1] = candles[i - 1].o;
        }
      }
      return { marks };
    }
    case "fvg": {
      const upper: (number | null)[] = Array(candles.length).fill(null);
      const lower: (number | null)[] = Array(candles.length).fill(null);
      for (let i = 2; i < candles.length; i++) {
        if (candles[i].l > candles[i - 2].h) {
          lower[i] = candles[i - 2].h;
          upper[i] = candles[i].l;
        }
        if (candles[i].h < candles[i - 2].l) {
          upper[i] = candles[i - 2].l;
          lower[i] = candles[i].h;
        }
      }
      return { upper, lower };
    }
    default:
      return { line: close };
  }
}

export function lastValue(series: SeriesMap): number | null {
  const first = Object.values(series)[0];
  if (!first?.length) return null;
  for (let i = first.length - 1; i >= 0; i--) {
    const v = first[i];
    if (v != null) return v;
  }
  return null;
}

const SERIES_ORDER = ["k", "d", "line", "macd", "signal", "hist", "upper", "mid", "lower", "tenkan", "kijun"];

function tailNumber(arr: (number | null)[] | undefined): number | null {
  if (!arr?.length) return null;
  for (let i = arr.length - 1; i >= 0; i--) {
    const v = arr[i];
    if (v != null && Number.isFinite(v)) return v;
  }
  return null;
}

export function latestIndicatorValues(ind: IndicatorInstance, candles: Candle[]): { key: string; value: number }[] {
  if (!candles.length) return [];
  const series = computeIndicator(ind, candles);
  const keys = Object.keys(series).filter((key) => key !== "marks" && key !== "hist");
  keys.sort((a, b) => {
    const ia = SERIES_ORDER.indexOf(a);
    const ib = SERIES_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  const out: { key: string; value: number }[] = [];
  for (const key of keys) {
    const value = tailNumber(series[key]);
    if (value != null) out.push({ key, value });
  }
  return out;
}

export function formatIndicatorValue(kind: IndicatorKind, n: number) {
  if (!Number.isFinite(n)) return "—";
  if (kind === "obv" || kind === "volume") return n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
  if (n >= 1000) return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n.toFixed(2);
}
