import { useState } from "react";
import { motion } from "framer-motion";
import {
  Globe, Lock, User, ExternalLink, Pencil, ImageOff, BarChart2, TrendingUp, Shield,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { VerifiedPlayerBadge } from "./VerifiedPlayerBadge";
import { EditPlayerProfileDialog } from "./EditPlayerProfileDialog";
import type { PlayerPublicProfile, PlayerClaim } from "@/hooks/use-player-claim";

interface Props {
  claim: PlayerClaim;
  profile: PlayerPublicProfile | null;
}

export function PlayerProfileControlCard({ claim, profile }: Props) {
  const [editOpen, setEditOpen] = useState(false);

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.1 }}
        className="space-y-4"
      >
        {/* Header: verified identity banner */}
        <Card className="bg-emerald-950/30 border-emerald-500/20 overflow-hidden">
          <CardContent className="p-0">
            <div className="h-px w-full bg-gradient-to-r from-transparent via-emerald-500/40 to-transparent" />
            <div className="p-5 flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shadow-[0_0_12px_rgba(16,185,129,0.15)]">
                  <Shield className="w-4.5 h-4.5 text-emerald-400" />
                </div>
                <div>
                  <VerifiedPlayerBadge size="sm" />
                  <div className="text-xs text-white/40 mt-0.5 font-mono">{claim.assetUid}</div>
                </div>
              </div>
              <Button
                onClick={() => setEditOpen(true)}
                size="sm"
                className="bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 hover:border-emerald-500/50 shadow-[0_0_10px_rgba(16,185,129,0.1)] hover:shadow-[0_0_16px_rgba(16,185,129,0.2)] transition-all gap-2"
              >
                <Pencil className="w-3.5 h-3.5" />
                Edit Profile
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Two-column layout: what you control vs what the platform controls */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

          {/* YOUR DATA */}
          <Card className="bg-secondary/30 border-white/10">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-white flex items-center gap-2">
                <Globe className="w-4 h-4 text-primary" />
                Your Public Profile
                <span className="ml-auto text-xs text-primary/70 font-normal">Editable</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Profile Image */}
              {profile?.profileImageUrl ? (
                <div className="flex items-center gap-3">
                  <img
                    src={profile.profileImageUrl}
                    alt="Profile"
                    className="w-12 h-12 rounded-xl object-cover border border-white/10"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                  <div>
                    <div className="text-xs text-white/40 uppercase tracking-wider">Profile photo</div>
                    <div className="text-sm text-white/70 truncate max-w-[180px]">Set</div>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3 opacity-40">
                  <div className="w-12 h-12 rounded-xl border border-dashed border-white/20 flex items-center justify-center">
                    <ImageOff className="w-5 h-5 text-white/30" />
                  </div>
                  <span className="text-sm text-white/40">No profile photo</span>
                </div>
              )}

              <FieldDisplay
                label="Headline"
                value={profile?.headline}
                placeholder="Not set"
              />
              <FieldDisplay
                label="Bio"
                value={profile?.bio}
                placeholder="Not set"
                multiline
              />
              <FieldDisplay
                label="Team"
                value={profile?.teamAffiliation}
                placeholder="Not set"
              />

              {/* Social links */}
              {profile?.socialLinks && profile.socialLinks.length > 0 ? (
                <div>
                  <div className="text-xs text-white/40 uppercase tracking-wider mb-2">Social Links</div>
                  <div className="space-y-1.5">
                    {profile.socialLinks.map((link, i) => (
                      <a
                        key={i}
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 text-sm text-primary/80 hover:text-primary group"
                      >
                        <ExternalLink className="w-3 h-3" />
                        <span>{link.platform}</span>
                        <span className="text-white/30 group-hover:text-white/50 text-xs truncate max-w-[160px]">{link.url}</span>
                      </a>
                    ))}
                  </div>
                </div>
              ) : (
                <FieldDisplay label="Social links" value={null} placeholder="None added" />
              )}

              <Button
                onClick={() => setEditOpen(true)}
                variant="outline"
                size="sm"
                className="w-full border-white/10 text-white/60 hover:text-white hover:border-white/20 gap-2 mt-2"
              >
                <Pencil className="w-3.5 h-3.5" />
                Edit Public Profile
              </Button>
            </CardContent>
          </Card>

          {/* PLATFORM DATA (read-only) */}
          <Card className="bg-secondary/20 border-white/5 opacity-80">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-white/50 flex items-center gap-2">
                <Lock className="w-4 h-4 text-white/30" />
                Market Data
                <span className="ml-auto text-xs text-white/25 font-normal">Platform-managed</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="p-3 rounded-lg bg-black/20 border border-white/5">
                <p className="text-xs text-white/30 leading-relaxed">
                  The following data is computed and managed by the GamerStock platform. It reflects real market activity and cannot be edited by any user — including you.
                </p>
              </div>
              {[
                { icon: TrendingUp, label: "Market Price", desc: "Set by AMM + trading activity" },
                { icon: BarChart2, label: "Fair Value / PVI", desc: "Computed by valuation engine" },
                { icon: User, label: "Performance Score", desc: "Derived from match data" },
                { icon: Shield, label: "Discovery Ranking", desc: "Algorithmic signal output" },
              ].map(({ icon: Icon, label, desc }) => (
                <div key={label} className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-white/5 border border-white/5 flex items-center justify-center shrink-0">
                    <Icon className="w-4 h-4 text-white/20" />
                  </div>
                  <div>
                    <div className="text-sm text-white/40 font-medium">{label}</div>
                    <div className="text-xs text-white/20">{desc}</div>
                  </div>
                  <Lock className="w-3 h-3 text-white/15 ml-auto shrink-0" />
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </motion.div>

      <EditPlayerProfileDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        claimId={claim.id}
        profile={profile}
      />
    </>
  );
}

function FieldDisplay({
  label,
  value,
  placeholder,
  multiline = false,
}: {
  label: string;
  value: string | null | undefined;
  placeholder: string;
  multiline?: boolean;
}) {
  return (
    <div>
      <div className="text-xs text-white/40 uppercase tracking-wider mb-1">{label}</div>
      {value ? (
        <div className={`text-sm text-white/80 ${multiline ? "line-clamp-3 leading-relaxed" : "truncate"}`}>
          {value}
        </div>
      ) : (
        <div className="text-sm text-white/25 italic">{placeholder}</div>
      )}
    </div>
  );
}
