/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Custom document generators driven by AI tool-calling.
 *
 * The AI describes a structured document (sheets / paragraphs / slides) and
 * these helpers turn it into a real .xlsx, .docx, or .pptx Buffer that we
 * stash in the in-memory file store and surface in chat as a download card.
 *
 * Inputs are intentionally narrow + JSON-shaped so the OpenAI function
 * schema stays simple and validation is cheap.
 */
import ExcelJS from "exceljs";
import {
  Document,
  Packer,
  Paragraph,
  HeadingLevel,
  AlignmentType,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
} from "docx";
import PptxGenJS from "pptxgenjs";

/* ------------------------------------------------------------------ */
/*  Excel — workbook with N sheets, each sheet has headers + rows     */
/* ------------------------------------------------------------------ */

export type ExcelSheetSpec = {
  name: string;
  headers: string[];
  rows: (string | number | null)[][];
  rtl?: boolean;
};

export type ExcelDocSpec = {
  title: string;
  sheets: ExcelSheetSpec[];
  language?: string; // "ar" | "en" | "de" | "fr"
};

export async function generateCustomExcel(spec: ExcelDocSpec): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Mohaseb AI Assistant";
  wb.created = new Date();
  wb.title = spec.title;

  const sheets = spec.sheets.length
    ? spec.sheets
    : [{ name: "Sheet1", headers: [], rows: [] }];

  for (const s of sheets) {
    // Excel sheet names ≤ 31 chars and cannot contain : \ / ? * [ ]
    const safeName =
      s.name.replace(/[:\\/?*[\]]/g, " ").slice(0, 31) || "Sheet";
    const ws = wb.addWorksheet(safeName);
    if (s.rtl || spec.language === "ar") ws.views = [{ rightToLeft: true }];

    if (s.headers.length) {
      const headerRow = ws.addRow(s.headers);
      headerRow.height = 22;
      headerRow.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FF0F172A" },
        };
        cell.alignment = { vertical: "middle", horizontal: "center" };
        cell.border = {
          bottom: { style: "thin", color: { argb: "FF0F172A" } },
        };
      });
    }

    for (const r of s.rows) ws.addRow(r);

    // Autosize-ish column widths based on header + sample of rows
    const colCount = Math.max(
      s.headers.length,
      ...s.rows.map((r) => r.length),
      1,
    );
    for (let i = 1; i <= colCount; i++) {
      const col = ws.getColumn(i);
      let max = String(s.headers[i - 1] ?? "").length;
      for (const row of s.rows.slice(0, 50)) {
        const v = row[i - 1];
        if (v != null) max = Math.max(max, String(v).length);
      }
      col.width = Math.min(48, Math.max(10, max + 2));
    }
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}

/* ------------------------------------------------------------------ */
/*  Word — document with headings, paragraphs, optional tables         */
/* ------------------------------------------------------------------ */

export type WordBlock =
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "paragraph"; text: string; bold?: boolean }
  | { kind: "bullet"; items: string[] }
  | { kind: "table"; headers: string[]; rows: string[][] };

export type WordDocSpec = {
  title: string;
  blocks: WordBlock[];
  language?: string;
};

function isRtlLang(lang?: string) {
  return lang === "ar" || lang === "he" || lang === "fa";
}

