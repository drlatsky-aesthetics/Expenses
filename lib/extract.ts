import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { convert as htmlToText } from "html-to-text";
import { extractText as pdfExtractText } from "unpdf";
import { ALL_CATEGORY_NAMES, CATEGORY_NAMES, UNCATEGORIZED, categoryPromptList, guessCategory, isKnownCategory } from "./categories";
import { ExtractionInfo, ReceiptFields, emptyFields } from "./types";
import { round2 } from "./money";
import { PRACTICE_NAME } from "./brand";

export interface ExtractInput {
  /** Where the document came from, for context. */
  source: "email" | "upload";
  from?: string;
  fromName?: string;
  subject?: string;
  receivedAt?: string;
  text?: string;
  html?: string | null;
  files: { name: string; contentType: string; content: Buffer }[];
}

export interface ExtractOutput {
  fields: ReceiptFields;
  info: ExtractionInfo;
}

const MAX_TEXT_CHARS = 20_000;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const MAX_IMAGE_BYTES = 4.8 * 1024 * 1024;
const MAX_PDF_BYTES = 20 * 1024 * 1024;

export function defaultCurrency(): string {
  return process.env.DEFAULT_CURRENCY || "CAD";
}

export function claudeConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export function claudeModel(): string {
  return process.env.CLAUDE_MODEL || "claude-opus-5-5";
}

export function bodyText(input: { text?: string; html?: string | null }): string {
  if (input.text && input.text.trim().length > 40) return input.text.trim();
  if (input.html) {
    try {
      return htmlToText(input.html, {
        wordwrap: false,
        selectors: [
          { selector: "a", options: { ignoreHref: true } },
          { selector: "img", format: "skip" },
          { selector: "style", format: "skip" },
          { selector: "script", format: "skip" },
        ],
      }).trim();
    } catch {
      return input.text?.trim() ?? "";
    }
  }
  return input.text?.trim() ?? "";
}

export async function pdfText(buffer: Buffer): Promise<string> {
  try {
    const res = await pdfExtractText(new Uint8Array(buffer), { mergePages: true });
    return (res.text ?? "").trim();
  } catch {
    return "";
  }
}

/** Cheap gate so obvious non-receipts (account notices, newsletters) never reach Claude. */
export function looksLikeReceipt(input: ExtractInput, text: string): boolean {
  if (input.source === "upload") return true;
  if (input.files.some((f) => f.contentType === "application/pdf" || f.contentType.startsWith("image/"))) return true;
  const hay = `${input.subject ?? ""}\n${text}`;
  if (/(\$|CAD|USD|C\$|US\$)\s?\d[\d,]*\.\d{2}/.test(hay) || /\d[\d,]*\.\d{2}\s?(CAD|USD)/.test(hay)) return true;
  return /\b(receipt|invoice|order|purchase|payment|paid|amount|total|subscription|renewal|statement)\b/i.test(hay);
}

// ---------- Claude extraction ----------

const NullableNumber = z.number().nullable();

