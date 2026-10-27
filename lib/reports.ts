import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { Receipt, ReceiptFields, effectiveFields, reportDate, toCad } from "./types";
import { Period, fmtDate, inPeriod, round2 } from "./money";

export interface ReportRow {
  id: string;
  date: string;
  vendor: string;
  category: string;
  description: string;
  purpose: string;
  subtotal: number | null;
  tax: number | null;
  gst: number | null;
  hst: number | null;
  pst: number | null;
  qst: number | null;
  otherTax: number | null;
  tip: number | null;
  /** All money columns are CAD. */
  total: number;
  currency: string;
  /** Original amount in the receipt's own currency (same as total for CAD). */
  totalOriginal: number;
  fxRate: number | null;
  fxSource: string | null;
  chargedCad: number | null;
  /** True when a foreign receipt still has no rate: it is excluded from CAD totals. */
  unconverted: boolean;
  paymentMethod: string;
  invoiceNumber: string;
  source: string;
  status: string;
  note: string;
}

export interface CategoryTotal {
  category: string;
  count: number;
  subtotal: number;
  tax: number;
  total: number;
}

export interface VendorTotal {
  vendor: string;
  count: number;
  total: number;
}

export interface MonthTotal {
  month: string; // YYYY-MM
  label: string;
  count: number;
  total: number;
}

export interface TaxSummary {
  gst: number;
  hst: number;
  pst: number;
  qst: number;
  other: number;
  total: number;
  /** Receipts with a total but no tax breakdown at all. */
  untaxedCount: number;
}

export interface Summary {
  period: Period;
  rows: ReportRow[];
  count: number;
  total: number;
  subtotal: number;
  tax: number;
  byCategory: CategoryTotal[];
  byVendor: VendorTotal[];
  byMonth: MonthTotal[];
  taxes: TaxSummary;
  currencies: string[];
  /** Foreign receipts that have no CAD figure yet (not included in totals). */
  unconvertedCount: number;
  foreignCount: number;
}

/** Receipts that count as expenses: not ignored, with a total. */
export function expenseReceipts(all: Receipt[]): Receipt[] {
  return all.filter((r) => r.status !== "ignored" && effectiveFields(r).total !== null);
}

export function toRow(r: Receipt): ReportRow {
  const f: ReceiptFields = effectiveFields(r);
  const foreign = f.currency !== "CAD";
  const unconverted = foreign && f.totalCad === null;
  // Foreign sales taxes are not Canadian ITCs; they are reported under "other tax".
  const cadTax = toCad(f, f.tax);
  return {
    id: r.id,
    date: reportDate(r),
    vendor: f.vendor ?? "",
    category: f.category,
    description: f.description ?? "",
    purpose: f.purpose ?? "",
    subtotal: toCad(f, f.subtotal),
    tax: cadTax,
    gst: foreign ? null : f.taxBreakdown?.gst ?? null,
    hst: foreign ? null : f.taxBreakdown?.hst ?? null,
    pst: foreign ? null : f.taxBreakdown?.pst ?? null,
    qst: foreign ? null : f.taxBreakdown?.qst ?? null,
    otherTax: foreign ? cadTax : f.taxBreakdown?.other ?? null,
    tip: toCad(f, f.tip),
    total: f.totalCad ?? 0,
    currency: f.currency,
    totalOriginal: f.total ?? 0,
    fxRate: f.fxRate,
    fxSource: f.fxSource,
    chargedCad: f.chargedCad,
    unconverted,
    paymentMethod: f.paymentMethod ?? "",
    invoiceNumber: f.invoiceNumber ?? "",
    source: r.source,
    status: r.status,
    note: r.note ?? "",
  };
}

