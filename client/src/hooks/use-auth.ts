import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { User } from "@shared/models/auth";
import type { Role, Company } from "@shared/schema";
import { ROLE_TIER } from "@shared/schema";

export interface MembershipRow {
  id: string;
  userId: string;
  companyId: number;
  role: Role;
  createdAt: string | null;
  company: Company | null;
}
export interface MembershipsPayload {
  memberships: MembershipRow[];
  activeCompanyId: number | null;
}

async function fetchUser(): Promise<User | null> {
  const r = await fetch("/api/auth/user", { credentials: "include" });
  if (r.status === 401) return null;
  if (!r.ok) throw new Error(`${r.status}: ${r.statusText}`);
  return r.json();
}

async function fetchMemberships(): Promise<MembershipsPayload | null> {
  const r = await fetch("/api/auth/memberships", { credentials: "include" });
  if (r.status === 401) return null;
  if (!r.ok) throw new Error(`${r.status}: ${r.statusText}`);
  return r.json();
}

export function useAuth() {
  const qc = useQueryClient();

  const { data: user, isLoading } = useQuery<User | null>({
    queryKey: ["/api/auth/user"],
    queryFn: fetchUser,
    retry: false,
    staleTime: 60_000,
  });

  const { data: membershipsData } = useQuery<MembershipsPayload | null>({
    queryKey: ["/api/auth/memberships"],
    queryFn: fetchMemberships,
    enabled: !!user,
    retry: false,
    staleTime: 60_000,
  });

  const memberships = membershipsData?.memberships ?? [];
  const activeCompanyId =
    (typeof window !== "undefined" && Number(localStorage.getItem("active_company_id")) || null) ||
    membershipsData?.activeCompanyId ||
    memberships[0]?.companyId ||
    null;

  const activeMembership = memberships.find((m) => m.companyId === activeCompanyId) ?? memberships[0];
  const role: Role | undefined = activeMembership?.role;

  function hasRole(...allowed: Role[]): boolean {
    if (!role) return false;
    const min = Math.min(...allowed.map((r) => ROLE_TIER[r]));
    return ROLE_TIER[role] >= min;
  }
  const can = {
    write: role === "admin" || role === "accountant",
    manageMembers: role === "admin",
    invite: role === "admin",
    view: !!role,
  };

  const signOut = useMutation({
    mutationFn: async () => {
      // Try the local signout endpoint first; if it fails (OIDC), fall back to /api/logout.
      const r = await fetch("/api/auth/signout", { method: "POST", credentials: "include" });
      if (!r.ok) {
        window.location.href = "/api/logout";
        return;
      }
      qc.setQueryData(["/api/auth/user"], null);
      qc.removeQueries();
      window.location.href = "/signin";
    },
  });

  return {
    user,
    isLoading,
    isAuthenticated: !!user,
    memberships,
    activeMembership,
    activeCompanyId,
    role,
    hasRole,
    can,
    signOut: signOut.mutate,
    isSigningOut: signOut.isPending,
  };
}
