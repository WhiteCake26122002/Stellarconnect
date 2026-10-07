export const CASH_COLOR = "#9a9a9a";

const HOLDING_COLORS = ["#111111", "#3a3a3a", "#5c5c5c", "#7a7a7a", "#999999", "#b3b3b3", "#c8c8c8", "#d9d9d9", "#2a2a2a", "#8a8a8a"];

export function holdingColor(symbol: string, taken: string[] = []) {
  let h = 2166136261;
  for (let i = 0; i < symbol.length; i++) {
    h ^= symbol.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const start = (h >>> 0) % HOLDING_COLORS.length;
  for (let i = 0; i < HOLDING_COLORS.length; i++) {
    const color = HOLDING_COLORS[(start + i) % HOLDING_COLORS.length];
    if (!taken.includes(color)) return color;
  }
  return HOLDING_COLORS[start];
}

export function slicePath(cx: number, cy: number, r: number, a0: number, a1: number) {
  const sweep = a1 - a0;
  if (sweep >= Math.PI * 2 - 1e-4) {
    const x0 = cx + r * Math.cos(a0);
    const y0 = cy + r * Math.sin(a0);
    const xm = cx + r * Math.cos(a0 + Math.PI);
    const ym = cy + r * Math.sin(a0 + Math.PI);
    return `M ${cx} ${cy} L ${x0} ${y0} A ${r} ${r} 0 1 1 ${xm} ${ym} A ${r} ${r} 0 1 1 ${x0} ${y0} Z`;
  }
  const x0 = cx + r * Math.cos(a0);
  const y0 = cy + r * Math.sin(a0);
  const x1 = cx + r * Math.cos(a1);
  const y1 = cy + r * Math.sin(a1);
  const large = sweep > Math.PI ? 1 : 0;
  return `M ${cx} ${cy} L ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} Z`;
}
