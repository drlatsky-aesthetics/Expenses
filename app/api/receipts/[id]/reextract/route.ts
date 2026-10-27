import { NextRequest, NextResponse } from "next/server";
import { extractReceipt } from "@/lib/extract";
import { fetchMessageByUid, mailConfigured } from "@/lib/mail";
import { getFile, loadDb, saveDb } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Re-run extraction on a stored receipt (after adding an API key, or if the first read was poor). */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await loadDb();
  const r = db.receipts[id];
  if (!r) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const files: { name: string; contentType: string; content: Buffer }[] = [];
  for (const f of r.files) {
    const got = await getFile(f.path, f.contentType);
    if (got) files.push({ name: f.name, contentType: f.contentType, content: got.buffer });
  }

  let text = r.email?.excerpt ?? "";
  let html: string | null = null;
  if (r.source === "email" && r.email && mailConfigured()) {
    try {
      const msg = await fetchMessageByUid(r.email.uid);
      if (msg) {
        text = msg.text;
        html = msg.html;
      }
    } catch (err) {
      console.error("Could not re-fetch email body:", err);
    }
  }

  const result = await extractReceipt({
    source: r.source,
    from: r.email?.from,
    fromName: r.email?.fromName,
    subject: r.email?.subject,
    receivedAt: r.email?.receivedAt,
    text,
    html,
    files,
  });

  r.extracted = result.fields;
  r.extraction = result.info;
  if (r.status === "auto" || r.status === "ignored") r.status = result.info.isReceipt ? "auto" : "ignored";
  r.updatedAt = new Date().toISOString();
  db.receipts[id] = r;
  await saveDb(db);
  return NextResponse.json(r);
}
