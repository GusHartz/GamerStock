import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, TrendingUp, TrendingDown, Minus, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useTradeCard } from "./TradeCardContext";
import { usePortfolio } from "@/hooks/use-portfolio";
import { isPredictEnabled } from "@/lib/featureFlags";
import type { PredictionTradeIntent, AssetTradeIntent } from "./types";

// ── Shared types ──────────────────────────────────────────────────────────────

interface WalletEntry {
  currency:         string;
  availableBalance: string;
}
interface WalletSummary { wallets: WalletEntry[] }

interface SidePosition {
  sharesHeld: number;
  avgPrice:   string;
}
interface AmmQuote {
  ammEnabled: boolean;
  avgPrice:   number;
  notional:   number;
  feeAmount:  number;
}

const PREDICTION_QUICK = [10, 25, 50, 100] as const;
const ASSET_QUICK      = [1, 5, 10, 25]   as const;

function safeNum(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

// ── Prediction body ───────────────────────────────────────────────────────────

function PredictionBody({ intent, isOpen }: { intent: PredictionTradeIntent; isOpen: boolean }) {
  const { toast } = useToast();
  const qc        = useQueryClient();
  const { close } = useTradeCard();

  const [action, setAction]       = useState<"BUY" | "SELL">(intent.action);
  const [amountStr, setAmountStr] = useState("");

  useEffect(() => {
    setAction(intent.action);
    setAmountStr("");
  }, [intent.marketId, intent.sideId, intent.action]);

  const { data: walletData } = useQuery<WalletSummary>({
    queryKey: ["/api/wallets/me"],
    queryFn: async () => {
      const res = await fetch("/api/wallets/me", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load wallet");
      return res.json();
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
    enabled: isOpen,
  });

  const { data: positionData } = useQuery<SidePosition | null>({
    queryKey: ["/api/predictions/markets", intent.marketId, "my-side-position", intent.sideId],
    queryFn: async () => {
      const res = await fetch(
        `/api/predictions/markets/${intent.marketId}/my-side-position?sideId=${intent.sideId}`,
        { credentials: "include" }
      );
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("Failed to load position");
      return res.json();
    },
    staleTime: 10_000,
    enabled: isOpen,
  });

  const gsWallet    = walletData?.wallets.find((w) => w.currency === "GS");
  const availableGS = gsWallet ? parseFloat(gsWallet.availableBalance) : 0;
  const sharesHeld  = positionData?.sharesHeld ?? 0;

  const amount       = parseFloat(amountStr) || 0;
  const price        = safeNum(intent.price, 0.5);
  const estShares    = price > 0 && amount > 0 ? (amount / price).toFixed(2) : "—";
  const sharesToSell = price > 0 && amount > 0 ? amount / price : 0;
  const maxAmount    = Math.floor(availableGS * 100) / 100;
  const priceDisplay = (price * 100).toFixed(0);

  const tradeMut = useMutation({
    mutationFn: async () => {
      if (!intent) throw new Error("No trade intent");
      const idempotencyKey = `${intent.marketId}-${intent.sideId}-${action}-${Date.now()}`;
      const res = await apiRequest("POST", "/api/predictions/trades", {
        marketId: intent.marketId, sideId: intent.sideId, action,
        amountUsd: amount, orderType: "MARKET", idempotencyKey,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Trade submitted", description: `${action} order placed.` });
      qc.invalidateQueries({ queryKey: ["/api/wallets/me"] });
      qc.invalidateQueries({ queryKey: ["/api/predictions/me/positions"] });
      qc.invalidateQueries({ queryKey: ["/api/predictions/home"] });
      qc.invalidateQueries({ queryKey: ["/api/predictions/browse"], exact: false });
      qc.invalidateQueries({ queryKey: ["/api/predictions/markets", intent.marketId, "my-side-position", intent.sideId] });
      qc.invalidateQueries({ queryKey: ["/api/predictions/markets", String(intent.marketId), "detail"] });
      setAmountStr("");
      close();
    },
    onError: (err: Error) => {
      toast({ title: "Trade failed", description: err.message, variant: "destructive" });
    },
  });

  const buyBlocked  = action === "BUY"  && amount > availableGS;
  const sellBlocked = action === "SELL" && (sharesHeld <= 0 || sharesToSell > sharesHeld);
  const canSubmit   = amount > 0 && price > 0 && !tradeMut.isPending && !buyBlocked && !sellBlocked;
  const accent      = (intent.sideColor ?? "cyan") === "rose" ? "rose" : "cyan";

  return (
    <div className="space-y-3">
      {/* Side indicator */}
      <div className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl border ${
        accent === "rose"
          ? "border-rose-700/40 bg-rose-950/50"
          : "border-cyan-700/40 bg-cyan-950/50"
      }`} data-testid="trade-sheet-side">
        <span className={`w-2 h-2 rounded-full flex-none ${accent === "rose" ? "bg-rose-400" : "bg-cyan-400"}`} />
        <div className="flex-1 min-w-0">
          <div className={`text-[15px] font-black font-mono leading-none ${accent === "rose" ? "text-rose-300" : "text-cyan-300"}`}>
            {intent.sideLabel}
          </div>
          <div className={`text-[10px] font-mono mt-0.5 ${accent === "rose" ? "text-rose-400/60" : "text-cyan-400/60"}`}>
            @ {priceDisplay}¢ per share
          </div>
        </div>
      </div>

      {/* BUY / SELL toggle */}
      <div className="flex gap-2">
        <Button variant={action === "BUY" ? "default" : "outline"} size="sm" className="flex-1 gap-1 h-8 text-xs"
          onClick={() => setAction("BUY")} data-testid="trade-action-buy">
          <TrendingUp className="h-3.5 w-3.5" /> Buy
        </Button>
        <Button variant={action === "SELL" ? "default" : "outline"} size="sm" className="flex-1 gap-1 h-8 text-xs"
          onClick={() => setAction("SELL")} data-testid="trade-action-sell">
          <TrendingDown className="h-3.5 w-3.5" /> Sell
        </Button>
      </div>

      {action === "SELL" && sharesHeld <= 0 && (
        <p className="text-[11px] text-destructive" data-testid="no-position-warning">
          You have no shares to sell on this side.
        </p>
      )}

      {/* Amount */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-zinc-300" htmlFor="pred-trade-amount">
          Amount <span className="text-zinc-500">(GS$)</span>
        </label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 text-sm">$</span>
          <Input id="pred-trade-amount" type="number" min="0" step="1" placeholder="0"
            value={amountStr} onChange={(e) => setAmountStr(e.target.value)}
            className="pl-7 h-9 text-sm" data-testid="input-trade-amount" />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {PREDICTION_QUICK.map((q) => (
            <button key={q} onClick={() => setAmountStr(String(q))}
              className="text-[11px] px-2.5 py-0.5 rounded-full border border-white/10 hover:bg-white/10 transition-colors text-zinc-400 hover:text-white"
              data-testid={`quick-amount-${q}`}>
              ${q}
            </button>
          ))}
          <button onClick={() => setAmountStr(String(maxAmount))}
            className="text-[11px] px-2.5 py-0.5 rounded-full border border-white/10 hover:bg-white/10 transition-colors text-zinc-400 hover:text-white"
            data-testid="quick-amount-max">
            Max
          </button>
        </div>
      </div>

      {/* Summary */}
      <div className="rounded-lg border border-white/[0.07] bg-white/[0.04] px-3 py-2 space-y-1 text-xs">
        <div className="flex justify-between text-zinc-400">
          <span>Est. shares</span>
          <span className="font-semibold text-white" data-testid="est-shares">{estShares}</span>
        </div>
        <div className="flex justify-between text-zinc-400">
          <span>Price per share</span>
          <span data-testid="price-per-share">{priceDisplay}¢</span>
        </div>
        {action === "BUY" && (
          <div className="flex justify-between text-zinc-400">
            <span>Available</span>
            <span data-testid="available-balance">GS${availableGS.toFixed(2)}</span>
          </div>
        )}
        {action === "SELL" && sharesHeld > 0 && (
          <div className="flex justify-between text-zinc-400">
            <span>Shares held</span>
            <span data-testid="shares-held">{sharesHeld.toFixed(2)}</span>
          </div>
        )}
      </div>

      {action === "BUY" && amount > availableGS && amount > 0 && (
        <p className="text-[11px] text-destructive" data-testid="insufficient-funds">
          Insufficient GS balance. You have GS${availableGS.toFixed(2)} available.
        </p>
      )}
      {action === "SELL" && sharesHeld > 0 && sharesToSell > sharesHeld && amount > 0 && (
        <p className="text-[11px] text-destructive" data-testid="oversell-warning">
          Max sell: GS${(sharesHeld * price).toFixed(2)}.
        </p>
      )}

      <Button className="w-full h-9 text-sm" disabled={!canSubmit} onClick={() => tradeMut.mutate()} data-testid="btn-submit-trade">
        {tradeMut.isPending
          ? <><Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" /> Submitting…</>
          : `${action} ${intent.sideLabel}`}
      </Button>
    </div>
  );
}

// ── Asset body ────────────────────────────────────────────────────────────────

function AssetBody({ intent, isOpen }: { intent: AssetTradeIntent; isOpen: boolean }) {
  const { toast } = useToast();
  const qc        = useQueryClient();
  const { close } = useTradeCard();

  const [side, setSide] = useState<"BUY" | "SELL">(intent.initialSide ?? "BUY");
  const [qty,  setQty]  = useState(1);

  useEffect(() => {
    setSide(intent.initialSide ?? "BUY");
    setQty(1);
  }, [intent.assetId, intent.initialSide]);

  const { data: portfolio } = usePortfolio();
  const balance    = safeNum(portfolio?.portfolio?.balance, 0);
  const positions: any[] = Array.isArray(portfolio?.positions) ? portfolio.positions : [];

  const puuid = (() => {
    try {
      const parts = intent.assetId.split(":");
      return parts.length >= 4 ? parts.slice(3).join(":") : "";
    } catch { return ""; }
  })();

  const myPos       = positions.find((p: any) => p?.puuid === puuid || p?.assetUid === intent.assetId);
  const sharesOwned = safeNum(myPos?.shares ?? myPos?.quantity, 0);
  const safeQty     = Math.max(1, Math.floor(safeNum(qty, 1)));

  const { data: quote } = useQuery<AmmQuote>({
    queryKey: ["/api/riot/quote", puuid, side, safeQty],
    queryFn: () =>
      fetch(`/api/riot/quote?puuid=${encodeURIComponent(puuid)}&type=${side}&shares=${safeQty}`)
        .then((r) => r.json()),
    enabled: isOpen && !!puuid && safeQty > 0 && intent.price > 0,
    staleTime: 3_000,
  });

  const execPrice  = safeNum(quote?.ammEnabled && quote?.avgPrice ? quote.avgPrice : intent.price, intent.price);
  const grossValue = safeNum(quote?.ammEnabled && quote?.notional  ? quote.notional  : execPrice * safeQty, execPrice * safeQty);
  const fee        = safeNum(quote?.ammEnabled && quote?.feeAmount ? quote.feeAmount : 0, 0);
  const netAmount  = side === "BUY" ? grossValue + fee : Math.max(0, grossValue - fee);
  const canTrade   = side === "BUY" ? balance >= netAmount && safeQty >= 1 : sharesOwned >= safeQty;
  const maxBuyQty  = Math.max(1, Math.floor(balance / Math.max(0.01, execPrice * 1.02)));
  const maxSellQty = Math.max(0, Math.floor(sharesOwned));

  const tradeMut = useMutation({
    mutationFn: () => apiRequest("POST", "/api/riot/trade", { puuid, type: side, shares: safeQty }),
    onSuccess: () => {
      toast({
        title: `${side} executed`,
        description: `${side} ${safeQty} share${safeQty !== 1 ? "s" : ""} of ${intent.displayName}`,
        duration: 3000,
      });
      qc.invalidateQueries({ queryKey: ["/api/portfolio"] });
      qc.invalidateQueries({ queryKey: ["/api/assets"] });
      setQty(1);
      close();
    },
    onError: (err: any) => {
      toast({ title: "Trade failed", description: err?.message ?? "Unknown error", variant: "destructive" });
    },
  });

  const isBuy = side === "BUY";

  return (
    <div className="space-y-3">
      {/* Asset chip */}
      <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl border border-violet-700/40 bg-violet-950/40">
        <div className="w-2 h-2 rounded-full bg-violet-400 flex-none" />
        <div className="flex-1 min-w-0">
          <div className="text-[15px] font-black font-mono leading-none text-violet-200 truncate">{intent.displayName}</div>
          <div className="text-[10px] font-mono mt-0.5 text-violet-400/60">
            Mark: ${safeNum(intent.price, 0).toFixed(2)}
          </div>
        </div>
      </div>

      {/* BUY / SELL */}
      <div className="flex gap-2">
        <Button variant={isBuy ? "default" : "outline"} size="sm"
          className={`flex-1 gap-1 h-8 text-xs ${isBuy ? "bg-emerald-600 hover:bg-emerald-700 text-white border-0" : ""}`}
          onClick={() => setSide("BUY")} data-testid="asset-trade-buy">
          <TrendingUp className="h-3.5 w-3.5" /> Buy
        </Button>
        <Button variant={!isBuy ? "default" : "outline"} size="sm"
          className={`flex-1 gap-1 h-8 text-xs ${!isBuy ? "bg-rose-700 hover:bg-rose-800 text-white border-0" : ""}`}
          onClick={() => setSide("SELL")} data-testid="asset-trade-sell">
          <TrendingDown className="h-3.5 w-3.5" /> Sell
        </Button>
      </div>

      {!isBuy && sharesOwned <= 0 && (
        <p className="text-[11px] text-destructive" data-testid="no-shares-warning">
          You have no shares to sell.
        </p>
      )}

      {/* Quantity */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-zinc-300">Shares</label>
          {!isBuy && sharesOwned > 0 && (
            <span className="text-[11px] text-zinc-500">
              Owned: <span className="text-white font-mono">{sharesOwned}</span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setQty((q) => Math.max(1, q - 1))}
            className="w-8 h-8 flex items-center justify-center rounded-md border border-white/10 hover:bg-white/10 transition-colors"
            data-testid="qty-minus">
            <Minus className="w-3 h-3" />
          </button>
          <Input type="number" min="1" step="1" value={qty}
            onChange={(e) => setQty(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
            className="text-center font-mono flex-1 h-8 text-sm"
            data-testid="input-qty" />
          <button onClick={() => setQty((q) => q + 1)}
            className="w-8 h-8 flex items-center justify-center rounded-md border border-white/10 hover:bg-white/10 transition-colors"
            data-testid="qty-plus">
            <Plus className="w-3 h-3" />
          </button>
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {ASSET_QUICK.map((q) => (
            <button key={q} onClick={() => setQty(q)}
              className="text-[11px] px-2.5 py-0.5 rounded-full border border-white/10 hover:bg-white/10 transition-colors text-zinc-400 hover:text-white"
              data-testid={`asset-quick-${q}`}>
              {q}
            </button>
          ))}
          <button onClick={() => setQty(isBuy ? maxBuyQty : maxSellQty)}
            className="text-[11px] px-2.5 py-0.5 rounded-full border border-white/10 hover:bg-white/10 transition-colors text-zinc-400 hover:text-white"
            data-testid="asset-quick-max">
            Max
          </button>
        </div>
      </div>

      {/* Quote summary */}
      <div className="rounded-lg border border-white/[0.07] bg-white/[0.04] px-3 py-2 space-y-1 text-xs">
        <div className="flex justify-between text-zinc-400">
          <span>Price per share</span>
          <span className="font-mono text-white" data-testid="asset-price-per-share">${execPrice.toFixed(2)}</span>
        </div>
        {fee > 0 && (
          <div className="flex justify-between text-zinc-400">
            <span>Fee</span>
            <span className="font-mono text-amber-400" data-testid="asset-fee">${fee.toFixed(2)}</span>
          </div>
        )}
        <div className="flex justify-between border-t border-white/10 pt-1 mt-1 text-zinc-300">
          <span>{isBuy ? "Total cost" : "Est. proceeds"}</span>
          <span className="font-mono font-bold" data-testid="asset-net-amount">
            ${Number.isFinite(netAmount) ? netAmount.toFixed(2) : "—"}
          </span>
        </div>
        <div className="flex justify-between text-zinc-400">
          <span>{isBuy ? "Available" : "Shares held"}</span>
          <span className="font-mono" data-testid="asset-balance">
            {isBuy ? `$${balance.toFixed(2)}` : sharesOwned.toString()}
          </span>
        </div>
      </div>

      {isBuy && balance < netAmount && netAmount > 0 && (
        <p className="text-[11px] text-destructive" data-testid="asset-insufficient-funds">
          Insufficient balance (${balance.toFixed(2)} available).
        </p>
      )}
      {!isBuy && sharesOwned > 0 && safeQty > sharesOwned && (
        <p className="text-[11px] text-destructive" data-testid="asset-oversell">
          Only {sharesOwned} shares available.
        </p>
      )}

      <Button className="w-full h-9 text-sm" disabled={!canTrade || tradeMut.isPending}
        onClick={() => tradeMut.mutate()} data-testid="btn-asset-submit-trade">
        {tradeMut.isPending
          ? <><Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" /> Executing…</>
          : !canTrade
            ? isBuy ? "Insufficient funds" : "No shares to sell"
            : `${side} ${safeQty} share${safeQty !== 1 ? "s" : ""}`}
      </Button>
    </div>
  );
}

// ── Root: compact floating trade card ─────────────────────────────────────────

export default function GlobalTradePanel() {
  const { intent, isOpen, close } = useTradeCard();
  const [domReady, setDomReady]   = useState(false);
  const [rendered, setRendered]   = useState(false);

  useEffect(() => { setDomReady(true); }, []);

  // Keep content rendered during close animation; unmount after
  useEffect(() => {
    if (isOpen) {
      setRendered(true);
    } else {
      const t = setTimeout(() => setRendered(false), 320);
      return () => clearTimeout(t);
    }
  }, [isOpen]);

  // Layer 2 — fail-closed: if a prediction intent somehow reaches the panel
  // while Predict is disabled (e.g. stale state, orphaned component), silently
  // close and discard it. PredictionBody is also never rendered below, so no
  // query or POST fires even before this effect runs.
  useEffect(() => {
    if (intent?.type === "prediction" && !isPredictEnabled()) {
      close();
    }
  }, [intent, close]);

  if (!domReady || !intent) return null;

  const title =
    intent.type === "prediction" ? intent.question : `Trade ${intent.displayName}`;

  return createPortal(
    <>
      {/* Subtle backdrop — barely-there, not modal-heavy */}
      <div
        aria-hidden="true"
        className="fixed inset-0 z-40 transition-opacity duration-300"
        style={{
          background: "rgba(0,0,0,0.28)",
          opacity: isOpen ? 1 : 0,
          pointerEvents: isOpen ? "auto" : "none",
        }}
        onClick={close}
      />

      {/*
        Floating compact card — centered on screen
        Desktop: 440px wide, centered via left/top 50% + translate(-50%,-50%)
        Mobile: full-width minus 16px margin each side, vertically centered
      */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-testid="global-trade-panel"
        className="fixed z-50 w-[calc(100vw-2rem)] sm:w-[440px]"
        style={{
          left: "50%",
          top: "48%",
          transform: isOpen
            ? "translate(-50%, -50%) scale(1)"
            : "translate(-50%, -48%) scale(0.96)",
          opacity: isOpen ? 1 : 0,
          pointerEvents: isOpen ? "auto" : "none",
          transition: "opacity 0.25s ease, transform 0.25s ease",
        }}
      >
        <div
          className="w-full rounded-2xl overflow-hidden"
          style={{
            background: "linear-gradient(160deg, #111827 0%, #0d1117 100%)",
            border: "1px solid rgba(255,255,255,0.09)",
            boxShadow: "0 24px 48px -8px rgba(0,0,0,0.7), 0 8px 16px -4px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.06)",
            maxHeight: "min(420px, calc(100svh - 5rem))",
            overflowY: "auto",
          }}
        >
          {/* Header */}
          <div className="flex items-start justify-between px-4 pt-4 pb-2">
            <p
              className="text-[11px] font-mono text-zinc-400 leading-snug line-clamp-2 pr-4 pt-px"
              data-testid="trade-panel-title"
            >
              {title}
            </p>
            <button
              onClick={close}
              className="flex-none -mt-0.5 w-6 h-6 flex items-center justify-center rounded-full bg-white/[0.07] hover:bg-white/15 transition-colors"
              data-testid="btn-close-trade-panel"
              aria-label="Close trade panel"
            >
              <X className="w-3 h-3 text-zinc-400" />
            </button>
          </div>

          {/* Body */}
          <div className="px-4 pb-5">
            {rendered && (
              intent.type === "prediction"
                // Guard: PredictionBody never mounts when Predict is disabled —
                // prevents position queries and POST /api/predictions/trades.
                ? isPredictEnabled() ? <PredictionBody intent={intent} isOpen={isOpen} /> : null
                : <AssetBody intent={intent} isOpen={isOpen} />
            )}
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}
