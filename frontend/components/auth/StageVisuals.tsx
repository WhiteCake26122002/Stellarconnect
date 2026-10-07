"use client";

import { CSSProperties, PointerEvent, RefObject, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";

/* Interactive previews for the sign-in stage. Every figure is generated from a seeded random
   walk or a toy formula and the stage labels the whole thing "Illustrative". Nothing is a live
   quote and nothing here talks to the API.

   Each chart is drawn in real pixels: the svg's viewBox is the size of the box it sits in, so type
   stays the same size on every screen and the plot always fills its panel (no letterboxing). */

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pixel size of a container, kept current with a ResizeObserver. */
function useBox(): [RefObject<HTMLDivElement | null>, { w: number; h: number }] {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 640, h: 280 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const r = el.getBoundingClientRect();
      const w = Math.round(r.width);
      const h = Math.round(r.height);
      if (w > 0 && h > 0) setBox((b) => (b.w === w && b.h === h ? b : { w, h }));
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, box];
}

/** Client coords -> svg user units. */
function toSvg(svg: SVGSVGElement | null, e: PointerEvent<SVGSVGElement>) {
  const ctm = svg?.getScreenCTM();
  if (!svg || !ctm) return null;
  const pt = svg.createSVGPoint();
  pt.x = e.clientX;
  pt.y = e.clientY;
  return pt.matrixTransform(ctm.inverse());
}

const sign = (v: number) => (v >= 0 ? "+" : "−");
const rupee = (v: number) => `₹${Math.round(v).toLocaleString("en-US")}`;
const arrow = (up: boolean) => <i aria-hidden="true">{up ? "▲" : "▼"}</i>;

/* ------------------------------------------------------------------ Trade */

type Bar = { o: number; h: number; l: number; c: number; v: number };
type Pos = { side: 1 | -1; entry: number };
type Mark = { idx: number; side: 1 | -1 };

const PX_SCALE = 48;
const BAR_COUNT = 60;

function nextBar(prev: number, rnd: () => number): Bar {
  const o = prev;
  const c = o + (rnd() - 0.47) * 2.6;
  return { o, c, h: Math.max(o, c) + rnd() * 1.4, l: Math.min(o, c) - rnd() * 1.4, v: 0.25 + rnd() * 0.75 };
}

function seedBars(n: number): Bar[] {
  const rnd = mulberry32(11);
  const out: Bar[] = [];
  let px = 100;
  for (let i = 0; i < n; i += 1) {
    const b = nextBar(px, rnd);
    out.push(b);
    px = b.c;
  }
  return out;
}

function ema(values: number[], period: number) {
  const k = 2 / (period + 1);
  const out: number[] = [];
  values.forEach((v, i) => out.push(i === 0 ? v : v * k + out[i - 1] * (1 - k)));
  return out;
}

const showPx = (p: number, digits = 0) =>
  (22000 + (p - 100) * PX_SCALE).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });

