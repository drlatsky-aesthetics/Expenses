"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { Statement, StatementTransaction } from "@/lib/types";
import { fmtDate, fmtMoney } from "@/lib/money";

export interface TxView extends StatementTransaction {
  receiptVendor: string | null;
  receiptTotal: number | null;
  receiptCurrency: string | null;
}
export interface StatementView extends Omit<Statement, "transactions"> {
  transactions: TxView[];
}
export interface ReceiptOption {
  id: string;
  label: string;
  date: string;
}

export default function StatementsView({ statements, unmatchedReceipts }: { statements: StatementView[]; unmatchedReceipts: ReceiptOption[] }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [account, setAccount] = useState("Amex");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(statements[0]?.id ?? null);

  async function upload(files: FileList | null) {
    if (!files || !files.length) return;
    setBusy("upload");
    setMsg(null);
    try {
      const form = new FormData();
      form.append("account", account);
      for (const f of Array.from(files)) form.append("files", f);
      const res = await fetch("/api/statements", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error ?? res.statusText);
      const r = data.results?.[0];
      setMsg(r ? `${r.name}: ${r.transactions} lines, ${r.matched} matched to receipts, ${r.unmatched} charges without a receipt.` : "Uploaded.");
      if (data.ids?.[0]) setOpen(data.ids[0]);
      router.refresh();
    } catch (err) {
      setMsg(`Upload failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function call(label: string, url: string, init: RequestInit) {
    setBusy(label);
    setMsg(null);
    try {
      const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...init });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error ?? res.statusText);
      if (data.matched !== undefined) setMsg(`${data.matched} newly matched, ${data.unmatchedCharges} charges still without a receipt.`);
      router.refresh();
    } catch (err) {
      setMsg(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(null);
    }
  }

  const totalCharges = (s: StatementView) => s.transactions.filter((t) => !t.ignored).reduce((a, t) => a + t.amount, 0);

  return (
    <div>
      <div className="panel">
        <div className="row stack-sm">
          <div className="field" style={{ width: 160 }}>
            <span className="label">Card / account</span>
            <input className="input" value={account} onChange={(e) => setAccount(e.target.value)} placeholder="Amex" />
          </div>
          <input ref={fileRef} type="file" accept=".csv,.pdf,text/csv,application/pdf" multiple style={{ display: "none" }} onChange={(e) => upload(e.target.files)} />
          <button className="btn" style={{ alignSelf: "flex-end" }} disabled={busy !== null} onClick={() => fileRef.current?.click()}>
            {busy === "upload" ? "Reading statement…" : "Upload statement (CSV or PDF)"}
          </button>
          <span className="small muted" style={{ alignSelf: "flex-end", paddingBottom: 8 }}>
            Amex: Statements &amp; Activity → Download → CSV (preferred) or PDF. Each charge is matched to a receipt; the CAD amount the card actually charged is recorded on the receipt for reference, while reports use the Bank of Canada rate.
          </span>
        </div>
      </div>
      {msg && <div className={`notice ${msg.startsWith("Failed") || msg.startsWith("Upload failed") ? "error" : "ok"}`}>{msg}</div>}

      {unmatchedReceipts.length > 0 && (
        <div className="notice warn">
          <strong>{unmatchedReceipts.length} receipt{unmatchedReceipts.length === 1 ? "" : "s"} not yet matched to a card charge.</strong> They are still counted in reports (at the Bank of Canada rate if foreign). Upload the statement covering them, or they may have been paid another way.
        </div>
      )}

      {statements.length === 0 && <p className="muted">No statements yet.</p>}

      {statements.map((s) => {
        const charges = s.transactions.filter((t) => !t.ignored);
        const matched = charges.filter((t) => t.matchedReceiptId);
        const missing = charges.filter((t) => !t.matchedReceiptId);
        const isOpen = open === s.id;
        return (
          <div key={s.id} style={{ marginBottom: 18 }}>
            <div className="row" style={{ justifyContent: "space-between", cursor: "pointer" }} onClick={() => setOpen(isOpen ? null : s.id)}>
              <div>
                <div style={{ fontWeight: 500 }}>
                  {s.account} · {s.periodFrom ? `${fmtDate(s.periodFrom)} – ${fmtDate(s.periodTo)}` : s.name}
                </div>
                <div className="small muted">
                  {charges.length} charges · {fmtMoney(totalCharges(s))} · {matched.length} matched ·{" "}
                  <span style={{ color: missing.length ? "var(--danger)" : "inherit" }}>{missing.length} without a receipt</span> · uploaded {fmtDate(s.uploadedAt)}
                  {s.parser === "claude" ? " · read by AI" : s.parser === "csv" ? " · CSV" : ""}
                </div>
                {s.notes && <div className="small" style={{ color: "var(--danger)" }}>{s.notes}</div>}
              </div>
              <span className="small muted">{isOpen ? "Hide" : "Show"}</span>
            </div>
            {isOpen && (
              <>
                <div className="row" style={{ margin: "10px 0" }}>
                  <button className="btn sm" disabled={busy !== null} onClick={() => call("match", `/api/statements/${s.id}/match`, { method: "POST" })}>
                    Match again
                  </button>
                  {s.files[0] && (
                    <a className="btn ghost sm" href={`/api/files/${s.id}/${s.files[0].index}`} target="_blank" rel="noreferrer">
                      Open file
                    </a>
                  )}
                  <button
                    className="btn danger sm"
                    style={{ marginLeft: "auto" }}
                    disabled={busy !== null}
                    onClick={() => window.confirm("Delete this statement? Receipts stay; only the recorded card charges are cleared.") && call("delete", `/api/statements/${s.id}`, { method: "DELETE" })}
                  >
                    Delete
                  </button>
                </div>
                <div className="table-wrap">
                  <table className="data">
                    <thead>
                      <tr>
                        <th className="col-date">Date</th>
                        <th>Charge</th>
                        <th className="num col-total">CAD</th>
                        <th className="hide-sm">Receipt</th>
                        <th className="hide-sm"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.transactions.map((t) => {
                        const matchCell = t.ignored ? (
                          <span className="pill grey">Not an expense</span>
                        ) : t.matchedReceiptId ? (
                          <Link href={`/receipts/${t.matchedReceiptId}`} className="pill green" style={{ textDecoration: "none" }}>
                            {t.receiptVendor ?? "Receipt"}
                            {t.receiptCurrency && t.receiptCurrency !== "CAD" ? ` · ${t.receiptTotal?.toFixed(2)} ${t.receiptCurrency}` : ""}
                          </Link>
                        ) : (
                          <select
                            className="select"
                            style={{ width: "auto", maxWidth: "100%", fontSize: 12, padding: "4px 6px" }}
                            value=""
                            disabled={busy !== null}
                            onChange={(e) => e.target.value && call("link", `/api/statements/${s.id}/tx/${t.id}`, { method: "PATCH", body: JSON.stringify({ matchedReceiptId: e.target.value }) })}
                          >
                            <option value="">No receipt — link one…</option>
                            {unmatchedReceipts.map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.label}
                              </option>
                            ))}
                          </select>
                        );
                        const actions = (
                          <>
                            {t.matchedReceiptId && !t.ignored && (
                              <button className="btn quiet sm" disabled={busy !== null} onClick={() => call("unlink", `/api/statements/${s.id}/tx/${t.id}`, { method: "PATCH", body: JSON.stringify({ matchedReceiptId: "" }) })}>
                                Unlink
                              </button>
                            )}{" "}
                            <button className="btn quiet sm" disabled={busy !== null} onClick={() => call("ignore", `/api/statements/${s.id}/tx/${t.id}`, { method: "PATCH", body: JSON.stringify({ ignored: !t.ignored }) })}>
                              {t.ignored ? "Count it" : "Not an expense"}
                            </button>
                          </>
                        );
                        return (
                          <tr key={t.id} style={{ opacity: t.ignored ? 0.5 : 1 }}>
                            <td className="col-date">{t.date}</td>
                            <td>
                              {t.description}
                              {t.foreignAmount !== null && t.foreignAmount > 0 && (
                                <div className="small faint">
                                  {t.foreignCurrency} {t.foreignAmount.toFixed(2)} as charged · card rate {(t.amount / t.foreignAmount).toFixed(4)}
                                </div>
                              )}
                              <div className="show-sm" style={{ marginTop: 6 }}>
                                {matchCell}
                                <div style={{ marginTop: 6 }}>{actions}</div>
                              </div>
                            </td>
                            <td className="num col-total" style={{ fontWeight: 500 }}>
                              {fmtMoney(t.amount)}
                            </td>
                            <td className="hide-sm">{matchCell}</td>
                            <td className="hide-sm" style={{ whiteSpace: "nowrap" }}>
                              {actions}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
