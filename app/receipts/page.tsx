import ReceiptsTable, { type ReceiptRowView } from "@/components/ReceiptsTable";
import { CATEGORY_NAMES } from "@/lib/categories";
import { loadDb, saveDb } from "@/lib/store";
import { backfillFx } from "@/lib/fx";
import { effectiveFields, needsReview, reportDate } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ReceiptsPage() {
  const db = await loadDb();
  if ((await backfillFx(db)) > 0) await saveDb(db);
  const rows: ReceiptRowView[] = Object.values(db.receipts)
    .map((r) => {
      const f = effectiveFields(r);
      return {
        id: r.id,
        date: reportDate(r),
        vendor: f.vendor ?? "",
        category: f.category,
        description: f.description ?? "",
        total: f.total,
        totalCad: f.totalCad,
        tax: f.tax,
        currency: f.currency,
        status: r.status,
        needsReview: needsReview(r),
        source: r.source,
        fileKinds: r.files.map((x) => x.kind),
        confidence: r.extraction.confidence,
        subject: r.email?.subject ?? "",
      };
    })
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  return (
    <div>
      <ReceiptsTable rows={rows} categories={CATEGORY_NAMES} />
    </div>
  );
}
