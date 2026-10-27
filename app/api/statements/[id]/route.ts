import { NextRequest, NextResponse } from "next/server";
import { loadDb, saveDb } from "@/lib/store";
import { unmatch } from "@/lib/statements";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const db = await loadDb();
  const st = db.statements[id];
  if (!st) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(st);
}

/** Delete a statement; receipts keep their records but lose the statement-derived CAD figure. */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const db = await loadDb();
  const st = db.statements[id];
  if (!st) return NextResponse.json({ error: "Not found" }, { status: 404 });
  for (const tx of st.transactions) unmatch(db, st, tx);
  delete db.statements[id];
  await saveDb(db);
  return NextResponse.json({ ok: true });
}
