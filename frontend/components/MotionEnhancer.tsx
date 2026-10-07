"use client";

import { useEffect } from "react";

/**
 * Two small behaviours that replace boxes with something that responds to you, without touching any
 * component's markup:
 *
 *  - a sliding indicator for tab strips and segmented choices: the active choice's position and size are
 *    written to CSS variables on the strip, and the stylesheet draws one highlight or underline that glides
 *    between choices instead of each choice sitting in its own bordered box;
 *  - a spotlight on cards and rows: the pointer's position is written to --mx / --my, and the stylesheet
 *    lights the part of the surface under the pointer.
 *
 * Only custom properties and two data attributes are set, so React's own rendering is never fought. Everything
 * is coalesced to one pass per frame and skipped for hidden elements.
 */
const PILL = ".seg, .view-mode, .cx-seg, .cx-pnl-toggle, .cx-tabs, .cx-product > div, .fund-range, .mf-shape";
const LINE = "[role=tablist], .blot-bar";
const ACTIVE = '[aria-pressed="true"], [aria-selected="true"], [aria-checked="true"], [aria-current="page"], button.on, a.on';
const SPOT = ".mf-card, .cx-card, .scenario, .scenario-card, .desk-pick a, .cx-click, .qcat";

function place(strip: HTMLElement, mode: "pill" | "line") {
  const active = strip.querySelector<HTMLElement>(ACTIVE);
  const box = strip.getBoundingClientRect();
  if (!active || box.width === 0) {
    strip.removeAttribute("data-ready");
    return;
  }
  const r = active.getBoundingClientRect();
  const x = r.left - box.left + strip.scrollLeft;
  const set = (name: string, value: string) => {
    if (strip.style.getPropertyValue(name) !== value) strip.style.setProperty(name, value);
  };
  set("--ind-x", `${Math.round(x * 10) / 10}px`);
  set("--ind-w", `${Math.round(r.width * 10) / 10}px`);
  if (mode === "pill") {
    set("--ind-y", `${Math.round((r.top - box.top) * 10) / 10}px`);
    set("--ind-h", `${Math.round(r.height * 10) / 10}px`);
  }
  if (strip.dataset.slider !== mode) strip.dataset.slider = mode;
  // The first placement must not glide in from the corner: show the indicator one frame after it is positioned.
  if (!strip.hasAttribute("data-ready")) requestAnimationFrame(() => strip.setAttribute("data-ready", ""));
}

export function MotionEnhancer() {
  useEffect(() => {
    const strips = new Set<HTMLElement>();
    const ro = new ResizeObserver(() => schedule());
    let frame = 0;

    function scan() {
      frame = 0;
      const found = new Set<HTMLElement>();
      document.querySelectorAll<HTMLElement>(PILL).forEach((el) => {
        found.add(el);
        place(el, "pill");
      });
      document.querySelectorAll<HTMLElement>(LINE).forEach((el) => {
        if (found.has(el)) return;
        found.add(el);
        place(el, "line");
      });
      strips.forEach((el) => {
        if (!found.has(el)) ro.unobserve(el);
      });
      found.forEach((el) => {
        if (!strips.has(el)) ro.observe(el);
      });
      strips.clear();
      found.forEach((el) => strips.add(el));
    }
    function schedule() {
      if (!frame) frame = requestAnimationFrame(scan);
    }

    const mo = new MutationObserver(schedule);
    mo.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["aria-pressed", "aria-selected", "aria-checked", "aria-current", "class"],
    });
    window.addEventListener("resize", schedule);
    document.fonts?.ready.then(schedule).catch(() => {});
    schedule();

    let moveFrame = 0;
    let last: { el: HTMLElement; x: number; y: number } | null = null;
    const onMove = (e: PointerEvent) => {
      const el = (e.target as Element | null)?.closest?.<HTMLElement>(SPOT) ?? null;
      if (!el) return;
      const r = el.getBoundingClientRect();
      last = { el, x: e.clientX - r.left, y: e.clientY - r.top };
      if (moveFrame) return;
      moveFrame = requestAnimationFrame(() => {
        moveFrame = 0;
        if (!last) return;
        last.el.style.setProperty("--mx", `${Math.round(last.x)}px`);
        last.el.style.setProperty("--my", `${Math.round(last.y)}px`);
      });
    };
    document.addEventListener("pointermove", onMove, { passive: true });

    return () => {
      mo.disconnect();
      ro.disconnect();
      window.removeEventListener("resize", schedule);
      document.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(frame);
      cancelAnimationFrame(moveFrame);
    };
  }, []);

  return null;
}
