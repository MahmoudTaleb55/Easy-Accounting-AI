/**
 * Payroll engine — monthly payroll run computation and journal posting.
 *
 * Reads the workspace's employee roster, attendance, and leave records;
 * applies the per-country localization pack's social-insurance rates,
 * end-of-service gratuity accrual (IAS 19), and leave-accrual formulas;
 * then creates a `payroll_runs` record with per-employee `payroll_lines`
 * and auto-posts a balanced IFRS journal entry (Dr Salary Expense /
 * Cr Cash + Cr Social Insurance Payable + Cr Gratuity Provision).
 *
 * Country-specific rules come from `shared/localization.ts` → `getPack()`
 * so the engine itself is country-agnostic; new country support is just
 * a new localization-pack entry, no payroll-code changes needed.
 *
 * Tenant scoping: every function takes `companyId`; callers pass
 * `req.membership.companyId`.
 */
import { db } from "./db";
import {
  employees,
  attendance,
  leaves,
  payrollRuns,
  payrollLines,
  accounts,
  type Employee,
} from "@shared/schema";
import {
  SALARIES_EXPENSE_CODE,
  SOCIAL_INSURANCE_EXPENSE_CODE,
  EOS_EXPENSE_CODE,
  CASH_ACCOUNT_CODE,
  ACCRUED_SALARIES_CODE,
  SOCIAL_INSURANCE_PAYABLE_CODE,
  ACCRUED_LEAVE_LIABILITY_CODE,
  EOS_LIABILITY_CODE,
} from "@shared/coa-seed";
import { getPack, monthlyEndOfServiceAccrual, monthlyLeaveAccrual } from "@shared/localization";
import { storage, type AuditContext } from "./storage";
import { eq, and } from "drizzle-orm";

export interface PayrollPreviewLine {
  employeeId: number;
  fullName: string;
  workingDays: number;
  absentDays: number;
  baseSalary: number;
  allowances: number;
  overtime: number;
  bonuses: number;
  absenceDeduction: number;
  advances: number;
  socialInsuranceEmployee: number;
  socialInsuranceEmployer: number;
  endOfServiceAccrual: number;
  leaveAccrual: number;
  gross: number;
  netPay: number;
}

function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

// Standard payroll convention: 30-day month basis for daily-rate calculations.
const PAYROLL_DAY_DIVISOR = 30;

function yearsCompleted(hireDate: string, asOfYear: number, asOfMonth: number) {
  const hd = new Date(hireDate);
  const asOf = new Date(asOfYear, asOfMonth - 1, 1);
  const ms = asOf.getTime() - hd.getTime();
  return Math.max(0, ms / (1000 * 60 * 60 * 24 * 365.25));
}

export async function computePayrollPreview(
  companyId: number,
  year: number,
  month: number,
): Promise<PayrollPreviewLine[]> {
  const settings = await storage.getSettings(companyId);
  const pack = getPack(settings.countryCode);
  const allEmps = await db
    .select()
    .from(employees)
    .where(and(eq(employees.companyId, companyId), eq(employees.isActive, true)));

  const totalDays = daysInMonth(year, month);
  const monthStr = String(month).padStart(2, "0");

  const result: PayrollPreviewLine[] = [];
  for (const emp of allEmps) {
    const att = await db
      .select()
      .from(attendance)
      .where(eq(attendance.employeeId, emp.id));
    const monthAtt = att.filter((a) => a.date.startsWith(`${year}-${monthStr}`));
    const absentDays = monthAtt.filter((a) => a.status === "absent").length;
    const overtimeHours = monthAtt.reduce((s, a) => s + Number(a.overtimeHours || 0), 0);

    const baseSalary = Number(emp.baseSalary);
    const allowances = Number(emp.allowances);
    // Use 30-day standard for daily-rate calculations regardless of calendar days
    const dailyRate = baseSalary / PAYROLL_DAY_DIVISOR;
    const hourlyRate = dailyRate / 8;
    const absenceDeduction = absentDays * dailyRate;
    const overtime = overtimeHours * hourlyRate * 1.5; // standard 1.5x overtime

    const grossBeforeDeduction = baseSalary + allowances + overtime;

    // Social insurance
    const si = pack.socialInsurance;
    const empRate = emp.isNational
      ? si.nationalEmployeeRate ?? si.employeeRate
      : si.employeeRate;
    const erRate = emp.isNational
      ? si.nationalEmployerRate ?? si.employerRate
      : si.employerRate;
    const siBase = baseSalary + allowances;
    const socialInsuranceEmployee = siBase * empRate;
    const socialInsuranceEmployer = siBase * erRate;

    // EoS & leave accruals
    const yrs = yearsCompleted(emp.hireDate, year, month);
    const eos = monthlyEndOfServiceAccrual(pack.endOfServiceFormula, baseSalary, yrs);
    const leaveDays = emp.annualLeaveDaysOverride ?? pack.annualLeaveDays;
    const leaveAcc = monthlyLeaveAccrual(leaveDays, baseSalary);

    const netPay = grossBeforeDeduction - absenceDeduction - socialInsuranceEmployee;

    result.push({
      employeeId: emp.id,
      fullName: emp.fullName,
      workingDays: totalDays - absentDays,
      absentDays,
      baseSalary,
      allowances,
      overtime,
      bonuses: 0,
      absenceDeduction,
      advances: 0,
      socialInsuranceEmployee,
      socialInsuranceEmployer,
      endOfServiceAccrual: eos,
      leaveAccrual: leaveAcc,
      gross: grossBeforeDeduction,
      netPay,
    });
  }
  return result;
}

