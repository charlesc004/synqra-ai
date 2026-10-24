"use client";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import type { ProviderStatus, User, Workspace } from "@/lib/types";

export function useCurrentUser() {
  return useQuery({
    queryKey: ["me"],
    queryFn: () => api<User>("/auth/me"),
    retry: false,
  });
}

export function useWorkspaces(userId?: string) {
  return useQuery({
    queryKey: ["workspaces"],
    queryFn: () => api<Workspace[]>("/workspaces"),
    enabled: !!userId,
    retry: false,
  });
}

export function useProviderStatus(workspaceId?: string) {
  return useQuery({
    queryKey: ["provider", workspaceId],
    queryFn: () => api<ProviderStatus>("/providers/status", {}, workspaceId),
    enabled: !!workspaceId,
    staleTime: 30000,
  });
}
