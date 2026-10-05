"use client";

import Link from "next/link";
import { PointerEvent, useEffect, useMemo, useRef, useState } from "react";

type Bar = { o: number; h: number; l: number; c: number };

function buildTape(): Bar[] {
  const bars: Bar[] = [];
  let px = 112;
  for (let i = 0; i < 42; i += 1) {
    const wave = Math.sin(i / 4.4) * 4.1;
    const step = ((i * 13) % 11) - 5;
    const o = px;
    const c = Math.max(90, Math.min(138, o + wave * 0.42 + step * 0.52));
    const h = Math.max(o, c) + 1.5 + (i % 4) * 0.55;
    const l = Math.min(o, c) - 1.4 - (i % 3) * 0.45;
    bars.push({ o, h, l, c });
    px = c;
  }
  return bars;
}

function sizeCanvas(canvas: HTMLCanvasElement) {
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 340;
  const cssH = canvas.clientHeight || 150;
  const w = Math.floor(cssW * dpr);
  const h = Math.floor(cssH * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  return { cssW, cssH, dpr };
}

function drawTape(canvas: HTMLCanvasElement, bars: Bar[], t: number) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const { cssW, cssH, dpr } = sizeCanvas(canvas);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  const n = bars.length;
  const end = Math.max(8, Math.min(n, Math.round(t * n)));
  const start = Math.max(0, end - 24);
  const vis = bars.slice(start, end);
  const min = Math.min(...bars.map((b) => b.l)) - 2;
  const max = Math.max(...bars.map((b) => b.h)) + 2;
  const pad = 8;
  const slot = (cssW - 8) / Math.max(24, vis.length);
  const y = (p: number) => pad + ((max - p) / (max - min)) * (cssH - pad * 2);
  vis.forEach((bar, i) => {
    const x = 6 + i * slot + slot / 2;
    const bull = bar.c >= bar.o;
    const color = bull ? "#3dd68c" : "#f07178";
    const wick = bull ? "#1a9e63" : "#e25b66";
    ctx.strokeStyle = wick;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(x, y(bar.h));
    ctx.lineTo(x, y(bar.l));
    ctx.stroke();
    const top = y(Math.max(bar.o, bar.c));
    const bot = y(Math.min(bar.o, bar.c));
    ctx.fillStyle = color;
    ctx.fillRect(x - Math.max(2.4, slot * 0.28), top, Math.max(4.8, slot * 0.56), Math.max(2.2, bot - top));
  });
  return vis[vis.length - 1];
}

function PaperPreview() {
  const bars = useMemo(buildTape, []);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const quoteRef = useRef<HTMLSpanElement>(null);
  const dirRef = useRef<HTMLElement>(null);
  const tRef = useRef(0.62);
  const hoverRef = useRef(false);
  const scrubRef = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let id = 0;
    let last = performance.now();
    let alive = true;
    const paint = () => {
      const lastBar = drawTape(canvas, bars, tRef.current);
      if (lastBar && quoteRef.current) {
        quoteRef.current.textContent = lastBar.c.toFixed(2);
        const up = lastBar.c >= lastBar.o;
        if (dirRef.current) {
          dirRef.current.className = up ? "up" : "down";
          dirRef.current.textContent = up ? "▲ replay" : "▼ replay";
        }
      }
    };
    const loop = (now: number) => {
      if (!alive) return;
      const dt = Math.min(32, now - last);
      last = now;
      if (hoverRef.current && !scrubRef.current) {
        tRef.current += dt * 0.00032;
        if (tRef.current > 0.98) tRef.current = 0.22;
      }
      scrubRef.current = false;
      paint();
      if (hoverRef.current) id = requestAnimationFrame(loop);
      else id = 0;
    };
    const kick = () => {
      if (!alive || id) return;
      last = performance.now();
      id = requestAnimationFrame(loop);
    };
    const ro = new ResizeObserver(() => paint());
    ro.observe(canvas);
    paint();
    const node = canvas.parentElement;
    node?.addEventListener("pointerenter", kick);
    return () => {
      alive = false;
      ro.disconnect();
      node?.removeEventListener("pointerenter", kick);
      if (id) cancelAnimationFrame(id);
    };
  }, [bars]);

  function onMove(e: PointerEvent<HTMLSpanElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    tRef.current = Math.min(0.98, Math.max(0.18, (e.clientX - r.left) / Math.max(1, r.width)));
    hoverRef.current = true;
    scrubRef.current = true;
  }

  return (
    <span
      className="choose-tape"
      aria-hidden
      onPointerEnter={() => {
        hoverRef.current = true;
      }}
      onPointerLeave={() => {
        hoverRef.current = false;
      }}
      onPointerMove={onMove}
    >
      <span className="choose-quote">
        <b ref={quoteRef}>112.00</b>
        <em ref={dirRef} className="up">
          ▲ replay
        </em>
      </span>
      <canvas ref={canvasRef} />
    </span>
  );
}

