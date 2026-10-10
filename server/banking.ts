/**
 * Banking simulation — مزامنة البنك
 *
 * Manages bank accounts linked to COA accounts, bank transactions
 * (deposits / withdrawals / transfers / fees), and auto-posts balanced
 * IFRS journal entries for each transaction.
 *
 * ZATCA e-invoicing configuration CRUD lives at the bottom of this file.
 */
import { db } from "./db";
import {
  bankAccounts,
  bankTransactions,
  zatcaConfigs,
  accounts,
  journalEntries,
  journalLines,
  type BankAccount,
  type InsertBankAccount,
  type BankTransaction,
  type InsertBankTransaction,
  type BankTransactionWithAccount,
  type ZatcaConfig,
  type InsertZatcaConfig,
  type BankAccountType,
} from "@shared/schema";
import { storage, recordJournalEntryReversalAudit, type AuditContext, type AuditWriter } from "./storage";
import { eq, and, desc, sql } from "drizzle-orm";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

async function nextBankTxnReference(companyId: number): Promise<string> {
  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(bankTransactions)
    .where(eq(bankTransactions.companyId, companyId));
  const seq = (result[0]?.count ?? 0) + 1;
  return `BKTXN-${String(seq).padStart(4, "0")}`;
}

async function getLinkedAccountId(companyId: number, bankAccountId: number): Promise<number | null> {
  const [ba] = await db
    .select({ linkedAccountId: bankAccounts.linkedAccountId })
    .from(bankAccounts)
    .where(and(eq(bankAccounts.id, bankAccountId), eq(bankAccounts.companyId, companyId)));
  return ba?.linkedAccountId ?? null;
}

async function findAccountByCode(companyId: number, code: string): Promise<number | null> {
  const [acc] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.companyId, companyId), eq(accounts.code, code)));
  return acc?.id ?? null;
}

export async function listBankAccounts(companyId: number): Promise<BankAccount[]> {
  return db
    .select()
    .from(bankAccounts)
    .where(and(eq(bankAccounts.companyId, companyId), eq(bankAccounts.isActive, true)))
    .orderBy(bankAccounts.nameAr);
}

export async function createBankAccount(companyId: number, input: InsertBankAccount): Promise<BankAccount> {
  const accountType = input.accountType as BankAccountType | undefined;
  const [row] = await db.insert(bankAccounts).values({ ...input, accountType, companyId }).returning();
  return row;
}

export async function updateBankAccount(
  companyId: number,
  id: number,
  input: Partial<InsertBankAccount>,
): Promise<BankAccount> {
  const update = {
    ...input,
    ...(input.accountType === undefined ? {} : { accountType: input.accountType as BankAccountType }),
  } as Partial<typeof bankAccounts.$inferInsert>;
  const [row] = await db
    .update(bankAccounts)
    .set(update)
    .where(and(eq(bankAccounts.id, id), eq(bankAccounts.companyId, companyId)))
    .returning();
  if (!row) throw new Error("حساب بنكي غير موجود");
  return row;
}

export async function deleteBankAccount(companyId: number, id: number): Promise<void> {
  await db
    .update(bankAccounts)
    .set({ isActive: false })
    .where(and(eq(bankAccounts.id, id), eq(bankAccounts.companyId, companyId)));
}

export async function getBankAccountBalance(
  companyId: number,
  bankAccountId: number,
): Promise<number> {
  const [ba] = await db
    .select({ openingBalance: bankAccounts.openingBalance })
    .from(bankAccounts)
    .where(and(eq(bankAccounts.id, bankAccountId), eq(bankAccounts.companyId, companyId)));
  const opening = parseFloat(ba?.openingBalance ?? "0");

  const txns = await db
    .select({ txnType: bankTransactions.txnType, amount: bankTransactions.amount })
    .from(bankTransactions)
    .where(
      and(
        eq(bankTransactions.companyId, companyId),
        eq(bankTransactions.bankAccountId, bankAccountId),
        eq(bankTransactions.status, "posted"),
      ),
    );

  let balance = opening;
  for (const t of txns) {
    const amt = parseFloat(t.amount);
    if (t.txnType === "deposit") balance += amt;
    else if (t.txnType === "withdrawal" || t.txnType === "fee") balance -= amt;
    else if (t.txnType === "transfer") balance -= amt;
    // inbound side of transfer is handled separately below
  }
  // Add inbound transfers where this account is the counterpart
  const inboundTransfers = await db
    .select({ amount: bankTransactions.amount })
    .from(bankTransactions)
    .where(
      and(
        eq(bankTransactions.companyId, companyId),
        eq(bankTransactions.counterpartBankAccountId, bankAccountId),
        eq(bankTransactions.txnType, "transfer"),
        eq(bankTransactions.status, "posted"),
      ),
    );
  for (const t of inboundTransfers) {
    balance += parseFloat(t.amount);
  }
  return round2(balance);
}

