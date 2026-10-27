import { createHash, randomBytes } from "crypto";
import { applyOutcomes, fetchNewMessages, mailConfig, type MailMessage, type MailAttachment, type MailOutcome } from "./mail";
import { loadDb, putFile, safeFileName, saveDb } from "./store";
import { extractReceipt, bodyText } from "./extract";
import { Db, FileKind, Receipt, StoredFile, SyncInfo } from "./types";
import { ensureFx } from "./fx";

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp", "image/heic", "image/heif", "image/tiff"]);
const MIN_INLINE_IMAGE_BYTES = 40 * 1024; // skip logos and tracking pixels

export function fileKind(contentType: string): FileKind {
  if (contentType === "application/pdf") return "pdf";
  if (IMAGE_TYPES.has(contentType)) return "image";
  return "other";
}

export function receiptIdForMessage(messageId: string | null, uidValidity: number, uid: number): string {
  const key = messageId || `${uidValidity}-${uid}`;
  return `m_${createHash("sha1").update(key).digest("hex").slice(0, 16)}`;
}

export function newUploadId(): string {
  return `u_${randomBytes(8).toString("hex")}`;
}

/** Decide which attachments are worth keeping: PDFs and real images; skip signatures, logos, ics, etc. */
export function keepAttachment(att: MailAttachment): boolean {
  const kind = fileKind(att.contentType);
  if (kind === "pdf") return true;
  if (kind === "image") return !att.inline || att.size >= MIN_INLINE_IMAGE_BYTES;
  return false;
}

export async function storeFiles(receiptId: string, files: { name: string; contentType: string; content: Buffer }[]): Promise<StoredFile[]> {
  const stored: StoredFile[] = [];
  let index = 0;
  for (const f of files.slice(0, 10)) {
    const name = safeFileName(f.name);
    const path = `expenses/files/${receiptId}/${index}-${name}`;
    await putFile(path, f.content, f.contentType);
    stored.push({ index, name, contentType: f.contentType, size: f.content.length, kind: fileKind(f.contentType), path });
    index++;
  }
  return stored;
}

function excerptOf(msg: MailMessage): string {
  const t = bodyText({ text: msg.text, html: msg.html }).replace(/\s+/g, " ").trim();
  return t.slice(0, 400);
}

export async function receiptFromMessage(msg: MailMessage, mailbox: string, uidValidity: number, existingId?: string, customCategories: Db["customCategories"] = []): Promise<Receipt> {
  const id = existingId ?? receiptIdForMessage(msg.messageId, uidValidity, msg.uid);
  const keep = msg.attachments.filter(keepAttachment).map((a) => ({ name: a.filename, contentType: a.contentType, content: a.content }));
  const files = await storeFiles(id, keep);
  const receivedAt = msg.date.toISOString();
  const result = await extractReceipt({
    source: "email",
    from: msg.from,
    fromName: msg.fromName,
    subject: msg.subject,
    receivedAt,
    text: msg.text,
    html: msg.html,
    files: keep,
    customCategories,
  });
  const now = new Date().toISOString();
  return {
    id,
    source: "email",
    createdAt: now,
    updatedAt: now,
    email: {
      uid: msg.uid,
      mailbox,
      messageId: msg.messageId,
      from: msg.from,
      fromName: msg.fromName,
      subject: msg.subject,
      receivedAt,
      bodyKind: msg.html ? "html" : msg.text ? "text" : "none",
      excerpt: excerptOf(msg),
    },
    files,
    extracted: result.fields,
    extraction: result.info,
    overrides: {},
    status: result.info.isReceipt ? "auto" : "ignored",
    note: null,
  };
}

export interface SyncOptions {
  /** Max new messages to process in one run (each may take a few seconds with Claude). */
  limit?: number;
}

export async function syncMailbox(opts: SyncOptions = {}): Promise<SyncInfo> {
  const limit = opts.limit ?? 20;
  const { mailbox } = mailConfig();
  const db: Db = await loadDb();
  const state = db.mailboxes[mailbox] ?? { uidValidity: null, lastUid: 0 };

  const info: SyncInfo = { at: new Date().toISOString(), added: 0, ignored: 0, scanned: 0, more: false, error: null, filed: 0 };
  const outcomes: MailOutcome[] = [];

  try {
    // Peek at UIDVALIDITY first; if Gmail reset it, restart from UID 0 (dedupe by Message-ID protects us).
    let afterUid = state.lastUid;
    let fetched = await fetchNewMessages({ afterUid, limit });
    if (state.uidValidity !== null && fetched.uidValidity !== state.uidValidity) {
      afterUid = 0;
      fetched = await fetchNewMessages({ afterUid, limit });
    }

    const known = new Map<string, Receipt>();
    for (const r of Object.values(db.receipts)) if (r.email?.messageId) known.set(r.email.messageId, r);

    let lastUid = afterUid;
    for (const msg of fetched.messages) {
      info.scanned++;
      lastUid = Math.max(lastUid, msg.uid);
      const dup = msg.messageId ? known.get(msg.messageId) : undefined;
      if (dup) {
        // Already recorded (e.g. a previous run timed out before filing it): just file the email.
        outcomes.push({ uid: msg.uid, outcome: dup.status === "ignored" ? "skipped" : "processed" });
        continue;
      }
      const receipt = await receiptFromMessage(msg, mailbox, fetched.uidValidity, undefined, db.customCategories);
      if (db.receipts[receipt.id]) continue;
      await ensureFx(db, receipt);
      db.receipts[receipt.id] = receipt;
      outcomes.push({ uid: msg.uid, outcome: receipt.status === "ignored" ? "skipped" : "processed" });
      if (receipt.status === "ignored") info.ignored++;
      else info.added++;
      // Persist progress after each message so a timeout never loses work.
      db.mailboxes[mailbox] = { uidValidity: fetched.uidValidity, lastUid };
      db.lastSync = { ...info, more: true };
      await saveDb(db);
    }
    lastUid = Math.max(lastUid, fetched.highestUid);
    info.more = fetched.more;
    db.mailboxes[mailbox] = { uidValidity: fetched.uidValidity, lastUid };
  } catch (err) {
    info.error = err instanceof Error ? err.message : String(err);
  }

  // Label, mark read and archive everything that was recorded, even if the run stopped early.
  if (outcomes.length) {
    const filed = await applyOutcomes(outcomes);
    info.filed = filed.labeled;
    if (filed.error && !info.error) info.error = `Receipts were saved, but filing in Gmail failed: ${filed.error}`;
  }

  db.lastSync = info;
  await saveDb(db);
  return info;
}
