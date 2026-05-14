import { useTradeCard } from "./TradeCardContext";
import { abbreviateTeam } from "@/utils/abbreviateTeam";

export interface MarketSideTradeButtonProps {
  marketId:  number;
  question:  string;
  sideId:    number;
  sideLabel: string;
  price:     number | null;
  colorClass?: "yes" | "no";
}

/**
 * Inline trade button rendered inside prediction cards.
 * Clicking opens the GlobalTradePanel WITHOUT navigating to the detail page.
 */
export function MarketSideTradeButton({
  marketId,
  question,
  sideId,
  sideLabel,
  price,
  colorClass = "yes",
}: MarketSideTradeButtonProps) {
  const { open } = useTradeCard();

  const abbrev     = abbreviateTeam(sideLabel) || sideLabel.slice(0, 3).toUpperCase();
  const priceStr   = price != null ? `${(price * 100).toFixed(0)}¢` : "—";
  const priceNum   = price != null ? String(price) : "0";

  const isYes      = colorClass === "yes";
  const borderCls  = isYes
    ? "border-cyan-700/45 bg-cyan-950/50 text-cyan-300 hover:bg-cyan-900/60 hover:border-cyan-600/60"
    : "border-rose-800/45 bg-rose-950/50 text-rose-400 hover:bg-rose-900/60 hover:border-rose-700/60";

  function handleClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    open({
      type:      "prediction",
      marketId,
      sideId,
      sideLabel,
      price:     priceNum,
      action:    "BUY",
      question,
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      data-testid={`side-btn-${marketId}-${sideId}`}
      className={`
        inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border
        text-[11px] font-mono font-bold transition-all duration-150
        active:scale-[0.96] cursor-pointer select-none
        ${borderCls}
      `}
      title={`Buy ${sideLabel}`}
    >
      <span>{abbrev}</span>
      <span className="opacity-70">{priceStr}</span>
    </button>
  );
}
