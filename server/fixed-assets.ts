// Fixed-Assets calculation engine (IAS 16 / IAS 36)
// Pure functions: no DB access. Receives data, returns numbers / JE shapes.

import type {
  FixedAsset,
  AssetComponent,
  AssetCategory,
  DepreciationMethod,
} from "@shared/schema";

const r2 = (n: number) => Math.round(n * 100) / 100;

export interface DepreciableUnit {
  cost: number;
  residual: number;
  usefulLifeMonths: number;
  method: DepreciationMethod;
  unitsTotal?: number | null;
  inServiceDate: string;
  // Already-posted depreciation
  accumDepreciation: number;
  // Already-posted impairment (reduces depreciable base going forward via NBV)
  accumImpairment: number;
  // Custom schedule (per-period amounts in chronological order, optional)
  customSchedule?: number[];
}

export interface PeriodKey { year: number; month: number; }

export function periodKey(d: string): PeriodKey {
  const [y, m] = d.split("-").map(Number);
  return { year: y, month: m };
}

export function periodIndex(p: PeriodKey): number {
  return p.year * 12 + (p.month - 1);
}

export function fromIndex(i: number): PeriodKey {
  return { year: Math.floor(i / 12), month: (i % 12) + 1 };
}

export function periodsBetween(from: PeriodKey, to: PeriodKey): number {
  return periodIndex(to) - periodIndex(from);
}

/**
 * Number of WHOLE months elapsed from inServiceDate to (and including) the
 * given period. Returns 0 if the asset isn't in service yet for the period.
 */
function monthsElapsed(inServiceDate: string, p: PeriodKey): number {
  const start = periodKey(inServiceDate);
  return Math.max(0, periodIndex(p) - periodIndex(start) + 1);
}

/**
 * Fraction (0-1) of THIS period that the asset is in service for.
 *  - First month is prorated by remaining days in that month.
 *  - Subsequent months are full (1.0).
 *  - When cumulative service crosses `lifeMonths`, the final period gets only
 *    the leftover fraction.
 *  - Returns 0 if the asset isn't yet in service for the period or its life
 *    has been fully expended.
 */
export function periodFraction(inServiceDate: string, p: PeriodKey, lifeMonths: number): number {
  const [sy, sm, sdRaw] = inServiceDate.split("-").map(Number);
  const sd = sdRaw || 1;
  const startIdx = sy * 12 + (sm - 1);
  const idx = p.year * 12 + (p.month - 1);
  if (idx < startIdx) return 0;
  // Days in start month (Date(year, month, 0) returns last day of `month - 1` 1-indexed)
  const daysInStart = new Date(sy, sm, 0).getDate();
  const startFrac = (daysInStart - sd + 1) / daysInStart;
  const monthsFromStart = idx - startIdx;
  const cumBefore = monthsFromStart === 0 ? 0 : startFrac + (monthsFromStart - 1);
  let thisFrac = monthsFromStart === 0 ? startFrac : 1;
  if (cumBefore >= lifeMonths) return 0;
  if (cumBefore + thisFrac > lifeMonths) thisFrac = lifeMonths - cumBefore;
  return Math.max(0, Math.min(1, thisFrac));
}

/**
 * Compute depreciation for ONE period for a single depreciable unit
 * (asset or component). Returns 0 if the unit is fully depreciated or
 * not yet in service for the period.
 */
