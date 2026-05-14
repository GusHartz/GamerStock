import { useState, useEffect, useCallback } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { X, ShoppingCart, Zap, RefreshCw, ChevronRight } from "lucide-react";
import { useTerminal } from "@/state/terminalStore";
import { usePortfolio } from "@/hooks/use-portfolio";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { formatCurrency } from "@/lib/format";

// ─── Types (mirrored from terminal.tsx) ──────────────────────────────────────

type AmmQuote = {
  ammEnabled: boolean;
  assetId?: number;
  type?: string;
  shares?: number;
  currentSpot?: string;
  avgPrice?: string;
  notional?: string;
  feeAmount?: string;
  feeBps?: number;
  priceImpactPct?: string;
  newSpot?: string;
  supply?: string;
  error?: string;
  message?: string;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getAssetGameLabel(assetUid: string | undefined | null): string {
  if (!assetUid) return "";
  const parts = assetUid.split(":");
  const game = parts[1] ?? "unknown";
  const labels: Record<string, string> = {
    lol: "LoL",
    dota2: "Dota 2",
    cs2: "CS2",
    valorant: "Valorant",
  };
  return labels[game] ?? game.toUpperCase();
}

// ─── TerminalTradeModal ───────────────────────────────────────────────────────

export function TerminalTradeModal() {
  const { state, dispatch } = useTerminal();
  const open = state.tradeModalOpen;
  const asset = state.selectedAsset;
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: portfolio } = usePortfolio();

  const [qty, setQty] = useState("1");
  const [orderMode, setOrderMode] = useState<"MARKET" | "LIMIT">("MARKET");
  const [triggerPrice, setTriggerPrice] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [tradeSuccess, setTradeSuccess] = useState(false);

  const close = useCallback(() => dispatch({ type: "CLOSE_TRADE_MODAL" }), [dispatch]);

  // Reset form when modal closes or asset changes
  useEffect(() => {
    if (!open) {
      setQty("1");
      setOrderMode("MARKET");
      setTriggerPrice("");
      setDetailsOpen(false);
      setTradeSuccess(false);
    }
  }, [open, asset?.id]);

  // ESC to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, close]);

  // Prevent body scroll while open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  const parsedQty = Math.max(0, parseInt(qty, 10) || 0);
  const parsedTriggerPrice = parseFloat(triggerPrice.replace(",", ".")) || 0;
  const priceInvalid = triggerPrice !== "" && parsedTriggerPrice === 0;
  const isBuy = state.side === "BUY";
  const isMarket = orderMode === "MARKET";

  // ── Mutations ────────────────────────────────────────────────────────────

  const tradeMutation = useMutation({
    mutationFn: async (body: { type: "BUY" | "SELL"; shares: number }) =>
      apiRequest("POST", `/api/market/assets/${asset!.id}/trade`, body),
    onSuccess: () => {
      setTradeSuccess(true);
      setTimeout(() => setTradeSuccess(false), 1800);
      toast({ title: "Trade executed", description: `${state.side} order filled` });
      setQty("1");
      qc.invalidateQueries({ queryKey: ["/api/market/assets"], exact: false });
      qc.invalidateQueries({ queryKey: ["/api/portfolio"] });
      qc.invalidateQueries({ queryKey: ["/api/market/trades/recent"] });
      qc.invalidateQueries({ queryKey: ["/api/terminal/activity/me"] });
      if (asset) qc.invalidateQueries({ queryKey: ["/api/market/assets", asset.id, "snapshots"] });
    },
    onError: (err: any) => {
      const raw = err?.message ?? "Unknown error";
      const m = raw.match(/\{"message":"([^"]+)"\}/);
      toast({ title: "Trade failed", description: m ? m[1] : raw, variant: "destructive" });
    },
  });

  const orderMutation = useMutation({
    mutationFn: async (body: Record<string, any>) => apiRequest("POST", "/api/orders", body),
    onSuccess: () => {
      toast({ title: "Order placed", description: `Limit ${state.side} order created` });
      setQty("1");
      setTriggerPrice("");
      qc.invalidateQueries({ queryKey: ["/api/orders/me"] });
    },
    onError: (err: any) => {
      const raw = err?.message ?? "Unknown error";
      const m = raw.match(/\{"message":"([^"]+)"\}/);
      toast({ title: "Order failed", description: m ? m[1] : raw, variant: "destructive" });
    },
  });

  // ── Quote ────────────────────────────────────────────────────────────────

  const { data: quote, isLoading: quoteLoading } = useQuery<AmmQuote>({
    queryKey: ["/api/market/assets", asset?.id, "quote-modal", state.side, parsedQty],
    queryFn: async () => {
      if (!asset?.id || parsedQty < 1) return { ammEnabled: false };
      const params = new URLSearchParams({ type: state.side, shares: String(parsedQty) });
      const res = await fetch(`/api/market/assets/${asset.id}/quote?${params}`, { credentials: "include" });
      if (!res.ok) return { ammEnabled: false };
      return res.json();
    },
    enabled: open && !!asset && parsedQty >= 1,
    staleTime: 1000,
    refetchInterval: open ? 3000 : false,
  });

  // ── Derived values ───────────────────────────────────────────────────────

  const execPrice = isBuy
    ? parseFloat(asset?.askPrice ?? asset?.lastTradePrice ?? "0")
    : parseFloat(asset?.bidPrice ?? asset?.lastTradePrice ?? "0");

  const ammNotional = quote?.ammEnabled && quote?.notional ? parseFloat(quote.notional) : null;
  const ammFee = quote?.ammEnabled && quote?.feeAmount ? parseFloat(quote.feeAmount) : null;
  const ammImpact = quote?.ammEnabled && quote?.priceImpactPct ? parseFloat(quote.priceImpactPct) : null;
  const ammAvgPrice = quote?.ammEnabled && quote?.avgPrice ? parseFloat(quote.avgPrice) : null;

  const gross = ammNotional ?? parsedQty * execPrice;
  const fee = ammFee ?? gross * 0.02;
  const total = isBuy ? gross + fee : gross - fee;
  const balance = parseFloat(portfolio?.portfolio?.balance ?? "0");

  const canonicalPosition = portfolio?.positions?.find(
    (p: any) => p.source === "CANONICAL" && p.assetId === asset?.id
  );
  const sharesOwned = canonicalPosition?.shares ?? 0;

  const canTrade = asset && parsedQty > 0 && (isBuy ? balance >= total : sharesOwned >= parsedQty);
  const canPlaceOrder = asset && parsedQty > 0 && parsedTriggerPrice > 0;

  const maxQty = isBuy
    ? execPrice > 0 ? Math.floor(balance / (execPrice * 1.02)) : 0
    : sharesOwned;

  const adjustQty = (delta: number) =>
    setQty((q) => String(Math.max(1, (parseInt(q) || 0) + delta)));

  const isPending = tradeMutation.isPending || orderMutation.isPending;
  const canSubmit = isMarket ? (!!canTrade && !isPending) : (!!canPlaceOrder && !isPending);

  const handleSubmit = () => {
    if (!asset) return;
    if (isMarket) {
      if (!canTrade) return;
      tradeMutation.mutate({ type: state.side, shares: parsedQty });
    } else {
      if (!canPlaceOrder) return;
      orderMutation.mutate({
        assetId: asset.id,
        mode: "CANONICAL",
        orderType: "LIMIT",
        side: state.side,
        triggerPrice: parsedTriggerPrice,
        quantity: parsedQty,
        timeInForce: "GTC",
      });
    }
  };

  const ctaLabel = () => {
    if (isMarket) {
      if (tradeMutation.isPending) return "Executing…";
      if (!canTrade) return isBuy ? "Insufficient funds" : "Insufficient shares";
      return `${state.side} ${parsedQty} share${parsedQty !== 1 ? "s" : ""}`;
    }
    if (orderMutation.isPending) return "Placing…";
    if (!parsedTriggerPrice) return "Enter limit price";
    return "Place Limit Order";
  };

  if (!open) return null;

  const gameLabel = asset ? getAssetGameLabel(asset.assetUid) : "";
  const displayShortName = asset?.displayName.split("#")[0] ?? "";

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/70 backdrop-blur-[2px]"
        onClick={close}
        aria-hidden="true"
      />

      {/* Modal — bottom sheet on mobile, centered on desktop */}
      <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center pointer-events-none">
        <div
          className="pointer-events-auto w-full sm:w-[420px] max-h-[92dvh] sm:max-h-[82vh] bg-[#0d1117] border border-white/[0.09] rounded-t-2xl sm:rounded-2xl shadow-[0_24px_64px_rgba(0,0,0,0.6),0_0_0_1px_rgba(255,255,255,0.04)] flex flex-col overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* ── Header ────────────────────────────────────────────────── */}
          <div className="relative flex items-center gap-3 px-5 py-3.5 border-b border-white/[0.07] shrink-0">
            {/* Mobile drag handle */}
            <div className="absolute top-2 left-1/2 -translate-x-1/2 w-8 h-1 rounded-full bg-white/15 sm:hidden" />

            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-bold text-foreground tracking-wide truncate">
                {displayShortName || "Trade"}
              </div>
              {gameLabel && (
                <div className="text-[10px] text-muted-foreground/45 font-mono mt-0.5 uppercase tracking-widest">{gameLabel}</div>
              )}
            </div>

            {/* Link to player card */}
            {asset && (
              <Link href={`/players/${asset.id}`} onClick={close}>
                <button
                  data-testid="modal-view-card"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/[0.08] text-[11px] font-semibold text-muted-foreground/60 hover:text-primary hover:border-primary/30 hover:bg-primary/5 transition-colors"
                >
                  View Player
                </button>
              </Link>
            )}

            {/* Close */}
            <button
              data-testid="modal-close"
              onClick={close}
              className="p-1.5 rounded-lg text-muted-foreground/40 hover:text-foreground hover:bg-white/[0.08] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* ── Body (scrollable) ──────────────────────────────────────── */}
          <div className="flex-1 min-h-0 overflow-y-auto">
            {!asset ? (
              <div className="flex flex-col items-center justify-center gap-3 p-8">
                <ShoppingCart className="w-8 h-8 text-muted-foreground/20" />
                <p className="text-sm text-muted-foreground/50">No player selected</p>
              </div>
            ) : (
              <div className="p-5 space-y-4">

                {/* Asset info strip */}
                <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl bg-white/[0.04] border border-white/[0.06]">
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold text-foreground truncate leading-tight">{asset.displayName.split("#")[0]}</div>
                    <div className="text-[11px] text-muted-foreground/50 font-mono mt-0.5">
                      {quote?.ammEnabled ? <span className="text-primary/70 mr-1">AMM ⚡</span> : null}
                      {formatCurrency(parseFloat(asset.lastTradePrice))}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[11px] font-mono">
                      <span className="text-rose-400/70">{formatCurrency(parseFloat(asset.bidPrice ?? "0"))}</span>
                      <span className="text-muted-foreground/30 mx-1.5">·</span>
                      <span className="text-emerald-400/70">{formatCurrency(parseFloat(asset.askPrice ?? "0"))}</span>
                    </div>
                    <div className="text-[10px] text-muted-foreground/35 mt-0.5">{parseFloat(asset.spreadPct ?? "0").toFixed(2)}% spread</div>
                  </div>
                </div>

                {/* BUY / SELL */}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    data-testid="modal-ticket-buy"
                    onClick={() => dispatch({ type: "SET_SIDE", side: "BUY" })}
                    className={`py-2.5 rounded-xl text-sm font-bold transition-all duration-150 active:scale-[0.98] border ${isBuy ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" : "text-muted-foreground/60 border-white/[0.07] hover:text-foreground hover:bg-white/[0.05] hover:border-white/[0.12]"}`}
                  >
                    BUY
                  </button>
                  <button
                    data-testid="modal-ticket-sell"
                    onClick={() => dispatch({ type: "SET_SIDE", side: "SELL" })}
                    className={`py-2.5 rounded-xl text-sm font-bold transition-all duration-150 active:scale-[0.98] border ${!isBuy ? "bg-rose-500/15 text-rose-400 border-rose-500/30" : "text-muted-foreground/60 border-white/[0.07] hover:text-foreground hover:bg-white/[0.05] hover:border-white/[0.12]"}`}
                  >
                    SELL
                  </button>
                </div>

                {/* Market / Limit */}
                <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                  {(["MARKET", "LIMIT"] as const).map((mode) => (
                    <button
                      key={mode}
                      data-testid={`modal-order-mode-${mode.toLowerCase()}`}
                      onClick={() => setOrderMode(mode)}
                      className={`py-1.5 rounded-lg text-[11px] font-semibold transition-all duration-150 active:scale-[0.98] ${
                        orderMode === mode
                          ? "bg-white/[0.08] text-foreground shadow-sm"
                          : "text-muted-foreground/50 hover:text-muted-foreground"
                      }`}
                    >
                      {mode === "MARKET" ? "Market" : "Limit"}
                    </button>
                  ))}
                </div>

                {/* Limit price (LIMIT only) */}
                {orderMode === "LIMIT" && (
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Limit Price</label>
                    <input
                      data-testid="modal-trigger-price"
                      type="text"
                      inputMode="decimal"
                      value={triggerPrice}
                      onChange={(e) => setTriggerPrice(e.target.value)}
                      placeholder={parseFloat(asset.lastTradePrice ?? "0").toFixed(2)}
                      className={`w-full bg-white/5 border rounded h-9 px-3 text-sm font-mono text-foreground focus:outline-none ${priceInvalid ? "border-rose-500/60 focus:border-rose-500" : "border-white/10 focus:border-primary"}`}
                    />
                    {priceInvalid ? (
                      <p className="text-xs text-rose-400/80 mt-0.5">Enter a valid price (e.g. 14.50)</p>
                    ) : (
                      <p className="text-xs text-muted-foreground/60 mt-0.5">
                        {isBuy ? "Executes when price drops to or below your limit." : "Executes when price rises to or above your limit."}
                      </p>
                    )}
                  </div>
                )}

                {/* Quantity */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs text-muted-foreground">Quantity</label>
                    <span className="text-xs text-muted-foreground/60">{isBuy ? `${formatCurrency(execPrice)}/sh` : `${sharesOwned} owned`}</span>
                  </div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <button
                      data-testid="modal-qty-down"
                      onClick={() => adjustQty(-1)}
                      className="w-9 h-9 rounded bg-white/5 hover:bg-white/10 active:bg-white/[0.18] active:scale-[0.92] text-base font-bold text-muted-foreground hover:text-foreground flex items-center justify-center shrink-0 transition-all duration-100"
                    >
                      −
                    </button>
                    <input
                      data-testid="modal-qty-input"
                      type="number"
                      min={1}
                      value={qty}
                      onChange={(e) => setQty(e.target.value)}
                      className="flex-1 text-center bg-white/5 border border-white/10 rounded h-9 text-sm font-mono text-foreground focus:outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/20 transition-all"
                    />
                    <button
                      data-testid="modal-qty-up"
                      onClick={() => adjustQty(1)}
                      className="w-9 h-9 rounded bg-white/5 hover:bg-white/10 active:bg-white/[0.18] active:scale-[0.92] text-base font-bold text-muted-foreground hover:text-foreground flex items-center justify-center shrink-0 transition-all duration-100"
                    >
                      +
                    </button>
                  </div>
                  {/* Quick qty */}
                  <div className="flex gap-1">
                    {[1, 5, 10].map((n) => (
                      <button
                        key={n}
                        data-testid={`modal-qty-quick-${n}`}
                        onClick={() => adjustQty(n)}
                        className="flex-1 py-1 rounded text-xs text-muted-foreground bg-white/5 hover:bg-white/10 active:bg-white/[0.16] active:scale-[0.96] hover:text-foreground transition-all duration-100 border border-white/5"
                      >
                        +{n}
                      </button>
                    ))}
                    <button
                      data-testid="modal-qty-max"
                      onClick={() => maxQty > 0 && setQty(String(maxQty))}
                      disabled={maxQty <= 0}
                      className="flex-1 py-1 rounded text-xs font-semibold text-muted-foreground bg-white/5 hover:bg-white/10 active:bg-white/[0.16] active:scale-[0.96] hover:text-foreground transition-all duration-100 border border-white/5 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      MAX
                    </button>
                  </div>
                </div>

                {/* Estimated cost summary */}
                <div className={`rounded-xl border px-4 py-3 ${isBuy ? "bg-emerald-500/[0.06] border-emerald-500/20" : "bg-rose-500/[0.06] border-rose-500/20"}`}>
                  <div className="text-[10px] text-muted-foreground/60 uppercase tracking-wider mb-1">{isBuy ? "Estimated Cost" : "Estimated Proceeds"}</div>
                  <div className={`text-[22px] font-mono font-bold leading-none ${isBuy ? "text-emerald-400" : "text-rose-400"}`}>
                    {quoteLoading ? <span className="text-base text-muted-foreground/50">…</span> : formatCurrency(total)}
                  </div>
                  {quote?.ammEnabled && ammImpact !== null && Math.abs(ammImpact) > 2 && (
                    <div className="flex items-center gap-1 mt-1.5 text-xs text-amber-400">
                      <Zap className="w-3 h-3 shrink-0" />
                      High impact: {ammImpact.toFixed(2)}%
                    </div>
                  )}
                </div>

                {/* Balance info */}
                <div className="flex justify-between text-xs px-0.5">
                  <span className="text-muted-foreground">{isBuy ? "Buying power" : "Shares owned"}</span>
                  <span className={`font-mono ${isBuy && balance < total ? "text-rose-400" : "text-foreground"}`}>
                    {isBuy ? formatCurrency(balance) : `${sharesOwned} sh`}
                  </span>
                </div>

                {/* CTA button */}
                <button
                  data-testid="modal-ticket-submit"
                  onClick={handleSubmit}
                  disabled={(!canSubmit) || tradeSuccess}
                  className={`w-full py-3 rounded-xl font-bold text-sm transition-all duration-200 active:scale-[0.99] disabled:cursor-not-allowed ${
                    tradeSuccess
                      ? "bg-emerald-500/30 text-emerald-300 ring-1 ring-emerald-500/40 opacity-100"
                      : isBuy
                        ? "bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 text-black disabled:opacity-40"
                        : "bg-rose-500 hover:bg-rose-400 active:bg-rose-600 text-white disabled:opacity-40"
                  }`}
                >
                  {tradeSuccess ? (
                    <span className="flex items-center justify-center gap-1.5">
                      <span className="text-base leading-none">✓</span> Executed
                    </span>
                  ) : isPending ? (
                    <span className="flex items-center justify-center gap-1.5">
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      {ctaLabel()}
                    </span>
                  ) : ctaLabel()}
                </button>

                {/* Trade Details — collapsible */}
                <div className="rounded-xl border border-white/[0.06] overflow-hidden">
                  <button
                    data-testid="modal-details-toggle"
                    onClick={() => setDetailsOpen((v) => !v)}
                    className="w-full flex items-center justify-between px-4 py-2.5 bg-white/[0.025] hover:bg-white/[0.04] transition-colors"
                  >
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">Trade Details</span>
                    <ChevronRight className={`w-3.5 h-3.5 text-muted-foreground/40 transition-transform ${detailsOpen ? "rotate-90" : ""}`} />
                  </button>
                  {detailsOpen && (
                    <div className="px-4 py-3 space-y-2 text-[11px] bg-white/[0.015] border-t border-white/[0.04]">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground/60">Exec price</span>
                        <span className="font-mono text-foreground">
                          {quoteLoading ? "…" : ammAvgPrice ? formatCurrency(ammAvgPrice) : formatCurrency(execPrice)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Shares</span>
                        <span className="font-mono text-foreground">{parsedQty}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Gross value</span>
                        <span className="font-mono text-foreground">{formatCurrency(gross)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">
                          Fee {quote?.ammEnabled && quote?.feeBps ? `(${(quote.feeBps / 100).toFixed(1)}%)` : "(2%)"}
                        </span>
                        <span className="font-mono text-muted-foreground">{formatCurrency(fee)}</span>
                      </div>
                      {quote?.ammEnabled && ammImpact !== null && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Price impact</span>
                          <span className={`font-mono ${Math.abs(ammImpact) > 1 ? "text-amber-400" : "text-muted-foreground"}`}>
                            {ammImpact.toFixed(3)}%
                          </span>
                        </div>
                      )}
                      {quote?.ammEnabled && quote?.newSpot && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">New spot</span>
                          <span className="font-mono text-foreground">{formatCurrency(parseFloat(quote.newSpot))}</span>
                        </div>
                      )}
                      {quote?.ammEnabled && quote?.supply && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Market supply</span>
                          <span className="font-mono text-muted-foreground">{parseFloat(quote.supply).toFixed(0)} sh</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>

              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
