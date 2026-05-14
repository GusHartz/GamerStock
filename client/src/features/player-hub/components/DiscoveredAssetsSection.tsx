import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import {
  Sparkles, Loader2, Link2, CheckCircle2, AlertCircle,
  ArrowRight, Zap, ShieldCheck, AlertTriangle, ExternalLink, Unlink,
} from "lucide-react";
import { SiSteam } from "react-icons/si";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { apiRequest } from "@/lib/queryClient";
import {
  useDiscoveredAssets,
  useAddToTerminal,
  type HubDiscoveredAssetView,
} from "../hooks/use-player-hub";
import { useMutation } from "@tanstack/react-query";

// ── Steam popup helpers ────────────────────────────────────────────────────────

const STEAM_ERROR_LABELS: Record<string, string> = {
  SESSION_EXPIRED:    "Your session expired. Please log in and try again.",
  SIGNATURE_MISMATCH: "Steam signature verification failed. Please try again.",
  IDENTITY_MISMATCH:  "The Steam account returned doesn't match the one on file.",
  AUTO_CREATE_FAILED: "Could not create your Steam account. Please try again.",
  NO_STEAM_ACCOUNT:   "No Steam account found. Please try connecting again.",
  SERVER_ERROR:       "A server error occurred. Please try again.",
};

const POPUP_SPECS = "width=620,height=740,resizable=yes,scrollbars=yes,toolbar=no,menubar=no";

function openSteamPopup(): Window | null {
  const returnUrl = encodeURIComponent("/steam-callback");
  const url       = `/api/auth/steam/start?returnUrl=${returnUrl}`;
  return window.open(url, "steam_auth_popup", POPUP_SPECS);
}

function useSteamPopup(onSuccess: () => void, onError: (err: string) => void) {
  const [isPending, setIsPending] = useState(false);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (!event.data || event.data.type !== "STEAM_AUTH_RESULT") return;
      setIsPending(false);
      if (event.data.success) onSuccess();
      else onError(event.data.error ?? "UNKNOWN");
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [onSuccess, onError]);

  const connect = useCallback(() => {
    const popup = openSteamPopup();
    if (!popup) { onError("POPUP_BLOCKED"); return; }
    setIsPending(true);
    const poll = setInterval(() => {
      if (popup.closed) { clearInterval(poll); setIsPending(false); }
    }, 600);
  }, [onError]);

  return { connect, isPending };
}

// ── Status config ─────────────────────────────────────────────────────────────