export function depreciationForPeriod(
  u: DepreciableUnit,
  p: PeriodKey,
  unitsThisPeriod = 0
): number {
  const elapsed = monthsElapsed(u.inServiceDate, p);
  if (elapsed <= 0) return 0;
  if (u.usefulLifeMonths <= 0) return 0;

  const carry = u.cost - u.accumDepreciation - u.accumImpairment;
  const depreciableBase = Math.max(0, u.cost - u.residual - u.accumImpairment);
  if (carry <= u.residual + 0.005) return 0;

  // Fraction of THIS month the asset is in service for (handles partial first
  // and last month per the IAS 16 partial-period requirement).
  const frac = periodFraction(u.inServiceDate, p, u.usefulLifeMonths);
  if (frac <= 0) return 0;

  let amount = 0;

  switch (u.method) {
    case "straight_line": {
      // re-rate over remaining fractional life so impairment writedowns
      // get spread across remaining months
      const remainingFracLife = Math.max(0.0001, u.usefulLifeMonths - (elapsed - 1));
      const remainingDepreciable = Math.max(0, depreciableBase - u.accumDepreciation);
      amount = (remainingDepreciable / remainingFracLife) * frac;
      break;
    }
    case "declining_balance": {
      const lifeYears = Math.max(1, u.usefulLifeMonths / 12);
      const annualRate = 1 / lifeYears;
      const monthlyRate = annualRate / 12;
      amount = Math.max(0, carry - u.residual) * monthlyRate * frac;
      break;
    }
    case "double_declining": {
      const lifeYears = Math.max(1, u.usefulLifeMonths / 12);
      const annualRate = 2 / lifeYears;
      const monthlyRate = annualRate / 12;
      amount = Math.max(0, carry - u.residual) * monthlyRate * frac;
      const remainingMonths = Math.max(0.0001, u.usefulLifeMonths - (elapsed - 1));
      const slAmount = (Math.max(0, carry - u.residual) / remainingMonths) * frac;
      if (slAmount > amount) amount = slAmount;
      break;
    }
    case "syd": {
      const N = u.usefulLifeMonths;
      const sumOfDigits = (N * (N + 1)) / 2;
      const monthsRemaining = Math.max(0, N - (elapsed - 1));
      amount = ((depreciableBase * monthsRemaining) / sumOfDigits) * frac;
      break;
    }
    case "units_of_production": {
      const total = Math.max(1, u.unitsTotal ?? 1);
      amount = (depreciableBase * Math.max(0, unitsThisPeriod)) / total;
      break;
    }
    case "custom": {
      const idx = elapsed - 1;
      amount = u.customSchedule?.[idx] ?? 0;
      break;
    }
  }

  const maxAllowed = Math.max(0, carry - u.residual);
  amount = Math.min(amount, maxAllowed);
  return r2(Math.max(0, amount));
}

/**
 * Generate a full planned depreciation schedule for one unit, from in-service
 * to fully depreciated (or end of useful life). Returns one row per period.
 */
export function generateSchedule(u: DepreciableUnit): Array<PeriodKey & { amount: number; carrying: number }> {
  const start = periodKey(u.inServiceDate);
  const rows: Array<PeriodKey & { amount: number; carrying: number }> = [];
  const sim: DepreciableUnit = { ...u };
  for (let i = 0; i < u.usefulLifeMonths + 12; i++) {
    const p = fromIndex(periodIndex(start) + i);
    const amount = depreciationForPeriod(sim, p);
    if (amount <= 0.001) {
      // For units_of_production we cannot pre-generate without unit volumes.
      if (u.method === "units_of_production" || u.method === "custom") {
        rows.push({ ...p, amount: 0, carrying: r2(sim.cost - sim.accumDepreciation - sim.accumImpairment) });
      }
      if (sim.cost - sim.accumDepreciation - sim.accumImpairment <= sim.residual + 0.005) break;
      continue;
    }
    sim.accumDepreciation = r2(sim.accumDepreciation + amount);
    rows.push({
      ...p,
      amount,
      carrying: r2(sim.cost - sim.accumDepreciation - sim.accumImpairment),
    });
  }
  return rows;
}

// ---------- Impairment (IAS 36) ----------

export function impairmentLoss(
  carryingAmount: number,
  recoverableAmount: number
): number {
  return r2(Math.max(0, carryingAmount - recoverableAmount));
}

/**
 * Reversal capped at what carrying amount would have been without prior
 * impairment. Returns a positive number (amount of reversal).
 */
