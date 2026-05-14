// ─── ProcessingStep ───────────────────────────────────────────────────────────
// Step 3: blocks interaction while the trade is being executed.
// ─────────────────────────────────────────────────────────────────────────────
import { Loader2 } from "lucide-react";

export function ProcessingStep() {
  return (
    <div className="flex flex-col items-center justify-center gap-5 py-10" data-testid="buy-step-processing">
      <div className="relative">
        <div className="w-16 h-16 rounded-full border-2 border-blue-500/20 flex items-center justify-center">
          <Loader2 className="w-8 h-8 text-blue-400 animate-spin" />
        </div>
        <div className="absolute inset-0 rounded-full border border-blue-500/10 animate-ping" />
      </div>
      <div className="text-center space-y-1">
        <p className="text-base font-semibold text-white">Processing trade</p>
        <p className="text-sm text-white/40">Settling your position — please wait.</p>
      </div>
    </div>
  );
}
