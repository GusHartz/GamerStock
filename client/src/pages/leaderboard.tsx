import { useState, useMemo } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { formatCurrency, formatNumber, formatVolume } from "@/lib/format";
import { Search, ChevronUp, ChevronDown, Trophy, Medal, Award } from "lucide-react";
import { motion } from "framer-motion";
import type { RiotAsset } from "@shared/schema";

type SortField = "leaguePoints" | "winrate" | "wins" | "losses" | "lastTradePrice" | "marketCap" | "volume24h";

export default function LeaderboardPage() {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortField>("leaguePoints");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 50;

  const { data, isLoading } = useQuery<{ data: RiotAsset[]; total: number }>({
    queryKey: ["/api/riot/leaderboard"],
    refetchInterval: 10000,
    staleTime: 0,
  });

  const filtered = useMemo(() => {
    if (!data?.data) return [];
    let rows = data.data;

    if (search.length > 1) {
      const q = search.toLowerCase();
      rows = rows.filter(
        (r) =>
          r.gameName.toLowerCase().includes(q) ||
          r.tagLine.toLowerCase().includes(q)
      );
    }

    rows = [...rows].sort((a, b) => {
      let av: number, bv: number;
      switch (sort) {
        case "leaguePoints":
          av = a.leaguePoints; bv = b.leaguePoints; break;
        case "winrate":
          av = parseFloat(a.winrate); bv = parseFloat(b.winrate); break;
        case "wins":
          av = a.wins; bv = b.wins; break;
        case "losses":
          av = a.losses; bv = b.losses; break;
        case "lastTradePrice":
          av = parseFloat(a.lastTradePrice); bv = parseFloat(b.lastTradePrice); break;
        case "marketCap":
          av = parseFloat(a.lastTradePrice) * 1000; bv = parseFloat(b.lastTradePrice) * 1000; break;
        case "volume24h":
          av = parseFloat(a.volume24h); bv = parseFloat(b.volume24h); break;
        default:
          av = 0; bv = 0;
      }
      return order === "desc" ? bv - av : av - bv;
    });

    return rows;
  }, [data, search, sort, order]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const handleSort = (field: SortField) => {
    if (sort === field) {
      setOrder(order === "asc" ? "desc" : "asc");
    } else {
      setSort(field);
      setOrder("desc");
    }
    setPage(1);
  };

  const handleSearch = (val: string) => {
    setSearch(val);
    setPage(1);
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sort !== field) return <span className="w-4 inline-block opacity-0"><ChevronDown className="w-4 h-4 inline" /></span>;
    return order === "asc" ? <ChevronUp className="w-4 h-4 inline" /> : <ChevronDown className="w-4 h-4 inline" />;
  };

  const getRankIcon = (globalRank: number) => {
    if (globalRank === 1) return <Trophy className="w-5 h-5 text-yellow-500" />;
    if (globalRank === 2) return <Medal className="w-5 h-5 text-slate-300" />;
    if (globalRank === 3) return <Award className="w-5 h-5 text-amber-600" />;
    return <span className="text-muted-foreground">#{globalRank}</span>;
  };

  return (
    <div className="flex flex-col gap-8 animate-in fade-in duration-500 pb-20">
      <div>
        <h1 className="text-4xl font-display font-bold text-white tracking-tight">NA1 Challenger Leaderboard</h1>
        <p className="text-muted-foreground mt-2 text-lg">Real Riot NA1 Challenger players ranked by League Points.</p>
      </div>

      <div className="glass-panel p-4 rounded-xl flex items-center gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            data-testid="input-search"
            type="text"
            placeholder="Search by summoner name or tag..."
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-background border border-white/10 rounded-lg text-sm text-white placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50 transition-all font-mono"
          />
        </div>
        {data && (
          <span className="text-sm text-muted-foreground font-sans whitespace-nowrap">
            <span className="text-white font-medium">{filtered.length}</span> players
          </span>
        )}
      </div>

      <div className="glass-panel rounded-2xl overflow-hidden shadow-2xl border-white/5">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse whitespace-nowrap">
            <thead>
              <tr className="bg-secondary/40 border-b border-white/5 text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                <th className="p-5 w-16 text-center">Rank</th>
                <th className="p-5">Player</th>
                <th
                  className="p-5 text-right cursor-pointer hover:text-white transition-colors select-none"
                  onClick={() => handleSort("leaguePoints")}
                >
                  LP <SortIcon field="leaguePoints" />
                </th>
                <th
                  className="p-5 text-right cursor-pointer hover:text-white transition-colors select-none"
                  onClick={() => handleSort("winrate")}
                >
                  Winrate <SortIcon field="winrate" />
                </th>
                <th
                  className="p-5 text-right cursor-pointer hover:text-white transition-colors select-none"
                  onClick={() => handleSort("wins")}
                >
                  W / L <SortIcon field="wins" />
                </th>
                <th
                  className="p-5 text-right cursor-pointer hover:text-white transition-colors select-none"
                  onClick={() => handleSort("lastTradePrice")}
                >
                  Price <SortIcon field="lastTradePrice" />
                </th>
                <th
                  className="p-5 text-right cursor-pointer hover:text-white transition-colors select-none"
                  onClick={() => handleSort("marketCap")}
                >
                  Market Cap <SortIcon field="marketCap" />
                </th>
                <th
                  className="p-5 text-right cursor-pointer hover:text-white transition-colors select-none"
                  onClick={() => handleSort("volume24h")}
                >
                  24h Vol <SortIcon field="volume24h" />
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 font-mono text-sm">
              {isLoading ? (
                Array.from({ length: 10 }).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    <td className="p-5"><div className="h-4 bg-white/5 rounded w-8 mx-auto"></div></td>
                    <td className="p-5"><div className="h-4 bg-white/5 rounded w-40"></div></td>
                    <td className="p-5"><div className="h-4 bg-white/5 rounded w-16 ml-auto"></div></td>
                    <td className="p-5"><div className="h-4 bg-white/5 rounded w-12 ml-auto"></div></td>
                    <td className="p-5"><div className="h-4 bg-white/5 rounded w-20 ml-auto"></div></td>
                    <td className="p-5"><div className="h-4 bg-white/5 rounded w-16 ml-auto"></div></td>
                    <td className="p-5"><div className="h-4 bg-white/5 rounded w-20 ml-auto"></div></td>
                    <td className="p-5"><div className="h-4 bg-white/5 rounded w-16 ml-auto"></div></td>
                  </tr>
                ))
              ) : paged.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-12 text-center text-muted-foreground font-sans">
                    {search ? "No players match your search." : "No Challenger players loaded yet. Sync from the Admin panel."}
                  </td>
                </tr>
              ) : (
                paged.map((player, idx) => {
                  const globalRank = (page - 1) * PAGE_SIZE + idx + 1;
                  const isTop3 = page === 1 && idx < 3 && !search;
                  const winrateVal = parseFloat(player.winrate);
                  const marketCap = parseFloat(player.lastTradePrice) * 1000;
                  const displayName = `${player.gameName}#${player.tagLine}`;

                  return (
                    <motion.tr
                      key={player.puuid}
                      data-testid={`row-player-${idx}`}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: idx * 0.008 }}
                      className={`hover:bg-white/[0.03] transition-colors cursor-pointer group ${isTop3 ? "bg-primary/5" : ""}`}
                    >
                      <td className="p-5 text-center">
                        <div className="flex justify-center">
                          {getRankIcon(globalRank)}
                        </div>
                      </td>
                      <td className="p-5">
                        <Link
                          href={`/player/${player.puuid}`}
                          data-testid={`link-player-${idx}`}
                          className="font-display font-bold text-white hover:text-primary transition-colors flex items-center gap-2"
                        >
                          <span className="inline-flex items-center gap-1.5">
                            <span>{player.gameName}</span>
                            <span className="text-xs text-muted-foreground font-normal">#{player.tagLine}</span>
                          </span>
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-sans font-semibold bg-violet-500/15 text-violet-400 border border-violet-500/20 ml-1">
                            NA1
                          </span>
                        </Link>
                      </td>
                      <td className="p-5 text-right font-bold text-white">
                        {formatNumber(player.leaguePoints)} LP
                      </td>
                      <td className={`p-5 text-right font-semibold ${winrateVal >= 55 ? "text-green-400" : winrateVal <= 45 ? "text-red-400" : "text-muted-foreground"}`}>
                        {formatNumber(winrateVal)}%
                      </td>
                      <td className="p-5 text-right text-muted-foreground">
                        <span className="text-green-400">{player.wins}W</span>
                        <span className="mx-1 opacity-40">/</span>
                        <span className="text-red-400">{player.losses}L</span>
                      </td>
                      <td className="p-5 text-right font-bold text-white">
                        {formatCurrency(parseFloat(player.lastTradePrice))}
                      </td>
                      <td className="p-5 text-right text-primary font-bold">
                        {formatCurrency(marketCap)}
                      </td>
                      <td className="p-5 text-right text-muted-foreground">
                        {formatVolume(parseFloat(player.volume24h))}
                      </td>
                    </motion.tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="p-6 border-t border-white/5 flex items-center justify-between bg-black/20">
            <span className="text-sm text-muted-foreground font-sans">
              Page <span className="text-white font-medium">{page}</span> of <span className="text-white font-medium">{totalPages}</span>
              {" "}· <span className="text-white font-medium">{filtered.length}</span> total
            </span>
            <div className="flex gap-2">
              <button
                data-testid="button-prev-page"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-4 py-2 rounded bg-secondary text-sm font-medium hover:bg-secondary/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Previous
              </button>
              <button
                data-testid="button-next-page"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-4 py-2 rounded bg-secondary text-sm font-medium hover:bg-secondary/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
