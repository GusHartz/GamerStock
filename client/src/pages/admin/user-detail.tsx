import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useRoute, Link } from "wouter";
import { AdminLayout } from "./layout";
import { formatCurrency, formatNumber } from "@/lib/format";
import { ArrowLeft, Shield, ShieldOff, Wallet, TrendingUp, Star, Activity, User as UserIcon } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type UserDetailResponse = {
  user: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    displayName: string | null;
    email: string | null;
    gamesSelected: string[] | null;
    createdAt: string | null;
    status: string | null;
    role: string | null;
  };
  portfolio: { id: number; balance: string; updatedAt: string } | null;
  positions: Array<{
    id: number;
    shares: number;
    averageCost: string;
    vault: { id: number; playerAlias: string; lastTradePrice: string; rank: string };
  }>;
  watchlistItems: Array<{ id: number; playerAlias: string; lastTradePrice: string; rank: string }>;
  recentTrades: Array<{
    id: number;
    type: "BUY" | "SELL";
    shares: number;
    pricePerShare: string;
    totalCost: string;
    fee: string;
    executedAt: string;
    vault: { playerAlias: string };
  }>;
};

function StatCard({ label, value, icon: Icon, color = "text-white" }: { label: string; value: string; icon: any; color?: string }) {
  return (
    <div className="bg-card border border-white/10 rounded-xl p-4 flex items-start gap-3">
      <div className="w-9 h-9 rounded-lg bg-white/5 flex items-center justify-center flex-shrink-0">
        <Icon className={`w-4 h-4 ${color}`} />
      </div>
      <div>
        <div className="text-xs text-muted-foreground font-medium uppercase tracking-wider">{label}</div>
        <div className={`text-lg font-bold font-mono mt-0.5 ${color}`}>{value}</div>
      </div>
    </div>
  );
}

