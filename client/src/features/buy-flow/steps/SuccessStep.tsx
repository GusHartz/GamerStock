// ─── SuccessStep ──────────────────────────────────────────────────────────────
// Step 4: emotionally positive confirmation of a completed trade.
// ─────────────────────────────────────────────────────────────────────────────
import { CheckCircle2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";

interface SuccessStepProps {
  playerName:      string;
  shares:          number;
  total:           number;
  executionPrice?: number;
  onClose:         () => void;
}

export function SuccessStep({ playerName, shares, total, executionPrice, onClose }: SuccessStepProps) {
  return (
    <div className="flex flex-col items-center gap-6 py-4 text-center" data-testid="buy-step-success">
      {/* Icon */}
      <div className="w-16 h-16 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
        <CheckCircle2 className="w-8 h-8 text-emerald-400" />
      </div>

      {/* Headline */}
      <div className="space-y-1">
        <p className="text-xl font-bold text-white">You're a supporter!</p>
        <p className="text-sm text-white/50">
          You now hold{" "}
          <span className="text-white font-semibold">{shares} share{shares !== 1 ? "s" : ""}</span>{" "}
          of {playerName}.
        </p>
      </div>

      {/* Summary pill */}
      <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-5 py-3 w-full">
        <p className="text-xs text-emerald-400/60 uppercase tracking-wider mb-1">Settled</p>
        <p className="text-2xl font-bold text-emerald-300" data-testid="success-total">
          {total.toFixed(2)} <span className="text-base font-normal text-emerald-400/60">GS</span>
        </p>
        {executionPrice !== undefined && (
          <p className="text-xs text-emerald-400/40 mt-0.5">
            @ {executionPrice.toFixed(4)} GS per share
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-2.5 w-full">
        <Button
          className="w-full h-11 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold"
          onClick={onClose}
          data-testid="success-close-btn"
        >
          Done
        </Button>
        <Link href="/portfolio">
          <Button
            variant="ghost"
            className="w-full text-white/40 hover:text-white/70 text-sm gap-1.5"
            onClick={onClose}
            data-testid="success-portfolio-btn"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            View in Portfolio
          </Button>
        </Link>
      </div>
    </div>
  );
}
