import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { claudeConfigured, claudeModel, pdfText } from "./extract";
import { round2 } from "./money";
import { Db, Receipt, Statement, StatementTransaction, effectiveFields, reportDate } from "./types";

// ---------- Parsing ----------

const TxSchema = z.object({
  account: z.string().nullable().describe("Card or account name, e.g. 'Amex Business Platinum ...1005'."),
  period_from: z.string().nullable().describe("Statement period start, YYYY-MM-DD."),
  period_to: z.string().nullable().describe("Statement period end / closing date, YYYY-MM-DD."),
  transactions: z
    .array(
      z.object({
        date: z.string().describe("Transaction date YYYY-MM-DD."),
        description: z.string().describe("Merchant / description exactly as printed."),
        amount: z.number().describe("Amount in CAD as it affects the balance: charges positive, payments and credits negative."),
        foreign_amount: z.number().nullable().describe("Original foreign amount if the line shows a currency conversion."),
        foreign_currency: z.string().nullable().describe("ISO code of the foreign currency if shown."),
        is_payment: z.boolean().describe("True for payments received, interest, fees or other non-purchase lines."),
      }),
    )
    .describe("Every transaction line on the statement."),
});

function parseDate(raw: string): string | null {
  const s = raw.trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})[ -]([A-Za-z]{3})[a-z]*\.?[ -](\d{4})$/);
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  if (m) {
    const mi = months.indexOf(m[2].slice(0, 3).toLowerCase());
    if (mi >= 0) return `${m[3]}-${String(mi + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  m = s.match(/^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m) {
    const mi = months.indexOf(m[1].slice(0, 3).toLowerCase());
    if (mi >= 0) return `${m[3]}-${String(mi + 1).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((x) => x.trim() !== ""));
}

function txId(): string {
  return `t_${Math.random().toString(36).slice(2, 10)}`;
}

/** Amex/most bank CSV exports: a header row with Date / Description / Amount columns. */
export function parseCsvStatement(text: string): { transactions: StatementTransaction[]; account: string | null } | null {
  const rows = parseCsvRows(text.replace(/^﻿/, ""));
  if (rows.length < 2) return null;
  const headerIdx = rows.findIndex((r) => r.some((c) => /date/i.test(c)) && r.some((c) => /amount/i.test(c)));
  if (headerIdx < 0) return null;
  const header = rows[headerIdx].map((h) => h.trim().toLowerCase());
  const col = (re: RegExp) => header.findIndex((h) => re.test(h));
  const iDate = col(/^date$|transaction date|^date\b/);
  const iDesc = col(/description|merchant|payee|details/);
  const iAmt = col(/^amount$|amount \(cad\)|^amount\b/);
  const iAcct = col(/account/);
  const iFx = col(/foreign|original amount|extended/);
  if (iDate < 0 || iAmt < 0) return null;

  const transactions: StatementTransaction[] = [];
  let account: string | null = null;
  for (const r of rows.slice(headerIdx + 1)) {
    const date = parseDate(r[iDate] ?? "");
    const amtRaw = (r[iAmt] ?? "").replace(/[^0-9.\-()]/g, "");
    if (!date || !amtRaw) continue;
    const negative = /^\(.*\)$/.test(amtRaw);
    const amount = round2(Number(amtRaw.replace(/[()]/g, "")) * (negative ? -1 : 1));
    if (!Number.isFinite(amount)) continue;
    const description = (iDesc >= 0 ? r[iDesc] : "")?.replace(/\s+/g, " ").trim() ?? "";
    if (iAcct >= 0 && !account && r[iAcct]) account = r[iAcct].trim();
    let foreignAmount: number | null = null;
    let foreignCurrency: string | null = null;
    const fxText = iFx >= 0 ? r[iFx] ?? "" : description;
    const fm = fxText.match(/([A-Z]{3})\s*\$?\s*([\d,]+\.\d{2})|([\d,]+\.\d{2})\s*([A-Z]{3})\b/);
    if (fm) {
      const cur = (fm[1] || fm[4] || "").toUpperCase();
      const val = Number((fm[2] || fm[3] || "").replace(/,/g, ""));
      if (cur && cur !== "CAD" && Number.isFinite(val)) {
        foreignAmount = round2(val);
        foreignCurrency = cur;
      }
    }
    transactions.push({
      id: txId(),
      date,
      description,
      amount,
      foreignAmount,
      foreignCurrency,
      matchedReceiptId: null,
      ignored: amount < 0 || /^payment|thank you|autopay/i.test(description),
    });
  }
  return transactions.length ? { transactions, account } : null;
}

