import { NextRequest, NextResponse } from "next/server";
import { UNCATEGORIZED, categoryNames } from "@/lib/categories";
import { periodFromQuery } from "@/lib/money";
import { detailCsv, statementPdf, summarize } from "@/lib/reports";
import { loadDb } from "@/lib/store";
import { PRACTICE_NAME } from "@/lib/brand";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/export?format=csv|pdf&preset=month|last-month|quarter|year|...|&from=YYYY-MM-DD&to=YYYY-MM-DD&category=...&detail=0|1
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const format = q.get("format") === "pdf" ? "pdf" : "csv";
  const period = periodFromQuery({ preset: q.get("preset") ?? undefined, from: q.get("from") ?? undefined, to: q.get("to") ?? undefined });
  const db = await loadDb();
  const cat = q.get("category") ?? undefined;
  const category = cat && categoryNames(db.customCategories).concat(UNCATEGORIZED).includes(cat) ? cat : undefined;
  const tag = q.get("tag") || undefined;
  const summary = summarize(Object.values(db.receipts), period, category, tag);
  const stem = `expenses-${period.from}-to-${period.to}${category ? `-${category.replace(/[^a-z0-9]+/gi, "_")}` : ""}${tag ? `-${tag}` : ""}`;

  if (format === "csv") {
    return new NextResponse(detailCsv(summary), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${stem}.csv"`,
      },
    });
  }

  const pdf = await statementPdf(summary, {
    practice: PRACTICE_NAME,
    includeDetail: q.get("detail") !== "0",
    includeTax: true,
  });
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${stem}.pdf"`,
    },
  });
}
