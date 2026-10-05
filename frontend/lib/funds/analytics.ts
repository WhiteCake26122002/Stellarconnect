/**
 * Pure return/risk arithmetic over level series (portfolio value, NAV, index close). Returns are
 * fractions (0.12 = 12%). Nothing here fetches data or fills gaps with assumed values.
 */
import type { FundAnalysis } from "@/lib/api";

export const DAY = 86_400_000;
export const YEAR = 365.25 * DAY;

/** Fewest usable intervals before volatility, beta or Sharpe are reported. */
const MIN_INTERVALS = 20;
const MIN_CAPTURE_INTERVALS = 4;

export type Point = { t: number; v: number };

export type LevelRow = { t: number; subject: number | null; bench: Record<string, number | null> };

export type Interval = {
  t0: number;
  t1: number;
  years: number;
  subject: number | null;
  bench: Record<string, number | null>;
  /** The level moved because money was added, not because of a return. */
  excluded: boolean;
};

export type SeriesSet = {
  subjectLabel: string;
  /** Chain-linked growth of 100. */
  subject: Point[];
  /** Chain-linked on the same intervals, so index i lines up with subject[i]. */
  benchmarks: { label: string; points: Point[] }[];
  intervals: Interval[];
  excluded: number;
  /** Median spacing between marks, ms. */
  step: number;
};

function median(values: number[]): number {
  if (!values.length) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function simpleReturn(a: number | null, b: number | null): number | null {
  return a != null && b != null && a > 0 && Number.isFinite(b) ? b / a - 1 : null;
}

export function buildSeriesSet(
  rows: LevelRow[],
  subjectLabel: string,
  isCashFlow?: (t0: number, t1: number) => boolean,
): SeriesSet | null {
  const sorted = rows.filter((r) => Number.isFinite(r.t)).sort((a, b) => a.t - b.t);
  if (sorted.length < 2) return null;
  const labels = Array.from(new Set(sorted.flatMap((r) => Object.keys(r.bench))));
  const intervals: Interval[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1];
    const b = sorted[i];
    const excluded = isCashFlow ? isCashFlow(a.t, b.t) : false;
    const bench: Record<string, number | null> = {};
    for (const label of labels) bench[label] = excluded ? null : simpleReturn(a.bench[label] ?? null, b.bench[label] ?? null);
    intervals.push({
      t0: a.t,
      t1: b.t,
      years: (b.t - a.t) / YEAR,
      subject: excluded ? null : simpleReturn(a.subject, b.subject),
      bench,
      excluded,
    });
  }
  if (!intervals.some((iv) => iv.subject != null)) return null;
  const link = (pick: (iv: Interval) => number | null): Point[] => {
    let level = 100;
    const points: Point[] = [{ t: sorted[0].t, v: level }];
    for (const iv of intervals) {
      const r = pick(iv);
      if (r != null) level *= 1 + r;
      points.push({ t: iv.t1, v: level });
    }
    return points;
  };
  return {
    subjectLabel,
    subject: link((iv) => iv.subject),
    benchmarks: labels
      .filter((label) => intervals.some((iv) => iv.bench[label] != null))
      .map((label) => ({ label, points: link((iv) => iv.bench[label]) })),
    intervals,
    excluded: intervals.filter((iv) => iv.excluded).length,
    step: median(intervals.map((iv) => iv.t1 - iv.t0)),
  };
}

export function parseDay(iso: string): number {
  return new Date(`${iso}T00:00:00`).getTime();
}

/**
 * The analysis endpoint's weekly marks, chain-linked into a time-weighted index. A week in which a
 * holding was bought is dropped: its jump is new money, not performance.
 */
export function seriesFromGrowth(growth: FundAnalysis["growth"], purchaseDates: string[]): SeriesSet | null {
  const buys = purchaseDates.map(parseDay).filter(Number.isFinite);
  return buildSeriesSet(
    growth.map((p) => ({ t: parseDay(p.date), subject: p.portfolio, bench: p.benchmarks })),
    "Your portfolio",
    (t0, t1) => buys.some((b) => b > t0 && b <= t1),
  );
}

export type Drawdown = { depth: number; peak: number; trough: number; recovered: number | null };

