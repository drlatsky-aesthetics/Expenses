import { ImapFlow } from "imapflow";
import { simpleParser, type ParsedMail, type AddressObject } from "mailparser";

export interface MailAttachment {
  filename: string;
  contentType: string;
  content: Buffer;
  size: number;
  inline: boolean;
}

export interface MailMessage {
  uid: number;
  messageId: string | null;
  from: string;
  fromName: string;
  subject: string;
  date: Date;
  text: string;
  html: string | null;
  attachments: MailAttachment[];
}

export interface FetchResult {
  mailbox: string;
  uidValidity: number;
  messages: MailMessage[];
  /** Highest UID examined in this batch (so the caller can advance its cursor). */
  highestUid: number;
  /** True when more messages remain beyond `limit`. */
  more: boolean;
}

export function mailConfig() {
  const user = process.env.GOOGLE_EMAIL || "latskymd.receipts@gmail.com";
  // Google shows app passwords as "abcd efgh ijkl mnop"; the spaces are not part of the password.
  const pass = (process.env.GOOGLE_PASSWORD || "").replace(/\s+/g, "");
  const mailbox = process.env.IMAP_MAILBOX || "INBOX";
  const host = process.env.IMAP_HOST || "imap.gmail.com";
  const port = Number(process.env.IMAP_PORT || 993);
  const labelProcessed = process.env.MAIL_LABEL_PROCESSED || "Expenses/Processed";
  const labelSkipped = process.env.MAIL_LABEL_SKIPPED || "Expenses/Skipped";
  const archive = (process.env.MAIL_ARCHIVE || "true").toLowerCase() !== "false";
  return { user, pass, mailbox, host, port, labelProcessed, labelSkipped, archive };
}

export function mailConfigured(): boolean {
  return Boolean(mailConfig().pass);
}

function makeClient() {
  const { user, pass, host, port } = mailConfig();
  if (!pass) throw new Error("GOOGLE_PASSWORD is not set; cannot sign in to the receipts mailbox.");
  return new ImapFlow({
    host,
    port,
    secure: true,
    auth: { user, pass },
    logger: false,
    emitLogs: false,
  });
}

/** Turn imapflow's terse "Command failed" into something a person can act on. */
function describeImapError(err: unknown): Error {
  const e = err as Error & { responseText?: string; response?: string; authenticationFailed?: boolean; serverResponseCode?: string; code?: string };
  const { user, host } = mailConfig();
  const detail = e.responseText || e.response || e.serverResponseCode || e.code || "";
  if (e.authenticationFailed || /AUTHENTICATIONFAILED|Invalid credentials|Application-specific password/i.test(detail)) {
    return new Error(
      `Gmail refused the sign-in for ${user} (${detail || "invalid credentials"}). Check that GOOGLE_PASSWORD is a current 16-character Gmail app password for this exact account, that 2-Step Verification is on, and that IMAP is enabled in Gmail settings.`,
    );
  }
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ECONNRESET/i.test(detail || e.message)) {
    return new Error(`Could not reach ${host}: ${detail || e.message}`);
  }
  return new Error(`IMAP error: ${e.message}${detail ? ` (${detail})` : ""}`);
}

async function connect(): Promise<ImapFlow> {
  const client = makeClient();
  try {
    await client.connect();
  } catch (err) {
    throw describeImapError(err);
  }
  return client;
}

function addressOf(a: AddressObject | AddressObject[] | undefined): { address: string; name: string } {
  const list = Array.isArray(a) ? a : a ? [a] : [];
  const first = list[0]?.value?.[0];
  return { address: first?.address ?? "", name: first?.name ?? "" };
}

export function toMailMessage(uid: number, parsed: ParsedMail, fallbackDate: Date): MailMessage {
  const from = addressOf(parsed.from);
  const attachments: MailAttachment[] = (parsed.attachments ?? []).map((att) => ({
    filename: att.filename || `attachment-${att.contentType.split("/")[1] || "bin"}`,
    contentType: att.contentType || "application/octet-stream",
    content: att.content,
    size: att.size ?? att.content.length,
    inline: att.contentDisposition === "inline" || Boolean(att.cid),
  }));
  return {
    uid,
    messageId: parsed.messageId ?? null,
    from: from.address,
    fromName: from.name,
    subject: parsed.subject ?? "",
    date: parsed.date ?? fallbackDate,
    text: parsed.text ?? "",
    html: typeof parsed.html === "string" ? parsed.html : null,
    attachments,
  };
}

/**
 * Fetch messages with UID greater than `afterUid`, oldest first, up to `limit`.
 * On the first run (afterUid === 0) an optional MAIL_SINCE=YYYY-MM-DD limits how far back to go.
 */
