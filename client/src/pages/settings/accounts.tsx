import { useAuth } from "@/hooks/use-auth";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { useEffect, useCallback, useState } from "react";
import { SettingsLayout } from "./settings-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Link2,
  ShieldCheck,
  Star,
  Loader2,
  ExternalLink,
  CircleAlert,
  CheckCircle2,
  AlertTriangle,
  Unlink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SiSteam } from "react-icons/si";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

// ── Error label map ────────────────────────────────────────────────────────────

const STEAM_ERROR_LABELS: Record<string, string> = {
  SESSION_EXPIRED:    "Your session expired. Please log in and try again.",
  SIGNATURE_MISMATCH: "Steam signature verification failed. Please try again.",
  IDENTITY_MISMATCH:  "The Steam account returned doesn't match the one on file.",
  AUTO_CREATE_FAILED: "Could not create your Steam account. Please try again.",
  NO_STEAM_ACCOUNT:   "No Steam account found. Please try connecting again.",
  SERVER_ERROR:       "A server error occurred. Please try again.",
};

// ── Steam popup helper ─────────────────────────────────────────────────────────

const POPUP_SPECS = "width=620,height=740,resizable=yes,scrollbars=yes,toolbar=no,menubar=no";

function openSteamPopup(): Window | null {
  const returnUrl = encodeURIComponent("/steam-callback");
  const url       = `/api/auth/steam/start?returnUrl=${returnUrl}`;
  return window.open(url, "steam_auth_popup", POPUP_SPECS);
}

// ── useSteamPopup hook ────────────────────────────────────────────────────────

function useSteamPopup(onSuccess: () => void, onError: (err: string) => void) {
  const [isPending, setIsPending] = useState(false);

  // Listen for postMessage from the popup
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (!event.data || event.data.type !== "STEAM_AUTH_RESULT") return;

      setIsPending(false);
      if (event.data.success) {
        onSuccess();
      } else {
        onError(event.data.error ?? "UNKNOWN");
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [onSuccess, onError]);

  const connect = useCallback(() => {
    const popup = openSteamPopup();
    if (!popup) {
      onError("POPUP_BLOCKED");
      return;
    }
    setIsPending(true);

    // Detect if popup is closed without sending a message (user dismissed)
    const poll = setInterval(() => {
      if (popup.closed) {
        clearInterval(poll);
        setIsPending(false);
      }
    }, 600);
  }, [onError]);

  return { connect, isPending };
}

// ── Game sub-card ─────────────────────────────────────────────────────────────

function GameCard({
  game,
  label,
  claimCount,
  ownedCount,
  active,
  comingSoon,
}: {
  game:       string;
  label:      string;
  claimCount: number;
  ownedCount: number;
  active:     boolean;
  comingSoon?: boolean;
}) {
  return (
    <div
      data-testid={`game-card-${game}`}
      className={cn(
        "rounded-lg border px-3 py-3 flex items-start justify-between gap-3",
        comingSoon
          ? "bg-white/[0.01] border-white/[0.06] opacity-60"
          : claimCount > 0
          ? "bg-primary/[0.04] border-primary/20"
          : active
          ? "bg-emerald-500/[0.04] border-emerald-500/20"
          : "bg-white/[0.02] border-white/[0.08]",
      )}
    >
      <div className="flex flex-col gap-1">
        <span className="text-xs font-semibold text-white">{label}</span>
        {comingSoon ? (
          <span className="text-[11px] text-white/30">Coming soon</span>
        ) : !active ? (
          <span className="text-[11px] text-white/35">Not connected</span>
        ) : claimCount > 0 ? (
          <span className="text-[11px] text-primary/80">
            {claimCount} claimable asset{claimCount !== 1 ? "s" : ""} detected
          </span>
        ) : ownedCount > 0 ? (
          <span className="text-[11px] text-emerald-400">
            {ownedCount} asset{ownedCount !== 1 ? "s" : ""} owned
          </span>
        ) : (
          <span className="text-[11px] text-white/35">No assets detected yet</span>
        )}
      </div>

      {!comingSoon && claimCount > 0 && (
        <Link href="/settings/my-assets">
          <span className="text-[11px] text-primary hover:text-primary/80 font-medium cursor-pointer transition-colors whitespace-nowrap">
            View →
          </span>
        </Link>
      )}
    </div>
  );
}

// ── Steam provider card ───────────────────────────────────────────────────────

