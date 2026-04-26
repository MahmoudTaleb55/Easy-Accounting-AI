/* eslint-disable @typescript-eslint/no-explicit-any */
import PDFDocument from "pdfkit";
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

function pdfBase(title: string, subtitle: string): PDFKit.PDFDocument {
  const doc = new PDFDocument({ size: "A4", margin: 48, info: { Title: title, Producer: "Mohaseb" } });
  // Register Amiri once so any later cell with Arabic can switch to it
  // without re-registering. Fonts are streamed from disk by pdfkit, so the
  // file IO cost is paid only when an Arabic glyph is actually drawn.
  registerArabicFonts(doc);
  doc.fillColor("#065F46").fontSize(20).font("Helvetica-Bold").text(title, { align: "center" });
  doc.moveDown(0.2);
  doc.fillColor("#6B7280").fontSize(10).font("Helvetica").text(subtitle, { align: "center" });
  doc.moveDown(1);
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
  // For pure-Arabic cells we right-align by default — that's the natural
  // RTL "where the eye starts" position. Mixed AR/EN strings keep the
  // caller-supplied alignment so they slot in cleanly next to numeric
  // columns.
  const effectiveAlign: "left" | "right" =
    isArabic && /^[\s\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF\d.,/-]+$/.test(value) && align === "left"
      ? "right"
      : align;
  doc.text(text, x, y, { width, align: effectiveAlign });
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

export async function generateTrialBalancePdf(
  accounts: Account[], entries: JournalEntryWithLines[], currency = "USD"
): Promise<Buffer> {
  const tb = buildTrialBalance(accounts, entries);
  const doc = pdfBase("Trial Balance", `As of ${new Date().toLocaleDateString("en-US")}  ·  Currency: ${currency}`);

  const cols = [
    { label: "Code",            x: 56,  w: 50 },
    { label: "Account / الحساب", x: 110, w: 170 },
    { label: "Type",            x: 285, w: 70 },
    { label: "Debit",           x: 360, w: 85, align: "right" as const },
    { label: "Credit",          x: 450, w: 95, align: "right" as const },
  ];
  tableHeader(doc, cols);
  let alt = false;
  for (const r of tb.rows) {
    tableRow(doc, [
      { value: r.code,                 x: 56,  w: 50 },
      { value: r.nameAr.slice(0, 36),  x: 110, w: 170 },
      { value: r.type,                 x: 285, w: 70 },
      { value: num(r.debit),           x: 360, w: 85, align: "right" },
      { value: num(r.credit),          x: 450, w: 95, align: "right" },
    ], { bg: alt ? "#F9FAFB" : undefined });
    alt = !alt;
  }
  doc.moveDown(0.4);
  doc.strokeColor("#065F46").lineWidth(1).moveTo(48, doc.y).lineTo(doc.page.width - 48, doc.y).stroke();
  doc.moveDown(0.3);
  tableRow(doc, [
    { value: "TOTAL",                 x: 56,  w: 304 },
    { value: num(tb.totalDebit),       x: 360, w: 85, align: "right" },
    { value: num(tb.totalCredit),      x: 450, w: 95, align: "right" },
  ], { bold: true });

  return streamToBuffer(doc);
}

export async function generateProfitLossPdf(
  accounts: Account[], entries: JournalEntryWithLines[], currency = "USD"
): Promise<Buffer> {
  const pl = buildProfitLoss(accounts, entries);
  const doc = pdfBase("Profit & Loss Statement", `As of ${new Date().toLocaleDateString("en-US")}  ·  Currency: ${currency}`);

  const section = (title: string, items: Row[], total: number, totalLabel: string, color: string) => {
    doc.fillColor(color).font("Helvetica-Bold").fontSize(12).text(title);
    doc.moveDown(0.4);
    doc.fillColor("#111").font("Helvetica").fontSize(10);
    for (const r of items) {
      tableRow(doc, [
        { value: r.code,           x: 56,  w: 70 },
        { value: r.nameAr.slice(0, 40), x: 130, w: 240 },
        { value: num(r.balance),   x: 380, w: 130, align: "right" },
      ]);
    }
    doc.strokeColor(color).lineWidth(0.8).moveTo(48, doc.y).lineTo(doc.page.width - 48, doc.y).stroke();
    doc.moveDown(0.2);
    tableRow(doc, [
      { value: totalLabel,  x: 56,  w: 314 },
      { value: num(total),  x: 380, w: 130, align: "right" },
    ], { bold: true });
    doc.moveDown(0.6);
  };

  section("Revenue",  pl.revenue,  pl.totalRevenue,  "Total Revenue",  "#065F46");
  section("Expenses", pl.expenses, pl.totalExpenses, "Total Expenses", "#991B1B");

  doc.moveDown(0.4);
  doc.rect(48, doc.y - 4, doc.page.width - 96, 28).fill(pl.netIncome >= 0 ? "#D1FAE5" : "#FEE2E2");
  doc.fillColor("#111").font("Helvetica-Bold").fontSize(13);
  doc.text(`NET INCOME: ${num(pl.netIncome)} ${currency}`, 56, doc.y, { width: doc.page.width - 112, align: "right" });

  return streamToBuffer(doc);
}

export async function generateBalanceSheetPdf(
  accounts: Account[], entries: JournalEntryWithLines[], currency = "USD"
): Promise<Buffer> {
  const bs = buildBalanceSheet(accounts, entries);
  const doc = pdfBase("Balance Sheet", `As of ${new Date().toLocaleDateString("en-US")}  ·  Currency: ${currency}`);

  const section = (title: string, items: Row[], total: number, totalLabel: string, color: string, includeNetIncome = false) => {
    doc.fillColor(color).font("Helvetica-Bold").fontSize(12).text(title);
    doc.moveDown(0.4);
    for (const r of items) {
      tableRow(doc, [
        { value: r.code,            x: 56,  w: 70 },
        { value: r.nameAr.slice(0, 40), x: 130, w: 240 },
        { value: num(r.balance),    x: 380, w: 130, align: "right" },
      ]);
    }
    if (includeNetIncome) {
      tableRow(doc, [
        { value: "—",                 x: 56,  w: 70 },
        { value: "Net Income (period)", x: 130, w: 240 },
        { value: num(bs.netIncome),    x: 380, w: 130, align: "right" },
      ]);
    }
    doc.strokeColor(color).lineWidth(0.8).moveTo(48, doc.y).lineTo(doc.page.width - 48, doc.y).stroke();
    doc.moveDown(0.2);
    tableRow(doc, [
      { value: totalLabel, x: 56,  w: 314 },
      { value: num(total), x: 380, w: 130, align: "right" },
    ], { bold: true });
    doc.moveDown(0.6);
  };

  section("Assets",      bs.assets,      bs.totalAssets,      "Total Assets",      "#065F46");
  section("Liabilities", bs.liabilities, bs.totalLiabilities, "Total Liabilities", "#991B1B");
  section("Equity",      bs.equity,      bs.totalEquity,      "Total Equity",      "#1E40AF", true);

  doc.moveDown(0.4);
  const balanced = Math.abs(bs.totalAssets - (bs.totalLiabilities + bs.totalEquity)) < 0.01;
  doc.rect(48, doc.y - 4, doc.page.width - 96, 28).fill(balanced ? "#D1FAE5" : "#FEE2E2");
  doc.fillColor("#111").font("Helvetica-Bold").fontSize(11);
  doc.text(
    balanced
      ? `Balanced ✓   Assets ${num(bs.totalAssets)} = Liabilities + Equity ${num(bs.totalLiabilities + bs.totalEquity)}`
      : `Imbalance ✗  Diff ${num(bs.totalAssets - (bs.totalLiabilities + bs.totalEquity))}`,
    56, doc.y, { width: doc.page.width - 112, align: "center" }
  );

  return streamToBuffer(doc);
}