export function TradeVisual({ active, reduce }: { active: boolean; reduce: boolean }) {
  const [bars, setBars] = useState<Bar[]>(() => seedBars(BAR_COUNT));
  const [hover, setHover] = useState<number | null>(null);
  const [pos, setPos] = useState<Pos | null>(null);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [closed, setClosed] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [boxRef, { w, h }] = useBox();

  // The tape ticks while visible, and freezes under the cursor so a candle can actually be read.
  useEffect(() => {
    if (!active || reduce || hover !== null) return;
    const rnd = mulberry32(Date.now() % 100000);
    const id = window.setInterval(() => {
      setBars((prev) => [...prev.slice(1), nextBar(prev[prev.length - 1].c, rnd)]);
      setMarks((m) => m.map((x) => ({ ...x, idx: x.idx - 1 })).filter((x) => x.idx >= 0));
    }, 950);
    return () => window.clearInterval(id);
  }, [active, reduce, hover]);

  const left = 16;
  const right = Math.max(left + 220, w - 96);
  const priceTop = 20;
  const volH = Math.round(Math.min(70, Math.max(36, h * 0.16)));
  const volBottom = h - 16;
  const volTop = volBottom - volH;
  const priceBottom = volTop - 18;

  const lo = Math.min(...bars.map((b) => b.l));
  const hi = Math.max(...bars.map((b) => b.h));
  const pad = (hi - lo) * 0.08;
  const y = (p: number) => priceTop + (1 - (p - (lo - pad)) / (hi - lo + pad * 2)) * (priceBottom - priceTop);
  const slot = (right - left) / bars.length;
  const bodyW = Math.max(3, slot * 0.6);
  const cx = (i: number) => left + slot * i + slot / 2;
  const line = ema(bars.map((b) => b.c), 9)
    .map((v, i) => `${cx(i).toFixed(1)},${y(v).toFixed(1)}`)
    .join(" ");
  const last = bars[bars.length - 1];
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => lo + (hi - lo) * t);
  const focus = hover === null ? null : bars[hover];

  function onMove(e: PointerEvent<SVGSVGElement>) {
    const p = toSvg(svgRef.current, e);
    if (!p || p.x < left || p.x > right || p.y < priceTop || p.y > volBottom) {
      setHover(null);
      return;
    }
    setHover(Math.min(bars.length - 1, Math.max(0, Math.floor((p.x - left) / slot))));
  }

  function trade(side: 1 | -1) {
    if (!pos) {
      setPos({ side, entry: last.c });
      setMarks((m) => [...m, { idx: bars.length - 1, side }]);
      setClosed(null);
    } else if (pos.side !== side) {
      flat();
    }
  }
  function flat() {
    if (!pos) return;
    setClosed(pos.side * (last.c - pos.entry) * PX_SCALE);
    setMarks((m) => [...m, { idx: bars.length - 1, side: (-pos.side) as 1 | -1 }]);
    setPos(null);
  }

  const pnl = pos ? pos.side * (last.c - pos.entry) * PX_SCALE : 0;
  const pnlChip = (v: number, label: string) => (
    <span className={`vz-pnl ${v >= 0 ? "up" : "down"}`}>
      {arrow(v >= 0)} {label}
    </span>
  );
  let readout: React.ReactNode = "Hover the chart, or place a sample order";
  if (focus) {
    readout = (
      <>
        O <b>{showPx(focus.o)}</b> H <b>{showPx(focus.h)}</b> L <b>{showPx(focus.l)}</b> C <b>{showPx(focus.c)}</b>
      </>
    );
  } else if (pos) {
    readout = (
      <>
        {pos.side === 1 ? "Long" : "Short"} @ <b>{showPx(pos.entry)}</b> {pnlChip(pnl, `${sign(pnl)}${Math.abs(pnl).toFixed(1)} pts`)}
      </>
    );
  } else if (closed !== null) {
    readout = <>Closed {pnlChip(closed, `${sign(closed)}${Math.abs(closed).toFixed(1)} pts`)}</>;
  }

  const entryY = pos ? Math.min(priceBottom, Math.max(priceTop, y(pos.entry))) : 0;

  return (
    <>
      <div className="vz-tools">
        <div className="vz-group" role="group" aria-label="Sample paper order">
          <button type="button" className="vz-btn vz-btn-primary" onClick={() => trade(1)} disabled={pos?.side === 1}>
            Buy
          </button>
          <button type="button" className="vz-btn" onClick={() => trade(-1)} disabled={pos?.side === -1}>
            Sell
          </button>
          <button type="button" className="vz-btn vz-btn-ghost" onClick={flat} disabled={!pos}>
            Flat
          </button>
        </div>
        <p className="vz-readout">{readout}</p>
      </div>
      <div className="vz-canvas" ref={boxRef}>
        <svg
          ref={svgRef}
          className="vz-svg vz-live"
          width={w}
          height={h}
          viewBox={`0 0 ${w} ${h}`}
          aria-hidden="true"
          focusable="false"
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        >
          <g className="cv-grid">
            {ticks.map((p) => (
              <line key={p} x1={left} x2={right} y1={y(p)} y2={y(p)} />
            ))}
          </g>
          <g className="cv-axis">
            {ticks.map((p) => (
              <text key={p} x={right + 12} y={y(p)} dy="0.35em">
                {showPx(p)}
              </text>
            ))}
          </g>
          {bars.map((b, i) => {
            const bull = b.c >= b.o;
            const top = Math.min(y(b.o), y(b.c));
            return (
              <g key={i} className={`${bull ? "cv-up" : "cv-down"}${hover === i ? " is-hot" : ""}`}>
                <rect
                  className={bull ? "cv-vol-up" : "cv-vol-down"}
                  x={cx(i) - bodyW / 2}
                  y={volBottom - b.v * volH}
                  width={bodyW}
                  height={b.v * volH}
                />
                <line className="cv-wick" x1={cx(i)} x2={cx(i)} y1={y(b.h)} y2={y(b.l)} />
                <rect x={cx(i) - bodyW / 2} y={top} width={bodyW} height={Math.max(1.8, Math.abs(y(b.o) - y(b.c)))} rx={1.5} />
              </g>
            );
          })}
          <polyline className="cv-ema" points={line} />
          {pos ? (
            <g className="tv-entry">
              <line x1={left} x2={right} y1={entryY} y2={entryY} />
              <text x={left + 8} y={entryY - 8}>
                {pos.side === 1 ? "Long" : "Short"} {showPx(pos.entry)}
              </text>
            </g>
          ) : null}
          {marks.map((m, k) => {
            const b = bars[m.idx];
            if (!b) return null;
            const buy = m.side === 1;
            const x = cx(m.idx);
            const yy = buy ? y(b.l) + 18 : y(b.h) - 18;
            const d = buy ? `M${x},${yy - 7} l7,12 h-14 z` : `M${x},${yy + 7} l7,-12 h-14 z`;
            return (
              <g key={k} className={`tv-mark ${buy ? "tv-buy" : "tv-sell"}`}>
                <path d={d} />
                <text x={x + 11} y={yy} dy="0.35em">
                  {buy ? "B" : "S"}
                </text>
              </g>
            );
          })}
          <g className="cv-last">
            <line x1={left} x2={right} y1={y(last.c)} y2={y(last.c)} />
            <rect x={right + 4} y={y(last.c) - 11} width={78} height={22} rx={5} />
            <text x={right + 43} y={y(last.c)} dy="0.35em" textAnchor="middle">
              {showPx(last.c, 2)}
            </text>
          </g>
          {focus && hover !== null ? (
            <g className="cv-cross">
              <line x1={cx(hover)} x2={cx(hover)} y1={priceTop} y2={volBottom} />
              <line x1={left} x2={right} y1={y(focus.c)} y2={y(focus.c)} />
              <rect x={right + 4} y={y(focus.c) - 11} width={78} height={22} rx={5} />
              <text x={right + 43} y={y(focus.c)} dy="0.35em" textAnchor="middle">
                {showPx(focus.c, 2)}
              </text>
            </g>
          ) : null}
        </svg>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ Value */

const AXIS_LO = 900;
const AXIS_SPAN = 800;
const price = (f: number) => AXIS_LO + f * AXIS_SPAN;
const MARKET = 0.42;
const BASE_IMPLIED = 0.58;
const FIELD_ROWS = [
  { tag: "DCF", name: "Gordon growth", lo: 0.3, hi: 0.68, dcf: true },
  { tag: "DCF", name: "Exit multiple", lo: 0.36, hi: 0.76, dcf: true },
  { tag: "Cross-check", name: "Trading comps", lo: 0.22, hi: 0.6, dcf: false },
  { tag: "Cross-check", name: "52-week range", lo: 0.14, hi: 0.66, dcf: false },
] as const;

export function ValueVisual() {
  const [wacc, setWacc] = useState(9.5);
  const [growth, setGrowth] = useState(4.0);
  const [hot, setHot] = useState<number | null>(null);
  const [boxRef, { w, h }] = useBox();

  // Toy sensitivity, in fractions of the axis: lower WACC and higher terminal growth lift the DCF bars.
  const shift = Math.max(-0.2, Math.min(0.2, (9.5 - wacc) * 0.03 + (growth - 4) * 0.04));
  const impliedF = BASE_IMPLIED + shift;
  const impliedPx = price(impliedF);
  const marketPx = price(MARKET);
  const upside = ((impliedPx - marketPx) / marketPx) * 100;

  const labelW = Math.round(Math.min(190, Math.max(128, w * 0.19)));
  const x0 = labelW + 28;
  const x1 = w - 28;
  const span = x1 - x0;
  const at = (f: number) => x0 + f * span;
  const chartTop = 58;
  const chartBottom = h - 44;
  const rowH = (chartBottom - chartTop) / FIELD_ROWS.length;
  const roomy = rowH >= 46; // two-line row labels need the height; otherwise the name stands alone
  const rowC = (i: number) => chartTop + rowH * (i + 0.5);
  const barH = Math.round(Math.min(38, Math.max(20, rowH * 0.52)));
  // Narrow panels: drop the ₹ sign and tighten the type so the two end labels never touch.
  const compact = span * 0.38 < 175;
  const fig = (v: number) => (compact ? Math.round(v).toLocaleString("en-US") : rupee(v));
  const marketX = at(MARKET);
  const impliedX = at(impliedF);
  const dx = shift * span;
  const impliedRight = impliedX >= marketX;
  const bandX = Math.min(marketX, impliedX);

  const pct = (v: number, min: number, max: number) => ((v - min) / (max - min)) * 100;

  return (
    <>
      <div className="vz-tools">
        <div className="vz-group vz-sliders">
          <label className="vz-slider">
            <span className="vz-slider-name">WACC</span>
            <input
              type="range"
              min={7}
              max={13}
              step={0.1}
              value={wacc}
              style={{ "--p": `${pct(wacc, 7, 13)}%` } as CSSProperties}
              onChange={(e) => setWacc(Number(e.target.value))}
              aria-valuetext={`${wacc.toFixed(1)} percent`}
            />
            <output>{wacc.toFixed(1)}%</output>
          </label>
          <label className="vz-slider">
            <span className="vz-slider-name">Terminal g</span>
            <input
              type="range"
              min={2}
              max={6}
              step={0.1}
              value={growth}
              style={{ "--p": `${pct(growth, 2, 6)}%` } as CSSProperties}
              onChange={(e) => setGrowth(Number(e.target.value))}
              aria-valuetext={`${growth.toFixed(1)} percent`}
            />
            <output>{growth.toFixed(1)}%</output>
          </label>
        </div>
        <p className="vz-readout vz-verdict">
          <span className="vz-verdict-label">Implied vs market</span>
          <span className={`vz-chip ${upside >= 0 ? "up" : "down"}`}>
            {arrow(upside >= 0)} {sign(upside)}
            {Math.abs(upside).toFixed(1)}%
          </span>
        </p>
      </div>
      <div className="vz-canvas" ref={boxRef}>
        <svg className={`vz-svg${compact ? " is-compact" : ""}`} width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" focusable="false" onPointerLeave={() => setHot(null)}>
          {FIELD_ROWS.map((r, i) =>
            i % 2 === 0 ? (
              <rect key={r.name} className="ff-band" x={10} y={chartTop + rowH * i} width={w - 20} height={rowH} rx={10} />
            ) : null,
          )}
          <g className="cv-grid">
            {[0, 0.25, 0.5, 0.75, 1].map((f) => (
              <line key={f} x1={at(f)} x2={at(f)} y1={chartTop - 8} y2={chartBottom} />
            ))}
          </g>
          <g className="cv-axis">
            {[0, 0.25, 0.5, 0.75, 1].map((f) => (
              <text key={f} x={at(f)} y={chartBottom + 22} textAnchor="middle">
                {rupee(price(f))}
              </text>
            ))}
            <text x={18} y={chartBottom + 22}>
              Value per share
            </text>
          </g>

          <rect className="ff-gap" x={bandX} y={chartTop - 8} width={Math.abs(impliedX - marketX)} height={chartBottom - chartTop + 8} />
          <line className="ff-market" x1={marketX} x2={marketX} y1={chartTop - 10} y2={chartBottom} />
          <g className="ff-shift" style={{ transform: `translateX(${dx}px)` }}>
            <line className="ff-implied-line" x1={at(BASE_IMPLIED)} x2={at(BASE_IMPLIED)} y1={chartTop - 8} y2={chartBottom} />
          </g>

          {FIELD_ROWS.map((r, i) => {
            const shiftBy = r.dcf ? shift : 0;
            return (
              <g
                key={r.name}
                className={`ff-row${hot !== null && hot !== i ? " is-dim" : ""}`}
                onPointerEnter={() => setHot(i)}
              >
                <rect className="ff-hit" x={10} y={chartTop + rowH * i} width={w - 20} height={rowH} />
                {roomy ? (
                  <text className="ff-tag" x={20} y={rowC(i) - 9}>
                    {r.tag}
                  </text>
                ) : null}
                <text className="ff-label" x={20} y={rowC(i) + (roomy ? 9 : 0)} dy={roomy ? undefined : "0.35em"}>
                  {r.name}
                </text>
                <g className="ff-shift" style={{ transform: r.dcf ? `translateX(${dx}px)` : undefined }}>
                  <rect
                    className={`ff-bar ${r.dcf ? "is-dcf" : "is-ref"}`}
                    style={{ "--i": i } as CSSProperties}
                    x={at(r.lo)}
                    y={rowC(i) - barH / 2}
                    width={at(r.hi) - at(r.lo)}
                    height={barH}
                    rx={barH / 2}
                  />
                  <text className={`ff-val ${r.dcf ? "is-dcf" : "is-ref"}`} x={at(r.lo) + barH / 2 + 2} y={rowC(i)} dy="0.35em">
                    {fig(price(r.lo + shiftBy))}
                  </text>
                  <text className={`ff-val ${r.dcf ? "is-dcf" : "is-ref"}`} x={at(r.hi) - barH / 2 - 2} y={rowC(i)} dy="0.35em" textAnchor="end">
                    {fig(price(r.hi + shiftBy))}
                  </text>
                </g>
              </g>
            );
          })}

          <text className="ff-flag" x={marketX + (impliedRight ? -10 : 10)} y={chartTop - 22} textAnchor={impliedRight ? "end" : "start"}>
            Market <tspan className="ff-flag-strong">{rupee(marketPx)}</tspan>
          </text>

          <g className="ff-implied" style={{ "--i": 4 } as CSSProperties}>
            <g className="ff-shift" style={{ transform: `translateX(${dx}px)` }}>
              <path className="ff-diamond" d={`M${at(BASE_IMPLIED)},${chartTop - 18} l8,9 l-8,9 l-8,-9 z`} />
            </g>
            <text className="ff-flag" x={impliedX + (impliedRight ? 14 : -14)} y={chartTop - 22} textAnchor={impliedRight ? "start" : "end"}>
              Implied <tspan className="ff-flag-strong">{rupee(impliedPx)}</tspan>
            </text>
          </g>
        </svg>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ Track */

const RANGES = {
  "1Y": { n: 48, seed: 3 },
  "3Y": { n: 64, seed: 5 },
  "5Y": { n: 80, seed: 9 },
} as const;
type Range = keyof typeof RANGES;

function smooth(pts: Array<[number, number]>) {
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length - 1; i += 1) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[i + 1];
    d += ` Q${x1.toFixed(1)},${y1.toFixed(1)} ${((x1 + x2) / 2).toFixed(1)},${((y1 + y2) / 2).toFixed(1)}`;
  }
  const end = pts[pts.length - 1];
  return `${d} L${end[0].toFixed(1)},${end[1].toFixed(1)}`;
}

/** Cumulative return (%) of the sample funds and the index, both starting from zero. */
function trackSeries(range: Range) {
  const { n, seed } = RANGES[range];
  const rnd = mulberry32(seed);
  const nifty: number[] = [];
  const fund: number[] = [];
  let a = 0;
  let b = 0;
  for (let i = 0; i < n; i += 1) {
    const shock = (rnd() - 0.46) * 1.5;
    a += shock;
    b += shock * 0.8 + (rnd() - 0.4) * 0.7 + 0.045;
    nifty.push(a);
    fund.push(b);
  }
  const zero = (arr: number[]) => arr.map((v) => (v - arr[0]) * 1.6);
  return { n, nifty: zero(nifty), fund: zero(fund) };
}

const signed = (v: number) => `${sign(v)}${Math.abs(v).toFixed(1)}%`;

export function TrackVisual() {
  const gid = useId().replace(/:/g, "");
  const [range, setRange] = useState<Range>("3Y");
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [boxRef, { w, h }] = useBox();
  const s = useMemo(() => trackSeries(range), [range]);

  const L = 58;
  const R = Math.max(L + 200, w - 118);
  const T = 22;
  const B = h - 54;

  const lo = Math.min(...s.nifty, ...s.fund, 0);
  const hi = Math.max(...s.nifty, ...s.fund, 0);
  const step = [2, 5, 10, 20, 25, 50].find((st) => (hi - lo) / st <= 5) ?? 50;
  const t0 = Math.floor(lo / step) * step;
  const t1 = Math.ceil(hi / step) * step;
  const px = (i: number) => L + (i / (s.n - 1)) * (R - L);
  const py = (v: number) => B - ((v - t0) / (t1 - t0)) * (B - T);
  const gridTicks: number[] = [];
  for (let v = t0; v <= t1 + 1e-9; v += step) gridTicks.push(v);

  const pathNifty = smooth(s.nifty.map((v, i) => [px(i), py(v)] as [number, number]));
  const pathFund = smooth(s.fund.map((v, i) => [px(i), py(v)] as [number, number]));
  const endF = s.fund[s.n - 1];
  const endN = s.nifty[s.n - 1];
  let yF = py(endF);
  let yN = py(endN);
  if (Math.abs(yF - yN) < 26) {
    const mid = (yF + yN) / 2;
    yF = mid + (yF <= yN ? -13 : 13);
    yN = mid + (yF <= yN ? 13 : -13);
  }

  function onMove(e: PointerEvent<SVGSVGElement>) {
    const p = toSvg(svgRef.current, e);
    if (!p || p.x < L - 8 || p.x > R + 8 || p.y < T - 14 || p.y > B + 8) {
      setHover(null);
      return;
    }
    const i = Math.round(((p.x - L) / (R - L)) * (s.n - 1));
    setHover(Math.min(s.n - 1, Math.max(0, i)));
  }

  const fundPct = hover === null ? 0 : s.fund[hover];
  const niftyPct = hover === null ? 0 : s.nifty[hover];
  const lead = fundPct - niftyPct;

  return (
    <>
      <div className="vz-tools">
        <div className="vz-group" role="group" aria-label="Sample period">
          {(Object.keys(RANGES) as Range[]).map((r) => (
            <button
              key={r}
              type="button"
              className="vz-btn"
              aria-pressed={range === r}
              onClick={() => {
                setRange(r);
                setHover(null);
              }}
            >
              {r}
            </button>
          ))}
        </div>
        <p className="vz-readout">
          {hover === null ? (
            "Hover the chart to compare"
          ) : (
            <>
              Funds <b>{signed(fundPct)}</b> · Nifty <b>{signed(niftyPct)}</b>{" "}
              <span className={`vz-pnl ${lead >= 0 ? "up" : "down"}`}>
                {arrow(lead >= 0)} {`${sign(lead)}${Math.abs(lead).toFixed(1)} pts`}
              </span>
            </>
          )}
        </p>
      </div>
      <div className="vz-canvas" ref={boxRef}>
        <svg ref={svgRef} className="vz-svg" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" focusable="false" onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
          <defs>
            <linearGradient id={`${gid}-fill`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="#111" stopOpacity="0.14" />
              <stop offset="1" stopColor="#111" stopOpacity="0" />
            </linearGradient>
          </defs>
          <g className="cv-grid">
            {gridTicks.map((v) => (
              <line key={v} className={v === 0 ? "is-zero" : undefined} x1={L} x2={R} y1={py(v)} y2={py(v)} />
            ))}
          </g>
          <g className="cv-axis">
            {gridTicks.map((v) => (
              <text key={v} x={L - 12} y={py(v)} dy="0.35em" textAnchor="end">
                {v === 0 ? "0%" : `${v > 0 ? "+" : "−"}${Math.abs(v)}%`}
              </text>
            ))}
          </g>
          <g key={range}>
            <path className="tr-area" d={`${pathFund} L${R},${B} L${L},${B} Z`} fill={`url(#${gid}-fill)`} />
            <path className="tr-line tr-nifty" pathLength={1} d={pathNifty} />
            <path className="tr-line tr-fund" pathLength={1} d={pathFund} />
            <circle className="tr-dot" cx={px(s.n - 1)} cy={py(endF)} r={5.5} />
            <g className="tr-end">
              <g transform={`translate(${R + 14} ${yF})`}>
                <rect className="tr-end-fund" x={0} y={-11} width={96} height={22} rx={11} />
                <text x={48} y={0} dy="0.35em" textAnchor="middle">
                  Funds {signed(endF)}
                </text>
              </g>
              <g transform={`translate(${R + 14} ${yN})`}>
                <rect className="tr-end-nifty" x={0} y={-11} width={96} height={22} rx={11} />
                <text x={48} y={0} dy="0.35em" textAnchor="middle">
                  Nifty {signed(endN)}
                </text>
              </g>
            </g>
          </g>
          {hover !== null ? (
            <g className="cv-cross">
              <line x1={px(hover)} x2={px(hover)} y1={T - 10} y2={B} />
              <circle className="tr-pt tr-pt-nifty" cx={px(hover)} cy={py(s.nifty[hover])} r={5} />
              <circle className="tr-pt tr-pt-fund" cx={px(hover)} cy={py(s.fund[hover])} r={5.5} />
            </g>
          ) : null}
          <g className="tr-legend">
            <line className="tr-fund" x1={L} x2={L + 26} y1={h - 18} y2={h - 18} />
            <text x={L + 36} y={h - 18} dy="0.35em">
              Your funds (NAV-marked)
            </text>
            <line className="tr-nifty" x1={L + 232} x2={L + 258} y1={h - 18} y2={h - 18} />
            <text x={L + 268} y={h - 18} dy="0.35em">
              Nifty 50, same dates
            </text>
          </g>
        </svg>
      </div>
    </>
  );
}
