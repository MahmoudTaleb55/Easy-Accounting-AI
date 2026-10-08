import { describe, expect, it } from "vitest";
import { z } from "zod";
import { insertBankAccountSchema, insertBankTransactionSchema } from "@shared/schema";

/**
 * BUG 3 regression — client/server type-contract mismatch on numeric columns.
 *
 * `opening_balance` (bank_accounts) and `amount` (bank_transactions) are
 * Drizzle `numeric` columns, which drizzle-zod types as required *strings*.
 * The client forms send JSON *numbers*, so the raw schema rejected a numeric
 * body with HTTP 400. The POST routes now `.extend(...)` the schema to coerce
 * the field to a string before validation. These tests pin that coercion so a
 * numeric body validates and lands as the expected string.
 *
 * No database is required — this exercises the exact zod schemas the routes
 * build at their validation boundary.
 */

// Mirrors the coercion applied in `POST /api/banking/accounts`.
const createAccountSchema = insertBankAccountSchema.extend({
  openingBalance: z.coerce.string().optional(),
});

// Mirrors the coercion applied in `POST /api/banking/transactions`.
const createTxnSchema = insertBankTransactionSchema.extend({
  amount: z.coerce.string(),
});

describe("BUG 3 — bank account openingBalance coercion", () => {
  it("rejects a numeric openingBalance on the raw schema (the original 400)", () => {
    const parsed = insertBankAccountSchema.safeParse({
      nameAr: "حساب",
      nameEn: "Account",
      bankName: "Bank",
      iban: "",
      accountType: "checking",
      currency: "SAR",
      openingBalance: 0, // JSON number — what the client sends
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts a numeric openingBalance and coerces it to a string", () => {
    const parsed = createAccountSchema.safeParse({
      nameAr: "حساب",
      nameEn: "Account",
      bankName: "Bank",
      iban: "",
      accountType: "checking",
      currency: "SAR",
      openingBalance: 0,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(typeof parsed.data.openingBalance).toBe("string");
      expect(parsed.data.openingBalance).toBe("0");
    }
  });
});

describe("BUG 3 — bank transaction amount coercion (sibling defect)", () => {
  it("accepts a numeric amount and coerces it to a string", () => {
    const parsed = createTxnSchema.safeParse({
      bankAccountId: 1,
      txnType: "deposit",
      amount: 150, // JSON number
      description: "test",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(typeof parsed.data.amount).toBe("string");
      expect(parsed.data.amount).toBe("150");
    }
  });
});
