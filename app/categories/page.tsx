import CategoriesManager from "@/components/CategoriesManager";
import { UNCATEGORIZED, categoryList } from "@/lib/categories";
import { loadDb } from "@/lib/store";
import { allTags, effectiveFields } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function CategoriesPage() {
  const db = await loadDb();
  const counts: Record<string, number> = {};
  const tagCounts: Record<string, number> = {};
  for (const r of Object.values(db.receipts)) {
    if (r.status === "ignored") continue;
    const f = effectiveFields(r);
    counts[f.category] = (counts[f.category] ?? 0) + 1;
    for (const t of f.tags ?? []) tagCounts[t] = (tagCounts[t] ?? 0) + 1;
  }
  const builtIn = categoryList().map((c) => ({ ...c, count: counts[c.name] ?? 0 }));
  const custom = db.customCategories.map((c) => ({ ...c, count: counts[c.name] ?? 0 }));
  const tags = allTags(db).map((t) => ({ tag: t, count: tagCounts[t] ?? 0 }));
  return <CategoriesManager builtIn={builtIn} custom={custom} uncategorized={counts[UNCATEGORIZED] ?? 0} tags={tags} />;
}