export async function runPayroll(
  companyId: number,
  year: number,
  month: number,
  ctx?: AuditContext,
): Promise<{ runId: number; journalEntryId: number; lines: PayrollPreviewLine[] }> {
  const lines = await computePayrollPreview(companyId, year, month);
  if (!lines.length) throw new Error("لا يوجد موظفون نشطون");

  // Check no existing posted run for this workspace
  const existing = await db
    .select()
    .from(payrollRuns)
    .where(and(
      eq(payrollRuns.companyId, companyId),
      eq(payrollRuns.year, year),
      eq(payrollRuns.month, month),
    ));
  if (existing.find((r) => r.status === "posted")) {
    throw new Error("تم اعتماد رواتب هذا الشهر مسبقاً");
  }
  // Delete any prior draft for the same period
  for (const e of existing) {
    await db.delete(payrollLines).where(eq(payrollLines.payrollRunId, e.id));
    await db.delete(payrollRuns).where(eq(payrollRuns.id, e.id));
  }

  const totalGross = lines.reduce((s, l) => s + l.gross, 0);
  const totalNet = lines.reduce((s, l) => s + l.netPay, 0);
  const totalSiEmployee = lines.reduce((s, l) => s + l.socialInsuranceEmployee, 0);
  const totalSiEmployer = lines.reduce((s, l) => s + l.socialInsuranceEmployer, 0);
  const totalEos = lines.reduce((s, l) => s + l.endOfServiceAccrual, 0);
  const totalLeave = lines.reduce((s, l) => s + l.leaveAccrual, 0);
  const totalAbsence = lines.reduce((s, l) => s + l.absenceDeduction, 0);

  // Build journal entry:
  // Dr Salaries Expense (gross less absence)
  // Dr SI Expense (employer)
  // Dr EoS Expense (accrual)
  // Dr Salaries Expense (leave accrual — staff cost)
  //   Cr Cash (net pay)
  //   Cr SI Payable (employee + employer)
  //   Cr EoS Liability (accrual)
  //   Cr Accrued Leave Liability (accrual)
  const allAccs = await db.select().from(accounts).where(eq(accounts.companyId, companyId));
  const idOf = (code: string) => {
    const a = allAccs.find((x) => x.code === code);
    if (!a) throw new Error(`Account ${code} missing — run /api/accounts/seed`);
    return a.id;
  };

  const grossLessAbsence = totalGross - totalAbsence;
  const journalLines = [
    { accountId: idOf(SALARIES_EXPENSE_CODE), debit: grossLessAbsence + totalLeave, credit: 0, description: "رواتب وإجازات مستحقة" },
    { accountId: idOf(SOCIAL_INSURANCE_EXPENSE_CODE), debit: totalSiEmployer, credit: 0, description: "اشتراك تأمينات (المنشأة)" },
    { accountId: idOf(EOS_EXPENSE_CODE), debit: totalEos, credit: 0, description: "مخصص نهاية الخدمة" },
    { accountId: idOf(CASH_ACCOUNT_CODE), debit: 0, credit: totalNet, description: "صرف صافي الرواتب" },
    { accountId: idOf(SOCIAL_INSURANCE_PAYABLE_CODE), debit: 0, credit: totalSiEmployee + totalSiEmployer, description: "تأمينات مستحقة للجهة" },
    { accountId: idOf(EOS_LIABILITY_CODE), debit: 0, credit: totalEos, description: "التزام نهاية خدمة" },
    { accountId: idOf(ACCRUED_LEAVE_LIABILITY_CODE), debit: 0, credit: totalLeave, description: "إجازات مستحقة للموظفين" },
  ].filter((l) => Math.abs(l.debit) + Math.abs(l.credit) > 0.001);

  const monthStr = String(month).padStart(2, "0");
  const je = await storage.createJournalEntry(companyId, {
    entryDate: `${year}-${monthStr}-${String(daysInMonth(year, month)).padStart(2, "0")}`,
    description: `رواتب شهر ${monthStr}/${year}`,
    source: "manual",
    lines: journalLines.map((l) => ({
      accountId: l.accountId,
      debit: l.debit,
      credit: l.credit,
      description: l.description,
    })),
  }, ctx);

  // Create the run + per-employee lines + both audit events in a single
  // transaction (task #222). Either we end up with a fully posted run that
  // has its complete audit history (`create` + `post`) or nothing commits.
  // The journal entry is created above through `storage.createJournalEntry`
  // which is its own atomic unit — by the time we get here it has already
  // committed; the JE is linked into the run via `journalEntryId`, and the
  // `delete` path for orphaned JEs is handled by `deletePayrollRun` /
  // `reverseAutoPostedJournalEntry`.
  const run = await db.transaction(async (tx) => {
    const [r] = await tx
      .insert(payrollRuns)
      .values({
        companyId,
        year,
        month,
        status: "posted",
        totalGross: totalGross.toFixed(2),
        totalNet: totalNet.toFixed(2),
        journalEntryId: je.id,
      })
      .returning();

    for (const l of lines) {
      // companyId on every payroll_lines row must equal the parent run's
      // companyId — composite FKs to payroll_runs(id, companyId) and
      // employees(id, companyId) enforce this at the DB layer.
      await tx.insert(payrollLines).values({
        companyId: r.companyId,
        payrollRunId: r.id,
        employeeId: l.employeeId,
        baseSalary: l.baseSalary.toFixed(2),
        allowances: l.allowances.toFixed(2),
        overtime: l.overtime.toFixed(2),
        bonuses: "0",
        absenceDeduction: l.absenceDeduction.toFixed(2),
        advances: "0",
        socialInsuranceEmployee: l.socialInsuranceEmployee.toFixed(2),
        socialInsuranceEmployer: l.socialInsuranceEmployer.toFixed(2),
        netPay: l.netPay.toFixed(2),
        endOfServiceAccrual: l.endOfServiceAccrual.toFixed(2),
        leaveAccrual: l.leaveAccrual.toFixed(2),
      });
    }

    // Emit audit events for the payroll run lifecycle. We record both
    // "create" (the run row was inserted) and "post" (status transitioned
    // to posted + linked to a journal entry) so the History drawer can
    // show the full story. Both are written through the same `tx`
    // (task #222) so a failed audit insert rolls back the run + lines.
    await storage.recordPayrollRunAudit(tx, {
      companyId,
      payrollRunId: r.id,
      action: "create",
      changes: [
        { field: "year", to: year },
        { field: "month", to: month },
        { field: "totalGross", to: totalGross.toFixed(2) },
        { field: "totalNet", to: totalNet.toFixed(2) },
        { field: "employees", to: lines.length },
      ],
      ctx,
    });
    await storage.recordPayrollRunAudit(tx, {
      companyId,
      payrollRunId: r.id,
      action: "post",
      changes: [
        { field: "status", to: "posted" },
        { field: "journalEntryId", to: je.id },
      ],
      ctx,
    });

    return r;
  });

  return { runId: run.id, journalEntryId: je.id, lines };
}