const STATUS_CONFIG = {
  available:    { label: "Discovered",  cls: "bg-blue-500/20 text-blue-300 border-blue-500/30",          icon: Sparkles    },
  claim_pending:{ label: "In Terminal", cls: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",  icon: CheckCircle2},
  already_added:{ label: "In Terminal", cls: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",  icon: CheckCircle2},
  unavailable:  { label: "Unavailable", cls: "bg-white/10 text-white/40 border-white/20",                 icon: AlertCircle },
} as const;

// ── Individual asset card ─────────────────────────────────────────────────────

function isSteamId(v: string | null | undefined): boolean {
  if (!v) return false;
  return /^\d{7,}$/.test(v.trim());
}

function resolveDisplayName(asset: HubDiscoveredAssetView): string {
  if (!isSteamId(asset.displayName)) return asset.displayName ?? "Unknown Player";
  if (asset.providerAccountName && !isSteamId(asset.providerAccountName)) {
    return asset.providerAccountName;
  }
  return "Your Player Asset";
}

function DiscoveredAssetCard({ asset }: { asset: HubDiscoveredAssetView }) {
  const { toast } = useToast();
  const addMutation = useAddToTerminal();

  const displayName = resolveDisplayName(asset);
  const s   = STATUS_CONFIG[asset.status];
  const Icon = s.icon;

  function handleAdd() {
    if (!asset.assetUid) {
      toast({ title: "Cannot add asset", description: "Asset UID not available.", variant: "destructive" });
      return;
    }
    addMutation.mutate(
      { assetId: asset.assetId ?? 0, assetUid: asset.assetUid },
      {
        onSuccess: () => {
          toast({
            title: "Added to Terminal!",
            description: `${resolveDisplayName(asset)} is now live in your terminal.`,
          });
          queryClient.invalidateQueries({ queryKey: ["/api/player-hub/discovered-assets"] });
          queryClient.invalidateQueries({ queryKey: ["/api/player-hub/assets"] });
          queryClient.invalidateQueries({ queryKey: ["/api/player-hub/overview"] });
        },
        onError: (err: any) => {
          toast({ title: "Failed to add asset", description: err.message, variant: "destructive" });
        },
      },
    );
  }

  const cardId = asset.assetId ?? asset.assetUid ?? asset.gameId;

  return (
    <div
      data-testid={`discovered-asset-card-${cardId}`}
      className="bg-white/5 border border-white/10 rounded-xl p-4 flex flex-col gap-3 hover:border-white/20 transition-colors"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <SiSteam className="w-4 h-4 text-white/40 flex-shrink-0" />
          <div>
            <p className="text-xs text-white/40 uppercase tracking-wider font-medium">{asset.gameName}</p>
            <p
              className="text-sm font-semibold text-white leading-tight mt-0.5"
              data-testid={`discovered-name-${cardId}`}
            >
              {displayName}
            </p>
            {asset.providerAccountName && !isSteamId(asset.providerAccountName) && asset.providerAccountName !== displayName && (
              <p className="text-xs text-white/30 mt-0.5">via {asset.providerAccountName}</p>
            )}
          </div>
        </div>
        <Badge className={cn("border gap-1 text-xs flex-shrink-0", s.cls)}>
          <Icon className="w-3 h-3" />
          {s.label}
        </Badge>
      </div>

      <div className="flex items-center gap-1.5 text-xs text-white/30">
        <Link2 className="w-3 h-3" />
        <span>
          Match confidence:{" "}
          <span className={cn("font-medium", asset.matchConfidence === "HIGH" ? "text-emerald-400" : "text-yellow-400")}>
            {asset.matchConfidence === "HIGH" ? "High" : "Medium"}
          </span>
        </span>
      </div>

      <div className="flex gap-2 mt-auto">
        {asset.status === "available" && (
          <Button
            size="sm"
            className="flex-1 bg-blue-600 hover:bg-blue-500 text-white gap-1.5"
            onClick={handleAdd}
            disabled={addMutation.isPending}
            data-testid={`btn-add-to-terminal-${cardId}`}
          >
            {addMutation.isPending ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Zap className="w-3 h-3" />
            )}
            {addMutation.isPending ? "Adding…" : "Add to Terminal"}
          </Button>
        )}

        {(asset.status === "already_added" || asset.status === "claim_pending") && asset.linkedAssetId && (
          <Link href={`/player-operator/${asset.linkedAssetId}`} className="flex-1">
            <Button
              size="sm"
              className="w-full bg-emerald-600/20 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-600/30 gap-1.5"
              data-testid={`btn-open-operator-discovered-${cardId}`}
            >
              Open Operator
              <ArrowRight className="w-3 h-3" />
            </Button>
          </Link>
        )}

        {(asset.status === "already_added" || asset.status === "claim_pending") && !asset.linkedAssetId && (
          <Button
            size="sm"
            variant="ghost"
            className="flex-1 text-emerald-400/50 cursor-default"
            disabled
            data-testid={`btn-in-terminal-discovered-${cardId}`}
          >
            <CheckCircle2 className="w-3 h-3 mr-1" />
            In Terminal
          </Button>
        )}

        {asset.status === "unavailable" && (
          <Button
            size="sm"
            variant="ghost"
            className="flex-1 text-white/30 cursor-not-allowed"
            disabled
            data-testid={`btn-unavailable-discovered-${cardId}`}
          >
            Not Available
          </Button>
        )}
      </div>
    </div>
  );
}

// ── Connect Steam prompt (shown when no Steam account linked) ─────────────────

function ConnectSteamPrompt() {
  const { toast } = useToast();

  const onSuccess = useCallback(() => {
    toast({
      title:       "Steam Connected",
      description: "Your Steam identity has been verified. Discovering your player assets…",
    });
    queryClient.invalidateQueries({ queryKey: ["/api/player-hub/discovered-assets"] });
    queryClient.invalidateQueries({ queryKey: ["/api/player-hub/overview"] });
  }, [toast]);

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
    <div
      className="flex flex-col items-center justify-center py-10 px-6 text-center gap-4 bg-white/[0.02] border border-white/10 rounded-xl"
      data-testid="connect-steam-prompt"
    >
      <div className="w-12 h-12 rounded-full bg-[#1b2838]/60 border border-white/10 flex items-center justify-center">
        <SiSteam className="w-6 h-6 text-white/50" />
      </div>

      <div className="space-y-1">
        <p className="text-sm font-semibold text-white">Connect your account to discover your players</p>
        <p className="text-xs text-white/40 max-w-sm">
          Link your Steam account to automatically identify eligible Dota 2 and CS2 player assets.
          No passwords are stored — verification happens via Steam's secure login.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <Badge variant="outline" className="text-[10px] text-white/40 border-white/15">Dota 2</Badge>
        <Badge variant="outline" className="text-[10px] text-white/40 border-white/15">CS2</Badge>
      </div>

      <Button
        data-testid="btn-connect-steam"
        className="gap-2 bg-[#171a21] hover:bg-[#2a475e] text-white border border-white/15 transition-colors"
        onClick={connect}
        disabled={isPending}
      >
        {isPending ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <SiSteam className="w-4 h-4" />
        )}
        {isPending ? "Waiting for Steam…" : "Connect Steam"}
        {!isPending && <ExternalLink className="w-3 h-3 opacity-50" />}
      </Button>
    </div>
  );
}

