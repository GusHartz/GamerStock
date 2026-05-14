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
  CheckCircle2, XCircle, Eye, RefreshCw, LayoutGrid,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type ReviewItem = {
  assetId:         number;
  assetUid:        string | null;
  displayName:     string | null;
  symbol:          string | null;
  tradingStatus:   string | null;
  listingStatus:   string | null;
  playerProfileId: number | null;
  lastSyncedAt:    string | null;
  latestReview:    { decision: string; reasonCode: string; reviewedBy: string; createdAt: string } | null;
  latestSubmission: { submissionStatus: string; createdAt: string } | null;
  confidenceScore:  number | null;
  playerValue:      number | null;
  matchesCount:     number | null;
  isTradable:       boolean;
  ownershipStatus:  string | null;
  ownerUserId:      string | null;
  verificationStatus: string | null;
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

function verificationColor(s: string | null) {
  if (s === "VERIFIED") return "bg-emerald-500/10 text-emerald-300 border-emerald-500/20";
  if (s === "FAILED")   return "bg-red-500/10 text-red-300 border-red-500/20";
  if (s === "REVOKED")  return "bg-zinc-500/10 text-zinc-400 border-zinc-500/20";
  return "bg-amber-500/10 text-amber-300 border-amber-500/20";
}

function policyColor(s: string | null) {
  if (s === "AUTO_APPROVABLE") return "bg-emerald-500/10 text-emerald-300 border-emerald-500/20";
  if (s === "BLOCKED")         return "bg-red-500/10 text-red-300 border-red-500/20";
  return "bg-amber-500/10 text-amber-300 border-amber-500/20";
}

function confidenceColor(s: string | null) {
  if (s === "HIGH")   return "bg-emerald-500/10 text-emerald-300 border-emerald-500/20";
  if (s === "MEDIUM") return "bg-amber-500/10 text-amber-300 border-amber-500/20";
  if (s === "LOW")    return "bg-red-500/10 text-red-300 border-red-500/20";
  return "bg-zinc-500/10 text-zinc-400 border-zinc-500/20";
}

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" });
}

function fmtNum(n: number | null | undefined, decimals = 2) {
  if (n == null) return "—";
  return Number(n).toFixed(decimals);
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

function AssetContextPanel({ assetId }: { assetId: number }) {
  const { data, isLoading } = useQuery<AdminContextSection>({
    queryKey: ["/api/admin/dota2/assets", assetId, "admin-context"],
    queryFn: async () => {
      const r = await fetch(`/api/admin/dota2/assets/${assetId}/admin-context`);
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
  });

  if (isLoading) return <div className="flex items-center justify-center h-24 text-muted-foreground text-sm">Loading context…</div>;
  if (!data)     return <div className="text-muted-foreground text-sm">Context unavailable.</div>;

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
        </>
      )}

      <SectionHeader title="Verification" />
      {verification.hasVerification ? (
        <>
          <InfoRow label="Provider"        value={verification.providerGroup} />
          <InfoRow label="Status"          value={<Badge variant="outline" className={verificationColor(verification.verificationStatus)}>{verification.verificationStatus}</Badge>} />
          <InfoRow label="Account"         value={verification.providerAccountName ?? verification.providerAccountId} />
        </>
      ) : (
        <InfoRow label="Status" value="No verification record" />
      )}

      <SectionHeader title="Valuation" />
      <InfoRow label="Player Value"     value={valuation.playerValue != null ? `$${Number(valuation.playerValue).toFixed(2)}` : null} />
      <InfoRow label="Confidence"       value={valuation.confidenceScore != null ? `${(Number(valuation.confidenceScore) * 100).toFixed(0)}%` : null} />
      <InfoRow label="Matches Count"    value={valuation.matchesCount} />
      <InfoRow label="Updated At"       value={fmtDate(valuation.updatedAt)} />

      <SectionHeader title="Listing Readiness" />
      {listingReadiness.available ? (
        <>
          <InfoRow label="Is Ready"      value={listingReadiness.isReady ? "Yes" : "No"} />
          <InfoRow label="Failing Checks" value={listingReadiness.failingChecks?.length ? listingReadiness.failingChecks.join(", ") : "None"} />
        </>
      ) : (
        <InfoRow label="Status" value={`Unavailable (${listingReadiness.reason ?? "unknown"})`} />
      )}

      <SectionHeader title="Claim / Policy" />
      <InfoRow label="Policy Decision" value={
        claimPolicy.policyDecision
          ? <Badge variant="outline" className={policyColor(claimPolicy.policyDecision)}>{claimPolicy.policyDecision}</Badge>
          : null
      } />
      <InfoRow label="Claim Origin"    value={claimPolicy.claimOrigin} />
      <InfoRow label="Match Confidence" value={
        claimPolicy.matchConfidence
          ? <Badge variant="outline" className={confidenceColor(claimPolicy.matchConfidence)}>{claimPolicy.matchConfidence}</Badge>
          : null
      } />
      <InfoRow label="Claim Status"    value={claimPolicy.latestClaim?.claimStatus ?? null} />
      <InfoRow label="Submission"      value={claimPolicy.latestSubmission?.submissionStatus ?? null} />
      <InfoRow label="Review"          value={claimPolicy.latestReview?.decision ?? null} />
    </div>
  );
}

