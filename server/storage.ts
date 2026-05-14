import { db } from "./db";
import {
  vaults, vaultSnapshots, portfolios, positions, trades, users, watchlist, waitlist,
  type Vault, type InsertVault, type Portfolio, type InsertPortfolio,
  type Position, type Trade, type VaultSnapshot, type User
} from "@shared/schema";
import { eq, desc, and, ilike, sql, ne, not, inArray } from "drizzle-orm";

export interface IStorage {
  // ─── Vaults ─────────────────────────────────────────────────────────────────
  // LEGACY — Sandbox / Vault model. Do not add new methods here.
  // Official asset data lives in: riotAssets, assets, assetMarketState (Drizzle schema)
  // Official access pattern: db.select().from(riotAssets) or /api/market/assets
  // Retirement: remove once vault-detail page is migrated and sandbox mode is retired.
  // See: docs/architecture/legacy-freeze-and-retirement-plan.md
  getVaults(options?: {
    page?: number;
    limit?: number;
    search?: string;
    rank?: string;
    region?: string;
    sort?: string;
    order?: "asc" | "desc";
  }): Promise<{ data: Vault[]; total: number }>;
  getVault(id: number): Promise<Vault | undefined>;
  getVaultSnapshots(vaultId: number): Promise<VaultSnapshot[]>;
  createVault(vault: InsertVault): Promise<Vault>;
  updateVault(id: number, updates: Partial<Vault>): Promise<Vault>;
  createVaultSnapshot(snapshot: { vaultId: number; price: string; performanceIndex: string }): Promise<VaultSnapshot>;

  // Portfolios
  getPortfolioByUserId(userId: string): Promise<Portfolio | undefined>;
  createPortfolio(portfolio: InsertPortfolio): Promise<Portfolio>;
  updatePortfolioBalance(portfolioId: number, newBalance: string): Promise<Portfolio>;

  // Positions
  getPositionsByPortfolioId(portfolioId: number): Promise<(Position & { vault: Vault })[]>;
  getPosition(portfolioId: number, vaultId: number): Promise<Position | undefined>;
  upsertPosition(position: { portfolioId: number; vaultId: number; shares: number; averageCost: string }): Promise<Position>;

  // Trades
  createTrade(trade: { portfolioId: number; vaultId: number; type: "BUY" | "SELL"; shares: number; pricePerShare: string; totalCost: string; fee: string }): Promise<Trade>;
  getTradesByPortfolioId(portfolioId: number): Promise<Trade[]>;
  getRecentTrades(limit: number): Promise<(Trade & { vault: Vault })[]>;

  // Watchlist
  getWatchlist(userId: string): Promise<(Vault)[]>;
  addToWatchlist(userId: string, vaultId: number): Promise<void>;
  removeFromWatchlist(userId: string, vaultId: number): Promise<void>;
  isInWatchlist(userId: string, vaultId: number): Promise<boolean>;
  getMarketStats(): Promise<{
    buyCount: number;
    sellCount: number;
    volume24h: string;
    tradesLastMinute: number;
  }>;

  // Waitlist
  addToWaitlist(data: { email: string, discord?: string }): Promise<void>;
  isEmailOnWaitlist(email: string): Promise<boolean>;

  // Admin
  getAdminUsers(): Promise<User[]>;
  updateUserStatus(userId: string, status: string): Promise<User>;
  getAdminMetrics(): Promise<{
    totalUsers: number;
    totalTrades: number;
    totalVolume: string;
    activeUsers24h: number;
  }>;
  getAdminUserDetail(userId: string): Promise<{
    user: User;
    portfolio: Portfolio | null;
    positions: (Position & { vault: Vault })[];
    watchlistItems: Vault[];
    recentTrades: (Trade & { vault: Vault })[];
  }>;
}

export class DatabaseStorage implements IStorage {
  async addToWaitlist(data: { email: string, discord?: string }) {
    await db.insert(waitlist).values(data);
  }

  async isEmailOnWaitlist(email: string) {
    const [entry] = await db.select().from(waitlist).where(eq(waitlist.email, email));
    return !!entry;
  }

