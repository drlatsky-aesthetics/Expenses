import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { loadDb, saveDb } from "@/lib/store";
import { unmatch } from "@/lib/statements";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  ignored: z.boolean().optional(),
  /** Receipt id to link, "" to unlink. */
  matchedReceiptId: z.string().nullable().optional(),
});

/** Mark a charge as not-an-expense, or link/unlink it to a receipt by hand. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; tid: string }> }) {
  const { id, tid } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const db = await loadDb();
  const st = db.statements[id];
  const tx = st?.transactions.find((t) => t.id === tid);
  if (!st || !tx) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (parsed.data.ignored !== undefined) {
    tx.ignored = parsed.data.ignored;
    if (tx.ignored) unmatch(db, st, tx);
  }
  if (parsed.data.matchedReceiptId !== undefined) {
    unmatch(db, st, tx);
    const rid = parsed.data.matchedReceiptId;
    if (rid) {
      const r = db.receipts[rid];
      if (!r) return NextResponse.json({ error: "Receipt not found" }, { status: 404 });
      // Free the receipt from any other charge first.
      for (const s of Object.values(db.statements)) for (const t of s.transactions) if (t.matchedReceiptId === rid) unmatch(db, s, t);
      tx.matchedReceiptId = rid;
      tx.ignored = false;
      r.match = { statementId: st.id, transactionId: tx.id };
      r.overrides = { ...r.overrides, chargedCad: tx.amount };
      r.updatedAt = new Date().toISOString();
    }
  }
  await saveDb(db);
  return NextResponse.json(tx);
}
