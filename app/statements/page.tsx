import StatementsView, { type StatementView, type ReceiptOption } from "@/components/StatementsView";
import { backfillFx } from "@/lib/fx";
import { receiptsWithoutCharge } from "@/lib/statements";
import { loadDb, saveDb } from "@/lib/store";
import { effectiveFields, reportDate } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function StatementsPage() {
  const db = await loadDb();
  if ((await backfillFx(db)) > 0) await saveDb(db);
  const statements: StatementView[] = Object.values(db.statements)
    .sort((a, b) => (a.uploadedAt < b.uploadedAt ? 1 : -1))
    .map((s) => ({
      ...s,
      transactions: s.transactions.map((t) => {
        const r = t.matchedReceiptId ? db.receipts[t.matchedReceiptId] : undefined;
        const f = r ? effectiveFields(r) : null;
        return { ...t, receiptVendor: f?.vendor ?? null, receiptTotal: f?.total ?? null, receiptCurrency: f?.currency ?? null };
      }),
    }));
  const unmatchedReceipts: ReceiptOption[] = receiptsWithoutCharge(db).map((r) => {
    const f = effectiveFields(r);
    return { id: r.id, label: `${reportDate(r)} · ${f.vendor ?? "Unknown"} · ${f.total?.toFixed(2)} ${f.currency}`, date: reportDate(r) };
  });
  return <StatementsView statements={statements} unmatchedReceipts={unmatchedReceipts} />;
}
