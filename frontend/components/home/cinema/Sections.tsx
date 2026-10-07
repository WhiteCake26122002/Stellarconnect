"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useReducedMotion } from "@/lib/motion";
import { Scene, type SceneId } from "./Scenes";
import { slice, useScrollProgress } from "./useScroll";

/** The "trailer": the page scrolls itself from the top to the foot, and stops the moment the visitor takes over. */
export function TourButton() {
  const reduce = useReducedMotion();
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    let acc = window.scrollY;
    const stop = () => setPlaying(false);
    const step = (now: number) => {
      const dt = Math.min(64, now - last);
      last = now;
      acc += (dt / 1000) * 260;
      // "instant": the site sets scroll-behavior: smooth on <html>, and a smooth scroll restarted every frame barely moves.
      window.scrollTo({ top: acc, behavior: "instant" });
      const end = document.documentElement.scrollHeight - window.innerHeight;
      if (acc >= end - 2) return stop();
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    const keys = (e: KeyboardEvent) => {
      if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " ", "Escape"].includes(e.key)) stop();
    };
    window.addEventListener("wheel", stop, { passive: true });
    window.addEventListener("touchstart", stop, { passive: true });
    window.addEventListener("keydown", keys);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("wheel", stop);
      window.removeEventListener("touchstart", stop);
      window.removeEventListener("keydown", keys);
    };
  }, [playing]);
  if (reduce) return null;
  return (
    <button type="button" className="cn-tour" aria-pressed={playing} onClick={() => { if (!playing) window.scrollTo({ top: 0, behavior: "instant" }); setPlaying((v) => !v); }}>
      <i aria-hidden>{playing ? "❚❚" : "▶"}</i>
      <span>
        {playing ? "Stop the tour" : "Take the tour"}
        <small>{playing ? "Scroll or press any key to take over" : "About 40 seconds"}</small>
      </span>
    </button>
  );
}

const DESK_LINKS = [
  { n: "01", label: "Paper trading", href: "/terminal" },
  { n: "02", label: "DCF models", href: "/models" },
  { n: "03", label: "Mutual funds", href: "/funds" },
];

/**
 * A black stage with a teal frame that draws itself edge by edge as the page scrolls, the three desks listed down the
 * left, and the line "Keep learning forward." The frame is four lines scaled by the scroll position, not a border.
 */
export function FrameSection({ signedIn }: { signedIn: boolean }) {
  const ref = useRef<HTMLElement>(null);
  useScrollProgress(ref, (p) => {
    const el = ref.current;
    if (!el) return;
    el.style.setProperty("--p", p.toFixed(4));
    el.style.setProperty("--draw", slice(p, 0.02, 0.55).toFixed(4));
    el.style.setProperty("--open", slice(p, 0.35, 0.85).toFixed(4));
  });
  return (
    <section className="cn-frame-sec" ref={ref} aria-labelledby="cn-frame-h">
      <div className="cn-stage">
        <div className="cn-frame" aria-hidden>
          <i className="t" />
          <i className="r" />
          <i className="b" />
          <i className="l" />
        </div>
        <p className="cn-badge">CONNECT</p>
        <ul className="cn-menu" aria-label="The desks">
          {DESK_LINKS.map((d, i) => (
            <li key={d.n} style={{ ["--k" as string]: i }}>
              <Link href={d.href}>
                <small>{d.n}</small>
                {d.label}
              </Link>
            </li>
          ))}
        </ul>
        <div className="cn-rings" aria-hidden>
          <svg viewBox="0 0 400 300">
            <circle cx="150" cy="150" r="86" pathLength={1} />
            <circle cx="250" cy="150" r="86" pathLength={1} />
            <circle cx="200" cy="96" r="86" pathLength={1} />
            <circle className="dot" cx="200" cy="150" r="5" />
          </svg>
        </div>
        <h2 id="cn-frame-h" className="cn-keep">
          Keep learning
          <br />
          forward.
        </h2>
        <p className="cn-foot-l">Simulated markets. Not investment advice.</p>
        {signedIn ? (
          <Link className="cn-foot-r" href="/choose">
            Choose a desk →
          </Link>
        ) : (
          <Link className="cn-foot-r" href="/register">
            Create an account →
          </Link>
        )}
      </div>
    </section>
  );
}

