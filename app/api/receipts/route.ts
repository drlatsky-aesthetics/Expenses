import { NextResponse } from "next/server";
import { loadDb } from "@/lib/store";
import { effectiveFields, needsReview, reportDate } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const db = await loadDb();
  const receipts = Object.values(db.receipts)
    .map((r) => ({ ...r, fields: effectiveFields(r), reportDate: reportDate(r), needsReview: needsReview(r) }))
    .sort((a, b) => (a.reportDate < b.reportDate ? 1 : -1));
  return NextResponse.json({ receipts, lastSync: db.lastSync });
}
