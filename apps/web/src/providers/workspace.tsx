"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, useContext, useInsertionEffect, useState, type ReactNode } from "react";
import { setNonce } from "get-nonce";
import { useCurrentUser, useWorkspaces } from "@/lib/queries";
import type { User, Workspace } from "@/lib/types";
type Context = {
  user: User | undefined;
  workspaces: Workspace[];
  workspace: Workspace | undefined;
  selectWorkspace: (id: string) => void;
  admin: boolean;
  canWrite: boolean;
};
const WorkspaceContext = createContext<Context | null>(null);
function WorkspaceProvider({ children }: { children: ReactNode }) {
  const me = useCurrentUser();
  const list = useWorkspaces(me.data?.id);
  const [selected, setSelected] = useState("");
  const workspace = list.data?.find((w) => w.id === selected) || list.data?.[0];
  const admin = workspace?.role === "owner" || workspace?.role === "admin";
  return (
    <WorkspaceContext.Provider
      value={{
        user: me.data,
        workspace,
        workspaces: list.data || [],
        selectWorkspace: setSelected,
        admin,
        canWrite: !!workspace && workspace.role !== "viewer",
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}
export function Providers({ children, nonce }: { children: ReactNode; nonce?: string }) {
  useInsertionEffect(() => {
    // Keep dynamically inserted Radix styles tied to the current document's policy,
    // including after a router refresh produces a different server request nonce.
    const documentNonce = document.querySelector<HTMLScriptElement>("script[nonce]")?.nonce;
    const activeNonce = documentNonce || nonce;
    if (activeNonce) setNonce(activeNonce);
  }, [nonce]);
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 20000, retry: 1, refetchOnWindowFocus: false },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <WorkspaceProvider>{children}</WorkspaceProvider>
    </QueryClientProvider>
  );
}
export function useWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("Missing workspace provider");
  return value;
}
