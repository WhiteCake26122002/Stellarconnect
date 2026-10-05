// Recharts writes colours into SVG attributes, where CSS custom properties are unreliable, so the
// chart palette mirrors the funds.css tokens as literals.
export const INK = "#111111";
export const MUTED = "#6a6a6a";
export const GRID = "#ececec";
export const BULL = "#1a7a45";
export const BEAR = "#b4233c";

export const FUND_PALETTE = ["#0b9e96", "#6d5ef5", "#c4476a", "#2f8f5b", "#b8860b", "#3b6fbf", "#c45b3a", "#1f8a78"];

export const SUBJECT_COLOR = "#0b9e96";
export const BENCH_COLORS: Record<string, string> = {
  "NIFTY 50": "#3b6fbf",
  "NIFTY 500": "#b8860b",
};
export const benchColor = (label: string, index: number) => BENCH_COLORS[label] ?? FUND_PALETTE[(index + 5) % FUND_PALETTE.length];

export const PREFERRED_BENCH = "NIFTY 500";
