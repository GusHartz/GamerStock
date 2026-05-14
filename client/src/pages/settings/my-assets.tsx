import { SettingsLayout } from "./settings-layout";
import { useAuth } from "@/hooks/use-auth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  Layers,
  Shield,
  Star,
  ClipboardList,
  SendHorizonal,
  CheckCircle2,
  XCircle,
  Clock,
  AlertCircle,
  Loader2,
  RefreshCw,
  TrendingUp,
  CircleDot,
  Package,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// ── Badge helpers ─────────────────────────────────────────────────────────────

function VerificationBadge({ status }: { status?: string | null }) {
  if (!status) return <Badge variant="outline" className="text-white/40 border-white/20">N/A</Badge>;
  const map: Record<string, { label: string; cls: string }> = {
    VERIFIED:      { label: "Verified",      cls: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30" },
    PENDING:       { label: "Pending",       cls: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30" },
    NOT_VERIFIED:  { label: "Unverified",    cls: "bg-white/10 text-white/50 border-white/20" },
    FAILED:        { label: "Failed",        cls: "bg-red-500/20 text-red-400 border-red-500/30" },
  };
  const s = map[status] ?? { label: status, cls: "bg-white/10 text-white/50" };
  return <Badge className={cn("border", s.cls)}>{s.label}</Badge>;
}

function ClaimStatusBadge({ status }: { status?: string | null }) {
  if (!status) return null;
  const map: Record<string, { label: string; cls: string; icon: any }> = {
    PENDING:      { label: "Pending",       cls: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",  icon: Clock         },
    UNDER_REVIEW: { label: "Under Review",  cls: "bg-blue-500/20 text-blue-300 border-blue-500/30",        icon: RefreshCw     },
    APPROVED:     { label: "Approved",      cls: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30", icon: CheckCircle2 },
    REJECTED:     { label: "Rejected",      cls: "bg-red-500/20 text-red-400 border-red-500/30",           icon: XCircle      },
    CANCELLED:    { label: "Cancelled",     cls: "bg-white/10 text-white/40 border-white/20",              icon: XCircle      },
  };
  const s = map[status] ?? { label: status, cls: "bg-white/10 text-white/50", icon: AlertCircle };
  const Icon = s.icon;
  return (
    <Badge className={cn("border gap-1", s.cls)}>
      <Icon className="w-3 h-3" />
      {s.label}
    </Badge>
  );
}

function PolicyBadge({ decision }: { decision?: string | null }) {
  if (!decision) return null;
  const map: Record<string, { label: string; cls: string }> = {
    AUTO_APPROVABLE: { label: "Auto-approvable", cls: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30" },
    REQUIRES_REVIEW: { label: "Needs Review",    cls: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30"   },
    BLOCKED:         { label: "Blocked",          cls: "bg-red-500/20 text-red-400 border-red-500/30"            },
  };
  const s = map[decision] ?? { label: decision, cls: "bg-white/10 text-white/50" };
  return <Badge className={cn("border text-xs", s.cls)}>{s.label}</Badge>;
}

function ConfidenceBadge({ level }: { level?: string | null }) {
  if (!level) return null;
  const map: Record<string, string> = {
    HIGH:   "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
    MEDIUM: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
    LOW:    "bg-red-500/20 text-red-400 border-red-500/30",
  };
  return <Badge className={cn("border text-xs", map[level] ?? "bg-white/10 text-white/50")}>{level}</Badge>;
}

function SubmissionStatusBadge({ status }: { status?: string | null }) {
  if (!status) return null;
  const map: Record<string, { label: string; cls: string }> = {
    SUBMITTED:    { label: "Submitted",    cls: "bg-blue-500/20 text-blue-300 border-blue-500/30"           },
    UNDER_REVIEW: { label: "Under Review", cls: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30"    },
    APPROVED:     { label: "Approved",     cls: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30" },
    REJECTED:     { label: "Rejected",     cls: "bg-red-500/20 text-red-400 border-red-500/30"             },
    WITHDRAWN:    { label: "Withdrawn",    cls: "bg-white/10 text-white/40 border-white/20"                },
  };
  const s = map[status] ?? { label: status, cls: "bg-white/10 text-white/50" };
  return <Badge className={cn("border", s.cls)}>{s.label}</Badge>;
}

// ── Section skeleton ──────────────────────────────────────────────────────────

function SectionSkeleton({ rows = 2 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-16 rounded-lg bg-white/5 animate-pulse" />
      ))}
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({ icon: Icon, message }: { icon: any; message: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-8 text-white/30">
      <Icon className="w-8 h-8" />
      <p className="text-sm">{message}</p>
    </div>
  );
}

// ── 1. Connected Accounts section ─────────────────────────────────────────────

function ConnectedAccountsSection({ accounts }: { accounts: any[] }) {
  const gameLabel: Record<string, string> = { dota2: "Dota 2", lol: "League of Legends" };
  const providerLabel: Record<string, string> = { steam: "Steam", riot: "Riot" };

  return (
    <Card className="bg-white/5 border-white/10">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2 text-white">
          <Shield className="w-4 h-4 text-primary" />
          Connected Accounts
        </CardTitle>
      </CardHeader>
      <CardContent>
        {accounts.length === 0 ? (
          <EmptyState icon={Shield} message="No connected accounts yet. Complete onboarding to link your game accounts." />
        ) : (
          <div className="space-y-2">
            {accounts.map((acct: any) => (
              <div
                key={acct.id}
                data-testid={`connected-account-${acct.id}`}
                className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/10"
              >
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium text-white">
                    {providerLabel[acct.providerGroup] ?? acct.providerGroup}
                    {acct.game ? ` · ${gameLabel[acct.game] ?? acct.game}` : ""}
                  </span>
                  {acct.providerAccountName && (
                    <span className="text-xs text-white/50">{acct.providerAccountName}</span>
                  )}
                  {acct.providerAccountId && !acct.providerAccountName && (
                    <span className="text-xs text-white/40 font-mono">{acct.providerAccountId}</span>
                  )}
                </div>
                <VerificationBadge status={acct.verificationStatus} />
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── 2. Claimable Assets section ───────────────────────────────────────────────

function ClaimableAssetsSection({
  candidates,
  onClaim,
  isPending,
}: {
  candidates: any[];
  onClaim: (candidate: any) => void;
  isPending: boolean;
}) {
  return (
    <Card className="bg-white/5 border-white/10">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2 text-white">
          <Star className="w-4 h-4 text-primary" />
          Claimable Assets
          <span className="text-xs text-white/40 font-normal">auto-detected via connected accounts</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {candidates.length === 0 ? (
          <EmptyState
            icon={Star}
            message="No claimable assets detected. Verify your Steam account to unlock asset claiming."
          />
        ) : (
          <div className="space-y-2">
            {candidates.map((c: any) => (
              <div
                key={c.assetId}
                data-testid={`claimable-asset-${c.assetId}`}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-lg bg-white/5 border border-white/10"
              >
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-white">
                      {c.displayName ?? c.symbol ?? `Asset #${c.assetId}`}
                    </span>
                    {c.symbol && c.displayName && (
                      <span className="text-xs text-white/40">{c.symbol}</span>
                    )}
                    <Badge variant="outline" className="text-xs text-white/40 border-white/20">
                      {c.game}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-white/40">Match:</span>
                    <ConfidenceBadge level={c.matchConfidence} />
                    {!c.alreadyOwned && (
                      <PolicyBadge decision={c.policyDecision} />
                    )}
                    {c.hasActiveOwner && !c.alreadyOwned && (
                      <Badge className="bg-orange-500/20 text-orange-300 border-orange-500/30 border text-xs">
                        Has Owner
                      </Badge>
                    )}
                    {c.hasOpenClaim && (
                      <ClaimStatusBadge status={c.openClaimStatus} />
                    )}
                  </div>
                  {c.providerAccountName && (
                    <span className="text-xs text-white/40">Steam: {c.providerAccountName}</span>
                  )}
                </div>
                <div className="shrink-0">
                  {c.alreadyOwned ? (
                    <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30 border">
                      Owned
                    </Badge>
                  ) : c.hasOpenClaim ? (
                    <Badge className="bg-white/10 text-white/40 border-white/20 border">
                      Claim Submitted
                    </Badge>
                  ) : c.canClaim ? (
                    <Button
                      size="sm"
                      data-testid={`btn-claim-asset-${c.assetId}`}
                      onClick={() => onClaim(c)}
                      disabled={isPending}
                      className="bg-primary/20 hover:bg-primary/30 text-primary border border-primary/30"
                    >
                      {isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Claim Asset"}
                    </Button>
                  ) : (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Badge className="bg-white/10 text-white/40 border-white/20 border cursor-help">
                            Unavailable
                          </Badge>
                        </TooltipTrigger>
                        <TooltipContent>
                          {c.policyDecision === "BLOCKED"
                            ? "Verify your Steam account first."
                            : c.hasActiveOwner
                            ? "Asset already has an active owner."
                            : "Claim not available."}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── 3. My Owned Assets section ────────────────────────────────────────────────

function OwnedAssetsSection({ ownedAssets }: { ownedAssets: any[] }) {
  return (
    <Card className="bg-white/5 border-white/10">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2 text-white">
          <Package className="w-4 h-4 text-primary" />
          My Owned Assets
        </CardTitle>
      </CardHeader>
      <CardContent>
        {ownedAssets.length === 0 ? (
          <EmptyState icon={Package} message="No owned assets yet. Claim an asset to see it here." />
        ) : (
          <div className="space-y-2">
            {ownedAssets.map((a: any) => (
              <div
                key={a.ownershipLinkId}
                data-testid={`owned-asset-${a.assetId}`}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-lg bg-white/5 border border-white/10"
              >
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-white">
                      {a.displayName ?? a.symbol ?? `Asset #${a.assetId}`}
                    </span>
                    {a.symbol && a.displayName && (
                      <span className="text-xs text-white/40">{a.symbol}</span>
                    )}
                    {a.game && (
                      <Badge variant="outline" className="text-xs text-white/40 border-white/20">
                        {a.game}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-white/40 flex-wrap">
                    {a.playerValue != null && (
                      <span className="flex items-center gap-1">
                        <TrendingUp className="w-3 h-3" />
                        Value: <span className="text-white/70">${a.playerValue.toFixed(2)}</span>
                      </span>
                    )}
                    {a.confidenceScore != null && (
                      <span>Confidence: <span className="text-white/70">{(a.confidenceScore * 100).toFixed(0)}%</span></span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap justify-end">
                  {a.isTradable ? (
                    <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30 border">Tradable</Badge>
                  ) : (
                    <Badge className="bg-white/10 text-white/40 border-white/20 border">Not Tradable</Badge>
                  )}
                  {a.listingStatus && (
                    <Badge variant="outline" className="text-xs text-white/40 border-white/20">
                      {a.listingStatus}
                    </Badge>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── 4. My Claims section ──────────────────────────────────────────────────────

function MyClaimsSection({
  claims,
  onCancel,
  cancellingId,
}: {
  claims: any[];
  onCancel: (claimId: number) => void;
  cancellingId: number | null;
}) {
  return (
    <Card className="bg-white/5 border-white/10">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2 text-white">
          <ClipboardList className="w-4 h-4 text-primary" />
          My Claims
        </CardTitle>
      </CardHeader>
      <CardContent>
        {claims.length === 0 ? (
          <EmptyState icon={ClipboardList} message="No claims submitted yet." />
        ) : (
          <div className="space-y-2">
            {claims.map((c: any) => (
              <div
                key={c.id}
                data-testid={`claim-row-${c.id}`}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-lg bg-white/5 border border-white/10"
              >
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-white">
                      {c.displayName ?? c.symbol ?? `Asset #${c.assetId}`}
                    </span>
                    {c.symbol && c.displayName && (
                      <span className="text-xs text-white/40">{c.symbol}</span>
                    )}
                    <Badge variant="outline" className="text-xs text-white/40 border-white/20">
                      {c.game}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <ClaimStatusBadge status={c.claimStatus} />
                    {c.matchConfidence && <ConfidenceBadge level={c.matchConfidence} />}
                    {c.approvalType && (
                      <Badge variant="outline" className="text-xs text-white/40 border-white/20">
                        {c.approvalType === "AUTO_POLICY" ? "Auto-policy" : c.approvalType === "REQUIRES_REVIEW" ? "Manual review" : c.approvalType}
                      </Badge>
                    )}
                  </div>
                  {c.reviewNotes && (
                    <p className="text-xs text-white/40 italic">"{c.reviewNotes}"</p>
                  )}
                  <span className="text-xs text-white/30">
                    {new Date(c.createdAt).toLocaleDateString()}
                  </span>
                </div>
                <div className="shrink-0">
                  {c.canCancel && (
                    <Button
                      size="sm"
                      variant="outline"
                      data-testid={`btn-cancel-claim-${c.id}`}
                      onClick={() => onCancel(c.id)}
                      disabled={cancellingId === c.id}
                      className="border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-300"
                    >
                      {cancellingId === c.id ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        "Cancel"
                      )}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── 5. My Submissions section ─────────────────────────────────────────────────

function MySubmissionsSection({
  submissions,
  ownedAssets,
  onSubmit,
  isSubmitting,
}: {
  submissions: any[];
  ownedAssets: any[];
  onSubmit: () => void;
  isSubmitting: boolean;
}) {
  const submittableAssets = ownedAssets.filter(
    (a: any) => !["UNDER_REVIEW", "APPROVED"].includes(a.listingStatus ?? ""),
  );

  return (
    <Card className="bg-white/5 border-white/10">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2 text-white">
          <SendHorizonal className="w-4 h-4 text-primary" />
          My Submissions
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {submittableAssets.length > 0 && (
          <div className="flex items-center justify-between p-3 rounded-lg bg-primary/10 border border-primary/20">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm text-white font-medium">Submit for Listing Review</span>
              <span className="text-xs text-white/50">
                Asset ready — request admin review to list on the market.
              </span>
            </div>
            <Button
              size="sm"
              data-testid="btn-submit-for-review"
              onClick={onSubmit}
              disabled={isSubmitting}
              className="bg-primary/20 hover:bg-primary/30 text-primary border border-primary/30"
            >
              {isSubmitting ? <Loader2 className="w-3 h-3 animate-spin" /> : "Submit"}
            </Button>
          </div>
        )}

        {submissions.length === 0 ? (
          <EmptyState icon={SendHorizonal} message="No submissions yet." />
        ) : (
          <div className="space-y-2">
            {submissions.map((s: any) => (
              <div
                key={s.id}
                data-testid={`submission-row-${s.id}`}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-lg bg-white/5 border border-white/10"
              >
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-white">
                      {s.displayName ?? s.symbol ?? `Asset #${s.assetId}`}
                    </span>
                    {s.symbol && s.displayName && (
                      <span className="text-xs text-white/40">{s.symbol}</span>
                    )}
                    <Badge variant="outline" className="text-xs text-white/40 border-white/20">
                      {s.game}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <SubmissionStatusBadge status={s.submissionStatus} />
                    {s.listingStatus && (
                      <Badge variant="outline" className="text-xs text-white/40 border-white/20">
                        Listing: {s.listingStatus}
                      </Badge>
                    )}
                  </div>
                  <span className="text-xs text-white/30">
                    {new Date(s.createdAt).toLocaleDateString()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function MyAssetsPage() {
  const { user, isLoading: authLoading } = useAuth();
  const { toast } = useToast();

  // ── Data ──────────────────────────────────────────────────────────────────

  const summaryQuery = useQuery<{
    connectedAccounts: any[];
    ownedAssets:       any[];
    claims:            any[];
    submissions:       any[];
    totals:            Record<string, number>;
  }>({
    queryKey: ["/api/me/assets/summary"],
    enabled:  !!user,
  });

  const claimableQuery = useQuery<{ candidates: any[]; total: number }>({
    queryKey: ["/api/me/assets/claimable"],
    enabled:  !!user,
  });

  const summary     = summaryQuery.data;
  const candidates  = claimableQuery.data?.candidates ?? [];
  const isLoading   = summaryQuery.isLoading || claimableQuery.isLoading;

  // ── Mutations ─────────────────────────────────────────────────────────────

  const claimMutation = useMutation({
    mutationFn: (game: string) => apiRequest("POST", `/api/me/${game}/claim-asset`),
    onSuccess: (data: any) => {
      const msg = data.autoApproved
        ? "Asset claimed and auto-approved!"
        : "Claim submitted — pending review.";
      toast({ title: "Claim Submitted", description: msg });
      queryClient.invalidateQueries({ queryKey: ["/api/me/assets/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/me/assets/claimable"] });
    },
    onError: (err: any) => {
      const msg = err?.message ?? "Failed to submit claim.";
      toast({ title: "Claim Failed", description: msg, variant: "destructive" });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (claimId: number) =>
      apiRequest("POST", `/api/me/dota2/claims/${claimId}/cancel`),
    onSuccess: () => {
      toast({ title: "Claim Cancelled", description: "Your claim has been cancelled." });
      queryClient.invalidateQueries({ queryKey: ["/api/me/assets/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/me/assets/claimable"] });
    },
    onError: (err: any) => {
      toast({ title: "Cancel Failed", description: err?.message ?? "Failed to cancel claim.", variant: "destructive" });
    },
  });

  const submitMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/me/dota2/submit-for-review"),
    onSuccess: () => {
      toast({ title: "Submitted", description: "Asset submitted for listing review." });
      queryClient.invalidateQueries({ queryKey: ["/api/me/assets/summary"] });
    },
    onError: (err: any) => {
      toast({ title: "Submit Failed", description: err?.message ?? "Failed to submit.", variant: "destructive" });
    },
  });

  // ── Render ────────────────────────────────────────────────────────────────

  if (authLoading) {
    return (
      <SettingsLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-6 h-6 animate-spin text-white/40" />
        </div>
      </SettingsLayout>
    );
  }

  return (
    <SettingsLayout>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Layers className="w-6 h-6 text-primary" />
          My Assets
        </h1>
        <p className="text-sm text-white/50 mt-1">
          Manage your claimed assets, open claims, and listing submissions.
        </p>
      </div>

        {isLoading ? (
          <div className="space-y-4">
            <SectionSkeleton rows={2} />
            <SectionSkeleton rows={1} />
            <SectionSkeleton rows={2} />
          </div>
        ) : (
          <div className="space-y-4">
            {/* 1. Connected Accounts */}
            <ConnectedAccountsSection
              accounts={summary?.connectedAccounts ?? []}
            />

            {/* 2. Claimable Assets */}
            <ClaimableAssetsSection
              candidates={candidates}
              onClaim={(c: any) => claimMutation.mutate(c.game)}
              isPending={claimMutation.isPending}
            />

            {/* 3. My Owned Assets */}
            <OwnedAssetsSection ownedAssets={summary?.ownedAssets ?? []} />

            {/* 4. My Claims */}
            <MyClaimsSection
              claims={summary?.claims ?? []}
              onCancel={(id) => cancelMutation.mutate(id)}
              cancellingId={cancelMutation.isPending ? (cancelMutation.variables as number) : null}
            />

            {/* 5. My Submissions */}
            <MySubmissionsSection
              submissions={summary?.submissions ?? []}
              ownedAssets={summary?.ownedAssets ?? []}
              onSubmit={() => submitMutation.mutate()}
              isSubmitting={submitMutation.isPending}
            />
          </div>
        )}
    </SettingsLayout>
  );
}