function SteamCard({
  accounts,
  candidates,
  ownedAssets,
}: {
  accounts:   any[];
  candidates: any[];
  ownedAssets: any[];
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const steamAccounts = accounts.filter((a) => a.providerGroup === "steam");
  const verified      = steamAccounts.some((a) => a.verificationStatus === "VERIFIED");
  const connected     = steamAccounts.length > 0;
  const steamName     = steamAccounts.find((a) => a.providerAccountName)?.providerAccountName ?? null;

  const hasDota2 = steamAccounts.some((a) => a.game === "dota2");
  const hasCs2   = steamAccounts.some((a) => a.game === "cs2");

  const dota2Claims = candidates.filter((c) => c.game === "dota2").length;
  const cs2Claims   = candidates.filter((c) => c.game === "cs2").length;
  const dota2Owned  = ownedAssets.filter((a) => a.game === "dota2").length;
  const cs2Owned    = ownedAssets.filter((a) => a.game === "cs2").length;

  const refresh = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["/api/me/assets/summary"] });
    qc.invalidateQueries({ queryKey: ["/api/me/assets/claimable"] });
  }, [qc]);

  const disconnectMutation = useMutation({
    mutationFn: async () => {
      for (const account of steamAccounts) {
        await apiRequest("DELETE", `/api/me/connected-accounts/${account.id}`);
      }
    },
    onSuccess: () => {
      setConfirmDisconnect(false);
      toast({ title: "Steam Disconnected", description: "Your Steam account has been unlinked." });
      queryClient.invalidateQueries({ queryKey: ["/api/me/assets/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/me/assets/claimable"] });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to disconnect Steam. Please try again.", variant: "destructive" });
    },
  });

  const onSuccess = useCallback(() => {
    toast({
      title:       "Steam Connected",
      description: "Your Steam identity has been verified. You can now claim eligible assets.",
    });
    refresh();
  }, [toast, refresh]);

  const onError = useCallback((err: string) => {
    if (err === "POPUP_BLOCKED") {
      toast({
        title:       "Popup Blocked",
        description: "Please allow popups for this site and try again.",
        variant:     "destructive",
      });
      return;
    }
    toast({
      title:       "Steam Verification Failed",
      description: STEAM_ERROR_LABELS[err] ?? `Error: ${err}`,
      variant:     "destructive",
    });
  }, [toast]);

  const { connect, isPending } = useSteamPopup(onSuccess, onError);

  return (
    <Card className="bg-white/[0.04] border-white/10">
      <CardHeader className="pb-3 pt-4 px-4">
        <CardTitle className="text-sm font-semibold text-white flex items-center gap-2.5">
          <SiSteam className="w-4 h-4 text-white/60" />
          Steam
          {verified && (
            <Badge className="bg-emerald-500/15 text-emerald-300 border-emerald-500/30 border text-xs gap-1">
              <ShieldCheck className="w-3 h-3" />
              Verified
            </Badge>
          )}
          {connected && !verified && (
            <Badge className="bg-amber-500/15 text-amber-300 border-amber-500/30 border text-xs gap-1">
              <AlertTriangle className="w-3 h-3" />
              Unverified
            </Badge>
          )}
        </CardTitle>
      </CardHeader>

      <CardContent className="px-4 pb-4 space-y-3">
        {/* Not connected yet */}
        {!connected && (
          <>
            <p className="text-xs text-white/50 leading-relaxed">
              Connect your Steam account to discover and claim eligible Dota 2 and CS2 player assets.
              Verification opens in a secure popup — no passwords are stored.
            </p>
            <div className="flex items-center gap-2 py-1">
              <span className="text-[11px] text-white/30">Supported games:</span>
              <Badge variant="outline" className="text-[10px] text-white/40 border-white/15">Dota 2</Badge>
              <Badge variant="outline" className="text-[10px] text-white/40 border-white/15">CS2</Badge>
            </div>
            <Button
              data-testid="btn-connect-steam"
              className="w-full gap-2 bg-[#171a21] hover:bg-[#2a475e] text-white border border-white/15 transition-colors"
              onClick={connect}
              disabled={isPending}
            >
              {isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <SiSteam className="w-4 h-4" />
              )}
              {isPending ? "Waiting for Steam…" : "Connect via Steam"}
              {!isPending && <ExternalLink className="w-3 h-3 ml-auto opacity-50" />}
            </Button>
          </>
        )}

        {/* Connected — show identity */}
        {connected && (
          <>
            <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.07]">
              <SiSteam className="w-4 h-4 text-white/40 shrink-0" />
              <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                <span className="text-xs font-medium text-white truncate">
                  {steamName ?? "Steam Account"}
                </span>
                {steamAccounts[0]?.providerAccountId && !steamName && (
                  <span className="text-[11px] text-white/35 font-mono truncate">
                    {steamAccounts[0].providerAccountId}
                  </span>
                )}
              </div>
              {verified
                ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                : <CircleAlert  className="w-3.5 h-3.5 text-amber-400 shrink-0" />}
            </div>

            {/* Verify CTA when unverified */}
            {!verified && (
              <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-amber-500/[0.06] border border-amber-500/20">
                <CircleAlert className="w-4 h-4 text-amber-400 shrink-0" />
                <p className="flex-1 text-xs text-amber-200/80">
                  Verify your Steam identity to unlock asset claiming.
                </p>
                <Button
                  size="sm"
                  data-testid="btn-verify-steam"
                  variant="outline"
                  onClick={connect}
                  disabled={isPending}
                  className="text-xs border-amber-500/30 text-amber-300 hover:bg-amber-500/10 h-7 px-3 shrink-0"
                >
                  {isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Verify via Steam"}
                </Button>
              </div>
            )}

            {/* Game sub-cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-0.5">
              <GameCard
                game="dota2"
                label="Dota 2"
                claimCount={dota2Claims}
                ownedCount={dota2Owned}
                active={hasDota2}
              />
              <GameCard
                game="cs2"
                label="CS2"
                claimCount={cs2Claims}
                ownedCount={cs2Owned}
                active={hasCs2}
                comingSoon={!hasCs2 && cs2Claims === 0 && cs2Owned === 0}
              />
            </div>

            {/* Re-connect option when verified */}
            {verified && (
              <div className="pt-0.5">
                <button
                  data-testid="btn-reverify-steam"
                  onClick={connect}
                  disabled={isPending}
                  className="text-xs text-white/25 hover:text-white/50 transition-colors disabled:opacity-50"
                >
                  {isPending ? "Waiting for Steam…" : "Re-connect Steam account ↗"}
                </button>
              </div>
            )}

            {/* Disconnect section */}
            <div className="pt-1 border-t border-white/[0.06]">
              {!confirmDisconnect ? (
                <button
                  data-testid="btn-disconnect-steam"
                  onClick={() => setConfirmDisconnect(true)}
                  className="text-xs text-red-400/50 hover:text-red-400/80 transition-colors flex items-center gap-1.5"
                >
                  <Unlink className="w-3 h-3" />
                  Disconnect Steam account
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-white/50 flex-1">Remove Steam link?</span>
                  <button
                    data-testid="btn-disconnect-steam-cancel"
                    onClick={() => setConfirmDisconnect(false)}
                    className="text-xs text-white/40 hover:text-white/70 transition-colors"
                  >
                    Cancel
                  </button>
                  <Button
                    data-testid="btn-disconnect-steam-confirm"
                    size="sm"
                    variant="destructive"
                    onClick={() => disconnectMutation.mutate()}
                    disabled={disconnectMutation.isPending}
                    className="h-6 px-2.5 text-xs"
                  >
                    {disconnectMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Disconnect"}
                  </Button>
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AccountsPage() {
  const { user } = useAuth();

  const summaryQuery = useQuery<{
    connectedAccounts: any[];
    ownedAssets:       any[];
    claims:            any[];
    totals:            Record<string, number>;
  }>({
    queryKey: ["/api/me/assets/summary"],
    enabled:  !!user,
  });

  const claimableQuery = useQuery<{ candidates: any[]; total: number }>({
    queryKey: ["/api/me/assets/claimable"],
    enabled:  !!user,
  });

  const accounts    = summaryQuery.data?.connectedAccounts ?? [];
  const ownedAssets = summaryQuery.data?.ownedAssets       ?? [];
  const candidates  = claimableQuery.data?.candidates      ?? [];
  const claimCount  = claimableQuery.data?.total           ?? 0;
  const isLoading   = summaryQuery.isLoading;

  return (
    <SettingsLayout>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white flex items-center gap-2.5">
          <Link2 className="w-6 h-6 text-primary" />
          Accounts
        </h1>
        <p className="text-white/50 mt-1 text-sm leading-relaxed">
          Connect and verify your gaming accounts to identify eligible player assets.
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-white/30 gap-2">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="text-sm">Loading accounts…</span>
        </div>
      ) : (
        <div className="space-y-5">
          {/* Steam provider card */}
          <SteamCard
            accounts={accounts}
            candidates={candidates}
            ownedAssets={ownedAssets}
          />

          {/* CTA to My Assets */}
          {claimCount > 0 && (
            <div
              data-testid="banner-claimable"
              className="flex items-center gap-4 px-4 py-3.5 rounded-lg bg-primary/[0.08] border border-primary/20"
            >
              <Star className="w-5 h-5 text-primary shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium text-white">
                  {claimCount} claimable asset{claimCount !== 1 ? "s" : ""} detected
                </p>
                <p className="text-xs text-white/50 mt-0.5">
                  Your connected accounts matched eligible player assets.
                </p>
              </div>
              <Link href="/settings/my-assets" data-testid="btn-view-claimable">
                <Button size="sm" className="bg-primary/20 hover:bg-primary/30 text-primary border border-primary/30 text-xs">
                  View &amp; Claim
                </Button>
              </Link>
            </div>
          )}

          {/* Footer */}
          <div className="pt-2 border-t border-white/[0.06]">
            <p className="text-xs text-white/25 leading-relaxed">
              Pricing, rankings, and market metrics are always managed by GamerStock and cannot be edited.
              Connecting an account does not automatically publish any data — it only enables asset discovery and claim eligibility.
            </p>
          </div>
        </div>
      )}
    </SettingsLayout>
  );
}
