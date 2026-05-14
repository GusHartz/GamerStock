import { useQuery } from "@tanstack/react-query";

export interface WalletEntry {
  currency: string;
  availableBalance: string;
  lockedBalance: string;
  totalBalance: string;
}

export interface WalletSummary {
  userId: string;
  wallets: WalletEntry[];
}

export function useWallets() {
  return useQuery<WalletSummary>({
    queryKey: ["/api/wallets/me"],
    queryFn: async () => {
      const res = await fetch("/api/wallets/me", { credentials: "include" });
      if (res.status === 401) return { userId: "", wallets: [] };
      if (!res.ok) throw new Error("Failed to load wallets");
      return res.json();
    },
    staleTime: 30000,
  });
}

export function useGsWallet() {
  const { data, ...rest } = useWallets();
  const gsWallet = data?.wallets.find((w) => w.currency === "GS");
  return {
    ...rest,
    gsWallet,
    availableBalance: gsWallet ? parseFloat(gsWallet.availableBalance) : null,
  };
}