export function maxDrawdown(points: Point[]): Drawdown | null {
  if (points.length < 2) return null;
  let peak = points[0];
  let worst = { depth: 0, peak: points[0], trough: points[0] };
  for (const p of points) {
    if (p.v > peak.v) peak = p;
    const depth = p.v / peak.v - 1;
    if (depth < worst.depth) worst = { depth, peak, trough: p };
  }
  const after = points.find((p) => p.t > worst.trough.t && p.v >= worst.peak.v);
  return { depth: worst.depth, peak: worst.peak.t, trough: worst.trough.t, recovered: worst.depth < 0 ? (after?.t ?? null) : null };
}

type Pick = (iv: Interval) => number | null;

function compounded(intervals: Interval[], pick: Pick): { gross: number; years: number; n: number } {
  let gross = 1;
  let years = 0;
  let n = 0;
  for (const iv of intervals) {
    const r = pick(iv);
    if (r == null) continue;
    gross *= 1 + r;
    years += iv.years;
    n += 1;
  }
  return { gross, years, n };
}

/** Intervals regular enough to annualize: drops a short stub (e.g. the last mark landing on today). */
function regular(intervals: Interval[]): Interval[] {
  const typical = median(intervals.map((iv) => iv.years));
  return intervals.filter((iv) => iv.years >= typical * 0.5);
}

function stdev(values: number[]): number {
  const m = mean(values);
  return Math.sqrt(values.reduce((a, v) => a + (v - m) ** 2, 0) / (values.length - 1));
}

export type RiskStats = {
  /** Years of return actually measured (dropped cash-flow weeks excluded). */
  years: number;
  cumulative: number;
  annualized: number | null;
  volatility: number | null;
  sharpe: number | null;
  drawdown: Drawdown | null;
  beta: number | null;
  downCapture: number | null;
  upCapture: number | null;
  observations: number;
};

export function riskStats(set: SeriesSet, pick: Pick, points: Point[], riskFree: number | null, benchLabel?: string): RiskStats {
  const { gross, years, n } = compounded(set.intervals, pick);
  const annualized = years >= 1 ? gross ** (1 / years) - 1 : null;
  const usable = regular(set.intervals);
  const rets = usable.map(pick).filter((r): r is number => r != null);
  const perYear = 1 / median(usable.map((iv) => iv.years));
  const volatility = rets.length >= MIN_INTERVALS ? stdev(rets) * Math.sqrt(perYear) : null;
  const sharpe = annualized != null && volatility && riskFree != null ? (annualized - riskFree) / volatility : null;

  let beta: number | null = null;
  let downCapture: number | null = null;
  let upCapture: number | null = null;
  if (benchLabel) {
    const pairs = usable
      .map((iv) => [pick(iv), iv.bench[benchLabel]] as const)
      .filter((p): p is readonly [number, number] => p[0] != null && p[1] != null);
    if (pairs.length >= MIN_INTERVALS) {
      const ms = mean(pairs.map((p) => p[0]));
      const mb = mean(pairs.map((p) => p[1]));
      const cov = pairs.reduce((a, [s, b]) => a + (s - ms) * (b - mb), 0);
      const varB = pairs.reduce((a, [, b]) => a + (b - mb) ** 2, 0);
      beta = varB > 0 ? cov / varB : null;
    }
    const down = pairs.filter((p) => p[1] < 0);
    const up = pairs.filter((p) => p[1] > 0);
    if (down.length >= MIN_CAPTURE_INTERVALS) downCapture = mean(down.map((p) => p[0])) / mean(down.map((p) => p[1]));
    if (up.length >= MIN_CAPTURE_INTERVALS) upCapture = mean(up.map((p) => p[0])) / mean(up.map((p) => p[1]));
  }
  return {
    years,
    cumulative: gross - 1,
    annualized,
    volatility,
    sharpe,
    drawdown: maxDrawdown(points),
    beta,
    downCapture,
    upCapture,
    observations: n,
  };
}

function nearestIndex(points: Point[], t: number): number {
  let lo = 0;
  let hi = points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].t < t) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(points[lo - 1].t - t) <= Math.abs(points[lo].t - t)) return lo - 1;
  return lo;
}

/** Level nearest `t`, or null when the closest mark is further than `tolerance` away. */
export function levelAt(points: Point[], t: number, tolerance: number): { index: number; point: Point } | null {
  if (!points.length) return null;
  const index = nearestIndex(points, t);
  const point = points[index];
  return Math.abs(point.t - t) <= tolerance ? { index, point } : null;
}

export function tolerance(set: SeriesSet): number {
  return Math.max(10 * DAY, set.step * 1.5);
}

