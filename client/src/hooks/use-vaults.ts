/**
 * LEGACY — Sandbox / Vault Model
 *
 * This hook belongs to the original GamerStock sandbox (vault/fake-player) system.
 * Do NOT use for new feature work.
 *
 * Official path for player/asset data:
 *   - useRiotAssets() / useRiotAsset() from @/hooks/use-riot-assets (Riot market)
 *   - /api/market/assets and /api/riot/players (canonical endpoints)
 *
 * Retirement plan:
 *   - KEEP until vault-detail page is migrated to the Riot player/asset model
 *   - REMOVE when /vault/:id route is removed or redirected to /asset/:puuid
 *   - See: docs/architecture/legacy-freeze-and-retirement-plan.md
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";
import type { PaginatedVaultsResponse, VaultDetailsResponse } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";

interface UseVaultsParams {
  page?: number;
  limit?: number;
  search?: string;
  rank?: string;
  region?: string;
  sort?: string;
  order?: "asc" | "desc";
}

export function useVaults(params: UseVaultsParams, queryOptions: any = {}) {
  return useQuery({
    queryKey: [api.vaults.list.path, params],
    queryFn: async () => {
      // Build query string, omitting empty values
      const queryParams = new URLSearchParams();
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== "") {
          queryParams.append(key, String(value));
        }
      });
      
      const url = `${api.vaults.list.path}?${queryParams.toString()}`;
      const res = await fetch(url, { credentials: "include" });
      
      if (!res.ok) throw new Error("Failed to fetch vaults");
      return (await res.json()) as PaginatedVaultsResponse;
    },
    ...queryOptions
  });
}

export function useVault(id: number, queryOptions: any = {}) {
  return useQuery({
    queryKey: [api.vaults.get.path, id],
    queryFn: async () => {
      if (!id) throw new Error("Vault ID is required");
      const url = buildUrl(api.vaults.get.path, { id });
      const res = await fetch(url, { credentials: "include" });
      
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("Failed to fetch vault details");
      return (await res.json()) as VaultDetailsResponse;
    },
    enabled: !!id,
    ...queryOptions
  });
}

export function useRecentTrades(queryOptions: any = {}) {
  return useQuery({
    queryKey: [api.trade.recent.path],
    queryFn: async () => {
      const res = await fetch(api.trade.recent.path, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch recent trades");
      return (await res.json()) as any[];
    },
    ...queryOptions
  });
}

export function useRiotRecentTrades(queryOptions: any = {}) {
  return useQuery({
    queryKey: ["/api/riot/trades/recent"],
    queryFn: async () => {
      const res = await fetch("/api/riot/trades/recent", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch recent riot trades");
      return (await res.json()) as any[];
    },
    ...queryOptions
  });
}

export function useWatchlist(queryOptions: any = {}) {
  return useQuery({
    queryKey: [api.watchlist.list.path],
    queryFn: async () => {
      const res = await fetch(api.watchlist.list.path, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch watchlist");
      return (await res.json()) as any[];
    },
    ...queryOptions
  });
}

export function useWatchlistMutation() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const add = useMutation({
    mutationFn: async (vaultId: number) => {
      console.log("Adding to watchlist:", vaultId);
      const res = await fetch(api.watchlist.add.path, { 
        method: "POST", 
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vaultId: Number(vaultId) }),
        credentials: "include" 
      });
      
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.error("Watchlist API error response:", data);
        throw new Error(data.details || data.error || `HTTP ${res.status}: Failed to add to watchlist`);
      }
      return data;
    },
    onMutate: async (vaultId) => {
      await queryClient.cancelQueries({ queryKey: [api.watchlist.list.path] });
      const previousWatchlist = queryClient.getQueryData<any[]>([api.watchlist.list.path]);
      
      queryClient.setQueryData([api.watchlist.list.path], (old: any[] | undefined) => {
        const list = old || [];
        if (list.some((v: any) => v.id === vaultId)) return list;
        
        // Find the vault in the existing cache if possible
        const allVaults = (queryClient.getQueryData([api.vaults.list.path]) as any)?.data || [];
        const vault = allVaults.find((v: any) => v.id === vaultId);
        
        return [...list, vault || { id: vaultId, playerAlias: "Loading..." }];
      });
      
      return { previousWatchlist };
    },
    onError: (err: any, vaultId, context: any) => {
      queryClient.setQueryData([api.watchlist.list.path], context?.previousWatchlist);
      toast({ 
        title: "Watchlist Error", 
        description: err.message, 
        variant: "destructive" 
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: [api.watchlist.list.path] });
    }
  });

  const remove = useMutation({
    mutationFn: async (vaultId: number) => {
      console.log("Removing from watchlist:", vaultId);
      const res = await fetch(buildUrl(api.watchlist.remove.path, { id: vaultId }), { 
        method: "DELETE", 
        credentials: "include" 
      });
      
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.error("Watchlist API error response:", data);
        throw new Error(data.details || data.error || `HTTP ${res.status}: Failed to remove from watchlist`);
      }
      return data;
    },
    onMutate: async (vaultId) => {
      await queryClient.cancelQueries({ queryKey: [api.watchlist.list.path] });
      const previousWatchlist = queryClient.getQueryData<any[]>([api.watchlist.list.path]);
      
      queryClient.setQueryData([api.watchlist.list.path], (old: any[] | undefined) => {
        return (old || []).filter((v: any) => v.id !== vaultId);
      });
      
      return { previousWatchlist };
    },
    onError: (err: any, vaultId, context: any) => {
      queryClient.setQueryData([api.watchlist.list.path], context?.previousWatchlist);
      toast({ 
        title: "Watchlist Error", 
        description: err.message, 
        variant: "destructive" 
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: [api.watchlist.list.path] });
    }
  });

  return { add, remove };
}

export function useSeedDatabase() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async () => {
      const res = await fetch(api.seed.execute.path, { 
        method: api.seed.execute.method,
        credentials: "include" 
      });
      if (!res.ok) throw new Error("Failed to seed database");
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Market Initialized",
        description: "1,000 player vaults have been seeded successfully.",
      });
      queryClient.invalidateQueries({ queryKey: [api.vaults.list.path] });
    },
    onError: (error) => {
      toast({
        title: "Seed Failed",
        description: error.message,
        variant: "destructive",
      });
    }
  });
}