const ROUTE = "M40 470 C 170 470 190 350 285 372 S 410 528 520 430 S 560 250 468 232 S 392 336 520 330 S 700 196 790 256 S 900 126 962 84";
const STOPS = [
  { at: 0.04, n: "01", title: "Sign in", note: "One login for all three desks.", pos: "below" },
  { at: 0.27, n: "02", title: "Open the paper book", note: "₹10,00,000 of practice cash.", pos: "below" },
  { at: 0.52, n: "03", title: "Place a first order", note: "A market order, paid for in cash.", pos: "above" },
  { at: 0.76, n: "04", title: "Value a company", note: "A private DCF from your drivers.", pos: "belowfar" },
  { at: 0.98, n: "05", title: "Mark a fund", note: "Units against the daily AMFI NAV.", pos: "aboveleft" },
];

/**
 * "The session so far." A route draws itself across a dotted field as the page scrolls, a marker rides its leading end,
 * and each stop lights up as the marker passes it. The route is the path of one session on Connect.
 */
export function RouteSection() {
  const ref = useRef<HTMLElement>(null);
  const path = useRef<SVGPathElement>(null);
  const dot = useRef<SVGGElement>(null);
  const [pts, setPts] = useState<{ x: number; y: number }[]>([]);
  const [reached, setReached] = useState(0);
  const reduce = useReducedMotion();

  useLayoutEffect(() => {
    const p = path.current;
    if (!p) return;
    const len = p.getTotalLength();
    setPts(STOPS.map((s) => p.getPointAtLength(len * s.at)));
  }, []);

  useScrollProgress(ref, (p) => {
    const el = ref.current;
    const line = path.current;
    if (!el || !line) return;
    const t = slice(p, 0.08, 0.92);
    el.style.setProperty("--draw", t.toFixed(4));
    const len = line.getTotalLength();
    const at = line.getPointAtLength(len * t);
    dot.current?.setAttribute("transform", `translate(${at.x.toFixed(1)} ${at.y.toFixed(1)})`);
    setReached(STOPS.filter((s) => t >= s.at - 0.005).length);
  });

  return (
    <section className="cn-route-sec" ref={ref} aria-labelledby="cn-route-h">
      <div className="cn-stage">
        <svg className="cn-dots" aria-hidden>
          <defs>
            <pattern id="cn-dotp" width="22" height="22" patternUnits="userSpaceOnUse">
              <circle cx="2" cy="2" r="1.2" />
            </pattern>
            <radialGradient id="cn-fade" cx="50%" cy="55%" r="60%">
              <stop offset="0" stopColor="#fff" />
              <stop offset="1" stopColor="#000" />
            </radialGradient>
            <mask id="cn-dotmask">
              <rect width="100%" height="100%" fill="url(#cn-fade)" />
            </mask>
          </defs>
          <rect width="100%" height="100%" fill="url(#cn-dotp)" mask="url(#cn-dotmask)" />
        </svg>
        <h2 id="cn-route-h" className="cn-big teal">
          The session
          <br />
          so far.
        </h2>
        <p className="cn-sub">Every session on Connect follows the same route. Scroll to walk it.</p>
        <div className="cn-route">
          <svg viewBox="0 0 1000 560" preserveAspectRatio="xMidYMid meet" aria-hidden>
            <path d={ROUTE} className="ghost" />
            <path ref={path} d={ROUTE} className="line" pathLength={1} style={reduce ? { strokeDashoffset: 0 } : undefined} />
            <g ref={dot} className="marker">
              <circle r="16" className="halo" />
              <circle r="6" />
            </g>
          </svg>
          {pts.map((pt, i) => (
            <div key={STOPS[i].n} className={`cn-stop ${STOPS[i].pos}${reached > i ? " on" : ""}`} style={{ left: `${(pt.x / 1000) * 100}%`, top: `${(pt.y / 560) * 100}%` }}>
              <i aria-hidden />
              <span className="lbl">
                <b>{STOPS[i].n}</b>
                <strong>{STOPS[i].title}</strong>
                <small>{STOPS[i].note}</small>
              </span>
            </div>
          ))}
        </div>
        {reached > 0 ? (
          <p className="cn-route-cap" aria-hidden>
            <b>{STOPS[reached - 1].n}</b>
            <strong>{STOPS[reached - 1].title}</strong>
            <small>{STOPS[reached - 1].note}</small>
          </p>
        ) : null}
        <p className="cn-corner">From first order ↓</p>
      </div>
    </section>
  );
}

