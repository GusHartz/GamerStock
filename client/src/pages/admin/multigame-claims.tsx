import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { MultigameAdminLayout } from "./multigame-layout";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  CheckCircle2, XCircle, Eye, RefreshCw, ChevronRight,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type ClaimItem = {
  id:                    number;
  assetId:               number;
  playerProfileId:       number;
  connectedAccountId:    number;
  requestedByUserId:     string;
  game:                  string;
  claimStatus:           string;
  reasonCode:            string | null;
  evidenceJson:          string | null;
  reviewNotes:           string | null;
  reviewedBy:            string | null;
  reviewedAt:            string | null;
  claimOrigin:           string | null;
  approvalType:          string | null;
  matchConfidence:       string | null;
  createdAt:             string;
  updatedAt:             string;
  existingOwnershipLink: unknown | null;
  verificationStatusCode: string | null;
};

type AdminContextSection = {
  assetId:         number;
  asset:           Record<string, any>;
  ownership:       Record<string, any>;
  verification:    Record<string, any>;
  valuation:       Record<string, any>;
  listingReadiness: Record<string, any>;
  claimPolicy:     Record<string, any>;
};

// ── Color helpers ─────────────────────────────────────────────────────────────

function claimStatusColor(s: string) {
  if (s === "APPROVED")     return "bg-emerald-500/10 text-emerald-300 border-emerald-500/20";
  if (s === "REJECTED")     return "bg-red-500/10 text-red-300 border-red-500/20";
  if (s === "UNDER_REVIEW") return "bg-amber-500/10 text-amber-300 border-amber-500/20";
  if (s === "CANCELLED")    return "bg-zinc-500/10 text-zinc-400 border-zinc-500/20";
  return "bg-blue-500/10 text-blue-300 border-blue-500/20";
}

function verificationColor(s: string | null) {
  if (s === "VERIFIED") return "bg-emerald-500/10 text-emerald-300 border-emerald-500/20";
  if (s === "FAILED")   return "bg-red-500/10 text-red-300 border-red-500/20";
  if (s === "REVOKED")  return "bg-zinc-500/10 text-zinc-400 border-zinc-500/20";
  return "bg-amber-500/10 text-amber-300 border-amber-500/20";
}

function confidenceColor(s: string | null) {
  if (s === "HIGH")   return "bg-emerald-500/10 text-emerald-300 border-emerald-500/20";
  if (s === "MEDIUM") return "bg-amber-500/10 text-amber-300 border-amber-500/20";
  if (s === "LOW")    return "bg-red-500/10 text-red-300 border-red-500/20";
  return "bg-zinc-500/10 text-zinc-400 border-zinc-500/20";
}

function policyColor(s: string | null) {
  if (s === "AUTO_APPROVABLE") return "bg-emerald-500/10 text-emerald-300 border-emerald-500/20";
  if (s === "BLOCKED")         return "bg-red-500/10 text-red-300 border-red-500/20";
  return "bg-amber-500/10 text-amber-300 border-amber-500/20";
}

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" });
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 py-1.5 border-b border-white/[0.05] last:border-0">
      <span className="text-[11px] text-muted-foreground w-36 shrink-0">{label}</span>
      <span className="text-xs text-white/90 break-all">{value ?? "—"}</span>
    </div>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="text-[10px] font-mono text-cyan-400 uppercase tracking-widest font-semibold mt-5 mb-2 pb-1 border-b border-white/[0.07]">
      {title}
    </div>
  );
}

// ── Asset Context Panel ───────────────────────────────────────────────────────