export async function fetchNewMessages(opts: { afterUid: number; limit: number }): Promise<FetchResult> {
  const { mailbox } = mailConfig();
  const client = await connect();
  try {
    const lock = await client.getMailboxLock(mailbox).catch((err) => {
      throw new Error(`Could not open mailbox folder "${mailbox}": ${(err as Error).message}`);
    });
    try {
      const box = client.mailbox;
      const uidValidity = typeof box === "object" && box ? Number(box.uidValidity ?? 0) : 0;

      const search: Record<string, unknown> = { uid: `${opts.afterUid + 1}:*` };
      if (opts.afterUid === 0 && process.env.MAIL_SINCE) {
        const since = new Date(process.env.MAIL_SINCE);
        if (!Number.isNaN(since.getTime())) search.since = since;
      }
      const found = await client.search(search, { uid: true });
      const uids = (Array.isArray(found) ? found : [])
        .filter((u) => u > opts.afterUid)
        .sort((a, b) => a - b);

      const selected = uids.slice(0, opts.limit);
      const more = uids.length > selected.length;
      const messages: MailMessage[] = [];

      if (selected.length > 0) {
        for await (const msg of client.fetch(selected, { uid: true, source: true, internalDate: true }, { uid: true })) {
          if (!msg.source) continue;
          const parsed = await simpleParser(msg.source);
          messages.push(toMailMessage(msg.uid, parsed, new Date(msg.internalDate ?? Date.now())));
        }
      }
      messages.sort((a, b) => a.uid - b.uid);
      const highestUid = selected.length ? selected[selected.length - 1] : opts.afterUid;
      return { mailbox, uidValidity, messages, highestUid, more };
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => undefined);
  }
}

/** Gmail's "All Mail" folder (localized names vary, so look it up by special-use flag). */
async function allMailPath(client: ImapFlow): Promise<string> {
  try {
    const boxes = await client.list();
    const all = boxes.find((b) => b.specialUse === "\\All");
    if (all) return all.path;
  } catch {
    // fall through
  }
  return "[Gmail]/All Mail";
}

/**
 * Fetch one message (used to re-run extraction). Processed mail is archived, so look it up by
 * Message-ID in All Mail first, then fall back to the UID in the scanned folder.
 */
export async function fetchMessage(ref: { messageId: string | null; uid: number }): Promise<MailMessage | null> {
  const { mailbox } = mailConfig();
  const client = await connect();
  try {
    const candidates = [await allMailPath(client), mailbox];
    for (const path of candidates) {
      let lock;
      try {
        lock = await client.getMailboxLock(path);
      } catch {
        continue;
      }
      try {
        let uids: number[] = [];
        if (ref.messageId) {
          const found = await client.search({ header: { "message-id": ref.messageId } }, { uid: true });
          uids = Array.isArray(found) ? found : [];
        }
        if (uids.length === 0 && path === mailbox) uids = [ref.uid];
        for (const uid of uids) {
          const msg = await client.fetchOne(String(uid), { uid: true, source: true, internalDate: true }, { uid: true });
          if (msg && msg.source) {
            const parsed = await simpleParser(msg.source);
            return toMailMessage(msg.uid, parsed, new Date(msg.internalDate ?? Date.now()));
          }
        }
      } finally {
        lock.release();
      }
    }
    return null;
  } finally {
    await client.logout().catch(() => undefined);
  }
}

export interface MailOutcome {
  uid: number;
  /** "processed" = became an expense record; "skipped" = judged not a receipt. */
  outcome: "processed" | "skipped";
}

export interface ApplyResult {
  labeled: number;
  archived: number;
  error: string | null;
}

/**
 * Tidy the inbox after a scan: add the outcome label (Gmail labels are IMAP folders, so a copy
 * adds the label), mark the message read, and archive it (move out of INBOX into All Mail).
 * Failures here never undo extraction; the next scan simply tries again.
 */
export async function applyOutcomes(outcomes: MailOutcome[]): Promise<ApplyResult> {
  const result: ApplyResult = { labeled: 0, archived: 0, error: null };
  if (outcomes.length === 0) return result;
  const { mailbox, labelProcessed, labelSkipped, archive } = mailConfig();
  let client: ImapFlow;
  try {
    client = await connect();
  } catch (err) {
    result.error = (err as Error).message;
    return result;
  }
  try {
    for (const label of [labelProcessed, labelSkipped]) {
      try {
        await client.mailboxCreate(label);
      } catch {
        // already exists
      }
    }
    const allMail = archive ? await allMailPath(client) : null;
    const lock = await client.getMailboxLock(mailbox);
    try {
      for (const o of outcomes) {
        const label = o.outcome === "processed" ? labelProcessed : labelSkipped;
        try {
          await client.messageCopy(String(o.uid), label, { uid: true });
          await client.messageFlagsAdd(String(o.uid), ["\\Seen"], { uid: true });
          result.labeled++;
          if (allMail && allMail !== mailbox) {
            await client.messageMove(String(o.uid), allMail, { uid: true });
            result.archived++;
          }
        } catch (err) {
          result.error = `Could not file message ${o.uid}: ${(err as Error).message}`;
        }
      }
    } finally {
      lock.release();
    }
  } catch (err) {
    result.error = (err as Error).message;
  } finally {
    await client.logout().catch(() => undefined);
  }
  return result;
}
