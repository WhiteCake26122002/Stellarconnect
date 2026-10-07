/**
 * Numbers behind the portfolio visuals. Pure functions over the holdings and series the API already
 * returns; nothing here fetches data or fills a gap with an assumed value. Where an input is missing
 * the result says so (null, with a reason) so the page can print "Unavailable" instead of a number.
 */
import type { FundHistory, FundHolding } from "@/lib/api";
import { buildSeriesSet, DAY, levelAt, parseDay, YEAR, type Point, type SeriesSet, tolerance } from "./analytics";
import { assetClass, categoryShort } from "./category";

// ---------------------------------------------------------------------------------------------
// Allocation: asset class, then the AMFI category, then the funds

export type AllocNode = {
  id: string;
  label: string;
  value: number;
  /** Share of the whole portfolio, in percent. */
  pct: number;
  children: AllocNode[];
  /** Set on fund leaves. */
  code?: number;
};

const byValueDesc = (a: AllocNode, b: AllocNode) => b.value - a.value;

/** Asset class → category → fund, over holdings that have a live NAV. Weights are of total value. */
export function allocationTree(holdings: FundHolding[]): AllocNode[] {
  const live = holdings.filter((h) => h.data_available && h.value > 0);
  const total = live.reduce((a, h) => a + h.value, 0);
  if (total <= 0) return [];
  const classes = new Map<string, Map<string, FundHolding[]>>();
  for (const h of live) {
    const cls = assetClass(h.scheme_category);
    const cat = categoryShort(h.scheme_category);
    const byCat = classes.get(cls) ?? new Map<string, FundHolding[]>();
    byCat.set(cat, [...(byCat.get(cat) ?? []), h]);
    classes.set(cls, byCat);
  }
  const node = (id: string, label: string, value: number, children: AllocNode[], code?: number): AllocNode => ({ id, label, value, pct: (value / total) * 100, children, code });
  return [...classes.entries()]
    .map(([cls, cats]) => {
      const catNodes = [...cats.entries()]
        .map(([cat, hs]) => {
          const funds = hs.map((h) => node(`f${h.scheme_code}`, h.scheme_name, h.value, [], h.scheme_code)).sort(byValueDesc);
          return node(`${cls}/${cat}`, cat, funds.reduce((a, f) => a + f.value, 0), funds);
        })
        .sort(byValueDesc);
      return node(cls, cls, catNodes.reduce((a, c) => a + c.value, 0), catNodes);
    })
    .sort(byValueDesc);
}

// ---------------------------------------------------------------------------------------------
// Concentration

export type Concentration = {
  n: number;
  /** Cumulative share of the largest 1, 3 and 5 funds, in percent. */
  top1: number;
  top3: number;
  top5: number;
  /** Herfindahl index on weights as fractions (1 = everything in one fund). */
  hhi: number;
  /** 1 / HHI: how many equally sized funds would be as concentrated. */
  effective: number;
  largest: { code: number; name: string; pct: number } | null;
};

export function concentration(holdings: FundHolding[]): Concentration | null {
  const live = holdings.filter((h) => h.data_available && h.value > 0);
  const total = live.reduce((a, h) => a + h.value, 0);
  if (!live.length || total <= 0) return null;
  const sorted = [...live].sort((a, b) => b.value - a.value);
  const w = sorted.map((h) => h.value / total);
  const cum = (k: number) => w.slice(0, k).reduce((a, b) => a + b, 0) * 100;
  const hhi = w.reduce((a, x) => a + x * x, 0);
  return {
    n: live.length,
    top1: cum(1),
    top3: cum(3),
    top5: cum(5),
    hhi,
    effective: 1 / hhi,
    largest: { code: sorted[0].scheme_code, name: sorted[0].scheme_name, pct: w[0] * 100 },
  };
}

// ---------------------------------------------------------------------------------------------
// Plan mix: how much of the money sits in Direct and Regular plans

export function directShare(holdings: FundHolding[]): { direct: number; regular: number; unknown: number } | null {
  const live = holdings.filter((h) => h.data_available && h.value > 0);
  const total = live.reduce((a, h) => a + h.value, 0);
  if (total <= 0) return null;
  const sum = (plan: FundHolding["plan"]) => (live.filter((h) => h.plan === plan).reduce((a, h) => a + h.value, 0) / total) * 100;
  return { direct: sum("Direct"), regular: sum("Regular"), unknown: sum("Unknown") };
}

// ---------------------------------------------------------------------------------------------
// Portfolio health: five parts, each a stated formula, averaged over the parts that have data