export function impairmentReversal(
  currentCarrying: number,
  recoverableAmount: number,
  hypotheticalCarryingWithoutImpairment: number
): number {
  const cap = Math.max(0, hypotheticalCarryingWithoutImpairment - currentCarrying);
  const desired = Math.max(0, recoverableAmount - currentCarrying);
  return r2(Math.min(cap, desired));
}

// ---------- Revaluation (IAS 16) ----------

export interface RevaluationResult {
  newGrossCost: number;
  newAccumDep: number;
  newAccumImp: number;
  surplusDelta: number;     // +ve = upward to OCI surplus; -ve = decrease in surplus
  plImpact: number;          // +ve = reversal of prior P&L loss (income); -ve = loss to P&L
  priorLossReversal: number; // amount of upward delta that reverses prior P&L loss
}

/**
 * Apply revaluation given fair value at revaluation date and method.
 * - "elimination": reset accum dep AND accum impairment to 0, restate cost = fair value
 * - "proportional": scale cost, accum dep, and accum impairment so NBV = fair value
 * Surplus rules (IAS 16.39-40):
 *  - Upward: increase first reverses any past P&L loss (to P&L), remainder to OCI surplus.
 *  - Downward: first reduces existing surplus (OCI), remainder to P&L.
 */
export function applyRevaluation(
  cost: number,
  accumDep: number,
  accumImp: number,
  existingSurplus: number,
  priorPLLoss: number,
  fairValue: number,
  method: "elimination" | "proportional"
): RevaluationResult {
  const carrying = cost - accumDep - accumImp;
  const delta = fairValue - carrying;

  let newGross: number;
  let newAccum: number;
  let newAccumImp: number;
  if (method === "elimination") {
    newGross = fairValue;
    newAccum = 0;
    newAccumImp = 0;
  } else {
    if (carrying <= 0.005) {
      newGross = fairValue;
      newAccum = 0;
      newAccumImp = 0;
    } else {
      const ratio = fairValue / carrying;
      newGross = r2(cost * ratio);
      newAccum = r2(accumDep * ratio);
      newAccumImp = r2(accumImp * ratio);
    }
  }

  let surplusDelta = 0;
  let plImpact = 0;
  let priorLossReversal = 0;
  if (delta > 0) {
    // Upward: first reverse any prior P&L loss, then any remainder to OCI surplus.
    priorLossReversal = Math.min(priorPLLoss, delta);
    plImpact = r2(priorLossReversal);
    surplusDelta = r2(delta - priorLossReversal);
  } else if (delta < 0) {
    const useFromSurplus = Math.min(existingSurplus, -delta);
    surplusDelta = r2(-useFromSurplus);
    plImpact = r2(delta + useFromSurplus); // remainder hits P&L (negative)
  }
  return {
    newGrossCost: r2(newGross),
    newAccumDep: r2(newAccum),
    newAccumImp: r2(newAccumImp),
    surplusDelta,
    plImpact,
    priorLossReversal: r2(priorLossReversal),
  };
}

/**
 * Simulate depreciation from inServiceDate to (and including) the given period
 * AS IF no impairment had ever been recorded. Returns the hypothetical
 * accumulated depreciation. Used as the IAS 36 reversal cap.
 *
 * If a running counter is already tracked (`accumDepNoImpairment` on the asset)
 * use that instead — this helper is the fallback / verification path.
 */
export function simulateNoImpairmentAccumDep(u: DepreciableUnit, upTo: PeriodKey): number {
  const start = periodKey(u.inServiceDate);
  const sim: DepreciableUnit = { ...u, accumDepreciation: 0, accumImpairment: 0 };
  const target = periodIndex(upTo);
  const startIdx = periodIndex(start);
  if (target < startIdx) return 0;
  for (let i = 0; i <= target - startIdx; i++) {
    const p = fromIndex(startIdx + i);
    const amt = depreciationForPeriod(sim, p);
    if (amt <= 0.001) continue;
    sim.accumDepreciation = r2(sim.accumDepreciation + amt);
  }
  return r2(sim.accumDepreciation);
}

