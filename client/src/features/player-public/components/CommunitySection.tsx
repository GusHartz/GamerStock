// ─── CommunitySection ─────────────────────────────────────────────────────────
// Refined community block — social proof, belonging, not analytics.
// ─────────────────────────────────────────────────────────────────────────────
import { Users, Sparkles } from "lucide-react";

interface PublicCommunity {
  totalHolders: number;
  message:      string;
}

interface CommunitySectionProps {
  community:   PublicCommunity;
  playerName:  string;
}

export function CommunitySection({ community, playerName }: CommunitySectionProps) {
  const { totalHolders, message } = community;

  return (
    <section
      className="bg-white/5 border border-white/10 rounded-2xl p-6"
      data-testid="public-community"
    >
      <div className="flex items-start gap-4">
        {/* Icon cluster */}
        <div className="relative flex-shrink-0">
          <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
            <Users className="w-5 h-5 text-blue-400" />
          </div>
          {totalHolders > 0 && (
            <div className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center">
              <Sparkles className="w-2.5 h-2.5 text-white" />
            </div>
          )}
        </div>

        {/* Text */}
        <div className="flex-1">
          <p
            className="text-base font-medium text-white/80 leading-snug"
            data-testid="community-message"
          >
            {message}
          </p>

          {totalHolders > 0 && (
            <p className="text-xs text-white/35 mt-1.5">
              {totalHolders.toLocaleString()} holder{totalHolders !== 1 ? "s" : ""} on GamerStock
              {" · "}
              <span className="text-white/25">backing {playerName}</span>
            </p>
          )}
        </div>

        {/* Holder count pill — large for visual impact */}
        {totalHolders > 0 && (
          <div className="flex-shrink-0 text-right">
            <p
              className="text-2xl font-bold text-white tabular-nums"
              data-testid="community-holder-count"
            >
              {totalHolders.toLocaleString()}
            </p>
            <p className="text-[10px] text-white/30 uppercase tracking-wider">holders</p>
          </div>
        )}
      </div>
    </section>
  );
}