const ReceiptSchema = z.object({
  is_receipt: z
    .boolean()
    .describe("True only if this is a receipt, invoice, order confirmation, bill or other proof of a purchase/payment. False for account notices, marketing, shipping-only updates, password resets, etc."),
  vendor: z.string().nullable().describe("The merchant or supplier that was paid, as a clean short business name."),
  date: z.string().nullable().describe("Transaction/invoice date as YYYY-MM-DD. Use the purchase date, not the email date, when both exist."),
  total: NullableNumber.describe("Total amount actually paid including all taxes and tip."),
  subtotal: NullableNumber.describe("Pre-tax subtotal, if shown."),
  tax_total: NullableNumber.describe("Total of all sales taxes. If taxes are itemized, their sum."),
  gst: NullableNumber.describe("GST amount if shown separately."),
  hst: NullableNumber.describe("HST amount if shown separately."),
  pst: NullableNumber.describe("PST/RST amount if shown separately."),
  qst: NullableNumber.describe("QST amount if shown separately."),
  other_tax: NullableNumber.describe("Any other tax (e.g. US sales tax, VAT) if shown."),
  tip: NullableNumber.describe("Tip/gratuity if shown."),
  currency: z.string().describe("ISO 4217 currency code, e.g. CAD or USD."),
  category: z.enum(ALL_CATEGORY_NAMES as [string, ...string[]]).describe("Best-fit expense category from the list."),
  description: z.string().nullable().describe("One line describing what was purchased."),
  purpose: z.string().nullable().describe("Likely business purpose/reason for the expense in the context of running a medical aesthetics clinic, one short sentence. Null if unclear."),
  payment_method: z.string().nullable().describe("e.g. 'Visa ending 1234', 'PayPal', 'e-Transfer'. Null if unknown."),
  invoice_number: z.string().nullable().describe("Invoice, order or receipt number if present."),
  line_items: z
    .array(
      z.object({
        description: z.string(),
        quantity: NullableNumber,
        amount: NullableNumber.describe("Line total, if shown."),
      }),
    )
    .describe("Up to 25 line items. Empty if none are itemized."),
  confidence: z.number().describe("0 to 1: how confident you are that vendor, date, total and category are correct."),
  notes: z.string().nullable().describe("Anything the bookkeeper should know: unreadable amounts, partial payments, refunds, multiple receipts in one document, etc."),
});

function systemPrompt(): string {
  const practice = `${PRACTICE_NAME} (a physician's professional corporation in Ontario, Canada, covering a medical aesthetics clinic and the physician's other medical work such as residency teaching, conferences and memberships)`;
  return `You are a meticulous bookkeeper for ${practice}. You read receipts, invoices and order confirmations that were emailed to a dedicated receipts inbox or uploaded directly, and you extract the facts needed for the practice's accounting records.

Rules:
- Read every attached PDF and image carefully; they are the primary source. The email text is secondary context.
- Amounts are plain numbers with two decimals, never strings. Do not guess a total that is not visible; use null instead.
- The total is the amount actually paid (after tax, tip, discounts). If a document shows several payments, report the grand total and explain in notes.
- Canadian receipts show GST (5%), HST (13%/15%), PST/RST or QST. Record each one you see separately, and tax_total as their sum.
- Default currency is ${defaultCurrency()} unless the document clearly says otherwise (US$, USD, EUR...).
- Dates must be YYYY-MM-DD. Prefer the purchase/invoice date on the document over the email date.
- If the item is not a receipt or proof of purchase (security alert, newsletter, shipping notice without amounts, promotional email), set is_receipt=false and leave amounts null.
- Pick exactly one category from this list, or "${UNCATEGORIZED}" when none fits confidently:
${categoryPromptList()}
- Receipts are often forwarded or photographed by the physician: when the email is a forward ("Fwd:", "Begin forwarded message"), the vendor is the ORIGINAL sender/merchant named inside the forwarded text or document, never the person forwarding it.
- The email subject and any short note in the body are written by the physician and usually state the occasion (e.g. "Erie residency - dinner", "Conference parking"). Use them as the primary hint for purpose and category.
- purpose: infer the plausible business reason (e.g. "Neuromodulator stock for injectable treatments", "Monthly booking software subscription", "Dinner during Erie residency teaching trip") - keep it short and professional. Null if you cannot tell.`;
}

type ContentBlock = Anthropic.Messages.ContentBlockParam;

/**
 * Phone photos arrive at 3-5 MB; the API accepts 5 MB per image and reads text fine at ~2000px.
 * Downscale and re-encode as JPEG when the file is large. HEIC/HEIF are converted when the
 * installed sharp build supports them, otherwise skipped.
 */
