import { Receipt } from "./types";
import { Period, round2 } from "./money";
import { expenseReceipts, toRow, type ReportRow } from "./reports";

export interface MonthPoint {
  month: string; // YYYY-MM
  label: string; // "Oct"
  longLabel: string; // "October 2026"
  total: number;
  count: number;
  topCategory: string | null;
  inPeriod: boolean;
}

export interface YearCompare {
  year: number;
  current: number[]; // 12 entries, Jan..Dec, CAD totals
  previous: number[];
  currentCumulative: number[];
  previousCumulative: number[];
  /** Months of the current year that have passed (1-12), for the cumulative line length. */
  monthsElapsed: number;
}

export interface CategoryTrend {
  category: string;
  total: number;
  points: { month: string; label: string; total: number }[];
}

export interface Comparison {
  label: string; // "Previous period (Sep 2026)"
  total: number;
  count: number;
  /** (now - then) / then, null when there is nothing to compare against. */
  change: number | null;
}

export interface Trends {
  trailing: MonthPoint[];
  yearCompare: YearCompare;
  categories: CategoryTrend[];
  comparisons: {
    previous: Comparison;
    lastYear: Comparison;
  };
  monthsInPeriod: number;
  averagePerMonth: number;
  largestCategory: { category: string; total: number; share: number } | null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function ym(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function addMonths(yyyymm: string, n: number): string {
  const [y, m] = yyyymm.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return ym(d);
}

function monthLabel(yyyymm: string): string {
  const [, m] = yyyymm.split("-").map(Number);
  return MONTHS[m - 1];
}

function longLabel(yyyymm: string): string {
  const [y, m] = yyyymm.split("-").map(Number);
  return `${["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][m - 1]} ${y}`;
}

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function shiftYear(date: string, years: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y + years, m - 1, Math.min(d, 28)));
  // keep end-of-month ends at end of month
  if (d >= 28) {
    const last = new Date(Date.UTC(y + years, m, 0)).getUTCDate();
    dt.setUTCDate(Math.min(d, last));
  }
  return dt.toISOString().slice(0, 10);
}

function sumRows(rows: ReportRow[], from: string, to: string): { total: number; count: number } {
  let total = 0;
  let count = 0;
  for (const r of rows) {
    if (r.date >= from && r.date <= to && !r.unconverted) {
      total += r.total;
      count++;
    }
  }
  return { total: round2(total), count };
}

