import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Star, TrendingUp, TrendingDown, Trash2 } from "lucide-react";
import { motion } from "framer-motion";

type WatchlistAsset = {
  internalId: number;
  displayName: string;
  region: string | null;
  price: string;
  price24hAgo: string;
  change24hPct: number | null;
  marketCap: string | null;
};

function formatCurrency(val: string | number | null | undefined) {
  const n = parseFloat(String(val ?? "0"));
  return isNaN(n) ? "—" : `$${n.toFixed(2)}`;
}

function formatPercent(val: number | null | undefined) {
  if (val == null) return "—";
  return `${val >= 0 ? "+" : ""}${val.toFixed(2)}%`;
}

export default function WatchlistPage() {
  const qc = useQueryClient();

  const { data: assets, isLoading } = useQuery<WatchlistAsset[]>({
    queryKey: ["/api/assets/watchlist"],
    queryFn: async () => {
      const res = await fetch("/api/assets/watchlist", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch watchlist");
      return res.json();
    },
    refetchInterval: 5000,
  });

  const removeMutation = useMutation({
    mutationFn: async (assetId: number) => {
      const res = await fetch(`/api/assets/watchlist/${assetId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to remove from watchlist");
    },
    onMutate: async (assetId) => {
      await qc.cancelQueries({ queryKey: ["/api/assets/watchlist"] });
      const prev = qc.getQueryData<WatchlistAsset[]>(["/api/assets/watchlist"]);
      qc.setQueryData<WatchlistAsset[]>(["/api/assets/watchlist"], (old) =>
        (old ?? []).filter((a) => a.internalId !== assetId)
      );
      return { prev };
    },
    onError: (_err, _id, context) => {
      qc.setQueryData(["/api/assets/watchlist"], context?.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["/api/assets/watchlist"] });
    },
  });

  return (
    <div className="flex flex-col gap-8 animate-in fade-in duration-500 pb-20">
      <div>
        <h1 className="text-4xl font-display font-bold text-white tracking-tight">Personal Watchlist</h1>
        <p className="text-muted-foreground mt-2 text-lg">Tracking your favorite players across the rift.</p>
      </div>

      <div className="glass-panel rounded-2xl overflow-hidden shadow-2xl border-white/5">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse whitespace-nowrap">
            <thead>
              <tr className="bg-secondary/40 border-b border-white/5 text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                <th className="p-6">Player</th>
                <th className="p-6 text-right">Price</th>
                <th className="p-6 text-right">Market Cap</th>
                <th className="p-6 text-right">24h Change</th>
                <th className="p-6">Region</th>
                <th className="p-6">Rank Tier</th>
                <th className="p-6 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 font-mono text-sm">
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    <td className="p-6"><div className="h-4 bg-white/5 rounded w-32"></div></td>
                    <td className="p-6"><div className="h-4 bg-white/5 rounded w-16 ml-auto"></div></td>
                    <td className="p-6"><div className="h-4 bg-white/5 rounded w-20 ml-auto"></div></td>
                    <td className="p-6"><div className="h-4 bg-white/5 rounded w-16 ml-auto"></div></td>
                    <td className="p-6"><div className="h-4 bg-white/5 rounded w-12"></div></td>
                    <td className="p-6"><div className="h-4 bg-white/5 rounded w-20"></div></td>
                    <td className="p-6"><div className="h-4 bg-white/5 rounded w-10 mx-auto"></div></td>
                  </tr>
                ))
              ) : !assets || assets.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-12 text-center text-muted-foreground font-sans">
                    <Star className="w-12 h-12 mx-auto mb-4 opacity-10" />
                    <p>Your watchlist is empty.</p>
                    <Link href="/" className="text-primary hover:underline mt-2 inline-block">Go to Market Terminal</Link>
                  </td>
                </tr>
              ) : (
                assets.map((asset, idx) => {
                  const isPositive = (asset.change24hPct ?? 0) >= 0;
                  return (
                    <motion.tr
                      key={asset.internalId}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: idx * 0.05 }}
                      className="hover:bg-white/[0.02] transition-colors group"
                      data-testid={`row-watchlist-${asset.internalId}`}
                    >
                      <td className="p-6 font-display font-bold text-white">
                        <span data-testid={`text-player-${asset.internalId}`}>
                          {asset.displayName}
                        </span>
                      </td>
                      <td className="p-6 text-right font-bold text-white" data-testid={`text-price-${asset.internalId}`}>
                        {formatCurrency(asset.price)}
                      </td>
                      <td className="p-6 text-right font-bold text-primary" data-testid={`text-marketcap-${asset.internalId}`}>
                        {asset.marketCap ? formatCurrency(asset.marketCap) : "—"}
                      </td>
                      <td className={`p-6 text-right font-bold ${isPositive ? "text-emerald-400" : "text-rose-400"}`} data-testid={`text-change-${asset.internalId}`}>
                        <div className="flex items-center justify-end gap-1">
                          {isPositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                          {formatPercent(asset.change24hPct)}
                        </div>
                      </td>
                      <td className="p-6 text-muted-foreground" data-testid={`text-region-${asset.internalId}`}>
                        {asset.region?.toUpperCase() ?? "—"}
                      </td>
                      <td className="p-6">
                        <span className="px-2.5 py-1 rounded bg-secondary text-xs font-sans text-muted-foreground border border-white/5">
                          Challenger
                        </span>
                      </td>
                      <td className="p-6 text-center">
                        <button
                          onClick={() => removeMutation.mutate(asset.internalId)}
                          disabled={removeMutation.isPending}
                          className="p-2 text-muted-foreground hover:text-rose-400 transition-colors disabled:opacity-40"
                          title="Remove from watchlist"
                          data-testid={`button-remove-watchlist-${asset.internalId}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </motion.tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