async function prepareImage(f: { name: string; contentType: string; content: Buffer }): Promise<{ data: string; media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp" } | null> {
  const small = f.content.length <= 1.5 * 1024 * 1024;
  if (small && IMAGE_TYPES.has(f.contentType)) {
    return { data: f.content.toString("base64"), media_type: f.contentType as "image/jpeg" | "image/png" | "image/gif" | "image/webp" };
  }
  try {
    const sharp = (await import("sharp")).default;
    const out = await sharp(f.content, { failOn: "none" })
      .rotate() // honour EXIF orientation from phone cameras
      .resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
    if (out.length > MAX_IMAGE_BYTES) return null;
    return { data: out.toString("base64"), media_type: "image/jpeg" };
  } catch (err) {
    console.error(`Could not downscale ${f.name}:`, err instanceof Error ? err.message : err);
    if (IMAGE_TYPES.has(f.contentType) && f.content.length <= MAX_IMAGE_BYTES) {
      return { data: f.content.toString("base64"), media_type: f.contentType as "image/jpeg" | "image/png" | "image/gif" | "image/webp" };
    }
    return null;
  }
}

async function buildUserContent(input: ExtractInput, text: string): Promise<{ content: ContentBlock[]; attached: string[] }> {
  const content: ContentBlock[] = [];
  const attached: string[] = [];
  let pdfs = 0;
  let images = 0;

  for (const f of input.files) {
    if (f.contentType === "application/pdf" && pdfs < 3 && f.content.length <= MAX_PDF_BYTES) {
      content.push({
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: f.content.toString("base64") },
        title: f.name,
      });
      attached.push(f.name);
      pdfs++;
    } else if (f.contentType.startsWith("image/") && images < 6) {
      const img = await prepareImage(f);
      if (!img) continue;
      content.push({ type: "image", source: { type: "base64", media_type: img.media_type, data: img.data } });
      attached.push(f.name);
      images++;
    }
  }

  const header: string[] = [];
  if (input.source === "email") {
    header.push(`Source: email received ${input.receivedAt ?? "(unknown date)"}`);
    header.push(`From: ${input.fromName ? `${input.fromName} <${input.from}>` : input.from}`);
    header.push(`Subject: ${input.subject ?? ""}`);
  } else {
    header.push("Source: direct upload (no email context).");
  }
  if (attached.length) header.push(`Attached documents: ${attached.join(", ")}`);
  const body = text.length > MAX_TEXT_CHARS ? `${text.slice(0, MAX_TEXT_CHARS)}\n[...truncated]` : text;
  content.push({
    type: "text",
    text: `${header.join("\n")}\n\n--- Email / document text ---\n${body || "(no text body)"}\n\nExtract the receipt details.`,
  });
  return { content, attached };
}

function toFields(p: z.infer<typeof ReceiptSchema>): ReceiptFields {
  const currency = (p.currency || defaultCurrency()).toUpperCase().slice(0, 3);
  const num = (n: number | null) => (n === null || Number.isNaN(n) ? null : round2(n));
  const taxParts = [p.gst, p.hst, p.pst, p.qst, p.other_tax].filter((x): x is number => typeof x === "number");
  const tax = p.tax_total !== null ? num(p.tax_total) : taxParts.length ? round2(taxParts.reduce((a, b) => a + b, 0)) : null;
  return {
    vendor: p.vendor?.trim() || null,
    date: p.date && /^\d{4}-\d{2}-\d{2}$/.test(p.date) ? p.date : null,
    total: num(p.total),
    subtotal: num(p.subtotal),
    tax,
    taxBreakdown: { gst: num(p.gst), hst: num(p.hst), pst: num(p.pst), qst: num(p.qst), other: num(p.other_tax) },
    tip: num(p.tip),
    currency,
    category: isKnownCategory(p.category) ? p.category : UNCATEGORIZED,
    description: p.description?.trim() || null,
    purpose: p.purpose?.trim() || null,
    paymentMethod: p.payment_method?.trim() || null,
    invoiceNumber: p.invoice_number?.trim() || null,
    lineItems: (p.line_items ?? []).slice(0, 25).map((li) => ({
      description: li.description,
      quantity: li.quantity,
      amount: num(li.amount),
    })),
    fxRate: currency === "CAD" ? 1 : null,
    fxSource: null,
    totalCad: null,
    chargedCad: null,
  };
}

