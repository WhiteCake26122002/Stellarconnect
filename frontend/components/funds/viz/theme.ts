// One restrained palette for every fund visual: ink first, then three greys, red only for losses.
export const VIZ = {
  teal: "#111111",
  gold: "#8a8a8a",
  blue: "#555555",
  purple: "#bdbdbd",
  red: "#b4233c",
  grey: "#8a8a8a",
  ink: "#111111",
  muted: "#6a6a6a",
  grid: "#ececec",
  soft: "rgba(17,17,17,0.08)",
} as const;

/** Asset classes keep one colour wherever they appear. */
export const CLASS_COLOR: Record<string, string> = {
  Equity: VIZ.teal,
  Hybrid: VIZ.gold,
  Debt: VIZ.blue,
  "Index/ETF": VIZ.purple,
  Other: VIZ.grey,
};
export const classColor = (cls: string) => CLASS_COLOR[cls] ?? VIZ.grey;