export const PATH_STEPS: { n: string; title: string; body: string; scene: SceneId }[] = [
  { n: "01", title: "One account", body: "Sign in once. Paper trading, DCF models and mutual fund holdings share that login.", scene: "account" },
  { n: "02", title: "Paper book", body: "A new book starts at ₹10,00,000. Buys take cash. Prices refresh about every 20 seconds and can be delayed. Nothing here is a live order.", scene: "book" },
  { n: "03", title: "Private DCF", body: "Build a model from filings and drivers. It stays on your account, and the paper desk never overwrites it.", scene: "dcf" },
  { n: "04", title: "AMFI book", body: "Search a scheme, record the units you hold, and mark them to the latest published NAV. Allocation and XIRR are arithmetic on that book.", scene: "funds" },
];

/**
 * "From first trade to portfolio." A pinned stage with a vertical line down the middle. The four steps are cards in
 * depth: the current one sits forward and lit with its caption beside it, the others recede above and below, dimmer,
 * smaller and blurred, and the stack travels as the page scrolls.
 */
export function TimelineSection() {
  const ref = useRef<HTMLElement>(null);
  const cards = useRef<(HTMLElement | null)[]>([]);
  const [now, setNow] = useState(0);
  const N = PATH_STEPS.length;

  useScrollProgress(ref, (p) => {
    const el = ref.current;
    if (!el) return;
    const at = slice(p, 0.04, 0.96) * (N - 1);
    el.style.setProperty("--p", p.toFixed(4));
    cards.current.forEach((c, i) => {
      if (!c) return;
      const d = i - at;
      const a = Math.abs(d);
      const side = i % 2 ? 1 : -1;
      // On a wide screen the lit card sits left of centre with its caption on the right; on a phone it is centred.
      const narrow = window.innerWidth < 900;
      const x = (narrow ? 0 : -10) + side * Math.min(a, 1) * (narrow ? 9 : 20);
      const y = d * 40;
      const z = -Math.min(a, 2) * 140;
      const s = 1 - Math.min(a, 2) * 0.16;
      c.style.transform = `translate3d(${x}vw, ${y}vh, ${z}px) scale(${s.toFixed(3)})`;
      c.style.opacity = String(Math.max(0, 1 - a * 0.78).toFixed(3));
      c.style.filter = a < 0.35 ? "none" : `blur(${Math.min(a, 2) * 2.2}px) brightness(${Math.max(0.35, 1 - a * 0.35)})`;
      c.style.zIndex = String(10 - Math.round(a * 4));
    });
    setNow(Math.min(N - 1, Math.max(0, Math.round(at))));
  });

  return (
    <section className="cn-time-sec" ref={ref} aria-labelledby="cn-time-h">
      <div className="cn-stage">
        <h2 id="cn-time-h" className="cn-big teal small">
          From first
          <br />
          trade to
          <br />
          portfolio.
        </h2>
        <div className="cn-axis" aria-hidden>
          <i />
          <ol>
            {PATH_STEPS.map((s, i) => (
              <li key={s.n} className={i === now ? "on" : ""}>
                {s.n}
              </li>
            ))}
          </ol>
        </div>
        <div className="cn-deck">
          {PATH_STEPS.map((s, i) => (
            <article
              key={s.n}
              ref={(el) => {
                cards.current[i] = el;
              }}
              className={`cn-card${i === now ? " on" : ""}`}
              aria-current={i === now}
            >
              <Scene id={s.scene} label={s.title} className="cn-card-art" />
              <div className="cn-card-copy">
                <small>{s.n}</small>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

/** "Open a desk." The line is uncovered from left to right as it scrolls into view. */
export function OpenSection() {
  const ref = useRef<HTMLElement>(null);
  useScrollProgress(
    ref,
    (p) => {
      ref.current?.style.setProperty("--reveal", slice(p, 0.18, 0.5).toFixed(4));
    },
    "pass",
  );
  return (
    <section className="cn-open" ref={ref} aria-labelledby="cn-open-h">
      <h2 id="cn-open-h" className="cn-big outline">
        <span>Open</span> <span>a desk.</span>
      </h2>
    </section>
  );
}