async function extractWithClaude(input: ExtractInput, text: string): Promise<ExtractOutput> {
  const client = new Anthropic();
  const model = claudeModel();
  const { content, attached } = await buildUserContent(input, text);
  if (attached.length === 0 && input.files.length > 0 && !text.trim()) {
    throw new Error("No readable attachment (unsupported image format or file too large)");
  }

  const response = await client.messages.parse({
    model,
    max_tokens: 4096,
    system: systemPrompt(),
    messages: [{ role: "user", content }],
    output_config: { format: zodOutputFormat(ReceiptSchema) },
  });

  if (response.stop_reason === "refusal") {
    throw new Error(`Claude declined to process this document${response.stop_details?.explanation ? `: ${response.stop_details.explanation}` : ""}`);
  }
  const parsed = response.parsed_output;
  if (!parsed) throw new Error("Claude returned no structured output");

  const fields = toFields(parsed);
  return {
    fields,
    info: {
      method: "claude",
      model,
      confidence: Math.max(0, Math.min(1, parsed.confidence)),
      isReceipt: parsed.is_receipt,
      notes: parsed.notes?.trim() || null,
      at: new Date().toISOString(),
    },
  };
}

// ---------- Heuristic fallback ----------

const AMOUNT = String.raw`(?:(?:C|US|CA)?\$|CAD|USD)?\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})|\d+\.\d{2})`;

function parseAmount(s: string): number {
  return Number(s.replace(/,/g, ""));
}

function findLabelled(text: string, labels: string): number | null {
  // Allow an optional rate such as "HST 13%" or "(5%)" between the label and the amount.
  const re = new RegExp(`(?:${labels})(?:\\s*\\(?\\d{1,2}(?:\\.\\d+)?\\s*%\\)?)?[^\\d$\\n]{0,40}${AMOUNT}`, "gi");
  let best: number | null = null;
  for (const m of text.matchAll(re)) {
    const v = parseAmount(m[1]);
    if (best === null || v > best) best = v;
  }
  return best;
}