// ─────────────────────────────────────────────────────────────────────────────
// Bank Transactions
// ─────────────────────────────────────────────────────────────────────────────

export async function listBankTransactions(
  companyId: number,
  bankAccountId?: number,
): Promise<BankTransactionWithAccount[]> {
  const rows = await db
    .select({
      txn: bankTransactions,
      acct: {
        id: bankAccounts.id,
        nameAr: bankAccounts.nameAr,
        nameEn: bankAccounts.nameEn,
        bankName: bankAccounts.bankName,
        currency: bankAccounts.currency,
      },
    })
    .from(bankTransactions)
    .leftJoin(
      bankAccounts,
      and(
        eq(bankTransactions.bankAccountId, bankAccounts.id),
        eq(bankTransactions.companyId, bankAccounts.companyId),
      ),
    )
    .where(
      bankAccountId
        ? and(
            eq(bankTransactions.companyId, companyId),
            eq(bankTransactions.bankAccountId, bankAccountId),
          )
        : eq(bankTransactions.companyId, companyId),
    )
    .orderBy(desc(bankTransactions.txnDate));

  return rows.map((r) => ({
    ...r.txn,
    bankAccount: r.acct ?? null,
    journalEntryReference: null,
  }));
}

/**
 * Thrown when a bank transaction cannot be posted to a balanced journal
 * entry — e.g. the bank account (or its transfer counterpart) has no linked
 * chart-of-accounts account and both sides would collapse onto the same
 * fallback account, producing a degenerate (zero-effect) or unbalanced
 * entry. Surfaced to the route as a 500 with this message so the user is
 * told *why* the posting was refused instead of silently getting a bank row
 * with no journal entry behind it.
 */
export class BankTransactionPostingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BankTransactionPostingError";
  }
}

/**
 * Resolve the two COA accounts (debit, credit) that a bank transaction must
 * post to. Throws BankTransactionPostingError when the pair is missing or
 * would be degenerate (same account on both legs), so the caller never
 * writes a bank row that has no balanced journal entry behind it.
 */
// Fallback chart-of-accounts codes used when a bank account has no explicit
// `linkedAccountId` and the caller supplies no `counterpartAccountId`. These
// MUST be codes the standard seed actually creates (see server/sales.ts and
// the CoA seed): the old fallbacks `1100`/`4010`/`5010` were wrong — `1100` is
// a non-postable HEADER account ("Current Assets"), and `4010`/`5010` do not
// exist in any seeded workspace, so every bank transaction on a NULL-linked
// account threw "no linked chart-of-accounts account". We fall back to the
// same seeded accounts the rest of the app posts to:
const BANK_FALLBACK_CASH_CODE = "1110"; // Cash on Hand (postable; = CASH_ACCOUNT_CODE in sales.ts)
const BANK_FALLBACK_REVENUE_CODE = "4100"; // Sales Revenue (deposit counterpart)
const BANK_FALLBACK_EXPENSE_CODE = "5100"; // Cost of Goods Sold (withdrawal/fee counterpart)

