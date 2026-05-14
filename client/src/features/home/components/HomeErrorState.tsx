import { AlertTriangle, RefreshCw } from "lucide-react";

interface HomeErrorStateProps {
  message?: string;
  onRetry?: () => void;
}

export function HomeErrorState({ message, onRetry }: HomeErrorStateProps) {
  return (
    <div
      data-testid="home-error-state"
      className="flex flex-col items-center justify-center gap-4 py-24 text-center"
    >
      <div className="w-12 h-12 rounded-full bg-rose-500/10 border border-rose-500/20 flex items-center justify-center">
        <AlertTriangle className="w-5 h-5 text-rose-400" />
      </div>
      <div>
        <p className="text-sm font-medium text-white mb-1">Failed to load market data</p>
        <p className="text-xs text-muted-foreground max-w-xs">
          {message ?? "The prediction markets feed could not be loaded. Please try again."}
        </p>
      </div>
      {onRetry && (
        <button
          data-testid="button-retry-home"
          onClick={onRetry}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/[0.06] border border-white/[0.08] text-sm text-white hover:bg-white/[0.10] transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          Retry
        </button>
      )}
    </div>
  );
}
