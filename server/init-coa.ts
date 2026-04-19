import { db } from "./db";
import { accounts, journalEntries, journalLines, transactions } from "@shared/schema";
import { DEFAULT_COA, CASH_ACCOUNT_CODE, pickExpenseAccountCode, pickRevenueAccountCode, PAYROLL_EXTRA_ACCOUNTS } from "@shared/coa-seed";
import { eq, sql } from "drizzle-orm";

export async function initChartOfAccounts(): Promise<void> {
  const existing = await db.select({ code: accounts.code }).from(accounts);
  const existingCodes = new Set(existing.map((a) => a.code));

  // Two-pass insert: first headers (so children can find parents), then leaves.
  const codeToId = new Map<string, number>();
  for (const acc of existing) codeToId.set(acc.code, 0);

  // Reload existing with ids
  const fullExisting = await db.select().from(accounts);
  fullExisting.forEach((a) => codeToId.set(a.code, a.id));

  const allSeed = [...DEFAULT_COA, ...PAYROLL_EXTRA_ACCOUNTS];
  for (const seed of allSeed) {
    if (existingCodes.has(seed.code)) continue;
    const parentId = seed.parentCode ? codeToId.get(seed.parentCode) ?? null : null;
    const [created] = await db
      .insert(accounts)
      .values({
        code: seed.code,
        nameAr: seed.nameAr,
        nameEn: seed.nameEn,
        type: seed.type,
        subtype: seed.subtype,
        parentId: parentId ?? undefined,
        isHeader: seed.isHeader ?? false,
      })
      .returning();
    codeToId.set(created.code, created.id);
  }
}

/**
 * Backfill: any existing transaction without a corresponding journal entry
 * gets one auto-generated against the default cash and category-mapped account.
 */
export async function backfillJournalForLegacyTransactions(): Promise<void> {
  const allAccounts = await db.select().from(accounts);
  const codeToId = new Map<string, number>();
  allAccounts.forEach((a) => codeToId.set(a.code, a.id));

  const cashId = codeToId.get(CASH_ACCOUNT_CODE);
  if (!cashId) return;

  const allTx = await db.select().from(transactions);
  const existingJEs = await db
    .select({ src: journalEntries.sourceTransactionId })
    .from(journalEntries)
    .where(sql`${journalEntries.sourceTransactionId} is not null`);
  const covered = new Set(existingJEs.map((j) => j.src));

  let counter =
    (
      await db
        .select({ c: sql<number>`count(*)::int` })
        .from(journalEntries)
    )[0]?.c ?? 0;

  for (const tx of allTx) {
    if (covered.has(tx.id)) continue;
    counter += 1;
    const ref = `JE-${String(counter).padStart(5, "0")}`;
    const amt = Number(tx.amount);

    let dr: number;
    let cr: number;
    if (tx.type === "income") {
      dr = cashId;
      cr = codeToId.get(pickRevenueAccountCode(tx.category, tx.description)) || codeToId.get("4010")!;
    } else {
      dr = codeToId.get(pickExpenseAccountCode(tx.category, tx.description)) || codeToId.get("6900")!;
      cr = cashId;
    }

    const [je] = await db
      .insert(journalEntries)
      .values({
        reference: ref,
        entryDate: tx.date ?? new Date(),
        description: tx.description,
        source: "transaction",
        sourceTransactionId: tx.id,
      })
      .returning();

    await db.insert(journalLines).values([
      { journalEntryId: je.id, accountId: dr, debit: amt.toFixed(2), credit: "0", description: tx.description },
      { journalEntryId: je.id, accountId: cr, debit: "0", credit: amt.toFixed(2), description: tx.description },
    ]);
  }
}

export async function ensureIfrsBootstrap(): Promise<void> {
  await initChartOfAccounts();
  await backfillJournalForLegacyTransactions();
}
