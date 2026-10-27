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

export type FxSource = "boc" | "manual" | null;

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
  /** CAD per 1 unit of `currency` (1 for CAD). */
  fxRate: number | null;
  /** Where the rate / CAD amount came from: Bank of Canada, a card statement, or a manual entry. */
  fxSource: FxSource;
  /** Total in CAD at the Bank of Canada rate (the figure used in every report). */
  totalCad: number | null;
  /** What the card statement shows was charged in CAD, when matched (reference only). */
  chargedCad: number | null;
  /** Free-form tags (e.g. "erie-residency", "conference-2026"). */
  tags: string[];
}

export interface CustomCategory {
  name: string;
  description: string;
  /** CRA T2125 line hint, optional. */
  line: string;
  createdAt: string;
}

export interface StatementTransaction {
  id: string;
  date: string; // YYYY-MM-DD
  description: string;
  /** Amount charged in CAD; negative for payments/credits. */
  amount: number;
  foreignAmount: number | null;
  foreignCurrency: string | null;
  matchedReceiptId: string | null;
  /** True when the user says this charge is not a business expense (or a payment). */
  ignored: boolean;
}

export interface Statement {
  id: string;
  account: string;
  name: string;
  uploadedAt: string;
  periodFrom: string | null;
  periodTo: string | null;
  files: StoredFile[];
  transactions: StatementTransaction[];
  parser: "csv" | "claude" | "none";
  notes: string | null;
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
  /** Card statement line this receipt was matched to, if any. */
  match?: { statementId: string; transactionId: string } | null;
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
  statements: Record<string, Statement>;
  /** Bank of Canada rate cache, key "USD:2026-10-20" -> CAD per unit. */
  fxCache: Record<string, number>;
  /** Categories added from the app, on top of the built-in list. */
  customCategories: CustomCategory[];
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
    fxRate: currency === "CAD" ? 1 : null,
    fxSource: null,
    totalCad: null,
    chargedCad: null,
    tags: [],
  };
}

export function emptyDb(): Db {
  return { version: 1, mailboxes: {}, lastSync: null, receipts: {}, statements: {}, fxCache: {}, customCategories: [] };
}

/** Normalize a tag: lower-case, spaces to hyphens, safe characters only. */
export function normalizeTag(t: string): string {
  return t
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u00C0-\u024F\s_-]+/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

export function allTags(db: Db): string[] {
  const set = new Set<string>();
  for (const r of Object.values(db.receipts)) for (const t of effectiveFields(r).tags) set.add(t);
  return [...set].sort();
}

/** Extracted fields with the user's manual overrides applied, and CAD figures derived. */
export function effectiveFields(r: Receipt): ReceiptFields {
  const f: ReceiptFields = { ...emptyFields(), ...r.extracted, ...r.overrides };
  if (f.currency === "CAD") {
    f.fxRate = 1;
    f.totalCad = f.total;
  } else if (f.fxRate !== null && f.total !== null) {
    f.totalCad = Math.round(f.total * f.fxRate * 100) / 100;
  } else {
    f.totalCad = null;
  }
  return f;
}

/** CAD value of a receipt field (subtotal, tax...) using the receipt's effective rate. */
export function toCad(f: ReceiptFields, amount: number | null): number | null {
  if (amount === null) return null;
  if (f.currency === "CAD") return amount;
  if (f.fxRate === null) return null;
  return Math.round(amount * f.fxRate * 100) / 100;
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
    f.totalCad === null ||
    !f.vendor ||
    f.category === "Uncategorized"
  );
}
