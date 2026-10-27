export function fmtMoney(n: number | null | undefined, currency = "CAD"): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  try {
    return new Intl.NumberFormat("en-CA", { style: "currency", currency, currencyDisplay: "narrowSymbol" }).format(n);
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" });
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export interface Period {
  from: string; // YYYY-MM-DD inclusive
  to: string; // YYYY-MM-DD inclusive
  label: string;
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function monthPeriod(year: number, month0: number): Period {
  const from = new Date(year, month0, 1);
  const to = new Date(year, month0 + 1, 0);
  return { from: ymd(from), to: ymd(to), label: from.toLocaleDateString("en-CA", { month: "long", year: "numeric" }) };
}

export function presetPeriod(preset: string, now = new Date()): Period {
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (preset) {
    case "last-month":
      return monthPeriod(y, m - 1);
    case "quarter": {
      const q = Math.floor(m / 3);
      const from = new Date(y, q * 3, 1);
      const to = new Date(y, q * 3 + 3, 0);
      return { from: ymd(from), to: ymd(to), label: `Q${q + 1} ${y}` };
    }
    case "last-quarter": {
      const q = Math.floor(m / 3) - 1;
      const yy = q < 0 ? y - 1 : y;
      const qq = (q + 4) % 4;
      const from = new Date(yy, qq * 3, 1);
      const to = new Date(yy, qq * 3 + 3, 0);
      return { from: ymd(from), to: ymd(to), label: `Q${qq + 1} ${yy}` };
    }
    case "year":
      return { from: `${y}-01-01`, to: `${y}-12-31`, label: `${y}` };
    case "last-year":
      return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31`, label: `${y - 1}` };
    case "all":
      return { from: "1900-01-01", to: "2999-12-31", label: "All time" };
    case "month":
    default:
      return monthPeriod(y, m);
  }
}

export function periodFromQuery(q: { preset?: string; from?: string; to?: string }): Period {
  const valid = (s?: string) => Boolean(s && /^\d{4}-\d{2}-\d{2}$/.test(s));
  if (valid(q.from) && valid(q.to)) {
    return { from: q.from!, to: q.to!, label: `${fmtDate(q.from)} – ${fmtDate(q.to)}` };
  }
  return presetPeriod(q.preset || "month");
}

export function inPeriod(date: string, p: Period): boolean {
  return date >= p.from && date <= p.to;
}