// ── Steam status bar (shown when connected) ───────────────────────────────────

function SteamStatusBar({
  steamAccountName,
  onRefresh,
}: {
  steamAccountName: string | null;
  onRefresh: () => void;
}) {
  const { toast } = useToast();
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const disconnectMutation = useMutation({
    mutationFn: async () => {
      const summaryRes = await fetch("/api/me/assets/summary", { credentials: "include" });
      if (!summaryRes.ok) throw new Error("Could not fetch accounts");
      const data = await summaryRes.json();
      const steamAccounts: any[] = (data.connectedAccounts ?? []).filter(
        (a: any) => a.providerGroup === "steam",
      );
      for (const account of steamAccounts) {
        await apiRequest("DELETE", `/api/me/connected-accounts/${account.id}`);
      }
    },
    onSuccess: () => {
      setConfirmDisconnect(false);
      toast({ title: "Steam Disconnected", description: "Your Steam account has been unlinked." });
      queryClient.invalidateQueries({ queryKey: ["/api/player-hub/discovered-assets"] });
      queryClient.invalidateQueries({ queryKey: ["/api/me/assets/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/player-hub/overview"] });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to disconnect Steam. Please try again.", variant: "destructive" });
    },
  });

  const onSuccess = useCallback(() => {
    toast({ title: "Steam Re-verified", description: "Your Steam identity has been refreshed." });
    onRefresh();
  }, [toast, onRefresh]);

  const onError = useCallback((err: string) => {
    if (err === "POPUP_BLOCKED") {
      toast({ title: "Popup Blocked", description: "Please allow popups for this site and try again.", variant: "destructive" });
      return;
    }
    toast({ title: "Steam Verification Failed", description: STEAM_ERROR_LABELS[err] ?? `Error: ${err}`, variant: "destructive" });
  }, [toast]);

  const { connect, isPending } = useSteamPopup(onSuccess, onError);

  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.07]">
      <div className="flex items-center gap-2 min-w-0">
        <SiSteam className="w-3.5 h-3.5 text-white/40 shrink-0" />
        <span className="text-xs text-white/60 truncate">
          {steamAccountName ?? "Steam Connected"}
        </span>
        <Badge className="bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-[10px] gap-1 shrink-0">
          <ShieldCheck className="w-2.5 h-2.5" />
          Verified
        </Badge>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <button
          data-testid="btn-reverify-steam"
          onClick={connect}
          disabled={isPending || disconnectMutation.isPending}
          className="text-[11px] text-white/25 hover:text-white/50 transition-colors disabled:opacity-40"
        >
          {isPending ? <Loader2 className="w-3 h-3 animate-spin inline" /> : "Re-verify ↗"}
        </button>

        {!confirmDisconnect ? (
          <button
            data-testid="btn-disconnect-steam"
            onClick={() => setConfirmDisconnect(true)}
            className="text-[11px] text-red-400/40 hover:text-red-400/70 transition-colors flex items-center gap-1"
          >
            <Unlink className="w-2.5 h-2.5" />
            Disconnect
          </button>
        ) : (
          <div className="flex items-center gap-1.5">
            <button
              data-testid="btn-disconnect-steam-cancel"
              onClick={() => setConfirmDisconnect(false)}
              className="text-[11px] text-white/40 hover:text-white/60 transition-colors"
            >
              Cancel
            </button>
            <Button
              data-testid="btn-disconnect-steam-confirm"
              size="sm"
              variant="destructive"
              onClick={() => disconnectMutation.mutate()}
              disabled={disconnectMutation.isPending}
              className="h-5 px-2 text-[11px]"
            >
              {disconnectMutation.isPending ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : "Disconnect"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── No assets found state ─────────────────────────────────────────────────────

function NoAssetsFound({ steamAccountName }: { steamAccountName: string | null }) {
  return (
    <div
      className="flex flex-col items-center justify-center py-8 text-center gap-2 bg-white/3 border border-white/10 rounded-xl"
      data-testid="discovered-no-assets"
    >
      <Sparkles className="w-8 h-8 text-white/20" />
      <p className="text-sm font-medium text-white/50">No assets discovered yet</p>
      <p className="text-xs text-white/30 max-w-xs">
        {steamAccountName
          ? `No player assets were found for "${steamAccountName}". Your account may not be in the GamerStock database yet.`
          : "No matching player assets found for your Steam account."}
      </p>
      <p className="text-xs text-white/20 mt-1">Use the request form below to add your asset manually.</p>
    </div>
  );
}

// ── Section ───────────────────────────────────────────────────────────────────

export function DiscoveredAssetsSection() {
  const { data, isLoading, isError, refetch } = useDiscoveredAssets();

  const handleRefresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["/api/player-hub/discovered-assets"] });
    queryClient.invalidateQueries({ queryKey: ["/api/player-hub/overview"] });
    refetch();
  }, [refetch]);

  const sectionTitle = (
    <div className="flex items-center justify-between">
      <h2 className="text-sm font-semibold text-white/80 uppercase tracking-wider flex items-center gap-2">
        <Sparkles className="w-3.5 h-3.5 text-blue-400" />
        Discovered Assets
      </h2>
    </div>
  );

  if (isLoading) {
    return (
      <section className="space-y-3" data-testid="discovered-assets-loading">
        {sectionTitle}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[1, 2].map((i) => (
            <div key={i} className="h-40 bg-white/5 rounded-xl animate-pulse" />
          ))}
        </div>
      </section>
    );
  }

  if (isError) {
    return (
      <section className="space-y-3" data-testid="discovered-assets-error">
        {sectionTitle}
        <div className="flex items-center gap-2 text-sm text-red-400/70 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>Failed to load discovered assets. Try refreshing the page.</span>
        </div>
      </section>
    );
  }

  if (!data) return null;

  return (
    <section className="space-y-3" data-testid="discovered-assets-section">
      {sectionTitle}

      {!data.hasSteamAccount ? (
        <ConnectSteamPrompt />
      ) : (
        <div className="space-y-4">
          <SteamStatusBar
            steamAccountName={data.steamAccountName}
            onRefresh={handleRefresh}
          />

          {data.discoveredAssets.length === 0 ? (
            <NoAssetsFound steamAccountName={data.steamAccountName} />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4" data-testid="discovered-assets-grid">
              {data.discoveredAssets.map((asset) => (
                <DiscoveredAssetCard key={`${asset.gameId}-${asset.assetId ?? asset.assetUid}`} asset={asset} />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