function DcfPad() {
  const [t, setT] = useState(0.42);
  const pending = useRef(0);

  function onMove(e: PointerEvent<HTMLSpanElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const next = Math.min(1, Math.max(0, (e.clientY - r.top) / Math.max(1, r.height)));
    if (pending.current) return;
    pending.current = requestAnimationFrame(() => {
      pending.current = 0;
      setT(next);
    });
  }

  const g = 0.062 + t * 0.048;
  const margin = 0.165 + t * 0.035;
  const wacc = 0.098 - t * 0.016;
  const fcff0 = 64;
  const years = [1, 2, 3, 4, 5].map((y) => fcff0 * (1 + g) ** y);
  const pvs = years.map((fcff, i) => fcff / (1 + wacc) ** (i + 1));
  const tv = (years[4] * 1.03) / Math.max(0.02, wacc - 0.03);
  const ev = pvs.reduce((sum, v) => sum + v, 0) + tv / (1 + wacc) ** 5;
  const implied = (ev - 80) / 120;
  const step = Math.min(5, Math.floor(t * 6));
  const rows = [
    { k: "Revenue growth", v: `${(g * 100).toFixed(1)}%`, f: "g from the forecast" },
    { k: "EBIT margin", v: `${(margin * 100).toFixed(1)}%`, f: "EBIT ÷ revenue" },
    { k: "WACC", v: `${(wacc * 100).toFixed(1)}%`, f: "discount for the cash flows" },
    { k: "FCFF₅", v: years[4].toFixed(0), f: "FCFF₀ × (1+g)⁵" },
    { k: "Terminal value", v: Math.round(tv).toLocaleString("en-IN"), f: "FCFF₅ × (1+3%) ÷ (WACC − g)" },
    { k: "Implied share", v: implied.toFixed(2), f: "(Σ PV(FCFF) + PV(TV) − net debt) ÷ shares" },
  ];

  return (
    <span className="choose-model" aria-hidden onPointerMove={onMove}>
      <span className="choose-implied">
        <small>Implied</small>
        <b>{implied.toFixed(2)}</b>
      </span>
      <ol>
        {rows.map((row, i) => (
          <li key={row.k} className={i === step ? "on" : i < step ? "done" : ""}>
            <span>{row.k}</span>
            <strong>{row.v}</strong>
          </li>
        ))}
      </ol>
      <p className="choose-formula">{rows[step].f}</p>
    </span>
  );
}

