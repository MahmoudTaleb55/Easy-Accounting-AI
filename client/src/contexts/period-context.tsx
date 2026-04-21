import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import {
  startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth,
  startOfQuarter, endOfQuarter, startOfYear, subDays, differenceInCalendarDays,
} from "date-fns";

export type PeriodKey = "today" | "week" | "month" | "quarter" | "ytd" | "30d";

export interface PeriodRange {
  key: PeriodKey;
  start: Date;
  end: Date;
}

interface PeriodContextValue {
  period: PeriodRange;
  setPeriodKey: (k: PeriodKey) => void;
  compareToPrevious: boolean;
  setCompareToPrevious: (v: boolean) => void;
  previousRange: PeriodRange;
}

function rangeFor(key: PeriodKey): PeriodRange {
  const now = new Date();
  switch (key) {
    case "today":   return { key, start: startOfDay(now), end: endOfDay(now) };
    case "week":    return { key, start: startOfWeek(now, { weekStartsOn: 6 }), end: endOfWeek(now, { weekStartsOn: 6 }) };
    case "month":   return { key, start: startOfMonth(now), end: endOfMonth(now) };
    case "quarter": return { key, start: startOfQuarter(now), end: endOfQuarter(now) };
    case "ytd":     return { key, start: startOfYear(now), end: endOfDay(now) };
    case "30d":     return { key, start: startOfDay(subDays(now, 29)), end: endOfDay(now) };
  }
}

function previousFor(r: PeriodRange): PeriodRange {
  const days = Math.max(1, differenceInCalendarDays(r.end, r.start) + 1);
  return { key: r.key, start: subDays(r.start, days), end: subDays(r.end, days) };
}

const PeriodContext = createContext<PeriodContextValue | null>(null);

export function PeriodProvider({ children }: { children: ReactNode }) {
  const [periodKey, setPeriodKey] = useState<PeriodKey>("month");
  const [compareToPrevious, setCompareToPrevious] = useState(true);
  const period = useMemo(() => rangeFor(periodKey), [periodKey]);
  const previousRange = useMemo(() => previousFor(period), [period]);
  const value = useMemo(
    () => ({ period, setPeriodKey, compareToPrevious, setCompareToPrevious, previousRange }),
    [period, compareToPrevious, previousRange]
  );
  return <PeriodContext.Provider value={value}>{children}</PeriodContext.Provider>;
}

export function usePeriod() {
  const ctx = useContext(PeriodContext);
  if (!ctx) throw new Error("usePeriod must be used within <PeriodProvider>");
  return ctx;
}
