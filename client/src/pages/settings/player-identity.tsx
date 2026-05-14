import { motion } from "framer-motion";
import { Layout } from "@/components/layout";
import { useAuth } from "@/hooks/use-auth";
import { usePlayerClaims, usePlayerProfile, useActiveClaim } from "@/hooks/use-player-claim";
import { PlayerClaimCard } from "@/components/player-claim/PlayerClaimCard";
import { PlayerProfileControlCard } from "@/components/player-profile-control/PlayerProfileControlCard";
import { VerifiedPlayerBadge } from "@/components/player-profile-control/VerifiedPlayerBadge";
import { Link } from "wouter";
import { KeyRound, User, Gamepad2, Loader2, ShieldCheck, Layers } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLocation } from "wouter";

function SettingsNav() {
  const [location] = useLocation();
  const links = [
    { href: "/settings/security",        label: "Security",        icon: KeyRound },
    { href: "/settings/player-identity", label: "Player Identity", icon: Gamepad2 },
    { href: "/settings/my-assets",       label: "My Assets",       icon: Layers   },
  ];
  return (
    <nav className="flex gap-1 mb-8 border-b border-white/10 pb-1">
      {links.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          className={cn(
            "flex items-center gap-2 px-4 py-2.5 rounded-t-md text-sm font-medium transition-all",
            location === href
              ? "text-white border-b-2 border-primary -mb-px"
              : "text-white/50 hover:text-white/80 hover:bg-white/5",
          )}
        >
          <Icon className="w-4 h-4" />
          {label}
        </Link>
      ))}
    </nav>
  );
}

function PlayerIdentityContent() {
  const { user, hasCapability, isLoading: authLoading } = useAuth();
  const { data: claimsData, isLoading: claimsLoading } = usePlayerClaims();
  const { data: profileData, isLoading: profileLoading } = usePlayerProfile();

  const claims = claimsData?.claims ?? [];
  const activeClaim = useActiveClaim(claims);
  const profile = profileData?.profile ?? null;
  const hasPlayerControl = hasCapability("player_profile_control");

  const isLoading = authLoading || claimsLoading;

  return (
    <div className="max-w-3xl mx-auto py-8 px-4">
      <SettingsNav />

      {/* Page header */}
      <motion.div
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-8"
      >
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2.5">
              <Gamepad2 className="w-6 h-6 text-primary" />
              Player Identity
            </h1>
            <p className="text-white/50 text-sm mt-1 leading-relaxed">
              If you are a professional player listed on GamerStock, you can verify and control your public profile.
            </p>
          </div>
          {hasPlayerControl && activeClaim?.claimStatus === "approved" && (
            <VerifiedPlayerBadge size="md" />
          )}
        </div>
      </motion.div>

      {/* Loading state */}
      {isLoading && (
        <div className="flex items-center justify-center py-16 text-white/30 gap-3">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="text-sm">Loading identity status...</span>
        </div>
      )}

      {!isLoading && (
        <div className="space-y-6">
          {/* Claim status card — always visible */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <h2 className="text-sm font-semibold text-white/60 uppercase tracking-wider">Claim Status</h2>
              {activeClaim?.claimStatus === "approved" && (
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
              )}
            </div>
            <PlayerClaimCard
              claim={activeClaim}
              onEditProfile={hasPlayerControl ? () => {
                document.getElementById("profile-control-section")?.scrollIntoView({ behavior: "smooth" });
              } : undefined}
            />
          </section>

          {/* Profile control — only visible when approved */}
          {hasPlayerControl && activeClaim?.claimStatus === "approved" && (
            <section id="profile-control-section">
              <div className="flex items-center gap-2 mb-3">
                <h2 className="text-sm font-semibold text-white/60 uppercase tracking-wider">Profile Control</h2>
                <span className="text-xs text-emerald-400/70 font-medium px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                  Active
                </span>
              </div>
              <PlayerProfileControlCard
                claim={activeClaim}
                profile={profile}
              />
            </section>
          )}

          {/* Claims history — if more than 1 */}
          {claims.length > 1 && (
            <section>
              <h2 className="text-sm font-semibold text-white/60 uppercase tracking-wider mb-3">History</h2>
              <div className="space-y-2">
                {claims.slice(0).reverse().map((claim) => (
                  <div
                    key={claim.id}
                    className="flex items-center justify-between px-4 py-3 rounded-lg bg-secondary/20 border border-white/5 text-sm"
                  >
                    <span className="text-white/50 font-mono text-xs">{claim.assetUid}</span>
                    <div className="flex items-center gap-3">
                      <span className="text-white/30 text-xs">{new Date(claim.requestedAt).toLocaleDateString()}</span>
                      <span className={cn(
                        "text-xs px-2 py-0.5 rounded-full border font-medium",
                        claim.claimStatus === "approved" && "bg-emerald-500/10 border-emerald-500/20 text-emerald-300",
                        claim.claimStatus === "pending" && "bg-amber-500/10 border-amber-500/20 text-amber-300",
                        claim.claimStatus === "rejected" && "bg-rose-500/10 border-rose-500/20 text-rose-300",
                        claim.claimStatus === "revoked" && "bg-zinc-500/10 border-zinc-500/20 text-zinc-400",
                      )}>
                        {claim.claimStatus}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Informational footer */}
          <div className="pt-4 border-t border-white/5">
            <p className="text-xs text-white/25 leading-relaxed">
              The Player Claim System allows verified professional players to control their public identity on GamerStock.
              Market data, pricing, rankings, and performance metrics are always managed by the platform and cannot be edited.
              Claims are reviewed manually by the GamerStock team.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export default function PlayerIdentitySettingsPage() {
  return (
    <Layout>
      <PlayerIdentityContent />
    </Layout>
  );
}
