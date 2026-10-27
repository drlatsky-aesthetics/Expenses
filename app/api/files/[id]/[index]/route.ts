import { NextRequest, NextResponse } from "next/server";
import { getFile, loadDb } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Streams a stored original (PDF or photo) for a receipt. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string; index: string }> }) {
  const { id, index } = await params;
  const db = await loadDb();
  const r = db.receipts[id];
  const file = r?.files.find((f) => f.index === Number(index));
  if (!r || !file) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const got = await getFile(file.path, file.contentType);
  if (!got) return NextResponse.json({ error: "File missing from storage" }, { status: 404 });
  return new NextResponse(new Uint8Array(got.buffer), {
    headers: {
      "Content-Type": got.contentType,
      "Content-Disposition": `inline; filename="${file.name.replace(/"/g, "")}"`,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
