import { useQuery } from "@tanstack/react-query";
import { api } from "@shared/routes";
import type { PortfolioDetailsResponse } from "@shared/schema";

export function usePortfolio() {
  return useQuery({
    queryKey: [api.portfolio.get.path],
    queryFn: async () => {
      const res = await fetch(api.portfolio.get.path, { credentials: "include" });
      if (res.status === 401) return null;
      if (res.status === 404) return null; // Portfolio might not exist until first trade, or auto-created
      if (!res.ok) throw new Error("Failed to fetch portfolio");
      return (await res.json()) as PortfolioDetailsResponse;
    },
  });
}
