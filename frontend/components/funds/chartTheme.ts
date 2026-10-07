// Recharts writes colours into SVG attributes, where CSS custom properties are unreliable, so the
// chart palette mirrors the funds.css tokens as literals.
export const INK = "#111111";
export const MUTED = "#6a6a6a";
export const GRID = "#ececec";
export const BULL = "#1a7a45";
export const BEAR = "#b4233c";

export const FUND_PALETTE = ["#111111", "#6b6b6b", "#a0a0a0", "#3a3a3a", "#8a8a8a", "#c4c4c4", "#555555", "#b0b0b0"];

export const SUBJECT_COLOR = "#111111";
export const BENCH_COLORS: Record<string, string> = {
  "NIFTY 50": "#6b6b6b",
  "NIFTY 500": "#a0a0a0",
};
export const benchColor = (label: string, index: number) => BENCH_COLORS[label] ?? FUND_PALETTE[(index + 5) % FUND_PALETTE.length];

export const PREFERRED_BENCH = "NIFTY 500";