// ---------- Disposal ----------

export interface DisposalResult {
  gainLoss: number;        // +ve gain, -ve loss
  surplusTransferred: number; // amount moved from revaluation surplus to retained earnings
}

export function computeDisposal(
  cost: number,
  accumDep: number,
  accumImp: number,
  existingSurplus: number,
  proceeds: number
): DisposalResult {
  const carrying = cost - accumDep - accumImp;
  const gainLoss = r2(proceeds - carrying);
  const surplusTransferred = r2(Math.max(0, existingSurplus));
  return { gainLoss, surplusTransferred };
}

// ---------- Journal-Entry builders ----------

export interface JELine {
  accountId: number;
  debit: number;
  credit: number;
  description?: string;
}

export interface BuiltJE {
  description: string;
  lines: JELine[];
}

export function buildDepreciationJE(
  totalAmount: number,
  byCategory: Map<number, { depExpenseAccountId: number; accumDepAccountId: number; amount: number }>,
  description: string
): BuiltJE {
  const lines: JELine[] = [];
  byCategory.forEach((v) => {
    if (v.amount <= 0.005) return;
    lines.push({ accountId: v.depExpenseAccountId, debit: r2(v.amount), credit: 0, description });
    lines.push({ accountId: v.accumDepAccountId, debit: 0, credit: r2(v.amount), description });
  });
  return { description, lines };
}

export function buildImpairmentJE(
  cat: AssetCategory,
  amount: number,
  isReversal: boolean,
  assetName: string
): BuiltJE {
  const desc = isReversal
    ? `عكس انخفاض في قيمة ${assetName}`
    : `إثبات خسارة انخفاض في قيمة ${assetName}`;
  if (isReversal) {
    return {
      description: desc,
      lines: [
        { accountId: cat.accumulatedImpAccountId, debit: r2(amount), credit: 0, description: desc },
        { accountId: cat.impLossAccountId, debit: 0, credit: r2(amount), description: desc },
      ],
    };
  }
  return {
    description: desc,
    lines: [
      { accountId: cat.impLossAccountId, debit: r2(amount), credit: 0, description: desc },
      { accountId: cat.accumulatedImpAccountId, debit: 0, credit: r2(amount), description: desc },
    ],
  };
}

export function buildRevaluationJE(
  cat: AssetCategory,
  asset: FixedAsset,
  current: { cost: number; accumDep: number; accumImp: number },
  next: { cost: number; accumDep: number; accumImp: number },
  surplusDelta: number,
  plImpact: number
): BuiltJE {
  const desc = `إعادة تقييم ${asset.name}`;
  const lines: JELine[] = [];
  const grossDelta = r2(next.cost - current.cost);
  const accumDelta = r2(next.accumDep - current.accumDep);
  const accumImpDelta = r2(next.accumImp - current.accumImp);

  if (grossDelta > 0.005) lines.push({ accountId: cat.assetCostAccountId, debit: grossDelta, credit: 0, description: desc });
  else if (grossDelta < -0.005) lines.push({ accountId: cat.assetCostAccountId, debit: 0, credit: -grossDelta, description: desc });

  if (accumDelta > 0.005) lines.push({ accountId: cat.accumulatedDepAccountId, debit: 0, credit: accumDelta, description: desc });
  else if (accumDelta < -0.005) lines.push({ accountId: cat.accumulatedDepAccountId, debit: -accumDelta, credit: 0, description: desc });

  if (accumImpDelta > 0.005) lines.push({ accountId: cat.accumulatedImpAccountId, debit: 0, credit: accumImpDelta, description: desc });
  else if (accumImpDelta < -0.005) lines.push({ accountId: cat.accumulatedImpAccountId, debit: -accumImpDelta, credit: 0, description: desc });

  if (surplusDelta > 0.005) lines.push({ accountId: cat.revalSurplusAccountId, debit: 0, credit: r2(surplusDelta), description: desc });
  else if (surplusDelta < -0.005) lines.push({ accountId: cat.revalSurplusAccountId, debit: r2(-surplusDelta), credit: 0, description: desc });

  if (plImpact < -0.005) lines.push({ accountId: cat.impLossAccountId, debit: r2(-plImpact), credit: 0, description: desc });
  else if (plImpact > 0.005) lines.push({ accountId: cat.impLossAccountId, debit: 0, credit: r2(plImpact), description: desc });

  return { description: desc, lines };
}

