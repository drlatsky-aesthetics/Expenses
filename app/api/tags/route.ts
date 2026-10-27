import { NextResponse } from "next/server";
import { loadDb } from "@/lib/store";
import { allTags, effectiveFields } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const db = await loadDb();
  const counts: Record<string, number> = {};
  for (const r of Object.values(db.receipts)) for (const t of effectiveFields(r).tags) counts[t] = (counts[t] ?? 0) + 1;
  return NextResponse.json({ tags: allTags(db).map((t) => ({ tag: t, count: counts[t] })) });
}
