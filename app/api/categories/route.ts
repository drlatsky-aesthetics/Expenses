import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { CATEGORY_NAMES, UNCATEGORIZED, categoryList } from "@/lib/categories";
import { loadDb, saveDb } from "@/lib/store";
import { effectiveFields } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(300).optional().default(""),
  line: z.string().trim().max(80).optional().default(""),
});

export async function GET() {
  const db = await loadDb();
  const counts: Record<string, number> = {};
  for (const r of Object.values(db.receipts)) {
    if (r.status === "ignored") continue;
    const c = effectiveFields(r).category;
    counts[c] = (counts[c] ?? 0) + 1;
  }
  return NextResponse.json({
    builtIn: categoryList().map((c) => ({ ...c, count: counts[c.name] ?? 0 })),
    custom: db.customCategories.map((c) => ({ ...c, count: counts[c.name] ?? 0 })),
    uncategorized: counts[UNCATEGORIZED] ?? 0,
  });
}

/** Add a custom category. */
export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Give the category a name (2–60 characters)." }, { status: 400 });
  const { name, description, line } = parsed.data;
  const db = await loadDb();
  const exists = [...CATEGORY_NAMES, UNCATEGORIZED, ...db.customCategories.map((c) => c.name)].some((n) => n.toLowerCase() === name.toLowerCase());
  if (exists) return NextResponse.json({ error: `"${name}" already exists.` }, { status: 409 });
  const cat = { name, description, line, createdAt: new Date().toISOString() };
  db.customCategories.push(cat);
  await saveDb(db);
  return NextResponse.json(cat);
}

/** Remove a custom category; receipts using it move to Uncategorized (or `reassign`). */
export async function DELETE(req: NextRequest) {
  const name = req.nextUrl.searchParams.get("name") ?? "";
  const reassign = req.nextUrl.searchParams.get("reassign") ?? UNCATEGORIZED;
  const db = await loadDb();
  const idx = db.customCategories.findIndex((c) => c.name === name);
  if (idx < 0) return NextResponse.json({ error: "Not a custom category" }, { status: 404 });
  const target = [...CATEGORY_NAMES, UNCATEGORIZED, ...db.customCategories.map((c) => c.name)].includes(reassign) && reassign !== name ? reassign : UNCATEGORIZED;
  let moved = 0;
  for (const r of Object.values(db.receipts)) {
    if (effectiveFields(r).category === name) {
      r.overrides = { ...r.overrides, category: target };
      r.updatedAt = new Date().toISOString();
      moved++;
    }
  }
  db.customCategories.splice(idx, 1);
  await saveDb(db);
  return NextResponse.json({ ok: true, moved, target });
}
