"use client";

import { useEffect, useRef } from "react";
import { computeIndicator } from "@/lib/trading/indicators";
import type { Candle, ChartType, Drawing, DrawingKind, IndicatorInstance, Position, Quote, Trade } from "@/lib/trading/types";

export type ScaleMode = "linear" | "log" | "percent";

export type ChartPointer = {
  i: number;
  price: number;
  x: number;
  y: number;
};

type Props = {
  candles: Candle[];
  chartType: ChartType;
  scaleMode: ScaleMode;
  indicators: IndicatorInstance[];
  drawings: Drawing[];
  positions: Position[];
  trades: Trade[];
  quote: Quote | null;
  symbolLabel: string;
  viewKey: string;
  tfLabel: string;
  tool: DrawingKind | "cursor" | "crosshair";
  selectedId: string | null;
  replayCutoff?: number;
  showPnl: boolean;
  last: number;
  status?: "ready" | "loading";
  compare?: { symbol: string; candles: Candle[] } | null;
  onSelect: (id: string | null, kind: "drawing" | "position" | "indicator" | null) => void;
  onDrawings: (next: Drawing[] | ((d: Drawing[]) => Drawing[])) => void;
  onDragLevel: (posId: string, field: "sl" | "tp", price: number) => void;
  onContext: (ev: { x: number; y: number; price: number; i: number }) => void;
  onHover: (info: { o: number; h: number; l: number; c: number; v: number; t: number } | null) => void;
  onReady?: (api: ChartHandle) => void;
};

export type ChartHandle = {
  reset: () => void;
  autoScale: () => void;
  screenshot: () => void;
};

const UP = "#3dd68c";
const DOWN = "#f07178";
const GRID = "rgba(17,17,17,0.07)";
const TEXT = "#6a6a6a";
const FG = "#111111";
const DEFAULT_BARS = 140;
const RIGHT_PAD_RATIO = 0.38;
const MIN_RIGHT_PAD = 28;

function readChartTheme(node: HTMLElement | null) {
  const host = node?.closest(".term-root") ?? node;
  const s = host ? getComputedStyle(host) : null;
  const v = (name: string, fallback: string) => {
    const x = s?.getPropertyValue(name).trim();
    return x || fallback;
  };
  return {
    bg: v("--chart-plot", "#ffffff"),
    grid: v("--chart-grid", GRID),
    text: v("--chart-text", TEXT),
    fg: v("--chart-fg", FG),
    ink: v("--chart-ink", "#041210"),
    tip: v("--chart-tip", "#111111"),
    tipFg: v("--chart-tip-fg", "#ffffff"),
    hair: v("--chart-hair", "rgba(17,17,17,0.2)"),
  };
}

function rightPadFor(visible = DEFAULT_BARS) {
  return Math.max(MIN_RIGHT_PAD, Math.round(visible * RIGHT_PAD_RATIO));
}

