/**
 * Prediction market trade intent — opens the side bet sheet.
 * sideId = outcomeId in the DB (matches /api/predictions/trades endpoint).
 */
export interface PredictionTradeIntent {
  type: "prediction";
  marketId:  number;
  sideId:    number;
  sideLabel: string;
  /** Price string like "0.62" — used to estimate shares for display only */
  price:     string;
  action:    "BUY" | "SELL";
  /** Market question — shown for context */
  question:  string;
  /** "cyan" = side A / YES team, "rose" = side B / NO team */
  sideColor?: "cyan" | "rose";
}

/**
 * Asset (player stock) trade intent — opens the market buy/sell sheet.
 * assetId = full assetUid e.g. "dota2:dota2:player:12345".
 */
export interface AssetTradeIntent {
  type:        "asset";
  assetId:     string;
  displayName: string;
  price:       number;
  initialSide?: "BUY" | "SELL";
}

/** Discriminated union covering all trade entry-points */
export type TradeIntent = PredictionTradeIntent | AssetTradeIntent;

export interface TradeSheetState {
  intent:  TradeIntent | null;
  isOpen:  boolean;
  open:    (intent: TradeIntent) => void;
  close:   () => void;
}