export async function leaveBalance(companyId: number, employeeId: number): Promise<{ entitled: number; taken: number; remaining: number }> {
  const settings = await storage.getSettings(companyId);
  const pack = getPack(settings.countryCode);
  const [emp] = await db
    .select()
    .from(employees)
    .where(and(eq(employees.companyId, companyId), eq(employees.id, employeeId)));
  if (!emp) return { entitled: 0, taken: 0, remaining: 0 };

  const annual = emp.annualLeaveDaysOverride ?? pack.annualLeaveDays;
  // Pro-rata since hire date for current calendar year
  const now = new Date();
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const hire = new Date(emp.hireDate);
  const startDate = hire > yearStart ? hire : yearStart;
  const monthsActive = Math.max(0, (now.getFullYear() - startDate.getFullYear()) * 12 + (now.getMonth() - startDate.getMonth()) + 1);
  const entitled = Math.round((annual / 12) * monthsActive);

  const allLeaves = await db
    .select()
    .from(leaves)
    .where(eq(leaves.employeeId, employeeId));
  const taken = allLeaves
    .filter((l) => l.status === "approved" && l.type === "annual" && l.startDate.startsWith(String(now.getFullYear())))
    .reduce((s, l) => s + l.days, 0);
  return { entitled, taken, remaining: entitled - taken };
}
