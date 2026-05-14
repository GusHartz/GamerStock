// ─── BuyFlowModal ─────────────────────────────────────────────────────────────
// Multi-step buy flow modal. Orchestrates 4 steps: quick-buy → review →
// processing → success. Handles auth gate, quote caching, and post-trade refetch.
// Designed to be reusable for both "support" (asset buy) and future "moment" flows.
// ─────────────────────────────────────────────────────────────────────────────
import { useState } from "react";
import { X, LogIn } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { QuickBuyStep } from "./steps/QuickBuyStep";
import { ReviewBuyStep } from "./steps/ReviewBuyStep";
import { ProcessingStep } from "./steps/ProcessingStep";
import { SuccessStep } from "./steps/SuccessStep";

// ── Public contract ───────────────────────────────────────────────────────────

/** Context passed from the caller to describe what is being purchased. */
export interface BuyFlowContext {
  mode:       "support" | "moment";
  assetId:    number;
  playerName: string;
  gameName:   string;
  momentId?:  string;
  title?:     string;
  /** Unit price fallback (lastTradePrice) when AMM quote is unavailable. */
  priceHint:  number;
}

export interface BuyFlowModalProps {
  context:          BuyFlowContext;
  isOpen:           boolean;
  onClose:          () => void;
  /** Called after a successful trade so the parent can refetch overview data. */
  onSuccessRefetch?: () => void;
}

// ── Types ─────────────────────────────────────────────────────────────────────

type Step = "auth-required" | "quick-buy" | "review" | "processing" | "success";

interface QuoteSnapshot {
  ammEnabled: boolean;
  avgPrice?:  string;
  notional?:  string;
  feeAmount?: string;
}

interface TradeResult {
  tradeId?:        number;
  executionPrice?: number;
  grossValue?:     number;
  fee?:            number;
}

// ── Helper ────────────────────────────────────────────────────────────────────

function deriveNumbers(
  shares:    number,
  priceHint: number,
  quote:     QuoteSnapshot | null,
) {
  const ammOk    = quote?.ammEnabled === true;
  const notional = ammOk ? Number(quote?.notional ?? 0) : shares * priceHint;
  const fee      = ammOk ? Number(quote?.feeAmount ?? 0) : notional * 0.02;
  const total    = notional + fee;
  const unitPrice = ammOk ? Number(quote?.avgPrice ?? priceHint) : priceHint;
  return { notional, fee, total, unitPrice };
}

// ── Auth-Required step ────────────────────────────────────────────────────────

function AuthRequiredStep({ playerName }: { playerName: string }) {
  return (
    <div className="flex flex-col items-center gap-6 py-6 text-center" data-testid="buy-step-auth">
      <div className="w-14 h-14 rounded-full bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
        <LogIn className="w-6 h-6 text-blue-400" />
      </div>
      <div className="space-y-1.5">
        <p className="text-lg font-bold text-white">Sign in to support</p>
        <p className="text-sm text-white/50 max-w-xs">
          Create a free account or log in to back {playerName} and hold their asset.
        </p>
      </div>
      <div className="flex gap-3 w-full">
        <Link href="/login" className="flex-1">
          <Button
            className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold h-11"
            data-testid="auth-login-btn"
          >
            Sign In
          </Button>
        </Link>
        <Link href="/signup" className="flex-1">
          <Button
            variant="outline"
            className="w-full border-white/20 text-white/70 hover:text-white font-semibold h-11"
            data-testid="auth-signup-btn"
          >
            Sign Up
          </Button>
        </Link>
      </div>
    </div>
  );
}

// ── Modal ─────────────────────────────────────────────────────────────────────