function periodLabel(from: string, to: string): string {
  const a = new Date(`${from}T12:00:00Z`);
  const b = new Date(`${to}T12:00:00Z`);
  const fmt = (d: Date, withYear: boolean) => d.toLocaleDateString("en-CA", { month: "short", day: "numeric", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC" });
  if (from.slice(0, 7) === to.slice(0, 7) && from.endsWith("-01")) return longLabel(from.slice(0, 7));
  return `${fmt(a, a.getUTCFullYear() !== b.getUTCFullYear())} – ${fmt(b, true)}`;
}

/** Everything the trend charts and comparison chips need, scoped to the chosen period. */
export function computeTrends(all: Receipt[], period: Period, category?: string, tag?: string): Trends {
  const rows = expenseReceipts(all)
    .map(toRow)
    .filter((r) => !category || r.category === category)
    .filter((r) => !tag || r.tags.includes(tag));

  // Clamp "all time" to real data so the trailing window makes sense.
  const dates = rows.map((r) => r.date).sort();
  const to = period.to > "2900-01-01" ? (dates[dates.length - 1] ?? new Date().toISOString().slice(0, 10)) : period.to;
  const from = period.from < "1901-01-01" ? (dates[0] ?? to) : period.from;
  const endMonth = to.slice(0, 7);

  // Trailing 12 months ending with the period's last month.
  const byMonth = new Map<string, { total: number; count: number; cats: Map<string, number> }>();
  for (const r of rows) {
    if (r.unconverted) continue;
    const k = r.date.slice(0, 7);
    const e = byMonth.get(k) ?? { total: 0, count: 0, cats: new Map() };
    e.total += r.total;
    e.count++;
    e.cats.set(r.category, (e.cats.get(r.category) ?? 0) + r.total);
    byMonth.set(k, e);
  }
  const trailing: MonthPoint[] = [];
  for (let i = 11; i >= 0; i--) {
    const k = addMonths(endMonth, -i);
    const e = byMonth.get(k);
    const top = e ? [...e.cats.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null : null;
    trailing.push({
      month: k,
      label: monthLabel(k),
      longLabel: longLabel(k),
      total: round2(e?.total ?? 0),
      count: e?.count ?? 0,
      topCategory: top,
      inPeriod: k >= from.slice(0, 7) && k <= endMonth,
    });
  }

  // Calendar-year comparison for the year the period ends in.
  const year = Number(endMonth.slice(0, 4));
  const current = Array.from({ length: 12 }, (_, i) => round2(byMonth.get(`${year}-${String(i + 1).padStart(2, "0")}`)?.total ?? 0));
  const previous = Array.from({ length: 12 }, (_, i) => round2(byMonth.get(`${year - 1}-${String(i + 1).padStart(2, "0")}`)?.total ?? 0));
  const cum = (a: number[]) => a.reduce<number[]>((acc, v) => [...acc, round2((acc[acc.length - 1] ?? 0) + v)], []);
  const now = new Date();
  const monthsElapsed = now.getUTCFullYear() === year ? now.getUTCMonth() + 1 : now.getUTCFullYear() > year ? 12 : 0;

  // Top categories over the trailing window, as small multiples.
  const catTotals = new Map<string, number>();
  for (const p of trailing) {
    const e = byMonth.get(p.month);
    if (!e) continue;
    for (const [c, v] of e.cats) catTotals.set(c, (catTotals.get(c) ?? 0) + v);
  }
  const topCats = [...catTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  const categories: CategoryTrend[] = topCats.map(([c, total]) => ({
    category: c,
    total: round2(total),
    points: trailing.map((p) => ({ month: p.month, label: p.label, total: round2(byMonth.get(p.month)?.cats.get(c) ?? 0) })),
  }));

  // Comparison chips.
  const inPeriod = sumRows(rows, from, to);
  const lengthDays = Math.round((new Date(`${to}T12:00:00Z`).getTime() - new Date(`${from}T12:00:00Z`).getTime()) / 86400000) + 1;
  const wholeMonths = from.endsWith("-01") && addMonths(to.slice(0, 7), 1) + "-01" > to && to >= `${to.slice(0, 7)}-28`;
  let prevFrom: string;
  let prevTo: string;
  if (wholeMonths) {
    const n = (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + (Number(to.slice(5, 7)) - Number(from.slice(5, 7))) + 1;
    prevFrom = `${addMonths(from.slice(0, 7), -n)}-01`;
    const pTo = addMonths(to.slice(0, 7), -n);
    const [py, pm] = pTo.split("-").map(Number);
    prevTo = `${pTo}-${String(new Date(Date.UTC(py, pm, 0)).getUTCDate()).padStart(2, "0")}`;
  } else {
    prevTo = shiftDate(from, -1);
    prevFrom = shiftDate(prevTo, -(lengthDays - 1));
  }
  const prev = sumRows(rows, prevFrom, prevTo);
  const lyFrom = shiftYear(from, -1);
  const lyTo = shiftYear(to, -1);
  const ly = sumRows(rows, lyFrom, lyTo);
  const change = (nowV: number, thenV: number) => (thenV > 0 ? round2(((nowV - thenV) / thenV) * 100) / 100 : null);

  const monthsInPeriod = Math.max(1, Math.round(lengthDays / 30.4375));
  const catInPeriod = new Map<string, number>();
  for (const r of rows) if (r.date >= from && r.date <= to && !r.unconverted) catInPeriod.set(r.category, (catInPeriod.get(r.category) ?? 0) + r.total);
  const largest = [...catInPeriod.entries()].sort((a, b) => b[1] - a[1])[0];

  return {
    trailing,
    yearCompare: { year, current, previous, currentCumulative: cum(current), previousCumulative: cum(previous), monthsElapsed },
    categories,
    comparisons: {
      previous: { label: `Previous period · ${periodLabel(prevFrom, prevTo)}`, total: prev.total, count: prev.count, change: change(inPeriod.total, prev.total) },
      lastYear: { label: `Same period last year · ${periodLabel(lyFrom, lyTo)}`, total: ly.total, count: ly.count, change: change(inPeriod.total, ly.total) },
    },
    monthsInPeriod,
    averagePerMonth: round2(inPeriod.total / monthsInPeriod),
    largestCategory: largest && inPeriod.total > 0 ? { category: largest[0], total: round2(largest[1]), share: round2(largest[1] / inPeriod.total) } : null,
  };
}
