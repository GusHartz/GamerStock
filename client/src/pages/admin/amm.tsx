import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency } from "@/lib/format";
import { Zap, RefreshCw, TrendingUp } from "lucide-react";
import { AdminLayout } from "./layout";

type AmmMarket = {
  assetId: number;
  displayName: string | null;
  curveType: string;
  floorPrice: string;
  paramA: string;
  paramB: string;
  feeBps: number;
  platformFeeSplitBps: number;
  playerFeeSplitBps: number;
  isEnabled: boolean;
  supply: string | null;
  lastPrice: string | null;
  version: number | null;
  playerFeeBalance: string | null;
};

type AmmMarketsResponse = { total: number; markets: AmmMarket[] };

export default function AdminAmmPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<Partial<{
    floorPrice: number; paramA: number; paramB: number;
    feeBps: number; platformFeeSplitBps: number; playerFeeSplitBps: number; isEnabled: boolean;
  }>>({});

  const { data, isLoading } = useQuery<AmmMarketsResponse>({
    queryKey: ["/api/admin/amm/markets"],
    queryFn: async () => {
      const res = await fetch("/api/admin/amm/markets", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load AMM markets");
      return res.json();
    },
    refetchInterval: 10000,
  });

  const seedMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/admin/amm/seed", {}),
    onSuccess: (data: any) => {
      toast({ title: "AMM Seeded", description: `Seeded ${data.seeded} new markets, ${data.skipped} skipped` });
      qc.invalidateQueries({ queryKey: ["/api/admin/amm/markets"] });
    },
    onError: () => toast({ title: "Seed failed", variant: "destructive" }),
  });

  const patchMutation = useMutation({
    mutationFn: ({ assetId, body }: { assetId: number; body: any }) =>
      apiRequest("PATCH", `/api/admin/amm/markets/${assetId}`, body),
    onSuccess: () => {
      toast({ title: "Market updated" });
      setEditingId(null);
      qc.invalidateQueries({ queryKey: ["/api/admin/amm/markets"] });
    },
    onError: (e: any) => toast({ title: "Update failed", description: e?.message, variant: "destructive" }),
  });

  const markets = data?.markets ?? [];
  const filtered = markets.filter((m) =>
    !search || (m.displayName ?? "").toLowerCase().includes(search.toLowerCase())
  );

  const stats = {
    total: markets.length,
    enabled: markets.filter((m) => m.isEnabled).length,
    seeded: markets.filter((m) => m.supply !== null).length,
    totalFees: markets.reduce((acc, m) => acc + parseFloat(m.playerFeeBalance ?? "0"), 0),
  };

  return (
    <AdminLayout>
    <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Zap className="w-5 h-5 text-primary" />
            <div>
              <h1 className="text-xl font-bold text-foreground">AMM Market Engine</h1>
              <p className="text-xs text-muted-foreground">Bonding curve configuration — logarithmic pricing</p>
            </div>
          </div>
          <button
            data-testid="btn-seed-amm"
            onClick={() => seedMutation.mutate()}
            disabled={seedMutation.isPending}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-primary/20 hover:bg-primary/30 text-primary text-sm font-medium transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${seedMutation.isPending ? "animate-spin" : ""}`} />
            {seedMutation.isPending ? "Seeding…" : "Seed Markets"}
          </button>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Total Markets", value: stats.total.toLocaleString() },
            { label: "Enabled", value: stats.enabled.toLocaleString() },
            { label: "Seeded", value: stats.seeded.toLocaleString() },
            { label: "Accumulated Player Fees", value: formatCurrency(stats.totalFees) },
          ].map((s) => (
            <div key={s.label} className="rounded-lg border border-white/5 bg-card p-4">
              <div className="text-xs text-muted-foreground mb-1">{s.label}</div>
              <div className="text-lg font-bold text-foreground font-mono">{s.value}</div>
            </div>
          ))}
        </div>

        {/* Curve info */}
        <div className="rounded-lg border border-white/5 bg-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-4 h-4 text-primary" />
            <span className="text-sm font-semibold text-foreground">Bonding Curve Formula</span>
          </div>
          <p className="text-xs font-mono text-muted-foreground">
            price(s) = F + A × ln(1 + s/B) &nbsp;&nbsp;|&nbsp;&nbsp; F = floor price, A = scale factor, B = liquidity depth
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Defaults: F=5, A=5, B=100, fee=200bps (2%). Fee split: 50% platform / 50% player.
          </p>
        </div>

        {/* Search */}
        <input
          data-testid="input-amm-search"
          type="text"
          placeholder="Search player name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-sm px-3 py-2 rounded-lg bg-card border border-white/10 text-sm text-foreground focus:outline-none focus:border-primary"
        />

        {/* Table */}
        <div className="rounded-lg border border-white/5 bg-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/5 bg-white/3">
                  <th className="text-left px-3 py-2 text-muted-foreground font-medium">Player</th>
                  <th className="text-right px-3 py-2 text-muted-foreground font-medium">Supply</th>
                  <th className="text-right px-3 py-2 text-muted-foreground font-medium">Last Price</th>
                  <th className="text-right px-3 py-2 text-muted-foreground font-medium">Floor (F)</th>
                  <th className="text-right px-3 py-2 text-muted-foreground font-medium">Scale (A)</th>
                  <th className="text-right px-3 py-2 text-muted-foreground font-medium">Depth (B)</th>
                  <th className="text-right px-3 py-2 text-muted-foreground font-medium">Fee bps</th>
                  <th className="text-right px-3 py-2 text-muted-foreground font-medium">Player Fees</th>
                  <th className="text-right px-3 py-2 text-muted-foreground font-medium">Ver</th>
                  <th className="text-center px-3 py-2 text-muted-foreground font-medium">Enabled</th>
                  <th className="text-center px-3 py-2 text-muted-foreground font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  [...Array(10)].map((_, i) => (
                    <tr key={i} className="border-b border-white/5">
                      {[...Array(11)].map((_, j) => (
                        <td key={j} className="px-3 py-2">
                          <div className="h-3 bg-white/10 rounded animate-pulse" />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="px-3 py-8 text-center text-muted-foreground">No markets found</td>
                  </tr>
                ) : (
                  filtered.map((m) => {
                    const isEditing = editingId === m.assetId;
                    return (
                      <tr
                        key={m.assetId}
                        data-testid={`amm-row-${m.assetId}`}
                        className="border-b border-white/5 hover:bg-white/3 transition-colors"
                      >
                        <td className="px-3 py-2 text-foreground font-medium max-w-[160px] truncate">{m.displayName ?? `Asset ${m.assetId}`}</td>
                        <td className="px-3 py-2 text-right font-mono text-foreground">{m.supply ? parseFloat(m.supply).toFixed(1) : "—"}</td>
                        <td className="px-3 py-2 text-right font-mono text-foreground">{m.lastPrice ? formatCurrency(parseFloat(m.lastPrice)) : "—"}</td>

                        {isEditing ? (
                          <>
                            {(["floorPrice", "paramA", "paramB", "feeBps"] as const).map((field) => (
                              <td key={field} className="px-1 py-1 text-right">
                                <input
                                  type="number"
                                  step="0.01"
                                  value={editForm[field] ?? (field === "feeBps" ? m.feeBps : parseFloat(m[field === "floorPrice" ? "floorPrice" : field === "paramA" ? "paramA" : "paramB"]))}
                                  onChange={(e) => setEditForm((prev) => ({ ...prev, [field]: parseFloat(e.target.value) }))}
                                  className="w-16 text-right bg-white/10 border border-white/20 rounded px-1 py-0.5 text-xs font-mono text-foreground focus:outline-none focus:border-primary"
                                />
                              </td>
                            ))}
                            <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                              {m.playerFeeBalance ? formatCurrency(parseFloat(m.playerFeeBalance)) : "$0.00"}
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-muted-foreground">{m.version ?? 0}</td>
                            <td className="px-3 py-2 text-center">
                              <input
                                type="checkbox"
                                checked={editForm.isEnabled ?? m.isEnabled}
                                onChange={(e) => setEditForm((prev) => ({ ...prev, isEnabled: e.target.checked }))}
                                className="accent-primary"
                              />
                            </td>
                            <td className="px-3 py-2 text-center">
                              <div className="flex items-center justify-center gap-1">
                                <button
                                  data-testid={`btn-save-amm-${m.assetId}`}
                                  onClick={() => patchMutation.mutate({ assetId: m.assetId, body: editForm })}
                                  disabled={patchMutation.isPending}
                                  className="px-2 py-0.5 rounded bg-primary/20 text-primary text-xs hover:bg-primary/30 transition-colors"
                                >
                                  Save
                                </button>
                                <button
                                  onClick={() => { setEditingId(null); setEditForm({}); }}
                                  className="px-2 py-0.5 rounded bg-white/5 text-muted-foreground text-xs hover:bg-white/10 transition-colors"
                                >
                                  ✕
                                </button>
                              </div>
                            </td>
                          </>
                        ) : (
                          <>
                            <td className="px-3 py-2 text-right font-mono text-muted-foreground">{parseFloat(m.floorPrice).toFixed(2)}</td>
                            <td className="px-3 py-2 text-right font-mono text-muted-foreground">{parseFloat(m.paramA).toFixed(2)}</td>
                            <td className="px-3 py-2 text-right font-mono text-muted-foreground">{parseFloat(m.paramB).toFixed(2)}</td>
                            <td className="px-3 py-2 text-right font-mono text-muted-foreground">{m.feeBps}</td>
                            <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                              {m.playerFeeBalance ? formatCurrency(parseFloat(m.playerFeeBalance)) : "$0.00"}
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-muted-foreground">{m.version ?? 0}</td>
                            <td className="px-3 py-2 text-center">
                              <span className={`inline-block w-2 h-2 rounded-full ${m.isEnabled ? "bg-emerald-400" : "bg-muted-foreground/30"}`} />
                            </td>
                            <td className="px-3 py-2 text-center">
                              <button
                                data-testid={`btn-edit-amm-${m.assetId}`}
                                onClick={() => {
                                  setEditingId(m.assetId);
                                  setEditForm({
                                    floorPrice: parseFloat(m.floorPrice),
                                    paramA: parseFloat(m.paramA),
                                    paramB: parseFloat(m.paramB),
                                    feeBps: m.feeBps,
                                    isEnabled: m.isEnabled,
                                  });
                                }}
                                className="px-2 py-0.5 rounded bg-white/5 text-muted-foreground text-xs hover:bg-white/10 transition-colors"
                              >
                                Edit
                              </button>
                            </td>
                          </>
                        )}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        <p className="text-xs text-muted-foreground text-center">
          Showing {filtered.length} of {markets.length} markets
        </p>
      </div>
    </AdminLayout>
  );
}
