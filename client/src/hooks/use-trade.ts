import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@shared/routes";
import type { TradeRequest, TradeResponse } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";

export function useTrade() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: TradeRequest) => {
      const res = await fetch(api.trade.execute.path, {
        method: api.trade.execute.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => null);
        throw new Error(errorData?.message || "Trade execution failed");
      }

      return (await res.json()) as TradeResponse;
    },
    onSuccess: (data, variables) => {
      toast({
        title: "Trade Executed",
        description: `Successfully ${variables.type === "BUY" ? "bought" : "sold"} ${variables.shares} shares.`,
      });
      
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: [api.vaults.list.path] });
      queryClient.invalidateQueries({ queryKey: [api.vaults.get.path, variables.vaultId] });
      queryClient.invalidateQueries({ queryKey: [api.portfolio.get.path] });
    },
    onError: (error) => {
      toast({
        title: "Trade Failed",
        description: error.message,
        variant: "destructive",
      });
    }
  });
}