export default function AdminUserDetailPage() {
  const [, params] = useRoute("/admin/users/:id");
  const userId = params?.id || "";
  const { toast } = useToast();

  const { data, isLoading } = useQuery<UserDetailResponse>({
    queryKey: ["/api/admin/users", userId],
    enabled: !!userId,
  });

  const blockMutation = useMutation({
    mutationFn: () => apiRequest("PATCH", `/api/admin/users/${userId}/block`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users", userId] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "User blocked" });
    },
    onError: () => toast({ title: "Failed to block user", variant: "destructive" }),
  });

  const unblockMutation = useMutation({
    mutationFn: () => apiRequest("PATCH", `/api/admin/users/${userId}/unblock`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users", userId] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "User unblocked" });
    },
    onError: () => toast({ title: "Failed to unblock user", variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <AdminLayout>
        <div className="space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 bg-card rounded-xl border border-white/10 animate-pulse" />
          ))}
        </div>
      </AdminLayout>
    );
  }

  if (!data) {
    return (
      <AdminLayout>
        <div className="text-center py-12 text-muted-foreground">User not found.</div>
      </AdminLayout>
    );
  }

  const { user, portfolio, positions, watchlistItems, recentTrades } = data;
  const isBlocked = user.status === "blocked";
  const holdingsValue = positions.reduce((sum, p) => sum + parseFloat(p.vault.lastTradePrice) * p.shares, 0);
  const totalValue = (portfolio ? parseFloat(portfolio.balance) : 0) + holdingsValue;

  return (
    <AdminLayout>
      <div className="flex flex-col gap-6">
        <div className="flex items-center gap-3">
          <Link href="/admin/users">
            <button className="p-2 rounded-lg text-muted-foreground hover:text-white hover:bg-white/10 transition-colors" data-testid="button-back-to-users">
              <ArrowLeft className="w-4 h-4" />
            </button>
          </Link>
          <div className="flex-1 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-violet-500/30 to-purple-700/30 border border-violet-500/20 flex items-center justify-center">
              <UserIcon className="w-5 h-5 text-violet-400" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">{user.displayName || [user.firstName, user.lastName].filter(Boolean).join(" ") || "Unknown"}</h2>
              <div className="text-sm text-muted-foreground">{user.email}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${isBlocked ? "bg-red-500/15 text-red-400 border-red-500/20" : "bg-emerald-500/15 text-emerald-400 border-emerald-500/20"}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${isBlocked ? "bg-red-400" : "bg-emerald-400"}`} />
              {isBlocked ? "Blocked" : "Active"}
            </span>
            {isBlocked ? (
              <button
                onClick={() => unblockMutation.mutate()}
                disabled={unblockMutation.isPending}
                data-testid="button-unblock-user"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-sm font-medium hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
              >
                <ShieldOff className="w-3.5 h-3.5" />
                Unblock
              </button>
            ) : (
              <button
                onClick={() => blockMutation.mutate()}
                disabled={blockMutation.isPending}
                data-testid="button-block-user"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 text-sm font-medium hover:bg-red-500/20 transition-colors disabled:opacity-50"
              >
                <Shield className="w-3.5 h-3.5" />
                Block
              </button>
            )}
          </div>
        </div>

        <div className="bg-card border border-white/10 rounded-xl p-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <div className="text-muted-foreground text-xs mb-1">Name</div>
            <div className="text-white">{[user.firstName, user.lastName].filter(Boolean).join(" ") || "—"}</div>
          </div>
          <div>
            <div className="text-muted-foreground text-xs mb-1">Role</div>
            <div className="text-white">{user.role || "user"}</div>
          </div>
          <div>
            <div className="text-muted-foreground text-xs mb-1">Joined</div>
            <div className="text-white">{user.createdAt ? new Date(user.createdAt).toLocaleDateString() : "—"}</div>
          </div>
          <div>
            <div className="text-muted-foreground text-xs mb-1">Games</div>
            <div className="text-white">{(user.gamesSelected || []).join(", ") || "—"}</div>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="Cash Balance" value={portfolio ? formatCurrency(portfolio.balance) : "—"} icon={Wallet} color="text-emerald-400" />
          <StatCard label="Holdings Value" value={formatCurrency(holdingsValue.toFixed(2))} icon={TrendingUp} color="text-primary" />
          <StatCard label="Total Value" value={formatCurrency(totalValue.toFixed(2))} icon={Activity} color="text-violet-400" />
          <StatCard label="Watchlist Items" value={watchlistItems.length.toString()} icon={Star} color="text-yellow-400" />
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          <div className="bg-card border border-white/10 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-white/10 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-primary" />
              <h3 className="font-semibold text-white text-sm">Holdings ({positions.length})</h3>
            </div>
            <div className="divide-y divide-white/5 max-h-72 overflow-y-auto">
              {positions.length === 0 ? (
                <div className="px-4 py-6 text-center text-muted-foreground text-sm">No holdings</div>
              ) : positions.map(pos => (
                <div key={pos.id} className="px-4 py-2.5 flex items-center justify-between">
                  <div>
                    <div className="font-medium text-white text-sm">{pos.vault.playerAlias}</div>
                    <div className="text-xs text-muted-foreground">{pos.shares} shares · avg {formatCurrency(pos.averageCost)}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-mono text-white">{formatCurrency((parseFloat(pos.vault.lastTradePrice) * pos.shares).toFixed(2))}</div>
                    <div className="text-xs text-muted-foreground">{formatCurrency(pos.vault.lastTradePrice)}/sh</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-card border border-white/10 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-white/10 flex items-center gap-2">
              <Star className="w-4 h-4 text-yellow-400" />
              <h3 className="font-semibold text-white text-sm">Watchlist ({watchlistItems.length})</h3>
            </div>
            <div className="divide-y divide-white/5 max-h-72 overflow-y-auto">
              {watchlistItems.length === 0 ? (
                <div className="px-4 py-6 text-center text-muted-foreground text-sm">Empty watchlist</div>
              ) : watchlistItems.map(vault => (
                <div key={vault.id} className="px-4 py-2.5 flex items-center justify-between">
                  <div className="font-medium text-white text-sm">{vault.playerAlias}</div>
                  <div className="text-sm font-mono text-white">{formatCurrency(vault.lastTradePrice)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="bg-card border border-white/10 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-white/10 flex items-center gap-2">
            <Activity className="w-4 h-4 text-violet-400" />
            <h3 className="font-semibold text-white text-sm">Recent Trades (last 20)</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/5 bg-white/3">
                  <th className="text-left px-4 py-2 text-muted-foreground font-medium text-xs">Player</th>
                  <th className="text-left px-4 py-2 text-muted-foreground font-medium text-xs">Type</th>
                  <th className="text-right px-4 py-2 text-muted-foreground font-medium text-xs">Shares</th>
                  <th className="text-right px-4 py-2 text-muted-foreground font-medium text-xs">Price</th>
                  <th className="text-right px-4 py-2 text-muted-foreground font-medium text-xs">Total</th>
                  <th className="text-right px-4 py-2 text-muted-foreground font-medium text-xs">Date</th>
                </tr>
              </thead>
              <tbody>
                {recentTrades.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">No trades yet</td></tr>
                ) : recentTrades.map(trade => (
                  <tr key={trade.id} className="border-b border-white/5 hover:bg-white/3">
                    <td className="px-4 py-2.5 text-white">{trade.vault.playerAlias}</td>
                    <td className="px-4 py-2.5">
                      <span className={`font-semibold ${trade.type === "BUY" ? "text-primary" : "text-red-400"}`}>{trade.type}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right text-white font-mono">{trade.shares}</td>
                    <td className="px-4 py-2.5 text-right text-white font-mono">{formatCurrency(trade.pricePerShare)}</td>
                    <td className="px-4 py-2.5 text-right text-white font-mono">{formatCurrency(trade.totalCost)}</td>
                    <td className="px-4 py-2.5 text-right text-muted-foreground text-xs">{new Date(trade.executedAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
