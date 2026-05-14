import type { Express, RequestHandler } from "express";
import { db } from "../../db";
import { z } from "zod";
import { triggerOrders, triggerOrderEvents } from "@shared/schema";
import { eq, and, desc, asc } from "drizzle-orm";
import { terminalBroadcaster } from "../../sse/terminalBroadcaster";
import { reserveBuyOrderFunds, releaseBuyOrderFunds } from "../trade-settlement/service";

const isAuthenticated: RequestHandler = (req: any, res, next) => {
  if (req.session?.isAdmin || req.session?.userId) return next();
  if (typeof req.isAuthenticated === "function" && req.isAuthenticated()) return next();
  return res.status(401).json({ message: "Unauthorized" });
};

export function registerOrdersRoutes(app: Express): void {
  // ──────────────────────────────────────────────────────────────
  //  Trigger Orders API — Limit / Stop Loss / Take Profit
  // ──────────────────────────────────────────────────────────────

  app.post("/api/orders", isAuthenticated, async (req: any, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const userId = (req.user as any).claims?.sub || (req.user as any).id;
      const bodySchema = z.object({
        assetId: z.coerce.string().min(1),
        mode: z.string().default("SANDBOX"),
        orderType: z.enum(["LIMIT", "STOP_LOSS", "TAKE_PROFIT"]),
        side: z.enum(["BUY", "SELL"]),
        triggerPrice: z.coerce.number().positive({ message: "Limit price must be greater than 0" }),
        quantity: z.coerce.number().int().positive({ message: "Quantity must be a positive integer" }),
        timeInForce: z.enum(["GTC", "DAY"]).default("GTC"),
        maxSlippageBps: z.number().int().min(0).max(10000).optional(),
        clientOrderId: z.string().max(64).optional(),
      });
      const body = bodySchema.parse(req.body);

      if (body.clientOrderId) {
        const [dup] = await db.select({ id: triggerOrders.id })
          .from(triggerOrders)
          .where(and(eq(triggerOrders.userId, userId), eq(triggerOrders.clientOrderId, body.clientOrderId)))
          .limit(1);
        if (dup) return res.status(409).json({ message: "Duplicate clientOrderId" });
      }

      const [order] = await db.insert(triggerOrders)
        .values({
          userId,
          assetId: body.assetId,
          mode: body.mode,
          orderType: body.orderType,
          side: body.side,
          triggerPrice: body.triggerPrice.toFixed(6),
          quantity: body.quantity,
          timeInForce: body.timeInForce,
          status: "OPEN",
          maxSlippageBps: body.maxSlippageBps ?? null,
          clientOrderId: body.clientOrderId ?? null,
        })
        .returning();

      await db.insert(triggerOrderEvents).values({
        orderId: order.id,
        eventType: "CREATED",
        metaJson: { assetId: body.assetId, triggerPrice: body.triggerPrice, quantity: body.quantity },
      });

      // ── GS$ fund reservation for BUY orders ──────────────────────────────
      if (body.side === "BUY") {
        const reserveAmount = (body.triggerPrice * body.quantity).toFixed(6);
        try {
          await reserveBuyOrderFunds({
            userId,
            orderId: order.id,
            reserveAmount,
            assetId: body.assetId,
          });
          console.log(`[Orders] Reserved ${reserveAmount} GS$ for order ${order.id}`);
        } catch (reserveErr: any) {
          // Rollback: mark order as FAILED so it is never triggered
          await db.update(triggerOrders)
            .set({ status: "FAILED", updatedAt: new Date() })
            .where(eq(triggerOrders.id, order.id));
          await db.insert(triggerOrderEvents).values({
            orderId: order.id,
            eventType: "FAILED",
            metaJson: { reason: "wallet_reservation_failed", error: reserveErr.message },
          });
          console.warn(`[Orders] GS$ reservation failed for order ${order.id}: ${reserveErr.message}`);
          return res.status(422).json({ message: `Insufficient GS$ balance: ${reserveErr.message}` });
        }
      }

      console.log(`[Orders] Created order ${order.id} userId=${userId} type=${body.orderType} side=${body.side} triggerPrice=${body.triggerPrice}`);
      res.status(201).json({ order });
    } catch (e) {
      if (e instanceof z.ZodError) return res.status(400).json({ message: e.errors[0].message });
      console.error("[Orders] POST error:", e);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/orders/me", isAuthenticated, async (req: any, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const userId = (req.user as any).claims?.sub || (req.user as any).id;
      const statusFilter = typeof req.query.status === "string" ? req.query.status : "ALL";
      const assetIdFilter = typeof req.query.assetId === "string" ? req.query.assetId : null;

      const conditions = [eq(triggerOrders.userId, userId)];
      if (statusFilter !== "ALL") conditions.push(eq(triggerOrders.status, statusFilter));
      if (assetIdFilter) conditions.push(eq(triggerOrders.assetId, assetIdFilter));

      const orders = await db.select()
        .from(triggerOrders)
        .where(and(...conditions))
        .orderBy(desc(triggerOrders.createdAt))
        .limit(50);

      res.json({ orders });
    } catch (e) {
      console.error("[Orders] GET /me error:", e);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/orders/:id", isAuthenticated, async (req: any, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const userId = (req.user as any).claims?.sub || (req.user as any).id;
      const { id } = req.params;

      const [order] = await db.select().from(triggerOrders)
        .where(and(eq(triggerOrders.id, id), eq(triggerOrders.userId, userId)));
      if (!order) return res.status(404).json({ message: "Order not found" });

      const events = await db.select().from(triggerOrderEvents)
        .where(eq(triggerOrderEvents.orderId, id))
        .orderBy(asc(triggerOrderEvents.createdAt));

      res.json({ order, events });
    } catch (e) {
      console.error("[Orders] GET /:id error:", e);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/orders/:id/cancel", isAuthenticated, async (req: any, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const userId = (req.user as any).claims?.sub || (req.user as any).id;
      const { id } = req.params;

      const [order] = await db.select().from(triggerOrders)
        .where(and(eq(triggerOrders.id, id), eq(triggerOrders.userId, userId)));
      if (!order) return res.status(404).json({ message: "Order not found" });
      if (order.status !== "OPEN") return res.status(400).json({ message: `Cannot cancel order with status ${order.status}` });

      const [cancelled] = await db.update(triggerOrders)
        .set({ status: "CANCELLED", updatedAt: new Date() })
        .where(and(eq(triggerOrders.id, id), eq(triggerOrders.status, "OPEN")))
        .returning();

      if (!cancelled) return res.status(409).json({ message: "Order status changed, could not cancel" });

      await db.insert(triggerOrderEvents).values({
        orderId: id,
        eventType: "CANCELLED",
        metaJson: { cancelledBy: userId },
      });

      // ── Release locked GS$ for cancelled BUY orders ───────────────────────
      if (order.side === "BUY") {
        try {
          const releaseAmount = (parseFloat(order.triggerPrice) * order.quantity).toFixed(6);
          await releaseBuyOrderFunds({
            userId,
            orderId: id,
            releaseAmount,
            reason: "cancelled",
          });
          console.log(`[Orders] Released ${releaseAmount} GS$ for cancelled order ${id}`);
        } catch (releaseErr) {
          console.error(`[Orders] GS$ release failed for cancelled order ${id}:`, releaseErr);
        }
      }

      terminalBroadcaster.emit({
        type: "ORDER_CANCELLED",
        data: { orderId: id, assetId: order.assetId, ts: Date.now() },
      });

      console.log(`[Orders] Cancelled order ${id} userId=${userId}`);
      res.json({ order: cancelled });
    } catch (e) {
      console.error("[Orders] POST /:id/cancel error:", e);
      res.status(500).json({ message: "Internal server error" });
    }
  });
}
