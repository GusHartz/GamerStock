import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export type Capability =
  | "player_profile_control"
  | "player_treasury_access"
  | "riot_verified";

export type AuthUser = {
  id: string;
  displayName: string;
  email: string;
  role: string;
  mustChangePassword?: boolean;
  status?: string;
};

export type AuthMeResponse = {
  user: AuthUser;
  capabilities: Capability[];
} | null;

async function fetchAuthMe(): Promise<AuthMeResponse> {
  const res = await fetch("/api/auth/me", { credentials: "include" });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`${res.status}: ${res.statusText}`);
  const data = await res.json();
  if (!data.user) return null;
  return {
    user: data.user,
    capabilities: data.capabilities ?? [],
  };
}

async function doLogout() {
  await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
  window.location.href = "/login";
}

export function useAuth() {
  const queryClient = useQueryClient();

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["/api/auth/me"],
    queryFn: fetchAuthMe,
    retry: false,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
    initialData: null as AuthMeResponse,
    initialDataUpdatedAt: 0,
  });

  const logoutMutation = useMutation({
    mutationFn: doLogout,
    onSuccess: () => {
      queryClient.setQueryData(["/api/auth/me"], null);
    },
  });

  // True only during the very first auth check (data is stale initialData + actively fetching).
  // Safe to use in ProtectedRoute: after first fetch data is non-null for authed users,
  // so subsequent refetchOnWindowFocus won't re-trigger the spinner.
  const isInitialLoading = isFetching && data === null;
  const user = data?.user ?? null;
  const isAuthenticated = !!data?.user;

  console.log("AUTH STATE", { user: user?.displayName ?? null, isAuthenticated, isInitialLoading });

  return {
    user,
    capabilities: data?.capabilities ?? ([] as Capability[]),
    isLoading,
    isFetching,
    isInitialLoading,
    isAuthenticated,
    hasCapability: (cap: Capability) => (data?.capabilities ?? []).includes(cap),
    logout: logoutMutation.mutate,
    isLoggingOut: logoutMutation.isPending,
    refreshAuth: () => queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] }),
  };
}
