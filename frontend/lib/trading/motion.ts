/**
 * One motion scale for the whole paper-trading desk. The same numbers are CSS variables in app/paper.css
 * (--pt-instant … --pt-emphasis), so a component that animates in script and one that animates in CSS agree.
 * Animate transform and opacity; avoid width, height, top and left.
 */
export const motion = {
  instant: 100,
  fast: 160,
  normal: 220,
  slow: 350,
  emphasis: 500,
} as const;

export const easing = {
  out: "cubic-bezier(0.2, 0.8, 0.2, 1)",
  inOut: "cubic-bezier(0.4, 0, 0.2, 1)",
  /** A small overshoot, used once for the success tick. */
  spring: "cubic-bezier(0.34, 1.45, 0.64, 1)",
} as const;

/** Delay between sections on first load, in ms. Kept short so the page never feels held back. */
export const STAGGER_MS = 50;