async function resolveJournalAccounts(
  companyId: number,
  input: InsertBankTransaction,
  bankLinkedAccountId: number | null,
): Promise<{ debitAccountId: number; creditAccountId: number }> {
  if (input.txnType === "deposit") {
    // Dr Bank account / Cr counterpart (revenue/receivable/etc.)
    const debitAccountId = bankLinkedAccountId ?? (await findAccountByCode(companyId, BANK_FALLBACK_CASH_CODE));
    const creditAccountId = input.counterpartAccountId ?? (await findAccountByCode(companyId, BANK_FALLBACK_REVENUE_CODE));
    if (!debitAccountId || !creditAccountId) {
      throw new BankTransactionPostingError(
        "تعذّر ترحيل القيد: لا يوجد حساب مرتبط بالبنك أو الحساب المقابل. / Cannot post: the bank account or its counterpart has no linked chart-of-accounts account.",
      );
    }
    return { debitAccountId, creditAccountId };
  }

  if (input.txnType === "withdrawal" || input.txnType === "fee") {
    // Dr counterpart (expense/payable) / Cr Bank
    const creditAccountId = bankLinkedAccountId ?? (await findAccountByCode(companyId, BANK_FALLBACK_CASH_CODE));
    const debitAccountId = input.counterpartAccountId ?? (await findAccountByCode(companyId, BANK_FALLBACK_EXPENSE_CODE));
    if (!debitAccountId || !creditAccountId) {
      throw new BankTransactionPostingError(
        "تعذّر ترحيل القيد: لا يوجد حساب مرتبط بالبنك أو الحساب المقابل. / Cannot post: the bank account or its counterpart has no linked chart-of-accounts account.",
      );
    }
    return { debitAccountId, creditAccountId };
  }

  if (input.txnType === "transfer") {
    if (!input.counterpartBankAccountId) {
      throw new BankTransactionPostingError(
        "التحويل يتطلّب حساباً بنكيّاً مقابلاً. / A transfer requires a counterpart bank account.",
      );
    }
    // Dr target bank / Cr source bank
    const sourceBankAccountId = bankLinkedAccountId ?? (await findAccountByCode(companyId, BANK_FALLBACK_CASH_CODE));
    const targetLinkedAccountId = await getLinkedAccountId(companyId, input.counterpartBankAccountId);
    const targetBankAccountId = targetLinkedAccountId ?? (await findAccountByCode(companyId, BANK_FALLBACK_CASH_CODE));
    if (!sourceBankAccountId || !targetBankAccountId) {
      throw new BankTransactionPostingError(
        "تعذّر ترحيل التحويل: أحد الحسابين البنكيّين غير مرتبط بحساب في دليل الحسابات. / Cannot post transfer: one of the bank accounts has no linked chart-of-accounts account.",
      );
    }
    if (sourceBankAccountId === targetBankAccountId) {
      // Both legs collapsed onto the same account (e.g. neither bank is
      // linked and both fell back to 1100). Posting this would create a
      // Dr/Cr to the same account — a zero-effect entry that hides a real
      // money movement. Refuse instead of silently no-op'ing.
      throw new BankTransactionPostingError(
        "تعذّر ترحيل التحويل: الحسابان يشيران إلى الحساب نفسه في دليل الحسابات. اربط كل حساب بنكيّ بحساب مختلف. / Cannot post transfer: both legs resolve to the same chart-of-accounts account. Link each bank account to a distinct account.",
      );
    }
    return { debitAccountId: targetBankAccountId, creditAccountId: sourceBankAccountId };
  }

  throw new BankTransactionPostingError(
    `نوع معاملة غير مدعوم: ${input.txnType} / Unsupported transaction type: ${input.txnType}`,
  );
}

export async function createBankTransaction(
  companyId: number,
  input: InsertBankTransaction,
  ctx?: AuditContext,
): Promise<BankTransactionWithAccount> {
  const reference = await nextBankTxnReference(companyId);
  const amount = round2(parseFloat(String(input.amount)));

  // Determine the bank's COA account and the JE account pair up front. A
  // misconfigured chart of accounts throws here — before we open the
  // transaction — so nothing is written.
  const bankLinkedAccountId = await getLinkedAccountId(companyId, input.bankAccountId);
  const { debitAccountId, creditAccountId } = await resolveJournalAccounts(
    companyId,
    input,
    bankLinkedAccountId,
  );

  // Atomicity fix (C2): the journal entry and the bank-transaction row must
  // commit together or not at all. Previously the JE was created in a
  // best-effort try/catch and the bank row was inserted regardless, so a
  // failed JE left the row posted with journalEntryId=null — silently
  // unbalancing the books. We now open ONE transaction and thread its `tx`
  // into createJournalEntry so the JE header, lines, audit row, and the
  // bank-transaction insert are a single unit. Any failure rolls back the
  // whole thing and propagates to the route (which returns a 500 with the
  // message), rather than persisting a half-written movement.
  const row = await db.transaction(async (tx) => {
    const je = await storage.createJournalEntry(
      companyId,
      {
        entryDate: input.txnDate ? new Date(input.txnDate).toISOString() : new Date().toISOString(),
        description: input.description,
        source: "manual",
        lines: [
          { accountId: debitAccountId, debit: amount, credit: 0, description: input.description },
          { accountId: creditAccountId, debit: 0, credit: amount, description: input.description },
        ],
      },
      ctx,
      tx,
    );

    const [inserted] = await tx
      .insert(bankTransactions)
      .values({
        ...input,
        txnType: input.txnType as BankTransaction["txnType"],
        companyId,
        reference,
        amount: String(amount),
        journalEntryId: je.id,
        status: "posted",
      })
      .returning();

    return inserted;
  });

  const [ba] = await db
    .select({
      id: bankAccounts.id,
      nameAr: bankAccounts.nameAr,
      nameEn: bankAccounts.nameEn,
      bankName: bankAccounts.bankName,
      currency: bankAccounts.currency,
    })
    .from(bankAccounts)
    .where(eq(bankAccounts.id, row.bankAccountId));

  return { ...row, bankAccount: ba ?? null, journalEntryReference: null };
}