  async getVaults(options: {
    page?: number;
    limit?: number;
    search?: string;
    rank?: string;
    region?: string;
    sort?: string;
    order?: "asc" | "desc";
  } = {}) {
    const page = options.page || 1;
    const limit = options.limit || 50;
    const offset = (page - 1) * limit;

    let conditions = [];
    if (options.search) {
      conditions.push(ilike(vaults.playerAlias, `%${options.search}%`));
    }
    if (options.rank) {
      conditions.push(eq(vaults.rank, options.rank));
    }
    if (options.region) {
      conditions.push(eq(vaults.region, options.region));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    let orderByClause;
    if (options.sort) {
      const orderFn = options.order === "asc" ? sql`${vaults[options.sort as keyof typeof vaults]} ASC` : desc(vaults[options.sort as keyof typeof vaults]);
      orderByClause = orderFn;
    } else {
      orderByClause = desc(vaults.lastTradePrice);
    }

    // Get paginated data
    const data = await db.select().from(vaults).where(whereClause).orderBy(orderByClause).limit(limit).offset(offset);

    // Get total count
    const [countResult] = await db.select({ count: sql<number>`count(*)` }).from(vaults).where(whereClause);
    const total = Number(countResult.count);

    return { data, total };
  }

  async getVault(id: number) {
    const [vault] = await db.select().from(vaults).where(eq(vaults.id, id));
    return vault;
  }

  async getVaultSnapshots(vaultId: number) {
    return await db.select().from(vaultSnapshots).where(eq(vaultSnapshots.vaultId, vaultId)).orderBy(vaultSnapshots.recordedAt);
  }

  async createVault(vaultData: InsertVault) {
    const [vault] = await db.insert(vaults).values(vaultData).returning();
    return vault;
  }

  async updateVault(id: number, updates: Partial<Vault>) {
    const [vault] = await db.update(vaults).set({ ...updates, updatedAt: new Date() }).where(eq(vaults.id, id)).returning();
    return vault;
  }

  async createVaultSnapshot(snapshot: { vaultId: number; price: string; performanceIndex: string }) {
    const [newSnapshot] = await db.insert(vaultSnapshots).values(snapshot).returning();
    return newSnapshot;
  }

  // Users
  async getUser(id: string) {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async createUser(userData: any) {
    const [user] = await db.insert(users).values(userData).returning();
    return user;
  }

  async getPortfolioByUserId(userId: string) {
    const [portfolio] = await db.select().from(portfolios).where(eq(portfolios.userId, userId));
    return portfolio;
  }

  async createPortfolio(portfolioData: InsertPortfolio) {
    const [portfolio] = await db.insert(portfolios).values(portfolioData).returning();
    return portfolio;
  }

  async updatePortfolioBalance(portfolioId: number, newBalance: string) {
    const [portfolio] = await db.update(portfolios).set({ balance: newBalance, updatedAt: new Date() }).where(eq(portfolios.id, portfolioId)).returning();
    return portfolio;
  }

  async getPositionsByPortfolioId(portfolioId: number) {
    const result = await db.select({
      position: positions,
      vault: vaults
    }).from(positions)
      .innerJoin(vaults, eq(positions.vaultId, vaults.id))
      .where(and(eq(positions.portfolioId, portfolioId), sql`${positions.shares} > 0`));

    return result.map(r => ({ ...r.position, vault: r.vault }));
  }

  async getPosition(portfolioId: number, vaultId: number) {
    const [position] = await db.select().from(positions).where(and(eq(positions.portfolioId, portfolioId), eq(positions.vaultId, vaultId)));
    return position;
  }

  async upsertPosition(positionData: { portfolioId: number; vaultId: number; assetId?: number | null; shares: number; averageCost: string }) {
    const [position] = await db.insert(positions)
      .values(positionData)
      .onConflictDoUpdate({
        target: [positions.portfolioId, positions.vaultId],
        set: {
          shares: positionData.shares,
          averageCost: positionData.averageCost,
          assetId: positionData.assetId ?? null,
          updatedAt: new Date()
        }
      }).returning();
    return position;
  }

  async createTrade(tradeData: { portfolioId: number; vaultId: number; assetId?: number | null; type: "BUY" | "SELL"; shares: number; pricePerShare: string; totalCost: string; fee: string }) {
    const [trade] = await db.insert(trades).values(tradeData).returning();
    return trade;
  }

  async getTradesByPortfolioId(portfolioId: number) {
    return await db.select().from(trades).where(eq(trades.portfolioId, portfolioId)).orderBy(desc(trades.executedAt));
  }

  async getRecentTrades(limit: number) {
    const result = await db.select({
      trade: trades,
      vault: vaults
    }).from(trades)
      .innerJoin(vaults, eq(trades.vaultId, vaults.id))
      .orderBy(desc(trades.executedAt))
      .limit(limit);

    return result.map(r => ({ ...r.trade, vault: r.vault }));
  }

  async getWatchlist(userId: string) {
    try {
      const result = await db.select({
        vault: vaults
      }).from(watchlist)
        .innerJoin(vaults, eq(watchlist.vaultId, vaults.id))
        .where(eq(watchlist.userId, userId));
      return result.map(r => r.vault);
    } catch (error) {
      console.error("Error in getWatchlist storage method:", error);
      throw error;
    }
  }

  async addToWatchlist(userId: string, vaultId: number) {
    await db.insert(watchlist)
      .values({ userId, vaultId })
      .onConflictDoNothing();
  }

  async removeFromWatchlist(userId: string, vaultId: number) {
    await db.delete(watchlist).where(and(eq(watchlist.userId, userId), eq(watchlist.vaultId, vaultId)));
  }

  async isInWatchlist(userId: string, vaultId: number) {
    const [entry] = await db.select().from(watchlist).where(and(eq(watchlist.userId, userId), eq(watchlist.vaultId, vaultId)));
    return !!entry;
  }

  async getMarketStats() {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const oneMinuteAgo = new Date(now.getTime() - 60 * 1000);

    // Last 100 trades for sentiment
    const last100 = await db.select().from(trades).orderBy(desc(trades.executedAt)).limit(100);
    const buyCount = last100.filter(t => t.type === "BUY").length;
    const sellCount = last100.filter(t => t.type === "SELL").length;

    // 24h Volume
    const [volResult] = await db.select({ 
      total: sql<string>`sum(cast(${trades.totalCost} as numeric))` 
    }).from(trades).where(sql`${trades.executedAt} >= ${oneDayAgo}`);

    // Last minute trade count
    const [minuteResult] = await db.select({
      count: sql<number>`count(*)`
    }).from(trades).where(sql`${trades.executedAt} >= ${oneMinuteAgo}`);

    return {
      buyCount,
      sellCount,
      volume24h: volResult.total || "0.00",
      tradesLastMinute: Number(minuteResult.count)
    };
  }

  async getAdminUsers() {
    const SYSTEM_IDS = ["admin", "MarketMaker"];
    return await db
      .select()
      .from(users)
      .where(not(inArray(users.id, SYSTEM_IDS)))
      .orderBy(desc(users.createdAt));
  }

  async updateUserStatus(userId: string, status: string) {
    const [user] = await db
      .update(users)
      .set({ status, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();
    return user;
  }

  async getAdminMetrics() {
    const SYSTEM_IDS = ["admin", "MarketMaker"];
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [totalUsersRes] = await db
      .select({ count: sql<number>`count(*)` })
      .from(users)
      .where(not(inArray(users.id, SYSTEM_IDS)));

    const [totalTradesRes] = await db
      .select({ count: sql<number>`count(*)` })
      .from(trades);

    const [totalVolumeRes] = await db
      .select({ total: sql<string>`coalesce(sum(cast(${trades.totalCost} as numeric)), 0)` })
      .from(trades);

    const recentPortfolioIds = await db
      .select({ portfolioId: trades.portfolioId })
      .from(trades)
      .where(sql`${trades.executedAt} >= ${oneDayAgo}`)
      .groupBy(trades.portfolioId);

    const pids = recentPortfolioIds.map(r => r.portfolioId);
    let activeUsers24h = 0;
    if (pids.length > 0) {
      const [activeRes] = await db
        .select({ count: sql<number>`count(distinct ${portfolios.userId})` })
        .from(portfolios)
        .where(and(
          inArray(portfolios.id, pids),
          not(inArray(portfolios.userId, SYSTEM_IDS))
        ));
      activeUsers24h = Number(activeRes.count);
    }

    return {
      totalUsers: Number(totalUsersRes.count),
      totalTrades: Number(totalTradesRes.count),
      totalVolume: totalVolumeRes.total || "0",
      activeUsers24h,
    };
  }

  async getAdminUserDetail(userId: string) {
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user) throw new Error("User not found");

    const portfolio = await this.getPortfolioByUserId(userId);
    let userPositions: (Position & { vault: Vault })[] = [];
    let userTrades: (Trade & { vault: Vault })[] = [];

    if (portfolio) {
      userPositions = await this.getPositionsByPortfolioId(portfolio.id);
      const rawTrades = await db
        .select({ trade: trades, vault: vaults })
        .from(trades)
        .innerJoin(vaults, eq(trades.vaultId, vaults.id))
        .where(eq(trades.portfolioId, portfolio.id))
        .orderBy(desc(trades.executedAt))
        .limit(20);
      userTrades = rawTrades.map(r => ({ ...r.trade, vault: r.vault }));
    }

    const watchlistItems = await this.getWatchlist(userId);

    return {
      user,
      portfolio: portfolio || null,
      positions: userPositions,
      watchlistItems,
      recentTrades: userTrades,
    };
  }
}

export const storage = new DatabaseStorage();
