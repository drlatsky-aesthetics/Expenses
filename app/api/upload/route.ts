import { NextRequest, NextResponse } from "next/server";
import { extractReceipt } from "@/lib/extract";
import { loadDb, saveDb } from "@/lib/store";
import { newUploadId, storeFiles } from "@/lib/sync";
import { Receipt } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const ALLOWED = new Set(["application/pdf", "image/jpeg", "image/png", "image/gif", "image/webp", "image/heic", "image/heif"]);
const MAX_BYTES = 20 * 1024 * 1024;

/**
 * Direct upload: one receipt record per file (a photo or a PDF).
 * Multipart form field: files (repeatable).
 */
export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Expected multipart form data" }, { status: 400 });
  const entries = form.getAll("files").filter((x): x is File => x instanceof File);
  if (entries.length === 0) return NextResponse.json({ error: "No files received" }, { status: 400 });

  const db = await loadDb();
  const ids: string[] = [];
  const errors: string[] = [];

  for (const file of entries.slice(0, 10)) {
    const type = file.type || "application/octet-stream";
    if (!ALLOWED.has(type)) {
      errors.push(`${file.name}: unsupported type ${type}`);
      continue;
    }
    if (file.size > MAX_BYTES) {
      errors.push(`${file.name}: larger than 20 MB`);
      continue;
    }
    const content = Buffer.from(await file.arrayBuffer());
    const id = newUploadId();
    const stored = await storeFiles(id, [{ name: file.name, contentType: type, content }]);
    const result = await extractReceipt({ source: "upload", files: [{ name: file.name, contentType: type, content }] });
    const now = new Date().toISOString();
    const receipt: Receipt = {
      id,
      source: "upload",
      createdAt: now,
      updatedAt: now,
      email: null,
      files: stored,
      extracted: result.fields,
      extraction: result.info,
      overrides: {},
      status: result.info.isReceipt ? "auto" : "ignored",
      note: null,
    };
    db.receipts[id] = receipt;
    ids.push(id);
  }

  if (ids.length) await saveDb(db);
  if (ids.length === 0) return NextResponse.json({ error: errors.join("; ") || "Nothing uploaded" }, { status: 400 });
  return NextResponse.json({ ids, errors });
}
