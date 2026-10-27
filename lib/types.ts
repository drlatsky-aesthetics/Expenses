export type SourceKind = "email" | "upload";
export type FileKind = "pdf" | "image" | "other";
export type ExtractionMethod = "claude" | "heuristic" | "none";
export type ReceiptStatus = "auto" | "reviewed" | "ignored";

export interface StoredFile {
  index: number;
  name: string;
  contentType: string;
  size: number;
  kind: FileKind;
  /** Storage path (blob pathname or local relative path). */
  path: string;
}

export interface TaxBreakdown {
  gst: number | null;
  hst: number | null;
  pst: number | null;
  qst: number | null;
  other: number | null;
}

export interface LineItem {
  description: string;
  quantity: number | null;
  amount: number | null;
}

export interface ReceiptFields {
  vendor: string | null;
  /** Transaction date, YYYY-MM-DD. */
  date: string | null;
  /** Amount actually paid, including tax and tip. */
  total: number | null;
  subtotal: number | null;
  /** Total tax paid. */
  tax: number | null;
  taxBreakdown: TaxBreakdown;
  tip: number | null;
  currency: string;
  category: string;
  /** What was purchased, in one line. */
  description: string | null;
  /** Business reason for the expense. */
  purpose: string | null;
  paymentMethod: string | null;
  invoiceNumber: string | null;
  lineItems: LineItem[];
}

export interface EmailMeta {
  uid: number;
  mailbox: string;
  messageId: string | null;
  from: string;
  fromName: string;
  subject: string;
  receivedAt: string;
  bodyKind: "html" | "text" | "none";
  /** Short plain-text excerpt of the email body, for display. */
  excerpt: string;
}

export interface ExtractionInfo {
  method: ExtractionMethod;
  model: string | null;
  confidence: number;
  isReceipt: boolean;
  notes: string | null;
  at: string;
}

export interface Receipt {
  id: string;
  source: SourceKind;
  createdAt: string;
  updatedAt: string;
  email: EmailMeta | null;
  files: StoredFile[];
  extracted: ReceiptFields;
  extraction: ExtractionInfo;
  overrides: Partial<ReceiptFields>;
  status: ReceiptStatus;
  note: string | null;
}

export interface MailboxState {
  uidValidity: number | null;
  lastUid: number;
}

export interface SyncInfo {
  at: string;
  added: number;
  ignored: number;
  scanned: number;
  more: boolean;
  error: string | null;
  /** Emails labeled/archived in Gmail during this run. */
  filed?: number;
}

export interface Db {
  version: 1;
  mailboxes: Record<string, MailboxState>;
  lastSync: SyncInfo | null;
  receipts: Record<string, Receipt>;
}

export function emptyFields(currency = "CAD"): ReceiptFields {
  return {
    vendor: null,
    date: null,
    total: null,
    subtotal: null,
    tax: null,
    taxBreakdown: { gst: null, hst: null, pst: null, qst: null, other: null },
    tip: null,
    currency,
    category: "Uncategorized",
    description: null,
    purpose: null,
    paymentMethod: null,
    invoiceNumber: null,
    lineItems: [],
  };
}

export function emptyDb(): Db {
  return { version: 1, mailboxes: {}, lastSync: null, receipts: {} };
}

/** Extracted fields with the user's manual overrides applied. */
export function effectiveFields(r: Receipt): ReceiptFields {
  return { ...r.extracted, ...r.overrides };
}

/** The date used for reporting: receipt date, else the email received date, else creation date. */
export function reportDate(r: Receipt): string {
  const f = effectiveFields(r);
  if (f.date) return f.date;
  const iso = r.email?.receivedAt ?? r.createdAt;
  return iso.slice(0, 10);
}

export function needsReview(r: Receipt): boolean {
  if (r.status !== "auto") return false;
  const f = effectiveFields(r);
  return (
    r.extraction.confidence < 0.7 ||
    f.total === null ||
    !f.vendor ||
    f.category === "Uncategorized"
  );
}