export function summarize(all: Receipt[], period: Period, category?: string): Summary {
  const rows = expenseReceipts(all)
    .map(toRow)
    .filter((row) => inPeriod(row.date, period))
    .filter((row) => !category || row.category === category)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  const cat = new Map<string, CategoryTotal>();
  const ven = new Map<string, VendorTotal>();
  const mon = new Map<string, MonthTotal>();
  const taxes: TaxSummary = { gst: 0, hst: 0, pst: 0, qst: 0, other: 0, total: 0, untaxedCount: 0 };
  let total = 0;
  let subtotal = 0;
  let tax = 0;
  const currencies = new Set<string>();
  let unconvertedCount = 0;
  let foreignCount = 0;

  for (const row of rows) {
    if (row.currency !== "CAD") foreignCount++;
    if (row.unconverted) {
      unconvertedCount++;
      continue;
    }
    total += row.total;
    subtotal += row.subtotal ?? (row.total - (row.tax ?? 0) - (row.tip ?? 0));
    tax += row.tax ?? 0;
    currencies.add(row.currency);

    const c = cat.get(row.category) ?? { category: row.category, count: 0, subtotal: 0, tax: 0, total: 0 };
    c.count++;
    c.total += row.total;
    c.tax += row.tax ?? 0;
    c.subtotal += row.subtotal ?? (row.total - (row.tax ?? 0) - (row.tip ?? 0));
    cat.set(row.category, c);

    const vendorKey = row.vendor || "(unknown vendor)";
    const v = ven.get(vendorKey) ?? { vendor: vendorKey, count: 0, total: 0 };
    v.count++;
    v.total += row.total;
    ven.set(vendorKey, v);

    const ym = row.date.slice(0, 7);
    const m = mon.get(ym) ?? {
      month: ym,
      label: new Date(`${ym}-01T12:00:00`).toLocaleDateString("en-CA", { month: "short", year: "numeric" }),
      count: 0,
      total: 0,
    };
    m.count++;
    m.total += row.total;
    mon.set(ym, m);

    taxes.gst += row.gst ?? 0;
    taxes.hst += row.hst ?? 0;
    taxes.pst += row.pst ?? 0;
    taxes.qst += row.qst ?? 0;
    taxes.other += row.otherTax ?? 0;
    if (row.tax === null) taxes.untaxedCount++;
  }
  taxes.total = round2(tax);
  taxes.gst = round2(taxes.gst);
  taxes.hst = round2(taxes.hst);
  taxes.pst = round2(taxes.pst);
  taxes.qst = round2(taxes.qst);
  taxes.other = round2(taxes.other);

  const r2 = <T extends { total: number }>(x: T): T => ({ ...x, total: round2(x.total) });

  return {
    period,
    rows,
    count: rows.length,
    total: round2(total),
    subtotal: round2(subtotal),
    tax: round2(tax),
    byCategory: [...cat.values()].map((c) => ({ ...c, subtotal: round2(c.subtotal), tax: round2(c.tax), total: round2(c.total) })).sort((a, b) => b.total - a.total),
    byVendor: [...ven.values()].map(r2).sort((a, b) => b.total - a.total),
    byMonth: [...mon.values()].map(r2).sort((a, b) => (a.month < b.month ? -1 : 1)),
    taxes,
    currencies: [...currencies],
    unconvertedCount,
    foreignCount,
  };
}

// ---------- CSV ----------

function csvCell(v: string | number | null, decimals = 2): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "number" ? v.toFixed(decimals) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function detailCsv(summary: Summary): string {
  const header = [
    "Date", "Vendor", "Category", "Description", "Business purpose", "Subtotal (CAD)", "GST", "HST", "PST", "QST", "Other tax (CAD)", "Total tax (CAD)", "Tip (CAD)", "Total (CAD)", "Original currency", "Original total", "FX rate (Bank of Canada)", "FX source", "Card charged (CAD)", "Payment method", "Invoice #", "Source", "Status", "Note", "Receipt ID",
  ];
  const lines = [header.join(",")];
  for (const r of summary.rows) {
    lines.push(
      [
        r.date, r.vendor, r.category, r.description, r.purpose, r.subtotal, r.gst, r.hst, r.pst, r.qst, r.otherTax, r.tax, r.tip, r.unconverted ? null : r.total, r.currency, r.totalOriginal, csvCell(r.fxRate, 4), r.fxSource ?? "", r.chargedCad, r.paymentMethod, r.invoiceNumber, r.source, r.status, r.note, r.id,
      ]
        .map((v) => csvCell(v))
        .join(","),
    );
  }
  return lines.join("\r\n") + "\r\n";
}

