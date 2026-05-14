import type { Express, RequestHandler } from "express";
import * as settlement from "./service";

const isAdminOnly: RequestHandler = (req: any, res, next) => {
  if (req.session?.isAdmin || req.session?.userRole === "admin") return next();
  return res.status(403).json({ message: "Forbidden" });
};

/**
 * Admin-only endpoints for validating and testing the Trade Settlement Engine.
 * These are INTERNAL tools — not exposed in any user-facing UI.
 */
export function registerTradeSettlementRoutes(app: Express): void {

  // POST /api/admin/trades/reserve-buy
  // Body: { userId, orderId, reserveAmount, assetId? }
  app.post("/api/admin/trades/reserve-buy", isAdminOnly, async (req: any, res) => {
    try {
      const { userId, orderId, reserveAmount, assetId, metadata } = req.body;
      if (!userId)      return res.status(400).json({ message: "userId is required" });
      if (!orderId)     return res.status(400).json({ message: "orderId is required" });
      if (!reserveAmount) return res.status(400).json({ message: "reserveAmount is required" });

      const result = await settlement.reserveBuyOrderFunds({
        userId,
        orderId,
        reserveAmount: String(reserveAmount),
        assetId,
        metadata,
      });
      return res.json({ success: true, result });
    } catch (err: any) {
      console.error("[TradeSettlement] reserve-buy error:", err);
      return res.status(400).json({ message: err.message ?? "Reserve failed" });
    }
  });

  // POST /api/admin/trades/release-buy
  // Body: { userId, orderId, releaseAmount, reason }
  app.post("/api/admin/trades/release-buy", isAdminOnly, async (req: any, res) => {
    try {
      const { userId, orderId, releaseAmount, reason = "adjustment" } = req.body;
      if (!userId)       return res.status(400).json({ message: "userId is required" });
      if (!orderId)      return res.status(400).json({ message: "orderId is required" });
      if (!releaseAmount) return res.status(400).json({ message: "releaseAmount is required" });

      const result = await settlement.releaseBuyOrderFunds({
        userId,
        orderId,
        releaseAmount: String(releaseAmount),
        reason,
      });
      return res.json({ success: true, result });
    } catch (err: any) {
      console.error("[TradeSettlement] release-buy error:", err);
      return res.status(400).json({ message: err.message ?? "Release failed" });
    }
  });

  // POST /api/admin/trades/settle
  // Body: { tradeId, buyOrderId, sellOrderId, buyerUserId, sellerUserId,
  //         assetId, quantity, executionPrice, grossAmountGS, releaseAmount? }
  app.post("/api/admin/trades/settle", isAdminOnly, async (req: any, res) => {
    try {
      const {
        tradeId, buyOrderId, sellOrderId,
        buyerUserId, sellerUserId,
        assetId, quantity, executionPrice,
        grossAmountGS, releaseAmount,
        metadata,
      } = req.body;

      const required = { tradeId, buyOrderId, sellOrderId, buyerUserId, sellerUserId, assetId, quantity, executionPrice, grossAmountGS };
      for (const [k, v] of Object.entries(required)) {
        if (v == null || v === "") return res.status(400).json({ message: `${k} is required` });
      }

      const result = await settlement.settleMatchedTrade({
        tradeId:      String(tradeId),
        buyOrderId:   String(buyOrderId),
        sellOrderId:  String(sellOrderId),
        buyerUserId:  String(buyerUserId),
        sellerUserId: String(sellerUserId),
        assetId:      String(assetId),
        quantity:     Number(quantity),
        executionPrice: String(executionPrice),
        grossAmountGS:  String(grossAmountGS),
        releaseAmount:  releaseAmount != null ? String(releaseAmount) : "0",
        metadata,
      });
      return res.json({ success: true, result });
    } catch (err: any) {
      console.error("[TradeSettlement] settle error:", err);
      return res.status(400).json({ message: err.message ?? "Settlement failed" });
    }
  });
}