export function BuyFlowModal({ context, isOpen, onClose, onSuccessRefetch }: BuyFlowModalProps) {
  const { isAuthenticated } = useAuth();
  const queryClient = useQueryClient();

  const [step, setStep]           = useState<Step>("quick-buy");
  const [shares, setShares]       = useState(1);
  const [quote, setQuote]         = useState<QuoteSnapshot | null>(null);
  const [tradeResult, setTradeResult] = useState<TradeResult | null>(null);
  const [tradeError, setTradeError]   = useState<string | null>(null);

  const { notional, fee, total, unitPrice } = deriveNumbers(shares, context.priceHint, quote);

  // ── Trade mutation ──────────────────────────────────────────────────────────
  const tradeMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/market/assets/${context.assetId}/trade`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ type: "BUY", shares }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message ?? "Trade failed");
      return body as TradeResult;
    },
    onSuccess: (result) => {
      setTradeResult(result);
      setStep("success");
      // Refetch the public overview
      queryClient.invalidateQueries({ queryKey: ["/api/player-public", String(context.assetId), "overview"] });
      onSuccessRefetch?.();
    },
    onError: (err: Error) => {
      setTradeError(err.message);
      setStep("review");
    },
  });

  // ── Derived current step accounting for auth ────────────────────────────────
  const effectiveStep: Step = !isAuthenticated && step !== "success" ? "auth-required" : step;

  // ── Handlers ────────────────────────────────────────────────────────────────

  function handleClose() {
    if (step === "processing") return; // block close during in-flight
    // Reset state for next open
    setStep("quick-buy");
    setShares(1);
    setQuote(null);
    setTradeResult(null);
    setTradeError(null);
    onClose();
  }

  function handleContinue() {
    setTradeError(null);
    setStep("review");
  }

  function handleConfirm() {
    setStep("processing");
    tradeMutation.mutate();
  }

  // ── Title map ────────────────────────────────────────────────────────────────

  const TITLES: Record<Step, string> = {
    "auth-required": "Sign in",
    "quick-buy":     "Support Player",
    "review":        "Review Order",
    "processing":    "Processing",
    "success":       "Trade Complete",
  };

  const preventClose = step === "processing";

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) handleClose(); }}>
      <DialogContent
        className="bg-[#0f1117] border-white/10 text-white max-w-sm w-full rounded-2xl p-0 overflow-hidden"
        onPointerDownOutside={preventClose ? (e) => e.preventDefault() : undefined}
        onEscapeKeyDown={preventClose ? (e) => e.preventDefault() : undefined}
        data-testid="buy-flow-modal"
      >
        {/* Header */}
        <DialogHeader className="flex flex-row items-center justify-between px-6 pt-6 pb-0">
          <DialogTitle className="text-base font-semibold text-white">
            {TITLES[effectiveStep]}
          </DialogTitle>
          {!preventClose && (
            <button
              onClick={handleClose}
              className="text-white/30 hover:text-white/70 transition-colors"
              aria-label="Close"
              data-testid="buy-modal-close"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </DialogHeader>

        {/* Body */}
        <div className="px-6 pb-6 pt-5">
          {effectiveStep === "auth-required" && (
            <AuthRequiredStep playerName={context.playerName} />
          )}

          {effectiveStep === "quick-buy" && (
            <QuickBuyStep
              assetId={context.assetId}
              playerName={context.playerName}
              gameName={context.gameName}
              shares={shares}
              priceHint={context.priceHint}
              onSharesChange={setShares}
              onQuoteReady={setQuote}
              onContinue={handleContinue}
            />
          )}

          {effectiveStep === "review" && (
            <ReviewBuyStep
              playerName={context.playerName}
              gameName={context.gameName}
              shares={shares}
              unitPrice={unitPrice}
              notional={notional}
              fee={fee}
              total={total}
              tradeError={tradeError}
              onConfirm={handleConfirm}
              onBack={() => setStep("quick-buy")}
            />
          )}

          {effectiveStep === "processing" && <ProcessingStep />}

          {effectiveStep === "success" && (
            <SuccessStep
              playerName={context.playerName}
              shares={shares}
              total={tradeResult?.grossValue !== undefined
                ? (tradeResult.grossValue + (tradeResult.fee ?? 0))
                : total}
              executionPrice={tradeResult?.executionPrice}
              onClose={handleClose}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
