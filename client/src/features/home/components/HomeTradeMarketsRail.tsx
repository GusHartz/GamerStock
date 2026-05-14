import { Link } from "wouter";
import { BarChart2, ArrowRight, TrendingUp, TrendingDown } from "lucide-react";
import { useTradeMarkets } from "../hooks/useTradeMarkets";
import type { TradeMarketAssetVM } from "../types/home";

const AVATAR_COUNT = 6;
function getAvatarUrl(id: number): string {
  const idx = (Math.abs(id) % AVATAR_COUNT) + 1;
  return `/player-avatars/avatar${idx}.png`;
}

function formatVolume(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000)     return `${(v / 1_000).toFixed(0)}K`;
  return v.toFixed(0);
}

const TRADE_LIMIT = 6;

interface TradePlayerCardProps {
  asset: TradeMarketAssetVM;
}

function TradePlayerCard({ asset }: TradePlayerCardProps) {
  const isPositive  = (asset.change24hPct ?? 0) >= 0;
  const changeStr   = asset.change24hPct != null
    ? `${isPositive ? "+" : ""}${asset.change24hPct.toFixed(2)}%`
    : "—";
  const changeClass = isPositive
    ? "text-emerald-400 bg-emerald-950/70 border-emerald-800/50"
    : "text-rose-400 bg-rose-950/70 border-rose-800/50";
  const abbrev    = asset.displayName.slice(0, 4).toUpperCase();
  const imageUrl  = (asset as any).imageUrl ?? getAvatarUrl(asset.id);

  return (
    <Link
      href={`/assets?uid=${encodeURIComponent(asset.assetUid)}`}
      data-testid={`trade-player-card-${asset.id}`}
      className="block w-full"
    >
      <div
        className="group relative w-full rounded-xl overflow-hidden border border-white/[0.06] hover:border-violet-700/40 transition-all duration-200 cursor-pointer"
        style={{
          height: "260px",
          background: "linear-gradient(160deg, #04080F 0%, #060B16 55%, #040710 100%)",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04), 0 4px 20px -6px rgba(0,0,0,0.9)",
        }}
      >
        {/* Background player image */}
        {imageUrl && (
          <img
            src={imageUrl}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 w-full h-full object-cover object-top pointer-events-none"
            style={{ filter: "saturate(0.8) brightness(0.65)" }}
          />
        )}

        {/* Atmospheric glow — top */}
        <div
          className="absolute -top-6 left-1/2 -translate-x-1/2 w-20 h-20 rounded-full blur-[30px] opacity-50 pointer-events-none"
          style={{ background: isPositive ? "rgba(139,92,246,0.22)" : "rgba(244,63,94,0.18)" }}
        />

        {/* Large faded abbrev — shown only when no image */}
        {!imageUrl && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none overflow-hidden">
            <span
              className="font-black text-white/[0.035] leading-none font-display select-none"
              style={{ fontSize: "84px", letterSpacing: "-0.04em", marginTop: "-8px" }}
            >
              {abbrev}
            </span>
          </div>
        )}

        {/* Scanline */}
        <div
          className="absolute inset-0 opacity-[0.02] pointer-events-none"
          style={{ backgroundImage: "repeating-linear-gradient(0deg,transparent,transparent 3px,rgba(255,255,255,1) 3px,rgba(255,255,255,1) 4px)", backgroundSize: "100% 5px" }}
        />

        {/* Dark overlay — bottom */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/96 via-black/40 to-transparent pointer-events-none" />

        {/* Change badge — top right */}
        <div className="absolute top-2.5 right-2.5 z-10">
          <span
            data-testid={`text-trade-change-${asset.id}`}
            className={`inline-flex items-center gap-0.5 text-[10px] font-mono font-bold px-1.5 py-[3px] rounded border ${changeClass}`}
          >
            {isPositive ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
            {changeStr}
          </span>
        </div>

        {/* Dota 2 badge — top left */}
        <div className="absolute top-2.5 left-2.5 z-10">
          <span
            className="text-[9px] font-mono font-bold px-1 py-[2px] rounded"
            style={{ color: "#BF3B3A", background: "#BF3B3A18" }}
          >
            Dota 2
          </span>
        </div>

        {/* Player info — bottom */}
        <div className="absolute bottom-0 inset-x-0 z-10 px-3 pb-3">
          <p
            data-testid={`text-trade-name-${asset.id}`}
            className="text-[14px] font-black text-white leading-none font-display tracking-tight group-hover:text-violet-100 transition-colors truncate"
          >
            {asset.displayName}
          </p>
          <p
            data-testid={`text-trade-price-${asset.id}`}
            className="text-[13px] font-mono font-semibold text-white/75 mt-0.5"
          >
            ${asset.price.toFixed(2)}
          </p>
          {asset.volume24h > 0 && (
            <p className="text-[10px] font-mono text-zinc-600 mt-0.5">
              Vol {formatVolume(asset.volume24h)}
            </p>
          )}
        </div>
      </div>
    </Link>
  );
}

function SkeletonCard() {
  return (
    <div
      className="w-full rounded-xl border border-white/[0.04] animate-pulse"
      style={{ height: "260px", background: "linear-gradient(160deg, #060A14 0%, #050910 100%)" }}
    />
  );
}

export function HomeTradeMarketsRail() {
  const { data: assets, isLoading } = useTradeMarkets(TRADE_LIMIT);

  if (!isLoading && (!assets || assets.length === 0)) return null;

  const visible = assets ? assets.slice(0, TRADE_LIMIT) : [];

  return (
    <section data-testid="home-trade-markets-rail">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <BarChart2 className="w-3.5 h-3.5 text-violet-400" />
          <span className="text-[11px] font-bold uppercase tracking-widest text-white/80">Trade Markets</span>
        </div>
        <Link
          href="/assets"
          className="flex items-center gap-1 text-[11px] font-medium text-zinc-500 hover:text-violet-400 transition-colors"
        >
          View all players
          <ArrowRight className="w-3 h-3" />
        </Link>
      </div>

      {/* Fixed grid — max 6 cards on desktop, no horizontal overflow */}
      <div
        data-testid="trade-markets-grid"
        className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3"
      >
        {isLoading
          ? Array.from({ length: TRADE_LIMIT }, (_, i) => <SkeletonCard key={i} />)
          : visible.map(a => <TradePlayerCard key={a.id} asset={a} />)
        }
      </div>
    </section>
  );
}
