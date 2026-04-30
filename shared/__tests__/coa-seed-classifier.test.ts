import { describe, expect, it } from "vitest";
import { pickExpenseAccountCode, pickRevenueAccountCode } from "../coa-seed";

describe("pickExpenseAccountCode", () => {
  it("matches Arabic without hamza ('اتعاب' should not be punished by missing hamza on alif)", () => {
    // Real user case from workspace 5726: category 'اتعاب مسوق الكتروني' for
    // a 300 SAR expense paid to a digital marketer. The hamza-less spelling
    // must not fall through to 6900 'Other Expenses'; the digital-marketer
    // bucket is Marketing (6600).
    expect(pickExpenseAccountCode("اتعاب مسوق الكتروني", "اتعاب")).toBe("6600");
  });

  it("does not return a revenue code (4xxx) for an expense, even when an income-side keyword matches the haystack", () => {
    // 'أتعاب' is registered on the income side (4200 Services Revenue) for
    // freelancers earning service fees. When that same word appears in a
    // category for an expense (paying someone else's fees), the classifier
    // must stay within expense codes.
    const code = pickExpenseAccountCode("أتعاب محامي", "استشارة قانونية");
    expect(code.startsWith("4")).toBe(false);
  });

  it("matches English keywords case-insensitively", () => {
    expect(pickExpenseAccountCode("Marketing", "Facebook Ads")).toBe("6600");
    expect(pickExpenseAccountCode("OFFICE", "stationery purchase")).toBe("6700");
    expect(pickExpenseAccountCode("Wages", "monthly payroll")).toBe("6100");
  });

  it("falls through to 6900 when nothing matches", () => {
    expect(pickExpenseAccountCode("xyz random", "nothing here")).toBe("6900");
  });

  it("preserves the existing rent / utilities / payroll mappings", () => {
    expect(pickExpenseAccountCode("إيجار المكتب", "")).toBe("6200");
    expect(pickExpenseAccountCode("كهرباء وماء", "")).toBe("6300");
    expect(pickExpenseAccountCode("رواتب الموظفين", "")).toBe("6100");
  });

  it("ignores zero-width joiners (ZWNJ/ZWJ) that some IMEs inject silently", () => {
    // Arabic copy-paste from messaging apps occasionally introduces ZWNJ
    // (\u200C) between letters; the classifier must still resolve.
    expect(pickExpenseAccountCode("تسو\u200Cيق رقمي", "")).toBe("6600");
  });

  it("normalizes yāʾ-with-hamza (ئ → ي) so misspellings of common keywords still resolve", () => {
    // 'إيجار' (rent, code 6200) typed with ئ instead of ي on the second
    // letter normalises back to the same form; verify the matcher still
    // resolves it instead of falling through to 6900.
    expect(pickExpenseAccountCode("إيجار", "")).toBe("6200");
    expect(pickExpenseAccountCode("إئجار", "")).toBe("6200");
  });
});

describe("pickRevenueAccountCode", () => {
  it("matches sales keywords", () => {
    expect(pickRevenueAccountCode("مبيعات شهرية", "")).toBe("4100");
  });

  it("matches services / fees as service revenue", () => {
    expect(pickRevenueAccountCode("أتعاب استشارية", "")).toBe("4200");
    // hamza-less variant should also work after normalization
    expect(pickRevenueAccountCode("اتعاب استشارية", "")).toBe("4200");
  });

  it("falls through to 4100 when nothing matches", () => {
    expect(pickRevenueAccountCode("xyz", "nothing")).toBe("4100");
  });
});
