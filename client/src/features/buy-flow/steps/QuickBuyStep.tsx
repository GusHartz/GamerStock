// ─── QuickBuyStep ─────────────────────────────────────────────────────────────
// Step 1: quantity picker with live quote estimate.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect } from "react";
import { Minus, Plus, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";

interface QuoteData {
  ammEnabled: boolean;
  avgPrice?: string;
  notional?: string;
  feeAmount?: string;
  currentSpot?: string;
}

interface QuickBuyStepProps {
  assetId:    number;
  playerName: string;
  gameName:   string;
  shares:     number;
  priceHint:  number;
  onSharesChange: (n: number) => void;
  onQuoteReady:   (q: QuoteData) => void;
  onContinue:     () => void;
}

export function QuickBuyStep({
  assetId, playerName, gameName, shares, priceHint,
  onSharesChange, onQuoteReady, onContinue,
}: QuickBuyStepProps) {
  const { data: quote, isLoading, isError } = useQuery<QuoteData>({
    queryKey: ["/api/market", assetId, "quote", "BUY", shares],
    queryFn: async () => {
      const res = await fetch(
        `/api/market/assets/${assetId}/quote?type=BUY&shares=${shares}`,
        { credentials: "include" },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? "Quote unavailable");
      }
      return res.json();
    },
    staleTime: 8_000,
  });

  // Notify parent of quote so ReviewStep can reuse it
  useEffect(() => {
    if (quote) onQuoteReady(quote);
  }, [quote]);

  // Derive display values
  const ammOk    = quote?.ammEnabled === true;
  const notional = ammOk ? Number(quote?.notional ?? 0) : shares * priceHint;
  const fee      = ammOk ? Number(quote?.feeAmount ?? 0) : notional * 0.02;
  const total    = notional + fee;
  const unitPrice = ammOk ? Number(quote?.avgPrice ?? priceHint) : priceHint;

  return (
    <div className="flex flex-col gap-6" data-testid="buy-step-quick">
      {/* Asset context */}
      <div className="flex items-center gap-3 pb-2 border-b border-white/10">
        <div className="flex-1">
          <p className="text-xs text-white/40 uppercase tracking-wider">{gameName}</p>
          <p className="text-xl font-bold text-white leading-tight">{playerName}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-white/40">Unit price</p>
          <p className="text-base font-semibold text-white">
            {isLoading ? "—" : `${unitPrice.toFixed(2)} GS`}
          </p>
        </div>
      </div>

      {/* Quantity picker */}
      <div className="space-y-2">
        <p className="text-xs text-white/50 uppercase tracking-wider">Shares</p>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="icon"
            className="border-white/20 text-white h-10 w-10"
            onClick={() => onSharesChange(Math.max(1, shares - 1))}
            disabled={shares <= 1}
            data-testid="buy-qty-minus"
          >
            <Minus className="w-4 h-4" />
          </Button>
          <span
            className="text-3xl font-bold text-white w-12 text-center tabular-nums"
            data-testid="buy-qty-display"
          >
            {shares}
          </span>
          <Button
            variant="outline"
            size="icon"
            className="border-white/20 text-white h-10 w-10"
            onClick={() => onSharesChange(shares + 1)}
            data-testid="buy-qty-plus"
          >
            <Plus className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Cost estimate */}
      <div className="bg-white/5 rounded-xl p-4 space-y-2.5">
        {isLoading ? (
          <div className="flex items-center gap-2 text-white/40 text-sm">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Calculating...</span>
          </div>
        ) : isError ? (
          <div className="flex items-center gap-2 text-amber-400/80 text-sm">
            <AlertCircle className="w-4 h-4" />
            <span>Live quote unavailable — estimate shown</span>
          </div>
        ) : null}

        <div className="flex justify-between text-sm">
          <span className="text-white/50">Subtotal</span>
          <span className="text-white/80">{notional.toFixed(2)} GS</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-white/50">Fee (~2%)</span>
          <span className="text-white/50">{fee.toFixed(2)} GS</span>
        </div>
        <div className="border-t border-white/10 pt-2 flex justify-between font-semibold">
          <span className="text-white/70">Total est.</span>
          <span className="text-white" data-testid="buy-total-estimate">{total.toFixed(2)} GS</span>
        </div>
      </div>

      <Button
        className="w-full bg-blue-600 hover:bg-blue-500 text-white h-11 font-semibold"
        onClick={onContinue}
        disabled={isLoading}
        data-testid="buy-continue-btn"
      >
        {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Review Order"}
      </Button>
    </div>
  );
}
