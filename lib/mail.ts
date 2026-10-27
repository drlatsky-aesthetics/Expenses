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
  return { user, pass, mailbox, host, port };
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

/** Fetch one message by UID (used to re-run extraction or re-fetch originals). */
export async function fetchMessageByUid(uid: number): Promise<MailMessage | null> {
  const { mailbox } = mailConfig();
  const client = await connect();
  try {
    const lock = await client.getMailboxLock(mailbox);
    try {
      const msg = await client.fetchOne(String(uid), { uid: true, source: true, internalDate: true }, { uid: true });
      if (!msg || !msg.source) return null;
      const parsed = await simpleParser(msg.source);
      return toMailMessage(msg.uid, parsed, new Date(msg.internalDate ?? Date.now()));
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => undefined);
  }
}
