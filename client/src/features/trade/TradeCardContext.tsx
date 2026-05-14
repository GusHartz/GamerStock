import { createContext, useContext, useState, useRef, ReactNode } from "react";
import { TradeIntent, TradeSheetState } from "./types";
import { isPredictEnabled } from "@/lib/featureFlags";

const TradeCardContext = createContext<TradeSheetState | null>(null);

const CLOSE_DELAY_MS = 320; // matches CSS transition duration

export function TradeCardProvider({ children }: { children: ReactNode }) {
  const [intent, setIntent] = useState<TradeIntent | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const open = (next: TradeIntent) => {
    // Layer 1 — fail-closed: prediction intents are silently dropped when Predict
    // is disabled. This prevents any component (including orphaned ones) from
    // triggering the prediction trade flow when the feature flag is off.
    if (next.type === "prediction" && !isPredictEnabled()) return;
    // Cancel any pending intent clear
    if (clearTimer.current) clearTimeout(clearTimer.current);
    setIntent(next);
    setIsOpen(true);
  };

  const close = () => {
    setIsOpen(false);
    // Clear intent after slide-out animation completes
    clearTimer.current = setTimeout(() => {
      setIntent(null);
    }, CLOSE_DELAY_MS);
  };

  return (
    <TradeCardContext.Provider value={{ intent, isOpen, open, close }}>
      {children}
    </TradeCardContext.Provider>
  );
}

export function useTradeCard(): TradeSheetState {
  const ctx = useContext(TradeCardContext);
  if (!ctx) throw new Error("useTradeCard must be used within TradeCardProvider");
  return ctx;
}
