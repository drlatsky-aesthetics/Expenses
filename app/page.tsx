import Link from "next/link";
import { loadDb, storageMode } from "@/lib/store";
import { Receipt, effectiveFields, needsReview, reportDate } from "@/lib/types";
import { claudeConfigured } from "@/lib/extract";
import { mailConfigured, mailConfig } from "@/lib/mail";
import { expenseReceipts, summarize } from "@/lib/reports";
import { fmtDate, fmtMoney, presetPeriod } from "@/lib/money";
import { PRACTICE_NAME } from "@/lib/brand";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const db = await loadDb();
  const all = Object.values(db.receipts);
  const month = summarize(all, presetPeriod("month"));
  const lastMonth = summarize(all, presetPeriod("last-month"));
  const year = summarize(all, presetPeriod("year"));
  const review = all.filter(needsReview);
  const recent = expenseReceipts(all)
    .sort((a, b) => (reportDate(a) < reportDate(b) ? 1 : -1))
    .slice(0, 8);
  const { user, mailbox } = mailConfig();
  const maxCat = Math.max(1, ...year.byCategory.map((c) => c.total));

  return (
    <div>
      {!mailConfigured() && (
        <div className="notice error">
          <strong>Mailbox not connected.</strong> Set <code>GOOGLE_PASSWORD</code> (Gmail app password for {user}) in the Vercel project so the inbox can be scanned.
        </div>
      )}
      {!claudeConfigured() && (
        <div className="notice warn">
          <strong>AI reading is off.</strong> Add <code>ANTHROPIC_API_KEY</code> to the Vercel project so photographed and PDF receipts can be read and categorized. Until then only text/HTML receipts are parsed, with a basic pattern matcher.
        </div>
      )}
      {db.lastSync?.error && (
        <div className="notice error">
          <strong>Last inbox scan failed</strong> ({fmtDate(db.lastSync.at)}): {db.lastSync.error}
        </div>
      )}

      <div className="grid cols-4">
        <Tile cls="primary" label={month.period.label} value={fmtMoney(month.total)} sub={`${month.count} receipt${month.count === 1 ? "" : "s"}`} />
        <Tile label="Last month" value={fmtMoney(lastMonth.total)} sub={`${lastMonth.count} receipt${lastMonth.count === 1 ? "" : "s"}`} />
        <Tile cls="glacier" label={`${year.period.label} to date`} value={fmtMoney(year.total)} sub={`${fmtMoney(year.tax)} sales tax paid`} />
        <Tile cls={review.length ? "warm" : ""} label="Needs review" value={String(review.length)} sub={review.length ? "Open Receipts → Needs review" : "Everything is reviewed"} href="/receipts" />
      </div>

      <h2 className="section">{year.period.label} by category</h2>
      {year.byCategory.length === 0 ? (
        <p className="muted small">No expenses recorded this year yet.</p>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Category</th>
                <th style={{ width: "40%" }} className="hide-sm"></th>
                <th className="num">Receipts</th>
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {year.byCategory.map((c) => (
                <tr key={c.category}>
                  <td>
                    <Link href={`/reports?preset=year&category=${encodeURIComponent(c.category)}`}>{c.category}</Link>
                  </td>
                  <td className="hide-sm">
                    <div className="bar">
                      <span style={{ width: `${Math.round((c.total / maxCat) * 100)}%` }} />
                    </div>
                  </td>
                  <td className="num">{c.count}</td>
                  <td className="num" style={{ fontWeight: 600 }}>
                    {fmtMoney(c.total)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="section">Recent receipts</h2>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Date</th>
              <th>Vendor</th>
              <th>Category</th>
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {recent.length === 0 ? (
              <tr className="empty">
                <td colSpan={4}>No receipts yet. Use “Scan inbox” or “Add receipt”.</td>
              </tr>
            ) : (
              recent.map((r: Receipt) => {
                const f = effectiveFields(r);
                return (
                  <tr key={r.id}>
                    <td style={{ whiteSpace: "nowrap" }}>{fmtDate(reportDate(r))}</td>
                    <td>
                      <Link href={`/receipts/${r.id}`} style={{ fontWeight: 600, color: "inherit" }}>
                        {f.vendor || "Unknown vendor"}
                      </Link>
                      {f.description && <div className="small muted">{f.description}</div>}
                    </td>
                    <td>
                      <span className="pill">{f.category}</span>
                    </td>
                    <td className="num" style={{ fontWeight: 600 }}>
                      {fmtMoney(f.total, f.currency)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <h2 className="section">System</h2>
      <div className="small muted" style={{ lineHeight: 1.9 }}>
        {PRACTICE_NAME}
        <br />
        Mailbox: {user} · folder {mailbox} · {mailConfigured() ? "connected" : "no password set"}
        <br />
        Last scan: {db.lastSync ? `${fmtDate(db.lastSync.at)} — ${db.lastSync.scanned} scanned, ${db.lastSync.added} added, ${db.lastSync.ignored} skipped${db.lastSync.filed ? `, ${db.lastSync.filed} filed in Gmail` : ""}${db.lastSync.more ? ", more waiting" : ""}` : "never"} · automatic scan daily at 11:00 UTC (Vercel Cron)
        <br />
        After processing, emails are labeled Expenses/Processed or Expenses/Skipped, marked read and archived.
        <br />
        Reading: {claudeConfigured() ? "Claude" : "pattern matcher (no API key)"} · Storage: {storageMode() === "blob" ? "Vercel Blob (expenses-receipts)" : "local .data folder"} · {all.length} records
      </div>
    </div>
  );
}

function Tile({ label, value, sub, cls, href }: { label: string; value: string; sub?: string; cls?: string; href?: string }) {
  const inner = (
    <div className={`tile${cls ? ` ${cls}` : ""}`}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
  return href ? (
    <Link href={href} style={{ color: "inherit" }}>
      {inner}
    </Link>
  ) : (
    inner
  );
}
