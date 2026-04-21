import { db } from "./db";
import { accounts, journalEntries, journalLines, transactions } from "@shared/schema";
import { DEFAULT_COA, CASH_ACCOUNT_CODE, pickExpenseAccountCode, pickRevenueAccountCode, PAYROLL_EXTRA_ACCOUNTS, FIXED_ASSETS_EXTRA_ACCOUNTS, FA_CATEGORY_DEFAULTS, FA_ACCUM_IMP_CODE, FA_DEP_EXPENSE_CODE, FA_IMP_LOSS_CODE, FA_REVAL_SURPLUS_CODE, FA_GAIN_LOSS_DISPOSAL_CODE } from "@shared/coa-seed";
import { companies, assetCategories } from "@shared/schema";
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

  const allSeed = [...DEFAULT_COA, ...PAYROLL_EXTRA_ACCOUNTS, ...FIXED_ASSETS_EXTRA_ACCOUNTS];
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
        isHeader: ("isHeader" in seed ? seed.isHeader : false) ?? false,
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

export async function ensureDefaultCompanyAndCategories(): Promise<void> {
  const existingCompanies = await db.select().from(companies);
  let companyId: number;
  if (existingCompanies.length === 0) {
    const [created] = await db
      .insert(companies)
      .values({ name: "Default Company", functionalCurrency: "USD", currencySymbol: "$", isDefault: true, isActive: true })
      .returning();
    companyId = created.id;
  } else {
    companyId = (existingCompanies.find((c) => c.isDefault) ?? existingCompanies[0]).id;
  }

  const existingCats = await db.select().from(assetCategories).where(eq(assetCategories.companyId, companyId));
  if (existingCats.length > 0) return;

  const allAccounts = await db.select().from(accounts);
  const codeToId = new Map(allAccounts.map((a) => [a.code, a.id]));
  const get = (code: string) => codeToId.get(code);

  const depExpense = get(FA_DEP_EXPENSE_CODE);
  const accumImp = get(FA_ACCUM_IMP_CODE);
  const impLoss = get(FA_IMP_LOSS_CODE);
  const revalSurplus = get(FA_REVAL_SURPLUS_CODE);
  const gainLoss = get(FA_GAIN_LOSS_DISPOSAL_CODE);
  if (!depExpense || !accumImp || !impLoss || !revalSurplus || !gainLoss) return;

  for (const def of FA_CATEGORY_DEFAULTS) {
    const cost = get(def.assetCostCode);
    const accDep = get(def.accumDepCode);
    if (!cost || !accDep) continue;
    await db.insert(assetCategories).values({
      companyId,
      name: def.name,
      measurementModel: "cost",
      defaultUsefulLifeMonths: def.defaultUsefulLifeMonths,
      defaultMethod: "straight_line",
      assetCostAccountId: cost,
      accumulatedDepAccountId: accDep,
      depExpenseAccountId: depExpense,
      accumulatedImpAccountId: accumImp,
      impLossAccountId: impLoss,
      revalSurplusAccountId: revalSurplus,
      gainLossDisposalAccountId: gainLoss,
    });
  }
}

export async function ensureIfrsBootstrap(): Promise<void> {
  await initChartOfAccounts();
  await backfillJournalForLegacyTransactions();
  await ensureDefaultCompanyAndCategories();
}
