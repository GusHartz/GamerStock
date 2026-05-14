import { db } from "../db";
import { triggerOrders, triggerOrderEvents, assets } from "@shared/schema";
import { eq, and, inArray, lt, sql as sqlExpr } from "drizzle-orm";
import { terminalBroadcaster } from "../sse/terminalBroadcaster";
import { executeRiotTrade, TradeError } from "./tradeExecutor";
import * as walletService from "../domains/wallet/service";
import { releaseBuyOrderFunds } from "../domains/trade-settlement/service";

const LOOP_INTERVAL_MS = 3000;
const BATCH_SIZE = 50;

function extractPuuid(assetId: string): string {
  return assetId.split(":").slice(3).join(":");
}

async function insertEvent(orderId: string, eventType: string, meta?: Record<string, any>) {
  try {
    await db.insert(triggerOrderEvents).values({
      orderId,
      eventType,
      metaJson: meta ?? null,
    });
  } catch (err) {
    console.error("[TriggerEngine] Failed to insert event:", err);
  }
}

async function expireDayOrders() {
  try {
    const startOfTodayUtc = new Date();
    startOfTodayUtc.setUTCHours(0, 0, 0, 0);

    const expired = await db.update(triggerOrders)
      .set({ status: "EXPIRED", updatedAt: new Date() })
      .where(
        and(
          eq(triggerOrders.status, "OPEN"),
          eq(triggerOrders.timeInForce, "DAY"),
          lt(triggerOrders.createdAt, startOfTodayUtc),
        ),
      )
      .returning({
        id: triggerOrders.id,
        userId: triggerOrders.userId,
        side: triggerOrders.side,
        triggerPrice: triggerOrders.triggerPrice,
        quantity: triggerOrders.quantity,
      });

    for (const o of expired) {
      console.log(`[TriggerEngine] Order ${o.id} expired (DAY TIF)`);
      await insertEvent(o.id, "EXPIRED", {});

      // Release locked GS$ for expired BUY orders
      if (o.side === "BUY") {
        try {
          const releaseAmount = (parseFloat(o.triggerPrice) * o.quantity).toFixed(6);
          await releaseBuyOrderFunds({
            userId: o.userId,
            orderId: o.id,
            releaseAmount,
            reason: "expired",
          });
          console.log(`[TriggerEngine] Released ${releaseAmount} GS$ for expired order ${o.id}`);
        } catch (releaseErr) {
          console.error(`[TriggerEngine] GS$ release failed for expired order ${o.id}:`, releaseErr);
        }
      }
    }
  } catch (err) {
    console.error("[TriggerEngine] expireDayOrders error:", err);
  }
}

// ── Shared failure handler ───────────────────────────────────────────────────
// Marks the order FAILED, logs an audit event, releases locked GS$ for BUY
// orders, and emits a broadcast. Called from both trade and settlement failure
// paths so both paths behave identically on error.
async function handleOrderFailure(
  order: { id: string; userId: string; side: string; quantity: number; triggerPrice: string; assetId: string; orderType: string },
  errMsg: string,
  trigger: number,
  phase: "trade" | "settlement",
) {
  console.error(`[TriggerEngine] Order ${order.id} FAILED (${phase}):`, errMsg);

  await db.update(triggerOrders)
    .set({ status: "FAILED", lastError: errMsg, updatedAt: new Date() })
    .where(and(eq(triggerOrders.id, order.id), eq(triggerOrders.status, "TRIGGERED")));

  await insertEvent(order.id, "FAILED", { error: errMsg, phase });

  // Release locked GS$ for failed BUY orders so funds are never permanently stuck
  if (order.side === "BUY") {
    try {
      const releaseAmount = (parseFloat(order.triggerPrice) * order.quantity).toFixed(6);
      await releaseBuyOrderFunds({
        userId: order.userId,
        orderId: order.id,
        releaseAmount,
        reason: `execution_${phase}_failure`,
      });
      console.log(`[TriggerEngine] Released ${releaseAmount} GS$ for failed BUY order ${order.id} (phase=${phase})`);
    } catch (releaseErr) {
      console.error(`[TriggerEngine] GS$ release failed for order ${order.id} after ${phase} failure:`, releaseErr);
    }
  }

  terminalBroadcaster.emit({
    type: "ORDER_FAILED",
    data: {
      orderId: order.id,
      assetId: order.assetId,
      orderType: order.orderType,
      side: order.side,
      qty: order.quantity,
      triggerPrice: trigger,
      error: errMsg,
      ts: Date.now(),
    },
  });
}

