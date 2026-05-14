import type { Express, RequestHandler } from "express";
import * as walletService from "./service";
import * as reconciliation from "./reconciliation";
import type { Currency } from "./types";
import { db } from "../../db";
import {
  feeLedger, systemWallets, systemWalletLedger,
  playerEarningsBalance, playerEarningsLedger, assets,
  walletLedgerEntries, predictionSettlements, predictionOrders, predictionMarkets,
} from "@shared/schema";
import { desc, eq, and, or, sql, gte, lte, sum, count, isNotNull } from "drizzle-orm";
import { captureTradeFees } from "../fee-engine";
import { z } from "zod";

const isAuthenticated: RequestHandler = (req: any, res, next) => {
  if (req.session?.isAdmin || req.session?.userId) return next();
  return res.status(401).json({ message: "Unauthorized" });
};

const isAdminOnly: RequestHandler = (req: any, res, next) => {
  if (req.session?.isAdmin || req.session?.userRole === "admin") return next();
  return res.status(403).json({ message: "Forbidden" });
};

export function registerWalletRoutes(app: Express): void {

  // ─── User-facing endpoints ─────────────────────────────────────────────────

  app.get("/api/wallets/me", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId ?? req.session.adminUsername;
      const summary = await walletService.getWalletSummary(userId);
      return res.json(summary);
    } catch (err) {
      console.error("[Wallet] GET /me error:", err);
      return res.status(500).json({ message: "Failed to retrieve wallets" });
    }
  });

  app.get("/api/wallets/me/summary", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId ?? req.session.adminUsername;
      const summary = await walletService.getWalletSummary(userId);
      return res.json(summary);
    } catch (err) {
      console.error("[Wallet] GET /me/summary error:", err);
      return res.status(500).json({ message: "Failed to retrieve wallet summary" });
    }
  });

  app.get("/api/wallets/me/ledger", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.session.userId ?? req.session.adminUsername;
      const currency = req.query.currency as Currency | undefined;
      const page = parseInt(String(req.query.page ?? "1"), 10);
      const limit = parseInt(String(req.query.limit ?? "50"), 10);
      const result = await walletService.getLedgerEntries(userId, { currency, page, limit });
      return res.json(result);
    } catch (err) {
      console.error("[Wallet] GET /me/ledger error:", err);
      return res.status(500).json({ message: "Failed to retrieve ledger" });
    }
  });

  // ─── Admin-only endpoints ──────────────────────────────────────────────────

  app.post("/api/admin/wallets/:userId/seed-gs", isAdminOnly, async (req: any, res) => {
    try {
      const { userId } = req.params;
      const { amount = "10000" } = req.body;
      await walletService.seedFantasyBalance(userId, String(amount));
      const summary = await walletService.getWalletSummary(userId);
      return res.json({ success: true, summary });
    } catch (err: any) {
      console.error("[Wallet] seed-gs error:", err);
      return res.status(400).json({ message: err.message ?? "Seed failed" });
    }
  });

  app.post("/api/admin/wallets/:userId/credit-usdc", isAdminOnly, async (req: any, res) => {
    try {
      const { userId } = req.params;
      const { amount, description } = req.body;
      if (!amount) return res.status(400).json({ message: "amount is required" });
      await walletService.creditUsdc(userId, String(amount), description);
      const summary = await walletService.getWalletSummary(userId);
      return res.json({ success: true, summary });
    } catch (err: any) {
      console.error("[Wallet] credit-usdc error:", err);
      return res.status(400).json({ message: err.message ?? "Credit failed" });
    }
  });

  app.post("/api/admin/wallets/:userId/ensure", isAdminOnly, async (req: any, res) => {
    try {
      const { userId } = req.params;
      await walletService.ensureWalletsExist(userId);
      const summary = await walletService.getWalletSummary(userId);
      return res.json({ success: true, summary });
    } catch (err: any) {
      console.error("[Wallet] ensure error:", err);
      return res.status(500).json({ message: err.message ?? "Failed" });
    }
  });

  // ─── Accounting reconciliation endpoints ───────────────────────────────────

  app.get("/api/admin/accounting/reconcile-wallet/:walletId", isAdminOnly, async (req: any, res) => {
    try {
      const walletId = parseInt(req.params.walletId, 10);
      if (isNaN(walletId)) return res.status(400).json({ message: "walletId must be a number" });
      const result = await reconciliation.reconcileWallet(walletId);
      return res.json(result);
    } catch (err: any) {
      console.error("[Reconciliation] reconcile-wallet error:", err);
      const status = err.message?.includes("not found") ? 404 : 500;
      return res.status(status).json({ message: err.message ?? "Reconciliation failed" });
    }
  });

  app.get("/api/admin/accounting/reconcile-user/:userId", isAdminOnly, async (req: any, res) => {
    try {
      const { userId } = req.params;
      const result = await reconciliation.reconcileUser(userId);
      return res.json(result);
    } catch (err: any) {
      console.error("[Reconciliation] reconcile-user error:", err);
      return res.status(500).json({ message: err.message ?? "Reconciliation failed" });
    }
  });

  // ─── Phase 3 Validation Helpers ───────────────────────────────────────────
  // Admin-only endpoints used to validate Fee Engine behaviour.
  // Intentionally separate from product endpoints — safe to call anytime.

  // GET /api/admin/accounting/system-wallets
  // Returns current system wallet balances + last 20 ledger entries per wallet.
  app.get("/api/admin/accounting/system-wallets", isAdminOnly, async (_req: any, res) => {
    try {
      const walletRows = await db.select().from(systemWallets).orderBy(systemWallets.walletType, systemWallets.currency);
      const ledgerRows = await db.select().from(systemWalletLedger)
        .orderBy(desc(systemWalletLedger.createdAt))
        .limit(50);
      return res.json({ wallets: walletRows, recentLedger: ledgerRows });
    } catch (err: any) {
      return res.status(500).json({ message: err.message ?? "Failed" });
    }
  });

  // GET /api/admin/accounting/fee-ledger?limit=20&currency=GS
  // Returns recent fee_ledger rows for inspection.
  app.get("/api/admin/accounting/fee-ledger", isAdminOnly, async (req: any, res) => {
    try {
      const limit = Math.min(parseInt(String(req.query.limit ?? "20"), 10), 100);
      const currency = req.query.currency as string | undefined;

      const rows = await db.select().from(feeLedger)
        .where(currency ? eq(feeLedger.currency, currency as any) : undefined)
        .orderBy(desc(feeLedger.createdAt))
        .limit(limit);

      return res.json({ count: rows.length, rows });
    } catch (err: any) {
      return res.status(500).json({ message: err.message ?? "Failed" });
    }
  });

  // GET /api/admin/accounting/reconcile-system-wallets
  // Checks each system wallet's balance against its ledger sum.
  // "OK" = balance matches ledger; "MISMATCH" = drift detected.
  app.get("/api/admin/accounting/reconcile-system-wallets", isAdminOnly, async (_req: any, res) => {
    try {
      const walletRows = await db.select().from(systemWallets);

      const results = await Promise.all(walletRows.map(async (w) => {
        const [agg] = await db.select({
          totalCredits: sql<string>`COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount ELSE 0 END), 0)::text`,
          totalDebits:  sql<string>`COALESCE(SUM(CASE WHEN direction = 'debit'  THEN amount ELSE 0 END), 0)::text`,
          entryCount:   sql<number>`COUNT(*)::int`,
        }).from(systemWalletLedger)
          .where(and(
            eq(systemWalletLedger.walletType, w.walletType as any),
            eq(systemWalletLedger.currency,   w.currency   as any),
          ));

        const credits   = parseFloat(agg.totalCredits);
        const debits    = parseFloat(agg.totalDebits);
        const ledgerBal = credits - debits;
        const walletBal = parseFloat(w.balance);
        const diff      = walletBal - ledgerBal;
        const status    = Math.abs(diff) < 1e-6 ? "OK" : "MISMATCH";

        return {
          walletType:    w.walletType,
          currency:      w.currency,
          wallet_balance: walletBal.toFixed(6),
          ledger_balance: ledgerBal.toFixed(6),
          difference:     diff.toFixed(6),
          total_credits:  credits.toFixed(6),
          total_debits:   debits.toFixed(6),
          entry_count:    agg.entryCount,
          status,
        };
      }));

      const overall = results.some((r) => r.status === "MISMATCH") ? "MISMATCH" : "OK";
      return res.json({ overall_status: overall, wallets: results });
    } catch (err: any) {
      return res.status(500).json({ message: err.message ?? "Reconciliation failed" });
    }
  });

  // GET /api/admin/accounting/treasury-dashboard?period=today|7d|30d|all
  // Aggregated revenue & treasury dashboard for admin use.
  // Read-only. No writes. All data from fee_ledger, system_wallets, system_wallet_ledger.
  app.get("/api/admin/accounting/treasury-dashboard", isAdminOnly, async (req: any, res) => {
    try {
      const period = (["today", "7d", "30d", "all"].includes(req.query.period as string)
        ? req.query.period
        : "7d") as string;

      // Compute period start timestamp
      const periodStart: Date | null = (() => {
        const now = new Date();
        if (period === "today") {
          const d = new Date(now);
          d.setUTCHours(0, 0, 0, 0);
          return d;
        }
        if (period === "7d")  return new Date(now.getTime() - 7  * 24 * 60 * 60 * 1000);
        if (period === "30d") return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        return null;
      })();

      const periodFilter = periodStart ? gte(feeLedger.createdAt, periodStart) : undefined;

      // ── 1. Current system wallet balances ────────────────────────────────────
      const walletRows = await db
        .select({
          walletType: systemWallets.walletType,
          currency:   systemWallets.currency,
          balance:    systemWallets.balance,
          updatedAt:  systemWallets.updatedAt,
        })
        .from(systemWallets)
        .orderBy(systemWallets.walletType, systemWallets.currency);

      // ── 2. Period delta per wallet type (fees added in period) ───────────────
      // Three separate queries, merged in Node.js for clarity.
      const [platformDelta, playerDelta, liquidityDelta] = await Promise.all([
        db.select({ currency: feeLedger.currency, delta: sum(feeLedger.platformFee) })
          .from(feeLedger).where(periodFilter).groupBy(feeLedger.currency),
        db.select({ currency: feeLedger.currency, delta: sum(feeLedger.playerFee) })
          .from(feeLedger).where(periodFilter).groupBy(feeLedger.currency),
        db.select({ currency: feeLedger.currency, delta: sum(feeLedger.liquidityFee) })
          .from(feeLedger).where(periodFilter).groupBy(feeLedger.currency),
      ]);

      const deltaMap = new Map<string, string>();
      for (const r of platformDelta)  deltaMap.set(`platform_revenue:${r.currency}`, r.delta ?? "0");
      for (const r of playerDelta)    deltaMap.set(`player_pool:${r.currency}`,        r.delta ?? "0");
      for (const r of liquidityDelta) deltaMap.set(`liquidity_pool:${r.currency}`,     r.delta ?? "0");

      const systemWalletData = walletRows.map((w) => ({
        walletType:  w.walletType,
        currency:    w.currency,
        balance:     w.balance,
        periodDelta: deltaMap.get(`${w.walletType}:${w.currency}`) ?? "0",
        updatedAt:   w.updatedAt,
      }));

      // ── 3. Period metrics (grossVolume, tradeCount, fee splits per currency) ─
      const periodMetrics = await db
        .select({
          currency:     feeLedger.currency,
          tradeCount:   count(),
          grossVolume:  sum(feeLedger.notional),
          feeTotal:     sum(feeLedger.feeTotal),
          platformFee:  sum(feeLedger.platformFee),
          playerFee:    sum(feeLedger.playerFee),
          liquidityFee: sum(feeLedger.liquidityFee),
        })
        .from(feeLedger)
        .where(periodFilter)
        .groupBy(feeLedger.currency)
        .orderBy(feeLedger.currency);

      // ── 4. Recent fee captures (last 25) ─────────────────────────────────────
      const recentFeeCaptures = await db
        .select({
          id:            feeLedger.id,
          referenceType: feeLedger.referenceType,
          referenceId:   feeLedger.referenceId,
          assetId:       feeLedger.assetId,
          currency:      feeLedger.currency,
          notional:      feeLedger.notional,
          feeTotal:      feeLedger.feeTotal,
          platformFee:   feeLedger.platformFee,
          playerFee:     feeLedger.playerFee,
          liquidityFee:  feeLedger.liquidityFee,
          createdAt:     feeLedger.createdAt,
        })
        .from(feeLedger)
        .orderBy(desc(feeLedger.id))
        .limit(25);

      // ── 5. Recent system wallet activity (last 25) ────────────────────────────
      const recentWalletActivity = await db
        .select({
          walletType:   systemWalletLedger.walletType,
          currency:     systemWalletLedger.currency,
          direction:    systemWalletLedger.direction,
          amount:       systemWalletLedger.amount,
          balanceAfter: systemWalletLedger.balanceAfter,
          description:  systemWalletLedger.description,
          createdAt:    systemWalletLedger.createdAt,
        })
        .from(systemWalletLedger)
        .orderBy(desc(systemWalletLedger.id))
        .limit(25);

      return res.json({
        period,
        systemWallets: systemWalletData,
        periodMetrics: periodMetrics.map((m) => ({
          currency:     m.currency,
          tradeCount:   Number(m.tradeCount),
          grossVolume:  m.grossVolume  ?? "0",
          feeTotal:     m.feeTotal     ?? "0",
          platformFee:  m.platformFee  ?? "0",
          playerFee:    m.playerFee    ?? "0",
          liquidityFee: m.liquidityFee ?? "0",
        })),
        recentFeeCaptures,
        recentWalletActivity,
      });
    } catch (err: any) {
      console.error("[TreasuryDashboard]", err);
      return res.status(500).json({ message: err.message ?? "Failed" });
    }
  });

  // GET /api/admin/accounting/player-earnings-dashboard?period=today|7d|30d|all&currency=GS|USDC
  // Aggregated player earnings dashboard. Read-only.
  app.get("/api/admin/accounting/player-earnings-dashboard", isAdminOnly, async (req: any, res) => {
    try {
      const period = (["today", "7d", "30d", "all"].includes(req.query.period as string)
        ? req.query.period : "7d") as string;
      const currency = (["GS", "USDC"].includes(req.query.currency as string)
        ? req.query.currency : "GS") as string;

      const PAYOUT_THRESHOLDS: Record<string, number> = { GS: 10, USDC: 1 };

      const periodStart: Date | null = (() => {
        const now = new Date();
        if (period === "today") { const d = new Date(now); d.setUTCHours(0, 0, 0, 0); return d; }
        if (period === "7d")  return new Date(now.getTime() - 7  * 24 * 60 * 60 * 1000);
        if (period === "30d") return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        return null;
      })();

      const ledgerPeriodFilter = and(
        eq(playerEarningsLedger.currency, currency),
        eq(playerEarningsLedger.direction, "credit"),
        periodStart ? gte(playerEarningsLedger.createdAt, periodStart) : undefined,
      );

      // ── 1. Top earners (all-time balance) ─────────────────────────────────────
      const topEarnersRaw = await db
        .select({
          assetId:        playerEarningsBalance.assetId,
          currency:       playerEarningsBalance.currency,
          accruedBalance: playerEarningsBalance.accruedBalance,
          updatedAt:      playerEarningsBalance.updatedAt,
          displayName:    assets.displayName,
          assetUid:       assets.assetUid,
        })
        .from(playerEarningsBalance)
        .leftJoin(assets, eq(playerEarningsBalance.assetId, assets.id))
        .where(eq(playerEarningsBalance.currency, currency))
        .orderBy(desc(playerEarningsBalance.accruedBalance))
        .limit(50);

      // ── 2. Period earnings per asset ───────────────────────────────────────────
      const periodAgg = await db
        .select({
          assetId:          playerEarningsLedger.assetId,
          periodEarnings:   sql<string>`COALESCE(SUM(amount), 0)::text`,
          periodEntryCount: sql<number>`COUNT(*)::int`,
        })
        .from(playerEarningsLedger)
        .where(ledgerPeriodFilter)
        .groupBy(playerEarningsLedger.assetId);

      const periodByAsset = new Map(periodAgg.map((r) => [r.assetId, r]));
      const payoutThreshold = PAYOUT_THRESHOLDS[currency] ?? 10;

      const topEarners = topEarnersRaw.map((r) => ({
        ...r,
        periodEarnings:   periodByAsset.get(r.assetId)?.periodEarnings   ?? "0",
        periodEntryCount: periodByAsset.get(r.assetId)?.periodEntryCount ?? 0,
        payoutReady:      parseFloat(r.accruedBalance) >= payoutThreshold,
      }));

      // ── 3. Period summary ──────────────────────────────────────────────────────
      const [periodSummary] = await db
        .select({
          totalEarned:  sql<string>`COALESCE(SUM(amount), 0)::text`,
          assetCount:   sql<number>`COUNT(DISTINCT asset_id)::int`,
          entryCount:   sql<number>`COUNT(*)::int`,
        })
        .from(playerEarningsLedger)
        .where(ledgerPeriodFilter);

      // ── 4. Recent activity (latest 25 ledger rows, any direction) ─────────────
      const recentActivity = await db
        .select({
          id:            playerEarningsLedger.id,
          assetId:       playerEarningsLedger.assetId,
          currency:      playerEarningsLedger.currency,
          direction:     playerEarningsLedger.direction,
          amount:        playerEarningsLedger.amount,
          balanceAfter:  playerEarningsLedger.balanceAfter,
          referenceType: playerEarningsLedger.referenceType,
          referenceId:   playerEarningsLedger.referenceId,
          createdAt:     playerEarningsLedger.createdAt,
          displayName:   assets.displayName,
        })
        .from(playerEarningsLedger)
        .leftJoin(assets, eq(playerEarningsLedger.assetId, assets.id))
        .where(eq(playerEarningsLedger.currency, currency))
        .orderBy(desc(playerEarningsLedger.id))
        .limit(25);

      return res.json({
        period,
        currency,
        payoutThresholds: PAYOUT_THRESHOLDS,
        topEarners,
        periodSummary: periodSummary ?? { totalEarned: "0", assetCount: 0, entryCount: 0 },
        recentActivity,
      });
    } catch (err: any) {
      console.error("[PlayerEarningsDashboard] error:", err);
      return res.status(500).json({ message: err.message ?? "Failed" });
    }
  });

  // GET /api/admin/accounting/player-earnings?currency=GS&limit=50
  // Top earners sorted by accruedBalance desc, joined to asset display name.
  // Read-only.
  app.get("/api/admin/accounting/player-earnings", isAdminOnly, async (req: any, res) => {
    try {
      const currency  = (["GS", "USDC"].includes(req.query.currency as string)
        ? req.query.currency : "GS") as string;
      const limit     = Math.min(parseInt(req.query.limit as string) || 50, 200);

      const rows = await db
        .select({
          assetId:        playerEarningsBalance.assetId,
          currency:       playerEarningsBalance.currency,
          accruedBalance: playerEarningsBalance.accruedBalance,
          updatedAt:      playerEarningsBalance.updatedAt,
          displayName:    assets.displayName,
          assetUid:       assets.assetUid,
        })
        .from(playerEarningsBalance)
        .leftJoin(assets, eq(playerEarningsBalance.assetId, assets.id))
        .where(eq(playerEarningsBalance.currency, currency))
        .orderBy(desc(playerEarningsBalance.accruedBalance))
        .limit(limit);

      return res.json({ currency, limit, count: rows.length, rows });
    } catch (err: any) {
      console.error("[PlayerEarnings] list error:", err);
      return res.status(500).json({ message: err.message ?? "Failed" });
    }
  });

  // GET /api/admin/accounting/player-earnings/:assetId?currency=GS
  // Full earnings ledger history for a single asset.
  // Read-only.
  app.get("/api/admin/accounting/player-earnings/:assetId", isAdminOnly, async (req: any, res) => {
    try {
      const assetId  = parseInt(req.params.assetId, 10);
      const currency = (["GS", "USDC"].includes(req.query.currency as string)
        ? req.query.currency : "GS") as string;

      if (isNaN(assetId)) return res.status(400).json({ message: "Invalid assetId" });

      const [balance] = await db
        .select({
          assetId:        playerEarningsBalance.assetId,
          currency:       playerEarningsBalance.currency,
          accruedBalance: playerEarningsBalance.accruedBalance,
          updatedAt:      playerEarningsBalance.updatedAt,
          displayName:    assets.displayName,
          assetUid:       assets.assetUid,
        })
        .from(playerEarningsBalance)
        .leftJoin(assets, eq(playerEarningsBalance.assetId, assets.id))
        .where(
          and(
            eq(playerEarningsBalance.assetId, assetId),
            eq(playerEarningsBalance.currency, currency),
          ),
        )
        .limit(1);

      const ledger = await db
        .select()
        .from(playerEarningsLedger)
        .where(
          and(
            eq(playerEarningsLedger.assetId, assetId),
            eq(playerEarningsLedger.currency, currency),
          ),
        )
        .orderBy(desc(playerEarningsLedger.id))
        .limit(100);

      return res.json({
        balance: balance ?? null,
        ledger,
      });
    } catch (err: any) {
      console.error("[PlayerEarnings] detail error:", err);
      return res.status(500).json({ message: err.message ?? "Failed" });
    }
  });

  // POST /api/admin/accounting/simulate-fee
  // Directly invokes captureTradeFees() for any currency without placing a real trade.
  // Used exclusively for CP3 (USDC) and dry-run validation.
  // Body: { referenceType, referenceId, currency, notional, feeBps? }
  app.post("/api/admin/accounting/simulate-fee", isAdminOnly, async (req: any, res) => {
    try {
      const schema = z.object({
        referenceType: z.string().min(1),
        referenceId:   z.string().min(1),
        currency:      z.enum(["GS", "USDC"]),
        notional:      z.number().positive(),
        feeBps:        z.number().int().positive().optional(),
      });
      const params = schema.parse(req.body);

      const result = await captureTradeFees({
        referenceType: params.referenceType,
        referenceId:   params.referenceId,
        currency:      params.currency,
        notional:      params.notional,
        feeBps:        params.feeBps,
      });

      return res.json({ success: true, feeBreakdown: result });
    } catch (err: any) {
      if (err?.name === "ZodError") return res.status(400).json({ message: err.errors[0].message });
      console.error("[SimulateFee] error:", err);
      return res.status(500).json({ message: err.message ?? "Failed" });
    }
  });

  // ── Revenue Intelligence ────────────────────────────────────────────────────
  // GET /api/admin/accounting/revenue-intelligence
  //   ?period=today|7d|30d|90d|all
  //   &currency=GS|USDC|all
  //   &comparison=none|prev
  // Single aggregation endpoint driving the 4-tab Revenue Intelligence dashboard.
  app.get("/api/admin/accounting/revenue-intelligence", isAdminOnly, async (req: any, res) => {
    try {
      const period = (["today", "7d", "30d", "90d", "all"].includes(req.query.period as string)
        ? req.query.period : "7d") as string;
      const currency = (["GS", "USDC", "all"].includes(req.query.currency as string)
        ? req.query.currency : "all") as string;
      const wantComparison = req.query.comparison === "prev";
      const engine = (["trade", "prediction", "all"].includes(req.query.engine as string)
        ? req.query.engine : "trade") as "trade" | "prediction" | "all";

      // ── Period bound helpers ─────────────────────────────────────────────────
      type Bounds = { start: Date | null; end: Date | null };

      function getCurrentBounds(): Bounds {
        const now = new Date();
        if (period === "today") { const s = new Date(now); s.setUTCHours(0, 0, 0, 0); return { start: s, end: null }; }
        if (period === "7d")  return { start: new Date(now.getTime() - 7  * 86400000), end: null };
        if (period === "30d") return { start: new Date(now.getTime() - 30 * 86400000), end: null };
        if (period === "90d") return { start: new Date(now.getTime() - 90 * 86400000), end: null };
        return { start: null, end: null };
      }

      function getPrevBounds(): Bounds | null {
        if (!wantComparison || period === "all") return null;
        const now = new Date();
        if (period === "today") {
          const end = new Date(now); end.setUTCHours(0, 0, 0, 0);
          return { start: new Date(end.getTime() - 86400000), end };
        }
        const ms = period === "7d" ? 7 * 86400000 : period === "30d" ? 30 * 86400000 : 90 * 86400000;
        return { start: new Date(now.getTime() - 2 * ms), end: new Date(now.getTime() - ms) };
      }

      // ── Core metric aggregator ───────────────────────────────────────────────
      async function computeMetrics(b: Bounds) {
        const flConds: any[] = [];
        if (b.start) flConds.push(gte(feeLedger.createdAt, b.start));
        if (b.end)   flConds.push(lte(feeLedger.createdAt, b.end));
        if (currency !== "all") flConds.push(eq(feeLedger.currency, currency as any));
        const flWhere = flConds.length ? and(...flConds) : undefined;

        const [agg] = await db.select({
          tradeCount:      count(),
          grossVolume:     sum(feeLedger.notional),
          totalFees:       sum(feeLedger.feeTotal),
          platformRevenue: sum(feeLedger.platformFee),
          playerPool:      sum(feeLedger.playerFee),
          liquidityPool:   sum(feeLedger.liquidityFee),
          activePlayers:   sql<number>`COUNT(DISTINCT CASE WHEN ${feeLedger.assetId} IS NOT NULL THEN ${feeLedger.assetId} END)::int`,
        }).from(feeLedger).where(flWhere);

        // Active traders: distinct users from wallet_ledger_entries
        // Only referenceType values 'trade' (market) and 'limit_trade' are confirmed
        const wleConds: any[] = [
          or(eq(walletLedgerEntries.referenceType, "trade"), eq(walletLedgerEntries.referenceType, "limit_trade")),
        ];
        if (b.start) wleConds.push(gte(walletLedgerEntries.createdAt, b.start));
        if (b.end)   wleConds.push(lte(walletLedgerEntries.createdAt, b.end));
        if (currency !== "all") wleConds.push(eq(walletLedgerEntries.currency, currency as any));

        const [traderAgg] = await db.select({
          activeTraders: sql<number>`COUNT(DISTINCT ${walletLedgerEntries.userId})::int`,
        }).from(walletLedgerEntries).where(and(...wleConds));

        const gv = parseFloat(agg.grossVolume ?? "0");
        const pr = parseFloat(agg.platformRevenue ?? "0");
        const tf = parseFloat(agg.totalFees ?? "0");
        const pp = parseFloat(agg.playerPool ?? "0");
        const lp = parseFloat(agg.liquidityPool ?? "0");
        const tc = Number(agg.tradeCount ?? 0);
        const at = Number(traderAgg?.activeTraders ?? 0);
        const ap = Number(agg.activePlayers ?? 0);

        return { tradeCount: tc, grossVolume: gv, totalFees: tf, platformRevenue: pr,
          playerPool: pp, liquidityPool: lp, activeTraders: at, activePlayers: ap,
          averageTradeSize:     tc > 0 ? gv / tc : 0,
          effectiveTakeRate:    gv > 0 ? pr / gv : 0,
          feeYield:             gv > 0 ? tf / gv : 0,
          revenuePerTrader:     at > 0 ? pr / at : 0,
          revenuePerTrade:      tc > 0 ? pr / tc : 0,
          volumePerActiveTrader: at > 0 ? gv / at : 0,
          volumePerActivePlayer: ap > 0 ? gv / ap : 0,
          tradesPerActiveTrader: at > 0 ? tc / at : 0,
        };
      }

      // ── Trend series ────────────────────────────────────────────────────────
      async function computeTrend(b: Bounds) {
        const truncExpr = period === "today"
          ? sql<string>`date_trunc('hour', ${feeLedger.createdAt})::text`
          : sql<string>`date_trunc('day',  ${feeLedger.createdAt})::text`;
        const groupExpr = period === "today"
          ? sql`date_trunc('hour', ${feeLedger.createdAt})`
          : sql`date_trunc('day',  ${feeLedger.createdAt})`;

        const conds: any[] = [];
        if (b.start) conds.push(gte(feeLedger.createdAt, b.start));
        if (b.end)   conds.push(lte(feeLedger.createdAt, b.end));
        if (currency !== "all") conds.push(eq(feeLedger.currency, currency as any));

        const rows = await db.select({
          bucket:          truncExpr,
          grossVolume:     sum(feeLedger.notional),
          platformRevenue: sum(feeLedger.platformFee),
          totalFees:       sum(feeLedger.feeTotal),
          tradeCount:      count(),
        }).from(feeLedger)
          .where(conds.length ? and(...conds) : undefined)
          .groupBy(groupExpr)
          .orderBy(groupExpr);

        return rows.map((r) => ({
          bucket:          r.bucket ?? "",
          grossVolume:     parseFloat(r.grossVolume ?? "0"),
          platformRevenue: parseFloat(r.platformRevenue ?? "0"),
          totalFees:       parseFloat(r.totalFees ?? "0"),
          tradeCount:      Number(r.tradeCount),
        }));
      }

      // ── Top players + concentration ─────────────────────────────────────────
      async function computeTopPlayers(b: Bounds, limit = 20) {
        const conds: any[] = [isNotNull(feeLedger.assetId)];
        if (b.start) conds.push(gte(feeLedger.createdAt, b.start));
        if (b.end)   conds.push(lte(feeLedger.createdAt, b.end));
        if (currency !== "all") conds.push(eq(feeLedger.currency, currency as any));

        const rows = await db.select({
          assetId:     feeLedger.assetId,
          displayName: assets.displayName,
          volume:      sum(feeLedger.notional),
          tradeCount:  count(),
        }).from(feeLedger)
          .leftJoin(assets, eq(feeLedger.assetId, assets.id))
          .where(and(...conds))
          .groupBy(feeLedger.assetId, assets.displayName)
          .orderBy(desc(sum(feeLedger.notional)))
          .limit(limit);

        const totalVol = rows.reduce((s, r) => s + parseFloat(r.volume ?? "0"), 0);
        return rows.map((r, i) => ({
          assetId:     r.assetId,
          displayName: r.displayName ?? `Player #${r.assetId}`,
          volume:      parseFloat(r.volume ?? "0"),
          tradeCount:  Number(r.tradeCount),
          share:       totalVol > 0 ? parseFloat(r.volume ?? "0") / totalVol : 0,
          rank:        i + 1,
        }));
      }

      // ── Prediction: revenue from settlements + volume from filled orders ─────
      const computePredictionMetrics = async (b: Bounds) => {
        const sConds: any[] = [];
        if (b.start) sConds.push(gte(predictionSettlements.settledAt, b.start));
        if (b.end)   sConds.push(lte(predictionSettlements.settledAt, b.end));
        const sWhere = sConds.length ? and(...sConds) : undefined;

        const [sAgg] = await db.select({
          settlementCount: count(),
          totalFees:       sum(predictionSettlements.fees),
          activeTraders:   sql<number>`COUNT(DISTINCT ${predictionSettlements.userId})::int`,
          activeMarkets:   sql<number>`COUNT(DISTINCT ${predictionSettlements.marketId})::int`,
        }).from(predictionSettlements).where(sWhere);

        // Gross volume from filled orders — best effort, 0 if no filled orders yet
        const oConds: any[] = [eq(predictionOrders.status, "filled")];
        if (b.start) oConds.push(gte(predictionOrders.createdAt, b.start));
        if (b.end)   oConds.push(lte(predictionOrders.createdAt, b.end));

        const [oAgg] = await db.select({
          tradeCount:  count(),
          grossVolume: sum(predictionOrders.totalValue),
        }).from(predictionOrders).where(and(...oConds));

        const tf = parseFloat(sAgg.totalFees ?? "0");
        const pr = tf;  // all prediction settlement fees flow to platform
        const sc = Number(sAgg.settlementCount ?? 0);
        const at = Number(sAgg.activeTraders ?? 0);
        const am = Number(sAgg.activeMarkets ?? 0);
        const tc = Number(oAgg.tradeCount ?? 0);
        const gv = parseFloat(oAgg.grossVolume ?? "0");

        return {
          tradeCount:            sc,   // settlement count (primary activity metric)
          grossVolume:           gv,   // from filled orders (0 if none exist yet)
          totalFees:             tf,
          platformRevenue:       pr,
          playerPool:            0,    // not applicable in prediction engine
          liquidityPool:         0,    // not applicable in prediction engine
          activeTraders:         at,
          activePlayers:         am,   // activeMarkets reused in this slot
          averageTradeSize:      tc > 0 ? gv / tc : 0,
          effectiveTakeRate:     gv > 0 ? pr / gv : 0,
          feeYield:              gv > 0 ? tf / gv : 0,
          revenuePerTrader:      at > 0 ? pr / at : 0,
          revenuePerTrade:       sc > 0 ? pr / sc : 0,
          volumePerActiveTrader: at > 0 ? gv / at : 0,
          volumePerActivePlayer: am > 0 ? gv / am : 0,
          tradesPerActiveTrader: at > 0 ? sc / at : 0,
        };
      }

      const computePredictionTrend = async (b: Bounds) => {
        const truncExpr = period === "today"
          ? sql<string>`date_trunc('hour', ${predictionSettlements.settledAt})::text`
          : sql<string>`date_trunc('day',  ${predictionSettlements.settledAt})::text`;
        const groupExpr = period === "today"
          ? sql`date_trunc('hour', ${predictionSettlements.settledAt})`
          : sql`date_trunc('day',  ${predictionSettlements.settledAt})`;

        const conds: any[] = [];
        if (b.start) conds.push(gte(predictionSettlements.settledAt, b.start));
        if (b.end)   conds.push(lte(predictionSettlements.settledAt, b.end));

        const rows = await db.select({
          bucket:          truncExpr,
          platformRevenue: sum(predictionSettlements.fees),
          totalFees:       sum(predictionSettlements.fees),
          tradeCount:      count(),
        }).from(predictionSettlements)
          .where(conds.length ? and(...conds) : undefined)
          .groupBy(groupExpr)
          .orderBy(groupExpr);

        return rows.map((r) => ({
          bucket:          r.bucket ?? "",
          grossVolume:     0,  // not available from settlements alone
          platformRevenue: parseFloat(r.platformRevenue ?? "0"),
          totalFees:       parseFloat(r.totalFees ?? "0"),
          tradeCount:      Number(r.tradeCount),
        }));
      }

      const computeTopMarkets = async (b: Bounds, limit = 20) => {
        const conds: any[] = [];
        if (b.start) conds.push(gte(predictionSettlements.settledAt, b.start));
        if (b.end)   conds.push(lte(predictionSettlements.settledAt, b.end));

        const rows = await db.select({
          marketId:    predictionSettlements.marketId,
          marketTitle: predictionMarkets.question,
          volume:      sum(predictionSettlements.fees),
          tradeCount:  count(),
        }).from(predictionSettlements)
          .leftJoin(predictionMarkets, eq(predictionSettlements.marketId, predictionMarkets.id))
          .where(conds.length ? and(...conds) : undefined)
          .groupBy(predictionSettlements.marketId, predictionMarkets.question)
          .orderBy(desc(sum(predictionSettlements.fees)))
          .limit(limit);

        const totalVol = rows.reduce((s, r) => s + parseFloat(r.volume ?? "0"), 0);
        return rows.map((r, i) => ({
          assetId:     r.marketId,
          displayName: r.marketTitle ?? `Market #${r.marketId}`,
          volume:      parseFloat(r.volume ?? "0"),
          tradeCount:  Number(r.tradeCount),
          share:       totalVol > 0 ? parseFloat(r.volume ?? "0") / totalVol : 0,
          rank:        i + 1,
        }));
      }

      // ── Shared helpers ───────────────────────────────────────────────────────
      const annualMultiplier: Record<string, number> = {
        today: 365, "7d": 365 / 7, "30d": 12, "90d": 4, all: 0,
      };

      const buildConcentration = (players: { volume: number }[]) => {
        const totalVol = players.reduce((s, p) => s + p.volume, 0);
        const topN = (n: number) =>
          totalVol > 0 ? players.slice(0, n).reduce((s, p) => s + p.volume, 0) / totalVol : 0;
        return {
          concentration: { top1Pct: topN(1), top5Pct: topN(5), top10Pct: topN(10), longTailPct: 1 - topN(10) },
          concentrationRatio: topN(10),
        };
      }

      // ── Branch by engine ─────────────────────────────────────────────────────
      const currBounds = getCurrentBounds();
      const prevBounds = getPrevBounds();

      const liquidityQuery = db.select({
        walletType: systemWallets.walletType, currency: systemWallets.currency, balance: systemWallets.balance,
      }).from(systemWallets).where(eq(systemWallets.walletType, "liquidity_pool"));

      if (engine === "trade") {
        // ── Trade-only (original behavior, unchanged) ──────────────────────────
        const [current, previous, trend, topPlayers, liquidityWallets] = await Promise.all([
          computeMetrics(currBounds),
          prevBounds ? computeMetrics(prevBounds) : Promise.resolve(null),
          computeTrend(currBounds),
          computeTopPlayers(currBounds),
          liquidityQuery,
        ]);
        const liqBalance = liquidityWallets
          .filter((w) => currency === "all" || w.currency === currency)
          .reduce((s, w) => s + parseFloat(w.balance ?? "0"), 0);
        const liquidityRatio = current.grossVolume > 0 ? liqBalance / current.grossVolume : 0;
        const { concentration, concentrationRatio } = buildConcentration(topPlayers);
        const annualizedRunRate = current.platformRevenue * (annualMultiplier[period] ?? 0);

        return res.json({
          engine, period, currency, comparisonAvailable: prevBounds !== null,
          current:  { ...current, liquidityRatio, concentrationRatio, annualizedRunRate },
          previous: previous ? { ...previous, liquidityRatio: 0, concentrationRatio: 0, annualizedRunRate: 0 } : null,
          trend, topPlayers, concentration, liqBalance,
        });
      }

      if (engine === "prediction") {
        // ── Prediction-only ────────────────────────────────────────────────────
        const [current, previous, trend, topPlayers] = await Promise.all([
          computePredictionMetrics(currBounds),
          prevBounds ? computePredictionMetrics(prevBounds) : Promise.resolve(null),
          computePredictionTrend(currBounds),
          computeTopMarkets(currBounds),
        ]);
        const annualizedRunRate = current.platformRevenue * (annualMultiplier[period] ?? 0);
        const { concentration, concentrationRatio } = buildConcentration(topPlayers);

        return res.json({
          engine, period, currency, comparisonAvailable: prevBounds !== null,
          current:  { ...current, liquidityRatio: 0, concentrationRatio, annualizedRunRate },
          previous: previous ? { ...previous, liquidityRatio: 0, concentrationRatio: 0, annualizedRunRate: 0 } : null,
          trend, topPlayers, concentration, liqBalance: 0,
        });
      }

      // ── All (consolidated view with per-engine breakdown) ──────────────────
      const [
        tradeCurrent, tradePrev, tradeTrend, tradeTopPlayers,
        predCurrent, predPrev,
        liquidityWallets,
      ] = await Promise.all([
        computeMetrics(currBounds),
        prevBounds ? computeMetrics(prevBounds) : Promise.resolve(null),
        computeTrend(currBounds),
        computeTopPlayers(currBounds),
        computePredictionMetrics(currBounds),
        prevBounds ? computePredictionMetrics(prevBounds) : Promise.resolve(null),
        liquidityQuery,
      ]);

      const liqBalance = liquidityWallets
        .filter((w) => currency === "all" || w.currency === currency)
        .reduce((s, w) => s + parseFloat(w.balance ?? "0"), 0);

      // Combined totals
      const allGv = tradeCurrent.grossVolume + predCurrent.grossVolume;
      const allPr = tradeCurrent.platformRevenue + predCurrent.platformRevenue;
      const allTf = tradeCurrent.totalFees + predCurrent.totalFees;
      const allTc = tradeCurrent.tradeCount + predCurrent.tradeCount;
      const allAt = tradeCurrent.activeTraders;
      const allAp = tradeCurrent.activePlayers;
      const liquidityRatio = allGv > 0 ? liqBalance / allGv : 0;
      const { concentration, concentrationRatio } = buildConcentration(tradeTopPlayers);
      const annualizedRunRate = allPr * (annualMultiplier[period] ?? 0);

      const allCurrent = {
        tradeCount: allTc, grossVolume: allGv, totalFees: allTf, platformRevenue: allPr,
        playerPool: tradeCurrent.playerPool, liquidityPool: tradeCurrent.liquidityPool,
        activeTraders: allAt, activePlayers: allAp,
        averageTradeSize:      allTc > 0 ? allGv / allTc : 0,
        effectiveTakeRate:     allGv > 0 ? allPr / allGv : 0,
        feeYield:              allGv > 0 ? allTf / allGv : 0,
        revenuePerTrader:      allAt > 0 ? allPr / allAt : 0,
        revenuePerTrade:       allTc > 0 ? allPr / allTc : 0,
        volumePerActiveTrader: allAt > 0 ? allGv / allAt : 0,
        volumePerActivePlayer: allAp > 0 ? allGv / allAp : 0,
        tradesPerActiveTrader: allAt > 0 ? allTc / allAt : 0,
        liquidityRatio, concentrationRatio, annualizedRunRate,
      };

      let allPrevious: typeof allCurrent | null = null;
      if (tradePrev && predPrev) {
        const pgv = tradePrev.grossVolume + predPrev.grossVolume;
        const ppr = tradePrev.platformRevenue + predPrev.platformRevenue;
        const ptf = tradePrev.totalFees + predPrev.totalFees;
        const ptc = tradePrev.tradeCount + predPrev.tradeCount;
        const pat = tradePrev.activeTraders;
        const pap = tradePrev.activePlayers;
        allPrevious = {
          tradeCount: ptc, grossVolume: pgv, totalFees: ptf, platformRevenue: ppr,
          playerPool: tradePrev.playerPool, liquidityPool: tradePrev.liquidityPool,
          activeTraders: pat, activePlayers: pap,
          averageTradeSize:      ptc > 0 ? pgv / ptc : 0,
          effectiveTakeRate:     pgv > 0 ? ppr / pgv : 0,
          feeYield:              pgv > 0 ? ptf / pgv : 0,
          revenuePerTrader:      pat > 0 ? ppr / pat : 0,
          revenuePerTrade:       ptc > 0 ? ppr / ptc : 0,
          volumePerActiveTrader: pat > 0 ? pgv / pat : 0,
          volumePerActivePlayer: pap > 0 ? pgv / pap : 0,
          tradesPerActiveTrader: pat > 0 ? ptc / pat : 0,
          liquidityRatio: 0, concentrationRatio: 0, annualizedRunRate: 0,
        };
      }

      return res.json({
        engine, period, currency, comparisonAvailable: prevBounds !== null,
        current:  allCurrent,
        previous: allPrevious,
        trend:    tradeTrend,
        topPlayers: tradeTopPlayers,
        concentration, liqBalance,
        breakdown: {
          trade: {
            current:  { ...tradeCurrent, liquidityRatio, concentrationRatio, annualizedRunRate: tradeCurrent.platformRevenue * (annualMultiplier[period] ?? 0) },
            previous: tradePrev ? { ...tradePrev, liquidityRatio: 0, concentrationRatio: 0, annualizedRunRate: 0 } : null,
          },
          prediction: {
            current:  { ...predCurrent, liquidityRatio: 0, concentrationRatio: 0, annualizedRunRate: predCurrent.platformRevenue * (annualMultiplier[period] ?? 0) },
            previous: predPrev ? { ...predPrev, liquidityRatio: 0, concentrationRatio: 0, annualizedRunRate: 0 } : null,
          },
        },
      });
    } catch (err: any) {
      console.error("[RevenueIntelligence] error:", err);
      return res.status(500).json({ message: err.message ?? "Failed" });
    }
  });
}
