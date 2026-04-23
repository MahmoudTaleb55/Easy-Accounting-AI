import { test, expect } from "@playwright/test";
import { z } from "zod";
import {
  insertAccountSchema,
  insertTransactionSchema,
  insertBudgetSchema,
  insertEmployeeSchema,
  insertAttendanceSchema,
  insertLeaveSchema,
  insertFxRateSchema,
  insertAssetCategorySchema,
  insertFixedAssetSchema,
} from "../../shared/schema";

const FOREIGN_COMPANY_ID = 99999;

type SchemaCase = [name: string, schema: z.ZodTypeAny, body: Record<string, unknown>];

const cases: SchemaCase[] = [
  [
    "transactions",
    insertTransactionSchema,
    {
      type: "expense",
      amount: 12.5,
      description: "lunch",
      category: "Meals",
    },
  ],
  [
    "accounts",
    insertAccountSchema,
    {
      code: "9999",
      nameAr: "حساب",
      nameEn: "Account",
      type: "asset",
      subtype: "current_asset",
    },
  ],
  [
    "budgets",
    insertBudgetSchema,
    { accountId: 1, year: 2030, month: 1, amount: 100 },
  ],
  [
    "employees",
    insertEmployeeSchema,
    { fullName: "Test", hireDate: "2030-01-01", baseSalary: 1000 },
  ],
  [
    "attendance",
    insertAttendanceSchema,
    { employeeId: 1, date: "2030-01-01", status: "present" },
  ],
  [
    "leaves",
    insertLeaveSchema,
    {
      employeeId: 1,
      startDate: "2030-01-01",
      endDate: "2030-01-02",
      days: 2,
      type: "annual",
      status: "approved",
    },
  ],
  [
    "fxRates",
    insertFxRateSchema,
    { fromCurrency: "USD", toCurrency: "EUR", rateDate: "2030-01-01", rate: 1.1 },
  ],
  [
    "assetCategories",
    insertAssetCategorySchema,
    {
      name: "Vehicles",
      assetCostAccountId: 1,
      accumulatedDepAccountId: 2,
      depExpenseAccountId: 3,
      accumulatedImpAccountId: 4,
      impLossAccountId: 5,
      revalSurplusAccountId: 6,
      gainLossDisposalAccountId: 7,
    },
  ],
  [
    "fixedAssets",
    insertFixedAssetSchema,
    {
      categoryId: 1,
      code: "FA-1",
      name: "Truck",
      acquisitionDate: "2030-01-01",
      inServiceDate: "2030-01-01",
      currency: "USD",
      txCost: 1000,
      usefulLifeMonths: 60,
      method: "straight_line",
    },
  ],
];

for (const [name, schema, body] of cases) {
  test(`insert${name[0].toUpperCase()}${name.slice(1)}Schema strips client-supplied companyId`, () => {
    const parsed = schema.parse({ ...body, companyId: FOREIGN_COMPANY_ID }) as Record<string, unknown>;
    expect(parsed.companyId).toBeUndefined();
  });
}
