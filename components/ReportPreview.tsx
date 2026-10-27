import Link from "next/link";
import { categoryLine, type CategoryLike } from "@/lib/categories";
import { fmtMoney } from "@/lib/money";
import type { Summary } from "@/lib/reports";

/**
 * The report body shared by the Overview preview and the Reports page:
 * tiles, by category, sales tax, by month, by tag, vendors and the receipt
 * detail with explicit "as on receipt / rate / CAD" columns.
 */
export default function ReportPreview({ summary: s, customCategories, qs, full }: { summary: Summary; customCategories: CategoryLike[]; qs: string; full: boolean }) {
  const cur = "CAD";
  const maxMonth = Math.max(1, ...s.byMonth.map((m) => m.total));
  const withCat = (c: string) => {
    const p = new URLSearchParams(qs);
    p.set("category", c);
    return `/reports?${p.toString()}`;
  };
  const withTag = (t: string) => {
    const p = new URLSearchParams(qs);
    p.set("tag", t);
    return `/reports?${p.toString()}`;
  };

  return (
    <>
      <div className="grid cols-4">
        <div className="tile primary">
          <div className="label">Total expenses (CAD)</div>
          <div className="value">{fmtMoney(s.total, cur)}</div>
        </div>
        <div className="tile">
          <div className="label">Before tax</div>
          <div className="value">{fmtMoney(s.subtotal, cur)}</div>
        </div>
        <div className="tile glacier">
          <div className="label">Sales tax paid</div>
          <div className="value">{fmtMoney(s.tax, cur)}</div>
          <div className="sub">GST/HST recoverable as ITCs where eligible</div>
        </div>
        <div className="tile warm">
          <div className="label">Receipts</div>
          <div className="value">{s.count}</div>
          <div className="sub">{s.foreignCount ? `${s.foreignCount} in foreign currency` : "all in CAD"}</div>
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
              <th className="num col-total">Total CAD</th>
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
                    <Link href={withCat(c.category)}>{c.category}</Link>
                  </td>
                  <td className="hide-sm small muted">{categoryLine(c.category, customCategories)}</td>
                  <td className="num">{c.count}</td>
                  <td className="num hide-sm">{fmtMoney(c.subtotal, cur)}</td>
                  <td className="num hide-sm">{fmtMoney(c.tax, cur)}</td>
                  <td className="num col-total" style={{ fontWeight: 600 }}>
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
                <td className="num col-total">{fmtMoney(s.total, cur)}</td>
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
                ["Other / foreign tax", s.taxes.other],
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
          {s.byTag.length > 0 && (
            <>
              <h2 className="section">By tag</h2>
              <table className="data">
                <tbody>
                  {s.byTag.map((t) => (
                    <tr key={t.tag}>
                      <td>
                        <Link href={withTag(t.tag)}>#{t.tag}</Link>
                      </td>
                      <td className="num">{t.count}</td>
                      <td className="num" style={{ width: 110 }}>
                        {fmtMoney(t.total, cur)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>

      {full && (
        <>
          <h2 className="section">Top vendors</h2>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Vendor</th>
                  <th className="num">Receipts</th>
                  <th className="num col-total">Total CAD</th>
                </tr>
              </thead>
              <tbody>
                {s.byVendor.slice(0, 12).map((v) => (
                  <tr key={v.vendor}>
                    <td>{v.vendor}</td>
                    <td className="num">{v.count}</td>
                    <td className="num col-total">{fmtMoney(v.total, cur)}</td>
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
        </>
      )}

      <h2 className="section">Receipt detail</h2>
      <p className="small muted" style={{ margin: "0 0 8px" }}>
        <strong>As on receipt</strong> is the amount in the receipt&apos;s own currency. <strong>Rate</strong> is the Bank of Canada daily rate applied (none for CAD). <strong>Total CAD</strong> is what the report counts.
      </p>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th className="col-date">Date</th>
              <th>Vendor</th>
              <th className="hide-sm">Category</th>
              <th className="num">As on receipt</th>
              <th className="num hide-sm">Rate</th>
              <th className="num hide-sm">Tax CAD</th>
              <th className="num col-total">Total CAD</th>
            </tr>
          </thead>
          <tbody>
            {s.rows.map((r) => (
              <tr key={r.id}>
                <td className="col-date">{r.date}</td>
                <td>
                  <Link href={`/receipts/${r.id}`} style={{ color: "inherit", fontWeight: 600 }}>
                    {r.vendor || "Unknown"}
                  </Link>
                  <div className="show-sm" style={{ marginTop: 4 }}>
                    <span className="pill">{r.category}</span>
                  </div>
                  {r.tags.length > 0 && <div className="small muted">{r.tags.map((t) => `#${t}`).join(" ")}</div>}
                </td>
                <td className="hide-sm">
                  <span className="pill">{r.category}</span>
                </td>
                <td className="num">
                  {r.totalOriginal.toFixed(2)} <span className="small muted">{r.currency}</span>
                  {r.currency !== "CAD" && (
                    <div className="small faint show-sm">× {r.fxRate ? r.fxRate.toFixed(4) : "no rate"}</div>
                  )}
                </td>
                <td className="num hide-sm small muted">{r.currency === "CAD" ? "—" : r.fxRate ? `${r.fxRate.toFixed(4)}${r.fxSource === "manual" ? " manual" : " BoC"}` : "none"}</td>
                <td className="num hide-sm">{fmtMoney(r.tax, cur)}</td>
                <td className="num col-total" style={{ fontWeight: 600 }}>
                  {r.unconverted ? <span className="pill amber">No rate</span> : fmtMoney(r.total, cur)}
                </td>
              </tr>
            ))}
            {s.rows.length === 0 && (
              <tr className="empty">
                <td colSpan={7}>No receipts in this period.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
