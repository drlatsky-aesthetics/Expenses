"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Receipt, ReceiptFields } from "@/lib/types";
import { fmtDate, fmtMoney } from "@/lib/money";

type Num = number | null;

function numInput(v: string): Num {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

export default function ReceiptEditor({ receipt, fields, categories, canReextract }: { receipt: Receipt; fields: ReceiptFields; categories: string[]; canReextract: boolean }) {
  const router = useRouter();
  const [f, setF] = useState<ReceiptFields>(fields);
  const [note, setNote] = useState(receipt.note ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const set = <K extends keyof ReceiptFields>(k: K, v: ReceiptFields[K]) => setF((p) => ({ ...p, [k]: v }));
  const setTax = (k: keyof ReceiptFields["taxBreakdown"], v: Num) => setF((p) => ({ ...p, taxBreakdown: { ...p.taxBreakdown, [k]: v } }));

  async function patch(body: Record<string, unknown>, label: string) {
    setBusy(label);
    setMsg(null);
    try {
      const res = await fetch(`/api/receipts/${receipt.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error ?? res.statusText);
      setMsg("Saved.");
      router.refresh();
      return true;
    } catch (err) {
      setMsg(`Could not save: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    } finally {
      setBusy(null);
    }
  }

  function save(status?: "reviewed") {
    const body: Record<string, unknown> = { fields: f, note };
    if (status) body.status = status;
    return patch(body, status ? "review" : "save");
  }

  async function reextract() {
    setBusy("reextract");
    setMsg(null);
    try {
      const res = await fetch(`/api/receipts/${receipt.id}/reextract`, { method: "POST" });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error ?? res.statusText);
      setMsg("Re-read the receipt. Review the updated fields.");
      router.refresh();
      window.location.reload();
    } catch (err) {
      setMsg(`Could not re-read: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!window.confirm("Delete this receipt record? The original email stays in Gmail.")) return;
    setBusy("delete");
    const res = await fetch(`/api/receipts/${receipt.id}`, { method: "DELETE" });
    if (res.ok) {
      router.push("/receipts");
      router.refresh();
    } else {
      setBusy(null);
      setMsg("Could not delete.");
    }
  }

  const taxSum = ["gst", "hst", "pst", "qst", "other"].reduce((a, k) => a + (f.taxBreakdown[k as keyof typeof f.taxBreakdown] ?? 0), 0);
  const foreign = f.currency !== "CAD";
  const setFx = (patch: Partial<Pick<ReceiptFields, "fxRate" | "totalCad">>) => setF((p) => ({ ...p, ...patch, fxSource: patch.fxRate === null ? null : "manual" }));

  return (
    <div>
      {msg && <div className={`notice ${msg.startsWith("Could") ? "error" : "ok"}`}>{msg}</div>}

      <div className="grid cols-2">
        <div className="field">
          <span className="label">Vendor</span>
          <input className="input" value={f.vendor ?? ""} onChange={(e) => set("vendor", e.target.value || null)} />
        </div>
        <div className="field">
          <span className="label">Date</span>
          <input className="input" type="date" value={f.date ?? ""} onChange={(e) => set("date", e.target.value || null)} />
        </div>
        <div className="field">
          <span className="label">Category</span>
          <select className="select" value={f.category} onChange={(e) => set("category", e.target.value)}>
            {!categories.includes(f.category) && <option value={f.category}>{f.category}</option>}
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
            <option value="Uncategorized">Uncategorized</option>
          </select>
        </div>
        <div className="field">
          <span className="label">Payment method</span>
          <input className="input" value={f.paymentMethod ?? ""} onChange={(e) => set("paymentMethod", e.target.value || null)} placeholder="Visa ending 1234" />
        </div>
      </div>

      <div className="grid cols-2" style={{ marginTop: 14 }}>
        <div className="field">
          <span className="label">What was purchased</span>
          <input className="input" value={f.description ?? ""} onChange={(e) => set("description", e.target.value || null)} />
        </div>
        <div className="field">
          <span className="label">Business purpose</span>
          <input className="input" value={f.purpose ?? ""} onChange={(e) => set("purpose", e.target.value || null)} placeholder="Why the practice paid for this" />
        </div>
      </div>

      <h2 className="section">Amounts</h2>
      <div className="grid cols-4">
        <div className="field">
          <span className="label">Subtotal</span>
          <input className="input" inputMode="decimal" value={f.subtotal ?? ""} onChange={(e) => set("subtotal", numInput(e.target.value))} />
        </div>
        <div className="field">
          <span className="label">Total tax</span>
          <input className="input" inputMode="decimal" value={f.tax ?? ""} onChange={(e) => set("tax", numInput(e.target.value))} />
        </div>
        <div className="field">
          <span className="label">Tip</span>
          <input className="input" inputMode="decimal" value={f.tip ?? ""} onChange={(e) => set("tip", numInput(e.target.value))} />
        </div>
        <div className="field">
          <span className="label">Total paid</span>
          <input className="input" inputMode="decimal" style={{ fontWeight: 700 }} value={f.total ?? ""} onChange={(e) => set("total", numInput(e.target.value))} />
        </div>
      </div>
      <div className="grid cols-4" style={{ marginTop: 14 }}>
        {(["gst", "hst", "pst", "qst"] as const).map((k) => (
          <div className="field" key={k}>
            <span className="label">{k.toUpperCase()}</span>
            <input className="input" inputMode="decimal" value={f.taxBreakdown[k] ?? ""} onChange={(e) => setTax(k, numInput(e.target.value))} />
          </div>
        ))}
      </div>
      <div className="row stack-sm" style={{ marginTop: 10 }}>
        <div className="field" style={{ width: 140 }}>
          <span className="label">Other tax</span>
          <input className="input" inputMode="decimal" value={f.taxBreakdown.other ?? ""} onChange={(e) => setTax("other", numInput(e.target.value))} />
        </div>
        <div className="field" style={{ width: 110 }}>
          <span className="label">Currency</span>
          <input className="input" value={f.currency} onChange={(e) => set("currency", e.target.value.toUpperCase().slice(0, 3))} />
        </div>
        <div className="field" style={{ width: 180 }}>
          <span className="label">Invoice / order #</span>
          <input className="input" value={f.invoiceNumber ?? ""} onChange={(e) => set("invoiceNumber", e.target.value || null)} />
        </div>
        {taxSum > 0 && f.tax !== null && Math.abs(taxSum - f.tax) > 0.011 && (
          <span className="small" style={{ color: "var(--amber)", alignSelf: "flex-end", paddingBottom: 8 }}>
            Tax lines add to {fmtMoney(taxSum, f.currency)} but total tax is {fmtMoney(f.tax, f.currency)}.
          </span>
        )}
      </div>

      {foreign && (
        <>
          <h2 className="section">Canadian dollars</h2>
          <div className="row stack-sm">
            <div className="field" style={{ width: 170 }}>
              <span className="label">Rate (CAD per {f.currency})</span>
              <input
                className="input"
                inputMode="decimal"
                value={f.fxRate ?? ""}
                onChange={(e) => {
                  const rate = numInput(e.target.value);
                  setFx({ fxRate: rate, totalCad: rate !== null && f.total !== null ? Math.round(f.total * rate * 100) / 100 : null });
                }}
              />
            </div>
            <div className="field" style={{ width: 170 }}>
              <span className="label">Total in CAD (reports)</span>
              <input className="input" readOnly style={{ fontWeight: 700, background: "var(--highlight)" }} value={f.totalCad !== null ? f.totalCad.toFixed(2) : ""} placeholder="no rate yet" />
            </div>
            {f.chargedCad !== null && (
              <div className="field" style={{ width: 170 }}>
                <span className="label">Card charged (CAD)</span>
                <input className="input" readOnly style={{ background: "var(--highlight)" }} value={f.chargedCad.toFixed(2)} />
              </div>
            )}
            <span className="small muted" style={{ alignSelf: "flex-end", paddingBottom: 8, flex: 1, minWidth: 200 }}>
              {f.fxSource === "manual"
                ? "Rate entered manually. Clear it and save to return to the Bank of Canada rate."
                : f.fxSource === "boc"
                  ? "Bank of Canada daily rate for the receipt date (CRA-accepted). Reports use this figure."
                  : "No rate yet: save to fetch the Bank of Canada rate, or enter one."}
              {f.chargedCad !== null && f.totalCad !== null && ` The card charged ${fmtMoney(f.chargedCad)}, ${fmtMoney(Math.round((f.chargedCad - f.totalCad) * 100) / 100)} difference (conversion fee).`}
            </span>
          </div>
        </>
      )}

      {f.lineItems.length > 0 && (
        <>
          <h2 className="section">Line items</h2>
          <div className="table-wrap">
            <table className="data lineitems">
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="num">Qty</th>
                  <th className="num">Amount</th>
                </tr>
              </thead>
              <tbody>
                {f.lineItems.map((li, i) => (
                  <tr key={i}>
                    <td>{li.description}</td>
                    <td className="num">{li.quantity ?? ""}</td>
                    <td className="num">{fmtMoney(li.amount, f.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h2 className="section">Note for the bookkeeper</h2>
      <textarea className="textarea" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional. e.g. Split 50/50 with personal use." />

      <div className="row stack-sm" style={{ marginTop: 18 }}>
        <button className="btn" disabled={busy !== null} onClick={() => save("reviewed")}>
          {busy === "review" ? "Saving…" : "Save & mark reviewed"}
        </button>
        <button className="btn ghost" disabled={busy !== null} onClick={() => save()}>
          {busy === "save" ? "Saving…" : "Save"}
        </button>
        {receipt.status === "ignored" ? (
          <button className="btn ghost" disabled={busy !== null} onClick={() => patch({ status: "auto" }, "status")}>
            Count as an expense
          </button>
        ) : (
          <button className="btn quiet" disabled={busy !== null} onClick={() => patch({ status: "ignored" }, "status")}>
            Not a receipt
          </button>
        )}
        {canReextract && (
          <button className="btn quiet" disabled={busy !== null} onClick={reextract}>
            {busy === "reextract" ? "Reading…" : "Re-read with AI"}
          </button>
        )}
        <button className="btn danger sm" style={{ marginLeft: "auto" }} disabled={busy !== null} onClick={remove}>
          Delete
        </button>
      </div>

      <div className="small faint" style={{ marginTop: 16, lineHeight: 1.7 }}>
        Read by {receipt.extraction.method === "claude" ? `Claude (${receipt.extraction.model})` : receipt.extraction.method === "heuristic" ? "the text parser" : "nobody yet"} on {fmtDate(receipt.extraction.at)} · confidence {Math.round(receipt.extraction.confidence * 100)}%
        {receipt.extraction.notes && (
          <>
            <br />
            {receipt.extraction.notes}
          </>
        )}
      </div>
    </div>
  );
}
