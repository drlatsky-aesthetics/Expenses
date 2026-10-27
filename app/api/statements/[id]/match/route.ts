import { NextRequest, NextResponse } from "next/server";
import { loadDb, saveDb } from "@/lib/store";
import { matchStatement } from "@/lib/statements";
import { backfillFx } from "@/lib/fx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Re-run matching for a statement (after new receipts arrive). */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await loadDb();
  const st = db.statements[id];
  if (!st) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await backfillFx(db);
  const result = matchStatement(db, st);
  await saveDb(db);
  return NextResponse.json(result);
}
