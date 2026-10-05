"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  KeyboardEvent as RKeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { api } from "@/lib/api";
import {
  closePosition,
  equity,
  execPrice,
  historyFilter,
  invested,
  matchPending,
  modifyPosition,
  placeOrder,
  resetAccount,
  stats,
  toCsv,
  unrealized,
} from "@/lib/trading/engine";
import { catalogEntry, createIndicator, formatIndicatorValue, INDICATOR_CATALOG, latestIndicatorValues } from "@/lib/trading/indicators";
import { applyLiveLast, applyTick, candlesFor, depthLadder, quoteFromCandles, quoteFromLive, seedKey } from "@/lib/trading/market";
import { cloneDrawings, cloneIndicators, defaultSlots, loadPersist, PersistShape, savePersist } from "@/lib/trading/persist";
import { dur, inr, pct, px, signedInr, signedPx, vol } from "@/lib/trading/format";
import type {
  Alert,
  Candle,
  ChartType,
  Drawing,
  DrawingKind,
  IndicatorInstance,
  Quote,
  Side,
  Trade,
} from "@/lib/trading/types";
import { CLASS_LABEL, NSE_INDEX_FILTERS, equityCount, findSymbol, indexSymbols, isPlaceholderSymbol, registerEquities, searchSymbols, TIMEFRAMES, UNIVERSE } from "@/lib/trading/universe";
import { ChartCanvas, ChartHandle, ScaleMode } from "./ChartCanvas";
import { DeskNav, DeskView } from "./DeskNav";
import { FinancialsPane } from "./FinancialsPane";
import { HeatMap } from "./HeatMap";
import { LevelField } from "./LevelField";
import { PortfolioBoard } from "./PortfolioBoard";
import { DeskMark } from "./DeskMark";
import { PositionPie } from "./PositionPie";
import { Confetti, PnlHistoryChart, PnlSpark, PracticeStrip } from "./PnlCharts";
import { TradeTicket, TicketValues } from "./TradeTicket";
import { positionSeries, usePnlSession, type PnlEvent } from "./usePnlSession";
import { WorldMap } from "./WorldMap";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { AppSwitch } from "@/components/AppSwitch";
import { ConnectLogo } from "@/components/ConnectLogo";
import { withViewTransition } from "@/lib/motion";

const CHART_TYPES: { id: ChartType; label: string }[] = [
  { id: "candles", label: "Candles" },
  { id: "hollow", label: "Hollow candles" },
  { id: "bars", label: "Bars" },
  { id: "line", label: "Line" },
  { id: "area", label: "Area" },
  { id: "baseline", label: "Baseline" },
  { id: "heikin", label: "Heikin Ashi" },
  { id: "renko", label: "Renko" },
  { id: "kagi", label: "Kagi" },
  { id: "pnf", label: "Point & Figure" },
  { id: "linebreak", label: "Line break" },
];

const DRAW_GROUPS: { id: string; label: string; items: { kind: DrawingKind | "cursor" | "crosshair"; label: string }[] }[] = [
  { id: "cursor", label: "Cursor", items: [{ kind: "cursor", label: "Cursor" }, { kind: "crosshair", label: "Crosshair" }] },
  { id: "trend", label: "Trend", items: [{ kind: "trend", label: "Trend line" }, { kind: "ray", label: "Ray" }, { kind: "extended", label: "Extended line" }] },
  { id: "levels", label: "Levels", items: [{ kind: "hline", label: "Horizontal line" }, { kind: "vline", label: "Vertical line" }] },
  { id: "channel", label: "Channel", items: [{ kind: "channel", label: "Parallel channel" }, { kind: "regression", label: "Regression channel" }] },
  { id: "fib", label: "Fibonacci", items: [{ kind: "fib", label: "Retracement" }, { kind: "fibext", label: "Extension" }, { kind: "fibfan", label: "Fan" }, { kind: "fibchannel", label: "Channel" }, { kind: "fibtime", label: "Time zones" }] },
  { id: "shape", label: "Shapes", items: [{ kind: "rect", label: "Rectangle" }, { kind: "circle", label: "Circle" }, { kind: "ellipse", label: "Ellipse" }, { kind: "triangle", label: "Triangle" }, { kind: "polygon", label: "Polygon" }] },
  { id: "annotate", label: "Annotate", items: [{ kind: "brush", label: "Brush" }, { kind: "highlight", label: "Highlighter" }, { kind: "arrow", label: "Arrow" }, { kind: "text", label: "Text" }, { kind: "callout", label: "Callout" }] },
  { id: "measure", label: "Measure", items: [{ kind: "measure", label: "Measure" }, { kind: "daterange", label: "Date range" }, { kind: "pricerange", label: "Price range" }, { kind: "forecast", label: "Forecast" }] },
  { id: "position", label: "Position", items: [{ kind: "longpos", label: "Long position" }, { kind: "shortpos", label: "Short position" }, { kind: "pitchfork", label: "Pitchfork" }] },
];

type Overlay =
  | null
  | "search"
  | "indicators"
  | "tf"
  | "type"
  | "settings"
  | "layouts"
  | "alerts"
  | "replay"
  | "portfolio"
  | "objects"
  | "reset"
  | "financials";

type ToastTone = "good" | "bad" | "info";
type ToastItem = { id: string; text: string; tone: ToastTone };

const money0 = (v: number) => inr(v, 0);
const signed0 = (v: number) => signedInr(v, 0);

function unitWord(symbol: string, qty: number) {
  const cls = findSymbol(symbol).assetClass;
  const noun = cls === "stock" || cls === "etf" ? "share" : "unit";
  return qty === 1 ? noun : `${noun}s`;
}