// ---------- PDF ----------

// Orilume MD marine palette
const hex = (h: string) => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
const GOLD = hex("#16303B"); // marine: headings, total rows
const INK = hex("#2B2B2B"); // graphite
const MUTED = hex("#5A6066"); // slate
const RULE = hex("#D8D9D4"); // pewter
const CREAM = hex("#F4F3EF"); // porcelain: zebra rows, tiles
const HEAD = hex("#E3E9EC"); // glacier: table headers

function money(n: number | null, currency = "CAD"): string {
  if (n === null || n === undefined) return "—";
  const sym = currency === "USD" ? "US$" : currency === "EUR" ? "€" : "$";
  return `${n < 0 ? "-" : ""}${sym}${Math.abs(n).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

interface Col {
  key: string;
  label: string;
  width: number;
  align?: "left" | "right";
}

class PdfWriter {
  doc!: PDFDocument;
  page!: PDFPage;
  font!: PDFFont;
  bold!: PDFFont;
  y = 0;
  readonly margin = 40;
  readonly width = 612;
  readonly height = 792;
  pageNo = 0;
  footer = "";

  static async create(footer: string): Promise<PdfWriter> {
    const w = new PdfWriter();
    w.doc = await PDFDocument.create();
    w.font = await w.doc.embedFont(StandardFonts.Helvetica);
    w.bold = await w.doc.embedFont(StandardFonts.HelveticaBold);
    w.footer = footer;
    w.newPage();
    return w;
  }

  newPage() {
    this.page = this.doc.addPage([this.width, this.height]);
    this.pageNo++;
    this.y = this.height - this.margin;
    this.page.drawText(this.footer, { x: this.margin, y: 22, size: 8, font: this.font, color: MUTED });
    const pn = `Page ${this.pageNo}`;
    this.page.drawText(pn, { x: this.width - this.margin - this.font.widthOfTextAtSize(pn, 8), y: 22, size: 8, font: this.font, color: MUTED });
  }

  ensure(h: number) {
    if (this.y - h < this.margin + 10) this.newPage();
  }

  text(s: string, opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; x?: number; gap?: number } = {}) {
    const size = opts.size ?? 10;
    this.ensure(size + 6);
    this.page.drawText(s, { x: opts.x ?? this.margin, y: this.y - size, size, font: opts.bold ? this.bold : this.font, color: opts.color ?? INK });
    this.y -= size + (opts.gap ?? 6);
  }

  rule(color = RULE, thickness = 1) {
    this.page.drawLine({ start: { x: this.margin, y: this.y }, end: { x: this.width - this.margin, y: this.y }, thickness, color });
    this.y -= 8;
  }

  space(h: number) {
    this.y -= h;
  }

  fit(s: string, width: number, size: number, font: PDFFont): string {
    if (font.widthOfTextAtSize(s, size) <= width) return s;
    let t = s;
    while (t.length > 1 && font.widthOfTextAtSize(`${t}…`, size) > width) t = t.slice(0, -1);
    return `${t}…`;
  }

  table(cols: Col[], rows: Record<string, string>[], opts: { size?: number; zebra?: boolean; totalRow?: Record<string, string> } = {}) {
    const size = opts.size ?? 8.5;
    const rowH = size + 8;
    const x0 = this.margin;
    const drawHeader = () => {
      this.ensure(rowH * 2);
      this.page.drawRectangle({ x: x0, y: this.y - rowH, width: this.width - 2 * this.margin, height: rowH, color: HEAD });
      let x = x0;
      for (const c of cols) {
        const label = c.label.toUpperCase();
        const tx = c.align === "right" ? x + c.width - 4 - this.bold.widthOfTextAtSize(label, size - 1.5) : x + 4;
        this.page.drawText(label, { x: tx, y: this.y - rowH + 5, size: size - 1.5, font: this.bold, color: GOLD });
        x += c.width;
      }
      this.y -= rowH;
    };
    drawHeader();
    rows.forEach((row, i) => {
      if (this.y - rowH < this.margin + 10) {
        this.newPage();
        drawHeader();
      }
      if (opts.zebra && i % 2 === 1) {
        this.page.drawRectangle({ x: x0, y: this.y - rowH, width: this.width - 2 * this.margin, height: rowH, color: CREAM });
      }
      let x = x0;
      for (const c of cols) {
        const raw = row[c.key] ?? "";
        const txt = this.fit(raw, c.width - 8, size, this.font);
        const tx = c.align === "right" ? x + c.width - 4 - this.font.widthOfTextAtSize(txt, size) : x + 4;
        this.page.drawText(txt, { x: tx, y: this.y - rowH + 5, size, font: this.font, color: INK });
        x += c.width;
      }
      this.page.drawLine({ start: { x: x0, y: this.y - rowH }, end: { x: this.width - this.margin, y: this.y - rowH }, thickness: 0.5, color: rgb(0.93, 0.93, 0.93) });
      this.y -= rowH;
    });
    if (opts.totalRow) {
      this.ensure(rowH);
      this.page.drawRectangle({ x: x0, y: this.y - rowH, width: this.width - 2 * this.margin, height: rowH, color: GOLD });
      let x = x0;
      for (const c of cols) {
        const raw = opts.totalRow[c.key] ?? "";
        const txt = this.fit(raw, c.width - 8, size, this.bold);
        const tx = c.align === "right" ? x + c.width - 4 - this.bold.widthOfTextAtSize(txt, size) : x + 4;
        this.page.drawText(txt, { x: tx, y: this.y - rowH + 5, size, font: this.bold, color: rgb(1, 1, 1) });
        x += c.width;
      }
      this.y -= rowH;
    }
    this.space(10);
  }
}

export async function statementPdf(summary: Summary, opts: { practice: string; includeDetail: boolean; includeTax: boolean }): Promise<Uint8Array> {
  const generated = new Date().toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" });
  const w = await PdfWriter.create(`${opts.practice} · Expense statement · ${summary.period.label} · generated ${generated}`);
  const cur = "CAD";

  // Header
  w.text(opts.practice, { size: 16, bold: true, color: GOLD, gap: 2 });
  w.text("EXPENSE STATEMENT", { size: 9, color: MUTED, gap: 2 });
  w.text(`Period: ${summary.period.label}   ·   Generated ${generated}`, { size: 9, color: MUTED, gap: 8 });
  w.rule(GOLD, 1.5);
  w.space(6);

  // Totals
  const tiles: [string, string][] = [
    ["Total expenses", money(summary.total, cur)],
    ["Before tax", money(summary.subtotal, cur)],
    ["Sales tax paid", money(summary.tax, cur)],
    ["Receipts", String(summary.count)],
  ];
  const tileW = (w.width - 2 * w.margin - 3 * 10) / 4;
  w.ensure(54);
  tiles.forEach(([label, value], i) => {
    const x = w.margin + i * (tileW + 10);
    w.page.drawRectangle({ x, y: w.y - 50, width: tileW, height: 50, color: i === 0 ? GOLD : CREAM, borderColor: RULE, borderWidth: i === 0 ? 0 : 1 });
    w.page.drawText(label.toUpperCase(), { x: x + 10, y: w.y - 18, size: 7, font: w.font, color: i === 0 ? rgb(1, 1, 1) : MUTED });
    w.page.drawText(value, { x: x + 10, y: w.y - 40, size: 14, font: w.bold, color: i === 0 ? rgb(1, 1, 1) : INK });
  });
  w.y -= 66;
  if (summary.foreignCount > 0) {
    w.text(
      `All amounts in CAD. ${summary.foreignCount} foreign-currency receipt${summary.foreignCount === 1 ? "" : "s"} converted at the Bank of Canada daily rate for the receipt date.${summary.unconvertedCount ? ` ${summary.unconvertedCount} still unconverted and excluded.` : ""}`,
      { size: 8, color: MUTED },
    );
  }

  // By category
  w.text("Expenses by category", { size: 11, bold: true, color: GOLD, gap: 6 });
  w.table(
    [
      { key: "category", label: "Category", width: 232 },
      { key: "count", label: "Receipts", width: 60, align: "right" },
      { key: "subtotal", label: "Before tax", width: 80, align: "right" },
      { key: "tax", label: "Tax", width: 80, align: "right" },
      { key: "total", label: "Total", width: 80, align: "right" },
    ],
    summary.byCategory.map((c) => ({ category: c.category, count: String(c.count), subtotal: money(c.subtotal, cur), tax: money(c.tax, cur), total: money(c.total, cur) })),
    { zebra: true, totalRow: { category: "Total", count: String(summary.count), subtotal: money(summary.subtotal, cur), tax: money(summary.tax, cur), total: money(summary.total, cur) } },
  );

  if (opts.includeTax) {
    w.text("Sales tax summary (input tax credits)", { size: 11, bold: true, color: GOLD, gap: 6 });
    const t = summary.taxes;
    w.table(
      [
        { key: "k", label: "Tax", width: 352 },
        { key: "v", label: "Amount", width: 180, align: "right" },
      ],
      [
        { k: "GST", v: money(t.gst, cur) },
        { k: "HST", v: money(t.hst, cur) },
        { k: "PST / RST", v: money(t.pst, cur) },
        { k: "QST", v: money(t.qst, cur) },
        { k: "Other tax", v: money(t.other, cur) },
      ].filter((r) => r.v !== money(0, cur)),
      { totalRow: { k: `Total sales tax${t.untaxedCount ? `  (${t.untaxedCount} receipt${t.untaxedCount === 1 ? "" : "s"} without tax detail)` : ""}`, v: money(t.total, cur) } },
    );
  }

  // By vendor (top 15)
  w.text("Top vendors", { size: 11, bold: true, color: GOLD, gap: 6 });
  w.table(
    [
      { key: "vendor", label: "Vendor", width: 372 },
      { key: "count", label: "Receipts", width: 80, align: "right" },
      { key: "total", label: "Total", width: 80, align: "right" },
    ],
    summary.byVendor.slice(0, 15).map((v) => ({ vendor: v.vendor, count: String(v.count), total: money(v.total, cur) })),
    { zebra: true },
  );

  if (opts.includeDetail) {
    w.newPage();
    w.text("Receipt detail", { size: 11, bold: true, color: GOLD, gap: 6 });
    w.table(
      [
        { key: "date", label: "Date", width: 62 },
        { key: "vendor", label: "Vendor", width: 118 },
        { key: "category", label: "Category", width: 112 },
        { key: "description", label: "Description", width: 112 },
        { key: "tax", label: "Tax", width: 58, align: "right" },
        { key: "total", label: "Total", width: 70, align: "right" },
      ],
      summary.rows.map((r) => ({
        date: r.date,
        vendor: r.vendor || "(unknown)",
        category: r.category,
        description: r.currency !== "CAD" ? `${r.description || r.purpose} (${r.currency} ${r.totalOriginal.toFixed(2)})` : r.description || r.purpose,
        tax: money(r.tax, cur),
        total: r.unconverted ? "unconverted" : money(r.total, cur),
      })),
      { zebra: true, size: 8, totalRow: { date: "Total", vendor: `${summary.count} receipts`, tax: money(summary.tax, cur), total: money(summary.total, cur) } },
    );
  }

  return w.doc.save();
}
