"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { fmtDate, fmtMoney } from "@/lib/money";

export interface ReceiptRowView {
  id: string;
  date: string;
  vendor: string;
  category: string;
  description: string;
  total: number | null;
  totalCad: number | null;
  tax: number | null;
  currency: string;
  status: "auto" | "reviewed" | "ignored";
  needsReview: boolean;
  source: "email" | "upload";
  fileKinds: string[];
  confidence: number;
  subject: string;
}

export default function ReceiptsTable({ rows, categories }: { rows: ReceiptRowView[]; categories: string[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [view, setView] = useState<"active" | "review" | "ignored" | "all">("active");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (view === "active" && r.status === "ignored") return false;
      if (view === "review" && !r.needsReview) return false;
      if (view === "ignored" && r.status !== "ignored") return false;
      if (cat && r.category !== cat) return false;
      if (needle) {
        const hay = `${r.vendor} ${r.description} ${r.category} ${r.subject} ${r.total ?? ""}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [rows, q, cat, view]);

  const sum = filtered.reduce((a, r) => a + (r.status !== "ignored" ? r.totalCad ?? 0 : 0), 0);
  const reviewCount = rows.filter((r) => r.needsReview).length;
  const ignoredCount = rows.filter((r) => r.status === "ignored").length;

  return (
    <>
      <div className="panel row filters">
        <input className="input" style={{ maxWidth: 260 }} placeholder="Search vendor, item, subject…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="select" style={{ width: "auto" }} value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select className="select" style={{ width: "auto" }} value={view} onChange={(e) => setView(e.target.value as typeof view)}>
          <option value="active">Expenses</option>
          <option value="review">Needs review ({reviewCount})</option>
          <option value="ignored">Not receipts ({ignoredCount})</option>
          <option value="all">Everything</option>
        </select>
        <span className="muted small count" style={{ marginLeft: "auto" }}>
          {filtered.length} shown · {fmtMoney(sum)}
        </span>
      </div>

      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th className="col-date">Date</th>
              <th>Vendor</th>
              <th className="hide-sm">Description</th>
              <th className="hide-sm">Category</th>
              <th className="hide-sm">Status</th>
              <th className="num hide-sm">Tax</th>
              <th className="num col-total">Total (CAD)</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr className="empty">
                <td colSpan={7}>{rows.length === 0 ? "No receipts yet. Scan the inbox or add one." : "Nothing matches these filters."}</td>
              </tr>
            ) : (
              filtered.map((r) => (
                <tr key={r.id} className="link" onClick={() => router.push(`/receipts/${r.id}`)}>
                  <td className="col-date">{fmtDate(r.date)}</td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{r.vendor || <span className="faint">Unknown vendor</span>}</div>
                    <div className="show-sm" style={{ marginTop: 4 }}>
                      <span className={`pill${r.category === "Uncategorized" ? " grey" : ""}`}>{r.category}</span>
                      {r.status === "ignored" ? (
                        <span className="pill grey" style={{ marginLeft: 4 }}>Not a receipt</span>
                      ) : r.needsReview ? (
                        <span className="pill amber" style={{ marginLeft: 4 }}>Check</span>
                      ) : null}
                    </div>
                  </td>
                  <td className="hide-sm muted" style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {r.description || r.subject}
                  </td>
                  <td className="hide-sm">
                    <span className={`pill${r.category === "Uncategorized" ? " grey" : ""}`}>{r.category}</span>
                  </td>
                  <td className="hide-sm">
                    <StatusPill r={r} />
                  </td>
                  <td className="num hide-sm muted">{fmtMoney(r.tax, r.currency)}</td>
                  <td className="num col-total" style={{ fontWeight: 600 }}>
                    {r.currency === "CAD" ? (
                      fmtMoney(r.total)
                    ) : (
                      <>
                        {r.totalCad === null ? <span className="pill amber">No rate</span> : fmtMoney(r.totalCad)}
                        <div className="small faint" style={{ fontWeight: 400 }}>
                          {fmtMoney(r.total, r.currency)} {r.currency}
                        </div>
                      </>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function StatusPill({ r }: { r: { status: string; needsReview: boolean; source: string } }) {
  if (r.status === "ignored") return <span className="pill grey">Not a receipt</span>;
  if (r.status === "reviewed") return <span className="pill green">Reviewed</span>;
  if (r.needsReview) return <span className="pill amber">Check</span>;
  return <span className="pill blue">Auto</span>;
}
