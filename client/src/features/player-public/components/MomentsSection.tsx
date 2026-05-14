// ─── MomentsSection ───────────────────────────────────────────────────────────
// Renders collectible moments for a player asset.
// Each card is a self-contained economic unit — price, rarity, supply visible.
// ─────────────────────────────────────────────────────────────────────────────
import { Gem, Zap, ShoppingCart, Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface PublicMoment {
  id:          string;
  title:       string;
  description: string | null;
  imageUrl:    string | null;
  rarity:      string | null;
  price:       number | null;
  supply:      number | null;
  sold:        number | null;
  soldPct:     number | null;
  status:      "live" | "sold_out" | "upcoming";
}

// ── Rarity config ─────────────────────────────────────────────────────────────

const RARITY_CONFIG: Record<string, { label: string; cls: string; barCls: string; hue: string }> = {
  legendary: {
    label:  "Legendary",
    cls:    "bg-amber-500/20 text-amber-300 border-amber-500/30",
    barCls: "from-amber-500 to-yellow-400",
    hue:    "40",
  },
  epic: {
    label:  "Epic",
    cls:    "bg-purple-500/20 text-purple-300 border-purple-500/30",
    barCls: "from-purple-500 to-indigo-400",
    hue:    "270",
  },
  rare: {
    label:  "Rare",
    cls:    "bg-blue-500/20 text-blue-300 border-blue-500/30",
    barCls: "from-blue-500 to-cyan-400",
    hue:    "210",
  },
  common: {
    label:  "Common",
    cls:    "bg-white/10 text-white/50 border-white/15",
    barCls: "from-white/30 to-white/20",
    hue:    "0",
  },
};

function getRarity(key: string | null) {
  return RARITY_CONFIG[key ?? "common"] ?? RARITY_CONFIG.common;
}

// ── Moment placeholder visual ─────────────────────────────────────────────────

function MomentPlaceholder({
  title,
  rarity,
}: {
  title: string;
  rarity: string | null;
}) {
  const cfg = getRarity(rarity);
  const hue = cfg.hue;
  return (
    <div
      className="w-full h-full flex items-center justify-center"
      style={{
        background: `radial-gradient(circle at 50% 40%, hsl(${hue},50%,20%), hsl(${hue},30%,8%) 80%)`,
      }}
    >
      <Gem
        className="w-8 h-8 opacity-30"
        style={{ color: `hsl(${hue},70%,60%)` }}
        aria-hidden
      />
    </div>
  );
}

// ── MomentCard ────────────────────────────────────────────────────────────────

interface MomentCardProps {
  moment: PublicMoment;
}

export function MomentCard({ moment }: MomentCardProps) {
  const rarity = getRarity(moment.rarity);
  const isSoldOut  = moment.status === "sold_out";
  const isUpcoming = moment.status === "upcoming";
  const remaining  = moment.supply !== null && moment.sold !== null
    ? moment.supply - moment.sold
    : null;
  const soldPct = Math.min(100, Math.max(0, moment.soldPct ?? 0));

  return (
    <article
      className={cn(
        "flex-shrink-0 w-52 rounded-2xl border overflow-hidden flex flex-col",
        isSoldOut
          ? "border-white/10 opacity-60"
          : "border-white/15 bg-white/[0.04] hover:border-white/25 transition-colors",
      )}
      data-testid={`moment-card-${moment.id}`}
    >
      {/* Visual */}
      <div className="relative h-36 bg-black/30 flex-shrink-0">
        {moment.imageUrl ? (
          <img
            src={moment.imageUrl}
            alt={moment.title}
            className="w-full h-full object-cover"
          />
        ) : (
          <MomentPlaceholder title={moment.title} rarity={moment.rarity} />
        )}
        {/* Status overlay */}
        {isSoldOut && (
          <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
            <span className="text-white/70 font-bold tracking-widest text-xs uppercase">Sold Out</span>
          </div>
        )}
        {/* Rarity badge */}
        <div className="absolute top-2 left-2">
          <Badge className={cn("border text-[10px] px-1.5 py-0.5", rarity.cls)}>
            {rarity.label}
          </Badge>
        </div>
      </div>

      {/* Body */}
      <div className="p-3 flex flex-col gap-2.5 flex-1">
        <p
          className="text-sm font-semibold text-white leading-tight line-clamp-2"
          data-testid={`moment-title-${moment.id}`}
        >
          {moment.title}
        </p>

        {/* Price + supply */}
        <div className="flex items-center justify-between text-xs">
          {moment.price !== null && moment.price > 0 ? (
            <span className="text-white font-bold" data-testid={`moment-price-${moment.id}`}>
              {moment.price.toFixed(2)} GS
            </span>
          ) : (
            <span className="text-white/30">—</span>
          )}
          {remaining !== null && (
            <span className={cn("text-white/40", remaining <= 5 && !isSoldOut && "text-red-400 font-medium")}>
              {remaining} left
            </span>
          )}
        </div>

        {/* Scarcity bar */}
        {moment.supply !== null && moment.supply > 0 && (
          <div className="space-y-1">
            <div className="h-1 bg-white/10 rounded-full overflow-hidden">
              <div
                className={cn("h-full rounded-full bg-gradient-to-r", rarity.barCls)}
                style={{ width: `${soldPct}%` }}
              />
            </div>
            <p className="text-[10px] text-white/30">
              {moment.sold ?? 0}/{moment.supply} sold
            </p>
          </div>
        )}

        {/* CTA */}
        <Button
          size="sm"
          disabled
          className={cn(
            "w-full text-xs h-8 gap-1.5 mt-auto",
            isSoldOut
              ? "bg-white/5 text-white/30 border border-white/10"
              : isUpcoming
              ? "bg-white/5 text-white/30 border border-white/10"
              : "bg-blue-600/80 hover:bg-blue-600 text-white disabled:opacity-60",
          )}
          data-testid={`moment-cta-${moment.id}`}
        >
          {isSoldOut ? (
            <><Lock className="w-3 h-3" /> Sold Out</>
          ) : isUpcoming ? (
            <><Zap className="w-3 h-3" /> Coming Soon</>
          ) : (
            <><ShoppingCart className="w-3 h-3" /> Buy Moment</>
          )}
        </Button>
      </div>
    </article>
  );
}

// ── MomentsSection ────────────────────────────────────────────────────────────

interface MomentsSectionProps {
  moments: PublicMoment[];
}

export function MomentsSection({ moments }: MomentsSectionProps) {
  if (moments.length === 0) {
    return (
      <div
        className="border border-dashed border-white/10 rounded-2xl px-6 py-6 flex items-center gap-3"
        data-testid="public-moments-empty"
      >
        <Gem className="w-5 h-5 text-white/15 flex-shrink-0" />
        <p className="text-sm text-white/20">No Moments available yet.</p>
      </div>
    );
  }

  return (
    <section className="space-y-4" data-testid="public-moments">
      <h2 className="text-xs font-semibold text-white/50 uppercase tracking-wider px-0.5">
        Moments <span className="text-white/25 font-normal">· {moments.length}</span>
      </h2>
      <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/10">
        {moments.map((m) => (
          <MomentCard key={m.id} moment={m} />
        ))}
      </div>
    </section>
  );
}
