/**
 * Trade Settlement Engine — Integration Tests
 *
 * These tests run against the real development database using isolated test users
 * (IDs prefixed with "settle-test-"). afterAll cleans up all created rows via
 * CASCADE delete on the users table.
 *
 * Run with:  npm test
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db, pool } from "../../../db";
import { users, wallets, walletLedgerEntries } from "@shared/schema";
import { eq, inArray } from "drizzle-orm";
import * as walletService from "../../wallet/service";
import * as settlement from "../service";

// ─── Test fixtures ────────────────────────────────────────────────────────────

const BUYER_ID  = "settle-test-buyer-001";
const SELLER_ID = "settle-test-seller-001";

async function getGS(userId: string) {
  const summary = await walletService.getWalletSummary(userId);
  return summary.wallets.find((w) => w.currency === "GS")!;
}

// ─── Setup / teardown ─────────────────────────────────────────────────────────

async function cleanupTestUsers() {
  // wallet_ledger_entries has RESTRICT FK — must delete it before wallets
  const testWallets = await db
    .select({ id: wallets.id })
    .from(wallets)
    .where(inArray(wallets.userId, [BUYER_ID, SELLER_ID]));
  const walletIds = testWallets.map((w) => w.id);
  if (walletIds.length > 0) {
    await db.delete(walletLedgerEntries).where(inArray(walletLedgerEntries.walletId, walletIds));
  }
  await db.delete(users).where(inArray(users.id, [BUYER_ID, SELLER_ID]));
}

beforeAll(async () => {
  // Clean up any stale state from a previous interrupted run
  await cleanupTestUsers();

  // Insert minimal test users (email unique, all other fields optional)
  await db
    .insert(users)
    .values([
      { id: BUYER_ID,  email: "settle-test-buyer@test.local" },
      { id: SELLER_ID, email: "settle-test-seller@test.local" },
    ])
    .onConflictDoNothing();

  // Create wallets + seed 10,000 GS$ for each user
  await walletService.ensureWalletsExist(BUYER_ID);
  await walletService.ensureWalletsExist(SELLER_ID);
});

afterAll(async () => {
  await cleanupTestUsers();
  await pool.end();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Trade Settlement Engine", () => {

  // ─── Test 1: reserveBuyOrderFunds ──────────────────────────────────────────
  describe("1. reserveBuyOrderFunds", () => {
    it("reduces available, increases locked, total unchanged", async () => {
      const before = await getGS(BUYER_ID);
      const avBefore = parseFloat(before.availableBalance);
      const lkBefore = parseFloat(before.lockedBalance);
      const totBefore = parseFloat(before.totalBalance);

      await settlement.reserveBuyOrderFunds({
        userId: BUYER_ID,
        orderId: "order-T1",
        reserveAmount: "2000",
      });

      const after = await getGS(BUYER_ID);
      expect(parseFloat(after.availableBalance)).toBeCloseTo(avBefore  - 2000, 4);
      expect(parseFloat(after.lockedBalance)).toBeCloseTo(lkBefore  + 2000, 4);
      expect(parseFloat(after.totalBalance)).toBeCloseTo(totBefore, 4);
    });
  });

  // ─── Test 2: releaseBuyOrderFunds ──────────────────────────────────────────
  describe("2. releaseBuyOrderFunds", () => {
    it("reduces locked, increases available, total unchanged", async () => {
      const before = await getGS(BUYER_ID);
      const avBefore  = parseFloat(before.availableBalance);
      const lkBefore  = parseFloat(before.lockedBalance);
      const totBefore = parseFloat(before.totalBalance);

      await settlement.releaseBuyOrderFunds({
        userId: BUYER_ID,
        orderId: "order-T1",
        releaseAmount: "800",
        reason: "cancelled",
      });

      const after = await getGS(BUYER_ID);
      expect(parseFloat(after.availableBalance)).toBeCloseTo(avBefore  + 800, 4);
      expect(parseFloat(after.lockedBalance)).toBeCloseTo(lkBefore  - 800, 4);
      expect(parseFloat(after.totalBalance)).toBeCloseTo(totBefore, 4);
    });
  });

  // ─── Test 3: settleMatchedTrade — full fill ────────────────────────────────
  describe("3. settleMatchedTrade — full fill", () => {
    const TRADE_ID = "trade-T3";

    beforeAll(async () => {
      // Ensure 1000 GS$ is reserved for this trade
      await settlement.reserveBuyOrderFunds({
        userId: BUYER_ID,
        orderId: "order-T3",
        reserveAmount: "1000",
      });
    });

    it("buyer locked decreases, buyer total decreases, available unchanged", async () => {
      const buyerBefore  = await getGS(BUYER_ID);
      const sellerBefore = await getGS(SELLER_ID);

      const result = await settlement.settleMatchedTrade({
        tradeId: TRADE_ID,
        buyOrderId: "order-T3",
        sellOrderId: "sell-T3",
        buyerUserId: BUYER_ID,
        sellerUserId: SELLER_ID,
        assetId: "faker",
        quantity: 20,
        executionPrice: "50",
        grossAmountGS: "1000",
        releaseAmount: "0",
      });

      const buyerAfter  = await getGS(BUYER_ID);
      const sellerAfter = await getGS(SELLER_ID);

      // Buyer: locked ↓1000, total ↓1000, available unchanged
      expect(parseFloat(buyerAfter.lockedBalance))
        .toBeCloseTo(parseFloat(buyerBefore.lockedBalance) - 1000, 4);
      expect(parseFloat(buyerAfter.totalBalance))
        .toBeCloseTo(parseFloat(buyerBefore.totalBalance) - 1000, 4);
      expect(parseFloat(buyerAfter.availableBalance))
        .toBeCloseTo(parseFloat(buyerBefore.availableBalance), 4);

      // Seller: available ↑1000, total ↑1000
      expect(parseFloat(sellerAfter.availableBalance))
        .toBeCloseTo(parseFloat(sellerBefore.availableBalance) + 1000, 4);
      expect(parseFloat(sellerAfter.totalBalance))
        .toBeCloseTo(parseFloat(sellerBefore.totalBalance) + 1000, 4);

      expect(result.idempotent).toBe(false);
      expect(result.grossAmountGS).toBe("1000.000000");
    });

    it("ledger has buy_settle and sell_settle entries referencing the trade", async () => {
      const { entries } = await walletService.getLedgerEntries(BUYER_ID, { currency: "GS" });
      const buySettle = entries.find(
        (e) => e.entryType === "buy_settle" && e.referenceId === TRADE_ID,
      );
      expect(buySettle).toBeDefined();
      expect(buySettle!.direction).toBe("debit");
      expect(buySettle!.referenceType).toBe("trade");

      const { entries: sellerEntries } = await walletService.getLedgerEntries(SELLER_ID, { currency: "GS" });
      const sellSettle = sellerEntries.find(
        (e) => e.entryType === "sell_settle" && e.referenceId === TRADE_ID,
      );
      expect(sellSettle).toBeDefined();
      expect(sellSettle!.direction).toBe("credit");
    });
  });

  // ─── Test 4: partial fill with remainder released ─────────────────────────
  describe("4. settleMatchedTrade — partial fill with remainder", () => {
    beforeAll(async () => {
      await settlement.reserveBuyOrderFunds({
        userId: BUYER_ID,
        orderId: "order-T4",
        reserveAmount: "600",
      });
    });

    it("consumes gross, releases remainder, seller receives gross", async () => {
      const buyerBefore  = await getGS(BUYER_ID);
      const sellerBefore = await getGS(SELLER_ID);

      await settlement.settleMatchedTrade({
        tradeId: "trade-T4",
        buyOrderId: "order-T4",
        sellOrderId: "sell-T4",
        buyerUserId: BUYER_ID,
        sellerUserId: SELLER_ID,
        assetId: "faker",
        quantity: 8,
        executionPrice: "50",
        grossAmountGS: "400",
        releaseAmount: "200",
      });

      const buyerAfter  = await getGS(BUYER_ID);
      const sellerAfter = await getGS(SELLER_ID);

      // Buyer net: locked consumed 400 (total ↓400) + released 200 (available ↑200)
      expect(parseFloat(buyerAfter.totalBalance))
        .toBeCloseTo(parseFloat(buyerBefore.totalBalance) - 400, 4);
      expect(parseFloat(buyerAfter.availableBalance))
        .toBeCloseTo(parseFloat(buyerBefore.availableBalance) + 200, 4);
      // locked = locked_before - 400 (consume) - 200 (unlock) = locked_before - 600
      expect(parseFloat(buyerAfter.lockedBalance))
        .toBeCloseTo(parseFloat(buyerBefore.lockedBalance) - 600, 4);

      // Seller: available ↑400, total ↑400
      expect(parseFloat(sellerAfter.availableBalance))
        .toBeCloseTo(parseFloat(sellerBefore.availableBalance) + 400, 4);
      expect(parseFloat(sellerAfter.totalBalance))
        .toBeCloseTo(parseFloat(sellerBefore.totalBalance) + 400, 4);
    });
  });

  // ─── Test 5: insufficient locked balance ──────────────────────────────────
  describe("5. insufficient locked balance", () => {
    it("throws when consume amount exceeds locked balance", async () => {
      await expect(
        settlement.settleMatchedTrade({
          tradeId: "trade-T5-fail",
          buyOrderId: "order-T5",
          sellOrderId: "sell-T5",
          buyerUserId: BUYER_ID,
          sellerUserId: SELLER_ID,
          assetId: "faker",
          quantity: 1,
          executionPrice: "9999",
          grossAmountGS: "9999",
          releaseAmount: "0",
        }),
      ).rejects.toThrow(/locked balance insufficient/i);
    });
  });

  // ─── Test 6: idempotency — same tradeId cannot settle twice ───────────────
  describe("6. idempotency — same tradeId", () => {
    it("returns idempotent=true and makes no balance changes on second call", async () => {
      const buyerBefore  = await getGS(BUYER_ID);
      const sellerBefore = await getGS(SELLER_ID);

      // Attempt to re-settle trade-T3 (already settled in test 3)
      const result = await settlement.settleMatchedTrade({
        tradeId: "trade-T3",
        buyOrderId: "order-T3",
        sellOrderId: "sell-T3",
        buyerUserId: BUYER_ID,
        sellerUserId: SELLER_ID,
        assetId: "faker",
        quantity: 20,
        executionPrice: "50",
        grossAmountGS: "1000",
        releaseAmount: "0",
      });

      expect(result.idempotent).toBe(true);
      expect(result.buyer.lockedConsumed).toBe("0.000000");
      expect(result.seller.credited).toBe("0.000000");

      // Balances must be unchanged
      const buyerAfter  = await getGS(BUYER_ID);
      const sellerAfter = await getGS(SELLER_ID);
      expect(buyerAfter.availableBalance).toBe(buyerBefore.availableBalance);
      expect(buyerAfter.lockedBalance).toBe(buyerBefore.lockedBalance);
      expect(buyerAfter.totalBalance).toBe(buyerBefore.totalBalance);
      expect(sellerAfter.availableBalance).toBe(sellerBefore.availableBalance);
      expect(sellerAfter.totalBalance).toBe(sellerBefore.totalBalance);
    });
  });
});