export function buildDisposalJE(
  cat: AssetCategory,
  asset: FixedAsset,
  cost: number,
  accumDep: number,
  accumImp: number,
  proceeds: number,
  result: DisposalResult,
  cashAccountId: number,
  retainedEarningsAccountId: number
): BuiltJE {
  const desc = `إثبات استبعاد الأصل ${asset.name}`;
  const lines: JELine[] = [];
  if (proceeds > 0.005) lines.push({ accountId: cashAccountId, debit: r2(proceeds), credit: 0, description: desc });
  if (accumDep > 0.005) lines.push({ accountId: cat.accumulatedDepAccountId, debit: r2(accumDep), credit: 0, description: desc });
  if (accumImp > 0.005) lines.push({ accountId: cat.accumulatedImpAccountId, debit: r2(accumImp), credit: 0, description: desc });
  lines.push({ accountId: cat.assetCostAccountId, debit: 0, credit: r2(cost), description: desc });

  if (result.gainLoss > 0.005) lines.push({ accountId: cat.gainLossDisposalAccountId, debit: 0, credit: r2(result.gainLoss), description: desc });
  else if (result.gainLoss < -0.005) lines.push({ accountId: cat.gainLossDisposalAccountId, debit: r2(-result.gainLoss), credit: 0, description: desc });

  if (result.surplusTransferred > 0.005) {
    lines.push({ accountId: cat.revalSurplusAccountId, debit: r2(result.surplusTransferred), credit: 0, description: `تحويل فائض إعادة التقييم` });
    lines.push({ accountId: retainedEarningsAccountId, debit: 0, credit: r2(result.surplusTransferred), description: `تحويل إلى الأرباح المحتجزة` });
  }
  return { description: desc, lines };
}

export function unitFromAsset(a: FixedAsset): DepreciableUnit {
  let customSchedule: number[] | undefined;
  if (a.customSchedule) {
    try {
      const parsed = JSON.parse(a.customSchedule);
      if (Array.isArray(parsed)) customSchedule = parsed.map((x: unknown) => Number(x));
    } catch { /* ignore malformed */ }
  }
  return {
    cost: Number(a.cost),
    residual: Number(a.residual),
    usefulLifeMonths: a.usefulLifeMonths,
    method: a.method as DepreciationMethod,
    unitsTotal: a.unitsTotal ? Number(a.unitsTotal) : null,
    inServiceDate: a.inServiceDate,
    accumDepreciation: Number(a.accumDepreciation),
    accumImpairment: Number(a.accumImpairment),
    customSchedule,
  };
}

export function unitFromComponent(c: AssetComponent, inServiceDate: string): DepreciableUnit {
  return {
    cost: Number(c.cost),
    residual: Number(c.residual),
    usefulLifeMonths: c.usefulLifeMonths,
    method: c.method as DepreciationMethod,
    unitsTotal: c.unitsTotal ? Number(c.unitsTotal) : null,
    inServiceDate,
    accumDepreciation: Number(c.accumDepreciation),
    accumImpairment: Number(c.accumImpairment),
  };
}

export function carryingAmount(u: { cost: number | string; accumDepreciation: number | string; accumImpairment: number | string }): number {
  return r2(Number(u.cost) - Number(u.accumDepreciation) - Number(u.accumImpairment));
}
