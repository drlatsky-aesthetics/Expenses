import { Db, Receipt, effectiveFields, reportDate } from "./types";

/**
 * Daily exchange rates from the Bank of Canada Valet API (no key needed). The CRA accepts the
 * Bank of Canada rate for the transaction date (or the annual average). Rates are cached in the
 * ledger so each (currency, date) pair is fetched once.
 */

const SUPPORTED = new Set(["USD", "EUR", "GBP", "AUD", "CHF", "CNY", "HKD", "INR", "JPY", "MXN", "NZD", "SEK", "NOK", "DKK", "SGD", "KRW", "TWD", "BRL", "ZAR", "TRY", "SAR", "IDR", "MYR", "PEN", "RUB", "VND", "THB"]);

function shift(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function fxSupported(currency: string): boolean {
  return currency === "CAD" || SUPPORTED.has(currency.toUpperCase());
}

/**
 * CAD per 1 unit of `currency` on `date` (falls back to the most recent prior business day,
 * up to 10 days back). Returns null when the currency is unsupported or the API is unreachable.
 */
export async function getCadRate(db: Db, currency: string, date: string): Promise<number | null> {
  const cur = currency.toUpperCase();
  if (cur === "CAD") return 1;
  if (!SUPPORTED.has(cur) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const key = `${cur}:${date}`;
  if (db.fxCache[key]) return db.fxCache[key];

  const series = `FX${cur}CAD`;
  const start = shift(date, -10);
  const url = `https://www.bankofcanada.ca/valet/observations/${series}/json?start_date=${start}&end_date=${date}`;
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = (await res.json()) as { observations?: { d: string; [k: string]: { v: string } | string }[] };
    const obs = (data.observations ?? []).filter((o) => o[series]);
    if (obs.length === 0) return null;
    const last = obs[obs.length - 1];
    const rate = Number((last[series] as { v: string }).v);
    if (!Number.isFinite(rate) || rate <= 0) return null;
    db.fxCache[key] = rate;
    return rate;
  } catch (err) {
    console.error("Bank of Canada rate lookup failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Fill in the Bank of Canada rate and CAD total for a foreign-currency receipt that has no
 * statement or manual figure yet. Returns true when the record changed.
 */
export async function ensureFx(db: Db, r: Receipt): Promise<boolean> {
  const f = effectiveFields(r);
  if (f.currency === "CAD" || f.total === null) return false;
  if (f.fxSource === "manual") return false;
  if (f.fxRate !== null && f.fxSource === "boc") return false;
  const rate = await getCadRate(db, f.currency, reportDate(r));
  if (rate === null) return false;
  r.extracted = { ...r.extracted, fxRate: rate, fxSource: "boc", totalCad: Math.round(f.total * rate * 100) / 100 };
  // Any stale override of these three fields would mask the fresh rate.
  const { fxRate: _a, fxSource: _b, totalCad: _c, ...rest } = r.overrides;
  r.overrides = rest;
  r.updatedAt = new Date().toISOString();
  return true;
}

/** Backfill rates for every receipt that still needs one. Returns the number updated. */
export async function backfillFx(db: Db): Promise<number> {
  let n = 0;
  for (const r of Object.values(db.receipts)) {
    if (r.status === "ignored") continue;
    if (await ensureFx(db, r)) n++;
  }
  return n;
}