async function runLoop() {
  try {
    await expireDayOrders();

    const openOrders = await db.select()
      .from(triggerOrders)
      .where(eq(triggerOrders.status, "OPEN"))
      .orderBy(triggerOrders.updatedAt)
      .limit(BATCH_SIZE);

    if (openOrders.length === 0) return;

    const assetIdSet = [...new Set(openOrders.map((o) => o.assetId))];
    const priceMap = new Map<string, number>();

    for (const assetUid of assetIdSet) {
      const puuid = extractPuuid(assetUid);
      try {
        const [row] = await db
          .select({ lastTradePrice: assets.lastTradePrice, externalId: assets.externalId })
          .from(assets)
          .where(eq(assets.externalId, puuid))
          .limit(1);
        if (row?.lastTradePrice) {
          priceMap.set(assetUid, parseFloat(row.lastTradePrice));
        }
      } catch {
        // ignore per-asset error
      }
    }

    for (const order of openOrders) {
      const currentPrice = priceMap.get(order.assetId);
      if (currentPrice == null) continue;

      const trigger = parseFloat(order.triggerPrice);
      let conditionMet = false;

      if (order.orderType === "LIMIT" && order.side === "BUY") {
        conditionMet = currentPrice <= trigger;
      } else if (order.orderType === "LIMIT" && order.side === "SELL") {
        conditionMet = currentPrice >= trigger;
      } else if (order.orderType === "STOP_LOSS") {
        conditionMet = currentPrice <= trigger;
      } else if (order.orderType === "TAKE_PROFIT") {
        conditionMet = currentPrice >= trigger;
      }

      if (!conditionMet) continue;

      const [claimed] = await db.update(triggerOrders)
        .set({ status: "TRIGGERED", triggeredAt: new Date(), priceAtTrigger: currentPrice.toFixed(6), updatedAt: new Date() })
        .where(and(eq(triggerOrders.id, order.id), eq(triggerOrders.status, "OPEN")))
        .returning();

      if (!claimed) {
        console.log(`[TriggerEngine] Order ${order.id} already claimed by another instance`);
        continue;
      }

      console.log(`[TriggerEngine] Order ${order.id} TRIGGERED (${order.orderType} ${order.side} @ ${trigger}, currentPrice=${currentPrice})`);
      await insertEvent(order.id, "TRIGGERED", { currentPrice, triggerPrice: trigger });

      terminalBroadcaster.emit({
        type: "ORDER_TRIGGERED",
        data: {
          orderId: order.id,
          assetId: order.assetId,
          orderType: order.orderType,
          side: order.side,
          qty: order.quantity,
          triggerPrice: trigger,
          currentPrice,
          ts: Date.now(),
        },
      });

      // ── PHASE 1: Slippage check + trade execution ────────────────────────
      // The order must not be marked EXECUTED until BOTH this phase and the
      // wallet settlement phase below have completed successfully.
      let tradeResult: Awaited<ReturnType<typeof executeRiotTrade>>;

      try {
        if (order.maxSlippageBps != null) {
          const maxBps = order.maxSlippageBps;
          if (order.side === "BUY") {
            const maxPrice = trigger * (1 + maxBps / 10000);
            if (currentPrice > maxPrice) {
              throw new TradeError(`Slippage limit exceeded: price ${currentPrice.toFixed(4)} > max ${maxPrice.toFixed(4)}`);
            }
          } else {
            const minPrice = trigger * (1 - maxBps / 10000);
            if (currentPrice < minPrice) {
              throw new TradeError(`Slippage limit exceeded: price ${currentPrice.toFixed(4)} < min ${minPrice.toFixed(4)}`);
            }
          }
        }

        const puuid = extractPuuid(order.assetId);
        tradeResult = await executeRiotTrade({
          userId: order.userId,
          puuid,
          type: order.side as "BUY" | "SELL",
          shares: order.quantity,
          source: "TRIGGER_ORDER",
          orderId: order.id,
          skipWalletSettlement: true, // funds pre-locked at order creation; settled below
        });
      } catch (tradeErr: any) {
        await handleOrderFailure(order, tradeErr?.message ?? "Unknown trade error", trigger, "trade");
        continue; // skip to next order — do not proceed to settlement or EXECUTED
      }

      // ── PHASE 2: Wallet settlement ───────────────────────────────────────
      // Only reached if Phase 1 succeeded. If this phase fails the order is
      // still marked FAILED (not EXECUTED) and locked GS$ is released.
      try {
        if (order.side === "BUY") {
          const lockedAmount = parseFloat(order.triggerPrice) * order.quantity;
          const consumeAmount = Math.min(tradeResult.grossValue, lockedAmount);
          const excessAmount  = Math.max(0, lockedAmount - consumeAmount);

          await walletService.consumeLockedFunds({
            userId: order.userId,
            currency: "GS",
            amount: consumeAmount.toFixed(6),
            entryType: "buy_settle",
            description: `Trigger order fill: ${order.quantity} shares @ ${tradeResult.executionPrice.toFixed(2)} GS`,
            referenceType: "trade",
            referenceId: tradeResult.tradeId.toString(),
          });

          if (excessAmount > 0.000001) {
            await walletService.unlockFunds({
              userId: order.userId,
              currency: "GS",
              amount: excessAmount.toFixed(6),
              entryType: "unlock",
              description: `Price improvement excess released: order ${order.id}`,
              referenceType: "order",
              referenceId: order.id,
            });
          }
        } else if (order.side === "SELL") {
          await walletService.creditWallet({
            userId: order.userId,
            currency: "GS",
            amount: tradeResult.grossValue.toFixed(6),
            entryType: "sell_settle",
            description: `Trigger order sell fill: ${order.quantity} shares @ ${tradeResult.executionPrice.toFixed(2)} GS`,
            referenceType: "trade",
            referenceId: tradeResult.tradeId.toString(),
          });
        }
      } catch (walletErr: any) {
        await handleOrderFailure(order, walletErr?.message ?? "Wallet settlement error", trigger, "settlement");
        continue; // skip to next order — do not mark as EXECUTED
      }

      // ── PHASE 3: Mark EXECUTED — only reached when both phases succeeded ─
      await db.update(triggerOrders)
        .set({
          status: "EXECUTED",
          executedAt: new Date(),
          priceAtExecution: tradeResult.executionPrice.toFixed(6),
          lastError: null,
          updatedAt: new Date(),
        })
        .where(and(eq(triggerOrders.id, order.id), eq(triggerOrders.status, "TRIGGERED")));

      console.log(`[TriggerEngine] Order ${order.id} EXECUTED @ ${tradeResult.executionPrice.toFixed(4)}`);
      await insertEvent(order.id, "EXECUTED", { executionPrice: tradeResult.executionPrice, tradeId: tradeResult.tradeId });

      terminalBroadcaster.emit({
        type: "ORDER_EXECUTED",
        data: {
          orderId: order.id,
          assetId: order.assetId,
          orderType: order.orderType,
          side: order.side,
          qty: order.quantity,
          triggerPrice: trigger,
          fillPrice: tradeResult.executionPrice,
          ts: Date.now(),
        },
      });
    }
  } catch (err) {
    console.error("[TriggerEngine] loop error:", err);
  }
}

let engineInterval: NodeJS.Timeout | null = null;

export function startTriggerEngine() {
  if (engineInterval) return;
  console.log(`[TriggerEngine] Started — interval=${LOOP_INTERVAL_MS}ms`);
  engineInterval = setInterval(runLoop, LOOP_INTERVAL_MS);
  runLoop();
}

export function stopTriggerEngine() {
  if (engineInterval) {
    clearInterval(engineInterval);
    engineInterval = null;
  }
}
