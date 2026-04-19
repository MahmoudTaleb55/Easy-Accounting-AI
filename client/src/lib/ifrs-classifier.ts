import type { Transaction } from "@shared/schema";

export type IfrsLine = "revenue" | "cogs" | "operating_expense" | "other_income" | "other_expense";

const REVENUE_KEYWORDS = ["مبيعات", "مبيعة", "بيع ", "إيرادات", "ايرادات", "دخل", "راتب"];
const SALES_DISCOUNT_KEYWORDS = ["خصم مبيعات", "خصم على المبيعات", "خصومات المبيعات"];
const COGS_KEYWORDS = [
  "تكلفة البضائع",
  "تكلفة البضاعة",
  "بضاعة مباعة",
  "البضائع المباعة",
  "مشتريات",
  "مشتروات",
  "تكلفة المخزون",
  "تكلفة المبيعات",
];

export interface IfrsClassified {
  line: IfrsLine;
  /** Signed amount: contra-revenue and refunds are negative under their parent total */
  signedAmount: number;
  category: string;
  transaction: Transaction;
}

const norm = (s: string) => (s || "").trim();

export function classifyTransaction(tx: Transaction): IfrsClassified {
  const cat = norm(tx.category);
  const desc = norm(tx.description);
  const amt = Number(tx.amount) || 0;
  const haystack = `${cat} ${desc}`;

  if (tx.type === "income") {
    // Sales discounts recorded on income side are contra-revenue (negative)
    if (SALES_DISCOUNT_KEYWORDS.some((k) => haystack.includes(k))) {
      return { line: "revenue", signedAmount: -amt, category: cat || "خصم", transaction: tx };
    }
    if (REVENUE_KEYWORDS.some((k) => haystack.includes(k))) {
      return { line: "revenue", signedAmount: amt, category: cat || "المبيعات", transaction: tx };
    }
    return { line: "other_income", signedAmount: amt, category: cat || "إيرادات أخرى", transaction: tx };
  }

  // Expense side
  if (COGS_KEYWORDS.some((k) => haystack.includes(k))) {
    return { line: "cogs", signedAmount: amt, category: cat || "تكلفة البضائع المباعة", transaction: tx };
  }
  // "خصم" alone on expense side = purchase discounts (shown negative under operating expenses, like the PDF)
  if (cat.includes("خصم") || desc.includes("خصم")) {
    return {
      line: "operating_expense",
      signedAmount: -amt,
      category: cat || "خصومات الشراء",
      transaction: tx,
    };
  }
  return { line: "operating_expense", signedAmount: amt, category: cat || "مصروفات أخرى", transaction: tx };
}

export interface IfrsLineItem {
  category: string;
  amount: number;
}

export interface IfrsStatement {
  revenueItems: IfrsLineItem[];
  totalRevenue: number;
  cogsItems: IfrsLineItem[];
  totalCogs: number;
  grossProfit: number;
  operatingExpenseItems: IfrsLineItem[];
  totalOperatingExpenses: number;
  otherIncomeItems: IfrsLineItem[];
  totalOtherIncome: number;
  netProfit: number;
}

export function buildIfrsStatement(transactions: Transaction[]): IfrsStatement {
  const revenue = new Map<string, number>();
  const cogs = new Map<string, number>();
  const opex = new Map<string, number>();
  const otherInc = new Map<string, number>();

  for (const tx of transactions) {
    const c = classifyTransaction(tx);
    const target =
      c.line === "revenue"
        ? revenue
        : c.line === "cogs"
        ? cogs
        : c.line === "other_income"
        ? otherInc
        : opex;
    target.set(c.category, (target.get(c.category) || 0) + c.signedAmount);
  }

  const toItems = (m: Map<string, number>): IfrsLineItem[] =>
    Array.from(m.entries())
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));

  const sum = (items: IfrsLineItem[]) => items.reduce((s, it) => s + it.amount, 0);

  const revenueItems = toItems(revenue);
  const cogsItems = toItems(cogs);
  const opexItems = toItems(opex);
  const otherIncItems = toItems(otherInc);

  const totalRevenue = sum(revenueItems);
  const totalCogs = sum(cogsItems);
  const grossProfit = totalRevenue - totalCogs;
  const totalOpex = sum(opexItems);
  const totalOther = sum(otherIncItems);
  const netProfit = grossProfit - totalOpex + totalOther;

  return {
    revenueItems,
    totalRevenue,
    cogsItems,
    totalCogs,
    grossProfit,
    operatingExpenseItems: opexItems,
    totalOperatingExpenses: totalOpex,
    otherIncomeItems: otherIncItems,
    totalOtherIncome: totalOther,
    netProfit,
  };
}

export function formatMoney(n: number): string {
  const abs = Math.abs(n);
  const formatted = abs.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return n < 0 ? `(${formatted})` : formatted;
}