export async function parseStatementWithClaude(input: { name: string; contentType: string; content: Buffer }): Promise<{
  transactions: StatementTransaction[];
  account: string | null;
  periodFrom: string | null;
  periodTo: string | null;
}> {
  const client = new Anthropic();
  const content: Anthropic.Messages.ContentBlockParam[] = [];
  if (input.contentType === "application/pdf") {
    content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: input.content.toString("base64") }, title: input.name });
  } else {
    content.push({ type: "text", text: `--- ${input.name} ---\n${input.content.toString("utf8").slice(0, 60000)}` });
  }
  content.push({
    type: "text",
    text: "This is a credit-card statement for a Canadian practice. List every transaction line. Amounts are CAD as they affect the balance (charges positive, payments/credits negative). When a line shows a foreign amount and conversion, capture it.",
  });
  const response = await client.messages.parse({
    model: claudeModel(),
    max_tokens: 16000,
    system: "You transcribe credit-card statements into structured data for bookkeeping. Be exhaustive and exact; never invent lines.",
    messages: [{ role: "user", content }],
    output_config: { format: zodOutputFormat(TxSchema) },
  });
  if (response.stop_reason === "refusal") throw new Error("Claude declined to read the statement");
  const parsed = response.parsed_output;
  if (!parsed) throw new Error("Claude returned no structured output for the statement");
  return {
    account: parsed.account,
    periodFrom: parsed.period_from && /^\d{4}-\d{2}-\d{2}$/.test(parsed.period_from) ? parsed.period_from : null,
    periodTo: parsed.period_to && /^\d{4}-\d{2}-\d{2}$/.test(parsed.period_to) ? parsed.period_to : null,
    transactions: parsed.transactions
      .filter((t) => /^\d{4}-\d{2}-\d{2}$/.test(t.date))
      .map((t) => ({
        id: txId(),
        date: t.date,
        description: t.description.replace(/\s+/g, " ").trim(),
        amount: round2(t.amount),
        foreignAmount: t.foreign_amount === null ? null : round2(t.foreign_amount),
        foreignCurrency: t.foreign_currency ? t.foreign_currency.toUpperCase().slice(0, 3) : null,
        matchedReceiptId: null,
        ignored: t.is_payment || t.amount < 0,
      })),
  };
}

export async function parseStatementFile(file: { name: string; contentType: string; content: Buffer }): Promise<{
  transactions: StatementTransaction[];
  account: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  parser: Statement["parser"];
  notes: string | null;
}> {
  const isCsv = /\.csv$/i.test(file.name) || file.contentType === "text/csv";
  if (isCsv) {
    const csv = parseCsvStatement(file.content.toString("utf8"));
    if (csv) return { ...csv, periodFrom: null, periodTo: null, parser: "csv", notes: null };
  }
  if (claudeConfigured()) {
    const res = await parseStatementWithClaude(file);
    return { ...res, parser: "claude", notes: null };
  }
  // No AI: try the PDF text through the CSV-ish parser as a last resort.
  if (file.contentType === "application/pdf") {
    const text = await pdfText(file.content);
    const csv = parseCsvStatement(text);
    if (csv) return { ...csv, periodFrom: null, periodTo: null, parser: "csv", notes: "Parsed from PDF text without AI; check carefully." };
  }
  return { transactions: [], account: null, periodFrom: null, periodTo: null, parser: "none", notes: "Could not parse this file. Upload the CSV export, or add ANTHROPIC_API_KEY so PDFs can be read." };
}

// ---------- Matching ----------

function daysBetween(a: string, b: string): number {
  return Math.abs((new Date(`${a}T12:00:00Z`).getTime() - new Date(`${b}T12:00:00Z`).getTime()) / 86400000);
}

function tokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 3 && !["the", "inc", "ltd", "llc", "com", "www", "corp", "and"].includes(t)),
  );
}

function vendorOverlap(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.size || !tb.size) return 0;
  let hit = 0;
  for (const t of ta) if (tb.has(t) || [...tb].some((x) => x.startsWith(t) || t.startsWith(x))) hit++;
  return hit / Math.min(ta.size, tb.size);
}

export interface MatchSummary {
  matched: number;
  unmatchedCharges: number;
  alreadyMatched: number;
}

/**
 * Pair statement charges with receipts. A CAD receipt must match the charge to the cent within
 * 5 days; a foreign receipt must land within 4.5% of (receipt total × Bank of Canada rate),
 * which covers the card's ~2.5% conversion fee, within 7 days. Vendor words break ties.
 * A match stamps the receipt with the CAD amount actually charged.
 */
export function matchStatement(db: Db, st: Statement): MatchSummary {
  const summary: MatchSummary = { matched: 0, unmatchedCharges: 0, alreadyMatched: 0 };
  const takenReceipts = new Set<string>();
  for (const s of Object.values(db.statements)) for (const t of s.transactions) if (t.matchedReceiptId) takenReceipts.add(t.matchedReceiptId);

  const receipts = Object.values(db.receipts).filter((r) => r.status !== "ignored" && effectiveFields(r).total !== null);

  for (const tx of st.transactions) {
    if (tx.ignored) continue;
    if (tx.matchedReceiptId && db.receipts[tx.matchedReceiptId]) {
      summary.alreadyMatched++;
      continue;
    }
    let best: { r: Receipt; score: number } | null = null;
    for (const r of receipts) {
      if (takenReceipts.has(r.id)) continue;
      const f = effectiveFields(r);
      const total = f.total!;
      const date = reportDate(r);
      const gap = daysBetween(date, tx.date);
      let amountScore = 0;
      if (f.currency === "CAD") {
        if (Math.abs(total - tx.amount) <= 0.01 && gap <= 5) amountScore = 1;
      } else if (tx.foreignAmount !== null && tx.foreignCurrency === f.currency) {
        if (Math.abs(total - tx.foreignAmount) <= 0.01 && gap <= 7) amountScore = 1;
      } else if (f.fxRate !== null) {
        const expected = total * f.fxRate;
        const diff = Math.abs(tx.amount - expected) / Math.max(expected, 0.01);
        if (diff <= 0.045 && gap <= 7) amountScore = 1 - diff;
      }
      if (amountScore === 0) continue;
      const score = amountScore * 10 + vendorOverlap(f.vendor ?? "", tx.description) * 3 - gap * 0.2;
      if (!best || score > best.score) best = { r, score };
    }
    if (best) {
      tx.matchedReceiptId = best.r.id;
      takenReceipts.add(best.r.id);
      const r = best.r;
      r.match = { statementId: st.id, transactionId: tx.id };
      // Reports stay on the Bank of Canada rate; the card's actual CAD charge is kept for reference.
      r.overrides = { ...r.overrides, chargedCad: tx.amount };
      r.updatedAt = new Date().toISOString();
      summary.matched++;
    } else {
      summary.unmatchedCharges++;
    }
  }
  return summary;
}

/** Undo a match (keeps the receipt, clears the recorded card charge). */
export function unmatch(db: Db, st: Statement, tx: StatementTransaction): void {
  if (tx.matchedReceiptId) {
    const r = db.receipts[tx.matchedReceiptId];
    if (r) {
      r.match = null;
      const { chargedCad: _c, ...rest } = r.overrides;
      r.overrides = rest;
      r.updatedAt = new Date().toISOString();
    }
  }
  tx.matchedReceiptId = null;
}

export function receiptsWithoutCharge(db: Db): Receipt[] {
  const matched = new Set<string>();
  for (const s of Object.values(db.statements)) for (const t of s.transactions) if (t.matchedReceiptId) matched.add(t.matchedReceiptId);
  return Object.values(db.receipts).filter((r) => r.status !== "ignored" && effectiveFields(r).total !== null && !matched.has(r.id));
}
