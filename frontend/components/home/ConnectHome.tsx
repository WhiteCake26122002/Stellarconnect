"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { PointerEvent, useState } from "react";
import { ConnectLogo } from "@/components/ConnectLogo";
import { api } from "@/lib/api";

export function ConnectHome({
  user,
}: {
  user: { id: string; display_name: string } | null;
}) {
  const router = useRouter();
  const first = (user?.display_name || "there").split(/\s+/)[0];
  const [why, setWhy] = useState<number | null>(null);

  async function signOut() {
    await api.logout();
    router.push("/login");
  }

  return (
    <div className="home-root">
      <header className="home-bar">
        <ConnectLogo size="md" alt="Connect" />
        <nav aria-label="Home">
          <a href="#desks">Desks</a>
          <a href="#faq">FAQ</a>
          {user ? (
            <>
              <Link href="/terminal">Paper trading</Link>
              <Link href="/models">DCF</Link>
              <Link href="/funds">Funds</Link>
              <button type="button" className="home-pill ghost" onClick={signOut}>
                Sign out
              </button>
            </>
          ) : (
            <>
              <Link href="/login">Sign in</Link>
              <Link className="home-pill" href="/register">
                Create account
              </Link>
            </>
          )}
        </nav>
      </header>

      <main id="main">
        <section className="home-hero">
          <h1>Three desks. One account.</h1>
          <p className="hero-lead">
            Paper-trade the Indian tape, value a company with a private DCF, or mark mutual fund
            holdings to the daily AMFI NAV. Not investment advice.
          </p>
        </section>

        <DeskStage />

        <Bento />

        <SessionPath />

        <section className="home-experience">
          <div className="home-device">
            <header>
              <span className="home-device-hello">
                <i aria-hidden>{first.charAt(0).toUpperCase()}</i>
                Hello, {first}!
              </span>
              <span className="home-device-chip">
                <i aria-hidden />
                Paper desk · sample
              </span>
            </header>
            <div className="home-device-grid">
              <article>
                <em>Paper book</em>
                <b>₹10,00,000</b>
                <span>Starting cash on a new account</span>
                <span className="home-device-meter" aria-hidden>
                  <i style={{ width: "100%" }} />
                </span>
                <small className="home-device-foot">
                  <span>Cash 100%</span>
                  <span>Invested 0%</span>
                </small>
              </article>
              <article>
                <em>Marks</em>
                <b>20s</b>
                <span>Last quote refresh on the desk</span>
                <span className="home-device-meter refresh" aria-hidden>
                  <i />
                </span>
                <small className="home-device-foot">
                  <span>Refresh cycle</span>
                  <span>Yahoo last</span>
                </small>
              </article>
              <DeviceTape />
            </div>
          </div>
          <h2>Trading experience</h2>
          <p>A dark desk you can hover, click, and size from. The chart stays the object.</p>
        </section>

        <section className="home-why" aria-labelledby="why-title">
          <div className="home-why-copy">
            <p className="home-kicker">Why Connect</p>
            <h2 id="why-title">
              Why Connect is the
              <em> three-desk platform</em>
            </h2>
            <p className="home-why-note" aria-live="polite">
              {why == null ? "Point at a figure. It says what that desk actually does." : WHY[why].note}
            </p>
          </div>
          <ul onPointerLeave={() => setWhy(null)}>
            {WHY.map((item, i) => (
              <li key={item.value} className={why === i ? "on" : ""}>
                <button type="button" onMouseEnter={() => setWhy(i)} onFocus={() => setWhy(i)}>
                  <span>{item.label}</span>
                  <b>{item.value}</b>
                  <small>{item.small}</small>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <Faq />
      </main>

      <footer className="home-foot">
        <ConnectLogo size="md" alt="" />
        <p>Shashank S and Mokshagna Bingi. Paper trading, DCF, and mutual funds. Simulated fills. Not investment advice.</p>
        <nav aria-label="Desks">
          <Link href="/terminal">Paper</Link>
          <Link href="/models">DCF</Link>
          <Link href="/funds">Funds</Link>
        </nav>
      </footer>
    </div>
  );
}

const WHY = [
  {
    label: "Live last",
    value: "20s",
    small: "Yahoo marks on the paper chart",
    note: "The paper chart takes the last Yahoo mark, about every 20 seconds. It is a replay of the tape, not an order ticket.",
  },
  {
    label: "DCF",
    value: "Private",
    small: "Models stay on this account",
    note: "A model is built from filings and drivers, then saved on this account. The paper desk does not overwrite it.",
  },
  {
    label: "Funds",
    value: "AMFI",
    small: "Daily NAV on the schemes you hold",
    note: "Search an AMFI scheme, record the units you hold, and the book marks them to the latest published NAV.",
  },
];

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function pointerT(e: PointerEvent<HTMLElement>, axis: "x" | "y") {
  const r = e.currentTarget.getBoundingClientRect();
  const raw = axis === "x" ? (e.clientX - r.left) / Math.max(1, r.width) : (e.clientY - r.top) / Math.max(1, r.height);
  return clamp01(raw);
}

function deskCandles() {
  const bars: { o: number; h: number; l: number; c: number; v: number }[] = [];
  let px = 111.4;
  for (let i = 0; i < 48; i += 1) {
    const o = px;
    const step = Math.sin(i / 4) * 1.3 + Math.cos(i / 2.3) * 0.8 + (((i * 7) % 5) - 2) * 0.45;
    const c = Math.max(101, Math.min(129, o + step));
    const h = Math.max(o, c) + 0.5 + (i % 4) * 0.3;
    const l = Math.min(o, c) - 0.45 - (i % 3) * 0.28;
    bars.push({ o, h, l, c, v: 34 + ((i * 13) % 9) * 7 + Math.abs(step) * 16 });
    px = c;
  }
  return bars;
}

const DESK_CANDLES = deskCandles();
const DESK = { w: 680, h: 176, gutter: 50, top: 10, priceBottom: 124, volTop: 134, volBottom: 170 };

function DeviceTape() {
  const [hover, setHover] = useState<number | null>(null);
  const bars = DESK_CANDLES;
  const n = bars.length;
  const plotW = DESK.w - DESK.gutter;
  const slot = plotW / n;
  const min = Math.min(...bars.map((bar) => bar.l));
  const max = Math.max(...bars.map((bar) => bar.h));
  const span = Math.max(0.01, max - min);
  const maxVol = Math.max(...bars.map((bar) => bar.v));
  const y = (price: number) => DESK.top + ((max - price) / span) * (DESK.priceBottom - DESK.top);
  const idx = hover ?? n - 1;
  const bar = bars[idx];
  const prev = bars[Math.max(0, idx - 1)];
  const change = ((bar.c - prev.c) / prev.c) * 100;
  const up = bar.c >= bar.o;
  const cx = idx * slot + slot / 2;
  const cy = y(bar.c);
  const ticks = [max - span * 0.1, min + span / 2, min + span * 0.1];

  function onMove(e: PointerEvent<HTMLDivElement>) {
    const x = pointerT(e, "x") * DESK.w;
    setHover(Math.max(0, Math.min(n - 1, Math.floor(Math.min(x, plotW - 0.01) / slot))));
  }

  return (
    <article className="span home-tape">
      <div className="home-tape-head">
        <div>
          <em>Desk</em>
          <b>
            {bar.c.toFixed(2)}
            <small className={change >= 0 ? "up" : "down"}>
              {change >= 0 ? "+" : "−"}
              {Math.abs(change).toFixed(2)}%
            </small>
          </b>
          <span>Move across the chart. Sample replay, not a live quote.</span>
        </div>
        <dl className="home-tape-ohlc" aria-live="polite">
          {(
            [
              ["O", bar.o],
              ["H", bar.h],
              ["L", bar.l],
              ["C", bar.c],
            ] as const
          ).map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd className={up ? "up" : "down"}>{v.toFixed(2)}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div className="home-tape-chart" onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${DESK.w} ${DESK.h}`} aria-hidden>
          {ticks.map((tick) => (
            <g key={tick}>
              <line className="grid" x1={0} x2={plotW} y1={y(tick)} y2={y(tick)} />
              {Math.abs(y(tick) - cy) > 14 && (
                <text className="axis" x={plotW + 8} y={y(tick) + 3.5}>
                  {tick.toFixed(1)}
                </text>
              )}
            </g>
          ))}
          {bars.map((b, i) => {
            const bull = b.c >= b.o;
            const color = bull ? "#3dd68c" : "#f07178";
            const x = i * slot + slot / 2;
            const top = y(Math.max(b.o, b.c));
            const body = Math.max(1.6, y(Math.min(b.o, b.c)) - top);
            const width = Math.max(3, slot * 0.56);
            const vh = (b.v / maxVol) * (DESK.volBottom - DESK.volTop);
            const dim = hover != null && i !== hover;
            return (
              <g key={i} opacity={dim ? 0.45 : 1}>
                <rect x={x - width / 2} y={DESK.volBottom - vh} width={width} height={vh} fill={color} opacity={0.2} />
                <line x1={x} x2={x} y1={y(b.h)} y2={y(b.l)} stroke={color} strokeWidth="1.1" />
                <rect x={x - width / 2} y={top} width={width} height={body} rx={0.8} fill={color} />
              </g>
            );
          })}
          <line className={hover == null ? "last" : "cross"} x1={0} x2={plotW} y1={cy} y2={cy} />
          {hover != null && <line className="cross" x1={cx} x2={cx} y1={DESK.top - 6} y2={DESK.volBottom} />}
          <rect x={plotW + 3} y={cy - 8} width={DESK.gutter - 5} height={16} rx={3} fill={up ? "#3dd68c" : "#f07178"} />
          <text className="tag" x={plotW + 3 + (DESK.gutter - 5) / 2} y={cy + 3.8}>
            {bar.c.toFixed(2)}
          </text>
        </svg>
      </div>
    </article>
  );
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
    { name: "Flexi cap", weight: 46, color: "#2ee6de", multiple: 1.195 },
    { name: "Debt", weight: 32, color: "#a78bfa", multiple: 1.06 },
    { name: "ELSS", weight: 22, color: "#fbbf24", multiple: 1.176 },
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
          const color = bull ? "#3dd68c" : "#f07178";
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

function DeskStage() {
  const router = useRouter();
  const [hot, setHot] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const rooms = [
    {
      id: "dcf",
      href: "/models",
      className: "dcf",
      kicker: "Valuation",
      name: "DCF",
      blurb: "Move up and down the pad. Growth, margin, and WACC rewrite the implied price.",
      preview: <HomeDcf />,
    },
    {
      id: "funds",
      href: "/funds",
      className: "funds",
      kicker: "Holdings",
      name: "Mutual funds",
      blurb: "Move across the bar. Sleeve weight and the sample book move with you.",
      preview: <HomeFunds />,
    },
    {
      id: "paper",
      href: "/terminal",
      className: "paper",
      kicker: "Tape",
      name: "Paper trading",
      blurb: "Scrub the replay. Fills on the real desk are simulated.",
      preview: <HomeTape />,
    },
  ];
  const current = rooms.find((room) => room.id === hot);

  function open(href: string, id: string) {
    if (opening) return;
    setOpening(id);
    router.push(href);
  }

  return (
    <section className="home-stage-wrap" id="desks" aria-labelledby="desks-title">
      <div className="home-stage-head">
        <p className="home-kicker">The desks</p>
        <h2 id="desks-title">Open a room. The figure follows your hand.</h2>
        <p aria-live="polite">
          {opening
            ? `Opening ${rooms.find((room) => room.id === opening)?.name}…`
            : current
              ? `Click ${current.name} to load that desk.`
              : "Move across a room, then click it. The real desk uses your account."}
        </p>
      </div>
      <div
        className={`home-stage${hot || opening ? " has-hot" : ""}`}
        onPointerLeave={() => setHot(null)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHot(null);
        }}
      >
        {rooms.map((room) => (
          <button
            key={room.id}
            type="button"
            className={`home-room ${room.className}${(opening ?? hot) === room.id ? " hot" : ""}${opening === room.id ? " opening" : ""}`}
            aria-busy={opening === room.id}
            disabled={opening != null && opening !== room.id}
            onPointerEnter={() => setHot(room.id)}
            onFocus={() => setHot(room.id)}
            onClick={() => open(room.href, room.id)}
          >
            {room.preview}
            <span className="home-room-kicker">{room.kicker}</span>
            <strong>{room.name}</strong>
            <em>{room.blurb}</em>
            <span className="home-open">{opening === room.id ? "Opening…" : "Click to open"}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

const PATH = [
  {
    title: "One account",
    body: "Sign in once. Paper trading, DCF models, and mutual fund holdings share that login.",
  },
  {
    title: "Paper book",
    body: "A new book starts at ₹10,00,000. Buys take cash. Quotes on the chart refresh about every 20 seconds. Nothing here is a live order.",
  },
  {
    title: "Private DCF",
    body: "Build a model from filings and drivers. It stays on the account. The paper desk does not overwrite it.",
  },
  {
    title: "AMFI book",
    body: "Search a scheme, record the units you hold, and mark them to the latest published NAV. Allocation and XIRR are arithmetic on that book.",
  },
];

function SessionPath() {
  const [step, setStep] = useState(0);
  return (
    <section className="home-path" aria-labelledby="path-title">
      <h2 id="path-title">What one session holds</h2>
      <div className="home-path-grid">
        <div role="tablist" aria-label="Session">
          {PATH.map((item, i) => (
            <button
              key={item.title}
              type="button"
              role="tab"
              id={`path-tab-${i}`}
              aria-selected={step === i}
              aria-controls="path-panel"
              tabIndex={step === i ? 0 : -1}
              className={step === i ? "on" : ""}
              onClick={() => setStep(i)}
              onKeyDown={(e) => {
                if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
                e.preventDefault();
                const dir = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : -1;
                const next = (i + dir + PATH.length) % PATH.length;
                setStep(next);
                document.getElementById(`path-tab-${next}`)?.focus();
              }}
            >
              <span>0{i + 1}</span>
              {item.title}
            </button>
          ))}
        </div>
        <div role="tabpanel" id="path-panel" aria-labelledby={`path-tab-${step}`}>
          <p className="home-kicker">0{step + 1}</p>
          <h3>{PATH[step].title}</h3>
          <p>{PATH[step].body}</p>
        </div>
      </div>
    </section>
  );
}

const FAQ = [
  {
    q: "Is any of this real money?",
    a: "No. The paper desk starts every new book at ₹10,00,000 of pretend cash. Orders fill against the last quote inside the app and are never sent to a broker or exchange.",
  },
  {
    q: "Where do the prices come from?",
    a: "The paper chart takes the last Yahoo Finance quote for each symbol, refreshed about every 20 seconds while the tab is open. When no live quote is available, the chart says so and replays a sample tape instead.",
  },
  {
    q: "Where is my data kept?",
    a: "Your paper book (positions, orders, trade history) lives in this browser, so clearing site data or switching devices starts a fresh book. DCF models and mutual fund holdings are saved to your account and follow your login.",
  },
  {
    q: "How are mutual funds valued?",
    a: "Each scheme is marked to the latest NAV published by AMFI. Gains, allocation and XIRR are arithmetic on the units, prices and dates you entered, compared with Nifty 50 and Nifty 500 bought with the same rupees on the same dates.",
  },
  {
    q: "What goes into a DCF model?",
    a: "A model starts from the company's reported financials (Screener and Yahoo Finance). You set the drivers such as growth, margins and WACC, and the implied value per share updates as you change them. Models are private to your account.",
  },
  {
    q: "Is this investment advice?",
    a: "No. Connect is a practice and learning tool. Nothing here is a recommendation to buy or sell, and it is not a substitute for a SEBI-registered advisor.",
  },
];

function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section className="home-faq" id="faq" aria-labelledby="faq-title">
      <div className="home-faq-head">
        <p className="home-kicker">FAQ</p>
        <h2 id="faq-title">Questions before you start</h2>
        <p>Short answers on money, prices, and where your data lives.</p>
      </div>
      <ul>
        {FAQ.map((item, i) => {
          const isOpen = open === i;
          return (
            <li key={item.q} className={isOpen ? "on" : ""}>
              <h3>
                <button
                  type="button"
                  id={`faq-q-${i}`}
                  aria-expanded={isOpen}
                  aria-controls={`faq-a-${i}`}
                  onClick={() => setOpen(isOpen ? null : i)}
                >
                  <span>{item.q}</span>
                  <i aria-hidden />
                </button>
              </h3>
              <div id={`faq-a-${i}`} role="region" aria-labelledby={`faq-q-${i}`} className="home-faq-a" hidden={!isOpen}>
                <p>{item.a}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Bento() {
  const [spot, setSpot] = useState({ x: 72, y: 58 });

  function onMove(e: PointerEvent<HTMLElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    setSpot({
      x: ((e.clientX - r.left) / Math.max(1, r.width)) * 100,
      y: ((e.clientY - r.top) / Math.max(1, r.height)) * 100,
    });
  }

  return (
    <section className="home-bento" aria-label="What Connect does">
      <article className="bento-card" data-n="01" onPointerMove={onMove}>
        <h2>
          Real-time
          <em> insights of trading</em>
        </h2>
        <p>Last quotes on the paper desk. Hover this tile — the search mark follows you.</p>
        <div className="bento-orbit" aria-hidden>
          <i className="o o1" />
          <i className="o o2" />
          <i className="o o3" />
          <span className="bento-lens" style={{ left: `${spot.x}%`, top: `${spot.y}%` }}>
            ⌕
          </span>
        </div>
      </article>
      <article className="bento-card" data-n="02">
        <h2>
          Get up to ₹10,00,000
          <em> in paper capital</em>
        </h2>
        <ul>
          <li>New book starts at ten lakh rupees</li>
          <li>Buys take the full amount from cash</li>
          <li>No margin overlay on the book</li>
        </ul>
        <div className="bento-donut" aria-hidden>
          <svg viewBox="0 0 120 120">
            <circle cx="60" cy="60" r="44" />
            <circle className="arc" cx="60" cy="60" r="44" />
          </svg>
          <b>Book</b>
        </div>
      </article>
      <article className="bento-card" data-n="03">
        <h2>Value a company in DCF</h2>
        <p>Private models from filings and drivers. The paper desk never overwrites them.</p>
        <div className="bento-scan" aria-hidden>
          <span className="face" />
          <span className="bars" />
        </div>
      </article>
      <article className="bento-card" data-n="04">
        <h2>Your data is fully protected</h2>
        <p>Paper fills stay on this device. DCF models and mutual fund holdings stay on the account.</p>
        <div className="bento-print" aria-hidden />
      </article>
    </section>
  );
}