export type HealthPart = {
  id: "diversification" | "concentration" | "risk" | "cost" | "performance";
  label: string;
  /** 0 to 100, or null when this part cannot be measured from the data on hand. */
  score: number | null;
  /** What was measured, with the numbers. */
  detail: string;
  /** The rule that turns the measurement into a score. */
  how: string;
  /** Why the part is missing, when it is. */
  missing?: string;
};

export type Health = {
  score: number | null;
  band: "Strong" | "Good" | "Fair" | "Needs attention" | null;
  parts: HealthPart[];
  /** Parts that contributed to the average. */
  used: number;
};

const clamp = (v: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, v));
const round = (v: number) => Math.round(v);

export function healthBand(score: number): NonNullable<Health["band"]> {
  return score >= 80 ? "Strong" : score >= 65 ? "Good" : score >= 50 ? "Fair" : "Needs attention";
}

export type HealthInput = {
  holdings: FundHolding[];
  /** Portfolio return minus the broad benchmark over the same dates, in percentage points; only once a year of history exists. */
  relativePp: number | null;
  benchmarkLabel?: string | null;
  /** Equity share against the reference band for the investor's stated profile; null without a profile. */
  suitability: { equityPct: number; low: number; high: number } | null;
};

export function healthScore(input: HealthInput): Health {
  const { holdings } = input;
  const conc = concentration(holdings);
  const live = holdings.filter((h) => h.data_available && h.value > 0);
  const parts: HealthPart[] = [];

  // Diversification: effective number of funds, categories and fund houses.
  if (conc) {
    const cats = new Set(live.map((h) => categoryShort(h.scheme_category))).size;
    const amcs = new Set(live.map((h) => h.fund_house).filter((x) => x && x !== "Unknown")).size;
    const raw = 0.5 * Math.min(1, conc.effective / 5) + 0.3 * Math.min(1, cats / 4) + 0.2 * Math.min(1, amcs / 3);
    parts.push({
      id: "diversification",
      label: "Diversification",
      score: round(raw * 100),
      detail: `${conc.effective.toFixed(1)} effective funds, ${cats} ${cats === 1 ? "category" : "categories"}, ${amcs} fund ${amcs === 1 ? "house" : "houses"}`,
      how: "50% effective number of funds (full marks at 5), 30% categories (full at 4), 20% fund houses (full at 3).",
    });
    // Concentration: the largest fund and the largest three.
    const one = clamp(100 - ((conc.top1 - 20) / 40) * 100);
    const three = clamp(100 - ((conc.top3 - 50) / 40) * 100);
    parts.push({
      id: "concentration",
      label: "Concentration",
      score: round(0.6 * one + 0.4 * three),
      detail: `Largest fund ${conc.top1.toFixed(1)}%, largest three ${conc.top3.toFixed(1)}%`,
      how: "60% on the largest fund (full marks at 20% or less, zero at 60%), 40% on the largest three (full at 50%, zero at 90%).",
    });
  } else {
    for (const [id, label] of [["diversification", "Diversification"], ["concentration", "Concentration"]] as const) {
      parts.push({ id, label, score: null, detail: "Unavailable", how: "", missing: "No fund with a live NAV." });
    }
  }

  // Risk alignment: only against a profile the investor has stated.
  if (input.suitability) {
    const { equityPct, low, high } = input.suitability;
    const outside = equityPct < low ? low - equityPct : equityPct > high ? equityPct - high : 0;
    parts.push({
      id: "risk",
      label: "Risk alignment",
      score: round(clamp(100 - outside * 2.5)),
      detail: `${equityPct.toFixed(0)}% equity against a reference band of ${low.toFixed(0)}–${high.toFixed(0)}%`,
      how: "Full marks inside the reference band for your stated profile, minus 2.5 points for each percentage point outside it.",
    });
  } else {
    parts.push({ id: "risk", label: "Risk alignment", score: null, detail: "Unavailable", how: "", missing: "Set your age, horizon and risk comfort on the Insights tab to measure this." });
  }

  // Cost: the share of money in Direct plans, the one cost fact every holding has.
  const plans = directShare(holdings);
  if (plans && plans.direct + plans.regular > 0) {
    const known = plans.direct + plans.regular;
    parts.push({
      id: "cost",
      label: "Plan cost",
      score: round((plans.direct / known) * 100),
      detail: `${plans.direct.toFixed(0)}% of value in Direct plans, ${plans.regular.toFixed(0)}% in Regular`,
      how: "The share of value in Direct plans, which carry no distributor commission. Expense ratios are not published here, so they are not used.",
    });
  } else {
    parts.push({ id: "cost", label: "Plan cost", score: null, detail: "Unavailable", how: "", missing: "The plan type could not be read from the scheme names." });
  }

  // Performance: against the broad benchmark, once there is a year of history.
  if (input.relativePp != null) {
    parts.push({
      id: "performance",
      label: "Performance",
      score: round(clamp(50 + input.relativePp * 5)),
      detail: `${input.relativePp >= 0 ? "+" : "−"}${Math.abs(input.relativePp).toFixed(1)} points against ${input.benchmarkLabel ?? "the benchmark"}`,
      how: "50 means level with the benchmark; each percentage point ahead adds 5, each point behind takes 5 off.",
    });
  } else {
    parts.push({ id: "performance", label: "Performance", score: null, detail: "Insufficient history", how: "", missing: "A fair comparison with the benchmark needs at least a year of holding." });
  }

  const scored = parts.filter((p): p is HealthPart & { score: number } => p.score != null);
  if (!scored.length) return { score: null, band: null, parts, used: 0 };
  const score = round(scored.reduce((a, p) => a + p.score, 0) / scored.length);
  return { score, band: healthBand(score), parts, used: scored.length };
}

