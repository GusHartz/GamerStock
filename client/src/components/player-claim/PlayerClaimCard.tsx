import { useState } from "react";
import { motion } from "framer-motion";
import {
  UserCheck, Shield, Clock, XCircle, ShieldCheck, ChevronRight,
  Gamepad2, RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PlayerClaimStatusBadge } from "./PlayerClaimStatusBadge";
import { ClaimPlayerDialog } from "./ClaimPlayerDialog";
import type { PlayerClaim } from "@/hooks/use-player-claim";
import { cn } from "@/lib/utils";

interface Props {
  claim: PlayerClaim | null;
  onEditProfile?: () => void;
}

export function PlayerClaimCard({ claim, onEditProfile }: Props) {
  const [claimDialogOpen, setClaimDialogOpen] = useState(false);

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        {!claim && <NoClaimState onOpenDialog={() => setClaimDialogOpen(true)} />}
        {claim?.claimStatus === "pending" && <PendingState claim={claim} />}
        {claim?.claimStatus === "rejected" && (
          <RejectedState claim={claim} onRetry={() => setClaimDialogOpen(true)} />
        )}
        {claim?.claimStatus === "revoked" && (
          <RevokedState claim={claim} onRetry={() => setClaimDialogOpen(true)} />
        )}
        {claim?.claimStatus === "approved" && (
          <ApprovedState claim={claim} onEditProfile={onEditProfile} />
        )}
      </motion.div>

      <ClaimPlayerDialog open={claimDialogOpen} onOpenChange={setClaimDialogOpen} />
    </>
  );
}

