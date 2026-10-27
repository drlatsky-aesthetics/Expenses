import Link from "next/link";
import { notFound } from "next/navigation";
import ReceiptEditor from "@/components/ReceiptEditor";
import { StatusPill } from "@/components/ReceiptsTable";
import { CATEGORY_NAMES } from "@/lib/categories";
import { claudeConfigured } from "@/lib/extract";
import { fmtDate } from "@/lib/money";
import { loadDb } from "@/lib/store";
import { effectiveFields, needsReview } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await loadDb();
  const r = db.receipts[id];
  if (!r) notFound();
  const f = effectiveFields(r);

  return (
    <div>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <Link href="/receipts" className="small">
            ← All receipts
          </Link>
          <h1 className="title" style={{ marginTop: 6 }}>
            {f.vendor || "Unknown vendor"}
          </h1>
          <div className="small muted">
            {r.source === "email" ? (
              <>
                Email from {r.email?.fromName ? `${r.email.fromName} <${r.email.from}>` : r.email?.from} · {fmtDate(r.email?.receivedAt)}
                {r.email?.subject && <> · “{r.email.subject}”</>}
              </>
            ) : (
              <>Uploaded {fmtDate(r.createdAt)}</>
            )}
          </div>
        </div>
        <StatusPill r={{ status: r.status, needsReview: needsReview(r), source: r.source }} />
      </div>

      <div className="grid cols-2 stack-sm" style={{ alignItems: "start" }}>
        <div>
          <h2 className="section" style={{ marginTop: 0 }}>
            Details
          </h2>
          <ReceiptEditor receipt={r} fields={f} categories={CATEGORY_NAMES} canReextract={claudeConfigured()} />
        </div>
        <div>
          <h2 className="section" style={{ marginTop: 0 }}>
            Original
          </h2>
          {r.files.length === 0 && !r.email?.excerpt && <p className="muted small">No attachment or text was captured.</p>}
          {r.files.map((file) => {
            const url = `/api/files/${r.id}/${file.index}`;
            return (
              <div key={file.index} style={{ marginBottom: 14 }}>
                <div className="row small muted" style={{ justifyContent: "space-between", marginBottom: 6 }}>
                  <span>
                    {file.name} · {(file.size / 1024).toFixed(0)} KB
                  </span>
                  <a href={url} target="_blank" rel="noreferrer">
                    Open
                  </a>
                </div>
                <div className="preview">
                  {file.kind === "image" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={url} alt={file.name} />
                  ) : file.kind === "pdf" ? (
                    <>
                      <iframe className="hide-sm" src={url} title={file.name} />
                      <a className="show-sm" href={url} target="_blank" rel="noreferrer" style={{ padding: "18px 14px", textAlign: "center", fontWeight: 600 }}>
                        Open PDF ↗
                      </a>
                    </>
                  ) : (
                    <div className="small muted" style={{ padding: 12 }}>
                      {file.contentType}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {r.email?.excerpt && (
            <details open={r.files.length === 0}>
              <summary className="small muted" style={{ cursor: "pointer" }}>
                Email text
              </summary>
              <div className="panel small" style={{ whiteSpace: "pre-wrap", lineHeight: 1.6, marginTop: 8 }}>
                {r.email.excerpt}
              </div>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}
