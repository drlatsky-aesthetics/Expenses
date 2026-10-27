import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { loadDb, saveDb } from "@/lib/store";
import { storeFiles } from "@/lib/sync";
import { matchStatement, parseStatementFile } from "@/lib/statements";
import { backfillFx } from "@/lib/fx";
import { Statement } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const ALLOWED = new Set(["application/pdf", "text/csv", "application/vnd.ms-excel", "text/plain", "application/octet-stream"]);

export async function GET() {
  const db = await loadDb();
  return NextResponse.json({ statements: Object.values(db.statements) });
}

/** Upload one or more card statements (CSV export or PDF). Each becomes a Statement and is matched immediately. */
export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Expected multipart form data" }, { status: 400 });
  const entries = form.getAll("files").filter((x): x is File => x instanceof File);
  if (entries.length === 0) return NextResponse.json({ error: "No files received" }, { status: 400 });
  const account = String(form.get("account") ?? "").trim();

  const db = await loadDb();
  await backfillFx(db);
  const ids: string[] = [];
  const errors: string[] = [];
  const results: { id: string; name: string; transactions: number; matched: number; unmatched: number }[] = [];

  for (const file of entries.slice(0, 6)) {
    const type = file.type || (file.name.toLowerCase().endsWith(".csv") ? "text/csv" : "application/octet-stream");
    if (!ALLOWED.has(type) && !/\.(csv|pdf|txt)$/i.test(file.name)) {
      errors.push(`${file.name}: unsupported type ${type}`);
      continue;
    }
    const content = Buffer.from(await file.arrayBuffer());
    const id = `s_${randomBytes(6).toString("hex")}`;
    let parsed;
    try {
      parsed = await parseStatementFile({ name: file.name, contentType: type, content });
    } catch (err) {
      errors.push(`${file.name}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    const files = await storeFiles(id, [{ name: file.name, contentType: type, content }]);
    const dates = parsed.transactions.map((t) => t.date).sort();
    const st: Statement = {
      id,
      account: account || parsed.account || "Card",
      name: file.name,
      uploadedAt: new Date().toISOString(),
      periodFrom: parsed.periodFrom ?? dates[0] ?? null,
      periodTo: parsed.periodTo ?? dates[dates.length - 1] ?? null,
      files,
      transactions: parsed.transactions,
      parser: parsed.parser,
      notes: parsed.notes,
    };
    db.statements[id] = st;
    const m = matchStatement(db, st);
    ids.push(id);
    results.push({ id, name: file.name, transactions: st.transactions.length, matched: m.matched, unmatched: m.unmatchedCharges });
  }

  if (ids.length) await saveDb(db);
  if (ids.length === 0) return NextResponse.json({ error: errors.join("; ") || "Nothing uploaded" }, { status: 400 });
  return NextResponse.json({ ids, results, errors });
}
