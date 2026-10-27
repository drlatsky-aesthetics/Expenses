"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

interface Cat {
  name: string;
  description: string;
  line: string;
  count: number;
}

export default function CategoriesManager({ builtIn, custom, uncategorized, tags }: { builtIn: Cat[]; custom: Cat[]; uncategorized: number; tags: { tag: string; count: number }[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [line, setLine] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function add() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/categories", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, description, line }) });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error ?? res.statusText);
      setName("");
      setDescription("");
      setLine("");
      setMsg(`Added "${data.name}". It is now offered to the AI classifier and in every category dropdown.`);
      router.refresh();
    } catch (err) {
      setMsg(`Could not add: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  async function remove(c: Cat) {
    const note = c.count ? ` ${c.count} receipt${c.count === 1 ? "" : "s"} will move to Uncategorized.` : "";
    if (!window.confirm(`Remove the category "${c.name}"?${note}`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/categories?name=${encodeURIComponent(c.name)}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error ?? res.statusText);
      setMsg(`Removed "${c.name}".`);
      router.refresh();
    } catch (err) {
      setMsg(`Could not remove: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1 className="title">Categories &amp; tags</h1>
      <p className="small muted" style={{ marginTop: 0 }}>
        Categories are the accounting buckets (one per receipt, mapped to a CRA T2125 line). Tags are free-form labels you can put on any receipt, as many as you like, for trips, events or projects. Both are stored in the ledger and offered in the dropdowns and reports.
      </p>

      {msg && <div className={`notice ${msg.startsWith("Could") ? "error" : "ok"}`}>{msg}</div>}

      <h2 className="section">Add a category</h2>
      <div className="panel">
        <div className="grid cols-3 stack-sm">
          <div className="field">
            <span className="label">Name</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Laser consumables" />
          </div>
          <div className="field">
            <span className="label">What belongs here (helps the AI)</span>
            <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Tips, handpieces, cooling gel for the laser" />
          </div>
          <div className="field">
            <span className="label">T2125 line (optional)</span>
            <input className="input" value={line} onChange={(e) => setLine(e.target.value)} placeholder="8810 Supplies" />
          </div>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn" disabled={busy || name.trim().length < 2} onClick={add}>
            Add category
          </button>
        </div>
      </div>

      {custom.length > 0 && (
        <>
          <h2 className="section">Custom categories</h2>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Name</th>
                  <th className="hide-sm">Description</th>
                  <th className="hide-sm">T2125 line</th>
                  <th className="num">Receipts</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {custom.map((c) => (
                  <tr key={c.name}>
                    <td style={{ fontWeight: 600 }}>
                      <Link href={`/reports?preset=year&category=${encodeURIComponent(c.name)}`} style={{ color: "inherit" }}>
                        {c.name}
                      </Link>
                    </td>
                    <td className="hide-sm muted">{c.description}</td>
                    <td className="hide-sm small muted">{c.line}</td>
                    <td className="num">{c.count}</td>
                    <td className="num">
                      <button className="btn quiet sm" disabled={busy} onClick={() => remove(c)}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h2 className="section">Built-in categories</h2>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Name</th>
              <th className="hide-sm">Description</th>
              <th className="hide-sm">T2125 line</th>
              <th className="num">Receipts</th>
            </tr>
          </thead>
          <tbody>
            {builtIn.map((c) => (
              <tr key={c.name}>
                <td style={{ fontWeight: 500 }}>
                  <Link href={`/reports?preset=year&category=${encodeURIComponent(c.name)}`} style={{ color: "inherit" }}>
                    {c.name}
                  </Link>
                </td>
                <td className="hide-sm muted small">{c.description}</td>
                <td className="hide-sm small muted">{c.line}</td>
                <td className="num">{c.count}</td>
              </tr>
            ))}
            <tr>
              <td className="muted">Uncategorized</td>
              <td className="hide-sm muted small">Receipts the classifier could not place; assign one on the receipt.</td>
              <td className="hide-sm"></td>
              <td className="num">{uncategorized}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2 className="section">Tags in use</h2>
      {tags.length === 0 ? (
        <p className="small muted">No tags yet. Open a receipt and type a tag under “Tags”.</p>
      ) : (
        <div className="row" style={{ gap: 6 }}>
          {tags.map((t) => (
            <Link key={t.tag} href={`/reports?preset=year&tag=${encodeURIComponent(t.tag)}`} className="pill blue" style={{ textDecoration: "none" }}>
              #{t.tag} · {t.count}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
