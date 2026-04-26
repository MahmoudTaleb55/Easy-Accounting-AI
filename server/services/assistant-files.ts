/* eslint-disable @typescript-eslint/no-explicit-any */
import PDFDocument from "pdfkit";
import {
  type Locale,
  t,
  dirFor,
  accountType,
  pickName,
  formatLocaleDate,
} from "../i18n/pdf-strings";
import ExcelJS from "exceljs";
import { randomUUID } from "crypto";
import type { Account } from "@shared/schema";
import type { JournalEntryWithLines } from "../storage";
import {
  containsArabic,
  fontFor,
  prepareArabicForPdf,
  registerArabicFonts,
} from "./pdf-arabic";

/* ────────────────────────────────────────────────────────────────────────── */
/*  In-memory file store — short-lived, served by /api/files/:id/download    */
/* ────────────────────────────────────────────────────────────────────────── */

type StoredFile = {
  id: string;
  companyId: number;
  filename: string;
  mime: string;
  buffer: Buffer;
  createdAt: number;
};

const FILES = new Map<string, StoredFile>();
const FILE_TTL_MS = 60 * 60 * 1000; // 1 hour

function gc() {
  const now = Date.now();
  FILES.forEach((v, k) => {
    if (now - v.createdAt > FILE_TTL_MS) FILES.delete(k);
  });
}

export function storeFile(opts: {
  companyId: number;
  filename: string;
  mime: string;
  buffer: Buffer;
}) {
  gc();
  const id = randomUUID();
  FILES.set(id, { id, ...opts, createdAt: Date.now() });
  return { id, filename: opts.filename, mime: opts.mime, sizeKB: Math.ceil(opts.buffer.length / 1024) };
}

export function readFile(id: string, companyId: number) {
  const f = FILES.get(id);
  if (!f || f.companyId !== companyId) return null;
  return f;
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Report data shaping — Trial Balance, P&L, Balance Sheet                  */
/* ────────────────────────────────────────────────────────────────────────── */

type Row = { code: string; nameAr: string; nameEn?: string; type: string; debit: number; credit: number; balance: number };

export function buildTrialBalance(accounts: Account[], entries: JournalEntryWithLines[]): {
  rows: Row[]; totalDebit: number; totalCredit: number;
} {
  const debitMap = new Map<number, number>();
  const creditMap = new Map<number, number>();
  for (const je of entries) {
    for (const l of je.lines) {
      debitMap.set(l.accountId, (debitMap.get(l.accountId) || 0) + Number(l.debit || 0));
      creditMap.set(l.accountId, (creditMap.get(l.accountId) || 0) + Number(l.credit || 0));
    }
  }
  const rows: Row[] = accounts
    .filter((a) => !a.isHeader)
    .map((a) => {
      const debit = debitMap.get(a.id) || 0;
      const credit = creditMap.get(a.id) || 0;
      const isDebitNormal = a.type === "asset" || a.type === "expense";
      const balance = isDebitNormal ? debit - credit : credit - debit;
      return {
        code: a.code, nameAr: a.nameAr, nameEn: (a as any).nameEn ?? undefined,
        type: a.type, debit, credit, balance,
      };
    })
    .filter((r) => r.debit !== 0 || r.credit !== 0)
    .sort((a, b) => a.code.localeCompare(b.code));

  return {
    rows,
    totalDebit: rows.reduce((s, r) => s + r.debit, 0),
    totalCredit: rows.reduce((s, r) => s + r.credit, 0),
  };
}

export function buildProfitLoss(accounts: Account[], entries: JournalEntryWithLines[]) {
  const tb = buildTrialBalance(accounts, entries);
  const revenue = tb.rows.filter((r) => r.type === "revenue");
  const expenses = tb.rows.filter((r) => r.type === "expense");
  const totalRevenue = revenue.reduce((s, r) => s + r.balance, 0);
  const totalExpenses = expenses.reduce((s, r) => s + r.balance, 0);
  return {
    revenue, expenses, totalRevenue, totalExpenses,
    netIncome: totalRevenue - totalExpenses,
  };
}

export function buildBalanceSheet(accounts: Account[], entries: JournalEntryWithLines[]) {
  const tb = buildTrialBalance(accounts, entries);
  const get = (predicate: (r: Row) => boolean) => tb.rows.filter(predicate);
  const assets = get((r) => r.type === "asset");
  const liabilities = get((r) => r.type === "liability");
  const equity = get((r) => r.type === "equity");
  const pl = buildProfitLoss(accounts, entries);
  const totalAssets = assets.reduce((s, r) => s + r.balance, 0);
  const totalLiabilities = liabilities.reduce((s, r) => s + r.balance, 0);
  const totalEquityRaw = equity.reduce((s, r) => s + r.balance, 0);
  const totalEquity = totalEquityRaw + pl.netIncome;
  return {
    assets, liabilities, equity,
    netIncome: pl.netIncome,
    totalAssets, totalLiabilities, totalEquity,
  };
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Excel generation — full UTF-8, RTL aware, Arabic names supported         */
/* ────────────────────────────────────────────────────────────────────────── */

const fmtMoney = (currency: string) => `_-* #,##0.00\\ "${currency}"_-;-* #,##0.00\\ "${currency}"_-;_-* "-"??\\ "${currency}"_-;_-@_-`;

function applyHeader(ws: ExcelJS.Worksheet, titleAr: string, titleEn: string, currency: string) {
  ws.views = [{ rightToLeft: true }];
  ws.mergeCells("A1:E1");
  const titleCell = ws.getCell("A1");
  titleCell.value = titleAr;
  titleCell.font = { name: "Calibri", size: 16, bold: true };
  titleCell.alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(1).height = 26;
  ws.mergeCells("A2:E2");
  const subtitle = ws.getCell("A2");
  subtitle.value = `${titleEn} · ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })} · ${currency}`;
  subtitle.font = { size: 10, color: { argb: "FF6B7280" } };
  subtitle.alignment = { horizontal: "center" };
  ws.addRow([]);
}

function styleHeaderRow(row: ExcelJS.Row) {
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF065F46" } };
    cell.alignment = { vertical: "middle", horizontal: "center" };
    cell.border = { bottom: { style: "thin", color: { argb: "FF065F46" } } };
  });
  row.height = 22;
}

