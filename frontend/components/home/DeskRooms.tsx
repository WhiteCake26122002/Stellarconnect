"use client";

import { useRouter } from "next/navigation";
import { CSSProperties, PointerEvent, useState } from "react";

/**
 * The three desk rooms: each previews its desk with a small figure that follows the pointer, leans toward it, widens
 * when hovered, and opens its desk on a click. Shared by the Home page and the "Choose a desk" page.
 */

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function pointerT(e: PointerEvent<HTMLElement>, axis: "x" | "y") {
  const r = e.currentTarget.getBoundingClientRect();
  const raw = axis === "x" ? (e.clientX - r.left) / Math.max(1, r.width) : (e.clientY - r.top) / Math.max(1, r.height);
  return clamp01(raw);
}

function HomeDcf() {
  const [t, setT] = useState(0.42);
  const g = 0.062 + t * 0.048;
  const margin = 0.165 + t * 0.035;
  const wacc = 0.098 - t * 0.016;
  const fcff5 = 64 * (1 + g) ** 5;
  const tv = (fcff5 * 1.03) / Math.max(0.02, wacc - 0.03);
  const implied = ((fcff5 * 4.2 + tv * 0.62) - 80) / 120;
  const rows = [
    ["Growth", `${(g * 100).toFixed(1)}%`],
    ["EBIT margin", `${(margin * 100).toFixed(1)}%`],
    ["WACC", `${(wacc * 100).toFixed(1)}%`],
    ["Implied", implied.toFixed(2)],
  ];
  return (
    <span className="home-preview" onPointerMove={(e) => setT(pointerT(e, "y"))}>
      <span className="home-preview-figure">
        <small>Implied</small>
        <b>{implied.toFixed(2)}</b>
      </span>
      <ol>
        {rows.map(([k, v]) => (
          <li key={k}>
            <span>{k}</span>
            <strong>{v}</strong>
          </li>
        ))}
      </ol>
    </span>
  );
}

function HomeFunds() {
  const base = [
    { name: "Flexi cap", weight: 46, color: "#9a9a9a", multiple: 1.195 },
    { name: "Debt", weight: 32, color: "#ffffff", multiple: 1.06 },
    { name: "ELSS", weight: 22, color: "#555555", multiple: 1.176 },
  ];
  const invested = 4.2;
  const [t, setT] = useState<number | null>(null);
  const cuts = base.map((_, i) => base.slice(0, i + 1).reduce((sum, item) => sum + item.weight, 0));
  const active = t == null ? -1 : Math.max(0, cuts.findIndex((cut) => t * 100 <= cut));
  const start = active <= 0 ? 0 : cuts[active - 1];
  const local = active < 0 || t == null ? 0.5 : (t * 100 - start) / base[active].weight;
  const weights = base.map((slice, i) => (active === i ? slice.weight + 8 : active < 0 ? slice.weight : slice.weight - 4));
  const multiples = base.map((slice, i) => (active === i ? 0.94 + local * 0.32 : slice.multiple));
  const value = base.reduce((sum, slice, i) => sum + invested * (weights[i] / 100) * multiples[i], 0);
  const sleeve = active < 0 ? null : (multiples[active] - 1) * 100;
  return (
    <span
      className="home-preview"
      onPointerMove={(e) => setT(Math.min(0.999, pointerT(e, "x")))}
      onPointerLeave={() => setT(null)}
    >
      <span className="home-preview-figure">
        <small>Sample book</small>
        <b>₹{value.toFixed(2)}L</b>
      </span>
      <span className="home-alloc" aria-hidden>
        {base.map((slice, i) => (
          <i key={slice.name} className={i === active ? "on" : ""} style={{ width: `${weights[i]}%`, background: slice.color }} />
        ))}
      </span>
      <ol>
        {base.map((slice, i) => (
          <li key={slice.name} className={i === active ? "on" : ""}>
            <span>
              <i className="home-swatch" style={{ background: slice.color }} aria-hidden />
              {slice.name}
            </span>
            <strong>{weights[i].toFixed(0)}%</strong>
          </li>
        ))}
      </ol>
      <p>
        {sleeve == null
          ? "Move across the bar."
          : `${base[active].name} · ${sleeve >= 0 ? "+" : "−"}${Math.abs(sleeve).toFixed(1)}%`}
      </p>
    </span>
  );
}

function homeCandles() {
  const bars: { o: number; h: number; l: number; c: number }[] = [];
  let px = 104;
  for (let i = 0; i < 36; i += 1) {
    const o = px;
    const step = Math.sin(i / 3.2) * 1.6 + ((i * 5) % 7) - 3;
    const c = Math.max(96, Math.min(132, o + step));
    const h = Math.max(o, c) + 0.9 + (i % 3) * 0.45;
    const l = Math.min(o, c) - 0.8 - (i % 2) * 0.4;
    bars.push({ o, h, l, c });
    px = c;
  }
  return bars;
}

const HOME_CANDLES = homeCandles();