function nid() {
  return `d_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function transformCandles(src: Candle[], type: ChartType): Candle[] {
  if (type === "heikin") {
    const out: Candle[] = [];
    for (let i = 0; i < src.length; i++) {
      const c = src[i];
      const haC = (c.o + c.h + c.l + c.c) / 4;
      const prev = out[i - 1];
      const haO = prev ? (prev.o + prev.c) / 2 : (c.o + c.c) / 2;
      out.push({ t: c.t, o: haO, c: haC, h: Math.max(c.h, haO, haC), l: Math.min(c.l, haO, haC), v: c.v });
    }
    return out;
  }
  if (type === "renko" || type === "linebreak" || type === "kagi" || type === "pnf") {
    const brick = (src[src.length - 1]?.c || 1) * 0.004;
    const out: Candle[] = [];
    let last = src[0]?.c || 0;
    for (const c of src) {
      while (c.c - last >= brick) {
        const o = last;
        last += brick;
        out.push({ t: c.t, o, c: last, h: last, l: o, v: c.v });
      }
      while (last - c.c >= brick) {
        const o = last;
        last -= brick;
        out.push({ t: c.t, o, c: last, h: o, l: last, v: c.v });
      }
    }
    return out.length ? out : src;
  }
  return src;
}

export function ChartCanvas(props: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const state = useRef({
    start: 0,
    end: 0,
    hover: null as null | { x: number; y: number },
    drag: null as null | {
      mode: string;
      x: number;
      y: number;
      start: number;
      end: number;
      priceMin: number;
      priceMax: number;
      id?: string;
      field?: "sl" | "tp";
    },
    draft: [] as { i: number; price: number }[],
    followRight: true,
    autoPrice: true,
    priceMin: 0,
    priceMax: 1,
    cursor: "crosshair",
    rightPad: rightPadFor(),
    layout: { plot: { x: 8, y: 8, w: 100, h: 100 }, volH: 56, right: 72, bottom: 22, h: 100 },
  });
  const viewKeyRef = useRef(props.viewKey);

  useEffect(() => {
    const api: ChartHandle = {
      reset: () => {
        const n = propsRef.current.candles.length;
        const pad = rightPadFor();
        state.current.rightPad = pad;
        state.current.end = n + pad;
        state.current.start = Math.max(0, state.current.end - DEFAULT_BARS);
        state.current.followRight = true;
        state.current.autoPrice = true;
        draw();
      },
      autoScale: () => {
        state.current.autoPrice = true;
        draw();
      },
      screenshot: () => {
        const url = canvas.current?.toDataURL("image/png");
        if (!url) return;
        const a = document.createElement("a");
        a.href = url;
        a.download = `${propsRef.current.symbolLabel}.png`;
        a.click();
      },
    };
    props.onReady?.(api);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.viewKey]);

  useEffect(() => {
    const n = props.candles.length;
    const switched = viewKeyRef.current !== props.viewKey;
    const pad = state.current.rightPad || rightPadFor();
    state.current.rightPad = pad;
    if (switched) {
      viewKeyRef.current = props.viewKey;
      state.current.followRight = true;
      state.current.autoPrice = true;
      state.current.drag = null;
      state.current.draft = [];
      state.current.rightPad = rightPadFor();
      if (n) {
        state.current.end = n + state.current.rightPad;
        state.current.start = Math.max(0, state.current.end - DEFAULT_BARS);
      } else {
        state.current.start = 0;
        state.current.end = 0;
      }
    } else if (n && state.current.followRight) {
      const vis = Math.max(30, state.current.end - state.current.start || DEFAULT_BARS);
      state.current.end = n + pad;
      state.current.start = Math.max(0, state.current.end - vis);
    }
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.candles, props.viewKey, props.indicators, props.drawings, props.positions, props.chartType, props.scaleMode, props.selectedId, props.tool, props.replayCutoff, props.showPnl, props.status]);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const w = hitWorld(e.clientX, e.clientY);
      const zone = w.zone;
      if (zone === "price" || e.altKey) {
        const mid = (state.current.priceMin + state.current.priceMax) / 2;
        const range = Math.max(1e-8, state.current.priceMax - state.current.priceMin);
        const factor = e.deltaY > 0 ? 1.12 : 1 / 1.12;
        const next = range * factor;
        state.current.priceMin = mid - next / 2;
        state.current.priceMax = mid + next / 2;
        state.current.autoPrice = false;
        draw();
        return;
      }
      const n = propsRef.current.candles.length;
      const pad = state.current.rightPad || rightPadFor();
      const vis = Math.max(20, state.current.end - state.current.start);
      const next = e.deltaY > 0 ? Math.min(n + pad, Math.round(vis * 1.12)) : Math.max(20, Math.round(vis / 1.12));
      const frac = (w.i - state.current.start) / vis;
      state.current.start = Math.max(0, Math.round(w.i - next * frac));
      state.current.end = state.current.start + next;
      if (state.current.end > n + pad) {
        state.current.end = n + pad;
        state.current.start = Math.max(0, state.current.end - next);
      }
      state.current.followRight = state.current.end >= n + pad - 1;
      draw();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  function layout() {
    const el = wrap.current;
    const cv = canvas.current;
    if (!el || !cv) return null;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = el.clientWidth;
    const h = el.clientHeight;
    if (cv.width !== Math.floor(w * dpr) || cv.height !== Math.floor(h * dpr)) {
      cv.width = Math.floor(w * dpr);
      cv.height = Math.floor(h * dpr);
      cv.style.width = `${w}px`;
      cv.style.height = `${h}px`;
    }
    const ctx = cv.getContext("2d");
    if (!ctx) return null;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const osc = props.indicators.filter((i) => i.visible && i.pane !== "price" && i.kind !== "volume");
    const volOn = props.indicators.some((i) => i.kind === "volume" && i.visible) || true;
    const oscH = osc.length * 78;
    const volH = volOn ? 58 : 0;
    const right = 64;
    const bottom = 22;
    const top = 6;
    const priceH = Math.max(80, h - top - bottom - volH - oscH);
    const plot = { x: 6, y: top, w: Math.max(40, w - right - 6), h: priceH };
    state.current.layout = { plot, volH, right, bottom, h };
    return { ctx, w, h, plot, volH, osc, oscH, right, bottom };
  }

  function yAt(price: number, plot: { y: number; h: number }, min: number, max: number, mode: ScaleMode, ref: number) {
    if (mode === "log") {
      const a = Math.log(Math.max(min, 1e-8));
      const b = Math.log(Math.max(max, 1e-8));
      const p = Math.log(Math.max(price, 1e-8));
      return plot.y + ((b - p) / (b - a || 1)) * plot.h;
    }
    if (mode === "percent") {
      const pn = ((price - ref) / (ref || 1)) * 100;
      const mn = ((min - ref) / (ref || 1)) * 100;
      const mx = ((max - ref) / (ref || 1)) * 100;
      return plot.y + ((mx - pn) / (mx - mn || 1)) * plot.h;
    }
    return plot.y + ((max - price) / (max - min || 1)) * plot.h;
  }

  function draw() {
    const L = layout();
    if (!L) return;
    const { ctx, w, h, plot, volH, osc, right } = L;
    const theme = readChartTheme(wrap.current);
    const GRID = theme.grid;
    const TEXT = theme.text;
    const FG = theme.fg;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, w, h);

    const raw = props.replayCutoff != null ? props.candles.slice(0, props.replayCutoff + 1) : props.candles;
    const data = transformCandles(raw, props.chartType);
    if (!data.length) {
      ctx.fillStyle = TEXT;
      ctx.font = "12px IBM Plex Sans, sans-serif";
      ctx.fillText(props.status === "loading" ? "Loading market data…" : "Unable to load market data.", 24, 40);
      return;
    }
    const n = data.length;
    const rightPad = state.current.rightPad || rightPadFor();
    state.current.rightPad = rightPad;
    let { start, end } = state.current;
    start = Math.max(0, Math.min(start, Math.max(0, n - 1)));
    end = Math.max(start + 10, Math.min(end, n + rightPad));
    state.current.start = start;
    state.current.end = end;
    const span = Math.max(10, end - start);
    const vis = data.slice(start, Math.min(end, n));
    if (wrap.current) {
      wrap.current.dataset.rightPad = String(rightPad);
      wrap.current.dataset.futureBars = String(Math.max(0, end - n));
      wrap.current.dataset.lastIndex = String(Math.max(0, n - 1));
    }
    let min = Infinity;
    let max = -Infinity;
    for (const c of vis) {
      min = Math.min(min, c.l);
      max = Math.max(max, c.h);
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      const lastBar = data[n - 1];
      min = lastBar.l;
      max = lastBar.h;
    }
    for (const ind of props.indicators) {
      if (!ind.visible || ind.pane !== "price") continue;
      const s = computeIndicator(ind, raw);
      for (const arr of Object.values(s)) {
        for (let i = start; i < Math.min(end, n); i++) {
          const v = arr[i];
          if (v != null) {
            min = Math.min(min, v);
            max = Math.max(max, v);
          }
        }
      }
    }
    for (const p of props.positions) {
      if (p.status === "closed") continue;
      min = Math.min(min, p.avgPrice, p.sl ?? p.avgPrice, p.tp ?? p.avgPrice);
      max = Math.max(max, p.avgPrice, p.sl ?? p.avgPrice, p.tp ?? p.avgPrice);
    }
    const yPad = (max - min) * 0.08 || max * 0.01;
    min -= yPad;
    max += yPad;
    if (!state.current.autoPrice && state.current.priceMax > state.current.priceMin) {
      min = state.current.priceMin;
      max = state.current.priceMax;
    }
    state.current.priceMin = min;
    state.current.priceMax = max;
    const ref = vis[0]?.c || data[n - 1]?.c || 1;
    const cw = plot.w / span;
    const xAt = (i: number) => plot.x + (i - start + 0.5) * cw;
    const py = (price: number) => yAt(price, plot, min, max, props.scaleMode, ref);

    ctx.strokeStyle = GRID;
    ctx.lineWidth = 1;
    for (let g = 1; g <= 6; g++) {
      const y = plot.y + (plot.h / 7) * g;
      ctx.beginPath();
      ctx.moveTo(plot.x, y);
      ctx.lineTo(plot.x + plot.w, y);
      ctx.stroke();
    }

    if (props.chartType === "area" || props.chartType === "line" || props.chartType === "baseline") {
      ctx.beginPath();
      vis.forEach((c, vi) => {
        const x = xAt(start + vi);
        const y = py(c.c);
        if (vi === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = "#6ea8ff";
      ctx.lineWidth = 1.4;
      ctx.stroke();
      if (props.chartType !== "line" && vis.length) {
        const baseY = props.chartType === "baseline" ? py(vis[0].c) : plot.y + plot.h;
        ctx.lineTo(plot.x + plot.w, baseY);
        ctx.lineTo(plot.x, baseY);
        ctx.closePath();
        ctx.fillStyle = "rgba(110,168,255,0.12)";
        ctx.fill();
      }
    } else {
      vis.forEach((c, vi) => {
        const x = xAt(start + vi);
        const up = c.c >= c.o;
        const col = up ? UP : DOWN;
        ctx.strokeStyle = col;
        ctx.fillStyle = props.chartType === "hollow" && up ? "transparent" : col;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, py(c.h));
        ctx.lineTo(x, py(c.l));
        ctx.stroke();
        const bodyTop = py(Math.max(c.o, c.c));
        const bodyBot = py(Math.min(c.o, c.c));
        const bw = Math.max(1, cw * 0.7);
        if (props.chartType === "bars") {
          ctx.beginPath();
          ctx.moveTo(x - bw / 2, py(c.o));
          ctx.lineTo(x, py(c.o));
          ctx.moveTo(x, py(c.c));
          ctx.lineTo(x + bw / 2, py(c.c));
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.rect(x - bw / 2, bodyTop, bw, Math.max(1, bodyBot - bodyTop));
          if (props.chartType === "hollow" && up) ctx.stroke();
          else ctx.fill();
          ctx.stroke();
        }
      });
    }

    const cmp = props.compare;
    if (cmp?.candles?.length && vis.length) {
      const baseMain = vis[0].c || 1;
      const byT = cmp.candles;
      ctx.strokeStyle = "#c084fc";
      ctx.lineWidth = 1.25;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      let started = false;
      vis.forEach((c, vi) => {
        const i = start + vi;
        const other = byT[nearestIndex(byT, c.t)];
        if (!other) return;
        const first = byT[nearestIndex(byT, vis[0].t)] || byT[0];
        const price = baseMain * (other.c / (first.c || 1));
        const x = xAt(i);
        const y = py(price);
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.font = "600 10px IBM Plex Sans, sans-serif";
      ctx.fillStyle = "#c084fc";
      ctx.fillText(cmp.symbol, plot.x + plot.w - 64, plot.y + 14);
    }

    for (const ind of props.indicators) {
      if (!ind.visible || ind.pane !== "price") continue;
      const series = computeIndicator(ind, raw);
      ctx.globalAlpha = ind.style.opacity;
      ctx.strokeStyle = ind.style.color;
      ctx.lineWidth = ind.style.width;
      for (const [key, arr] of Object.entries(series)) {
        if (key === "marks") {
          ctx.fillStyle = ind.style.color;
          arr.forEach((v, i) => {
            if (v == null || i < start || i >= end) return;
            ctx.fillRect(xAt(i) - 2, py(v) - 2, 4, 4);
          });
          continue;
        }
        ctx.beginPath();
        let started = false;
        arr.forEach((v, i) => {
          if (v == null || i < start || i >= end) return;
          const x = xAt(i);
          const y = py(v);
          if (!started) {
            ctx.moveTo(x, y);
            started = true;
          } else ctx.lineTo(x, y);
        });
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    for (const d of props.drawings) {
      if (d.hidden) continue;
      drawShape(ctx, d, xAt, py, d.id === props.selectedId, plot);
    }
    if (state.current.draft.length) {
      const draft: Drawing = {
        id: "draft",
        kind: props.tool as DrawingKind,
        points: state.current.draft,
        color: "#6ea8ff",
        width: 1.2,
        opacity: 1,
        dash: "solid",
        extendLeft: props.tool === "extended" || props.tool === "ray",
        extendRight: props.tool === "extended" || props.tool === "ray",
        labels: true,
        locked: false,
        hidden: false,
      };
      drawShape(ctx, draft, xAt, py, true, plot);
    }

    for (const p of props.positions) {
      if (p.status === "closed") continue;
      const last = props.last || vis[vis.length - 1]?.c || data[n - 1].c;
      const pnl = (last - p.avgPrice) * p.qty * (p.side === "long" ? 1 : -1);
      lineLabel(ctx, plot, py(p.avgPrice), p.side === "long" ? UP : DOWN, `${p.side === "long" ? "BUY" : "SELL"} ${p.qty} @ ${p.avgPrice.toFixed(2)}`);
      if (p.sl != null) lineLabel(ctx, plot, py(p.sl), DOWN, `SL ${p.sl.toFixed(2)}`);
      if (p.tp != null) lineLabel(ctx, plot, py(p.tp), UP, `TP ${p.tp.toFixed(2)}`);
      if (props.showPnl) {
        ctx.font = "600 11px IBM Plex Sans, sans-serif";
        ctx.fillStyle = pnl >= 0 ? UP : DOWN;
        ctx.fillText(`${p.symbol} ${p.side.toUpperCase()} ${p.qty}  ${pnl >= 0 ? "+" : "−"}₹${Math.abs(pnl).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`, plot.x + 10, plot.y + 18);
      }
    }

    for (const t of props.trades.slice(0, 40)) {
      const i = nearestIndex(data, t.openedAt);
      if (i < start || i >= end) continue;
      const x = xAt(i);
      const y = py(t.entry);
      ctx.fillStyle = t.side === "long" ? UP : DOWN;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - 5, y + (t.side === "long" ? 8 : -8));
      ctx.lineTo(x + 5, y + (t.side === "long" ? 8 : -8));
      ctx.closePath();
      ctx.fill();
    }

    const last = data[n - 1];
    const ly = py(last.c);
    ctx.strokeStyle = last.c >= last.o ? UP : DOWN;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(plot.x, ly);
    ctx.lineTo(plot.x + plot.w, ly);
    ctx.stroke();
    if (n - 1 >= start && n - 1 < end) {
      const nx = xAt(n - 1);
      ctx.strokeStyle = theme.hair;
      ctx.beginPath();
      ctx.moveTo(nx, plot.y);
      ctx.lineTo(nx, plot.y + plot.h + volH);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.fillStyle = last.c >= last.o ? UP : DOWN;
    ctx.fillRect(plot.x + plot.w, ly - 8, right - 4, 16);
    ctx.fillStyle = "#041210";
    ctx.font = "600 10px IBM Plex Sans, sans-serif";
    ctx.fillText(last.c.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }), plot.x + plot.w + 4, ly + 3);

    ctx.fillStyle = TEXT;
    ctx.font = "10px IBM Plex Sans, sans-serif";
    for (let g = 0; g <= 6; g++) {
      const price = max - ((max - min) * g) / 6;
      const y = plot.y + (plot.h / 6) * g;
      const label =
        props.scaleMode === "percent"
          ? `${(((price - ref) / ref) * 100).toFixed(1)}%`
          : price.toLocaleString("en-IN", { maximumFractionDigits: 2 });
      ctx.fillText(label, plot.x + plot.w + 6, y + 3);
    }

    const volY = plot.y + plot.h + 4;
    const vmax = Math.max(...vis.map((c) => c.v), 1);
    vis.forEach((c, vi) => {
      const x = xAt(start + vi) - cw * 0.35;
      const vh = (c.v / vmax) * (volH - 8);
      ctx.fillStyle = c.c >= c.o ? "rgba(61,214,140,0.45)" : "rgba(240,113,120,0.45)";
      ctx.fillRect(x, volY + (volH - 8) - vh, Math.max(1, cw * 0.7), vh);
    });
    ctx.fillStyle = TEXT;
    ctx.font = "10px IBM Plex Sans, sans-serif";
    ctx.fillText("Vol", plot.x + 4, volY + 10);

    osc.forEach((ind, idx) => {
      const oy = volY + volH + idx * 78;
      ctx.fillStyle = theme.bg;
      ctx.fillRect(plot.x, oy, plot.w, 74);
      ctx.fillStyle = TEXT;
      ctx.fillText(ind.label, plot.x + 6, oy + 12);
      const series = computeIndicator(ind, raw);
      let omin = Infinity;
      let omax = -Infinity;
      for (const arr of Object.values(series)) {
        for (let i = start; i < Math.min(end, n); i++) {
          const v = arr[i];
          if (v != null) {
            omin = Math.min(omin, v);
            omax = Math.max(omax, v);
          }
        }
      }
      if (ind.kind === "rsi" || ind.kind === "stoch") {
        omin = 0;
        omax = 100;
        ctx.strokeStyle = GRID;
        [30, 50, 70].forEach((lv) => {
          const y = oy + 18 + ((100 - lv) / 100) * 50;
          ctx.beginPath();
          ctx.moveTo(plot.x, y);
          ctx.lineTo(plot.x + plot.w, y);
          ctx.stroke();
        });
      }
      if (!Number.isFinite(omin)) return;
      const op = (v: number) => oy + 18 + ((omax - v) / (omax - omin || 1)) * 50;
      const bounded = ind.kind === "rsi" || ind.kind === "stoch";
      ctx.fillStyle = TEXT;
      ctx.font = "600 10px IBM Plex Sans, sans-serif";
      ctx.textAlign = "left";
      const ticks = bounded ? [100, 70, 30, 0] : [omax, (omin + omax) / 2, omin];
      ticks.forEach((lv) => {
        const y = op(lv);
        if (y < oy + 14 || y > oy + 72) return;
        ctx.fillText(bounded ? lv.toFixed(0) : lv.toFixed(2), plot.x + plot.w + 6, y + 3);
      });
      ctx.strokeStyle = ind.style.color;
      ctx.lineWidth = 1.2;
      for (const [key, arr] of Object.entries(series)) {
        if (key === "hist") {
          arr.forEach((v, i) => {
            if (v == null || i < start || i >= end) return;
            const zero = op(0);
            const y = op(v);
            ctx.fillStyle = v >= 0 ? UP : DOWN;
            ctx.fillRect(xAt(i) - cw * 0.3, Math.min(zero, y), Math.max(1, cw * 0.6), Math.abs(y - zero) || 1);
          });
          continue;
        }
        ctx.beginPath();
        let started = false;
        arr.forEach((v, i) => {
          if (v == null || i < start || i >= end) return;
          const x = xAt(i);
          const y = op(v);
          if (!started) {
            ctx.moveTo(x, y);
            started = true;
          } else ctx.lineTo(x, y);
        });
        ctx.stroke();
      }
      const lastVals: { key: string; value: number }[] = [];
      for (const [key, arr] of Object.entries(series)) {
        if (key === "marks" || key === "hist") continue;
        for (let i = arr.length - 1; i >= 0; i--) {
          const v = arr[i];
          if (v != null && Number.isFinite(v)) {
            lastVals.push({ key, value: v });
            break;
          }
        }
      }
      lastVals.forEach((row, vi) => {
        const y = Math.min(oy + 70, Math.max(oy + 16, op(row.value)));
        const label = row.value.toFixed(2);
        ctx.fillStyle = vi === 0 ? ind.style.color : "#8b93a3";
        ctx.fillRect(plot.x + plot.w, y - 8, right - 4, 15);
        ctx.fillStyle = "#041210";
        ctx.font = "600 10px IBM Plex Sans, sans-serif";
        ctx.fillText(label, plot.x + plot.w + 4, y + 3);
      });
    });

    ctx.fillStyle = TEXT;
    ctx.font = "10px IBM Plex Sans, sans-serif";
    const stepMs = n >= 2 ? Math.max(1, data[n - 1].t - data[n - 2].t) : 86_400_000;
    const tAt = (i: number) => (i < n ? data[i].t : data[n - 1].t + (i - (n - 1)) * stepMs);
    const step = Math.max(1, Math.floor(span / 7));
    for (let i = start; i < end; i += step) {
      const d = new Date(tAt(i));
      const label = props.tfLabel.endsWith("m") || props.tfLabel.endsWith("H") || props.tfLabel.endsWith("s")
        ? d.toLocaleString("en-IN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
        : d.toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
      ctx.fillText(label, xAt(i) - 18, h - 6);
    }

    if (props.quote?.last) {
      const ly = py(props.quote.last);
      if (ly >= plot.y && ly <= plot.y + plot.h) {
        const upLast = (props.quote.change || 0) >= 0;
        ctx.strokeStyle = upLast ? "rgba(61,214,140,0.55)" : "rgba(240,113,120,0.55)";
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(plot.x, ly);
        ctx.lineTo(plot.x + plot.w, ly);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = upLast ? UP : DOWN;
        ctx.fillRect(plot.x + plot.w, ly - 8, right - 4, 16);
        ctx.fillStyle = "#041210";
        ctx.font = "600 10px IBM Plex Sans, sans-serif";
        ctx.fillText(
          props.quote.last.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
          plot.x + plot.w + 4,
          ly + 3,
        );
      }
    }

    const hover = state.current.hover;
    if (hover && hover.x >= plot.x && hover.x <= plot.x + plot.w + right) {
      const i = Math.min(end - 1, Math.max(start, Math.floor(start + ((hover.x - plot.x) / plot.w) * span)));
      const c = i < n ? data[i] : undefined;
      const x = Math.min(plot.x + plot.w, Math.max(plot.x, xAt(i)));
      const y = Math.min(plot.y + plot.h, Math.max(plot.y, hover.y));
      ctx.strokeStyle = theme.hair;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(x, plot.y);
      ctx.lineTo(x, plot.y + plot.h + volH);
      ctx.moveTo(plot.x, y);
      ctx.lineTo(plot.x + plot.w, y);
      ctx.stroke();
      ctx.setLineDash([]);
      const hoverPrice = priceFromY(y);
      ctx.fillStyle = theme.tip;
      ctx.fillRect(plot.x + plot.w, y - 8, right - 4, 16);
      ctx.fillStyle = theme.tipFg;
      ctx.font = "600 10px IBM Plex Sans, sans-serif";
      ctx.fillText(
        hoverPrice.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        plot.x + plot.w + 4,
        y + 3,
      );
      if (c) {
        const d = new Date(c.t);
        const tLabel =
          props.tfLabel.endsWith("m") || props.tfLabel.endsWith("H") || props.tfLabel.endsWith("s")
            ? d.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
            : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
        const tw = ctx.measureText(tLabel).width + 10;
        ctx.fillStyle = theme.tip;
        ctx.fillRect(Math.min(x - tw / 2, plot.x + plot.w - tw), h - 18, tw, 14);
        ctx.fillStyle = theme.tipFg;
        ctx.font = "10px IBM Plex Sans, sans-serif";
        ctx.fillText(tLabel, Math.min(x - tw / 2 + 5, plot.x + plot.w - tw + 5), h - 8);
      } else {
        const d = new Date(tAt(i));
        const tLabel = d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
        const tw = ctx.measureText(tLabel).width + 10;
        ctx.fillStyle = theme.tip;
        ctx.fillRect(Math.min(x - tw / 2, plot.x + plot.w - tw), h - 18, tw, 14);
        ctx.fillStyle = theme.tipFg;
        ctx.font = "10px IBM Plex Sans, sans-serif";
        ctx.fillText(tLabel, Math.min(x - tw / 2 + 5, plot.x + plot.w - tw + 5), h - 8);
      }
    }
  }

  function pointerZone(x: number, y: number): "plot" | "price" | "time" {
    const { plot, h, bottom } = state.current.layout;
    if (x >= plot.x + plot.w) return "price";
    if (y >= h - bottom - 4) return "time";
    return "plot";
  }

  function hitWorld(clientX: number, clientY: number) {
    const rect = canvas.current!.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const { plot } = state.current.layout;
    const { start, end } = state.current;
    const span = Math.max(1, end - start);
    const i = start + ((x - plot.x) / plot.w) * span;
    return { x, y, i, price: priceFromY(y), zone: pointerZone(x, y) };
  }

  function onPointerDown(e: React.PointerEvent) {
    if (e.button === 2) return;
    const w = hitWorld(e.clientX, e.clientY);
    const tool = props.tool;
    canvas.current?.setPointerCapture(e.pointerId);
    if (w.zone === "price") {
      state.current.drag = {
        mode: "price",
        x: w.x,
        y: w.y,
        start: state.current.start,
        end: state.current.end,
        priceMin: state.current.priceMin,
        priceMax: state.current.priceMax,
      };
      state.current.cursor = "ns-resize";
      setCursor("ns-resize");
      return;
    }
    if (w.zone === "time") {
      state.current.drag = {
        mode: "time",
        x: w.x,
        y: w.y,
        start: state.current.start,
        end: state.current.end,
        priceMin: state.current.priceMin,
        priceMax: state.current.priceMax,
      };
      state.current.cursor = "ew-resize";
      setCursor("ew-resize");
      return;
    }
    if (tool === "cursor" || tool === "crosshair") {
      const posHit = hitPosition(w.price);
      if (posHit) {
        state.current.drag = {
          mode: "level",
          x: w.x,
          y: w.y,
          start: state.current.start,
          end: state.current.end,
          priceMin: state.current.priceMin,
          priceMax: state.current.priceMax,
          id: posHit.id,
          field: posHit.field,
        };
        return;
      }
      const dhit = hitDrawing(w.i, w.price);
      if (dhit) {
        props.onSelect(dhit, "drawing");
        state.current.drag = {
          mode: "move-draw",
          x: w.x,
          y: w.y,
          start: state.current.start,
          end: state.current.end,
          priceMin: state.current.priceMin,
          priceMax: state.current.priceMax,
          id: dhit,
        };
        return;
      }
      props.onSelect(null, null);
      state.current.drag = {
        mode: "pan",
        x: w.x,
        y: w.y,
        start: state.current.start,
        end: state.current.end,
        priceMin: state.current.priceMin,
        priceMax: state.current.priceMax,
      };
      state.current.cursor = "grabbing";
      setCursor("grabbing");
      return;
    }
    const pts = [...state.current.draft, { i: w.i, price: w.price }];
    const need = pointsNeeded(tool);
    if (tool === "brush" || tool === "highlight") {
      state.current.draft = pts;
      state.current.drag = {
        mode: "brush",
        x: w.x,
        y: w.y,
        start: state.current.start,
        end: state.current.end,
        priceMin: state.current.priceMin,
        priceMax: state.current.priceMax,
      };
      return;
    }
    if (pts.length >= need) {
      commitDrawing(tool as DrawingKind, pts);
      state.current.draft = [];
    } else state.current.draft = pts;
    draw();
  }

  function onPointerMove(e: React.PointerEvent) {
    const w = hitWorld(e.clientX, e.clientY);
    state.current.hover = { x: w.x, y: w.y };
    const data = props.candles;
    if (data.length) {
      if (w.i >= data.length) {
        props.onHover(null);
      } else {
        const i = Math.min(data.length - 1, Math.max(0, Math.floor(w.i)));
        const c = data[i];
        if (c) props.onHover({ o: c.o, h: c.h, l: c.l, c: c.c, v: c.v, t: c.t });
      }
    }
    const drag = state.current.drag;
    if (!drag) {
      setCursor(w.zone === "price" ? "ns-resize" : w.zone === "time" ? "ew-resize" : props.tool === "cursor" ? "default" : "crosshair");
    } else if (drag.mode === "pan") {
      const dx = w.x - drag.x;
      const vis = drag.end - drag.start;
      const n = props.candles.length;
      const pad = state.current.rightPad || rightPadFor();
      const shift = Math.round((-dx / Math.max(1, state.current.layout.plot.w)) * vis);
      const maxEnd = n + pad;
      let nextStart = drag.start + shift;
      nextStart = Math.max(0, Math.min(nextStart, Math.max(0, maxEnd - vis)));
      state.current.start = nextStart;
      state.current.end = nextStart + vis;
      state.current.followRight = state.current.end >= maxEnd - 1;
    } else if (drag.mode === "price") {
      const range = Math.max(1e-8, drag.priceMax - drag.priceMin);
      const dy = w.y - drag.y;
      const factor = Math.max(0.12, 1 + dy / Math.max(40, state.current.layout.plot.h));
      const mid = (drag.priceMin + drag.priceMax) / 2;
      const next = range * factor;
      state.current.priceMin = mid - next / 2;
      state.current.priceMax = mid + next / 2;
      state.current.autoPrice = false;
    } else if (drag.mode === "time") {
      const vis = Math.max(20, drag.end - drag.start);
      const dx = w.x - drag.x;
      const factor = Math.max(0.2, 1 - dx / Math.max(40, state.current.layout.plot.w));
      const n = props.candles.length;
      const pad = state.current.rightPad || rightPadFor();
      const next = Math.max(20, Math.min(n + pad, Math.round(vis * factor)));
      state.current.end = Math.min(n + pad, drag.end);
      state.current.start = Math.max(0, state.current.end - next);
      state.current.followRight = state.current.end >= n + pad - 1;
    } else if (drag.mode === "level" && drag.id && drag.field) {
      props.onDragLevel(drag.id, drag.field, w.price);
    } else if (drag.mode === "brush") {
      state.current.draft = [...state.current.draft, { i: w.i, price: w.price }];
    } else if (drag.mode === "move-draw" && drag.id) {
      const dy = w.price - priceFromY(drag.y);
      props.onDrawings((ds) =>
        ds.map((d) => (d.id === drag.id && !d.locked ? { ...d, points: d.points.map((p) => ({ ...p, price: p.price + dy })) } : d)),
      );
      drag.y = w.y;
    }
    draw();
  }

  function priceFromY(y: number) {
    const { plot } = state.current.layout;
    const { priceMin, priceMax } = state.current;
    const t = (y - plot.y) / (plot.h || 1);
    if (propsRef.current.scaleMode === "log") {
      const a = Math.log(Math.max(priceMin, 1e-8));
      const b = Math.log(Math.max(priceMax, 1e-8));
      return Math.exp(b - t * (b - a));
    }
    return priceMax - t * (priceMax - priceMin);
  }

  function setCursor(value: string) {
    state.current.cursor = value;
    if (canvas.current) canvas.current.style.cursor = value;
  }

  function onPointerUp(e: React.PointerEvent) {
    if (state.current.drag?.mode === "brush" && state.current.draft.length) {
      commitDrawing(props.tool as DrawingKind, state.current.draft);
      state.current.draft = [];
    }
    state.current.drag = null;
    setCursor("crosshair");
    canvas.current?.releasePointerCapture(e.pointerId);
    draw();
  }

  function onDblClick(e: React.MouseEvent) {
    const w = hitWorld(e.clientX, e.clientY);
    if (w.zone === "price") {
      state.current.autoPrice = true;
      draw();
      return;
    }
    const n = props.candles.length;
    const pad = rightPadFor();
    state.current.rightPad = pad;
    state.current.end = n + pad;
    state.current.start = Math.max(0, state.current.end - DEFAULT_BARS);
    state.current.followRight = true;
    state.current.autoPrice = true;
    draw();
  }

  function onContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    const w = hitWorld(e.clientX, e.clientY);
    props.onContext({ x: e.clientX, y: e.clientY, price: w.price, i: w.i });
  }

  function commitDrawing(kind: DrawingKind | "cursor" | "crosshair", points: { i: number; price: number }[]) {
    if (kind === "cursor" || kind === "crosshair") return;
    const d: Drawing = {
      id: nid(),
      kind,
      points,
      color: kind.includes("fib") ? "#c084fc" : "#6ea8ff",
      width: 1.2,
      opacity: 1,
      dash: "solid",
      extendLeft: kind === "extended",
      extendRight: kind === "ray" || kind === "extended" || kind === "hline",
      labels: true,
      locked: false,
      hidden: false,
    };
    props.onDrawings((ds) => [...ds, d]);
    props.onSelect(d.id, "drawing");
  }

  function hitDrawing(i: number, price: number) {
    const tolP = (state.current.priceMax - state.current.priceMin) * 0.012;
    for (let k = props.drawings.length - 1; k >= 0; k--) {
      const d = props.drawings[k];
      if (d.hidden) continue;
      for (const p of d.points) {
        if (Math.abs(p.i - i) < 1.2 && Math.abs(p.price - price) < tolP) return d.id;
      }
      if (d.kind === "hline" && d.points[0] && Math.abs(d.points[0].price - price) < tolP) return d.id;
    }
    return null;
  }

  function hitPosition(price: number): { id: string; field: "sl" | "tp" } | null {
    const tolP = (state.current.priceMax - state.current.priceMin) * 0.01;
    for (const p of props.positions) {
      if (p.status === "closed") continue;
      if (p.sl != null && Math.abs(p.sl - price) < tolP) return { id: p.id, field: "sl" };
      if (p.tp != null && Math.abs(p.tp - price) < tolP) return { id: p.id, field: "tp" };
    }
    return null;
  }

  return (
    <div ref={wrap} className="term-chart-wrap" data-view-key={props.viewKey} data-chart-ready={props.candles.length ? "true" : "false"} data-right-pad="0" data-future-bars="0">
      <canvas
        ref={canvas}
        className="term-chart-canvas"
        style={{ cursor: state.current.cursor }}
        aria-label={`${props.symbolLabel} price chart. Drag to pan time, drag the right scale to zoom price, scroll to zoom.`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={onDblClick}
        onContextMenu={onContextMenu}
        onPointerLeave={() => {
          state.current.hover = null;
          props.onHover(null);
          draw();
        }}
      />
    </div>
  );
}

function nearestIndex(data: Candle[], t: number) {
  let best = 0;
  let dist = Infinity;
  data.forEach((c, i) => {
    const d = Math.abs(c.t - t);
    if (d < dist) {
      dist = d;
      best = i;
    }
  });
  return best;
}

function pointsNeeded(tool: string) {
  if (["hline", "vline", "text", "callout"].includes(tool)) return 1;
  if (["triangle", "pitchfork"].includes(tool)) return 3;
  if (tool === "polygon") return 4;
  return 2;
}

function drawShape(
  ctx: CanvasRenderingContext2D,
  d: Drawing,
  xAt: (i: number) => number,
  py: (p: number) => number,
  selected: boolean,
  plot: { x: number; w: number; y: number; h: number },
) {
  ctx.save();
  ctx.globalAlpha = d.opacity;
  ctx.strokeStyle = d.color;
  ctx.fillStyle = d.color;
  ctx.lineWidth = selected ? d.width + 0.8 : d.width;
  if (d.dash === "dash") ctx.setLineDash([6, 4]);
  if (d.dash === "dot") ctx.setLineDash([2, 3]);
  const pts = d.points.map((p) => ({ x: xAt(p.i), y: py(p.price) }));
  if (!pts.length) {
    ctx.restore();
    return;
  }
  if (d.kind === "hline") {
    const y = pts[0].y;
    ctx.beginPath();
    ctx.moveTo(plot.x, y);
    ctx.lineTo(plot.x + plot.w, y);
    ctx.stroke();
  } else if (d.kind === "vline") {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, plot.y);
    ctx.lineTo(pts[0].x, plot.y + plot.h);
    ctx.stroke();
  } else if (d.kind === "rect" || d.kind === "daterange" || d.kind === "pricerange") {
    if (pts[1]) {
      ctx.globalAlpha = 0.12;
      ctx.fillRect(pts[0].x, pts[0].y, pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      ctx.globalAlpha = d.opacity;
      ctx.strokeRect(pts[0].x, pts[0].y, pts[1].x - pts[0].x, pts[1].y - pts[0].y);
    }
  } else if (d.kind === "circle" || d.kind === "ellipse") {
    if (pts[1]) {
      const rx = Math.abs(pts[1].x - pts[0].x);
      const ry = d.kind === "circle" ? rx : Math.abs(pts[1].y - pts[0].y);
      ctx.beginPath();
      ctx.ellipse(pts[0].x, pts[0].y, rx || 1, ry || 1, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  } else if (d.kind === "fib" || d.kind === "fibext" || d.kind === "fibchannel") {
    if (pts[1]) {
      const levels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
      const p0 = d.points[0].price;
      const p1 = d.points[1].price;
      levels.forEach((lv) => {
        const price = p0 + (p1 - p0) * lv;
        const y = py(price);
        ctx.beginPath();
        ctx.moveTo(plot.x, y);
        ctx.lineTo(plot.x + plot.w, y);
        ctx.stroke();
        if (d.labels) {
          ctx.font = "10px IBM Plex Sans, sans-serif";
          ctx.fillText(`${(lv * 100).toFixed(1)}  ${price.toFixed(2)}`, plot.x + 8, y - 3);
        }
      });
    }
  } else if (d.kind === "text" || d.kind === "callout") {
    ctx.font = "12px IBM Plex Sans, sans-serif";
    ctx.fillText(d.text || "Text", pts[0].x, pts[0].y);
  } else if (d.kind === "brush" || d.kind === "highlight") {
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.stroke();
  } else {
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    if (d.extendRight && pts.length >= 2) {
      const dx = pts[1].x - pts[0].x || 1;
      const dy = pts[1].y - pts[0].y;
      ctx.lineTo(plot.x + plot.w, pts[1].y + (dy / dx) * (plot.x + plot.w - pts[1].x));
    }
    ctx.stroke();
  }
  if (selected) {
    pts.forEach((p) => {
          ctx.fillStyle = FG;
          ctx.fillRect(p.x - 3, p.y - 3, 6, 6);
    });
  }
  ctx.restore();
}

function lineLabel(ctx: CanvasRenderingContext2D, plot: { x: number; w: number }, y: number, color: string, text: string) {
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.85;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  ctx.moveTo(plot.x, y);
  ctx.lineTo(plot.x + plot.w, y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
  ctx.font = "10px IBM Plex Sans, sans-serif";
  const tw = ctx.measureText(text).width + 10;
  ctx.fillStyle = color;
  ctx.fillRect(plot.x + 8, y - 14, tw, 14);
  ctx.fillStyle = "#041210";
  ctx.fillText(text, plot.x + 13, y - 4);
}
