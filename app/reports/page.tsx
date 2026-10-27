import Link from "next/link";
import { Suspense } from "react";
import PeriodPicker from "@/components/PeriodPicker";
import { CATEGORIES, CATEGORY_NAMES } from "@/lib/categories";
import { fmtMoney, periodFromQuery } from "@/lib/money";
import { summarize } from "@/lib/reports";
import { loadDb } from "@/lib/store";

export const dynamic = "force-dynamic";

type Query = { preset?: string; from?: string; to?: string; category?: string };

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Query> }) {
  const q = await searchParams;
  const period = periodFromQuery(q);
  const category = q.category && CATEGORY_NAMES.concat("Uncategorized").includes(q.category) ? q.category : undefined;
  const db = await loadDb();
  const s = summarize(Object.values(db.receipts), period, category);
  const qs = new URLSearchParams();
  if (q.from && q.to) {
    qs.set("from", q.from);
    qs.set("to", q.to);
  } else qs.set("preset", q.preset || "month");
  if (category) qs.set("category", category);
  const cur = s.currencies.length === 1 ? s.currencies[0] : "CAD";
  const maxMonth = Math.max(1, ...s.byMonth.map((m) => m.total));
  const lineFor = (name: string) => CATEGORIES.find((c) => c.name === name)?.line ?? "";

  return (
    <div>
      <Suspense>
        <PeriodPicker categories={CATEGORY_NAMES} />
      </Suspense>

      <div className="row" style={{ justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <h1 className="title">Expense statement — {period.label}</h1>
          <div className="small muted">
            {category ? `${category} only · ` : ""}
            {s.count} receipt{s.count === 1 ? "" : "s"}
            {s.currencies.length > 1 && <> · mixed currencies ({s.currencies.join(", ")}) summed at face value</>}
          </div>
        </div>
        <div className="actions no-print row stack-sm" style={{ flex: "0 1 auto" }}>
          <a className="btn" href={`/api/export?format=pdf&${qs.toString()}`}>
            Statement PDF
          </a>
          <a className="btn ghost" href={`/api/export?format=pdf&detail=0&${qs.toString()}`}>
            Summary PDF
          </a>
          <a className="btn ghost" href={`/api/export?format=csv&${qs.toString()}`}>
            CSV
          </a>
        </div>
      </div>

      <div className="grid cols-4">
        <div className="tile primary">
          <div className="label">Total expenses</div>
          <div className="value">{fmtMoney(s.total, cur)}</div>
        </div>
        <div className="tile">
          <div className="label">Before tax</div>
          <div className="value">{fmtMoney(s.subtotal, cur)}</div>
        </div>
        <div className="tile glacier">
          <div className="label">Sales tax paid</div>
          <div className="value">{fmtMoney(s.tax, cur)}</div>
          <div className="sub">recoverable as ITCs where eligible</div>
        </div>
        <div className="tile warm">
          <div className="label">Average receipt</div>
          <div className="value">{fmtMoney(s.count ? s.total / s.count : 0, cur)}</div>
        </div>
      </div>

      <h2 className="section">By category</h2>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Category</th>
              <th className="hide-sm">T2125 line</th>
              <th className="num">Receipts</th>
              <th className="num hide-sm">Before tax</th>
              <th className="num hide-sm">Tax</th>
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {s.byCategory.length === 0 ? (
              <tr className="empty">
                <td colSpan={6}>No expenses in this period.</td>
              </tr>
            ) : (
              s.byCategory.map((c) => (
                <tr key={c.category}>
                  <td>
                    <Link href={`/reports?${new URLSearchParams({ ...Object.fromEntries(qs), category: c.category }).toString()}`}>{c.category}</Link>
                  </td>
                  <td className="hide-sm small muted">{lineFor(c.category)}</td>
                  <td className="num">{c.count}</td>
                  <td className="num hide-sm">{fmtMoney(c.subtotal, cur)}</td>
                  <td className="num hide-sm">{fmtMoney(c.tax, cur)}</td>
                  <td className="num" style={{ fontWeight: 600 }}>
                    {fmtMoney(c.total, cur)}
                  </td>
                </tr>
              ))
            )}
            {s.byCategory.length > 0 && (
              <tr className="total">
                <td>Total</td>
                <td className="hide-sm"></td>
                <td className="num">{s.count}</td>
                <td className="num hide-sm">{fmtMoney(s.subtotal, cur)}</td>
                <td className="num hide-sm">{fmtMoney(s.tax, cur)}</td>
                <td className="num">{fmtMoney(s.total, cur)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="grid cols-2 stack-sm" style={{ alignItems: "start" }}>
        <div>
          <h2 className="section">Sales tax</h2>
          <div className="summary" style={{ marginLeft: 0 }}>
            {(
              [
                ["GST", s.taxes.gst],
                ["HST", s.taxes.hst],
                ["PST / RST", s.taxes.pst],
                ["QST", s.taxes.qst],
                ["Other", s.taxes.other],
              ] as [string, number][]
            )
              .filter(([, v]) => v !== 0)
              .map(([k, v]) => (
                <div className="srow" key={k}>
                  <span>{k}</span>
                  <span>{fmtMoney(v, cur)}</span>
                </div>
              ))}
            <div className="srow head">
              <span>Total sales tax</span>
              <span>{fmtMoney(s.taxes.total, cur)}</span>
            </div>
          </div>
          {s.taxes.untaxedCount > 0 && (
            <p className="small muted" style={{ marginTop: 8 }}>
              {s.taxes.untaxedCount} receipt{s.taxes.untaxedCount === 1 ? " has" : "s have"} no tax detail.
            </p>
          )}
        </div>
        <div>
          <h2 className="section">By month</h2>
          <table className="data">
            <tbody>
              {s.byMonth.length === 0 ? (
                <tr className="empty">
                  <td>—</td>
                </tr>
              ) : (
                s.byMonth.map((m) => (
                  <tr key={m.month}>
                    <td style={{ width: 90, whiteSpace: "nowrap" }}>{m.label}</td>
                    <td>
                      <div className="bar">
                        <span style={{ width: `${Math.round((m.total / maxMonth) * 100)}%` }} />
                      </div>
                    </td>
                    <td className="num" style={{ width: 110 }}>
                      {fmtMoney(m.total, cur)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <h2 className="section">Top vendors</h2>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Vendor</th>
              <th className="num">Receipts</th>
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {s.byVendor.slice(0, 12).map((v) => (
              <tr key={v.vendor}>
                <td>{v.vendor}</td>
                <td className="num">{v.count}</td>
                <td className="num">{fmtMoney(v.total, cur)}</td>
              </tr>
            ))}
            {s.byVendor.length === 0 && (
              <tr className="empty">
                <td colSpan={3}>—</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <h2 className="section">Receipt detail</h2>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Date</th>
              <th>Vendor</th>
              <th className="hide-sm">Description</th>
              <th className="hide-sm">Category</th>
              <th className="num hide-sm">Tax</th>
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {s.rows.map((r) => (
              <tr key={r.id}>
                <td style={{ whiteSpace: "nowrap" }}>{r.date}</td>
                <td>
                  <Link href={`/receipts/${r.id}`} style={{ color: "inherit", fontWeight: 600 }}>
                    {r.vendor || "Unknown"}
                  </Link>
                  <div className="show-sm" style={{ marginTop: 4 }}>
                    <span className="pill">{r.category}</span>
                  </div>
                </td>
                <td className="hide-sm muted">{r.description || r.purpose}</td>
                <td className="hide-sm">
                  <span className="pill">{r.category}</span>
                </td>
                <td className="num hide-sm">{fmtMoney(r.tax, r.currency)}</td>
                <td className="num">{fmtMoney(r.total, r.currency)}</td>
              </tr>
            ))}
            {s.rows.length === 0 && (
              <tr className="empty">
                <td colSpan={6}>No receipts in this period.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