function NoClaimState({ onOpenDialog }: { onOpenDialog: () => void }) {
  return (
    <Card className="bg-secondary/30 border-white/10 overflow-hidden">
      <CardContent className="p-0">
        <div className="relative">
          {/* Glow accent bar */}
          <div className="h-px w-full bg-gradient-to-r from-transparent via-primary/40 to-transparent" />

          <div className="p-6 sm:p-8">
            <div className="flex flex-col sm:flex-row sm:items-center gap-6">
              {/* Icon */}
              <div className="shrink-0 w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center shadow-[0_0_20px_rgba(var(--primary-rgb),0.15)]">
                <Gamepad2 className="w-7 h-7 text-primary" />
              </div>

              <div className="flex-1 min-w-0">
                <h3 className="text-lg font-bold text-white mb-1">Claim Your Player Profile</h3>
                <p className="text-sm text-white/50 leading-relaxed">
                  If you are already listed on GamerStock as a competitive player, you can request
                  control of your public player profile — bio, headline, social links, and more.
                </p>
              </div>

              <Button
                onClick={onOpenDialog}
                className="shrink-0 bg-primary hover:bg-primary/90 text-black font-semibold gap-2 shadow-[0_0_20px_rgba(var(--primary-rgb),0.2)] hover:shadow-[0_0_28px_rgba(var(--primary-rgb),0.35)] transition-all"
              >
                <UserCheck className="w-4 h-4" />
                Claim Player Profile
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>

            <div className="mt-6 pt-5 border-t border-white/5 grid grid-cols-1 sm:grid-cols-3 gap-4">
              {[
                { icon: Shield, title: "Identity Verified", desc: "Admin reviews your claim for authenticity" },
                { icon: UserCheck, title: "Profile Control", desc: "Edit your bio, headline, and social links" },
                { icon: ShieldCheck, title: "Market Protected", desc: "Pricing and rankings stay system-managed" },
              ].map(({ icon: Icon, title, desc }) => (
                <div key={title} className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-white/5 border border-white/5 flex items-center justify-center shrink-0 mt-0.5">
                    <Icon className="w-4 h-4 text-white/40" />
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-white/70">{title}</div>
                    <div className="text-xs text-white/35 mt-0.5 leading-relaxed">{desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function PendingState({ claim }: { claim: PlayerClaim }) {
  return (
    <Card className="bg-secondary/30 border-amber-500/20 overflow-hidden">
      <CardContent className="p-0">
        <div className="h-px w-full bg-gradient-to-r from-transparent via-amber-500/40 to-transparent" />
        <div className="p-6 sm:p-8">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0">
              <Clock className="w-5 h-5 text-amber-400 animate-pulse" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-3 flex-wrap mb-2">
                <h3 className="text-base font-bold text-white">Claim Under Review</h3>
                <PlayerClaimStatusBadge status="pending" size="sm" />
              </div>
              <p className="text-sm text-white/50 leading-relaxed">
                Your claim request has been received and is being reviewed by the GamerStock team.
                This typically takes 1–3 business days.
              </p>
              <div className="mt-4 p-3 rounded-lg bg-black/30 border border-white/5">
                <div className="text-xs text-white/30 uppercase tracking-wider mb-1">Asset requested</div>
                <div className="text-sm text-white/70 font-mono">{claim.assetUid}</div>
              </div>
              <div className="mt-3 text-xs text-white/30">
                Submitted {new Date(claim.requestedAt).toLocaleDateString()}
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function RejectedState({ claim, onRetry }: { claim: PlayerClaim; onRetry: () => void }) {
  return (
    <Card className="bg-secondary/30 border-rose-500/20 overflow-hidden">
      <CardContent className="p-0">
        <div className="h-px w-full bg-gradient-to-r from-transparent via-rose-500/40 to-transparent" />
        <div className="p-6 sm:p-8">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center shrink-0">
              <XCircle className="w-5 h-5 text-rose-400" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-3 flex-wrap mb-2">
                <h3 className="text-base font-bold text-white">Claim Not Approved</h3>
                <PlayerClaimStatusBadge status="rejected" size="sm" />
              </div>
              <p className="text-sm text-white/50 leading-relaxed mb-4">
                Your claim request was reviewed but could not be verified at this time.
              </p>
              {claim.rejectionReason && (
                <div className="p-3 rounded-lg bg-rose-500/5 border border-rose-500/15 mb-4">
                  <div className="text-xs text-rose-400/70 uppercase tracking-wider mb-1">Reason</div>
                  <div className="text-sm text-rose-200/70">{claim.rejectionReason}</div>
                </div>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={onRetry}
                className="border-white/10 text-white/70 hover:text-white hover:border-white/20 gap-2"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Try Again
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function RevokedState({ claim, onRetry }: { claim: PlayerClaim; onRetry: () => void }) {
  return (
    <Card className="bg-secondary/30 border-zinc-500/20 overflow-hidden">
      <CardContent className="p-0">
        <div className="h-px w-full bg-gradient-to-r from-transparent via-zinc-500/30 to-transparent" />
        <div className="p-6 sm:p-8">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-zinc-500/10 border border-zinc-500/20 flex items-center justify-center shrink-0">
              <Shield className="w-5 h-5 text-zinc-500" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-3 flex-wrap mb-2">
                <h3 className="text-base font-bold text-white">Claim Revoked</h3>
                <PlayerClaimStatusBadge status="revoked" size="sm" />
              </div>
              <p className="text-sm text-white/50 leading-relaxed mb-4">
                Your player profile claim was revoked. You may submit a new claim if you believe this was in error.
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={onRetry}
                className="border-white/10 text-white/70 hover:text-white hover:border-white/20 gap-2"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Submit New Claim
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ApprovedState({ claim, onEditProfile }: { claim: PlayerClaim; onEditProfile?: () => void }) {
  return (
    <Card className="bg-secondary/30 border-emerald-500/20 overflow-hidden">
      <CardContent className="p-0">
        <div className="h-px w-full bg-gradient-to-r from-transparent via-emerald-500/40 to-transparent" />
        <div className="p-6 sm:p-8">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0 shadow-[0_0_16px_rgba(16,185,129,0.2)]">
              <ShieldCheck className="w-5 h-5 text-emerald-400" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-3 flex-wrap mb-2">
                <h3 className="text-base font-bold text-white">Claim Approved</h3>
                <PlayerClaimStatusBadge status="approved" size="sm" />
              </div>
              <p className="text-sm text-white/50 leading-relaxed mb-4">
                You have verified ownership of this player profile. You can now control your public identity on GamerStock.
              </p>
              <div className="p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/15 mb-4">
                <div className="text-xs text-emerald-400/60 uppercase tracking-wider mb-1">Linked player</div>
                <div className="text-sm text-emerald-200/80 font-mono">{claim.assetUid}</div>
              </div>
              {onEditProfile && (
                <Button
                  onClick={onEditProfile}
                  className={cn(
                    "bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300",
                    "border border-emerald-500/30 hover:border-emerald-500/50",
                    "shadow-[0_0_12px_rgba(16,185,129,0.1)] hover:shadow-[0_0_20px_rgba(16,185,129,0.2)]",
                    "transition-all gap-2"
                  )}
                >
                  <UserCheck className="w-4 h-4" />
                  Edit Player Profile
                  <ChevronRight className="w-4 h-4" />
                </Button>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