export async function generateTrialBalanceExcel(
  accounts: Account[], entries: JournalEntryWithLines[], currency = "USD"
): Promise<Buffer> {
  const tb = buildTrialBalance(accounts, entries);
  const wb = new ExcelJS.Workbook();
  wb.creator = "Mohaseb Smart Accounting";
  wb.created = new Date();
  const ws = wb.addWorksheet("ميزان المراجعة");
  applyHeader(ws, "ميزان المراجعة", "Trial Balance", currency);

  ws.columns = [
    { header: "الرمز / Code",  key: "code",   width: 12 },
    { header: "الحساب / Account", key: "name", width: 36 },
    { header: "النوع / Type", key: "type", width: 14 },
    { header: "مدين / Debit",  key: "debit",  width: 16, style: { numFmt: fmtMoney(currency) } },
    { header: "دائن / Credit", key: "credit", width: 16, style: { numFmt: fmtMoney(currency) } },
  ];
  styleHeaderRow(ws.getRow(4));
  // Move header (auto-placed at row 1) — exceljs places columns header at row 1; instead recreate manually.
  // The above `columns` populates row 1 — we already used row 1/2 for title. Remove that header row and re-add at 4.
  ws.spliceRows(1, 1);
  // Rebuild title at top
  ws.spliceRows(1, 0, ["", "", "", "", ""]);
  ws.mergeCells("A1:E1");
  ws.getCell("A1").value = "ميزان المراجعة";
  ws.getCell("A1").font = { size: 16, bold: true };
  ws.getCell("A1").alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(1).height = 26;

  ws.spliceRows(2, 0, ["", "", "", "", ""]);
  ws.mergeCells("A2:E2");
  ws.getCell("A2").value = `Trial Balance · ${new Date().toLocaleDateString("en-US")} · ${currency}`;
  ws.getCell("A2").font = { size: 10, color: { argb: "FF6B7280" } };
  ws.getCell("A2").alignment = { horizontal: "center" };

  ws.spliceRows(3, 0, ["الرمز", "الحساب", "النوع", "مدين", "دائن"]);
  styleHeaderRow(ws.getRow(3));

  // Now data rows starting at row 4
  for (const r of tb.rows) {
    const row = ws.addRow([r.code, r.nameAr, r.type, r.debit, r.credit]);
    row.getCell(4).numFmt = fmtMoney(currency);
    row.getCell(5).numFmt = fmtMoney(currency);
  }
  // Totals row
  const totalsRow = ws.addRow(["", "الإجمالي / Total", "", tb.totalDebit, tb.totalCredit]);
  totalsRow.font = { bold: true };
  totalsRow.getCell(4).numFmt = fmtMoney(currency);
  totalsRow.getCell(5).numFmt = fmtMoney(currency);
  totalsRow.eachCell((cell) => {
    cell.border = { top: { style: "double", color: { argb: "FF065F46" } } };
  });

  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function generateProfitLossExcel(
  accounts: Account[], entries: JournalEntryWithLines[], currency = "USD"
): Promise<Buffer> {
  const pl = buildProfitLoss(accounts, entries);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("قائمة الدخل");
  ws.views = [{ rightToLeft: true }];
  ws.columns = [
    { header: "", key: "code", width: 14 },
    { header: "", key: "name", width: 38 },
    { header: "", key: "amount", width: 18, style: { numFmt: fmtMoney(currency) } },
  ];
  ws.mergeCells("A1:C1");
  ws.getCell("A1").value = "قائمة الدخل / Profit & Loss Statement";
  ws.getCell("A1").font = { size: 16, bold: true };
  ws.getCell("A1").alignment = { horizontal: "center" };
  ws.getRow(1).height = 28;

  ws.mergeCells("A2:C2");
  ws.getCell("A2").value = `As of ${new Date().toLocaleDateString("en-US")} · ${currency}`;
  ws.getCell("A2").font = { size: 10, color: { argb: "FF6B7280" } };
  ws.getCell("A2").alignment = { horizontal: "center" };
  ws.addRow([]);

  // Revenue
  const revHeader = ws.addRow(["", "الإيرادات / Revenue", ""]);
  revHeader.font = { bold: true, color: { argb: "FFFFFFFF" } };
  revHeader.eachCell((c) => (c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF065F46" } }));
  for (const r of pl.revenue) ws.addRow([r.code, r.nameAr, r.balance]);
  const totRev = ws.addRow(["", "إجمالي الإيرادات", pl.totalRevenue]);
  totRev.font = { bold: true };
  totRev.eachCell((c) => (c.border = { top: { style: "thin" }, bottom: { style: "thin" } }));
  ws.addRow([]);

  // Expenses
  const expHeader = ws.addRow(["", "المصروفات / Expenses", ""]);
  expHeader.font = { bold: true, color: { argb: "FFFFFFFF" } };
  expHeader.eachCell((c) => (c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF991B1B" } }));
  for (const r of pl.expenses) ws.addRow([r.code, r.nameAr, r.balance]);
  const totExp = ws.addRow(["", "إجمالي المصروفات", pl.totalExpenses]);
  totExp.font = { bold: true };
  totExp.eachCell((c) => (c.border = { top: { style: "thin" }, bottom: { style: "thin" } }));
  ws.addRow([]);

  // Net income
  const ni = ws.addRow(["", "صافي الدخل / Net Income", pl.netIncome]);
  ni.font = { bold: true, size: 13 };
  ni.eachCell((c) => {
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: pl.netIncome >= 0 ? "FFD1FAE5" : "FFFEE2E2" } };
    c.border = { top: { style: "double" }, bottom: { style: "double" } };
  });

  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function generateBalanceSheetExcel(
  accounts: Account[], entries: JournalEntryWithLines[], currency = "USD"
): Promise<Buffer> {
  const bs = buildBalanceSheet(accounts, entries);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("الميزانية");
  ws.views = [{ rightToLeft: true }];
  ws.columns = [
    { header: "", key: "code", width: 14 },
    { header: "", key: "name", width: 38 },
    { header: "", key: "amount", width: 18, style: { numFmt: fmtMoney(currency) } },
  ];
  ws.mergeCells("A1:C1");
  ws.getCell("A1").value = "قائمة المركز المالي / Balance Sheet";
  ws.getCell("A1").font = { size: 16, bold: true };
  ws.getCell("A1").alignment = { horizontal: "center" };
  ws.getRow(1).height = 28;
  ws.mergeCells("A2:C2");
  ws.getCell("A2").value = `As of ${new Date().toLocaleDateString("en-US")} · ${currency}`;
  ws.getCell("A2").font = { size: 10, color: { argb: "FF6B7280" } };
  ws.getCell("A2").alignment = { horizontal: "center" };
  ws.addRow([]);

  function block(label: string, color: string, items: Row[], totalLabel: string, total: number) {
    const h = ws.addRow(["", label, ""]);
    h.font = { bold: true, color: { argb: "FFFFFFFF" } };
    h.eachCell((c) => (c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: color } }));
    for (const r of items) ws.addRow([r.code, r.nameAr, r.balance]);
    const t = ws.addRow(["", totalLabel, total]);
    t.font = { bold: true };
    t.eachCell((c) => (c.border = { top: { style: "thin" }, bottom: { style: "thin" } }));
    ws.addRow([]);
  }

  block("الأصول / Assets",       "FF065F46", bs.assets,      "إجمالي الأصول",      bs.totalAssets);
  block("الالتزامات / Liabilities", "FF991B1B", bs.liabilities, "إجمالي الالتزامات", bs.totalLiabilities);
  // Equity block — include net income line
  const eqH = ws.addRow(["", "حقوق الملكية / Equity", ""]);
  eqH.font = { bold: true, color: { argb: "FFFFFFFF" } };
  eqH.eachCell((c) => (c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E40AF" } }));
  for (const r of bs.equity) ws.addRow([r.code, r.nameAr, r.balance]);
  ws.addRow(["", "صافي دخل الفترة", bs.netIncome]);
  const eqT = ws.addRow(["", "إجمالي حقوق الملكية", bs.totalEquity]);
  eqT.font = { bold: true };
  eqT.eachCell((c) => (c.border = { top: { style: "thin" }, bottom: { style: "thin" } }));
  ws.addRow([]);

  // Balance check
  const check = ws.addRow(["", "الأصول = الالتزامات + حقوق الملكية", bs.totalLiabilities + bs.totalEquity]);
  check.font = { bold: true, size: 12 };
  check.eachCell((c) => {
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E7EB" } };
    c.border = { top: { style: "double" } };
  });

  return Buffer.from(await wb.xlsx.writeBuffer());
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  PDF generation — Arabic-aware via Amiri font + shaping/bidi pipeline     */
/* ────────────────────────────────────────────────────────────────────────── */

const num = (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function pdfBase(title: string, subtitle: string, locale: Locale): PDFKit.PDFDocument {
  const doc = new PDFDocument({ size: "A4", margin: 48, info: { Title: title, Producer: "Mohaseb" } });
  // Register Amiri once so any later cell with Arabic can switch to it
  // without re-registering. Fonts are streamed from disk by pdfkit, so the
  // file IO cost is paid only when an Arabic glyph is actually drawn.
  registerArabicFonts(doc);
  // Title is rendered through the same shaping pipeline so an Arabic title
  // (the standard case) lays out correctly. We pick the title font based
  // on whether the title contains Arabic — Helvetica-Bold for the three
  // Latin-script locales, Amiri-Bold for ar.
  const titleHasArabic = containsArabic(title);
  const titleText = titleHasArabic ? prepareArabicForPdf(title) : title;
  const titleFont = titleHasArabic ? "Amiri-Bold" : "Helvetica-Bold";
  doc.fillColor("#065F46").fontSize(20).font(titleFont).text(titleText, { align: "center", lineBreak: !titleHasArabic });

  doc.moveDown(0.2);

  const subHasArabic = containsArabic(subtitle);
  const subText = subHasArabic ? prepareArabicForPdf(subtitle) : subtitle;
  const subFont = subHasArabic ? "Amiri" : "Helvetica";
  doc.fillColor("#6B7280").fontSize(10).font(subFont).text(subText, { align: "center", lineBreak: !subHasArabic });

  doc.moveDown(1);
  // Stash the locale on the doc so downstream helpers can flip alignment
  // defaults without each call site having to re-thread the parameter.
  (doc as any).__locale = locale;
  return doc;
}

/** Pick font + reshape for the cell's text. We default the latin alias to
 *  Helvetica (the historical font) so non-Arabic cells render exactly like
 *  before. Arabic cells get Amiri + presentation-form-shaped + bidi-reordered
 *  text, which is what pdfkit needs to draw legible Arabic. */
function drawCell(
  doc: PDFKit.PDFDocument,
  value: string,
  x: number,
  y: number,
  width: number,
  align: "left" | "right",
  bold: boolean,
) {
  const isArabic = containsArabic(value);
  const text = isArabic ? prepareArabicForPdf(value) : value;
  const font = fontFor(value, bold, bold ? "Helvetica-Bold" : "Helvetica");
  doc.font(font);
  // Pre-shaped Arabic cells get `lineBreak: false` to defeat pdfkit's
  // word-wrap on the visual-order glyph stream — same fix as the sales
  // invoice template uses, and the reason the inter-word space in
  // "النقد بالصندوق" is no longer dropped.
  const opts: any = { width, align };
  if (isArabic) opts.lineBreak = false;
  doc.text(text, x, y, opts);
}

function tableHeader(doc: PDFKit.PDFDocument, cols: { label: string; x: number; w: number; align?: "left"|"right" }[]) {
  const y = doc.y;
  doc.rect(48, y - 4, doc.page.width - 96, 22).fill("#065F46");
  doc.fillColor("#fff").fontSize(10);
  for (const c of cols) drawCell(doc, c.label, c.x, y + 1, c.w, c.align ?? "left", true);
  doc.moveDown(1.2);
  doc.fillColor("#111").fontSize(10);
}

function tableRow(doc: PDFKit.PDFDocument, cols: { value: string; x: number; w: number; align?: "left"|"right" }[], opts: { bold?: boolean; bg?: string } = {}) {
  if (doc.y > doc.page.height - 80) doc.addPage();
  const y = doc.y;
  if (opts.bg) doc.rect(48, y - 3, doc.page.width - 96, 18).fill(opts.bg);
  doc.fillColor("#111").fontSize(10);
  for (const c of cols) drawCell(doc, c.value, c.x, y, c.w, c.align ?? "left", !!opts.bold);
  doc.moveDown(0.7);
}

async function streamToBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}

/** Build the standardised "As of <date>  ·  Currency: <code>" subtitle in
 *  the user's locale. Uses Intl.DateTimeFormat for native month names. */
function reportSubtitle(locale: Locale, currency: string): string {
  return `${t(locale, "report.asOf")} ${formatLocaleDate(locale, new Date())}  ·  ${t(locale, "report.currency")}: ${currency}`;
}

/** Render a heading line for a section ("Revenue", "Aktiva", etc.) using the
 *  Arabic shaping pipeline when needed. We can't rely on `doc.text(...)` to
 *  shape Arabic on its own — it would draw disconnected glyphs. */
function sectionHeading(doc: PDFKit.PDFDocument, label: string, color: string) {
  const isArabic = containsArabic(label);
  const text = isArabic ? prepareArabicForPdf(label) : label;
  const font = isArabic ? "Amiri-Bold" : "Helvetica-Bold";
  doc.fillColor(color).font(font).fontSize(12).text(text, { lineBreak: !isArabic });
  doc.moveDown(0.4);
}

/** Render a footer banner (e.g. NET INCOME / Balanced ✓) with the same
 *  shaping awareness as `sectionHeading`. */
function footerBanner(
  doc: PDFKit.PDFDocument, text: string, x: number, width: number, align: "left"|"right"|"center", fontSize = 11,
) {
  const isArabic = containsArabic(text);
  const shaped = isArabic ? prepareArabicForPdf(text) : text;
  const font = isArabic ? "Amiri-Bold" : "Helvetica-Bold";
  doc.fillColor("#111").font(font).fontSize(fontSize);
  const opts: any = { width, align };
  if (isArabic) opts.lineBreak = false;
  doc.text(shaped, x, doc.y, opts);
}

export async function generateTrialBalancePdf(
  accounts: Account[], entries: JournalEntryWithLines[], currency = "USD",
  locale: Locale = "ar",
): Promise<Buffer> {
  const tb = buildTrialBalance(accounts, entries);
  const doc = pdfBase(t(locale, "report.tb.title"), reportSubtitle(locale, currency), locale);
  const isRtl = dirFor(locale) === "rtl";
  const startAlign: "left"|"right" = isRtl ? "right" : "left";

  const cols = [
    { label: t(locale, "report.code"),    x: 56,  w: 50,  align: startAlign },
    { label: t(locale, "report.account"), x: 110, w: 170, align: startAlign },
    { label: t(locale, "report.type"),    x: 285, w: 70,  align: startAlign },
    { label: t(locale, "report.debit"),   x: 360, w: 85,  align: "right" as const },
    { label: t(locale, "report.credit"),  x: 450, w: 95,  align: "right" as const },
  ];
  tableHeader(doc, cols);
  let alt = false;
  for (const r of tb.rows) {
    tableRow(doc, [
      { value: r.code,                                                    x: 56,  w: 50,  align: startAlign },
      { value: pickName(locale, r.nameAr, r.nameEn).slice(0, 36),         x: 110, w: 170, align: startAlign },
      { value: accountType(locale, r.type),                               x: 285, w: 70,  align: startAlign },
      { value: num(r.debit),                                              x: 360, w: 85,  align: "right" },
      { value: num(r.credit),                                             x: 450, w: 95,  align: "right" },
    ], { bg: alt ? "#F9FAFB" : undefined });
    alt = !alt;
  }
  doc.moveDown(0.4);
  doc.strokeColor("#065F46").lineWidth(1).moveTo(48, doc.y).lineTo(doc.page.width - 48, doc.y).stroke();
  doc.moveDown(0.3);
  tableRow(doc, [
    { value: t(locale, "report.total"),  x: 56,  w: 304, align: startAlign },
    { value: num(tb.totalDebit),         x: 360, w: 85,  align: "right" },
    { value: num(tb.totalCredit),        x: 450, w: 95,  align: "right" },
  ], { bold: true });

  return streamToBuffer(doc);
}

export async function generateProfitLossPdf(
  accounts: Account[], entries: JournalEntryWithLines[], currency = "USD",
  locale: Locale = "ar",
): Promise<Buffer> {
  const pl = buildProfitLoss(accounts, entries);
  const doc = pdfBase(t(locale, "report.pl.title"), reportSubtitle(locale, currency), locale);
  const isRtl = dirFor(locale) === "rtl";
  const startAlign: "left"|"right" = isRtl ? "right" : "left";

  const section = (title: string, items: Row[], total: number, totalLabel: string, color: string) => {
    sectionHeading(doc, title, color);
    doc.fillColor("#111").font("Helvetica").fontSize(10);
    for (const r of items) {
      tableRow(doc, [
        { value: r.code,                                                  x: 56,  w: 70,  align: startAlign },
        { value: pickName(locale, r.nameAr, r.nameEn).slice(0, 40),       x: 130, w: 240, align: startAlign },
        { value: num(r.balance),                                          x: 380, w: 130, align: "right" },
      ]);
    }
    doc.strokeColor(color).lineWidth(0.8).moveTo(48, doc.y).lineTo(doc.page.width - 48, doc.y).stroke();
    doc.moveDown(0.2);
    tableRow(doc, [
      { value: totalLabel, x: 56,  w: 314, align: startAlign },
      { value: num(total), x: 380, w: 130, align: "right" },
    ], { bold: true });
    doc.moveDown(0.6);
  };

  section(t(locale, "report.pl.revenue"),  pl.revenue,  pl.totalRevenue,  t(locale, "report.pl.totalRevenue"),  "#065F46");
  section(t(locale, "report.pl.expenses"), pl.expenses, pl.totalExpenses, t(locale, "report.pl.totalExpenses"), "#991B1B");

  doc.moveDown(0.4);
  doc.rect(48, doc.y - 4, doc.page.width - 96, 28).fill(pl.netIncome >= 0 ? "#D1FAE5" : "#FEE2E2");
  footerBanner(
    doc,
    `${t(locale, "report.pl.netIncome")}: ${num(pl.netIncome)} ${currency}`,
    56, doc.page.width - 112,
    isRtl ? "left" : "right", 13,
  );

  return streamToBuffer(doc);
}

export async function generateBalanceSheetPdf(
  accounts: Account[], entries: JournalEntryWithLines[], currency = "USD",
  locale: Locale = "ar",
): Promise<Buffer> {
  const bs = buildBalanceSheet(accounts, entries);
  const doc = pdfBase(t(locale, "report.bs.title"), reportSubtitle(locale, currency), locale);
  const isRtl = dirFor(locale) === "rtl";
  const startAlign: "left"|"right" = isRtl ? "right" : "left";

  const section = (title: string, items: Row[], total: number, totalLabel: string, color: string, includeNetIncome = false) => {
    sectionHeading(doc, title, color);
    for (const r of items) {
      tableRow(doc, [
        { value: r.code,                                                  x: 56,  w: 70,  align: startAlign },
        { value: pickName(locale, r.nameAr, r.nameEn).slice(0, 40),       x: 130, w: 240, align: startAlign },
        { value: num(r.balance),                                          x: 380, w: 130, align: "right" },
      ]);
    }
    if (includeNetIncome) {
      tableRow(doc, [
        { value: "—",                                  x: 56,  w: 70,  align: startAlign },
        { value: t(locale, "report.bs.netIncomePeriod"), x: 130, w: 240, align: startAlign },
        { value: num(bs.netIncome),                    x: 380, w: 130, align: "right" },
      ]);
    }
    doc.strokeColor(color).lineWidth(0.8).moveTo(48, doc.y).lineTo(doc.page.width - 48, doc.y).stroke();
    doc.moveDown(0.2);
    tableRow(doc, [
      { value: totalLabel, x: 56,  w: 314, align: startAlign },
      { value: num(total), x: 380, w: 130, align: "right" },
    ], { bold: true });
    doc.moveDown(0.6);
  };

  section(t(locale, "report.bs.assets"),      bs.assets,      bs.totalAssets,      t(locale, "report.bs.totalAssets"),  "#065F46");
  section(t(locale, "report.bs.liabilities"), bs.liabilities, bs.totalLiabilities, t(locale, "report.bs.totalLiab"),    "#991B1B");
  section(t(locale, "report.bs.equity"),      bs.equity,      bs.totalEquity,      t(locale, "report.bs.totalEquity"),  "#1E40AF", true);

  doc.moveDown(0.4);
  const balanced = Math.abs(bs.totalAssets - (bs.totalLiabilities + bs.totalEquity)) < 0.01;
  doc.rect(48, doc.y - 4, doc.page.width - 96, 28).fill(balanced ? "#D1FAE5" : "#FEE2E2");
  const banner = balanced
    ? `${t(locale, "report.bs.balanced")} ✓   ${t(locale, "report.bs.totalAssets")} ${num(bs.totalAssets)} = ${t(locale, "report.bs.totalLiab")} + ${t(locale, "report.bs.totalEquity")} ${num(bs.totalLiabilities + bs.totalEquity)}`
    : `${t(locale, "report.bs.imbalance")} ✗  ${t(locale, "report.bs.diff")} ${num(bs.totalAssets - (bs.totalLiabilities + bs.totalEquity))}`;
  footerBanner(doc, banner, 56, doc.page.width - 112, "center", 11);

  return streamToBuffer(doc);
}
