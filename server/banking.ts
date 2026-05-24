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
} from "@shared/schema";
import { storage, type AuditContext } from "./storage";
import { eq, and, desc, sql } from "drizzle-orm";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

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

async function getLinkedAccountId(
  companyId: number,
  bankAccountId: number,
): Promise<number | null> {
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

// ─────────────────────────────────────────────────────────────────────────────
// Bank Accounts
// ─────────────────────────────────────────────────────────────────────────────

export async function listBankAccounts(companyId: number): Promise<BankAccount[]> {
  return db
    .select()
    .from(bankAccounts)
    .where(and(eq(bankAccounts.companyId, companyId), eq(bankAccounts.isActive, true)))
    .orderBy(bankAccounts.nameAr);
}

export async function createBankAccount(
  companyId: number,
  input: InsertBankAccount,
): Promise<BankAccount> {
  const [row] = await db
    .insert(bankAccounts)
    .values({ ...input, companyId })
    .returning();
  return row;
}

export async function updateBankAccount(
  companyId: number,
  id: number,
  input: Partial<InsertBankAccount>,
): Promise<BankAccount> {
  const [row] = await db
    .update(bankAccounts)
    .set(input)
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

export async function createBankTransaction(
  companyId: number,
  input: InsertBankTransaction,
  ctx?: AuditContext,
): Promise<BankTransactionWithAccount> {
  const reference = await nextBankTxnReference(companyId);
  const amount = round2(parseFloat(String(input.amount)));

  // Determine the bank's COA account
  const bankLinkedAccountId = await getLinkedAccountId(companyId, input.bankAccountId);

  // Auto-post journal entry
  let journalEntryId: number | null = null;
  try {
    if (input.txnType === "deposit") {
      // Dr Bank account / Cr counterpart (revenue/receivable/etc.)
      const debitAccountId = bankLinkedAccountId ?? (await findAccountByCode(companyId, "1100"));
      const creditAccountId = input.counterpartAccountId ?? (await findAccountByCode(companyId, "4010"));
      if (debitAccountId && creditAccountId) {
        const je = await storage.createJournalEntry(
          companyId,
          {
            reference: `BK-${reference}`,
            entryDate: input.txnDate ? new Date(input.txnDate).toISOString() : new Date().toISOString(),
            description: input.description,
            source: "manual",
            lines: [
              { accountId: debitAccountId, debit: String(amount), credit: "0", description: input.description },
              { accountId: creditAccountId, debit: "0", credit: String(amount), description: input.description },
            ],
          },
          ctx,
        );
        journalEntryId = je.id;
      }
    } else if (input.txnType === "withdrawal" || input.txnType === "fee") {
      // Dr counterpart (expense/payable) / Cr Bank
      const creditAccountId = bankLinkedAccountId ?? (await findAccountByCode(companyId, "1100"));
      const debitAccountId = input.counterpartAccountId ?? (await findAccountByCode(companyId, "5010"));
      if (debitAccountId && creditAccountId) {
        const je = await storage.createJournalEntry(
          companyId,
          {
            reference: `BK-${reference}`,
            entryDate: input.txnDate ? new Date(input.txnDate).toISOString() : new Date().toISOString(),
            description: input.description,
            source: "manual",
            lines: [
              { accountId: debitAccountId, debit: String(amount), credit: "0", description: input.description },
              { accountId: creditAccountId, debit: "0", credit: String(amount), description: input.description },
            ],
          },
          ctx,
        );
        journalEntryId = je.id;
      }
    } else if (input.txnType === "transfer" && input.counterpartBankAccountId) {
      // Dr target bank / Cr source bank
      const sourceBankAccountId = bankLinkedAccountId ?? (await findAccountByCode(companyId, "1100"));
      const targetLinkedAccountId = await getLinkedAccountId(companyId, input.counterpartBankAccountId);
      const targetBankAccountId = targetLinkedAccountId ?? (await findAccountByCode(companyId, "1100"));
      if (sourceBankAccountId && targetBankAccountId && sourceBankAccountId !== targetBankAccountId) {
        const je = await storage.createJournalEntry(
          companyId,
          {
            reference: `BK-${reference}`,
            entryDate: input.txnDate ? new Date(input.txnDate).toISOString() : new Date().toISOString(),
            description: input.description,
            source: "manual",
            lines: [
              { accountId: targetBankAccountId, debit: String(amount), credit: "0", description: input.description },
              { accountId: sourceBankAccountId, debit: "0", credit: String(amount), description: input.description },
            ],
          },
          ctx,
        );
        journalEntryId = je.id;
      }
    }
  } catch (_err) {
    // JE posting is best-effort; don't fail the transaction
  }

  const [row] = await db
    .insert(bankTransactions)
    .values({
      ...input,
      companyId,
      reference,
      amount: String(amount),
      journalEntryId,
      status: "posted",
    })
    .returning();

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

export async function deleteBankTransaction(companyId: number, id: number): Promise<void> {
  await db
    .delete(bankTransactions)
    .where(and(eq(bankTransactions.id, id), eq(bankTransactions.companyId, companyId)));
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
