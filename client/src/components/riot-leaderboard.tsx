import { useQuery } from "@tanstack/react-query";
import { formatNumber } from "@/lib/format";
import { Search, RefreshCw, Trophy, Wifi } from "lucide-react";
import { motion } from "framer-motion";

type RiotPlayer = {
  id: string;
  platform: string;
  queue: string;
  summonerId: string;
  summonerName: string;
  leaguePoints: number;
  wins: number;
  losses: number;
  winrate: string;
  tier: string;
  rank: string;
  lastSyncedAt: string;
};

type Props = {
  search: string;
  onSearchChange: (val: string) => void;
};

export function RiotLeaderboard({ search, onSearchChange }: Props) {
  const { data, isLoading, isError, error } = useQuery<{ data: RiotPlayer[]; total: number }>({
    queryKey: ["/api/riot/players", search],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search && search.length > 1) params.set("search", search);
      const res = await fetch(`/api/riot/players?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load: ${res.statusText}`);
      return res.json();
    },
    staleTime: 30000,
  });

  const players = data?.data ?? [];
  const total = data?.total ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4 glass-panel p-4 rounded-xl">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search summoner name..."
            value={search}
            onChange={e => onSearchChange(e.target.value)}
            data-testid="input-riot-search"
            className="w-full pl-9 pr-4 py-2.5 bg-background border border-white/10 rounded-lg text-sm text-white placeholder:text-muted-foreground focus:outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/30 transition-all font-mono"
          />
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Wifi className="w-4 h-4 text-violet-400" />
          <span data-testid="riot-player-count">
            {total > 0 ? `${total} Challenger players` : "No data — sync from Admin > Market Control"}
          </span>
        </div>
      </div>

      {total === 0 && !isLoading && !isError && (
        <div className="glass-panel rounded-xl p-12 text-center">
          <div className="w-14 h-14 rounded-2xl bg-violet-500/15 flex items-center justify-center mx-auto mb-4">
            <Wifi className="w-7 h-7 text-violet-400" />
          </div>
          <h3 className="text-lg font-display font-bold text-white mb-2">No Riot data yet</h3>
          <p className="text-muted-foreground text-sm max-w-xs mx-auto">
            Trigger a sync from the Admin dashboard under Market Control to populate the NA1 Challenger leaderboard.
          </p>
        </div>
      )}

      {isError && (
        <div className="glass-panel rounded-xl p-8 text-center text-destructive">
          Failed to load Riot data: {(error as Error).message}
        </div>
      )}

      {(total > 0 || isLoading) && (
        <div className="glass-panel rounded-xl overflow-hidden shadow-2xl border-white/5">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse whitespace-nowrap">
              <thead>
                <tr className="bg-secondary/40 border-b border-white/5 text-xs uppercase tracking-wider text-muted-foreground font-medium">
                  <th className="p-4">#</th>
                  <th className="p-4">Summoner</th>
                  <th className="p-4 text-right">LP</th>
                  <th className="p-4 text-right">Wins</th>
                  <th className="p-4 text-right">Losses</th>
                  <th className="p-4 text-right">Winrate</th>
                  <th className="p-4 text-center">Badge</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 font-mono text-sm">
                {isLoading ? (
                  Array.from({ length: 10 }).map((_, i) => (
                    <tr key={i} className="animate-pulse">
                      <td className="p-4"><div className="h-4 bg-white/5 rounded w-6"></div></td>
                      <td className="p-4"><div className="h-4 bg-white/5 rounded w-36"></div></td>
                      <td className="p-4"><div className="h-4 bg-white/5 rounded w-16 ml-auto"></div></td>
                      <td className="p-4"><div className="h-4 bg-white/5 rounded w-10 ml-auto"></div></td>
                      <td className="p-4"><div className="h-4 bg-white/5 rounded w-10 ml-auto"></div></td>
                      <td className="p-4"><div className="h-4 bg-white/5 rounded w-14 ml-auto"></div></td>
                      <td className="p-4"><div className="h-5 bg-white/5 rounded w-12 mx-auto"></div></td>
                    </tr>
                  ))
                ) : (
                  players.map((player, idx) => {
                    const winrateNum = parseFloat(player.winrate);
                    const isHighWr = winrateNum >= 55;
                    return (
                      <motion.tr
                        key={player.id}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: idx * 0.015, duration: 0.25 }}
                        className="hover:bg-white/[0.02] transition-colors"
                        data-testid={`row-riot-player-${player.id}`}
                      >
                        <td className="p-4 text-muted-foreground">
                          {idx === 0 ? <Trophy className="w-4 h-4 text-yellow-400" /> : <span className="text-xs">{idx + 1}</span>}
                        </td>
                        <td className="p-4 font-display font-semibold text-white">
                          {player.summonerName}
                        </td>
                        <td className="p-4 text-right text-violet-400 font-bold">
                          {player.leaguePoints.toLocaleString()} LP
                        </td>
                        <td className="p-4 text-right text-primary">
                          {player.wins}W
                        </td>
                        <td className="p-4 text-right text-destructive">
                          {player.losses}L
                        </td>
                        <td className={`p-4 text-right font-bold ${isHighWr ? "text-primary" : "text-muted-foreground"}`}>
                          {formatNumber(player.winrate)}%
                        </td>
                        <td className="p-4 text-center">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-violet-500/20 text-violet-300 border border-violet-500/30" data-testid={`badge-real-${player.id}`}>
                            REAL
                          </span>
                        </td>
                      </motion.tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {players.length > 0 && (
            <div className="p-3 border-t border-white/5 flex items-center justify-between bg-black/20 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-violet-400 animate-pulse" />
                Live data from Riot API
              </span>
              <span>
                Last synced: {players[0]?.lastSyncedAt
                  ? new Date(players[0].lastSyncedAt).toLocaleString()
                  : "Never"}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
