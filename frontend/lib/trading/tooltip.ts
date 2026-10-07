export type TipPlacement = {
  left: number;
  top: number;
  /** Which side of the pointer the tooltip landed on. */
  x: "right" | "left";
  y: "below" | "above";
};

/**
 * Where to put a tooltip of `size` for a pointer at `anchor`, so it is never cut off by the window.
 *
 * It prefers the lower right of the pointer. If there is no room on the right it goes to the left; if there is no room
 * below it goes above. The result is then clamped inside the window with a safety margin, so a pointer at any corner or
 * edge, or a window smaller than the tooltip, still leaves the tooltip as visible as the window allows.
 * All values are in the same coordinate space (viewport pixels).
 */
export function placeTooltip(
  anchor: { x: number; y: number },
  size: { w: number; h: number },
  viewport: { w: number; h: number },
  opts: { gap?: number; margin?: number } = {},
): TipPlacement {
  const gap = opts.gap ?? 14;
  const margin = opts.margin ?? 8;
  const fitsRight = anchor.x + gap + size.w <= viewport.w - margin;
  const fitsLeft = anchor.x - gap - size.w >= margin;
  const fitsBelow = anchor.y + gap + size.h <= viewport.h - margin;
  const fitsAbove = anchor.y - gap - size.h >= margin;
  const x: TipPlacement["x"] = fitsRight || !fitsLeft ? "right" : "left";
  // With room neither above nor below, the side with more space wins and the clamp below finishes the job.
  const y: TipPlacement["y"] = fitsBelow ? "below" : fitsAbove ? "above" : viewport.h - anchor.y >= anchor.y ? "below" : "above";
  const rawLeft = x === "right" ? anchor.x + gap : anchor.x - gap - size.w;
  const rawTop = y === "below" ? anchor.y + gap : anchor.y - gap - size.h;
  const clamp = (v: number, size_: number, max: number) => Math.max(margin, Math.min(v, max - size_ - margin));
  return { left: clamp(rawLeft, size.w, viewport.w), top: clamp(rawTop, size.h, viewport.h), x, y };
}