function AssetContextPanel({ assetId, onClose }: { assetId: number; onClose: () => void }) {
  const { data, isLoading } = useQuery<AdminContextSection>({
    queryKey: ["/api/admin/dota2/assets", assetId, "admin-context"],
    queryFn: async () => {
      const r = await fetch(`/api/admin/dota2/assets/${assetId}/admin-context`);
      if (!r.ok) throw new Error("Failed to fetch context");
      return r.json();
    },
  });

  if (isLoading) {
    return <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">Loading context…</div>;
  }
  if (!data) {
    return <div className="text-muted-foreground text-sm">Context unavailable.</div>;
  }

  const { asset, ownership, verification, valuation, listingReadiness, claimPolicy } = data;

  return (
    <div className="overflow-y-auto max-h-[80vh] pr-1">
      <SectionHeader title="Asset" />
      <InfoRow label="Asset ID"       value={asset.assetId} />
      <InfoRow label="Symbol"         value={asset.symbol} />
      <InfoRow label="Display Name"   value={asset.displayName} />
      <InfoRow label="Game"           value={asset.game} />
      <InfoRow label="Trading Status" value={asset.tradingStatus} />
      <InfoRow label="Listing Status" value={asset.listingStatus} />
      <InfoRow label="Is Tradable"    value={asset.isTradable ? "Yes" : "No"} />

      <SectionHeader title="Ownership" />
      <InfoRow label="Has Active Owner" value={ownership.hasActiveOwner ? "Yes" : "No"} />
      {ownership.hasActiveOwner && (
        <>
          <InfoRow label="Owner User ID"   value={ownership.ownerUserId} />
          <InfoRow label="Ownership Type"  value={ownership.ownershipType} />
          <InfoRow label="Source Type"     value={ownership.sourceType} />
          <InfoRow label="Source ID"       value={ownership.sourceId} />
          <InfoRow label="Link Created At" value={fmtDate(ownership.createdAt)} />
        </>
      )}

      <SectionHeader title="Verification" />
      {verification.hasVerification ? (
        <>
          <InfoRow label="Provider Group"   value={verification.providerGroup} />
          <InfoRow label="Verif. Status"    value={
            <Badge variant="outline" className={verificationColor(verification.verificationStatus)}>
              {verification.verificationStatus}
            </Badge>
          } />
          <InfoRow label="Provider Account" value={verification.providerAccountName ?? verification.providerAccountId} />
          <InfoRow label="Last Event"       value={verification.latestVerificationEvent?.eventType ?? "—"} />
          <InfoRow label="Last Event At"    value={fmtDate(verification.latestVerificationEvent?.createdAt)} />
        </>
      ) : (
        <InfoRow label="Status" value="No verification record" />
      )}

      <SectionHeader title="Valuation" />
      <InfoRow label="Player Value"   value={valuation.playerValue != null ? `$${Number(valuation.playerValue).toFixed(2)}` : null} />
      <InfoRow label="Confidence"     value={valuation.confidenceScore != null ? `${(Number(valuation.confidenceScore) * 100).toFixed(0)}%` : null} />
      <InfoRow label="Last Perf Score" value={valuation.lastPerformanceScore != null ? Number(valuation.lastPerformanceScore).toFixed(3) : null} />
      <InfoRow label="Matches Count"  value={valuation.matchesCount} />
      <InfoRow label="Updated At"     value={fmtDate(valuation.updatedAt)} />

      <SectionHeader title="Listing Readiness" />
      {listingReadiness.available ? (
        <>
          <InfoRow label="Is Ready"      value={listingReadiness.isReady ? "Yes" : "No"} />
          <InfoRow label="Failing Checks" value={
            listingReadiness.failingChecks?.length
              ? listingReadiness.failingChecks.join(", ")
              : "None"
          } />
          <InfoRow label="Evaluated At"  value={fmtDate(listingReadiness.evaluatedAt)} />
        </>
      ) : (
        <InfoRow label="Status" value={`Unavailable (${listingReadiness.reason ?? "unknown"})`} />
      )}

      <SectionHeader title="Claim / Submission / Policy" />
      <InfoRow label="Policy Decision" value={
        claimPolicy.policyDecision
          ? <Badge variant="outline" className={policyColor(claimPolicy.policyDecision)}>{claimPolicy.policyDecision}</Badge>
          : null
      } />
      <InfoRow label="Claim Origin"    value={claimPolicy.claimOrigin} />
      <InfoRow label="Approval Type"  value={claimPolicy.approvalType} />
      <InfoRow label="Match Confidence" value={
        claimPolicy.matchConfidence
          ? <Badge variant="outline" className={confidenceColor(claimPolicy.matchConfidence)}>{claimPolicy.matchConfidence}</Badge>
          : null
      } />
      <InfoRow label="Latest Claim Status" value={claimPolicy.latestClaim?.claimStatus ?? null} />
      <InfoRow label="Latest Claim At"     value={fmtDate(claimPolicy.latestClaim?.createdAt)} />
      <InfoRow label="Latest Submission"   value={claimPolicy.latestSubmission?.submissionStatus ?? null} />
      <InfoRow label="Latest Review"       value={claimPolicy.latestReview?.decision ?? null} />
      <InfoRow label="Review Notes"        value={claimPolicy.latestClaim?.reviewNotes} />
    </div>
  );
}

// ── Filters ───────────────────────────────────────────────────────────────────

