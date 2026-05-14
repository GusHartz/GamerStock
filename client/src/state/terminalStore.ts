import { createContext, useContext, useReducer, type Dispatch } from "react";

export type MarketRow = {
  id: number;
  assetUid: string;
  displayName: string;
  lastTradePrice: string;
  price24hAgo: string;
  volume24h: string;
  momentum: string;
  bidPrice: string;
  askPrice: string;
  spreadPct: string;
  market: { provider: string; game: string; region: string; scope: string };
};

export type ScannerTab = "all" | "gainers" | "losers" | "trending" | "watchlist";
export type ActivityTab = "recent" | "mine";
export type MobileTab = "scanner" | "chart" | "trade" | "orders" | "activity";
export type ChartTab = "chart" | "fundamentals";
export type DisplayCurrency = "GS" | "USDC";
export type GameFilter = "all" | "dota2" | "cs2";

export interface TerminalState {
  selectedAsset: MarketRow | null;
  side: "BUY" | "SELL";
  ticketFocused: boolean;
  scannerTab: ScannerTab;
  activityTab: ActivityTab;
  mobileTab: MobileTab;
  search: string;
  chartTab: ChartTab;
  displayCurrency: DisplayCurrency;
  gameFilter: GameFilter;
  tradeModalOpen: boolean;
}

export type TerminalAction =
  | { type: "SELECT_ASSET"; asset: MarketRow }
  | { type: "SET_SIDE"; side: "BUY" | "SELL" }
  | { type: "OPEN_TICKET"; side?: "BUY" | "SELL" }
  | { type: "SET_SCANNER_TAB"; tab: ScannerTab }
  | { type: "SET_ACTIVITY_TAB"; tab: ActivityTab }
  | { type: "SET_MOBILE_TAB"; tab: MobileTab }
  | { type: "SET_SEARCH"; search: string }
  | { type: "SET_CHART_TAB"; tab: ChartTab }
  | { type: "SET_DISPLAY_CURRENCY"; currency: DisplayCurrency }
  | { type: "SET_GAME_FILTER"; gameFilter: GameFilter }
  | { type: "PATCH_ASSET"; assetId: number; data: Partial<MarketRow> }
  | { type: "OPEN_TRADE_MODAL"; side?: "BUY" | "SELL" }
  | { type: "CLOSE_TRADE_MODAL" };

const initialState: TerminalState = {
  selectedAsset: null,
  side: "BUY",
  ticketFocused: false,
  scannerTab: "all",
  activityTab: "recent",
  mobileTab: "scanner",
  search: "",
  chartTab: "chart",
  displayCurrency: "GS",
  gameFilter: "all",
  tradeModalOpen: false,
};

function reducer(state: TerminalState, action: TerminalAction): TerminalState {
  switch (action.type) {
    case "SELECT_ASSET":
      return { ...state, selectedAsset: action.asset };
    case "SET_SIDE":
      return { ...state, side: action.side };
    case "OPEN_TICKET":
      return { ...state, side: action.side ?? state.side, ticketFocused: true, mobileTab: "trade" };
    case "SET_SCANNER_TAB":
      return { ...state, scannerTab: action.tab };
    case "SET_ACTIVITY_TAB":
      return { ...state, activityTab: action.tab };
    case "SET_MOBILE_TAB":
      return { ...state, mobileTab: action.tab };
    case "SET_SEARCH":
      return { ...state, search: action.search };
    case "SET_CHART_TAB":
      return { ...state, chartTab: action.tab };
    case "SET_DISPLAY_CURRENCY":
      return { ...state, displayCurrency: action.currency };
    case "SET_GAME_FILTER":
      return { ...state, gameFilter: action.gameFilter, selectedAsset: null };
    case "PATCH_ASSET": {
      const selected = state.selectedAsset?.id === action.assetId
        ? { ...state.selectedAsset, ...action.data }
        : state.selectedAsset;
      return { ...state, selectedAsset: selected };
    }
    case "OPEN_TRADE_MODAL":
      return { ...state, tradeModalOpen: true, side: action.side ?? state.side };
    case "CLOSE_TRADE_MODAL":
      return { ...state, tradeModalOpen: false };
    default:
      return state;
  }
}

const TerminalContext = createContext<{
  state: TerminalState;
  dispatch: Dispatch<TerminalAction>;
} | null>(null);

export { TerminalContext, initialState, reducer };

export function useTerminal() {
  const ctx = useContext(TerminalContext);
  if (!ctx) throw new Error("useTerminal must be inside TerminalProvider");
  return ctx;
}
