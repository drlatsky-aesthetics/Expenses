import Link from "next/link";
import { Suspense } from "react";
import PeriodPicker from "@/components/PeriodPicker";
import ReportPreview from "@/components/ReportPreview";
import { PRACTICE_NAME } from "@/lib/brand";
import { claudeConfigured } from "@/lib/extract";
import { backfillFx } from "@/lib/fx";
import { mailConfig, mailConfigured } from "@/lib/mail";
import { fmtDate, fmtMoney, periodFromQuery, presetPeriod } from "@/lib/money";
import { summarize } from "@/lib/reports";
import { loadDb, saveDb, storageMode } from "@/lib/store";
import { needsReview } from "@/lib/types";

export const dynamic = "force-dynamic";

type Query = { preset?: string; from?: string; to?: string };

export default async function OverviewPage({ searchParams }: { searchParams: Promise<Query> }) {
  const q = await searchParams;
  const db = await loadDb();
  if ((await backfillFx(db)) > 0) await saveDb(db);
  const all = Object.values(db.receipts);
  const period = periodFromQuery(q);
  const s = summarize(all, period);
  const year = summarize(all, presetPeriod("year"));
  const review = all.filter(needsReview);
  const { user, mailbox } = mailConfig();
  const qs = new URLSearchParams();
  if (q.from && q.to) {
    qs.set("from", q.from);
    qs.set("to", q.to);
  } else qs.set("preset", q.preset || "month");

  return (
    <div>
      {!mailConfigured() && (
        <div className="notice error">
          <strong>Mailbox not connected.</strong> Set <code>GOOGLE_PASSWORD</code> (Gmail app password for {user}) in the Vercel project so the inbox can be scanned.
        </div>
      )}
      {!claudeConfigured() && (
        <div className="notice warn">
          <strong>AI reading is off.</strong> Add <code>ANTHROPIC_API_KEY</code> to the Vercel project so photographed and PDF receipts can be read and categorized.
        </div>
      )}
      {db.lastSync?.error && (
        <div className="notice error">
          <strong>Last inbox scan failed</strong> ({fmtDate(db.lastSync.at)}): {db.lastSync.error}
        </div>
      )}
      {review.length > 0 && (
        <div className="notice">
          <strong>{review.length} receipt{review.length === 1 ? "" : "s"} to check.</strong> Low-confidence reads, missing totals or uncategorized items.{" "}
          <Link href="/receipts">Open the Receipts list</Link> and choose “Needs review”.
        </div>
      )}

      <Suspense>
        <PeriodPicker />
      </Suspense>

      <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
        <div>
          <h1 className="title">{period.label}</h1>
          <div className="small muted">
            Preview of the expense statement · {year.period.label} to date {fmtMoney(year.total)} across {year.count} receipt{year.count === 1 ? "" : "s"}
          </div>
        </div>
        <div className="actions no-print row stack-sm" style={{ flex: "0 1 auto" }}>
          <Link className="btn ghost" href={`/reports?${qs.toString()}`}>
            Full report
          </Link>
          <a className="btn" href={`/api/export?format=pdf&${qs.toString()}`}>
            Statement PDF
          </a>
        </div>
      </div>

      <ReportPreview summary={s} customCategories={db.customCategories} qs={qs.toString()} full={false} />

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
        Reading: {claudeConfigured() ? "Claude" : "pattern matcher (no API key)"} · Storage: {storageMode() === "blob" ? "Vercel Blob (expenses-receipts)" : "local .data folder"} · {all.length} records · {db.customCategories.length} custom categor{db.customCategories.length === 1 ? "y" : "ies"} (<Link href="/categories">manage</Link>)
      </div>
    </div>
  );
}
