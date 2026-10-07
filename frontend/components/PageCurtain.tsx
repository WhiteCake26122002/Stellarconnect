"use client";

import { CSSProperties, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import type { CurtainDetail } from "@/lib/curtain";
import "../app/curtain.css";

const COVER_MS = 700;
const HOLD_MS = 280;
const LIFT_MS = 760;
const NEVER_TRAP_MS = 9000;

type Phase = "covering" | "covered" | "lifting";
type State = CurtainDetail & { phase: Phase; radius: number };

/** Waits until the page underneath has stopped showing its own loading state. */
function whenSettled(done: () => void) {
  const started = performance.now();
  const id = window.setInterval(() => {
    const busy = document.querySelector('main[aria-busy="true"], [data-page-busy="true"]');
    if (!busy || performance.now() - started > 3000) {
      window.clearInterval(id);
      done();
    }
  }, 60);
  return () => window.clearInterval(id);
}

export function PageCurtain() {
  const pathname = usePathname();
  const [state, setState] = useState<State | null>(null);
  const origin = useRef("");
  const openedAt = useRef(0);

  useEffect(() => {
    const onPlay = (e: Event) => {
      const d = (e as CustomEvent<CurtainDetail>).detail;
      origin.current = window.location.pathname;
      openedAt.current = performance.now();
      const radius = Math.hypot(Math.max(d.x, window.innerWidth - d.x), Math.max(d.y, window.innerHeight - d.y)) + 24;
      setState({ ...d, radius, phase: "covering" });
      window.setTimeout(() => {
        setState((s) => (s ? { ...s, phase: "covered" } : s));
        window.dispatchEvent(new Event("connect:curtain-covered"));
      }, COVER_MS);
      window.setTimeout(() => setState(null), NEVER_TRAP_MS); // never leave anyone stuck behind it
    };
    window.addEventListener("connect:curtain", onPlay);
    return () => window.removeEventListener("connect:curtain", onPlay);
  }, []);

  // Lift once we have actually arrived somewhere new and that page is done loading.
  useEffect(() => {
    if (!state || state.phase !== "covered" || pathname === origin.current) return;
    let hold = 0;
    const stop = whenSettled(() => {
      // A greeting stays up long enough to read, however fast the next page was.
      const readFor = (state.minShowMs ?? 0) - (performance.now() - openedAt.current);
      hold = window.setTimeout(() => setState((s) => (s ? { ...s, phase: "lifting" } : s)), Math.max(HOLD_MS, readFor));
    });
    return () => {
      stop();
      window.clearTimeout(hold);
    };
  }, [state, pathname]);

  useEffect(() => {
    if (state?.phase !== "lifting") return;
    const t = window.setTimeout(() => setState(null), LIFT_MS);
    return () => window.clearTimeout(t);
  }, [state?.phase]);

  if (!state) return null;
  const style = { "--cx": `${state.x}px`, "--cy": `${state.y}px`, "--r": `${state.radius}px` } as CSSProperties;

  return (
    <div className="curtain" data-phase={state.phase} style={style} role="status" aria-live="polite">
      <div className="curtain-core">
        <span className="curtain-ring" aria-hidden />
        <img className="curtain-mark" src="/connect-mark.png" alt="" width={142} height={142} />
        {state.greeting ? (
          <div className="curtain-greeting">
            <p className="curtain-kicker">{state.greeting.kicker}</p>
            <p className="curtain-name" aria-label={state.greeting.name}>
              {Array.from(state.greeting.name).map((ch, i) => (
                <span key={i} aria-hidden style={{ animationDelay: `${520 + i * 38}ms` }}>
                  {ch === " " ? " " : ch}
                </span>
              ))}
            </p>
          </div>
        ) : null}
        <p className="curtain-label">{state.label}</p>
      </div>
    </div>
  );
}