const ALL = "__all__";

function FilterSelect({
  label, value, onChange, options,
}: {
  label:    string;
  value:    string;
  onChange: (v: string) => void;
  options:  { label: string; value: string }[];
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger
          data-testid={`filter-${label.toLowerCase().replace(/\s/g, "-")}`}
          className="h-8 text-xs bg-white/[0.03] border-white/[0.1] min-w-[130px]"
        >
          <SelectValue placeholder="All" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All</SelectItem>
          {options.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function MultigameClaimsPage() {
  const { toast } = useToast();
  const [filters, setFilters] = useState({
    game:               ALL,
    status:             ALL,
    approvalType:       ALL,
    matchConfidence:    ALL,
    verificationStatus: ALL,
    hasActiveOwner:     ALL,
  });
  const [detailClaim,   setDetailClaim]   = useState<ClaimItem | null>(null);
  const [contextAssetId, setContextAssetId] = useState<number | null>(null);

  const queryParams = new URLSearchParams();
  if (filters.game               !== ALL) queryParams.set("game",              filters.game);
  if (filters.status             !== ALL) queryParams.set("claimStatus",       filters.status);
  if (filters.approvalType       !== ALL) queryParams.set("approvalType",      filters.approvalType);
  if (filters.matchConfidence    !== ALL) queryParams.set("matchConfidence",   filters.matchConfidence);
  if (filters.verificationStatus !== ALL) queryParams.set("verificationStatus", filters.verificationStatus);
  if (filters.hasActiveOwner     !== ALL) queryParams.set("hasActiveOwner",    filters.hasActiveOwner);

  const { data, isLoading, refetch } = useQuery<{ claims: ClaimItem[]; total: number }>({
    queryKey: ["/api/admin/multigame/claims", filters],
    queryFn: async () => {
      const r = await fetch(`/api/admin/multigame/claims?${queryParams}`);
      if (!r.ok) throw new Error("Failed to fetch claims");
      return r.json();
    },
  });

  const approveMutation = useMutation({
    mutationFn: async (claimId: number) =>
      apiRequest("POST", `/api/admin/dota2/claim-requests/${claimId}/approve`, {}),
    onSuccess: () => {
      toast({ title: "Claim approved." });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/multigame/claims"] });
      setDetailClaim(null);
    },
    onError: () => toast({ title: "Approval failed", variant: "destructive" }),
  });

  const rejectMutation = useMutation({
    mutationFn: async (claimId: number) =>
      apiRequest("POST", `/api/admin/dota2/claim-requests/${claimId}/reject`, {}),
    onSuccess: () => {
      toast({ title: "Claim rejected." });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/multigame/claims"] });
      setDetailClaim(null);
    },
    onError: () => toast({ title: "Rejection failed", variant: "destructive" }),
  });

  const claims  = data?.claims ?? [];
  const approvable = ["PENDING", "UNDER_REVIEW"];

  return (
    <MultigameAdminLayout
      title="Claims"
      subtitle={`${data?.total ?? 0} total claim requests`}
    >
      {/* ── Filters ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end gap-3 mb-5">
        <FilterSelect label="Game" value={filters.game} onChange={v => setFilters(f => ({ ...f, game: v }))} options={[
          { label: "Dota2", value: "dota2" },
          { label: "CS2",   value: "cs2"   },
          { label: "LoL",   value: "lol"   },
        ]} />
        <FilterSelect label="Status" value={filters.status} onChange={v => setFilters(f => ({ ...f, status: v }))} options={[
          { label: "Pending",      value: "PENDING" },
          { label: "Under Review", value: "UNDER_REVIEW" },
          { label: "Approved",     value: "APPROVED" },
          { label: "Rejected",     value: "REJECTED" },
          { label: "Cancelled",    value: "CANCELLED" },
        ]} />
        <FilterSelect label="Approval Type" value={filters.approvalType} onChange={v => setFilters(f => ({ ...f, approvalType: v }))} options={[
          { label: "Manual Admin",    value: "MANUAL_ADMIN" },
          { label: "Auto Policy",     value: "AUTO_POLICY" },
          { label: "Requires Review", value: "REQUIRES_REVIEW" },
        ]} />
        <FilterSelect label="Match Confidence" value={filters.matchConfidence} onChange={v => setFilters(f => ({ ...f, matchConfidence: v }))} options={[
          { label: "High",   value: "HIGH" },
          { label: "Medium", value: "MEDIUM" },
          { label: "Low",    value: "LOW" },
        ]} />
        <FilterSelect label="Verification" value={filters.verificationStatus} onChange={v => setFilters(f => ({ ...f, verificationStatus: v }))} options={[
          { label: "Verified", value: "VERIFIED" },
          { label: "Pending",  value: "PENDING" },
          { label: "Failed",   value: "FAILED" },
          { label: "Revoked",  value: "REVOKED" },
        ]} />
        <FilterSelect label="Has Owner" value={filters.hasActiveOwner} onChange={v => setFilters(f => ({ ...f, hasActiveOwner: v }))} options={[
          { label: "With Owner",    value: "true" },
          { label: "Without Owner", value: "false" },
        ]} />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => refetch()}
          data-testid="button-refresh-claims"
          className="h-8 text-xs gap-1.5 text-muted-foreground hover:text-white"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </Button>
      </div>

      {/* ── Table ────────────────────────────────────────────────────────── */}
      {isLoading ? (
        <div className="flex justify-center py-16 text-muted-foreground text-sm">Loading…</div>
      ) : claims.length === 0 ? (
        <div className="flex justify-center py-16 text-muted-foreground text-sm">No claims match the selected filters.</div>
      ) : (
        <div className="rounded-lg border border-white/[0.07] overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-white/[0.07] bg-white/[0.02]">
                <th className="text-left px-3 py-2.5 text-[10px] text-muted-foreground uppercase tracking-wide font-medium">ID</th>
                <th className="text-left px-3 py-2.5 text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Asset</th>
                <th className="text-left px-3 py-2.5 text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Requested By</th>
                <th className="text-left px-3 py-2.5 text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Status</th>
                <th className="text-left px-3 py-2.5 text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Verif.</th>
                <th className="text-left px-3 py-2.5 text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Origin</th>
                <th className="text-left px-3 py-2.5 text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Approval</th>
                <th className="text-left px-3 py-2.5 text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Confidence</th>
                <th className="text-left px-3 py-2.5 text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Owner</th>
                <th className="text-left px-3 py-2.5 text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Created</th>
                <th className="text-right px-3 py-2.5 text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {claims.map((c, i) => (
                <tr
                  key={c.id}
                  data-testid={`row-claim-${c.id}`}
                  className={`border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors ${i % 2 === 0 ? "" : "bg-white/[0.01]"}`}
                >
                  <td className="px-3 py-2.5 font-mono text-zinc-400">{c.id}</td>
                  <td className="px-3 py-2.5">
                    <button
                      className="text-cyan-400 hover:text-cyan-300 transition-colors text-left"
                      onClick={() => setContextAssetId(c.assetId)}
                      data-testid={`button-asset-context-${c.id}`}
                    >
                      #{c.assetId}
                    </button>
                  </td>
                  <td className="px-3 py-2.5 font-mono text-zinc-300 max-w-[120px] truncate">{c.requestedByUserId}</td>
                  <td className="px-3 py-2.5">
                    <Badge variant="outline" className={claimStatusColor(c.claimStatus)}>{c.claimStatus}</Badge>
                  </td>
                  <td className="px-3 py-2.5">
                    {c.verificationStatusCode
                      ? <Badge variant="outline" className={verificationColor(c.verificationStatusCode)}>{c.verificationStatusCode}</Badge>
                      : <span className="text-zinc-600">—</span>}
                  </td>
                  <td className="px-3 py-2.5 text-zinc-400">{c.claimOrigin ?? "—"}</td>
                  <td className="px-3 py-2.5 text-zinc-400">{c.approvalType ?? "—"}</td>
                  <td className="px-3 py-2.5">
                    {c.matchConfidence
                      ? <Badge variant="outline" className={confidenceColor(c.matchConfidence)}>{c.matchConfidence}</Badge>
                      : <span className="text-zinc-600">—</span>}
                  </td>
                  <td className="px-3 py-2.5">
                    {c.existingOwnershipLink
                      ? <span className="text-amber-400">⚠ Owned</span>
                      : <span className="text-zinc-600">None</span>}
                  </td>
                  <td className="px-3 py-2.5 text-zinc-500 whitespace-nowrap">{fmtDate(c.createdAt)}</td>
                  <td className="px-3 py-2.5 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDetailClaim(c)}
                        data-testid={`button-detail-claim-${c.id}`}
                        className="h-7 px-2 text-zinc-400 hover:text-white"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </Button>
                      {approvable.includes(c.claimStatus) && (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => approveMutation.mutate(c.id)}
                            disabled={approveMutation.isPending}
                            data-testid={`button-approve-claim-${c.id}`}
                            className="h-7 px-2 text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => rejectMutation.mutate(c.id)}
                            disabled={rejectMutation.isPending}
                            data-testid={`button-reject-claim-${c.id}`}
                            className="h-7 px-2 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                          </Button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Claim Detail Sheet ────────────────────────────────────────────── */}
      <Sheet open={!!detailClaim} onOpenChange={open => { if (!open) setDetailClaim(null); }}>
        <SheetContent className="w-[480px] sm:w-[540px] bg-[#090d1a] border-white/[0.07] overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="text-white">Claim #{detailClaim?.id}</SheetTitle>
            <SheetDescription>Full claim record and actions.</SheetDescription>
          </SheetHeader>
          {detailClaim && (
            <div className="mt-4">
              <SectionHeader title="Claim Record" />
              <InfoRow label="Claim ID"         value={detailClaim.id} />
              <InfoRow label="Asset ID"         value={
                <button onClick={() => { setContextAssetId(detailClaim.assetId); setDetailClaim(null); }}
                  data-testid="button-open-asset-context"
                  className="text-cyan-400 hover:text-cyan-300 flex items-center gap-1">
                  {detailClaim.assetId} <ChevronRight className="w-3 h-3" />
                </button>
              } />
              <InfoRow label="Requested By"     value={detailClaim.requestedByUserId} />
              <InfoRow label="Status"           value={<Badge variant="outline" className={claimStatusColor(detailClaim.claimStatus)}>{detailClaim.claimStatus}</Badge>} />
              <InfoRow label="Verification"     value={<Badge variant="outline" className={verificationColor(detailClaim.verificationStatusCode)}>{detailClaim.verificationStatusCode ?? "UNKNOWN"}</Badge>} />
              <InfoRow label="Game"             value={detailClaim.game} />
              <InfoRow label="Claim Origin"     value={detailClaim.claimOrigin} />
              <InfoRow label="Approval Type"    value={detailClaim.approvalType} />
              <InfoRow label="Match Confidence" value={detailClaim.matchConfidence
                ? <Badge variant="outline" className={confidenceColor(detailClaim.matchConfidence)}>{detailClaim.matchConfidence}</Badge>
                : null} />
              <InfoRow label="Reason Code"      value={detailClaim.reasonCode} />
              <InfoRow label="Has Owner"        value={detailClaim.existingOwnershipLink ? "⚠ Yes — existing owner will be revoked" : "No"} />
              <InfoRow label="Review Notes"     value={detailClaim.reviewNotes} />
              <InfoRow label="Reviewed By"      value={detailClaim.reviewedBy} />
              <InfoRow label="Reviewed At"      value={fmtDate(detailClaim.reviewedAt)} />
              <InfoRow label="Created At"       value={fmtDate(detailClaim.createdAt)} />

              {approvable.includes(detailClaim.claimStatus) && (
                <div className="mt-6 flex gap-3">
                  <Button
                    size="sm"
                    onClick={() => approveMutation.mutate(detailClaim.id)}
                    disabled={approveMutation.isPending}
                    data-testid="button-sheet-approve-claim"
                    className="bg-emerald-600 hover:bg-emerald-500 text-white gap-2"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    Approve
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => rejectMutation.mutate(detailClaim.id)}
                    disabled={rejectMutation.isPending}
                    data-testid="button-sheet-reject-claim"
                    className="border-red-500/40 text-red-400 hover:bg-red-500/10 gap-2"
                  >
                    <XCircle className="w-4 h-4" />
                    Reject
                  </Button>
                </div>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* ── Asset Context Sheet ───────────────────────────────────────────── */}
      <Sheet open={contextAssetId !== null} onOpenChange={open => { if (!open) setContextAssetId(null); }}>
        <SheetContent className="w-[520px] sm:w-[580px] bg-[#090d1a] border-white/[0.07]">
          <SheetHeader>
            <SheetTitle className="text-white">Asset Context — #{contextAssetId}</SheetTitle>
            <SheetDescription>Consolidated admin panel for this asset.</SheetDescription>
          </SheetHeader>
          {contextAssetId !== null && (
            <div className="mt-4">
              <AssetContextPanel assetId={contextAssetId} onClose={() => setContextAssetId(null)} />
            </div>
          )}
        </SheetContent>
      </Sheet>
    </MultigameAdminLayout>
  );
}
