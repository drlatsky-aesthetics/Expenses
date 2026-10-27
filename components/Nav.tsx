"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useRef, useState } from "react";

const TABS = [
  { href: "/", label: "Overview" },
  { href: "/receipts", label: "Receipts" },
  { href: "/reports", label: "Reports" },
  { href: "/statements", label: "Statements" },
];

export default function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function show(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(null), 6000);
  }

  async function sync() {
    setSyncing(true);
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok || data.error) {
        show(`Scan failed: ${data.error ?? res.statusText}`);
      } else {
        const parts = [`${data.added} receipt${data.added === 1 ? "" : "s"} added`];
        if (data.ignored) parts.push(`${data.ignored} non-receipt${data.ignored === 1 ? "" : "s"} skipped`);
        if (data.more) parts.push("more waiting — scan again");
        show(data.scanned === 0 ? "Mailbox is up to date." : parts.join(" · "));
        router.refresh();
      }
    } catch (err) {
      show(`Scan failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSyncing(false);
    }
  }

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const form = new FormData();
      for (const f of Array.from(files)) form.append("files", f);
      const res = await fetch("/api/upload", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok || data.error) {
        show(`Upload failed: ${data.error ?? res.statusText}`);
        return;
      }
      const ids: string[] = data.ids ?? [];
      if (ids.length === 1) {
        router.push(`/receipts/${ids[0]}`);
      } else {
        show(`${ids.length} receipts added`);
        router.push("/receipts");
      }
      router.refresh();
    } catch (err) {
      show(`Upload failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <>
      <div className="topbar">
        <div className="brand">
          Dr. Jason Latsky<span className="sep">|</span>
          <span className="unit">Medical Professional Corporation</span>
          <small>Expenses</small>
        </div>
        <div className="actions">
          <input
            ref={fileRef}
            type="file"
            accept="image/*,application/pdf"
            multiple
            style={{ display: "none" }}
            onChange={(e) => upload(e.target.files)}
          />
          <button className="btn ghost" onClick={() => fileRef.current?.click()} disabled={uploading}>
            {uploading ? "Reading…" : "+ Add receipt"}
          </button>
          <button className="btn" onClick={sync} disabled={syncing}>
            {syncing ? "Scanning inbox…" : "Scan inbox"}
          </button>
        </div>
      </div>
      <div className="tabs">
        {TABS.map((t) => {
          const active = t.href === "/" ? pathname === "/" : pathname.startsWith(t.href);
          return (
            <Link key={t.href} href={t.href} className={`tab${active ? " active" : ""}`}>
              {t.label}
            </Link>
          );
        })}
      </div>
      {toast && <div className="toast">{toast}</div>}
    </>
  );
}