export type RollingStats = {
  windowYears: number;
  count: number;
  min: number;
  median: number;
  max: number;
  latest: number;
  positiveShare: number;
  /** Share of windows where the subject beat the benchmark over the same window. */
  beatShare: number | null;
  worstEnd: number;
};

export function rollingReturns(set: SeriesSet, windowYears: number, benchLabel?: string): RollingStats | null {
  const pts = set.subject;
  const bench = set.benchmarks.find((b) => b.label === benchLabel)?.points ?? null;
  const tol = tolerance(set);
  const rows: { end: number; cagr: number; bench: number | null }[] = [];
  for (let i = 0; i < pts.length; i++) {
    const hit = levelAt(pts, pts[i].t - windowYears * YEAR, tol);
    if (!hit || hit.index >= i) continue;
    const years = (pts[i].t - hit.point.t) / YEAR;
    if (years < windowYears * 0.9) continue;
    const cagr = (pts[i].v / hit.point.v) ** (1 / years) - 1;
    const b = bench ? (bench[i].v / bench[hit.index].v) ** (1 / years) - 1 : null;
    rows.push({ end: pts[i].t, cagr, bench: b });
  }
  if (!rows.length) return null;
  const values = rows.map((r) => r.cagr);
  const worst = rows.reduce((a, r) => (r.cagr < a.cagr ? r : a), rows[0]);
  const compared = rows.filter((r) => r.bench != null);
  return {
    windowYears,
    count: rows.length,
    min: Math.min(...values),
    median: median(values),
    max: Math.max(...values),
    latest: rows[rows.length - 1].cagr,
    positiveShare: values.filter((v) => v > 0).length / values.length,
    beatShare: compared.length ? compared.filter((r) => r.cagr > (r.bench as number)).length / compared.length : null,
    worstEnd: worst.end,
  };
}

export type MarketWindow = { id: string; label: string; from: string; to: string };

/** Peak-to-trough windows of broad Indian equity sell-offs, by Nifty 50 closing levels. */
export const MARKET_DRAWDOWNS: MarketWindow[] = [
  { id: "covid-2020", label: "COVID crash", from: "2020-01-14", to: "2020-03-23" },
  { id: "rates-2022", label: "2021–22 rate-hike sell-off", from: "2021-10-18", to: "2022-06-17" },
  { id: "correction-2024", label: "Sep 2024 – Mar 2025 correction", from: "2024-09-26", to: "2025-03-04" },
];

export type WindowResult = { from: number; to: number; subject: number; bench: number | null };

export function windowReturn(set: SeriesSet, from: number, to: number, benchLabel?: string): WindowResult | null {
  const tol = tolerance(set);
  const a = levelAt(set.subject, from, tol);
  const b = levelAt(set.subject, to, tol);
  if (!a || !b || b.index <= a.index) return null;
  const bench = set.benchmarks.find((x) => x.label === benchLabel)?.points;
  return {
    from: a.point.t,
    to: b.point.t,
    subject: b.point.v / a.point.v - 1,
    bench: bench ? bench[b.index].v / bench[a.index].v - 1 : null,
  };
}

export type SipYear = { year: number; invested: number; value: number };

/** Monthly SIP at the start of each month, compounded at a constant annual rate. */
export function sipProjection(monthly: number, annualRate: number, years: number): { invested: number; value: number; path: SipYear[] } {
  const r = (1 + annualRate) ** (1 / 12) - 1;
  const months = Math.round(years * 12);
  let value = 0;
  let invested = 0;
  const path: SipYear[] = [{ year: 0, invested: 0, value: 0 }];
  for (let m = 1; m <= months; m++) {
    value = (value + monthly) * (1 + r);
    invested += monthly;
    if (m % 12 === 0 || m === months) path.push({ year: m / 12, invested, value });
  }
  return { invested, value, path };
}

/** One investment on day one, compounded at a constant annual rate. Marks on the same years as sipProjection. */
export function lumpsumProjection(amount: number, annualRate: number, years: number): { invested: number; value: number; path: SipYear[] } {
  const months = Math.round(years * 12);
  const path: SipYear[] = [{ year: 0, invested: amount, value: amount }];
  for (let m = 12; m <= months; m += 12) path.push({ year: m / 12, invested: amount, value: amount * (1 + annualRate) ** (m / 12) });
  if (months % 12) path.push({ year: months / 12, invested: amount, value: amount * (1 + annualRate) ** (months / 12) });
  return { invested: amount, value: path[path.length - 1].value, path };
}
