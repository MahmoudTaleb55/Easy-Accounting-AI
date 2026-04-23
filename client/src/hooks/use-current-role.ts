import { useQuery } from "@tanstack/react-query";
import type { WorkspaceRole } from "@shared/schema";

export interface CurrentMember {
  id: number;
  name: string;
  email: string;
  role: WorkspaceRole;
  status: string;
}

export interface CurrentRoleInfo {
  role: WorkspaceRole | undefined;
  isLoading: boolean;
  isOwner: boolean;
  isAccountant: boolean;
  isViewer: boolean;
  isAnonymous: boolean;
  canWrite: boolean;
  canManageWorkspace: boolean;
}

export function useCurrentRole(): CurrentRoleInfo {
  const { data, isLoading } = useQuery<CurrentMember>({
    queryKey: ["/api/auth/me"],
    staleTime: 60_000,
    retry: false,
  });
  const role = data?.role;
  const isAnonymous = !data || data.id === 0;
  return {
    role,
    isLoading,
    isOwner: role === "owner",
    isAccountant: role === "accountant",
    isViewer: role === "viewer",
    isAnonymous,
    canWrite: !isAnonymous && (role === "owner" || role === "accountant"),
    canManageWorkspace: !isAnonymous && role === "owner",
  };
}
