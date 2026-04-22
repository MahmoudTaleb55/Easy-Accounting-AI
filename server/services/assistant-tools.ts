/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from "zod";
import { storage } from "../storage";
import {
  storeFile,
  generateTrialBalanceExcel,
  generateTrialBalancePdf,
  generateProfitLossExcel,
  generateProfitLossPdf,
  generateBalanceSheetExcel,
  generateBalanceSheetPdf,
} from "./assistant-files";

/* ────────────────────────────────────────────────────────────────────────── */
/*  Tool schemas exposed to OpenAI function calling                          */
/* ────────────────────────────────────────────────────────────────────────── */

export const ASSISTANT_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "add_quick_transaction",
      description:
        "Record a single income or expense transaction. Use when the user describes a simple cash transaction in plain language ('spent 50 on coffee', 'received 8000 salary'). Auto-posts to the journal.",
      parameters: {
        type: "object",
        properties: {
          type:        { type: "string", enum: ["income", "expense"] },
          amount:      { type: "number", description: "Positive amount in the workspace currency" },
          description: { type: "string", description: "Short merchant or memo, ≤ 200 chars" },
          category:    { type: "string", description: "Category label (e.g. 'Food', 'Salary', 'Utilities')" },
        },
        required: ["type", "amount", "description", "category"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "create_journal_entry",
      description:
        "Post a balanced double-entry journal entry. Use for accounting-aware transactions where the user specifies debit/credit accounts. Account IDs come from list_accounts. Total debits must equal total credits.",
      parameters: {
        type: "object",
        properties: {
          description: { type: "string", description: "Short narration ≤ 300 chars" },
          entryDate:   { type: "string", description: "ISO date (YYYY-MM-DD), optional" },
          lines: {
            type: "array",
            minItems: 2,
            items: {
              type: "object",
              properties: {
                accountId:   { type: "integer" },
                debit:       { type: "number", description: "Set debit OR credit, never both" },
                credit:      { type: "number" },
                description: { type: "string" },
              },
              required: ["accountId"],
            },
          },
        },
        required: ["description", "lines"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_accounts",
      description: "List the chart of accounts so you can pick accountId values for journal entries.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_financial_summary",
      description: "Return totals: cash balance, total income, total expenses, net (period-to-date).",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "generate_report",
      description:
        "Generate a downloadable financial report. Returns a file_id the user can download. Use when the user asks for a report, ميزان مراجعة، قائمة دخل، ميزانية، or wants Excel/PDF output.",
      parameters: {
        type: "object",
        properties: {
          report: {
            type: "string",
            enum: ["trial_balance", "profit_loss", "balance_sheet"],
          },
          format: { type: "string", enum: ["excel", "pdf"] },
        },
        required: ["report", "format"],
      },
    },
  },
];

/* ────────────────────────────────────────────────────────────────────────── */
/*  Tool result type — fed back into the model AND surfaced in chat UI        */
/* ────────────────────────────────────────────────────────────────────────── */

export type ToolArtifact =
  | { kind: "transaction"; type: "income" | "expense"; amount: number; description: string; category: string }
  | { kind: "journal_entry"; id: number; description: string; totalDebit: number; totalCredit: number; lines: number }
  | { kind: "file"; fileId: string; filename: string; mime: string; sizeKB: number; report: string; format: string };

export type ToolExecutionResult = {
  toolName: string;
  modelResult: any;       // returned to the LLM
  artifact?: ToolArtifact; // surfaced in chat UI
  error?: string;
};

/* ────────────────────────────────────────────────────────────────────────── */
/*  Dispatcher                                                                */
/* ────────────────────────────────────────────────────────────────────────── */

const txArgs = z.object({
  type: z.enum(["income", "expense"]),
  amount: z.coerce.number().positive(),
  description: z.string().min(1).max(200),
  category: z.string().min(1).max(50),
});

const jeArgs = z.object({
  description: z.string().min(1).max(300),
  entryDate: z.string().optional(),
  lines: z.array(z.object({
    accountId: z.number().int().positive(),
    debit: z.coerce.number().nonnegative().default(0),
    credit: z.coerce.number().nonnegative().default(0),
    description: z.string().max(300).optional(),
  })).min(2),
});

const reportArgs = z.object({
  report: z.enum(["trial_balance", "profit_loss", "balance_sheet"]),
  format: z.enum(["excel", "pdf"]),
});

export async function executeTool(
  name: string,
  rawArgs: any,
  ctx: { companyId: number; currency: string }
): Promise<ToolExecutionResult> {
  try {
    switch (name) {
      case "add_quick_transaction": {
        const a = txArgs.parse(rawArgs);
        await storage.createTransaction(
          ctx.companyId,
          { type: a.type, amount: a.amount, description: a.description, category: a.category },
          { source: "ai", actor: "AI assistant" }
        );
        return {
          toolName: name,
          modelResult: { ok: true, message: `Recorded ${a.type} ${a.amount} ${ctx.currency} — ${a.description}` },
          artifact: { kind: "transaction", type: a.type, amount: a.amount, description: a.description, category: a.category },
        };
      }

      case "create_journal_entry": {
        const a = jeArgs.parse(rawArgs);
        const totalDebit = a.lines.reduce((s, l) => s + Number(l.debit || 0), 0);
        const totalCredit = a.lines.reduce((s, l) => s + Number(l.credit || 0), 0);
        if (Math.abs(totalDebit - totalCredit) > 0.005 || totalDebit <= 0) {
          return { toolName: name, modelResult: { ok: false, error: `Unbalanced: debit=${totalDebit} credit=${totalCredit}` }, error: "unbalanced" };
        }
        const je = await storage.createJournalEntry(ctx.companyId, {
          description: a.description,
          source: "ai",
          entryDate: a.entryDate,
          lines: a.lines as any,
        }, { source: "ai", actor: "AI assistant" });
        return {
          toolName: name,
          modelResult: { ok: true, journalEntryId: je.id, totalDebit, totalCredit },
          artifact: { kind: "journal_entry", id: je.id, description: a.description, totalDebit, totalCredit, lines: a.lines.length },
        };
      }

      case "list_accounts": {
        const accounts = await storage.getAccounts(ctx.companyId);
        return {
          toolName: name,
          modelResult: accounts
            .filter((x) => !x.isHeader)
            .map((x) => ({ id: x.id, code: x.code, name: x.nameAr, type: x.type })),
        };
      }

      case "get_financial_summary": {
        const txs = await storage.getTransactions(ctx.companyId);
        const income = txs.filter((t) => t.type === "income").reduce((s, t) => s + Number(t.amount), 0);
        const expense = txs.filter((t) => t.type === "expense").reduce((s, t) => s + Number(t.amount), 0);
        return {
          toolName: name,
          modelResult: { currency: ctx.currency, income, expense, net: income - expense, txCount: txs.length },
        };
      }

      case "generate_report": {
        const a = reportArgs.parse(rawArgs);
        const accounts = await storage.getAccounts(ctx.companyId);
        const entries = await storage.getJournalEntries(ctx.companyId);
        let buffer: Buffer; let filename: string; let mime: string;
        const stamp = new Date().toISOString().slice(0, 10);

        if (a.report === "trial_balance") {
          buffer = a.format === "excel"
            ? await generateTrialBalanceExcel(accounts, entries, ctx.currency)
            : await generateTrialBalancePdf(accounts, entries, ctx.currency);
          filename = `trial-balance-${stamp}.${a.format === "excel" ? "xlsx" : "pdf"}`;
        } else if (a.report === "profit_loss") {
          buffer = a.format === "excel"
            ? await generateProfitLossExcel(accounts, entries, ctx.currency)
            : await generateProfitLossPdf(accounts, entries, ctx.currency);
          filename = `profit-loss-${stamp}.${a.format === "excel" ? "xlsx" : "pdf"}`;
        } else {
          buffer = a.format === "excel"
            ? await generateBalanceSheetExcel(accounts, entries, ctx.currency)
            : await generateBalanceSheetPdf(accounts, entries, ctx.currency);
          filename = `balance-sheet-${stamp}.${a.format === "excel" ? "xlsx" : "pdf"}`;
        }
        mime = a.format === "excel"
          ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          : "application/pdf";

        const stored = storeFile({ companyId: ctx.companyId, filename, mime, buffer });
        return {
          toolName: name,
          modelResult: { ok: true, fileId: stored.id, filename: stored.filename, sizeKB: stored.sizeKB },
          artifact: {
            kind: "file", fileId: stored.id, filename: stored.filename, mime: stored.mime,
            sizeKB: stored.sizeKB, report: a.report, format: a.format,
          },
        };
      }

      default:
        return { toolName: name, modelResult: { ok: false, error: `Unknown tool: ${name}` }, error: "unknown_tool" };
    }
  } catch (err: any) {
    console.error(`[assistant-tools] ${name} failed`, err);
    return {
      toolName: name,
      modelResult: { ok: false, error: err?.message || "Tool execution failed" },
      error: err?.message,
    };
  }
}