// ── Filter Select ─────────────────────────────────────────────────────────────

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

export default function MultigameAssetsReviewPage() {
  const { toast } = useToast();
  const [filters, setFilters] = useState({
    hasOwner:           ALL,
    hasValuation:       ALL,
    verificationStatus: ALL,
  });
  const [contextAssetId, setContextAssetId] = useState<number | null>(null);

  const queryParams = new URLSearchParams();
  if (filters.hasOwner           !== ALL) queryParams.set("hasOwner",           filters.hasOwner);
  if (filters.hasValuation       !== ALL) queryParams.set("hasValuation",       filters.hasValuation);
  if (filters.verificationStatus !== ALL) queryParams.set("verificationStatus", filters.verificationStatus);

  const { data, isLoading, refetch } = useQuery<{ queue: ReviewItem[]; total: number }>({
    queryKey: ["/api/admin/dota2/assets-under-review", filters],
    queryFn: async () => {
      const r = await fetch(`/api/admin/dota2/assets-under-review?${queryParams}`);
      if (!r.ok) throw new Error("Failed to fetch assets under review");
      return r.json();
    },
  });

  const approveMutation = useMutation({
    mutationFn: async (assetId: number) =>
      apiRequest("POST", `/api/admin/dota2/assets/${assetId}/approve-listing`, {}),
    onSuccess: () => {
      toast({ title: "Asset approved and listed." });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/dota2/assets-under-review"] });
      setContextAssetId(null);
    },
    onError: () => toast({ title: "Approval failed", variant: "destructive" }),
  });

  const rejectMutation = useMutation({
    mutationFn: async (assetId: number) =>
      apiRequest("POST", `/api/admin/dota2/assets/${assetId}/reject-listing`, {}),
    onSuccess: () => {
      toast({ title: "Asset rejected." });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/dota2/assets-under-review"] });
      setContextAssetId(null);
    },
    onError: () => toast({ title: "Rejection failed", variant: "destructive" }),
  });

  const queue = data?.queue ?? [];

  return (
    <MultigameAdminLayout
      title="Assets Under Review"
      subtitle={`${data?.total ?? 0} assets pending listing decision`}
    >
      {/* ── Filters ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end gap-3 mb-5">
        <FilterSelect label="Has Owner" value={filters.hasOwner} onChange={v => setFilters(f => ({ ...f, hasOwner: v }))} options={[
          { label: "With Owner",    value: "true" },
          { label: "Without Owner", value: "false" },
        ]} />
        <FilterSelect label="Has Valuation" value={filters.hasValuation} onChange={v => setFilters(f => ({ ...f, hasValuation: v }))} options={[
          { label: "Has Valuation",    value: "true" },
          { label: "No Valuation Yet", value: "false" },
        ]} />
        <FilterSelect label="Verification" value={filters.verificationStatus} onChange={v => setFilters(f => ({ ...f, verificationStatus: v }))} options={[
          { label: "Verified", value: "VERIFIED" },
          { label: "Pending",  value: "PENDING" },
          { label: "Failed",   value: "FAILED" },
          { label: "Revoked",  value: "REVOKED" },
        ]} />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => refetch()}
          data-testid="button-refresh-review"
          className="h-8 text-xs gap-1.5 text-muted-foreground hover:text-white"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </Button>
      </div>

      {/* ── Table ────────────────────────────────────────────────────────── */}
      {isLoading ? (
        <div className="flex justify-center py-16 text-muted-foreground text-sm">Loading…</div>
      ) : queue.length === 0 ? (
        <div className="flex flex-col items-center py-16 gap-3 text-muted-foreground">
          <LayoutGrid className="w-8 h-8 opacity-30" />
          <span className="text-sm">No assets under review.</span>
        </div>
      ) : (
        <div className="rounded-lg border border-white/[0.07] overflow-hidden overflow-x-auto">
          <table className="w-full text-xs min-w-[900px]">
            <thead>
              <tr className="border-b border-white/[0.07] bg-white/[0.02]">
                <th className="text-left px-3 py-2.5 text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Asset</th>
                <th className="text-left px-3 py-2.5 text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Symbol</th>
                <th className="text-left px-3 py-2.5 text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Verif.</th>
                <th className="text-right px-3 py-2.5 text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Confidence</th>
                <th className="text-right px-3 py-2.5 text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Player Value</th>
                <th className="text-right px-3 py-2.5 text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Matches</th>
                <th className="text-left px-3 py-2.5 text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Submission</th>
                <th className="text-left px-3 py-2.5 text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Review</th>
                <th className="text-left px-3 py-2.5 text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Tradable</th>
                <th className="text-left px-3 py-2.5 text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Owner</th>
                <th className="text-right px-3 py-2.5 text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {queue.map((item, i) => (
                <tr
                  key={item.assetId}
                  data-testid={`row-asset-review-${item.assetId}`}
                  className={`border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors ${i % 2 === 0 ? "" : "bg-white/[0.01]"}`}
                >
                  <td className="px-3 py-2.5">
                    <div className="text-white/90 font-medium truncate max-w-[160px]">
                      {item.displayName ?? `Asset #${item.assetId}`}
                    </div>
                    <div className="text-[10px] text-zinc-500 font-mono">#{item.assetId}</div>
                  </td>
                  <td className="px-3 py-2.5 font-mono text-zinc-300">{item.symbol ?? "—"}</td>
                  <td className="px-3 py-2.5">
                    {item.verificationStatus
                      ? <Badge variant="outline" className={verificationColor(item.verificationStatus)}>{item.verificationStatus}</Badge>
                      : <span className="text-zinc-600">—</span>}
                  </td>
                  <td className="px-3 py-2.5 text-right text-zinc-300">
                    {item.confidenceScore != null ? `${fmtNum(item.confidenceScore * 100, 0)}%` : "—"}
                  </td>
                  <td className="px-3 py-2.5 text-right text-zinc-300">
                    {item.playerValue != null ? `$${fmtNum(item.playerValue)}` : "—"}
                  </td>
                  <td className="px-3 py-2.5 text-right text-zinc-400">{item.matchesCount ?? "—"}</td>
                  <td className="px-3 py-2.5">
                    {item.latestSubmission
                      ? <Badge variant="outline" className="bg-blue-500/10 text-blue-300 border-blue-500/20 text-[10px]">{item.latestSubmission.submissionStatus}</Badge>
                      : <span className="text-zinc-600">—</span>}
                  </td>
                  <td className="px-3 py-2.5">
                    {item.latestReview
                      ? <Badge variant="outline" className={item.latestReview.decision === "APPROVED" ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/20 text-[10px]" : "bg-red-500/10 text-red-300 border-red-500/20 text-[10px]"}>{item.latestReview.decision}</Badge>
                      : <span className="text-zinc-600">—</span>}
                  </td>
                  <td className="px-3 py-2.5">
                    {item.isTradable
                      ? <span className="text-emerald-400 text-[10px]">✓ Yes</span>
                      : <span className="text-zinc-600 text-[10px]">No</span>}
                  </td>
                  <td className="px-3 py-2.5">
                    {item.ownershipStatus
                      ? <span className="text-amber-400">⚠ Owned</span>
                      : <span className="text-zinc-600">None</span>}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setContextAssetId(item.assetId)}
                        data-testid={`button-context-asset-${item.assetId}`}
                        className="h-7 px-2 text-zinc-400 hover:text-white"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => approveMutation.mutate(item.assetId)}
                        disabled={approveMutation.isPending}
                        data-testid={`button-approve-listing-${item.assetId}`}
                        className="h-7 px-2 text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => rejectMutation.mutate(item.assetId)}
                        disabled={rejectMutation.isPending}
                        data-testid={`button-reject-listing-${item.assetId}`}
                        className="h-7 px-2 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Asset Context Sheet ───────────────────────────────────────────── */}
      <Sheet open={contextAssetId !== null} onOpenChange={open => { if (!open) setContextAssetId(null); }}>
        <SheetContent className="w-[520px] sm:w-[580px] bg-[#090d1a] border-white/[0.07]">
          <SheetHeader>
            <SheetTitle className="text-white">Asset Context — #{contextAssetId}</SheetTitle>
            <SheetDescription>Consolidated admin panel for this asset.</SheetDescription>
          </SheetHeader>
          {contextAssetId !== null && (
            <div className="mt-4 space-y-3">
              <AssetContextPanel assetId={contextAssetId} />
              <div className="flex gap-3 pt-4 border-t border-white/[0.07]">
                <Button
                  size="sm"
                  onClick={() => approveMutation.mutate(contextAssetId)}
                  disabled={approveMutation.isPending}
                  data-testid="button-sheet-approve-listing"
                  className="bg-emerald-600 hover:bg-emerald-500 text-white gap-2"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  Approve Listing
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => rejectMutation.mutate(contextAssetId)}
                  disabled={rejectMutation.isPending}
                  data-testid="button-sheet-reject-listing"
                  className="border-red-500/40 text-red-400 hover:bg-red-500/10 gap-2"
                >
                  <XCircle className="w-4 h-4" />
                  Reject Listing
                </Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </MultigameAdminLayout>
  );
}