function findDate(text: string): string | null {
  const iso = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const months = "jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec";
  const m1 = text.match(new RegExp(`\\b(${months})[a-z]*\\.?\\s+(\\d{1,2}),?\\s+(20\\d{2})`, "i"));
  const m2 = text.match(new RegExp(`\\b(\\d{1,2})\\s+(${months})[a-z]*\\.?,?\\s+(20\\d{2})`, "i"));
  const monIdx = (s: string) => ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(s.slice(0, 3).toLowerCase());
  if (m1) return `${m1[3]}-${String(monIdx(m1[1]) + 1).padStart(2, "0")}-${m1[2].padStart(2, "0")}`;
  if (m2) return `${m2[3]}-${String(monIdx(m2[2]) + 1).padStart(2, "0")}-${m2[1].padStart(2, "0")}`;
  const us = text.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/);
  if (us) return `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  return null;
}

function vendorFromSender(input: ExtractInput, text: string): string | null {
  const name = (input.fromName ?? "").replace(/\b(no-?reply|receipts?|billing|orders?|notifications?|team|support)\b/gi, "").replace(/[<>"]/g, "").trim();
  if (name && !/@/.test(name)) return name;
  const domain = (input.from ?? "").split("@")[1];
  if (!domain) {
    // Uploaded document: the first short line without digits is usually the merchant name.
    const first = text
      .split(/\r?\n/)
      .map((l) => l.replace(/^---.*---$/, "").trim())
      .find((l) => l.length >= 3 && l.length <= 40 && !/\d/.test(l) && !/^(receipt|invoice|tax invoice|order)$/i.test(l));
    return first ?? null;
  }
  const parts = domain.split(".").filter((p) => !["com", "ca", "net", "org", "co", "io", "mail", "email", "www"].includes(p));
  const core = parts[parts.length - 1] ?? domain;
  return core.charAt(0).toUpperCase() + core.slice(1);
}

function heuristicExtract(input: ExtractInput, text: string, reason: string | null): ExtractOutput {
  const hay = text;
  const total = findLabelled(hay, "grand total|order total|total charged|total paid|amount paid|amount due|balance due|total amount|total\\b|amount\\b|charged");
  const gst = findLabelled(hay, "gst|tps");
  const hst = findLabelled(hay, "hst");
  const pst = findLabelled(hay, "pst|rst");
  const qst = findLabelled(hay, "qst|tvq");
  const generic = !gst && !hst && !pst && !qst ? findLabelled(hay, "sales tax|tax\\b|taxes") : null;
  const parts = [gst, hst, pst, qst, generic].filter((x): x is number => typeof x === "number");
  const tax = parts.length ? round2(parts.reduce((a, b) => a + b, 0)) : null;
  const subtotal = findLabelled(hay, "subtotal|sub-total");
  const currency = /\bUSD\b|US\$/.test(hay) ? "USD" : /\bEUR\b|€/.test(hay) ? "EUR" : defaultCurrency();
  const vendor = vendorFromSender(input, hay);
  const date = findDate(hay) ?? (input.receivedAt ? input.receivedAt.slice(0, 10) : null);
  const invoice = hay.match(/(?:invoice|order|receipt)\s*(?:#|no\.?|number)?\s*[:#]?\s*((?=[A-Z0-9-]*\d)[A-Z0-9-]{4,})/i)?.[1] ?? null;
  const category = guessCategory(`${vendor ?? ""} ${input.subject ?? ""} ${hay.slice(0, 2000)}`);

  const fields: ReceiptFields = {
    ...emptyFields(currency),
    vendor,
    date,
    total: total !== null ? round2(total) : null,
    subtotal: subtotal !== null ? round2(subtotal) : null,
    tax,
    taxBreakdown: { gst, hst, pst, qst, other: generic },
    currency,
    category,
    description: input.subject?.trim() || null,
    invoiceNumber: invoice,
  };
  const isReceipt = total !== null;
  const notes = [reason, "Extracted with the regex fallback; please verify amounts."].filter(Boolean).join(" ");
  return {
    fields,
    info: {
      method: "heuristic",
      model: null,
      confidence: isReceipt ? (tax !== null ? 0.5 : 0.35) : 0.1,
      isReceipt,
      notes,
      at: new Date().toISOString(),
    },
  };
}

// ---------- Entry point ----------

export async function extractReceipt(input: ExtractInput): Promise<ExtractOutput> {
  let text = bodyText(input);
  const pdfTexts: string[] = [];
  for (const f of input.files) {
    if (f.contentType === "application/pdf") {
      const t = await pdfText(f.content);
      if (t) pdfTexts.push(`--- ${f.name} ---\n${t}`);
    }
  }
  const fullText = [text, ...pdfTexts].filter(Boolean).join("\n\n");

  if (!looksLikeReceipt(input, fullText)) {
    return {
      fields: emptyFields(defaultCurrency()),
      info: {
        method: "none",
        model: null,
        confidence: 0.9,
        isReceipt: false,
        notes: "No amounts, attachments or purchase keywords found; treated as not a receipt.",
        at: new Date().toISOString(),
      },
    };
  }

  if (claudeConfigured()) {
    try {
      // Claude reads PDFs natively; pass the email text plus any PDF text we could extract as context.
      return await extractWithClaude(input, fullText);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("Claude extraction failed:", msg);
      return heuristicExtract(input, fullText, `Claude extraction failed (${msg.slice(0, 160)}).`);
    }
  }
  text = fullText;
  return heuristicExtract(input, text, "ANTHROPIC_API_KEY not set.");
}

export const CATEGORY_OPTIONS = CATEGORY_NAMES;