function HomeTape() {
  const [t, setT] = useState(0.62);
  const end = Math.max(10, Math.min(HOME_CANDLES.length, Math.round(10 + t * (HOME_CANDLES.length - 10))));
  const vis = HOME_CANDLES.slice(Math.max(0, end - 14), end);
  const min = Math.min(...vis.map((bar) => bar.l));
  const max = Math.max(...vis.map((bar) => bar.h));
  const span = Math.max(0.01, max - min);
  const y = (price: number) => 8 + ((max - price) / span) * 62;
  const slot = 220 / vis.length;
  const last = vis[vis.length - 1];
  const up = last.c >= last.o;
  return (
    <span className="home-preview" onPointerMove={(e) => setT(pointerT(e, "x"))}>
      <span className="home-preview-figure">
        <small>Replay</small>
        <b className={up ? "up" : "down"}>{last.c.toFixed(2)}</b>
      </span>
      <svg viewBox="0 0 220 78" width="100%" height="78" aria-hidden>
        {vis.map((bar, i) => {
          const bull = bar.c >= bar.o;
          const color = bull ? "#159b72" : "#d84e61";
          const x = i * slot + slot / 2;
          const top = y(Math.max(bar.o, bar.c));
          const body = Math.max(1.8, y(Math.min(bar.o, bar.c)) - top);
          const width = Math.max(4, slot * 0.52);
          return (
            <g key={i}>
              <line x1={x} x2={x} y1={y(bar.h)} y2={y(bar.l)} stroke={color} strokeWidth="1.15" />
              <rect x={x - width / 2} y={top} width={width} height={body} fill={color} />
            </g>
          );
        })}
      </svg>
      <p>{up ? "▲ sample tape" : "▼ sample tape"} · drag across the candles</p>
    </span>
  );
}

export function DeskRooms() {
  const router = useRouter();
  const [hot, setHot] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const rooms = [
    {
      id: "paper",
      n: "01",
      href: "/terminal",
      className: "paper",
      kicker: "Tape",
      name: "Paper trading",
      blurb: "Scrub the replay. Fills on the real desk are simulated.",
      preview: <HomeTape />,
    },
    {
      id: "dcf",
      n: "02",
      href: "/models",
      className: "dcf",
      kicker: "Valuation",
      name: "DCF",
      blurb: "Move up and down the pad. Growth, margin, and WACC rewrite the implied price.",
      preview: <HomeDcf />,
    },
    {
      id: "funds",
      n: "03",
      href: "/funds",
      className: "funds",
      kicker: "Holdings",
      name: "Mutual funds",
      blurb: "Move across the bar. Sleeve weight and the sample book move with you.",
      preview: <HomeFunds />,
    },
  ];
  const current = rooms.find((room) => room.id === hot);

  function open(href: string, id: string) {
    if (opening) return;
    setOpening(id);
    router.push(href);
  }

  // The room leans toward the pointer and a pool of light follows it. Written straight to the element, not to React state.
  function lean(e: PointerEvent<HTMLElement>) {
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    const x = clamp01((e.clientX - r.left) / Math.max(1, r.width));
    const y = clamp01((e.clientY - r.top) / Math.max(1, r.height));
    el.style.setProperty("--px", `${(x * 100).toFixed(1)}%`);
    el.style.setProperty("--py", `${(y * 100).toFixed(1)}%`);
    el.style.setProperty("--rx", `${((0.5 - y) * 3.2).toFixed(2)}deg`);
    el.style.setProperty("--ry", `${((x - 0.5) * 4).toFixed(2)}deg`);
  }
  function settle(e: PointerEvent<HTMLElement>) {
    for (const k of ["--px", "--py", "--rx", "--ry"]) e.currentTarget.style.removeProperty(k);
  }

  return (
    <>
      <div className="cn-desks-head">
        <p>
          <b>03</b> desks · one account
        </p>
        <p className="cn-desks-hint" aria-live="polite">
          <i aria-hidden />
          {opening
            ? `Opening ${rooms.find((room) => room.id === opening)?.name}…`
            : current
              ? `Click ${current.name} to load that desk.`
              : "Move across a room, then click it. The real desk uses your account."}
        </p>
      </div>
      <div
        className={`cn-rooms${hot || opening ? " has-hot" : ""}`}
        data-hot={opening ?? hot ?? ""}
        onPointerLeave={() => setHot(null)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHot(null);
        }}
      >
        {rooms.map((room, k) => (
          <button
            key={room.id}
            type="button"
            style={{ "--k": k } as CSSProperties}
            className={`cn-room ${room.className}${(opening ?? hot) === room.id ? " hot" : ""}${opening === room.id ? " opening" : ""}`}
            aria-busy={opening === room.id}
            disabled={opening != null && opening !== room.id}
            onPointerEnter={() => setHot(room.id)}
            onPointerMove={lean}
            onPointerLeave={settle}
            onFocus={() => setHot(room.id)}
            onClick={() => open(room.href, room.id)}
          >
            <i className="cn-room-glow" aria-hidden />
            <span className="cn-room-n" aria-hidden>
              {room.n}
            </span>
            {room.preview}
            <span className="cn-room-kicker">{room.kicker}</span>
            <strong>{room.name}</strong>
            <em>{room.blurb}</em>
            <span className="cn-room-go">
              <span>{opening === room.id ? "Opening…" : "Click to open"}</span>
              <b aria-hidden>→</b>
            </span>
            <span className="cn-room-wipe" aria-hidden>
              Opening {room.name}
            </span>
          </button>
        ))}
      </div>
    </>
  );
}

