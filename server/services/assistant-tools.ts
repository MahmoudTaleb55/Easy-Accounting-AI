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
import {
  generateCustomExcel,
  generateCustomWord,
  generateCustomPpt,
} from "./assistant-doc-generators";
import {
  createSalesInvoice,
  updateSalesInvoice,
  deleteSalesInvoice,
  postSalesInvoice,
} from "../sales";
import { createSalesInvoiceSchema, updateSalesInvoiceSchema } from "@shared/schema";

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
      name: "create_account",
      description:
        "Create a new GL account in the chart of accounts when a needed account doesn't exist. " +
        "Always run list_accounts first; only create an account when no existing one fits semantically. " +
        "Pick a `code` consistent with the existing numbering scheme of the parent (e.g. a new bank under " +
        "parent 1120 'البنوك' should be 1122/1123/...; a new operating expense under 6000 should be in the " +
        "6xxx range). If the chosen code already exists, the existing account is returned (idempotent — " +
        "safe to re-call). Returns { id, code, name } you can immediately use as accountId in create_journal_entry.",
      parameters: {
        type: "object",
        properties: {
          code:    { type: "string", description: "Account code, e.g. '1122' or '6210'. Must fit the parent's numbering range." },
          nameAr:  { type: "string", description: "Arabic name, e.g. 'بنك الأهلي'" },
          nameEn:  { type: "string", description: "English name (optional, defaults to nameAr)" },
          type:    { type: "string", enum: ["asset", "liability", "equity", "revenue", "expense"], description: "IFRS account type" },
          subtype: { type: "string", description: "e.g. current_asset, non_current_asset, current_liability, non_current_liability, capital, retained_earnings, operating_revenue, other_income, cogs, operating_expense, contra_revenue, contra_asset. Defaults to a sensible value derived from `type` if omitted." },
          parentCode: { type: "string", description: "Code of the parent (header) account, e.g. '1120' for a new bank, '6000' for a new opex. Optional but strongly recommended so the new account nests correctly in the tree." },
        },
        required: ["code", "nameAr", "type"],
      },
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

  /* ───────── transactions: read / delete ───────── */
  {
    type: "function" as const,
    function: {
      name: "list_transactions",
      description:
        "List recent transactions (newest first). Optionally filter by type, category substring, or limit. Use when the user asks to see, find, or review past transactions.",
      parameters: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["income", "expense"] },
          categoryContains: { type: "string", description: "Case-insensitive substring match on category" },
          descriptionContains: { type: "string" },
          limit: { type: "integer", description: "Max rows to return (default 25, max 100)" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "delete_transaction",
      description:
        "Delete a transaction by id. Use only after confirming with the user, or when the user explicitly says 'delete transaction X'.",
      parameters: {
        type: "object",
        properties: { id: { type: "integer" } },
        required: ["id"],
      },
    },
  },

  /* ───────── HR: employees, attendance, leaves ───────── */
  {
    type: "function" as const,
    function: {
      name: "list_employees",
      description: "List all employees in the workspace.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "create_employee",
      description: "Add a new employee to HR.",
      parameters: {
        type: "object",
        properties: {
          fullName: { type: "string" },
          jobTitle: { type: "string" },
          hireDate: { type: "string", description: "YYYY-MM-DD" },
          baseSalary: { type: "number" },
          allowances: { type: "number" },
          isNational: { type: "boolean" },
        },
        required: ["fullName", "hireDate", "baseSalary"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "record_attendance",
      description: "Record an attendance entry for one employee on one date.",
      parameters: {
        type: "object",
        properties: {
          employeeId: { type: "integer" },
          date: { type: "string", description: "YYYY-MM-DD" },
          status: { type: "string", enum: ["present", "absent", "leave", "holiday", "weekend"] },
          overtimeHours: { type: "number" },
        },
        required: ["employeeId", "date", "status"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "record_leave",
      description: "Create a leave entry for an employee (annual, sick, unpaid, other).",
      parameters: {
        type: "object",
        properties: {
          employeeId: { type: "integer" },
          startDate: { type: "string", description: "YYYY-MM-DD" },
          endDate: { type: "string", description: "YYYY-MM-DD" },
          days: { type: "integer" },
          type: { type: "string", enum: ["annual", "sick", "unpaid", "other"] },
          notes: { type: "string" },
        },
        required: ["employeeId", "startDate", "endDate", "days"],
      },
    },
  },

  /* ───────── Fixed assets ───────── */
  {
    type: "function" as const,
    function: {
      name: "list_fixed_assets",
      description: "List all fixed assets in the register.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_asset_categories",
      description:
        "List the workspace's fixed-asset categories (Equipment & Tools, Furniture & Fixtures, Vehicles, …) with their default useful-life and the GL accounts they post to. ALWAYS call this before create_fixed_asset to resolve the right categoryId — do not guess.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "create_fixed_asset",
      description:
        "Create ONE fixed asset (one row) under a workspace category and auto-generate its planned depreciation schedule. Does NOT post any journal entry on its own — after you've created all the asset rows for an invoice, call create_journal_entry exactly ONCE with the consolidated capitalising posting (one DR line per asset using its category cost account, single CR line on cash 1110 or AP 2110 for the invoice total — never expense). Always call list_asset_categories first to resolve categoryId; do not guess. For invoice lines with quantity > 1, call this once per unit so each unit has its own depreciation schedule, unless the user explicitly asks to group them.",
      parameters: {
        type: "object",
        properties: {
          categoryId: { type: "integer", description: "From list_asset_categories." },
          name: { type: "string", description: "Human-readable asset name — usually the invoice line description." },
          acquisitionDate: { type: "string", description: "YYYY-MM-DD — invoice date." },
          txCost: { type: "number", description: "Original cost in transaction currency (per unit, excluding any deductible VAT)." },
          code: { type: "string", description: "Optional short asset code (e.g. FA-2026-0001 or DESK-2026-1). Auto-generated from category prefix + sequence if omitted. Must be unique per workspace." },
          inServiceDate: { type: "string", description: "Optional YYYY-MM-DD. Defaults to acquisitionDate." },
          currency: { type: "string", description: "Optional ISO currency of the invoice (e.g. SAR, USD). Defaults to the workspace functional currency." },
          fxRate: { type: "number", description: "Rate to convert txCost → workspace functional currency. Default 1." },
          residual: { type: "number", description: "Estimated residual value at end of useful life. Default 0." },
          usefulLifeMonths: { type: "integer", description: "Useful life in months. If omitted, use the category default." },
          method: {
            type: "string",
            enum: ["straight_line", "declining_balance", "double_declining", "syd", "units_of_production", "custom"],
            description: "Depreciation method. Default straight_line.",
          },
          location: { type: "string" },
          custodian: { type: "string" },
        },
        required: ["categoryId", "name", "acquisitionDate", "txCost"],
      },
    },
  },

  /* ───────── Generic document generators ───────── */
  {
    type: "function" as const,
    function: {
      name: "generate_excel_document",
      description:
        "Generate a custom Excel workbook (.xlsx) from structured data. Use when the user asks for an Excel sheet that isn't one of the standard reports — e.g. 'export this list to Excel', 'make me an Excel of pending invoices', 'put this in a spreadsheet'. Each sheet has headers + rows.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Document title (used as filename and metadata)" },
          language: { type: "string", enum: ["ar", "en", "de", "fr"], description: "Document language for RTL detection" },
          sheets: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                headers: { type: "array", items: { type: "string" } },
                rows: {
                  type: "array",
                  items: { type: "array", items: { type: ["string", "number", "null"] } },
                },
              },
              required: ["name", "headers", "rows"],
            },
          },
        },
        required: ["title", "sheets"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "generate_word_document",
      description:
        "Generate a Word document (.docx) from structured blocks (headings, paragraphs, bullets, tables). Use when the user asks for a memo, letter, policy doc, narrative report, or any prose document. Supports Arabic RTL.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          language: { type: "string", enum: ["ar", "en", "de", "fr"] },
          blocks: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              properties: {
                kind: { type: "string", enum: ["heading", "paragraph", "bullet", "table"] },
                level: { type: "integer", description: "1|2|3 — required when kind=heading" },
                text: { type: "string", description: "for heading or paragraph" },
                bold: { type: "boolean" },
                items: { type: "array", items: { type: "string" }, description: "for bullet" },
                headers: { type: "array", items: { type: "string" }, description: "for table" },
                rows: {
                  type: "array",
                  items: { type: "array", items: { type: "string" } },
                  description: "for table",
                },
              },
              required: ["kind"],
            },
          },
        },
        required: ["title", "blocks"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "generate_powerpoint_document",
      description:
        "Generate a PowerPoint deck (.pptx) from structured slides. Use when the user asks for a presentation, board deck, pitch, or summary slides. Each slide has a title and bullets, optionally a table.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Deck cover title" },
          subtitle: { type: "string" },
          language: { type: "string", enum: ["ar", "en", "de", "fr"] },
          slides: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                bullets: { type: "array", items: { type: "string" } },
                notes: { type: "string", description: "Speaker notes" },
                table: {
                  type: "object",
                  properties: {
                    headers: { type: "array", items: { type: "string" } },
                    rows: { type: "array", items: { type: "array", items: { type: "string" } } },
                  },
                },
              },
              required: ["title"],
            },
          },
        },
        required: ["title", "slides"],
      },
    },
  },

  /* ───────── Sales Portal ───────── */
  {
    type: "function",
    function: {
      name: "find_customer",
      description:
        "Search the workspace's customer list by name (Arabic or English) or by code. Use this before creating a sales invoice to resolve the customerId.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Substring of the customer's Arabic/English name or code" },
          limit: { type: "integer", description: "Max rows to return (default 10, max 50)" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_customer",
      description:
        "Create a new customer in the workspace. Use when the user wants to invoice a name that's not in the customer list yet.",
      parameters: {
        type: "object",
        properties: {
          code: { type: "string", description: "Short customer code, e.g. CUST-0001" },
          nameAr: { type: "string", description: "Arabic name (required)" },
          nameEn: { type: "string", description: "English name (optional)" },
          email: { type: "string" },
          phone: { type: "string" },
          taxNumber: { type: "string" },
          address: { type: "string" },
          notes: { type: "string" },
        },
        required: ["code", "nameAr"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_recent_sales_invoices",
      description: "List the most recent sales invoices in the workspace (newest first).",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["draft", "posted", "cancelled"] },
          customerId: { type: "integer" },
          limit: { type: "integer", description: "Max rows (default 25, max 100)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_sales_invoice",
      description:
        "Create a sales invoice for a customer with one or more lines. Status 'posted' auto-posts the journal entry (DR AR/Cash, CR Sales/VAT, DR COGS/CR Inventory). Use 'draft' to leave it for later approval.",
      parameters: {
        type: "object",
        properties: {
          customerId: { type: "integer" },
          invoiceDate: { type: "string", description: "YYYY-MM-DD" },
          dueDate: { type: "string", description: "YYYY-MM-DD, optional" },
          status: { type: "string", enum: ["draft", "posted"], description: "Default draft" },
          paymentMethod: { type: "string", enum: ["credit", "cash"], description: "Default credit" },
          notes: { type: "string" },
          lines: {
            type: "array",
            items: {
              type: "object",
              properties: {
                productId: { type: "integer", description: "Optional — set when the line ties to a stocked product" },
                description: { type: "string" },
                quantity: { type: "number" },
                unitPrice: { type: "number" },
                vatRate: { type: "number", description: "Fraction, e.g. 0.15 for 15%" },
                unitCost: { type: "number", description: "Optional — used for COGS posting" },
              },
              required: ["quantity", "unitPrice"],
            },
            description: "At least one line required",
          },
        },
        required: ["customerId", "invoiceDate", "lines"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_sales_invoice",
      description:
        "Update a draft sales invoice's header or lines. Cannot edit posted invoices — cancel them first.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "integer" },
          customerId: { type: "integer" },
          invoiceDate: { type: "string" },
          dueDate: { type: "string" },
          paymentMethod: { type: "string", enum: ["credit", "cash"] },
          notes: { type: "string" },
          lines: {
            type: "array",
            items: {
              type: "object",
              properties: {
                productId: { type: "integer" },
                description: { type: "string" },
                quantity: { type: "number" },
                unitPrice: { type: "number" },
                vatRate: { type: "number" },
                unitCost: { type: "number" },
              },
              required: ["quantity", "unitPrice"],
            },
          },
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_sales_invoice",
      description:
        "Delete a sales invoice. Posted invoices are reversed first (their JE is undone) and then removed.",
      parameters: {
        type: "object",
        properties: { id: { type: "integer" } },
        required: ["id"],
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
  | { kind: "file"; fileId: string; filename: string; mime: string; sizeKB: number; report: string; format: string }
  | { kind: "employee"; id: number; fullName: string; jobTitle: string; baseSalary: number }
  | { kind: "attendance"; id: number; employeeId: number; date: string; status: string }
  | { kind: "leave"; id: number; employeeId: number; startDate: string; endDate: string; days: number; type: string }
  | { kind: "account"; id: number; code: string; name: string; type: string }
  | { kind: "fixed_asset"; id: number; code: string; name: string; cost: number; currency: string; categoryName: string; usefulLifeMonths: number; method: string }
  | { kind: "deletion"; entity: string; id: number };

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

const accountTypeEnum = z.enum(["asset", "liability", "equity", "revenue", "expense"]);

// Allow-list of subtypes per IFRS type. The Balance Sheet / P&L grouping
// in routes.ts is subtype-driven, so a free-form string here would let the
// assistant silently corrupt report sections. We restrict to the values
// that the seeded COA uses so reports keep classifying correctly.
const SUBTYPES_BY_TYPE: Record<z.infer<typeof accountTypeEnum>, readonly string[]> = {
  asset:     ["current_asset", "non_current_asset", "contra_asset"],
  liability: ["current_liability", "non_current_liability"],
  equity:    ["capital", "retained_earnings", "drawings", "reserves"],
  revenue:   ["operating_revenue", "other_income", "contra_revenue"],
  expense:   ["cogs", "operating_expense", "other_expense"],
};

const createAccountArgs = z
  .object({
    // Codes are short alphanumeric strings ("1110", "6210", optionally with
    // dashes for sub-ledgers). Trim whitespace because LLMs sometimes pad them.
    code: z.string().trim().min(1).max(20),
    nameAr: z.string().trim().min(1).max(200),
    nameEn: z.string().trim().max(200).optional(),
    type: accountTypeEnum,
    subtype: z.string().trim().max(60).optional(),
    parentCode: z.string().trim().min(1).max(20).optional(),
    // `isHeader` is intentionally NOT exposed to the LLM. The seeded COA owns
    // grouping rows; the assistant should only create postable leaves so it
    // can't accidentally produce a "header" that callers then try to post to.
  })
  .superRefine((v, ctx) => {
    if (v.subtype && !SUBTYPES_BY_TYPE[v.type].includes(v.subtype)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["subtype"],
        message: `subtype "${v.subtype}" is not valid for type "${v.type}". Allowed: ${SUBTYPES_BY_TYPE[v.type].join(", ")}`,
      });
    }
  });

// Sensible default subtype per IFRS type so the LLM doesn't have to supply
// `subtype` for every routine create. The LLM can always override.
function defaultSubtypeForType(type: z.infer<typeof accountTypeEnum>): string {
  switch (type) {
    case "asset":     return "current_asset";
    case "liability": return "current_liability";
    case "equity":    return "capital";
    case "revenue":   return "operating_revenue";
    case "expense":   return "operating_expense";
  }
}

function slugify(s: string): string {
  return (
    s
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\w\u0600-\u06FF\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 60) || "document"
  );
}

export async function executeTool(
  name: string,
  rawArgs: any,
  ctx: { companyId: number; currency: string; actor?: string | null; locale?: "ar" | "en" | "de" | "fr" }
): Promise<ToolExecutionResult> {
  // The assistant is just a channel — record the human who told it to act so
  // the History drawer shows "Sara" with an AI source badge instead of an
  // anonymous "AI assistant" label. Fall back to "AI assistant" when there is
  // no signed-in user (defensive only — the chat route is auth-gated).
  const aiAudit = { source: "ai" as const, actor: ctx.actor ?? "AI assistant" };
  try {
    switch (name) {
      case "add_quick_transaction": {
        const a = txArgs.parse(rawArgs);
        const created = await storage.createTransaction(
          ctx.companyId,
          { type: a.type, amount: a.amount, description: a.description, category: a.category },
          aiAudit
        );
        return {
          toolName: name,
          // Surface the transaction id so the chat handler can resolve the
          // auto-posted journal entry id (via getJournalEntryIdByTransactionId)
          // and link any chat-attached receipt to it in the document inbox.
          modelResult: { ok: true, transactionId: created.id, message: `Recorded ${a.type} ${a.amount} ${ctx.currency} — ${a.description}` },
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

        // Reject posting to header/grouping rows or to accounts that don't
        // belong to this workspace. Without this, an LLM could happily post
        // to a "1100 — Current Assets" header or to an id leaked from a
        // different tenant, both of which corrupt reports.
        const wsAccounts = await storage.getAccounts(ctx.companyId);
        const accountIndex = new Map(wsAccounts.map((x) => [x.id, x] as const));
        for (const line of a.lines) {
          const acc = accountIndex.get(line.accountId);
          if (!acc) {
            return {
              toolName: name,
              modelResult: { ok: false, error: `accountId ${line.accountId} is not in this workspace's chart of accounts. Use list_accounts (or create_account) to get a valid id.` },
              error: "invalid_account",
            };
          }
          if (acc.isHeader) {
            return {
              toolName: name,
              modelResult: { ok: false, error: `Account ${acc.code} (${acc.nameAr}) is a grouping/header row and cannot receive postings. Use a leaf account or call create_account.` },
              error: "header_account",
            };
          }
        }

        const je = await storage.createJournalEntry(ctx.companyId, {
          description: a.description,
          source: "ai",
          entryDate: a.entryDate,
          lines: a.lines as any,
        }, aiAudit);
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

      case "create_account": {
        const a = createAccountArgs.parse(rawArgs);

        // Fast path: pre-check for an existing row with the same code. This
        // covers the common "LLM re-tries the same call" case without paying
        // for an INSERT round-trip.
        const existing = await storage.getAccountByCode(ctx.companyId, a.code);
        if (existing) {
          return {
            toolName: name,
            modelResult: {
              ok: true,
              created: false,
              id: existing.id,
              code: existing.code,
              name: existing.nameAr,
              type: existing.type,
              message: `Account ${a.code} (${existing.nameAr}) already exists — returning existing id.`,
            },
          };
        }

        // Resolve parent by code (workspace-scoped) so the LLM doesn't have
        // to guess parent ids — and so the parent FK can never cross
        // workspace boundaries.
        let parentId: number | undefined;
        if (a.parentCode) {
          const parent = await storage.getAccountByCode(ctx.companyId, a.parentCode);
          if (!parent) {
            return {
              toolName: name,
              modelResult: {
                ok: false,
                error: `Parent account code "${a.parentCode}" not found in this workspace. Run list_accounts to see available codes.`,
              },
              error: "parent_not_found",
            };
          }
          parentId = parent.id;
        }

        // Atomic idempotency: catch the (company_id, code) UNIQUE violation
        // raised by the DB if a concurrent caller inserted the same code
        // between our pre-check and our INSERT, and return that row instead
        // of bubbling up a 500 to the LLM.
        try {
          const created = await storage.createAccount(
            ctx.companyId,
            {
              code: a.code,
              nameAr: a.nameAr,
              nameEn: a.nameEn ?? a.nameAr,
              type: a.type,
              subtype: a.subtype ?? defaultSubtypeForType(a.type),
              parentId: parentId ?? null,
              isHeader: false,
              isActive: true,
            } as any,
            aiAudit
          );
          return {
            toolName: name,
            modelResult: {
              ok: true,
              created: true,
              id: created.id,
              code: created.code,
              name: created.nameAr,
              type: created.type,
            },
            artifact: { kind: "account", id: created.id, code: created.code, name: created.nameAr, type: created.type },
          };
        } catch (err: any) {
          const isUniqueViolation =
            err?.code === "23505" ||
            /accounts_code_company_uq/i.test(err?.message ?? "") ||
            /duplicate key/i.test(err?.message ?? "");
          if (isUniqueViolation) {
            const raced = await storage.getAccountByCode(ctx.companyId, a.code);
            if (raced) {
              return {
                toolName: name,
                modelResult: {
                  ok: true,
                  created: false,
                  id: raced.id,
                  code: raced.code,
                  name: raced.nameAr,
                  type: raced.type,
                  message: `Account ${a.code} already exists — returning existing id.`,
                },
              };
            }
          }
          throw err;
        }
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
        // The chat surface threads the user's UI locale into ctx — fall back
        // to Arabic for legacy callers that hadn't been updated yet. Only
        // PDF generators are localized in this slice; Excel localization is
        // tracked separately.
        const reportLocale = ctx.locale ?? "ar";

        if (a.report === "trial_balance") {
          buffer = a.format === "excel"
            ? await generateTrialBalanceExcel(accounts, entries, ctx.currency)
            : await generateTrialBalancePdf(accounts, entries, ctx.currency, reportLocale);
          filename = `trial-balance-${stamp}.${a.format === "excel" ? "xlsx" : "pdf"}`;
        } else if (a.report === "profit_loss") {
          buffer = a.format === "excel"
            ? await generateProfitLossExcel(accounts, entries, ctx.currency)
            : await generateProfitLossPdf(accounts, entries, ctx.currency, reportLocale);
          filename = `profit-loss-${stamp}.${a.format === "excel" ? "xlsx" : "pdf"}`;
        } else {
          buffer = a.format === "excel"
            ? await generateBalanceSheetExcel(accounts, entries, ctx.currency)
            : await generateBalanceSheetPdf(accounts, entries, ctx.currency, reportLocale);
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

      /* ───────── transactions: list & delete ───────── */
      case "list_transactions": {
        const a = z.object({
          type: z.enum(["income", "expense"]).optional(),
          categoryContains: z.string().optional(),
          descriptionContains: z.string().optional(),
          limit: z.coerce.number().int().min(1).max(100).default(25),
        }).parse(rawArgs);
        let txs = await storage.getTransactions(ctx.companyId);
        if (a.type) txs = txs.filter((t) => t.type === a.type);
        if (a.categoryContains) {
          const q = a.categoryContains.toLowerCase();
          txs = txs.filter((t) => (t.category || "").toLowerCase().includes(q));
        }
        if (a.descriptionContains) {
          const q = a.descriptionContains.toLowerCase();
          txs = txs.filter((t) => (t.description || "").toLowerCase().includes(q));
        }
        // newest first if a date column exists; else fall back to id
        const sorted = txs.sort((x, y) => Number((y as any).id || 0) - Number((x as any).id || 0));
        const items = sorted.slice(0, a.limit).map((t) => ({
          id: (t as any).id,
          type: t.type,
          amount: Number(t.amount),
          description: t.description,
          category: t.category,
          date: (t as any).date,
        }));
        return { toolName: name, modelResult: { count: items.length, items, currency: ctx.currency } };
      }

      case "delete_transaction": {
        const a = z.object({ id: z.coerce.number().int().positive() }).parse(rawArgs);
        await storage.deleteTransaction(ctx.companyId, a.id, aiAudit);
        return {
          toolName: name,
          modelResult: { ok: true, deletedId: a.id },
          artifact: { kind: "deletion", entity: "transaction", id: a.id },
        };
      }

      /* ───────── HR ───────── */
      case "list_employees": {
        const emps = await storage.getEmployees(ctx.companyId);
        return {
          toolName: name,
          modelResult: emps.map((e) => ({
            id: e.id, fullName: e.fullName, jobTitle: e.jobTitle,
            hireDate: e.hireDate, baseSalary: Number(e.baseSalary),
            allowances: Number(e.allowances), isActive: e.isActive,
          })),
        };
      }

      case "create_employee": {
        const a = z.object({
          fullName: z.string().min(1).max(120),
          jobTitle: z.string().max(120).default(""),
          hireDate: z.string().min(1),
          baseSalary: z.coerce.number().nonnegative(),
          allowances: z.coerce.number().nonnegative().default(0),
          isNational: z.boolean().default(true),
        }).parse(rawArgs);
        const emp = await storage.createEmployee(ctx.companyId, {
          fullName: a.fullName, jobTitle: a.jobTitle, hireDate: a.hireDate,
          baseSalary: a.baseSalary as any, allowances: a.allowances as any,
          isNational: a.isNational, isActive: true,
        } as any, aiAudit);
        return {
          toolName: name,
          modelResult: { ok: true, id: emp.id, fullName: emp.fullName },
          artifact: { kind: "employee", id: emp.id, fullName: emp.fullName, jobTitle: emp.jobTitle, baseSalary: Number(emp.baseSalary) },
        };
      }

      case "record_attendance": {
        const a = z.object({
          employeeId: z.coerce.number().int().positive(),
          date: z.string().min(1),
          status: z.enum(["present", "absent", "leave", "holiday", "weekend"]),
          overtimeHours: z.coerce.number().nonnegative().default(0),
        }).parse(rawArgs);
        const att = await storage.upsertAttendance(ctx.companyId, {
          employeeId: a.employeeId, date: a.date, status: a.status,
          overtimeHours: a.overtimeHours as any,
        }, aiAudit);
        return {
          toolName: name,
          modelResult: { ok: true, id: att.id },
          artifact: { kind: "attendance", id: att.id, employeeId: a.employeeId, date: a.date, status: a.status },
        };
      }

      case "record_leave": {
        const a = z.object({
          employeeId: z.coerce.number().int().positive(),
          startDate: z.string().min(1),
          endDate: z.string().min(1),
          days: z.coerce.number().int().positive(),
          type: z.enum(["annual", "sick", "unpaid", "other"]).default("annual"),
          notes: z.string().max(500).optional(),
        }).parse(rawArgs);
        const lv = await storage.createLeave(ctx.companyId, {
          employeeId: a.employeeId, startDate: a.startDate, endDate: a.endDate,
          days: a.days, type: a.type, status: "approved",
          notes: a.notes || "",
        } as any, aiAudit);
        return {
          toolName: name,
          modelResult: { ok: true, id: lv.id },
          artifact: { kind: "leave", id: lv.id, employeeId: a.employeeId, startDate: a.startDate, endDate: a.endDate, days: a.days, type: a.type },
        };
      }

      /* ───────── Fixed assets ───────── */
      case "list_fixed_assets": {
        const list = await storage.getFixedAssets(ctx.companyId);
        return {
          toolName: name,
          modelResult: list.map((a) => ({
            id: a.id, code: a.code, name: a.name,
            cost: Number(a.cost), currency: a.currency,
            acquisitionDate: a.acquisitionDate, status: a.status,
            accumDepreciation: Number(a.accumDepreciation),
          })),
        };
      }

      case "list_asset_categories": {
        const cats = await storage.getAssetCategories(ctx.companyId);
        return {
          toolName: name,
          modelResult: cats.map((c) => ({
            id: c.id,
            name: c.name,
            measurementModel: c.measurementModel,
            defaultMethod: c.defaultMethod,
            defaultUsefulLifeMonths: c.defaultUsefulLifeMonths,
            assetCostAccountId: c.assetCostAccountId,
            accumulatedDepAccountId: c.accumulatedDepAccountId,
            depExpenseAccountId: c.depExpenseAccountId,
          })),
        };
      }

      case "create_fixed_asset": {
        const a = z.object({
          categoryId: z.coerce.number().int().positive(),
          name: z.string().trim().min(1).max(200),
          acquisitionDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "acquisitionDate must be YYYY-MM-DD"),
          txCost: z.coerce.number().positive(),
          // Optional — defaults applied below
          code: z.string().trim().min(1).max(40).optional(),
          inServiceDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "inServiceDate must be YYYY-MM-DD").optional(),
          currency: z.string().trim().min(1).max(8).optional(),
          fxRate: z.coerce.number().positive().default(1),
          residual: z.coerce.number().nonnegative().default(0),
          usefulLifeMonths: z.coerce.number().int().positive().optional(),
          method: z.enum([
            "straight_line", "declining_balance", "double_declining", "syd", "units_of_production", "custom",
          ]).default("straight_line"),
          location: z.string().trim().max(120).optional(),
          custodian: z.string().trim().max(120).optional(),
        }).parse(rawArgs);
        const cat = (await storage.getAssetCategories(ctx.companyId)).find((c) => c.id === a.categoryId);
        if (!cat) {
          return {
            toolName: name,
            modelResult: { ok: false, error: `Unknown asset category id ${a.categoryId}. Call list_asset_categories first.` },
            error: "invalid_category",
          };
        }
        // Default inServiceDate to acquisitionDate; default currency to the
        // workspace functional currency (looked up from `companies` directly
        // since storage doesn't expose a single-row getter).
        const inServiceDate = a.inServiceDate ?? a.acquisitionDate;
        let currency = a.currency;
        if (!currency) {
          const { db } = await import("../db");
          const { companies } = await import("@shared/schema");
          const { eq } = await import("drizzle-orm");
          const [co] = await db.select({ functionalCurrency: companies.functionalCurrency })
            .from(companies).where(eq(companies.id, ctx.companyId)).limit(1);
          currency = co?.functionalCurrency ?? "USD";
        }
        // Auto-generate code if not supplied: <CATPREFIX>-<seq>, where prefix
        // is the first 3 alphabetic chars of the category name (uppercased,
        // ASCII-only, falls back to "FA"). Sequence is monotonic per category
        // (max existing sequence + 1) so deletions don't cause collisions.
        let code = a.code;
        if (!code) {
          const rawPrefix = (cat.name.normalize("NFKD").replace(/[^A-Za-z]/g, "").slice(0, 3) || "FA").toUpperCase();
          const existing = await storage.getFixedAssets(ctx.companyId);
          const sameCat = existing.filter((x) => x.categoryId === a.categoryId);
          const re = new RegExp(`^${rawPrefix}-(\\d+)$`);
          const maxSeq = sameCat.reduce((m, x) => {
            const mx = re.exec(x.code);
            return mx ? Math.max(m, parseInt(mx[1], 10)) : m;
          }, 0);
          code = `${rawPrefix}-${String(maxSeq + 1).padStart(4, "0")}`;
        }
        const usefulLifeMonths = a.usefulLifeMonths ?? cat.defaultUsefulLifeMonths;
        const cost = a.txCost * a.fxRate;
        const created = await storage.createFixedAsset(
          {
            companyId: ctx.companyId,
            categoryId: a.categoryId,
            code,
            name: a.name,
            acquisitionDate: a.acquisitionDate,
            inServiceDate,
            currency,
            txCost: a.txCost,
            fxRate: a.fxRate,
            residual: a.residual,
            usefulLifeMonths,
            method: a.method,
            measurementModel: cat.measurementModel as "cost" | "revaluation",
            cost,
            location: a.location ?? "",
            custodian: a.custodian ?? "",
            customSchedule: null,
            unitsTotal: null,
          } satisfies Parameters<typeof storage.createFixedAsset>[0],
          aiAudit,
        );
        // Auto-generate the planned depreciation schedule (mirrors POST /api/fixed-assets).
        if (created.method !== "units_of_production" && created.method !== "custom") {
          const fa = await import("../fixed-assets");
          const sched = fa.generateSchedule(fa.unitFromAsset(created));
          await storage.replaceSchedule(
            ctx.companyId,
            created.id,
            sched.map((r) => ({ periodYear: r.year, periodMonth: r.month, plannedAmount: r.amount })),
          );
        }
        return {
          toolName: name,
          modelResult: {
            ok: true,
            id: created.id,
            code: created.code,
            name: created.name,
            categoryId: created.categoryId,
            categoryName: cat.name,
            cost: Number(created.cost),
            currency: created.currency,
            usefulLifeMonths: created.usefulLifeMonths,
            method: created.method,
            assetCostAccountId: cat.assetCostAccountId,
          },
          artifact: {
            kind: "fixed_asset",
            id: created.id,
            code: created.code,
            name: created.name,
            cost: Number(created.cost),
            currency: created.currency,
            categoryName: cat.name,
            usefulLifeMonths: created.usefulLifeMonths,
            method: created.method,
          },
        };
      }

      /* ───────── Custom document generators ───────── */
      case "generate_excel_document": {
        const a = z.object({
          title: z.string().min(1).max(120),
          language: z.enum(["ar", "en", "de", "fr"]).optional(),
          sheets: z.array(z.object({
            name: z.string().min(1).max(80),
            headers: z.array(z.string()).default([]),
            rows: z.array(z.array(z.union([z.string(), z.number(), z.null()]))).default([]),
          })).min(1).max(20),
        }).parse(rawArgs);
        const buffer = await generateCustomExcel(a);
        const filename = `${slugify(a.title)}.xlsx`;
        const stored = storeFile({
          companyId: ctx.companyId, filename, buffer,
          mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        });
        return {
          toolName: name,
          modelResult: { ok: true, fileId: stored.id, filename: stored.filename, sizeKB: stored.sizeKB },
          artifact: { kind: "file", fileId: stored.id, filename: stored.filename, mime: stored.mime, sizeKB: stored.sizeKB, report: "custom_excel", format: "excel" },
        };
      }

      case "generate_word_document": {
        const a = z.object({
          title: z.string().min(1).max(160),
          language: z.enum(["ar", "en", "de", "fr"]).optional(),
          blocks: z.array(z.object({
            kind: z.enum(["heading", "paragraph", "bullet", "table"]),
            level: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
            text: z.string().optional(),
            bold: z.boolean().optional(),
            items: z.array(z.string()).optional(),
            headers: z.array(z.string()).optional(),
            rows: z.array(z.array(z.string())).optional(),
          })).min(1).max(200),
        }).parse(rawArgs);
        // Validate per-kind required fields
        const blocks = a.blocks.map((b) => {
          if (b.kind === "heading") return { kind: "heading" as const, level: (b.level ?? 1) as 1 | 2 | 3, text: b.text || "" };
          if (b.kind === "paragraph") return { kind: "paragraph" as const, text: b.text || "", bold: b.bold };
          if (b.kind === "bullet") return { kind: "bullet" as const, items: b.items || [] };
          return { kind: "table" as const, headers: b.headers || [], rows: b.rows || [] };
        });
        const buffer = await generateCustomWord({ title: a.title, language: a.language, blocks });
        const filename = `${slugify(a.title)}.docx`;
        const stored = storeFile({
          companyId: ctx.companyId, filename, buffer,
          mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        });
        return {
          toolName: name,
          modelResult: { ok: true, fileId: stored.id, filename: stored.filename, sizeKB: stored.sizeKB },
          artifact: { kind: "file", fileId: stored.id, filename: stored.filename, mime: stored.mime, sizeKB: stored.sizeKB, report: "custom_word", format: "word" },
        };
      }

      case "generate_powerpoint_document": {
        const a = z.object({
          title: z.string().min(1).max(160),
          subtitle: z.string().max(240).optional(),
          language: z.enum(["ar", "en", "de", "fr"]).optional(),
          slides: z.array(z.object({
            title: z.string().min(1).max(160),
            bullets: z.array(z.string()).optional(),
            notes: z.string().optional(),
            table: z.object({
              headers: z.array(z.string()),
              rows: z.array(z.array(z.string())),
            }).optional(),
          })).min(1).max(60),
        }).parse(rawArgs);
        const buffer = await generateCustomPpt(a);
        const filename = `${slugify(a.title)}.pptx`;
        const stored = storeFile({
          companyId: ctx.companyId, filename, buffer,
          mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        });
        return {
          toolName: name,
          modelResult: { ok: true, fileId: stored.id, filename: stored.filename, sizeKB: stored.sizeKB },
          artifact: { kind: "file", fileId: stored.id, filename: stored.filename, mime: stored.mime, sizeKB: stored.sizeKB, report: "custom_pptx", format: "pptx" },
        };
      }

      /* ───────── Sales Portal ───────── */
      case "find_customer": {
        const a = z
          .object({ query: z.string().trim().min(1).max(200), limit: z.coerce.number().int().min(1).max(50).default(10) })
          .parse(rawArgs);
        const all = await storage.listCustomers(ctx.companyId);
        const q = a.query.toLowerCase();
        const matches = all
          .filter(
            (c) =>
              c.code.toLowerCase().includes(q) ||
              c.nameAr.toLowerCase().includes(q) ||
              c.nameEn.toLowerCase().includes(q),
          )
          .slice(0, a.limit)
          .map((c) => ({
            id: c.id,
            code: c.code,
            nameAr: c.nameAr,
            nameEn: c.nameEn,
            phone: c.phone,
            email: c.email,
          }));
        return { toolName: name, modelResult: { count: matches.length, items: matches } };
      }

      case "create_customer": {
        const a = z
          .object({
            code: z.string().trim().min(1).max(40),
            nameAr: z.string().trim().min(1).max(160),
            nameEn: z.string().trim().max(160).default(""),
            email: z.string().trim().max(160).default(""),
            phone: z.string().trim().max(40).default(""),
            taxNumber: z.string().trim().max(40).default(""),
            address: z.string().trim().max(400).default(""),
            notes: z.string().trim().max(800).default(""),
          })
          .parse(rawArgs);
        try {
          const created = await storage.createCustomer(
            ctx.companyId,
            { ...a, isActive: true },
            aiAudit,
          );
          return {
            toolName: name,
            modelResult: { ok: true, id: created.id, code: created.code, nameAr: created.nameAr },
          };
        } catch (err: any) {
          if (err?.code === "23505" || /duplicate key/i.test(err?.message ?? "")) {
            const existing = (await storage.listCustomers(ctx.companyId)).find(
              (c) => c.code.toLowerCase() === a.code.toLowerCase(),
            );
            if (existing) {
              return {
                toolName: name,
                modelResult: {
                  ok: true,
                  id: existing.id,
                  code: existing.code,
                  nameAr: existing.nameAr,
                  message: `Customer with code ${a.code} already exists — returning existing id.`,
                },
              };
            }
          }
          throw err;
        }
      }

      case "list_recent_sales_invoices": {
        const a = z
          .object({
            status: z.enum(["draft", "posted", "cancelled"]).optional(),
            customerId: z.coerce.number().int().positive().optional(),
            limit: z.coerce.number().int().min(1).max(100).default(25),
          })
          .parse(rawArgs);
        const list = await storage.listSalesInvoices(ctx.companyId, {
          status: a.status,
          customerId: a.customerId,
        });
        const items = list.slice(0, a.limit).map((inv) => ({
          id: inv.id,
          number: inv.number,
          customerId: inv.customerId,
          customerName: inv.customer?.nameAr || inv.customer?.nameEn || null,
          invoiceDate: inv.invoiceDate,
          status: inv.status,
          paymentMethod: inv.paymentMethod,
          subtotal: Number(inv.subtotal),
          vatAmount: Number(inv.vatAmount),
          totalAmount: Number(inv.totalAmount),
          journalEntryId: inv.journalEntryId,
        }));
        return { toolName: name, modelResult: { count: items.length, items, currency: ctx.currency } };
      }

      case "create_sales_invoice": {
        const parsed = createSalesInvoiceSchema.parse(rawArgs);
        const desiredStatus = parsed.status;
        // Always create as draft, then post in a separate step so the
        // assistant gets back the auto-posted JE id when appropriate.
        const draftInput = { ...parsed, status: "draft" as const };
        const created = await createSalesInvoice(ctx.companyId, draftInput, aiAudit);
        let final = created;
        if (desiredStatus === "posted") {
          final = await postSalesInvoice(ctx.companyId, created.id, aiAudit);
        }
        return {
          toolName: name,
          modelResult: {
            ok: true,
            id: final.id,
            number: final.number,
            status: final.status,
            totalAmount: Number(final.totalAmount),
            journalEntryId: final.journalEntryId,
          },
          artifact:
            final.journalEntryId != null
              ? {
                  kind: "journal_entry",
                  id: final.journalEntryId,
                  description: `Sales invoice ${final.number}`,
                  totalDebit: Number(final.totalAmount) + Number(final.cogsAmount),
                  totalCredit: Number(final.totalAmount) + Number(final.cogsAmount),
                  lines: final.lines.length,
                }
              : undefined,
        };
      }

      case "update_sales_invoice": {
        const a = z
          .object({ id: z.coerce.number().int().positive() })
          .passthrough()
          .parse(rawArgs);
        const { id, ...rest } = a;
        const patch = updateSalesInvoiceSchema.parse(rest);
        const updated = await updateSalesInvoice(ctx.companyId, id, patch, aiAudit);
        return {
          toolName: name,
          modelResult: {
            ok: true,
            id: updated.id,
            number: updated.number,
            status: updated.status,
            totalAmount: Number(updated.totalAmount),
          },
        };
      }

      case "delete_sales_invoice": {
        const a = z.object({ id: z.coerce.number().int().positive() }).parse(rawArgs);
        await deleteSalesInvoice(ctx.companyId, a.id, aiAudit);
        return {
          toolName: name,
          modelResult: { ok: true, deletedId: a.id },
          artifact: { kind: "deletion", entity: "sales_invoice", id: a.id },
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