function FundPreview() {
  const base = [
    { name: "Flexi cap", weight: 46, color: "#2ee6de", multiple: 1.195 },
    { name: "Debt", weight: 32, color: "#a78bfa", multiple: 1.06 },
    { name: "ELSS", weight: 22, color: "#fbbf24", multiple: 1.176 },
  ];
  const invested = 4.2;
  const [t, setT] = useState<number | null>(null);
  const pending = useRef(0);

  function onMove(e: PointerEvent<HTMLSpanElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const next = Math.min(0.999, Math.max(0, (e.clientX - r.left) / Math.max(1, r.width)));
    if (pending.current) return;
    pending.current = requestAnimationFrame(() => {
      pending.current = 0;
      setT(next);
    });
  }

  const cuts = base.map((slice, i) => base.slice(0, i + 1).reduce((sum, item) => sum + item.weight, 0));
  const active = t == null ? -1 : Math.max(0, cuts.findIndex((cut) => t * 100 <= cut));
  const start = active <= 0 ? 0 : cuts[active - 1];
  const local = active < 0 ? 0.5 : (t! * 100 - start) / base[active].weight;
  const weights = base.map((slice, i) => (active === i ? slice.weight + 8 : active < 0 ? slice.weight : slice.weight - 4));
  const multiples = base.map((slice, i) => (active === i ? 0.94 + local * 0.32 : slice.multiple));
  const value = base.reduce((sum, slice, i) => sum + invested * (weights[i] / 100) * multiples[i], 0);
  const sleeveGain = active < 0 ? null : (multiples[active] - 1) * 100;
  const note =
    active < 0
      ? "Move across the bar. Each sleeve’s weight and NAV follow the pointer."
      : `${base[active].name} · ${weights[active].toFixed(0)}% · sleeve ${sleeveGain! >= 0 ? "+" : "−"}${Math.abs(sleeveGain!).toFixed(1)}%`;

  return (
    <span className="choose-funds" aria-hidden onPointerMove={onMove} onPointerLeave={() => setT(null)}>
      <span className="choose-quote">
        <b>₹{value.toFixed(2)}L</b>
        <em className={sleeveGain == null ? "" : sleeveGain >= 0 ? "up" : "down"}>
          {sleeveGain == null ? "sample book" : sleeveGain >= 0 ? "▲ sleeve" : "▼ sleeve"}
        </em>
      </span>
      <span className="choose-alloc">
        {base.map((slice, i) => (
          <i key={slice.name} className={i === active ? "on" : ""} style={{ width: `${weights[i]}%`, background: slice.color }} />
        ))}
      </span>
      <ol>
        {base.map((slice, i) => (
          <li key={slice.name} className={i === active ? "on" : ""}>
            <span>{slice.name}</span>
            <strong>{weights[i].toFixed(0)}%</strong>
          </li>
        ))}
      </ol>
      <p className="choose-fund-note">{note}</p>
    </span>
  );
}

export function DeskChooser({ name }: { name: string }) {
  const first = (name || "there").trim().split(/\s+/)[0];

  return (
    <main id="main" className="choose-root">
      <header className="choose-top">
        <p className="choose-hello">Hello, {first}.</p>
        <h1>Choose a desk</h1>
        <p className="choose-hint">Open the room you want. Same account, three tools.</p>
      </header>

      <div className="choose-stage" role="group" aria-label="Desks">
        <Link href="/models" className="choose-room dcf" aria-label="Open DCF">
          <DcfPad />
          <span className="choose-kicker">Valuation</span>
          <strong className="choose-name">DCF</strong>
          <em>Filings, drivers, and a forecast that stays yours.</em>
        </Link>

        <Link href="/funds" className="choose-room funds" aria-label="Open mutual funds">
          <FundPreview />
          <span className="choose-kicker">Holdings</span>
          <strong className="choose-name">Mutual funds</strong>
          <em>Daily AMFI NAVs, allocation, and your own XIRR.</em>
        </Link>

        <Link href="/terminal" className="choose-room paper" aria-label="Open paper trading">
          <PaperPreview />
          <span className="choose-kicker">Market</span>
          <strong className="choose-name">Paper trading</strong>
          <em>Chart the tape. Size a ticket. Journal the fill.</em>
        </Link>
      </div>
    </main>
  );
}
