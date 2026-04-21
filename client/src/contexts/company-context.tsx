import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Company } from "@shared/schema";

interface CompanyContextValue {
  companies: Company[];
  activeCompanyId: number | null;
  activeCompany: Company | undefined;
  setActiveCompanyId: (id: number) => void;
}

const CompanyContext = createContext<CompanyContextValue | undefined>(undefined);
const STORAGE_KEY = "active_company_id";

export function CompanyProvider({ children }: { children: ReactNode }) {
  const { data: companies = [] } = useQuery<Company[]>({ queryKey: ["/api/companies"] });
  const [activeCompanyId, setActiveCompanyIdState] = useState<number | null>(() => {
    const v = localStorage.getItem(STORAGE_KEY);
    return v ? Number(v) : null;
  });

  useEffect(() => {
    if (companies.length > 0 && !activeCompanyId) {
      const def = companies.find((c) => c.isDefault) || companies[0];
      setActiveCompanyIdState(def.id);
      localStorage.setItem(STORAGE_KEY, String(def.id));
    }
  }, [companies, activeCompanyId]);

  function setActiveCompanyId(id: number) {
    setActiveCompanyIdState(id);
    localStorage.setItem(STORAGE_KEY, String(id));
  }

  const activeCompany = useMemo(() => companies.find((c) => c.id === activeCompanyId), [companies, activeCompanyId]);

  return (
    <CompanyContext.Provider value={{ companies, activeCompanyId, activeCompany, setActiveCompanyId }}>
      {children}
    </CompanyContext.Provider>
  );
}

export function useCompany() {
  const ctx = useContext(CompanyContext);
  if (!ctx) throw new Error("useCompany must be used inside <CompanyProvider>");
  return ctx;
}