export async function generateCustomWord(spec: WordDocSpec): Promise<Buffer> {
  const rtl = isRtlLang(spec.language);
  const align = rtl ? AlignmentType.RIGHT : AlignmentType.LEFT;

  const headingLevels = {
    1: HeadingLevel.HEADING_1,
    2: HeadingLevel.HEADING_2,
    3: HeadingLevel.HEADING_3,
  };

  const children: any[] = [
    new Paragraph({
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      bidirectional: rtl,
      children: [new TextRun({ text: spec.title, bold: true })],
    }),
    new Paragraph({ text: "" }),
  ];

  for (const b of spec.blocks) {
    if (b.kind === "heading") {
      children.push(
        new Paragraph({
          heading: headingLevels[b.level],
          alignment: align,
          bidirectional: rtl,
          children: [new TextRun({ text: b.text, bold: true })],
        }),
      );
    } else if (b.kind === "paragraph") {
      children.push(
        new Paragraph({
          alignment: align,
          bidirectional: rtl,
          children: [new TextRun({ text: b.text, bold: !!b.bold })],
        }),
      );
    } else if (b.kind === "bullet") {
      for (const item of b.items) {
        children.push(
          new Paragraph({
            bullet: { level: 0 },
            alignment: align,
            bidirectional: rtl,
            children: [new TextRun({ text: item })],
          }),
        );
      }
    } else if (b.kind === "table") {
      const border = {
        style: BorderStyle.SINGLE,
        size: 4,
        color: "CBD5E1",
      };
      const borders = {
        top: border,
        bottom: border,
        left: border,
        right: border,
      };
      const headerRow = new TableRow({
        tableHeader: true,
        children: b.headers.map(
          (h) =>
            new TableCell({
              shading: { fill: "0F172A" },
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  bidirectional: rtl,
                  children: [
                    new TextRun({ text: h, bold: true, color: "FFFFFF" }),
                  ],
                }),
              ],
            }),
        ),
      });
      const dataRows = b.rows.map(
        (r) =>
          new TableRow({
            children: r.map(
              (c) =>
                new TableCell({
                  children: [
                    new Paragraph({
                      alignment: align,
                      bidirectional: rtl,
                      children: [new TextRun({ text: String(c ?? "") })],
                    }),
                  ],
                }),
            ),
          }),
      );
      children.push(
        new Table({
          rows: [headerRow, ...dataRows],
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: {
            top: borders.top,
            bottom: borders.bottom,
            left: borders.left,
            right: borders.right,
            insideHorizontal: border,
            insideVertical: border,
          },
        }),
      );
      children.push(new Paragraph({ text: "" }));
    }
  }

  const doc = new Document({
    creator: "Mohaseb AI Assistant",
    title: spec.title,
    sections: [
      {
        properties: {},
        children,
      },
    ],
  });

  return Buffer.from(await Packer.toBuffer(doc));
}

/* ------------------------------------------------------------------ */
/*  PowerPoint — N slides, each is title + bullets (+ optional table)  */
/* ------------------------------------------------------------------ */

export type PptSlideSpec = {
  title: string;
  bullets?: string[];
  notes?: string;
  table?: { headers: string[]; rows: string[][] };
};

export type PptDocSpec = {
  title: string;
  subtitle?: string;
  slides: PptSlideSpec[];
  language?: string;
};

export async function generateCustomPpt(spec: PptDocSpec): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.author = "Mohaseb AI Assistant";
  pptx.title = spec.title;
  pptx.layout = "LAYOUT_WIDE";

  const rtl = isRtlLang(spec.language);
  const align: "left" | "right" = rtl ? "right" : "left";

  // Cover slide
  const cover = pptx.addSlide();
  cover.background = { color: "0F172A" };
  cover.addText(spec.title, {
    x: 0.5,
    y: 2.4,
    w: 12,
    h: 1.6,
    fontSize: 44,
    bold: true,
    color: "FFFFFF",
    align: "center",
    fontFace: "Calibri",
  });
  if (spec.subtitle) {
    cover.addText(spec.subtitle, {
      x: 0.5,
      y: 4.2,
      w: 12,
      h: 0.8,
      fontSize: 18,
      color: "CBD5E1",
      align: "center",
      fontFace: "Calibri",
    });
  }

  // Content slides
  for (const s of spec.slides) {
    const slide = pptx.addSlide();
    slide.background = { color: "FFFFFF" };
    slide.addText(s.title, {
      x: 0.5,
      y: 0.4,
      w: 12,
      h: 0.9,
      fontSize: 30,
      bold: true,
      color: "0F172A",
      align,
      fontFace: "Calibri",
    });

    let cursorY = 1.5;
    if (s.bullets?.length) {
      const bulletText = s.bullets.map((b) => ({
        text: b,
        options: { bullet: true, color: "1E293B", fontSize: 18 },
      }));
      slide.addText(bulletText, {
        x: 0.6,
        y: cursorY,
        w: 12,
        h: Math.min(5, 0.5 * s.bullets.length + 0.4),
        fontFace: "Calibri",
        align,
      });
      cursorY += Math.min(5, 0.5 * s.bullets.length + 0.6);
    }

    if (s.table?.headers?.length) {
      const headers = s.table.headers.map((h) => ({
        text: h,
        options: { bold: true, color: "FFFFFF", fill: { color: "0F172A" } },
      }));
      const body = s.table.rows.map((row) =>
        row.map((c) => ({
          text: String(c ?? ""),
          options: { color: "1E293B" },
        })),
      );
      slide.addTable([headers, ...body] as any, {
        x: 0.5,
        y: cursorY,
        w: 12,
        fontSize: 12,
        fontFace: "Calibri",
        border: { type: "solid", color: "CBD5E1", pt: 0.5 },
      });
    }

    if (s.notes) slide.addNotes(s.notes);
  }

  const out = await pptx.write({ outputType: "nodebuffer" });
  return Buffer.from(out as Buffer);
}