export function Terminal({ userId, name }: { userId: string; name: string }) {
  const router = useRouter();
  const [store, setStore] = useState<PersistShape>(() => loadPersist(userId));
  const [slot, setSlot] = useState(0);
  const [indicators, setIndicators] = useState<IndicatorInstance[]>([
    createIndicator("volume", 0),
  ]);
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [tool, setTool] = useState<DrawingKind | "cursor" | "crosshair">("crosshair");
  const [selected, setSelected] = useState<{ id: string; kind: "drawing" | "indicator" | "position" } | null>(null);
  const [right, setRight] = useState<"watchlist" | "details" | "trade">("watchlist");
  const [bottomTab, setBottomTab] = useState<"positions" | "orders" | "history" | "portfolio" | "journal" | "account">("positions");
  const [journalId, setJournalId] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [drawGroup, setDrawGroup] = useState<string | null>(null);
  const [ctx, setCtx] = useState<{ x: number; y: number } | null>(null);
  const [scaleMode, setScaleMode] = useState<ScaleMode>("linear");
  const [hover, setHover] = useState<{ o: number; h: number; l: number; c: number; v: number; t: number } | null>(null);
  const [confirm, setConfirm] = useState<null | { kind: "order"; values: TicketValues } | { kind: "close"; id: string }>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [burst, setBurst] = useState(0);
  const [cheer, setCheer] = useState(false);
  const toastSeq = useRef(0);
  const [replay, setReplay] = useState<{ on: boolean; index: number; speed: number; playing: boolean }>({ on: false, index: 0, speed: 1, playing: false });
  const [indQ, setIndQ] = useState("");
  const [symQ, setSymQ] = useState("");
  const [symIndex, setSymIndex] = useState("");
  const [universeReady, setUniverseReady] = useState(false);
  const [wlQ, setWlQ] = useState("");
  const [settingsTab, setSettingsTab] = useState("Chart");
  const [indEdit, setIndEdit] = useState<string | null>(null);
  const [mobile, setMobile] = useState<"chart" | "markets" | "trade" | "positions" | "portfolio">("chart");
  const [histRange, setHistRange] = useState<"today" | "week" | "month" | "all">("all");
  const [ticketSide, setTicketSide] = useState<Side>("buy");
  const [deskView, setDeskView] = useState<DeskView>("chart");
  const [candlesMap, setCandlesMap] = useState<Map<string, Candle[]>>(() => new Map());
  const [quotes, setQuotes] = useState<Map<string, Quote>>(() => new Map());
  const [quotesLoading, setQuotesLoading] = useState(false);
  const [feedStatus, setFeedStatus] = useState<"loading" | "live" | "sim">("loading");
  const [compareSymbol, setCompareSymbol] = useState<string | null>(null);
  const [searchIntent, setSearchIntent] = useState<"chart" | "compare" | "watchlist">("chart");
  const [flyPos, setFlyPos] = useState({ top: 44, left: 48 });
  const [wlMenu, setWlMenu] = useState<{ x: number; y: number; symbol: string } | null>(null);
  const [flashes, setFlashes] = useState<Map<string, "up" | "down">>(() => new Map());
  const [pxPulse, setPxPulse] = useState<"up" | "down" | null>(null);
  const prevLast = useRef(new Map<string, number>());
  const chartPxRef = useRef(0);
  const tfBtnRef = useRef<HTMLButtonElement>(null);
  const typeBtnRef = useRef<HTMLButtonElement>(null);
  const chartApi = useRef<ChartHandle | null>(null);
  const undo = useRef<{ ind: IndicatorInstance[]; draw: Drawing[] }[]>([]);
  const redo = useRef<{ ind: IndicatorInstance[]; draw: Drawing[] }[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);
  const indBtnRef = useRef<HTMLButtonElement>(null);
  const engine = store.engine;
  const active = store.slots[slot] || store.slots[0];
  const info = findSymbol(active.symbol);
  const key = seedKey(active.symbol, active.timeframe);
  const candles = candlesMap.get(key) || [];
  const quote = quotes.get(active.symbol) || null;
  const tf = TIMEFRAMES.find((t) => t.id === active.timeframe) || TIMEFRAMES[9];
  const qMap = quotes;

  const dismissToast = useCallback((id: string) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const toast = useCallback(
    (text: string, tone: ToastTone = "info", ms = 2800) => {
      toastSeq.current += 1;
      const id = `${Date.now()}-${toastSeq.current}`;
      setToasts((t) => [...t.slice(-3), { id, text, tone }]);
      window.setTimeout(() => dismissToast(id), ms);
    },
    [dismissToast],
  );

  const snapshot = () => {
    undo.current.push({ ind: cloneIndicators(indicators), draw: cloneDrawings(drawings) });
    redo.current = [];
  };

  useEffect(() => {
    const next = new Map(candlesMap);
    for (const s of store.slots.slice(0, store.chartCount)) {
      const k = seedKey(s.symbol, s.timeframe);
      if (!next.has(k)) next.set(k, candlesFor(s.symbol, s.timeframe));
    }
    for (const s of UNIVERSE) {
      const k = seedKey(s.symbol, "1D");
      if (!next.has(k)) next.set(k, candlesFor(s.symbol, "1D", 400));
    }
    setCandlesMap(next);
    const qm = new Map<string, Quote>();
    for (const s of UNIVERSE) {
      const c = next.get(seedKey(s.symbol, "1D")) || [];
      if (c.length) qm.set(s.symbol, quoteFromCandles(s.symbol, c));
    }
    setQuotes(qm);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    (async () => {
      try {
        const data = await api.marketUniverse({ limit: 4000 }, ac.signal);
        if (ac.signal.aborted) return;
        registerEquities(data.items || []);
        setUniverseReady(true);
        const lists = [
          { id: "nifty50", name: "Nifty 50", symbols: indexSymbols("Nifty 50").filter((s) => !isPlaceholderSymbol(s)) },
          { id: "nifty-midcap", name: "Nifty Midcap 150", symbols: indexSymbols("Nifty Midcap 150").filter((s) => !isPlaceholderSymbol(s)) },
          { id: "nifty-midcap250", name: "Nifty Midcap 250", symbols: indexSymbols("Nifty LargeMidcap 250").filter((s) => !isPlaceholderSymbol(s)) },
          { id: "nifty-smallcap", name: "Nifty Smallcap 250", symbols: indexSymbols("Nifty Smallcap 250").filter((s) => !isPlaceholderSymbol(s)) },
        ].filter((w) => w.symbols.length);
        if (!lists.length) return;
        setStore((s) => {
          const incoming = new Map(lists.map((w) => [w.id, w]));
          const next = s.watchlists.map((w) => (incoming.has(w.id) ? { ...w, symbols: incoming.get(w.id)!.symbols } : w));
          for (const w of lists) {
            if (!s.watchlists.some((x) => x.id === w.id)) next.push(w);
          }
          return { ...s, watchlists: next };
        });
      } catch {
        if (!ac.signal.aborted) setUniverseReady(true);
      }
    })();
    return () => ac.abort();
  }, [setStore]);

  useEffect(() => {
    savePersist(userId, store);
  }, [store, userId]);

  useEffect(() => {
    const ac = new AbortController();
    setFeedStatus("loading");
    (async () => {
      try {
        const data = await api.marketOhlc(active.symbol, active.timeframe, ac.signal);
        if (data.candles?.length) {
          setCandlesMap((m) => {
            const n = new Map(m);
            n.set(key, data.candles.map((c) => ({ t: c.t, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v })));
            return n;
          });
          setFeedStatus("live");
          return;
        }
      } catch {
        if (ac.signal.aborted) return;
      }
      setCandlesMap((m) => {
        if ((m.get(key)?.length || 0) > 0) return m;
        const n = new Map(m);
        n.set(key, candlesFor(active.symbol, active.timeframe));
        return n;
      });
      setFeedStatus("sim");
    })();
    return () => ac.abort();
  }, [active.symbol, active.timeframe, key]);

  useEffect(() => {
    const list = store.watchlists.find((w) => w.id === store.activeWatchlistId) || store.watchlists[0];
    const extras = store.engine.positions.filter((p) => p.status !== "closed").map((p) => p.symbol);
    const symbols = [...new Set(["NIFTY", "BANKNIFTY", active.symbol, ...(list?.symbols || []), ...extras])];
    let timer = 0;
    let ac = new AbortController();
    const QUOTE_CHUNK = 50;
    const pull = async () => {
      if (document.hidden) return;
      ac.abort();
      ac = new AbortController();
      setQuotesLoading(true);
      try {
        for (let i = 0; i < symbols.length; i += QUOTE_CHUNK) {
          if (ac.signal.aborted) return;
          const batch = symbols.slice(i, i + QUOTE_CHUNK);
          const data = await api.marketQuotes(batch, ac.signal);
          if (!data.quotes?.length) continue;
          setQuotes((prev) => {
            const next = new Map(prev);
            for (const q of data.quotes) next.set(q.symbol, quoteFromLive(q.symbol, q));
            return next;
          });
          const live = data.quotes.find((q) => q.symbol === active.symbol);
          if (live?.last) {
            setCandlesMap((prev) => {
              const series = prev.get(key);
              if (!series?.length) return prev;
              const n = new Map(prev);
              n.set(key, applyLiveLast(series, live.last));
              return n;
            });
            setFeedStatus("live");
          }
        }
      } catch {
        /* keep last known quote */
      } finally {
        if (!ac.signal.aborted) setQuotesLoading(false);
      }
    };
    pull();
    timer = window.setInterval(pull, 20_000);
    const onVis = () => {
      if (!document.hidden) pull();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(timer);
      ac.abort();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [active.symbol, deskView, key, store.activeWatchlistId, store.engine.positions, store.watchlists, universeReady]);

  useEffect(() => {
    if (!replay.on) return;
    const id = window.setInterval(() => {
      if (!replay.playing) return;
      setReplay((r) => ({ ...r, index: Math.min((candlesMap.get(key)?.length || 1) - 1, r.index + r.speed) }));
    }, 220);
    return () => window.clearInterval(id);
  }, [candlesMap, key, replay.on, replay.playing, replay.speed]);

  useEffect(() => {
    if (feedStatus === "live") return;
    const id = window.setInterval(() => {
      if (replay.on) return;
      setCandlesMap((prev) => {
        const series = prev.get(key);
        if (!series) return prev;
        const ticked = applyTick(series, tf.seconds, Math.random, info.volatility);
        const next = new Map(prev);
        next.set(key, ticked);
        setQuotes((q) => {
          const nq = new Map(q);
          nq.set(active.symbol, quoteFromCandles(active.symbol, ticked));
          return nq;
        });
        return next;
      });
    }, 20_000);
    return () => window.clearInterval(id);
  }, [active.symbol, feedStatus, info.volatility, key, replay.on, tf.seconds]);

  useEffect(() => {
    setStore((s) => {
      const eng = matchPending(s.engine, qMap);
      if (eng === s.engine) return s;
      return { ...s, engine: eng };
    });
    for (const a of store.alerts) {
      if (!a.enabled || a.fired) continue;
      let hit = false;
      if (a.cond.kind === "price") {
        const last = quotes.get(a.cond.symbol)?.last;
        if (last != null) hit = a.cond.op === ">" ? last > a.cond.value : last < a.cond.value;
      }
      if (a.cond.kind === "pnl") {
        const day = equity(engine, qMap) - engine.account.dayPnlStartEquity;
        hit = a.cond.op === ">" ? day > a.cond.value : day < a.cond.value;
      }
      if (hit) {
        toast(`Alert · ${a.label}`);
        setStore((s) => ({ ...s, alerts: s.alerts.map((x) => (x.id === a.id ? { ...x, fired: true } : x)) }));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quotes]);

  useEffect(() => {
    const next = new Map<string, "up" | "down">();
    quotes.forEach((q, sym) => {
      const prev = prevLast.current.get(sym);
      if (prev != null && q.last !== prev) next.set(sym, q.last > prev ? "up" : "down");
      prevLast.current.set(sym, q.last);
    });
    if (!next.size) return;
    setFlashes(next);
    const id = window.setTimeout(() => setFlashes(new Map()), 420);
    return () => window.clearTimeout(id);
  }, [quotes]);

  useEffect(() => {
    if (!compareSymbol) return;
    const k = seedKey(compareSymbol, active.timeframe);
    setCandlesMap((prev) => {
      if (prev.has(k)) return prev;
      const next = new Map(prev);
      next.set(k, candlesFor(compareSymbol, active.timeframe));
      return next;
    });
  }, [active.timeframe, compareSymbol]);

  useEffect(() => {
    if (!drawGroup && overlay !== "tf" && overlay !== "type" && !wlMenu) return;
    function onPtr(e: PointerEvent) {
      const t = e.target as HTMLElement;
      if (t.closest(".term-fly") || t.closest("[aria-haspopup]")) return;
      setDrawGroup(null);
      setWlMenu(null);
      if (overlay === "tf" || overlay === "type") setOverlay(null);
    }
    window.addEventListener("pointerdown", onPtr);
    return () => window.removeEventListener("pointerdown", onPtr);
  }, [drawGroup, overlay, wlMenu]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
      if (e.key === "Escape") {
        if (overlay || ctx || drawGroup || confirm || wlMenu || indEdit) {
          setOverlay(null);
          setCtx(null);
          setDrawGroup(null);
          setConfirm(null);
          setWlMenu(null);
          setIndEdit(null);
          setSearchIntent("chart");
          return;
        }
        setSelected(null);
        setTool("crosshair");
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOverlay("search");
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "i") {
        e.preventDefault();
        const el = indBtnRef.current;
        if (el) {
          const r = el.getBoundingClientRect();
          setFlyPos({ top: r.bottom + 4, left: r.left });
        }
        setOverlay("indicators");
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        const prev = undo.current.pop();
        if (prev) {
          redo.current.push({ ind: cloneIndicators(indicators), draw: cloneDrawings(drawings) });
          setIndicators(prev.ind);
          setDrawings(prev.draw);
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        const nxt = redo.current.pop();
        if (nxt) {
          undo.current.push({ ind: cloneIndicators(indicators), draw: cloneDrawings(drawings) });
          setIndicators(nxt.ind);
          setDrawings(nxt.draw);
        }
        return;
      }
      if (e.key === "F11") {
        e.preventDefault();
        const root = document.querySelector(".term-root");
        if (!document.fullscreenElement) root?.requestFullscreen();
        else document.exitFullscreen();
        return;
      }
      if (typing) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selected?.kind === "drawing") {
          snapshot();
          setDrawings((d) => d.filter((x) => x.id !== selected.id));
          setSelected(null);
        }
        if (selected?.kind === "indicator") {
          snapshot();
          setIndicators((d) => d.filter((x) => x.id !== selected.id));
          setSelected(null);
        }
      }
      if (e.key === " " ) {
        e.preventDefault();
        setOverlay("replay");
        setReplay((r) => ({ ...r, on: true, playing: !r.playing, index: r.on ? r.index : Math.max(0, candles.length - 200) }));
      }
      if (e.key.toLowerCase() === "b") {
        setTicketSide("buy");
        setRight("trade");
        setConfirm(null);
      }
      if (e.key.toLowerCase() === "s" && !e.ctrlKey) {
        setTicketSide("sell");
        setRight("trade");
      }
      if (e.altKey && e.key.toLowerCase() === "t") {
        e.preventDefault();
        setRight("trade");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [candles.length, drawings, indicators, selected]);

  useEffect(() => {
    if (overlay === "search") searchRef.current?.focus();
  }, [overlay]);

  function patchSlot(partial: Partial<typeof active>) {
    setStore((s) => {
      const slots = s.slots.map((x, i) => {
        if (i === slot) return { ...x, ...partial };
        if (s.sync.symbol && partial.symbol) return { ...x, symbol: partial.symbol };
        if (s.sync.timeframe && partial.timeframe) return { ...x, timeframe: partial.timeframe };
        return x;
      });
      return { ...s, slots, recentSymbols: partial.symbol ? [partial.symbol, ...s.recentSymbols.filter((x) => x !== partial.symbol)].slice(0, 8) : s.recentSymbols };
    });
    if (partial.symbol || partial.timeframe) {
      const sym = partial.symbol || active.symbol;
      const t = partial.timeframe || active.timeframe;
      const k = seedKey(sym, t);
      setCandlesMap((m) => {
        if (m.has(k)) return m;
        const n = new Map(m);
        n.set(k, candlesFor(sym, t));
        return n;
      });
    }
  }

  function anchorFly(el: HTMLElement, mode: "below" | "right") {
    const root = document.querySelector(".term-root") as HTMLElement | null;
    const rb = root?.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (!rb) return { top: r.bottom + 4, left: r.left };
    if (mode === "right") return { top: r.top - rb.top, left: r.right + 6 - rb.left };
    return { top: r.bottom + 4 - rb.top, left: Math.max(8, r.left - rb.left) };
  }

  function pickSymbol(sym: string) {
    if (searchIntent === "compare") {
      setCompareSymbol(sym === active.symbol ? null : sym);
      setOverlay(null);
      setSearchIntent("chart");
      toast(sym === active.symbol ? "Compare cleared." : `Comparing ${sym}`);
      return;
    }
    if (searchIntent === "watchlist") {
      setStore((st) => ({
        ...st,
        watchlists: st.watchlists.map((w) =>
          w.id === st.activeWatchlistId ? { ...w, symbols: [...new Set([...w.symbols, sym])] } : w,
        ),
      }));
      setOverlay(null);
      setSearchIntent("chart");
      toast(`${sym} added to watchlist.`);
      return;
    }
    patchSlot({ symbol: sym });
    setOverlay(null);
  }

  function toggleFavorite() {
    const has = (store.watchlists.find((w) => w.id === "mine")?.symbols || []).includes(active.symbol);
    setStore((s) => ({
      ...s,
      watchlists: s.watchlists.map((w) => {
        if (w.id !== "mine") return w;
        return {
          ...w,
          symbols: has ? w.symbols.filter((x) => x !== active.symbol) : [active.symbol, ...w.symbols],
        };
      }),
    }));
    toast(has ? "Removed from watchlist." : "Added to watchlist.");
  }

  function addIndicator(kind: IndicatorInstance["kind"]) {
    snapshot();
    const inst = createIndicator(kind, indicators.length);
    if (kind === "ema") {
      const n = indicators.filter((i) => i.kind === "ema").length;
      inst.inputs.length = n === 0 ? 20 : n === 1 ? 50 : 9;
      inst.label = `EMA ${inst.inputs.length}`;
    }
    setIndicators((xs) => [...xs, inst]);
    setStore((s) => ({ ...s, recentIndicators: [kind, ...s.recentIndicators.filter((x) => x !== kind)].slice(0, 8) }));
    setOverlay(null);
    setSelected({ id: inst.id, kind: "indicator" });
  }

  function submitTicket(values: TicketValues) {
    setConfirm({ kind: "order", values });
  }

  function openJournal(trades: typeof engine.trades, previousCount: number) {
    if (trades.length <= previousCount) return;
    const newest = trades[0];
    setJournalId(newest.id);
    setBottomTab("journal");
  }

  function confirmOrder() {
    if (confirm?.kind !== "order" || !quote) return;
    const before = engine.trades.length;
    const result = placeOrder(
      engine,
      { symbol: active.symbol, ...confirm.values, replay: replay.on },
      quote,
      qMap,
    );
    const closed = result.state.trades.length > before;
    setStore((s) => ({ ...s, engine: result.state, bottomCollapsed: closed ? false : s.bottomCollapsed }));
    setConfirm(null);
    if (result.error) toast(result.error, "bad");
    else {
      const o = result.order;
      const verb = o.side === "buy" ? "Bought" : "Sold";
      const units = `${o.qty} ${unitWord(o.symbol, o.qty)} of ${info.name}`;
      if (o.status === "filled") {
        const fill = execPrice(o.side, quote, "market", engine.fees);
        const realized = result.state.trades.slice(0, result.state.trades.length - before).reduce((a, t) => a + t.pnl, 0);
        toast(
          closed ? `${verb} ${units} at ₹${px(fill)} · Realized ${signedInr(realized)}` : `${verb} ${units} at ₹${px(fill)}`,
          closed ? (realized >= 0 ? "good" : "bad") : "info",
          closed ? 4200 : 3200,
        );
      } else {
        const at = o.price ?? o.trigger;
        toast(`${o.type.toUpperCase()} order placed: ${o.side} ${units}${at != null ? ` at ₹${px(at)}` : ""}`);
      }
      openJournal(result.state.trades, before);
    }
  }

  function doClose(id: string) {
    if (!quote) return;
    const before = engine.trades.length;
    const result = closePosition(engine, id, quote);
    const closed = result.state.trades.length > before;
    setStore((s) => ({ ...s, engine: result.state, bottomCollapsed: closed ? false : s.bottomCollapsed }));
    setConfirm(null);
    if (result.error) toast(result.error, "bad");
    else {
      const made = result.state.trades.slice(0, result.state.trades.length - before);
      if (made.length) {
        const t = made[0];
        const qty = made.reduce((a, x) => a + x.qty, 0);
        const pnl = made.reduce((a, x) => a + x.pnl, 0);
        toast(
          `Closed ${qty} ${unitWord(t.symbol, qty)} of ${findSymbol(t.symbol).name} at ₹${px(t.exit)} · P&L ${signedInr(pnl)}`,
          pnl >= 0 ? "good" : "bad",
          4200,
        );
      } else toast("Position closed.");
      openJournal(result.state.trades, before);
    }
  }

  const eq = equity(engine, qMap);
  const dayPnl = eq - engine.account.dayPnlStartEquity;
  const celebrate = store.celebrate;
  const onPnlEvent = useCallback(
    (e: PnlEvent) => {
      if (e.kind === "milestone") {
        const up = e.threshold > 0;
        toast(`${e.name} is ${up ? "up" : "down"} ${Math.abs(e.threshold * 100)}% (${pct(e.ret)})`, up ? "good" : "bad", 4200);
      } else if (e.kind === "profitable") {
        toast(`${e.name} turned profitable · ${signedInr(e.pnl)}`, "good", 4200);
        if (celebrate) {
          setBurst((b) => b + 1);
          setCheer(true);
        }
      } else if (e.kind === "session-high") {
        toast(`New session high · Day P&L ${signedInr(e.value, 0)}`, "good", 3600);
      } else {
        toast(`New session low · Day P&L ${signedInr(e.value, 0)}`, "bad", 3600);
      }
    },
    [celebrate, toast],
  );
  const pnlSamples = usePnlSession(engine, qMap, onPnlEvent);
  useEffect(() => {
    if (!cheer) return;
    const id = window.setTimeout(() => setCheer(false), 1400);
    return () => window.clearTimeout(id);
  }, [cheer]);
  const openPos = engine.positions.filter((p) => p.status !== "closed");
  const openOrd = engine.orders.filter((o) => o.status === "pending");
  const st = stats(engine.trades);
  const wl = store.watchlists.find((w) => w.id === store.activeWatchlistId) || store.watchlists[0];
  const replayCutoff = replay.on ? replay.index : undefined;
  const lastPx = quote?.last || candles[candles.length - 1]?.c || info.base;
  const chg = quote?.change || 0;
  const chgPct = quote?.changePct || 0;
  const isFavorite = (store.watchlists.find((w) => w.id === "mine")?.symbols || []).includes(active.symbol);
  const legendBar = hover || (candles.length ? candles[candles.length - 1] : null);
  const legendPrev = hover
    ? candles.find((c) => c.t < hover.t && c.t === candles.filter((x) => x.t < hover.t).at(-1)?.t) || candles[0]
    : candles.length > 1
      ? candles[candles.length - 2]
      : legendBar;
  const compareCandles = compareSymbol
    ? candlesMap.get(seedKey(compareSymbol, active.timeframe)) || []
    : [];
  const chartPositions = useMemo(
    () => engine.positions.filter((p) => p.status !== "closed" && p.symbol === active.symbol),
    [engine.positions, active.symbol],
  );
  const chartTrades = useMemo(
    () => engine.trades.filter((t) => t.symbol === active.symbol),
    [engine.trades, active.symbol],
  );
  const onHover = useCallback((info: { o: number; h: number; l: number; c: number; v: number; t: number } | null) => {
    setHover((prev) => {
      if (!info && !prev) return prev;
      if (info && prev && info.t === prev.t && info.c === prev.c && info.h === prev.h && info.l === prev.l) return prev;
      return info;
    });
  }, []);

  const hits = useMemo(() => {
    return searchSymbols(symQ, symIndex);
  }, [symQ, symIndex, universeReady]);

  const indHits = useMemo(() => {
    const n = indQ.trim().toLowerCase();
    return INDICATOR_CATALOG.filter((x) => !n || x.name.toLowerCase().includes(n) || x.category.toLowerCase().includes(n) || x.kind.includes(n));
  }, [indQ]);

  useEffect(() => {
    if (!lastPx) return;
    if (chartPxRef.current && lastPx !== chartPxRef.current) {
      setPxPulse(lastPx > chartPxRef.current ? "up" : "down");
      const t = window.setTimeout(() => setPxPulse(null), 480);
      chartPxRef.current = lastPx;
      return () => window.clearTimeout(t);
    }
    chartPxRef.current = lastPx;
  }, [lastPx]);

  function openChart(sym: string) {
    patchSlot({ symbol: sym });
    setDeskView("chart");
    setMobile("chart");
  }

  return (
    <div className={`term-root ${store.appearance === "cosmic" ? "cosmic" : ""} ${store.learningMode ? "learn-on" : ""} ${deskView !== "chart" ? "desk-board" : ""} ${mobile === "markets" ? "rail-open" : ""} ${mobile === "trade" ? "rail-open" : ""}`} data-testid="terminal" style={{ ["--term-right" as string]: `${Math.max(240, Math.min(460, store.rightWidth || 300))}px` }}>
      <a className="skip" href="#chart">Skip to chart</a>
      <DeskNav
        current={deskView}
        onChange={(id) => {
          withViewTransition(() => {
            setDeskView(id);
            setMobile(id === "chart" ? "chart" : id === "portfolio" ? "portfolio" : "markets");
            setDrawGroup(null);
            if (id === "chart") setOverlay(null);
          });
        }}
      />
      <header className="term-top">
        <Link className="term-brand" href="/" aria-label="Connect home">
          <ConnectLogo size="sm" />
        </Link>
        <p className="term-hello">
          Hello, <b>{name.split(/\s+/)[0] || name}</b>
        </p>
        <div className="term-pins" aria-label="Pinned indices">
          <IndexPin symbol="NIFTY" label="NIFTY 50" quote={quotes.get("NIFTY")} onOpen={() => openChart("NIFTY")} />
          <IndexPin symbol="BANKNIFTY" label="BANKNIFTY" quote={quotes.get("BANKNIFTY")} onOpen={() => openChart("BANKNIFTY")} />
        </div>
        <div className="term-top-right">
          <button type="button" className="term-ico term-search" aria-label="Search symbol" aria-haspopup="dialog" aria-expanded={overlay === "search"} onClick={() => { setSearchIntent("chart"); setOverlay("search"); }}>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
              <circle cx="10.5" cy="10.5" r="6.2" fill="none" stroke="currentColor" strokeWidth="2.2" />
              <path d="M15.2 15.2L20 20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
          </button>
          <button type="button" className={`term-ico star ${isFavorite ? "on" : ""}`} aria-label={isFavorite ? "Remove from watchlist" : "Add to watchlist"} aria-pressed={isFavorite} onClick={toggleFavorite}>{isFavorite ? "★" : "☆"}</button>
          <PositionPie
            positions={engine.positions}
            quotes={quotes}
            cash={engine.account.cash}
            onPick={(sym) => {
              openChart(sym);
              setBottomTab("positions");
              setStore((s) => ({ ...s, bottomCollapsed: false }));
            }}
          />
          <span className="term-paper-pill">Paper</span>
          <span className="term-user" aria-label={name}>{name.slice(0, 1).toUpperCase()}</span>
          <AppSwitch current="trade" />
          <button type="button" className="term-ico" aria-label="Settings" onClick={() => setOverlay("settings")}>☰</button>
        </div>
      </header>
      <div className="term-balances-bar">
        <dl className="term-balances" aria-label="Paper balances">
          <div className="cash">
            <dt>Cash</dt>
            <dd className={pxPulse ? `tick-${pxPulse}` : ""}>
              <AnimatedNumber value={engine.account.cash} format={money0} />
            </dd>
          </div>
          <div>
            <dt>Equity</dt>
            <dd>
              <AnimatedNumber value={eq} format={money0} />
            </dd>
          </div>
          <div className={`day${cheer ? " cheer" : ""}`}>
            <dt>Day P&L</dt>
            <dd className={dayPnl >= 0 ? "up" : "down"}>
              <AnimatedNumber value={dayPnl} format={signed0} />
            </dd>
            {celebrate ? <Confetti burst={burst} /> : null}
          </div>
        </dl>
        <button
          type="button"
          className={`term-tb ${store.learningMode ? "on" : ""}`}
          aria-label="Learning mode"
          aria-pressed={store.learningMode}
          onClick={() => setStore((s) => ({ ...s, learningMode: !s.learningMode }))}
        >
          Learn
        </button>
      </div>

      <nav className="term-draw" aria-label="Drawing tools">
        {DRAW_GROUPS.map((g) => (
          <button
            key={g.id}
            type="button"
            className={`term-ico ${g.items.some((i) => i.kind === tool) ? "on" : ""}`}
            aria-label={g.label}
            aria-haspopup="menu"
            onClick={(e) => {
              setFlyPos(anchorFly(e.currentTarget, "right"));
              setDrawGroup(drawGroup === g.id ? null : g.id);
              if (overlay === "tf" || overlay === "type") setOverlay(null);
            }}
            title={g.label}
          >
            <DrawIcon id={g.id} />
          </button>
        ))}
        <button type="button" className="term-ico" aria-label="Object tree" onClick={() => setOverlay("objects")} title="Object tree">
          <DrawIcon id="objects" />
        </button>
      </nav>

      <section className="term-main" id="chart">
        {deskView === "heatmap" ? (
          <HeatMap quotes={quotes} loading={quotesLoading} onPick={openChart} />
        ) : null}
        {deskView === "world" ? (
          <WorldMap quotes={quotes} loading={quotesLoading} onPick={openChart} />
        ) : null}
        {deskView === "portfolio" ? (
          <PortfolioBoard engine={engine} quotes={quotes} dayPnl={dayPnl} samples={pnlSamples} cheer={cheer} onPick={openChart} />
        ) : null}
        {deskView === "chart" ? (
          <>
        <div className="term-chart-tools" role="toolbar" aria-label="Chart">
          <button type="button" className={`term-tb ${compareSymbol ? "on" : ""}`} aria-label="Compare" aria-pressed={!!compareSymbol} onClick={() => { setSearchIntent("compare"); setOverlay("search"); }}>Compare</button>
          <span className="sep" aria-hidden />
          <button ref={tfBtnRef} type="button" className={`term-tb ${overlay === "tf" ? "on" : ""}`} aria-haspopup="listbox" aria-expanded={overlay === "tf"} aria-label="Timeframe" onClick={(e) => {
            setFlyPos(anchorFly(e.currentTarget, "below"));
            setOverlay(overlay === "tf" ? null : "tf");
            setDrawGroup(null);
          }}>
            {active.timeframe} ▾
          </button>
          <button ref={typeBtnRef} type="button" className={`term-tb ${overlay === "type" ? "on" : ""}`} aria-haspopup="listbox" aria-expanded={overlay === "type"} aria-label="Chart type" onClick={(e) => {
            setFlyPos(anchorFly(e.currentTarget, "below"));
            setOverlay(overlay === "type" ? null : "type");
            setDrawGroup(null);
          }}>
            {CHART_TYPES.find((c) => c.id === active.chartType)?.label} ▾
          </button>
          <span className="sep" aria-hidden />
          <button
            ref={indBtnRef}
            type="button"
            className={`term-tb ${overlay === "indicators" ? "on" : ""}`}
            aria-label="Indicators"
            aria-haspopup="dialog"
            aria-expanded={overlay === "indicators"}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setFlyPos({ top: r.bottom + 4, left: r.left });
              setOverlay(overlay === "indicators" ? null : "indicators");
              setDrawGroup(null);
            }}
          >
            Indicators ▾
          </button>
          <span className="sep" aria-hidden />
          <button type="button" className="term-tb" aria-label="Alert" onClick={() => setOverlay("alerts")}>Alert</button>
          <button type="button" className="term-tb" aria-label="Replay" onClick={() => { setOverlay("replay"); setReplay((r) => ({ ...r, on: true, index: Math.max(0, candles.length - 180) })); }}>Replay</button>
          <button type="button" className="term-ico" aria-label="Chart settings" onClick={() => { setSettingsTab("Chart"); setOverlay("settings"); }}>⚙</button>
        </div>
        <div className="term-chart-stage">
        <div className="term-chart-head">
          <div className="term-legend-row">
            <h1>{info.name}</h1>
            <p className="sub">{active.timeframe} · {info.exchange} <span className={quote?.live || feedStatus === "live" ? "term-live" : "term-sim"}>{quote?.live || feedStatus === "live" ? "LIVE · 20s" : "SIMULATED"}</span></p>
            <div className={`px ${chg >= 0 ? "up" : "down"}${pxPulse ? ` tick-${pxPulse}` : ""}`}>{px(lastPx)}</div>
            <div className={chg >= 0 ? "up" : "down"}>{signedPx(chg)} ({pct(chgPct)})</div>
            {info.assetClass === "stock" || info.assetClass === "etf" ? (
              <button type="button" className="btn ghost" onClick={() => setOverlay("financials")}>
                Fetch financials
              </button>
            ) : null}
            {compareSymbol ? (
              <span className="compare-chip">
                vs {compareSymbol}
                <button type="button" aria-label="Remove compare" onClick={() => setCompareSymbol(null)}>×</button>
              </span>
            ) : null}
          </div>
          {legendBar ? (
            <div className="term-ohlc" aria-live="polite">
              <span>O <b className={(legendBar.o >= (legendPrev?.c || legendBar.o) ? "up" : "down")}>{px(legendBar.o)}</b></span>
              <span>H <b className={(legendBar.h >= (legendPrev?.c || legendBar.h) ? "up" : "down")}>{px(legendBar.h)}</b></span>
              <span>L <b className={(legendBar.l >= (legendPrev?.c || legendBar.l) ? "up" : "down")}>{px(legendBar.l)}</b></span>
              <span>C <b className={(legendBar.c >= (legendPrev?.c || legendBar.c) ? "up" : "down")}>{px(legendBar.c)}</b></span>
              <span>Vol <b>{vol(legendBar.v)}</b></span>
            </div>
          ) : null}
          <div className="term-chips">
              {indicators.filter((i) => i.kind !== "volume" && i.showLegend).map((i) => {
                const vals = i.visible ? latestIndicatorValues(i, candles) : [];
                return (
                <span key={i.id} className="term-chip" style={{ color: i.style.color }}>
                  <button type="button" className={i.visible ? "" : "off"} aria-label={i.label} onClick={() => { setSelected({ id: i.id, kind: "indicator" }); }}>
                    {i.label}
                    {vals.map((row) => (
                      <b key={row.key} className="ind-val">{formatIndicatorValue(i.kind, row.value)}</b>
                    ))}
                  </button>
                  <button type="button" aria-label={`Hide ${i.label}`} onClick={() => setIndicators((xs) => xs.map((x) => x.id === i.id ? { ...x, visible: !x.visible } : x))}>👁</button>
                  <button type="button" aria-label={`Settings ${i.label}`} onClick={() => setIndEdit(i.id)}>⚙</button>
                  <button type="button" aria-label={`More ${i.label}`} onClick={() => setSelected({ id: i.id, kind: "indicator" })}>⋮</button>
                  <button type="button" aria-label={`Delete ${i.label}`} onClick={() => { snapshot(); setIndicators((xs) => xs.filter((x) => x.id !== i.id)); }}>×</button>
                </span>
                );
              })}
          </div>
          {store.learningMode ? (
            <p className="learn-strip" role="status">
              {tool === "crosshair" || tool === "cursor"
                ? "Learning mode: paper cash only. Use the left tools to mark levels, then size the order from available cash."
                : `Learning mode: click two points on the chart to place ${tool}. Esc returns to the crosshair.`}
            </p>
          ) : null}
        </div>
        <ChartCanvas
          candles={candles}
          chartType={active.chartType}
          scaleMode={scaleMode}
          indicators={indicators}
          drawings={drawings}
          positions={chartPositions}
          trades={chartTrades}
          quote={quote}
          symbolLabel={info.name}
          viewKey={key}
          tfLabel={active.timeframe}
          tool={tool}
          selectedId={selected?.id || null}
          replayCutoff={replayCutoff}
          showPnl={store.showPositionPnl}
          last={lastPx}
          compare={compareSymbol && compareCandles.length ? { symbol: compareSymbol, candles: compareCandles } : null}
          status={feedStatus === "loading" && candles.length === 0 ? "loading" : "ready"}
          onSelect={(id, kind) => setSelected(id && kind ? { id, kind } : null)}
          onDrawings={setDrawings}
          onDragLevel={(id, field, price) => setStore((s) => ({ ...s, engine: modifyPosition(s.engine, id, { [field]: price }) }))}
          onContext={(ev) => setCtx({ x: ev.x, y: ev.y })}
          onHover={onHover}
          onReady={(api) => { chartApi.current = api; }}
        />
        {replay.on ? (
          <div className="replay-bar" role="region" aria-label="Replay mode">
            <strong>REPLAY</strong>
            <button type="button" onClick={() => setReplay((r) => ({ ...r, playing: false, index: Math.max(0, r.index - 1) }))} aria-label="Previous bar">◀</button>
            <button type="button" onClick={() => setReplay((r) => ({ ...r, playing: !r.playing }))}>{replay.playing ? "Pause" : "Play"}</button>
            <button type="button" onClick={() => setReplay((r) => ({ ...r, playing: false, index: r.index + 1 }))} aria-label="Next bar">▶</button>
            <label>
              Speed
              <select value={replay.speed} onChange={(e) => setReplay((r) => ({ ...r, speed: Number(e.target.value) }))}>
                {[0.5, 1, 2, 4].map((s) => <option key={s} value={s}>{s}x</option>)}
              </select>
            </label>
            <input type="range" min={10} max={Math.max(11, candles.length - 1)} value={replay.index} onChange={(e) => setReplay((r) => ({ ...r, index: Number(e.target.value) }))} aria-label="Replay position" />
            <button type="button" className="btn ghost" onClick={() => setReplay({ on: false, index: 0, speed: 1, playing: false })}>Exit</button>
          </div>
        ) : null}
        </div>
          </>
        ) : null}
      </section>

      <aside className="term-right" aria-label="Side panel">
        <div
          className="resize-v"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize watchlist"
          onPointerDown={(e) => {
            const startX = e.clientX;
            const startW = store.rightWidth || 300;
            function move(ev: PointerEvent) {
              const w = Math.min(460, Math.max(240, startW - (ev.clientX - startX)));
              setStore((s) => ({ ...s, rightWidth: w }));
            }
            function up() {
              window.removeEventListener("pointermove", move);
              window.removeEventListener("pointerup", up);
            }
            window.addEventListener("pointermove", move);
            window.addEventListener("pointerup", up);
          }}
        />
        <div className="term-rtabs" role="tablist">
          {(["watchlist", "details", "trade"] as const).map((id) => (
            <button key={id} type="button" role="tab" aria-selected={right === id} onClick={() => setRight(id)}>
              {id === "watchlist" ? "Watchlist" : id === "details" ? "Details" : "Trade"}
            </button>
          ))}
        </div>
        <div className="term-rbody">
          {right === "watchlist" ? (
            <WatchlistPane
              store={store}
              setStore={setStore}
              quotes={quotes}
              quotesLoading={quotesLoading}
              flashes={flashes}
              q={wlQ}
              setQ={setWlQ}
              active={active.symbol}
              onPick={(sym) => { patchSlot({ symbol: sym }); }}
              onTrade={(sym) => { patchSlot({ symbol: sym }); setRight("trade"); }}
              onAdd={() => { setSearchIntent("watchlist"); setOverlay("search"); }}
              onMenu={(menu) => setWlMenu(menu)}
            />
          ) : null}
          {right === "details" ? <DetailsPane info={info} quote={quote} onFinancials={() => setOverlay("financials")} /> : null}
          {right === "trade" ? (
            <TradeTicket
              key={`${active.symbol}-${ticketSide}-ticket`}
              symbol={active.symbol}
              quote={quote}
              initialSide={ticketSide}
              defaultQty={info.lotSize}
              cash={engine.account.cash}
              learning={store.learningMode}
              onSubmit={submitTicket}
            />
          ) : null}
        </div>
      </aside>

      <footer className={`term-bottom ${store.bottomCollapsed ? "collapsed" : ""}`} style={{ height: store.bottomCollapsed ? 32 : store.bottomHeight }}>
        <div className="blot-bar">
          <div
            className="resize-h"
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize blotter"
            onPointerDown={(e) => {
              const startY = e.clientY;
              const startH = store.bottomHeight;
              function move(ev: PointerEvent) {
                const h = Math.min(420, Math.max(32, startH - (ev.clientY - startY)));
                setStore((s) => ({ ...s, bottomHeight: h, bottomCollapsed: h <= 40 }));
              }
              function up() {
                window.removeEventListener("pointermove", move);
                window.removeEventListener("pointerup", up);
              }
              window.addEventListener("pointermove", move);
              window.addEventListener("pointerup", up);
            }}
          />
          {(["positions", "orders", "history", "portfolio", "journal", "account"] as const).map((id) => (
            <button
              key={id}
              type="button"
              aria-selected={bottomTab === id}
              onClick={() => { setBottomTab(id); setStore((s) => ({ ...s, bottomCollapsed: false })); }}
            >
              {id === "positions" ? `Positions ${openPos.length}` : id === "orders" ? `Orders ${openOrd.length}` : id === "history" ? "Trade history" : id === "portfolio" ? "Portfolio" : id === "journal" ? "Journal" : "Account"}
            </button>
          ))}
          <div className="meta">
            <span className={dayPnl >= 0 ? "up" : "down"}>P&L {signedInr(dayPnl, 0)}</span>
            <span>Equity {inr(eq, 0)}</span>
            <button type="button" onClick={() => setStore((s) => ({ ...s, bottomCollapsed: !s.bottomCollapsed }))} aria-label={store.bottomCollapsed ? "Expand blotter" : "Collapse blotter"}>
              {store.bottomCollapsed ? "▴" : "▾"}
            </button>
          </div>
        </div>
        {!store.bottomCollapsed ? (
          <div className="term-rbody">
            {bottomTab === "positions" ? (
              openPos.length === 0 ? (
                <div className="empty-compact">
                  <strong>No open positions</strong>
                  <p>Your paper account currently has no active positions.</p>
                  <button type="button" className="btn" onClick={() => setOverlay("search")}>Explore markets</button>
                </div>
              ) : (
                <table className="term-table">
                  <thead>
                    <tr>{["Symbol", "Side", "Qty", "Avg", "LTP", "P&L", "P&L %", "Session", "SL", "TP", ""].map((h) => <th key={h}>{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {openPos.map((p) => {
                      const last = quotes.get(p.symbol)?.last || p.avgPrice;
                      const u = unrealized(p, last);
                      return (
                        <tr key={p.id}>
                          <td><span className="pos-id"><DeskMark info={findSymbol(p.symbol)} size={16} />{findSymbol(p.symbol).name}</span></td>
                          <td>{p.side.toUpperCase()}</td>
                          <td>{p.qty}</td>
                          <td>{px(p.avgPrice)}</td>
                          <td>{px(last)}</td>
                          <td className={u >= 0 ? "up" : "down"}>{signedInr(u)}</td>
                          <td className={u >= 0 ? "up" : "down"}>{pct(u / (p.avgPrice * p.qty))}</td>
                          <td>
                            <PnlSpark points={positionSeries(pnlSamples, p.id)} label={findSymbol(p.symbol).name} />
                          </td>
                          <td>
                            <LevelField
                              label={`Stop loss ${p.symbol}`}
                              value={p.sl}
                              step={findSymbol(p.symbol).tickSize}
                              onCommit={(sl) => setStore((s) => ({ ...s, engine: modifyPosition(s.engine, p.id, { sl }) }))}
                            />
                          </td>
                          <td>
                            <LevelField
                              label={`Take profit ${p.symbol}`}
                              value={p.tp}
                              step={findSymbol(p.symbol).tickSize}
                              onCommit={(tp) => setStore((s) => ({ ...s, engine: modifyPosition(s.engine, p.id, { tp }) }))}
                            />
                          </td>
                          <td>
                            <div className="row-acts">
                              <button type="button" className="btn ghost" onClick={() => setConfirm({ kind: "close", id: p.id })}>Close</button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )
            ) : null}
            {bottomTab === "orders" ? (
              openOrd.length + engine.orders.length === 0 ? (
                <div className="empty-compact">No open orders.</div>
              ) : (
                <table className="term-table">
                  <thead>
                    <tr>{["Order ID", "Time", "Symbol", "Side", "Type", "Qty", "Price", "Status", ""].map((h) => <th key={h}>{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {engine.orders.slice(0, 40).map((o) => (
                      <tr key={o.id}>
                        <td>{o.id.slice(-6)}</td>
                        <td>{new Date(o.time).toLocaleTimeString()}</td>
                        <td>{o.symbol}</td>
                        <td>{o.side.toUpperCase()}</td>
                        <td>{o.type}</td>
                        <td>{o.qty}</td>
                        <td>{o.price ? px(o.price) : "MKT"}</td>
                        <td>{o.status}{o.rejectReason ? ` · ${o.rejectReason}` : ""}</td>
                        <td>
                          {o.status === "pending" ? (
                            <button type="button" className="btn ghost" onClick={() => setStore((s) => ({ ...s, engine: { ...s.engine, orders: s.engine.orders.map((x) => x.id === o.id ? { ...x, status: "cancelled" } : x) } }))}>Cancel</button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            ) : null}
            {bottomTab === "history" ? (
              <>
                <div className="wl-head">
                  {(["today", "week", "month", "all"] as const).map((r) => (
                    <button key={r} type="button" className="term-tb" aria-pressed={histRange === r} onClick={() => setHistRange(r)}>{r}</button>
                  ))}
                  <button type="button" className="btn ghost" onClick={() => download("trades.csv", toCsv(engine.trades))}>CSV</button>
                  <button type="button" className="btn ghost" onClick={() => download("trades.xls", toCsv(engine.trades))}>Excel</button>
                </div>
                {engine.trades.length === 0 ? (
                  <div className="empty-compact">No trades yet.</div>
                ) : (
                  <table className="term-table">
                    <thead>
                      <tr>{["Date", "Symbol", "Side", "Entry", "Exit", "Qty", "P&L", "Return %", "Duration", ""].map((h) => <th key={h || "note"}>{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {historyFilter(engine.trades, histRange).map((t) => (
                        <tr key={t.id}>
                          <td>{new Date(t.closedAt).toLocaleString()}</td>
                          <td>{t.symbol}</td>
                          <td>{t.side.toUpperCase()}</td>
                          <td>{px(t.entry)}</td>
                          <td>{px(t.exit)}</td>
                          <td>{t.qty}</td>
                          <td className={t.pnl >= 0 ? "up" : "down"}>{signedInr(t.pnl)}</td>
                          <td>{pct(t.returnPct)}</td>
                          <td>{dur(t.durationMs)}</td>
                          <td>
                            <button type="button" className="btn ghost" onClick={() => { setJournalId(t.id); setBottomTab("journal"); }}>Note</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </>
            ) : null}
            {bottomTab === "portfolio" ? (
              <div className="term-rbody-pad">
                {store.learningMode ? (
                  <p className="learn-hint">Equity is cash plus the mark-to-market of open positions. Day P&L resets with the session anchor.</p>
                ) : null}
                <div className="port-grid blot-port">
                <div className="stat"><span>Equity</span><b><AnimatedNumber value={eq} format={money0} /></b></div>
                <div className="stat"><span>Cash</span><b><AnimatedNumber value={engine.account.cash} format={money0} /></b></div>
                <div className="stat"><span>Invested</span><b><AnimatedNumber value={invested(engine)} format={money0} /></b></div>
                <div className="stat"><span>Today</span><b className={dayPnl >= 0 ? "up" : "down"}><AnimatedNumber value={dayPnl} format={signed0} /></b></div>
                <EquitySpark curve={st.curve} />
                </div>
                <PracticeStrip trades={engine.trades} orders={engine.orders} />
                <PnlHistoryChart samples={pnlSamples} height={140} compact />
              </div>
            ) : null}
            {bottomTab === "journal" ? (
              <JournalPane
                trades={engine.trades}
                journals={store.journals}
                selectedId={journalId || engine.trades[0]?.id || null}
                learning={store.learningMode}
                onSelect={setJournalId}
                onNote={(id, note) => setStore((s) => ({ ...s, journals: { ...s.journals, [id]: note } }))}
              />
            ) : null}
            {bottomTab === "account" ? (
              <div className="acct-grid">
                <div><dt>Starting balance</dt><dd>{inr(engine.account.startingBalance, 0)}</dd></div>
                <div><dt>Equity</dt><dd>{inr(eq, 0)}</dd></div>
                <div><dt>Cash</dt><dd>{inr(engine.account.cash, 0)}</dd></div>
                <div><dt>Day P&L</dt><dd className={dayPnl >= 0 ? "up" : "down"}>{signedInr(dayPnl, 0)}</dd></div>
                <div><dt>Total P&L</dt><dd className={eq - engine.account.startingBalance >= 0 ? "up" : "down"}>{signedInr(eq - engine.account.startingBalance, 0)}</dd></div>
                <div><button type="button" className="btn ghost" onClick={() => setOverlay("reset")}>Reset paper account</button></div>
              </div>
            ) : null}
          </div>
        ) : null}
      </footer>

      <nav className="mobile-nav" aria-label="Mobile">
        {(["chart", "heatmap", "world", "portfolio", "trade"] as const).map((id) => (
          <button key={id} type="button" aria-current={mobile === id || deskView === id} onClick={() => {
            setMobile(id === "trade" ? "trade" : id === "chart" ? "chart" : "markets");
            if (id === "chart" || id === "heatmap" || id === "world" || id === "portfolio") setDeskView(id);
            if (id === "trade") { setDeskView("chart"); setRight("trade"); }
          }}>{id === "heatmap" ? "heat" : id}</button>
        ))}
      </nav>

      {drawGroup ? (
        <div className="term-fly" style={{ left: flyPos.left, top: flyPos.top }} role="menu">
          <div className="sec">{DRAW_GROUPS.find((g) => g.id === drawGroup)?.label}</div>
          {DRAW_GROUPS.find((g) => g.id === drawGroup)?.items.map((it) => (
            <button key={it.kind} type="button" role="menuitem" onClick={() => { setTool(it.kind); setDrawGroup(null); }}>
              {it.label}
            </button>
          ))}
          <button type="button" onClick={() => { setDrawings((d) => d.map((x) => ({ ...x, hidden: true }))); setDrawGroup(null); }}>Hide all drawings</button>
          <button type="button" onClick={() => { setDrawings((d) => d.map((x) => ({ ...x, locked: true }))); setDrawGroup(null); }}>Lock all drawings</button>
          <button type="button" onClick={() => { snapshot(); setDrawings([]); setDrawGroup(null); }}>Delete all drawings</button>
        </div>
      ) : null}

      {overlay === "tf" ? (
        <MenuFly onClose={() => setOverlay(null)} label="Timeframe" pos={flyPos}>
          {store.quickTfs.map((id) => (
            <button key={id} type="button" onClick={() => { patchSlot({ timeframe: id }); setOverlay(null); }}>{id}</button>
          ))}
          <div className="sec">All</div>
          {TIMEFRAMES.map((t) => (
            <button key={t.id} type="button" onClick={() => { patchSlot({ timeframe: t.id }); setOverlay(null); }}>{t.label} · {t.group}</button>
          ))}
        </MenuFly>
      ) : null}
      {overlay === "type" ? (
        <MenuFly onClose={() => setOverlay(null)} label="Chart type" pos={flyPos}>
          {CHART_TYPES.map((t) => (
            <button key={t.id} type="button" onClick={() => { patchSlot({ chartType: t.id }); setOverlay(null); }}>{t.label}</button>
          ))}
        </MenuFly>
      ) : null}

      {overlay === "search" ? (
        <div className="term-overlay" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setOverlay(null); }}>
          <div className="term-modal wide" role="dialog" aria-label="Search symbol">
            <header>
              <h2>{searchIntent === "compare" ? "Compare" : searchIntent === "watchlist" ? "Add to watchlist" : "Search"}</h2>
              <button type="button" className="term-ico" aria-label="Close" onClick={() => setOverlay(null)}>×</button>
            </header>
            <div className="search-row">
              <label className="visually-hidden" htmlFor="sym-search">Search stocks, indices, ETFs…</label>
              <input id="sym-search" ref={searchRef} value={symQ} onChange={(e) => setSymQ(e.target.value)} placeholder="Search Nifty 50, midcap, smallcap…" />
            </div>
            <div className="index-chips" role="tablist" aria-label="NSE indices">
              {NSE_INDEX_FILTERS.map((f) => (
                <button
                  key={f.id || "all"}
                  type="button"
                  role="tab"
                  aria-selected={symIndex === f.id}
                  className={symIndex === f.id ? "on" : ""}
                  onClick={() => setSymIndex(f.id)}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <div className="body">
              {!universeReady ? <p className="empty-compact">Loading NSE stocks…</p> : null}
              {universeReady ? <p className="empty-compact">{equityCount().toLocaleString("en-IN")} NSE stocks loaded.</p> : null}
              {!symQ && !symIndex ? (
                <>
                  <div className="ind-cat">RECENT</div>
                  {store.recentSymbols.map((s) => {
                    const x = findSymbol(s);
                    return (
                      <button key={s} type="button" className="hit" onClick={() => pickSymbol(s)}>
                        <span className="hit-id"><DeskMark info={x} /><span><strong>{x.symbol}</strong> {x.name}</span></span><span className="ex">{x.exchange}</span>
                      </button>
                    );
                  })}
                </>
              ) : null}
              {Object.entries(CLASS_LABEL).map(([cls, label]) => {
                const rows = hits.filter((h) => h.assetClass === cls);
                if (!rows.length) return null;
                return (
                  <div key={cls}>
                    <div className="ind-cat">{label}{symIndex ? ` · ${rows.length}` : ""}</div>
                    {rows.map((h) => (
                      <button key={h.symbol} type="button" className="hit" onClick={() => pickSymbol(h.symbol)}>
                        <span className="hit-id"><DeskMark info={h} /><span><strong>{h.symbol}</strong> {h.name}</span></span>
                        <span className="ex">{h.indices?.[0] || h.exchange}</span>
                      </button>
                    ))}
                  </div>
                );
              })}
              {(symQ || symIndex) && hits.length === 0 && universeReady ? <p className="empty-compact">No symbols match.</p> : null}
            </div>
          </div>
        </div>
      ) : null}

      {overlay === "indicators" ? (
        <div className="term-overlay ind-drop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setOverlay(null); }}>
          <div className="term-modal ind-drop" role="dialog" aria-label="Indicators" style={{ top: flyPos.top, left: flyPos.left }}>
            <header>
              <h2>Indicators</h2>
              <button type="button" className="term-ico" aria-label="Close" onClick={() => setOverlay(null)}>×</button>
            </header>
            <div className="search-row">
              <label className="visually-hidden" htmlFor="ind-search">Search indicators</label>
              <input id="ind-search" value={indQ} onChange={(e) => setIndQ(e.target.value)} placeholder="Search indicators…" onKeyDown={(e: RKeyboardEvent<HTMLInputElement>) => {
                if (e.key === "Enter" && indHits[0]) addIndicator(indHits[0].kind);
              }} />
            </div>
            <div className="body">
              <div className="ind-cat">★ FAVORITES</div>
              {INDICATOR_CATALOG.filter((x) => store.favoriteIndicators.includes(x.kind)).map((x) => (
                <button key={x.kind} type="button" className="hit" title={x.info} onClick={() => addIndicator(x.kind)}>
                  <span>{x.name}</span>
                </button>
              ))}
              {["TREND", "MOMENTUM", "VOLATILITY", "VOLUME", "MARKET STRUCTURE"].map((cat) => (
                <div key={cat}>
                  <div className="ind-cat">{cat}</div>
                  {indHits.filter((x) => x.category === cat).map((x) => (
                    <button key={x.kind} type="button" className="hit" title={x.info} onClick={() => addIndicator(x.kind)}>
                      <span>{x.name}</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {overlay === "settings" ? (
        <div className="term-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setOverlay(null); }}>
          <div className="term-modal wide" role="dialog" aria-label="Settings">
            <header>
              <h2>Settings</h2>
              <button type="button" className="term-ico" aria-label="Close" onClick={() => setOverlay(null)}>×</button>
            </header>
            <div className="settings-layout">
              <nav className="settings-nav">
                {["Chart", "Trading", "Orders", "Indicators", "Drawings", "Watchlist", "Notifications", "Appearance", "Shortcuts", "Paper Account"].map((t) => (
                  <button key={t} type="button" aria-current={settingsTab === t} onClick={() => setSettingsTab(t)}>{t}</button>
                ))}
              </nav>
              <div className="settings-pane">
                {settingsTab === "Chart" ? (
                  <>
                    <label>Scale
                      <select value={scaleMode} onChange={(e) => setScaleMode(e.target.value as ScaleMode)}>
                        <option value="linear">Linear</option>
                        <option value="log">Log</option>
                        <option value="percent">Percent</option>
                      </select>
                    </label>
                    <label>Layout
                      <select value={store.chartCount} onChange={(e) => setStore((s) => ({ ...s, chartCount: Number(e.target.value) as 1 | 2 | 3 | 4, slots: s.slots.length ? s.slots : defaultSlots() }))}>
                        <option value={1}>1 chart</option>
                        <option value={2}>2 charts</option>
                        <option value={3}>3 charts</option>
                        <option value={4}>4 charts</option>
                      </select>
                    </label>
                    <label><input type="checkbox" checked={store.showPositionPnl} onChange={(e) => setStore((s) => ({ ...s, showPositionPnl: e.target.checked }))} /> Show position P&L</label>
                    <label><input type="checkbox" checked={store.sync.crosshair} onChange={(e) => setStore((s) => ({ ...s, sync: { ...s.sync, crosshair: e.target.checked } }))} /> Sync crosshair</label>
                    <label><input type="checkbox" checked={store.sync.timeframe} onChange={(e) => setStore((s) => ({ ...s, sync: { ...s.sync, timeframe: e.target.checked } }))} /> Sync timeframe</label>
                    <label><input type="checkbox" checked={store.sync.symbol} onChange={(e) => setStore((s) => ({ ...s, sync: { ...s.sync, symbol: e.target.checked } }))} /> Sync symbol</label>
                    <button type="button" className="btn" onClick={() => setOverlay("layouts")}>Save layout</button>
                  </>
                ) : null}
                {settingsTab === "Appearance" ? (
                  <label>Appearance
                    <select value={store.appearance} onChange={(e) => setStore((s) => ({ ...s, appearance: e.target.value as "professional" | "cosmic" }))}>
                      <option value="professional">Professional mode</option>
                      <option value="cosmic">Cosmic mode</option>
                    </select>
                  </label>
                ) : null}
                {settingsTab === "Paper Account" ? (
                  <>
                    <p className="muted">Starting balance {inr(engine.account.startingBalance, 0)}. Simulated fills only.</p>
                    <label>Slippage %
                      <input type="number" step={0.01} value={store.fees.slippagePct} onChange={(e) => setStore((s) => ({ ...s, fees: { ...s.fees, slippagePct: Number(e.target.value) }, engine: { ...s.engine, fees: { ...s.engine.fees, slippagePct: Number(e.target.value) } } }))} />
                    </label>
                    <label>Brokerage %
                      <input type="number" step={0.01} value={store.fees.brokeragePct} onChange={(e) => setStore((s) => ({ ...s, fees: { ...s.fees, brokeragePct: Number(e.target.value) }, engine: { ...s.engine, fees: { ...s.engine.fees, brokeragePct: Number(e.target.value) } } }))} />
                    </label>
                    <button type="button" className="btn danger" onClick={() => setOverlay("reset")}>Reset paper account</button>
                  </>
                ) : null}
                {settingsTab === "Shortcuts" ? (
                  <p className="muted">Ctrl+K search · Ctrl+I indicators · B buy · S sell · Alt+T trade · Delete · Esc · Space replay · F11 fullscreen</p>
                ) : null}
                {settingsTab === "Trading" || settingsTab === "Orders" ? (
                  <p className="muted">Market orders only — everyone fills at the same last. Bracket with SL + TP. Zero-cost fees by default.</p>
                ) : null}
                {settingsTab === "Notifications" ? (
                  <>
                    <label><input type="checkbox" checked={store.celebrate} onChange={(e) => setStore((s) => ({ ...s, celebrate: e.target.checked }))} /> Celebrate when a position turns profitable</label>
                    <p className="muted">Trade, milestone and session high/low toasts always show. This only controls the confetti and pulse. Motion is skipped when your system asks for reduced motion.</p>
                  </>
                ) : null}
                {["Indicators", "Drawings", "Watchlist"].includes(settingsTab) ? (
                  <p className="muted">Manage from the chart, object tree, and watchlist header. Density stays terminal-compact.</p>
                ) : null}
                <p>
                  <Link href="/models">Open valuation models</Link>
                </p>
                <button type="button" className="btn ghost" onClick={async () => { await api.logout(); router.push("/login"); }}>Sign out · {name}</button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {overlay === "layouts" ? (
        <div className="term-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setOverlay(null); }}>
          <div className="term-modal" role="dialog" aria-label="Layouts">
            <header><h2>Save layout</h2><button type="button" className="term-ico" aria-label="Close" onClick={() => setOverlay(null)}>×</button></header>
            <div className="body">
              <button type="button" className="btn" onClick={() => {
                const nameL = window.prompt("Layout name", "My Intraday Setup");
                if (!nameL) return;
                setStore((s) => ({ ...s, layouts: [{ id: `l${Date.now()}`, name: nameL, symbol: active.symbol, timeframe: active.timeframe, chartType: active.chartType, indicators, drawings, watchlistId: s.activeWatchlistId, chartCount: s.chartCount }, ...s.layouts] }));
                toast("Layout saved.");
              }}>Save current</button>
              {store.layouts.map((l) => (
                <div key={l.id} className="hit">
                  <button type="button" onClick={() => { patchSlot({ symbol: l.symbol, timeframe: l.timeframe, chartType: l.chartType }); setIndicators(l.indicators); setDrawings(l.drawings); setOverlay(null); }}>{l.name}</button>
                  <button type="button" onClick={() => setStore((s) => ({ ...s, layouts: s.layouts.filter((x) => x.id !== l.id) }))}>Delete</button>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {overlay === "alerts" ? (
        <div className="term-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setOverlay(null); }}>
          <div className="term-modal" role="dialog" aria-label="Alerts">
            <header><h2>Active alerts</h2><button type="button" className="term-ico" aria-label="Close" onClick={() => setOverlay(null)}>×</button></header>
            <div className="body">
              <button type="button" className="btn" onClick={() => {
                const a: Alert = { id: `a${Date.now()}`, label: `${info.symbol} > ${(lastPx * 1.02).toFixed(0)}`, enabled: true, fired: false, cond: { kind: "price", symbol: info.symbol, op: ">", value: lastPx * 1.02 } };
                setStore((s) => ({ ...s, alerts: [a, ...s.alerts] }));
              }}>Add price alert</button>
              {store.alerts.length === 0 ? <p className="empty-compact">No alerts.</p> : store.alerts.map((a) => (
                <div key={a.id} className="hit">
                  <span>{a.label} · {a.enabled ? "Active" : "Off"}{a.fired ? " · fired" : ""}</span>
                  <span>
                    <button type="button" onClick={() => setStore((s) => ({ ...s, alerts: s.alerts.map((x) => x.id === a.id ? { ...x, enabled: !x.enabled, fired: false } : x) }))}>Disable</button>
                    <button type="button" onClick={() => setStore((s) => ({ ...s, alerts: s.alerts.filter((x) => x.id !== a.id) }))}>Delete</button>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {overlay === "portfolio" ? (
        <div className="term-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setOverlay(null); }}>
          <div className="term-modal wide" role="dialog" aria-label="Portfolio">
            <header><h2>Paper portfolio</h2><button type="button" className="term-ico" aria-label="Close" onClick={() => setOverlay(null)}>×</button></header>
            <div className="port-grid">
              <div className="stat"><span>Equity</span><b>{inr(eq, 0)}</b></div>
              <div className="stat"><span>Cash</span><b>{inr(engine.account.cash, 0)}</b></div>
              <div className="stat"><span>Invested</span><b>{inr(invested(engine), 0)}</b></div>
              <div className="stat"><span>Today</span><b className={dayPnl >= 0 ? "up" : "down"}>{signedInr(dayPnl, 0)}</b></div>
              <EquitySpark curve={st.curve} />
            </div>
          </div>
        </div>
      ) : null}

      {overlay === "objects" ? (
        <div className="term-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setOverlay(null); }}>
          <div className="term-modal" role="dialog" aria-label="Objects">
            <header><h2>Objects</h2><button type="button" className="term-ico" aria-label="Close" onClick={() => setOverlay(null)}>×</button></header>
            <div className="body">
              <div className="ind-cat">DRAWINGS</div>
              {drawings.map((d) => (
                <div key={d.id} className="hit"><span>{d.kind}</span><button type="button" onClick={() => setDrawings((xs) => xs.filter((x) => x.id !== d.id))}>Delete</button></div>
              ))}
              <div className="ind-cat">INDICATORS</div>
              {indicators.map((i) => (
                <div key={i.id} className="hit"><span>{i.label}</span><button type="button" onClick={() => setIndicators((xs) => xs.filter((x) => x.id !== i.id))}>Delete</button></div>
              ))}
              <button type="button" className="btn ghost" onClick={() => setDrawings((d) => d.map((x) => ({ ...x, hidden: true })))}>Hide all drawings</button>
              <button type="button" className="btn ghost" onClick={() => setDrawings([])}>Clear drawings</button>
            </div>
          </div>
        </div>
      ) : null}

      {overlay === "reset" ? (
        <div className="term-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setOverlay(null); }}>
          <div className="term-modal" role="dialog" aria-label="Reset paper account">
            <header><h2>Reset paper account?</h2><button type="button" className="term-ico" aria-label="Close" onClick={() => setOverlay(null)}>×</button></header>
            <div className="confirm-box">
              <p>This will permanently clear the selected simulated trading data.</p>
              <div className="confirm-acts">
                <button type="button" className="btn ghost" onClick={() => setOverlay(null)}>Cancel</button>
                <button type="button" className="btn danger" onClick={() => { setStore((s) => ({ ...s, journals: {}, engine: resetAccount(s.engine, { balance: true, positions: true, orders: true, history: true }) })); setJournalId(null); setOverlay(null); toast("Paper account reset."); }}>Reset everything</button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {overlay === "financials" ? (
        <FinancialsPane symbol={active.symbol} onClose={() => setOverlay(null)} />
      ) : null}

      {overlay === "replay" && !replay.on ? null : null}

      {confirm?.kind === "order" && quote ? (
        <div className="term-overlay">
          <div className="term-modal" role="dialog" aria-label="Order summary">
            <header><h2>Order summary</h2></header>
            <div className="confirm-box">
              <dl>
                <dt>Symbol</dt><dd>{info.name}</dd>
                <dt>Side</dt><dd>{confirm.values.side.toUpperCase()}</dd>
                <dt>Type</dt><dd>MARKET</dd>
                <dt>Quantity</dt><dd>{confirm.values.qty}</dd>
                <dt>Est. price</dt><dd>{px(quote.last)}</dd>
                <dt>Est. value</dt><dd>{inr(quote.last * confirm.values.qty)}</dd>
              </dl>
              {store.learningMode ? (
                <p className="learn-hint">This is a paper fill. Confirming does not send a live order.</p>
              ) : null}
              <div className="confirm-acts">
                <button type="button" className="btn ghost" onClick={() => setConfirm(null)}>Cancel</button>
                <button type="button" className="btn" onClick={confirmOrder}>Confirm order</button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {confirm?.kind === "close" ? (
        <div className="term-overlay">
          <div className="term-modal" role="dialog" aria-label="Close position">
            <header><h2>Close position</h2></header>
            <div className="confirm-box">
              {(() => {
                const p = engine.positions.find((x) => x.id === confirm.id);
                if (!p) return <p>No open position.</p>;
                const last = quotes.get(p.symbol)?.last || p.avgPrice;
                const u = unrealized(p, last);
                return (
                  <dl>
                    <dt>Symbol</dt><dd>{findSymbol(p.symbol).name}</dd>
                    <dt>Quantity</dt><dd>{p.qty}</dd>
                    <dt>Current price</dt><dd>{px(last)}</dd>
                    <dt>Est. P&L</dt><dd className={u >= 0 ? "up" : "down"}>{signedInr(u)}</dd>
                  </dl>
                );
              })()}
              <div className="confirm-acts">
                <button type="button" className="btn ghost" onClick={() => setConfirm(null)}>Cancel</button>
                <button type="button" className="btn danger" onClick={() => doClose(confirm.id)}>Close position</button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {ctx ? (
        <div className="term-fly ctx-menu" style={{ left: ctx.x, top: ctx.y }} role="menu">
          {[
            ["Reset chart", () => chartApi.current?.reset()],
            ["Auto scale", () => chartApi.current?.autoScale()],
            ["Add indicator", () => setOverlay("indicators")],
            ["Create alert", () => setOverlay("alerts")],
            ["Trade", () => setRight("trade")],
            ["Hide indicators", () => setIndicators((xs) => xs.map((x) => ({ ...x, visible: false })))],
            ["Hide drawings", () => setDrawings((xs) => xs.map((x) => ({ ...x, hidden: true })))],
            ["Delete selected", () => { if (selected?.kind === "drawing") setDrawings((d) => d.filter((x) => x.id !== selected.id)); }],
            ["Delete all drawings", () => setDrawings([])],
            ["Chart settings", () => setOverlay("settings")],
            ["Screenshot", () => chartApi.current?.screenshot()],
          ].map(([label, fn]) => (
            <button key={String(label)} type="button" role="menuitem" onClick={() => { (fn as () => void)(); setCtx(null); }}>{label as string}</button>
          ))}
        </div>
      ) : null}

      {indEdit ? (
        <IndSettings
          inst={indicators.find((i) => i.id === indEdit)!}
          onClose={() => setIndEdit(null)}
          onChange={(n) => setIndicators((xs) => xs.map((x) => x.id === n.id ? n : x))}
        />
      ) : null}

      {selected?.kind === "drawing" ? (
        <div className="draw-acts" role="toolbar" aria-label="Drawing actions">
          <button type="button" onClick={() => setDrawings((ds) => ds.map((d) => d.id === selected.id ? { ...d, hidden: !d.hidden } : d))}>Hide</button>
          <button type="button" onClick={() => setDrawings((ds) => ds.map((d) => d.id === selected.id ? { ...d, locked: !d.locked } : d))}>Lock</button>
          <button type="button" onClick={() => { const d = drawings.find((x) => x.id === selected.id); if (d) setDrawings((xs) => [...xs, { ...d, id: `${d.id}c` }]); }}>Duplicate</button>
          <button type="button" onClick={() => { snapshot(); setDrawings((d) => d.filter((x) => x.id !== selected.id)); setSelected(null); }}>Delete</button>
        </div>
      ) : null}

      {wlMenu ? (
        <div className="term-fly ctx-menu" style={{ left: wlMenu.x, top: wlMenu.y }} role="menu" aria-label="Watchlist row">
          <button type="button" role="menuitem" onClick={() => { patchSlot({ symbol: wlMenu.symbol }); setWlMenu(null); }}>Open chart</button>
          <button type="button" role="menuitem" onClick={() => { patchSlot({ symbol: wlMenu.symbol }); setRight("trade"); setWlMenu(null); }}>Trade</button>
          <button type="button" role="menuitem" onClick={() => {
            setStore((st) => ({
              ...st,
              watchlists: st.watchlists.map((w) =>
                w.id === st.activeWatchlistId ? { ...w, symbols: w.symbols.filter((x) => x !== wlMenu.symbol) } : w,
              ),
            }));
            setWlMenu(null);
          }}>Remove</button>
        </div>
      ) : null}

      <div className="toast-stack" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast-item tone-${t.tone}`}>
            <span>{t.text}</span>
            <button type="button" className="toast-x" aria-label="Dismiss" onClick={() => dismissToast(t.id)}>×</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function DrawIcon({ id }: { id: string }) {
  const p = { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.55, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (id) {
    case "cursor":
      return <svg {...p}><path d="M3.2 2.4l3.6 10.4 1.6-4.2 4.4-1.5z" /></svg>;
    case "trend":
      return <svg {...p}><path d="M2 12.5l4.4-6.2 3 2.6L14 3.2" /></svg>;
    case "levels":
      return <svg {...p}><path d="M2 5h12M2 11h12" /></svg>;
    case "channel":
      return <svg {...p}><path d="M2.5 13l11-7.5M2.5 9.5l11-7.5" /></svg>;
    case "fib":
      return <svg {...p}><path d="M3 3h10M3 6.2h10M3 9.4h10M3 13h10" /></svg>;
    case "shape":
      return <svg {...p}><rect x="3.2" y="3.2" width="9.6" height="9.6" rx="1.2" /></svg>;
    case "annotate":
      return <svg {...p}><path d="M4 11.2l6.6-6.6 1.8 1.8-6.6 6.6H4v-1.8z" /></svg>;
    case "measure":
      return <svg {...p}><path d="M3 8h10M3 6v4M13 6v4" /></svg>;
    case "position":
      return <svg {...p}><path d="M4 12.5V3.8l8 4.35-8 4.35z" /></svg>;
    default:
      return <svg {...p}><rect x="3.5" y="3.5" width="9" height="9" rx="1" /><path d="M6 8h4" /></svg>;
  }
}

function IndexPin({
  label,
  quote,
  onOpen,
}: {
  symbol?: string;
  label: string;
  quote?: Quote | null;
  onOpen: () => void;
}) {
  const live = quote?.live && quote.last > 0;
  const last = live ? quote.last : 0;
  const chgPct = live ? quote.changePct : 0;
  const up = chgPct >= 0;
  return (
    <button type="button" className="term-pin" onClick={onOpen} aria-label={`${label} ${live ? last.toFixed(0) : "waiting"}`}>
      <span className="pin-sym">{label}</span>
      <b className={live ? (up ? "up" : "down") : "muted"}>{live ? px(last, last >= 100 ? 0 : 2) : "—"}</b>
      <em className={live ? (up ? "up" : "down") : "muted"}>{live ? pct(chgPct) : ""}</em>
    </button>
  );
}

function MenuFly({ children, onClose, label, pos }: { children: React.ReactNode; onClose: () => void; label: string; pos: { top: number; left: number } }) {
  return (
    <div className="term-fly maxh" style={{ left: pos.left, top: pos.top }} role="listbox" aria-label={label}>
      {children}
      <button type="button" onClick={onClose}>Close</button>
    </div>
  );
}

function WatchlistPane({
  store, setStore, quotes, quotesLoading, flashes, q, setQ, active, onPick, onTrade, onAdd, onMenu,
}: {
  store: PersistShape;
  setStore: (fn: (s: PersistShape) => PersistShape) => void;
  quotes: Map<string, Quote>;
  quotesLoading: boolean;
  flashes: Map<string, "up" | "down">;
  q: string;
  setQ: (s: string) => void;
  active: string;
  onPick: (s: string) => void;
  onTrade: (s: string) => void;
  onAdd: () => void;
  onMenu: (menu: { x: number; y: number; symbol: string } | null) => void;
}) {
  const [sort, setSort] = useState<{ key: "sym" | "last" | "move" | "chg"; dir: 1 | -1 }>({ key: "sym", dir: 1 });
  const wl = store.watchlists.find((w) => w.id === store.activeWatchlistId) || store.watchlists[0];
  const rows = wl.symbols
    .filter((s) => !isPlaceholderSymbol(s))
    .filter((s) => !q || s.toLowerCase().includes(q.toLowerCase()) || findSymbol(s).name.toLowerCase().includes(q.toLowerCase()))
    .slice()
    .sort((a, b) => {
      const dir = sort.dir;
      if (sort.key === "sym") return dir * a.localeCompare(b);
      const qa = quotes.get(a);
      const qb = quotes.get(b);
      const va = sort.key === "last" ? qa?.last || 0 : sort.key === "move" ? qa?.change || 0 : qa?.changePct || 0;
      const vb = sort.key === "last" ? qb?.last || 0 : sort.key === "move" ? qb?.change || 0 : qb?.changePct || 0;
      return dir * (va - vb);
    });
  function toggleSort(key: "sym" | "last" | "move" | "chg") {
    setSort((s) => (s.key === key ? { key, dir: (s.dir === 1 ? -1 : 1) as 1 | -1 } : { key, dir: key === "sym" ? 1 : -1 }));
  }
  function removeSymbol(sym: string) {
    setStore((s) => ({
      ...s,
      watchlists: s.watchlists.map((list) =>
        list.id === wl.id ? { ...list, symbols: list.symbols.filter((item) => item !== sym) } : list,
      ),
    }));
  }
  return (
    <div aria-busy={quotesLoading || undefined}>
      <div className="wl-head">
        <label className="visually-hidden" htmlFor="wl-group">Watchlist</label>
        <select id="wl-group" className="wl-select" value={wl.id} onChange={(e) => setStore((s) => ({ ...s, activeWatchlistId: e.target.value }))}>
          {store.watchlists.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        <button type="button" className="term-ico" aria-label="Add watchlist" onClick={() => {
          const name = window.prompt("Watchlist name", "New list");
          if (!name) return;
          const id = `w${Date.now()}`;
          setStore((s) => ({ ...s, watchlists: [...s.watchlists, { id, name, symbols: [] }], activeWatchlistId: id }));
        }}>+</button>
        <button type="button" className="term-ico" aria-label="Rename watchlist" onClick={() => {
          const name = window.prompt("Rename", wl.name);
          if (!name) return;
          setStore((s) => ({ ...s, watchlists: s.watchlists.map((w) => w.id === wl.id ? { ...w, name } : w) }));
        }}>✎</button>
        <button type="button" className="term-ico" aria-label="Delete watchlist" onClick={() => setStore((s) => ({ ...s, watchlists: s.watchlists.filter((w) => w.id !== wl.id || s.watchlists.length === 1) }))}>×</button>
      </div>
      <div className="wl-head">
        <label className="visually-hidden" htmlFor="wl-search">Search watchlist</label>
        <input id="wl-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" />
        <button type="button" className="term-ico" aria-label="Add symbol" onClick={onAdd}>+</button>
      </div>
      <div className="wl-cols">
        <button type="button" onClick={() => toggleSort("sym")}>Symbol</button>
        <button type="button" className="num" onClick={() => toggleSort("last")}>Last</button>
        <button type="button" className="num" onClick={() => toggleSort("move")}>Chg</button>
        <button type="button" className="num" onClick={() => toggleSort("chg")}>Chg%</button>
        <span />
      </div>
      {rows.length === 0 ? (
        <div className="empty-compact">Your watchlist is empty. <button type="button" className="btn" onClick={onAdd}>Add symbol</button></div>
      ) : rows.map((sym) => {
        const qq = quotes.get(sym);
        const meta = findSymbol(sym);
        const flash = flashes.get(sym);
        const dir = (qq?.changePct || 0) >= 0 ? "up" : "down";
        const lastText = qq ? px(qq.last) : quotesLoading ? "…" : "—";
        const moveText = qq ? signedPx(qq.change) : "";
        const chgText = qq ? pct(qq.changePct) : "";
        return (
          <div
            key={sym}
            data-symbol={sym}
            tabIndex={0}
            className={`wl-row ${sym === active ? "active" : ""} ${flash ? `flash-${flash}` : ""}`}
            aria-label={`${meta.symbol} ${lastText} ${chgText}`.trim()}
            onClick={() => onPick(sym)}
            onDoubleClick={() => onTrade(sym)}
            onContextMenu={(e) => {
              e.preventDefault();
              onMenu({ x: e.clientX, y: e.clientY, symbol: sym });
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onPick(sym);
              }
            }}
          >
            <span className="wl-sym">
              <DeskMark info={meta} />
              <span className="sym">{meta.symbol}</span>
              <span className="wl-tf">D</span>
              <i className={`wl-dot ${qq?.live ? "live" : ""}`} title={qq?.live ? "Live" : "Simulated"} />
            </span>
            <span className={`last ${qq ? dir : ""}`}>{lastText}</span>
            <span className={`chg ${qq ? dir : ""}`}>{moveText}</span>
            <span className={`chgp ${qq ? dir : ""}`}>{chgText}</span>
            <button
              type="button"
              className="wl-remove"
              aria-label={`Remove ${meta.symbol} from this list`}
              onClick={(e) => {
                e.stopPropagation();
                removeSymbol(sym);
              }}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}

function DetailsPane({ info, quote, onFinancials }: { info: ReturnType<typeof findSymbol>; quote: Quote | null; onFinancials: () => void }) {
  const depth = useMemo(() => {
    if (!quote) return null;
    let a = Math.floor(quote.last * 1000) || 1;
    const rand = () => {
      a = (a * 1664525 + 1013904223) % 4294967296;
      return a / 4294967296;
    };
    return depthLadder(quote, rand);
  }, [quote]);
  return (
    <div>
      <div className="det-block">
        <h3>{info.name}</h3>
        <p className="mono">{quote ? px(quote.last) : "—"}</p>
        <p className="muted">{info.exchange} · {info.assetClass} · lot {info.lotSize}</p>
        {quote ? <p className={quote.change >= 0 ? "up" : "down"}>{signedPx(quote.change)} ({pct(quote.changePct)})</p> : null}
        {info.assetClass === "stock" || info.assetClass === "etf" ? (
          <button type="button" className="btn" onClick={onFinancials} style={{ marginTop: 10 }}>
            Fetch financials
          </button>
        ) : null}
      </div>
      {depth ? (
        <div className="det-block">
          <h3>Market depth</h3>
          <div className="depth">
            <div>{depth.bid.map((b, i) => (
              <div key={i} className="depth-row up">
                <i style={{ width: `${Math.min(100, (b.qty / (depth.bid[0]?.qty || 1)) * 100)}%` }} />
                <span>{px(b.px)} · {b.qty}</span>
              </div>
            ))}</div>
            <div>{depth.ask.map((b, i) => (
              <div key={i} className="depth-row down">
                <i style={{ width: `${Math.min(100, (b.qty / (depth.ask[0]?.qty || 1)) * 100)}%` }} />
                <span>{px(b.px)} · {b.qty}</span>
              </div>
            ))}</div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function IndSettings({ inst, onClose, onChange }: { inst: IndicatorInstance | undefined; onClose: () => void; onChange: (i: IndicatorInstance) => void }) {
  if (!inst) return null;
  const cat = catalogEntry(inst.kind);
  return (
    <div className="term-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="term-modal" role="dialog" aria-label={`${inst.label} settings`}>
        <header><h2>{inst.label}</h2><button type="button" className="term-ico" aria-label="Close" onClick={onClose}>×</button></header>
        <div className="body" style={{ display: "grid", gap: 8 }}>
          <p className="muted">{cat.info}</p>
          <div className="ind-cat">INPUTS</div>
          {Object.entries(inst.inputs).map(([k, v]) => (
            <label key={k}>{k}
              {typeof v === "number" ? (
                <input type="number" value={v} onChange={(e) => onChange({ ...inst, inputs: { ...inst.inputs, [k]: Number(e.target.value) }, label: inst.kind === "ema" || inst.kind === "sma" ? `${inst.kind.toUpperCase()} ${e.target.value}` : inst.label })} />
              ) : (
                <select value={String(v)} onChange={(e) => onChange({ ...inst, inputs: { ...inst.inputs, [k]: e.target.value } })}>
                  {["close", "open", "high", "low", "hl2", "hlc3"].map((s) => <option key={s}>{s}</option>)}
                </select>
              )}
            </label>
          ))}
          <div className="ind-cat">STYLE</div>
          <label>Line width <input type="number" min={1} max={6} value={inst.style.width} onChange={(e) => onChange({ ...inst, style: { ...inst.style, width: Number(e.target.value) } })} /></label>
          <label>Opacity <input type="number" min={0.1} max={1} step={0.1} value={inst.style.opacity} onChange={(e) => onChange({ ...inst, style: { ...inst.style, opacity: Number(e.target.value) } })} /></label>
          <label><input type="checkbox" checked={inst.showValue} onChange={(e) => onChange({ ...inst, showValue: e.target.checked })} /> Show value</label>
          <label><input type="checkbox" checked={inst.showLegend} onChange={(e) => onChange({ ...inst, showLegend: e.target.checked })} /> Show in legend</label>
          <div className="confirm-acts">
            <button type="button" className="btn ghost" onClick={() => onChange({ ...inst, inputs: { ...cat.defaults } })}>Reset</button>
            <button type="button" className="btn" onClick={onClose}>Apply</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function JournalPane({
  trades,
  journals,
  selectedId,
  learning,
  onSelect,
  onNote,
}: {
  trades: Trade[];
  journals: Record<string, string>;
  selectedId: string | null;
  learning: boolean;
  onSelect: (id: string) => void;
  onNote: (id: string, note: string) => void;
}) {
  const selected = trades.find((t) => t.id === selectedId) || trades[0] || null;
  if (!trades.length || !selected) {
    return (
      <div className="empty-compact">
        <strong>No closed trades yet</strong>
        <p>A journal opens after you close a position so you can write what you saw and why you exited.</p>
      </div>
    );
  }
  return (
    <div className="journal-grid">
      <ul className="journal-list">
        {trades.map((t) => (
          <li key={t.id}>
            <button type="button" className={t.id === selected.id ? "on" : ""} onClick={() => onSelect(t.id)}>
              <span>{t.symbol} · {t.side.toUpperCase()}</span>
              <b className={t.pnl >= 0 ? "up" : "down"}>{signedInr(t.pnl)}</b>
            </button>
          </li>
        ))}
      </ul>
      <div className="journal-editor">
        {learning ? (
          <p className="learn-hint">Write the setup, the exit, and one thing you would change. Notes stay on this device.</p>
        ) : null}
        <p className="journal-meta">
          {selected.symbol} · {selected.side.toUpperCase()} · {px(selected.entry)} → {px(selected.exit)} · {signedInr(selected.pnl)}
        </p>
        <label>
          Trade journal note
          <textarea
            value={journals[selected.id] || ""}
            rows={5}
            placeholder="What was the setup? Why this size? What would you change?"
            onChange={(e) => onNote(selected.id, e.target.value)}
          />
        </label>
      </div>
    </div>
  );
}

function EquitySpark({ curve }: { curve: { t: number; v: number }[] }) {
  if (curve.length < 2) return <p className="muted">Equity curve appears after closed trades.</p>;
  const min = Math.min(...curve.map((c) => c.v));
  const max = Math.max(...curve.map((c) => c.v));
  const d = curve.map((c, i) => {
    const x = (i / (curve.length - 1)) * 200;
    const y = 70 - ((c.v - min) / (max - min || 1)) * 60;
    return `${i ? "L" : "M"}${x},${y}`;
  }).join(" ");
  return (
    <svg viewBox="0 0 200 80" aria-label="Equity curve">
      <path d={d} fill="none" stroke="#6ea8ff" strokeWidth="1.5" />
    </svg>
  );
}

function download(name: string, text: string) {
  const blob = new Blob([text], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