// ---------------------------------------------------------------------------------------------
// Series helpers

/** Points from `from` onward, rebased so the first one reads `base`. */
export function rebase(points: Point[], from: number, base = 100): Point[] {
  const slice = points.filter((p) => p.t >= from);
  if (slice.length < 2 || !(slice[0].v > 0)) return [];
  const k = base / slice[0].v;
  return slice.map((p) => ({ t: p.t, v: p.v * k }));
}

/** Return over the last `years`, as a fraction (cumulative for one year, annualized beyond), or null without that much history. */
export function trailing(points: Point[], years: number, set: SeriesSet): { value: number; annualized: boolean } | null {
  if (points.length < 2) return null;
  const end = points[points.length - 1];
  const start = levelAt(points, end.t - years * YEAR, tolerance(set));
  if (!start || start.point.t >= end.t) return null;
  const span = (end.t - start.point.t) / YEAR;
  if (span < years * 0.9 || !(start.point.v > 0)) return null;
  const total = end.v / start.point.v - 1;
  return years > 1 ? { value: (1 + total) ** (1 / span) - 1, annualized: true } : { value: total, annualized: false };
}

export type DrawdownPoint = { t: number; dd: number };

/** Percentage below the running peak at every mark (0 at a new high, negative otherwise). */
export function drawdownSeries(points: Point[]): DrawdownPoint[] {
  let peak = -Infinity;
  return points.map((p) => {
    peak = Math.max(peak, p.v);
    return { t: p.t, dd: peak > 0 ? p.v / peak - 1 : 0 };
  });
}

/** The range ids offered above a chart, with the days each covers. */
export const RANGES = [
  { id: "1M", days: 30 },
  { id: "6M", days: 182 },
  { id: "1Y", days: 365 },
  { id: "3Y", days: 1095 },
  { id: "5Y", days: 1826 },
  { id: "MAX", days: null },
] as const;
export type RangeId = (typeof RANGES)[number]["id"];

/** A range is offered only when the history actually reaches back that far. */
export function rangeUsable(first: number, last: number, days: number | null, count: number): boolean {
  if (days == null) return count >= 2;
  return first <= last - days * DAY && count >= 2;
}

// ---------------------------------------------------------------------------------------------
// A single fund's own series, from its published NAV history

/** ISO week key, so Monday-to-Sunday marks collapse to their last mark. */
function weekKey(t: number): string {
  // parseDay builds local midnights, so the week is read in local time too.
  const d = new Date(t);
  const day = (d.getDay() + 6) % 7; // Monday = 0
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - day);
  return `${monday.getFullYear()}-${monday.getMonth()}-${monday.getDate()}`;
}

/**
 * The fund's NAV (and its benchmark's close, when it has one) sampled once a week: the last published mark
 * in each week. Mixing daily and weekly spacing would distort volatility and rolling returns, so every
 * mark is weekly. No value is filled in: a week with no benchmark close simply has none.
 */
export function weeklySet(history: FundHistory | null, label = "This fund"): SeriesSet | null {
  if (!history || history.points.length < 3) return null;
  const weeks = new Map<string, { t: number; nav: number; bench: number | null }>();
  for (const p of history.points) {
    const t = parseDay(p.date);
    if (!Number.isFinite(t) || !(p.nav > 0)) continue;
    weeks.set(weekKey(t), { t, nav: p.nav, bench: p.bench != null && p.bench > 0 ? p.bench : null });
  }
  const bench = history.benchmark?.label;
  const rows = [...weeks.values()]
    .sort((a, b) => a.t - b.t)
    .map((w) => ({ t: w.t, subject: w.nav as number | null, bench: bench ? { [bench]: w.bench } : {} }));
  return buildSeriesSet(rows, label);
}
