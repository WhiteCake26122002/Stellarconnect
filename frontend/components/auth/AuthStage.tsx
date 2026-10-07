"use client";

import { CSSProperties, KeyboardEvent, PointerEvent, useEffect, useId, useRef, useState } from "react";
import { ConnectLogo } from "@/components/ConnectLogo";
import { useReducedMotion } from "@/lib/motion";
import { PauseIcon, PlayIcon } from "./icons";
import { TrackVisual, TradeVisual, ValueVisual } from "./StageVisuals";

const DESKS = [
  {
    id: "value",
    n: "01",
    name: "Value",
    tool: "DCF",
    title: "Implied value vs. market price",
    lede: "Build a DCF from a ticker or pasted statements, stress the drivers, and defend the number.",
  },
  {
    id: "trade",
    n: "02",
    name: "Trade",
    tool: "Paper",
    title: "Sample market · 1-minute bars",
    lede: "Paper-trade the tape with a real chart, drawing tools and replay. Simulated fills, no real money.",
  },
  {
    id: "track",
    n: "03",
    name: "Track",
    tool: "Funds",
    title: "Your funds vs. Nifty 50",
    lede: "Mark your mutual funds to AMFI's daily NAV and compare them with the Nifty on the same dates.",
  },
] as const;

const rise = (d: number) => ({ "--d": d }) as CSSProperties;

export function AuthStage() {
  const reduce = useReducedMotion();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const uid = useId().replace(/:/g, "");
  const stage = useRef<HTMLElement>(null);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const frame = useRef(0);
  const desk = DESKS[index];
  const rotating = !reduce && !paused;

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  // Choosing a desk yourself ends the automatic tour: it should never fight a deliberate click.
  function pick(i: number) {
    setIndex(i);
    setPaused(true);
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    // Arrows move from the focused tab (the ARIA tabs pattern), which is the selected one in normal use.
    const focused = tabs.current.findIndex((el) => el === e.target);
    const from = focused === -1 ? index : focused;
    let next = from;
    if (e.key === "ArrowRight") next = (from + 1) % DESKS.length;
    else if (e.key === "ArrowLeft") next = (from + DESKS.length - 1) % DESKS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = DESKS.length - 1;
    else return;
    e.preventDefault();
    pick(next);
    tabs.current[next]?.focus();
  }

  // A soft grey light that follows the pointer across the stage.
  function onPointerMove(e: PointerEvent<HTMLElement>) {
    const el = stage.current;
    if (reduce || !el) return;
    const r = el.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      el.style.setProperty("--mx", `${x}px`);
      el.style.setProperty("--my", `${y}px`);
    });
  }

  return (
    <aside ref={stage} className="auth-stage" aria-label="What you get with Connect" onPointerMove={onPointerMove}>
      <div className="auth-dots" aria-hidden />
      <div className="auth-spot" aria-hidden />

      <div className="auth-stage-top auth-rise" style={rise(0)}>
        <ConnectLogo size="lg" alt="Connect" />
        <span className="auth-status">
          <i aria-hidden />
          Simulated markets
        </span>
      </div>

      <div className="auth-hero auth-rise" style={rise(1)}>
        <p className="auth-eyebrow">Value · Trade · Track</p>
        <p className="auth-headline">
          <span>Three desks.</span> <span className="auth-hl">One account.</span>
        </p>

        <div className="auth-tabrow">
          <div className="auth-tabs" role="tablist" aria-label="Connect desks" onKeyDown={onKeyDown}>
            {DESKS.map((d, i) => (
              <button
                key={d.id}
                ref={(el) => {
                  tabs.current[i] = el;
                }}
                type="button"
                role="tab"
                id={`${uid}-tab-${d.id}`}
                aria-selected={i === index}
                aria-controls={`${uid}-panel`}
                aria-label={`${d.name} desk (${d.tool})`}
                tabIndex={i === index ? 0 : -1}
                className="auth-tab"
                onClick={() => pick(i)}
              >
                <span className="auth-tab-n">{d.n}</span>
                <span className="auth-tab-name">{d.name}</span>
                <span className="auth-tab-tool">{d.tool}</span>
                {i === index && rotating ? (
                  <span
                    key={`progress-${i}`}
                    className="auth-tab-progress"
                    aria-hidden
                    onAnimationEnd={() => setIndex((cur) => (cur + 1) % DESKS.length)}
                  />
                ) : null}
              </button>
            ))}
          </div>
          {reduce ? null : (
            <button
              type="button"
              className="auth-rotate"
              onClick={() => setPaused((p) => !p)}
              aria-label={paused ? "Resume the automatic desk tour" : "Pause the automatic desk tour"}
              title={paused ? "Resume tour" : "Pause tour"}
            >
              {paused ? <PlayIcon width={16} height={16} /> : <PauseIcon width={16} height={16} />}
            </button>
          )}
        </div>

        <div role="tabpanel" id={`${uid}-panel`} aria-labelledby={`${uid}-tab-${desk.id}`}>
          <p className="auth-lede" key={desk.id}>
            {desk.lede}
          </p>
        </div>
      </div>

      <div className="auth-visual auth-rise" style={rise(2)} role="group" aria-label="Interactive sample preview">
        <div className="auth-visual-bar">
          <span>{desk.title}</span>
          <span className="auth-visual-tag">Illustrative</span>
        </div>
        <div className="auth-visual-body">
          <div className={`auth-panel${desk.id === "value" ? " is-active" : ""}`} data-for="value">
            <ValueVisual />
          </div>
          <div className={`auth-panel${desk.id === "trade" ? " is-active" : ""}`} data-for="trade">
            <TradeVisual active={desk.id === "trade"} reduce={reduce} />
          </div>
          <div className={`auth-panel${desk.id === "track" ? " is-active" : ""}`} data-for="track">
            <TrackVisual />
          </div>
        </div>
      </div>

      <p className="auth-stage-foot auth-rise" style={rise(3)}>
        Not investment advice. Simulated fills. Account data stays private.
      </p>
    </aside>
  );
}