export async function deleteBankTransaction(
  companyId: number,
  id: number,
  ctx?: AuditContext,
): Promise<void> {
  // Scan finding f-d0ad6573: this used to be a bare DELETE that left the
  // Dr/Cr pair posted at create time stranded in the general ledger (bank
  // txns carry no FK to journal_entries, so the DB didn't stop it) and wrote
  // no audit row. We now reverse the linked JE atomically with the row delete
  // and record a reversal audit entry. Bank transactions are referenced by
  // nothing else, so no orphan-reference guard is needed here.
  const [row] = await db
    .select()
    .from(bankTransactions)
    .where(and(eq(bankTransactions.id, id), eq(bankTransactions.companyId, companyId)));
  if (!row) return;

  await db.transaction(async (tx) => {
    await tx
      .delete(bankTransactions)
      .where(and(eq(bankTransactions.id, id), eq(bankTransactions.companyId, companyId)));

    if (row.journalEntryId) {
      const [je] = await tx
        .select()
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.id, row.journalEntryId),
            eq(journalEntries.companyId, companyId),
          ),
        );
      if (je) {
        await tx.delete(journalLines).where(eq(journalLines.journalEntryId, je.id));
        await tx
          .delete(journalEntries)
          .where(and(eq(journalEntries.id, je.id), eq(journalEntries.companyId, companyId)));
        // Reversal audit row commits inside this same transaction (task #222)
        // so a failed audit write rolls back the JE + bank-row deletes.
        await recordJournalEntryReversalAudit(tx as unknown as AuditWriter, {
          companyId,
          journalEntry: je,
          reversedBy: `bank_transaction#${id}`,
          ctx,
        });
      }
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// ZATCA E-invoicing Configuration
// ─────────────────────────────────────────────────────────────────────────────

export async function getZatcaConfig(companyId: number): Promise<ZatcaConfig | null> {
  const [row] = await db
    .select()
    .from(zatcaConfigs)
    .where(eq(zatcaConfigs.companyId, companyId));
  return row ?? null;
}

export async function upsertZatcaConfig(
  companyId: number,
  input: InsertZatcaConfig,
): Promise<ZatcaConfig> {
  const existing = await getZatcaConfig(companyId);
  if (existing) {
    const [row] = await db
      .update(zatcaConfigs)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(zatcaConfigs.companyId, companyId))
      .returning();
    return row;
  }
  const [row] = await db
    .insert(zatcaConfigs)
    .values({ ...input, companyId })
    .returning();
  return row;
}

export async function deleteZatcaConfig(companyId: number): Promise<void> {
  await db.delete(zatcaConfigs).where(eq(zatcaConfigs.companyId, companyId));
}

// ─────────────────────────────────────────────────────────────────────────────
// ZATCA QR Code (TLV encoding — ZATCA e-invoicing spec)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generates a Base64-encoded ZATCA Phase 1 QR code value using TLV encoding.
 * Tags:
 *   1 = Seller name  (UTF-8)
 *   2 = VAT number   (UTF-8)
 *   3 = Timestamp    (ISO 8601)
 *   4 = Invoice total incl. VAT
 *   5 = VAT amount
 */
export function generateZatcaQr(params: {
  sellerName: string;
  vatNumber: string;
  invoiceDate: Date;
  totalWithVat: number;
  vatAmount: number;
}): string {
  function tlvField(tag: number, value: string): Buffer {
    const valBuf = Buffer.from(value, "utf-8");
    const header = Buffer.alloc(2);
    header[0] = tag;
    header[1] = valBuf.length;
    return Buffer.concat([header, valBuf]);
  }

  const ts = params.invoiceDate.toISOString();
  const totalStr = params.totalWithVat.toFixed(2);
  const vatStr = params.vatAmount.toFixed(2);

  const tlv = Buffer.concat([
    tlvField(1, params.sellerName),
    tlvField(2, params.vatNumber),
    tlvField(3, ts),
    tlvField(4, totalStr),
    tlvField(5, vatStr),
  ]);

  return tlv.toString("base64");
}
