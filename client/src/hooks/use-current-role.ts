import { useQuery } from "@tanstack/react-query";
import type { WorkspaceRole } from "@shared/schema";
import { useAuth } from "./use-auth";

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

/**
 * Thin wrapper around `useAuth` that exposes the current user's workspace
 * role under a permission-shaped API. Both hooks now read from the same
 * canonical role enum (owner | accountant | viewer) — historically they
 * spoke different vocabularies, which led to subtle gating drift, so this
 * file delegates to `useAuth` to guarantee a single source of truth.
 *
 * The `/api/auth/me` query is kept as a secondary signal (primarily for
 * anonymous visitors): the server's `/api/auth/me` handler now projects
 * the response in memory from the canonical `users` + `memberships`
 * tables — the legacy `workspace_members` mirror has been removed — and
 * returns `id: 0` exactly when the request is anonymous.
 */
export function useCurrentRole(): CurrentRoleInfo {
  const { role: authRole, isLoading: authLoading, isAuthenticated } = useAuth();
  const { data: me, isLoading: meLoading } = useQuery<CurrentMember>({
    queryKey: ["/api/auth/me"],
    staleTime: 60_000,
    retry: false,
  });

  // Prefer the membership-derived role from useAuth so the gating reflects
  // the active workspace; fall back to the `/api/auth/me` projection for
  // anonymous visitors (where useAuth has no role to surface).
  const role = authRole ?? me?.role;
  const isAnonymous = !isAuthenticated && (!me || me.id === 0);

  return {
    role,
    isLoading: authLoading || meLoading,
    isOwner: role === "owner",
    isAccountant: role === "accountant",
    isViewer: role === "viewer",
    isAnonymous,
    canWrite: !isAnonymous && (role === "owner" || role === "accountant"),
    canManageWorkspace: !isAnonymous && role === "owner",
  };
}
