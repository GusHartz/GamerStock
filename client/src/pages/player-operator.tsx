// ─── Asset Operator Page ──────────────────────────────────────────────────────
// MVP for the creator economy operator view.
// Route: /player-operator/:assetId
// Access-gated via the overview query (401 → login, 403 → access denied).
// Each block fetches independently with its own polling cadence.
// ─────────────────────────────────────────────────────────────────────────────
import { useRef } from "react";
import { useParams, Link } from "wouter";
import { Loader2, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useOperatorOverview } from "@/features/player-operator/hooks/use-operator";
import { TopBar } from "@/features/player-operator/components/TopBar";
import { PerformanceSnapshot } from "@/features/player-operator/components/PerformanceSnapshot";
import { ActionCenter } from "@/features/player-operator/components/ActionCenter";
import { MissionControl } from "@/features/player-operator/components/MissionControl";
import { MomentsEngine } from "@/features/player-operator/components/MomentsEngine";
import { LiveActivityFeed } from "@/features/player-operator/components/LiveActivityFeed";
import { CardImageManager } from "@/features/player-operator/components/CardImageManager";

export default function PlayerOperatorPage() {
  const { assetId } = useParams<{ assetId: string }>();
  const numericAssetId = Number(assetId);

  const missionRef = useRef<HTMLElement>(null!);
  const momentsRef = useRef<HTMLElement>(null!);
  const cardRef = useRef<HTMLElement>(null!);

  const { data, isLoading, isError, error } = useOperatorOverview(numericAssetId);

  // ── Invalid asset ID ────────────────────────────────────────────────────────
  if (isNaN(numericAssetId) || numericAssetId <= 0) {
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-4 text-muted-foreground">
        <ShieldAlert className="w-10 h-10" />
        <p>Invalid asset ID.</p>
        <Link href="/player-hub">
          <Button variant="outline" size="sm" data-testid="btn-back-hub">Back to Hub</Button>
        </Link>
      </div>
    );
  }

  // ── Loading ─────────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-32 gap-3 text-muted-foreground" data-testid="operator-loading">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span>Loading operator dashboard…</span>
      </div>
    );
  }

  // ── Error — 401 / 403 / other ───────────────────────────────────────────────
  if (isError || !data) {
    const status = (error as any)?.status;
    const is401 = status === 401;
    const is403 = status === 403;

    return (
      <div
        className="flex flex-col items-center justify-center py-32 gap-4 text-muted-foreground px-4"
        data-testid="operator-error"
      >
        <ShieldAlert className="w-12 h-12 text-destructive" />
        <p className="font-semibold text-foreground text-center text-lg">
          {is403
            ? "Operator access required"
            : is401
            ? "Sign in to continue"
            : "Failed to load dashboard"}
        </p>
        <p className="text-sm text-center max-w-xs text-white/50">
          {is403
            ? "You need an approved claim for this asset to enter Operator Mode. Submit a claim from the Player Hub."
            : is401
            ? "Your session has expired. Please sign in again."
            : (error as Error)?.message}
        </p>
        <div className="flex gap-3">
          <Link href="/player-hub">
            <Button variant="outline" size="sm" data-testid="btn-back-hub-error">
              Back to Hub
            </Button>
          </Link>
          {is401 && (
            <Link href="/login">
              <Button size="sm">Sign In</Button>
            </Link>
          )}
        </div>
      </div>
    );
  }

  // ── Scroll helpers ──────────────────────────────────────────────────────────
  function scrollToMission() {
    missionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function scrollToMoments() {
    momentsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function scrollToCard() {
    cardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ── Page ────────────────────────────────────────────────────────────────────
  return (
    <div className="bg-background text-foreground">
      <div className="max-w-4xl mx-auto px-4 py-6 space-y-7">

        {/* A — Top Bar */}
        <TopBar
          player={data.player}
          assetId={numericAssetId}
          onCreateMission={scrollToMission}
          onCreateMoment={scrollToMoments}
          onEditCard={scrollToCard}
        />

        {/* B — Performance Snapshot (15s polling) */}
        <PerformanceSnapshot assetId={numericAssetId} />

        {/* C — Action Center (30s polling) */}
        <ActionCenter assetId={numericAssetId} />

        {/* D — Mission Control */}
        <MissionControl ref={missionRef} assetId={numericAssetId} />

        {/* E — Moments Engine */}
        <MomentsEngine ref={momentsRef} assetId={numericAssetId} />

        {/* F — Live Activity Feed (10s polling) */}
        <LiveActivityFeed assetId={numericAssetId} />

        {/* F — Card Image Management */}
        <CardImageManager ref={cardRef} assetId={numericAssetId} />

      </div>
    </div>
  );
}
