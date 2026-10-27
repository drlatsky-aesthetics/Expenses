import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isKnownCategory } from "@/lib/categories";
import { loadDb, saveDb } from "@/lib/store";
import { ReceiptFields, ReceiptStatus, effectiveFields } from "@/lib/types";
import { ensureFx } from "@/lib/fx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Num = z.number().finite().nullable();

const FieldsPatch = z
  .object({
    vendor: z.string().max(200).nullable(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    total: Num,
    subtotal: Num,
    tax: Num,
    taxBreakdown: z.object({ gst: Num, hst: Num, pst: Num, qst: Num, other: Num }),
    tip: Num,
    currency: z.string().min(3).max(3),
    category: z.string().max(80),
    description: z.string().max(500).nullable(),
    purpose: z.string().max(500).nullable(),
    paymentMethod: z.string().max(120).nullable(),
    invoiceNumber: z.string().max(120).nullable(),
    lineItems: z.array(z.object({ description: z.string().max(300), quantity: Num, amount: Num })).max(50),
    fxRate: Num,
    fxSource: z.enum(["boc", "manual"]).nullable(),
    totalCad: Num,
    chargedCad: Num,
  })
  .partial();

const Body = z.object({
  fields: FieldsPatch.optional(),
  status: z.enum(["auto", "reviewed", "ignored"]).optional(),
  note: z.string().max(2000).nullable().optional(),
});

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const db = await loadDb();
  const r = db.receipts[id];
  if (!r) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(r);
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 });

  const db = await loadDb();
  const r = db.receipts[id];
  if (!r) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { fields, status, note } = parsed.data;
  if (fields) {
    // Store only the values that differ from what was extracted, so re-reading never clobbers manual edits.
    const overrides: Partial<ReceiptFields> = { ...r.overrides };
    for (const [k, v] of Object.entries(fields) as [keyof ReceiptFields, ReceiptFields[keyof ReceiptFields]][]) {
      if (v === undefined) continue;
      if (k === "category" && typeof v === "string" && !isKnownCategory(v)) continue;
      const same = JSON.stringify(v) === JSON.stringify(r.extracted[k]);
      if (same) delete overrides[k];
      else (overrides as Record<string, unknown>)[k] = v;
    }
    r.overrides = overrides;
    // A manually entered rate sticks; otherwise refresh the Bank of Canada rate for the (possibly new) date/currency.
    const eff = effectiveFields(r);
    if (eff.currency !== "CAD" && eff.fxSource !== "manual") {
      const { fxRate: _a, fxSource: _b, totalCad: _c, ...rest } = r.overrides;
      r.overrides = rest;
      r.extracted = { ...r.extracted, fxRate: null, fxSource: null, totalCad: null };
      await ensureFx(db, r);
    }
  }
  if (status) r.status = status as ReceiptStatus;
  if (note !== undefined) r.note = note;
  r.updatedAt = new Date().toISOString();
  db.receipts[id] = r;
  await saveDb(db);
  return NextResponse.json(r);
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const db = await loadDb();
  if (!db.receipts[id]) return NextResponse.json({ error: "Not found" }, { status: 404 });
  delete db.receipts[id];
  await saveDb(db);
  return NextResponse.json({ ok: true });
}
