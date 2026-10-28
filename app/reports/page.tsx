import Link from "next/link";
import { Suspense } from "react";
import PeriodPicker from "@/components/PeriodPicker";
import ReportPreview from "@/components/ReportPreview";
import TrendSection from "@/components/TrendSection";
import { computeTrends } from "@/lib/trends";
import { UNCATEGORIZED, categoryNames } from "@/lib/categories";
import { backfillFx } from "@/lib/fx";
import { periodFromQuery } from "@/lib/money";
import { summarize } from "@/lib/reports";
import { loadDb, saveDb } from "@/lib/store";
import { allTags } from "@/lib/types";

export const dynamic = "force-dynamic";

type Query = { preset?: string; from?: string; to?: string; category?: string; tag?: string };

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Query> }) {
  const q = await searchParams;
  const period = periodFromQuery(q);
  const db = await loadDb();
  if ((await backfillFx(db)) > 0) await saveDb(db);
  const names = categoryNames(db.customCategories);
  const category = q.category && names.concat(UNCATEGORIZED).includes(q.category) ? q.category : undefined;
  const tag = q.tag && allTags(db).includes(q.tag) ? q.tag : undefined;
  const all = Object.values(db.receipts);
  const s = summarize(all, period, category, tag);
  const trends = computeTrends(all, period, category, tag);
  const qs = new URLSearchParams();
  if (q.from && q.to) {
    qs.set("from", q.from);
    qs.set("to", q.to);
  } else qs.set("preset", q.preset || "month");
  if (category) qs.set("category", category);
  if (tag) qs.set("tag", tag);

  return (
    <div>
      <Suspense>
        <PeriodPicker categories={names} tags={allTags(db)} />
      </Suspense>

      <div className="row" style={{ justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <h1 className="title">Expense statement — {period.label}</h1>
          <div className="small muted">
            {category ? `${category} · ` : ""}
            {tag ? `#${tag} · ` : ""}
            {s.count} receipt{s.count === 1 ? "" : "s"} · all totals in CAD
            {s.foreignCount > 0 && <> · {s.foreignCount} foreign receipt{s.foreignCount === 1 ? "" : "s"} converted at the Bank of Canada daily rate</>}
            {s.unconvertedCount > 0 && <> · <span style={{ color: "var(--danger)" }}>{s.unconvertedCount} without a rate, excluded</span></>}
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

      <TrendSection summary={s} trends={trends} />

      <ReportPreview summary={s} customCategories={db.customCategories} qs={qs.toString()} full />

      <p className="small faint" style={{ marginTop: 18 }}>
        Need a different cut? <Link href="/categories">Manage categories</Link>, or add tags on individual receipts and filter by them here.
      </p>
    </div>
  );
}
