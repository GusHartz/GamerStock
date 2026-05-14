// ─── ReviewBuyStep ────────────────────────────────────────────────────────────
// Step 2: confirm order summary before execution.
// ─────────────────────────────────────────────────────────────────────────────
import { ChevronLeft, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ReviewBuyStepProps {
  playerName: string;
  gameName:   string;
  shares:     number;
  unitPrice:  number;
  notional:   number;
  fee:        number;
  total:      number;
  tradeError: string | null;
  onConfirm:  () => void;
  onBack:     () => void;
}

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`flex justify-between items-center py-2.5 ${highlight ? "border-t border-white/10 mt-1 pt-3" : ""}`}>
      <span className="text-sm text-white/50">{label}</span>
      <span className={`text-sm font-semibold ${highlight ? "text-white text-base" : "text-white/80"}`}>{value}</span>
    </div>
  );
}

export function ReviewBuyStep({
  playerName, gameName, shares, unitPrice, notional, fee, total,
  tradeError, onConfirm, onBack,
}: ReviewBuyStepProps) {
  return (
    <div className="flex flex-col gap-5" data-testid="buy-step-review">
      {/* Order summary */}
      <div className="bg-white/5 rounded-xl px-4 py-1 divide-y divide-white/5">
        <Row label="Player"   value={playerName} />
        <Row label="Game"     value={gameName} />
        <Row label="Shares"   value={`${shares} share${shares !== 1 ? "s" : ""}`} />
        <Row label="Avg price" value={`${unitPrice.toFixed(4)} GS`} />
        <Row label="Subtotal" value={`${notional.toFixed(2)} GS`} />
        <Row label="Fee"      value={`${fee.toFixed(2)} GS`} />
        <Row label="Total"    value={`${total.toFixed(2)} GS`} highlight />
      </div>

      {/* Trust signal */}
      <div className="flex items-center gap-2 text-xs text-white/30">
        <ShieldCheck className="w-3.5 h-3.5 text-emerald-500/60" />
        <span>Transaction settled instantly in your GS wallet.</span>
      </div>

      {/* Error */}
      {tradeError && (
        <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-2.5"
          data-testid="buy-trade-error">
          {tradeError}
        </p>
      )}

      {/* Actions */}
      <div className="flex gap-3">
        <Button
          variant="outline"
          className="flex-1 border-white/20 text-white/60 hover:text-white gap-1.5"
          onClick={onBack}
          data-testid="buy-back-btn"
        >
          <ChevronLeft className="w-4 h-4" />
          Back
        </Button>
        <Button
          className="flex-[2] bg-blue-600 hover:bg-blue-500 text-white font-semibold h-11"
          onClick={onConfirm}
          data-testid="buy-confirm-btn"
        >
          Confirm — {total.toFixed(2)} GS
        </Button>
      </div>
    </div>
  );
}
