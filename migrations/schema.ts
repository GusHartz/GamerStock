import { pgTable, unique, serial, text, timestamp, varchar, index, jsonb, boolean, integer, numeric, date, foreignKey, uniqueIndex, check, primaryKey } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"



export const waitlist = pgTable("waitlist", {
        id: serial().primaryKey().notNull(),
        email: text().notNull(),
        discord: text(),
        createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
        unique("waitlist_email_unique").on(table.email),
]);

export const accessRequests = pgTable("access_requests", {
        id: varchar().default(gen_random_uuid()).primaryKey().notNull(),
        fullName: varchar("full_name").notNull(),
        email: varchar().notNull(),
        region: varchar(),
        primaryGame: varchar("primary_game"),
        usernameInterest: varchar("username_interest"),
        note: text(),
        status: varchar().default('pending').notNull(),
        reviewedByUserId: varchar("reviewed_by_user_id"),
        reviewedAt: timestamp("reviewed_at", { mode: 'string' }),
        createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
});

export const passwordResetTokens = pgTable("password_reset_tokens", {
        id: varchar().default(gen_random_uuid()).primaryKey().notNull(),
        userId: varchar("user_id").notNull(),
        tokenHash: varchar("token_hash").notNull(),
        expiresAt: timestamp("expires_at", { mode: 'string' }).notNull(),
        usedAt: timestamp("used_at", { mode: 'string' }),
        createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
});

export const sessions = pgTable("sessions", {
        sid: varchar().primaryKey().notNull(),
        sess: jsonb().notNull(),
        expire: timestamp({ mode: 'string' }).notNull(),
}, (table) => [
        index("IDX_session_expire").using("btree", table.expire.asc().nullsLast().op("timestamp_ops")),
]);

export const users = pgTable("users", {
        id: varchar().default(gen_random_uuid()).primaryKey().notNull(),
        email: varchar(),
        firstName: varchar("first_name"),
        lastName: varchar("last_name"),
        profileImageUrl: varchar("profile_image_url"),
        createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
        updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
        displayName: varchar("display_name"),
        passwordHash: varchar("password_hash"),
        gamesSelected: text("games_selected").array(),
        gamesOther: varchar("games_other"),
        role: varchar().default('user'),
        emailVerified: boolean("email_verified").default(false),
        status: varchar().default('active'),
        isBot: boolean("is_bot").default(false),
        mustChangePassword: boolean("must_change_password").default(false),
        blockedAt: timestamp("blocked_at", { mode: 'string' }),
        lastLoginAt: timestamp("last_login_at", { mode: 'string' }),
        createdByAdmin: boolean("created_by_admin").default(false),
}, (table) => [
        unique("users_email_unique").on(table.email),
]);

export const riotAssets = pgTable("riot_assets", {
        puuid: text().primaryKey().notNull(),
        gameName: text("game_name").notNull(),
        tagLine: text("tag_line").default("").notNull(),
        leaguePoints: integer("league_points").default(0).notNull(),
        wins: integer().default(0).notNull(),
        losses: integer().default(0).notNull(),
        winrate: numeric({ precision: 5, scale:  2 }).default('0.00').notNull(),
        lastTradePrice: numeric("last_trade_price", { precision: 10, scale:  2 }).notNull(),
        price24HAgo: numeric("price_24h_ago", { precision: 10, scale:  2 }).notNull(),
        volume24H: numeric("volume_24h", { precision: 15, scale:  2 }).default('0.00').notNull(),
        momentum: numeric({ precision: 8, scale:  4 }).default('0.0000').notNull(),
        lastSyncedAt: timestamp("last_synced_at", { mode: 'string' }).defaultNow().notNull(),
        createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
        updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
        index("riot_asset_lp_idx").using("btree", table.leaguePoints.asc().nullsLast().op("int4_ops")),
]);

export const markets = pgTable("markets", {
        id: serial().primaryKey().notNull(),
        provider: text().notNull(),
        game: text().notNull(),
        region: text().default('global').notNull(),
        scope: text().default('default').notNull(),
        isActive: boolean("is_active").default(true).notNull(),
        createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
        updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
        index("markets_provider_game_idx").using("btree", table.provider.asc().nullsLast().op("text_ops"), table.game.asc().nullsLast().op("text_ops")),
        unique("markets_provider_game_region_scope_unique").on(table.provider, table.game, table.region, table.scope),
]);

export const riotMatchCache = pgTable("riot_match_cache", {
        matchId: text("match_id").primaryKey().notNull(),
        puuid: text().notNull(),
        gameStartTimestamp: numeric("game_start_timestamp", { precision: 15, scale:  0 }).default('0').notNull(),
        processedAt: timestamp("processed_at", { mode: 'string' }).defaultNow().notNull(),
        teamPosition: text("team_position").default("").notNull(),
        perfScore: numeric("perf_score", { precision: 6, scale:  2 }).default('50.00').notNull(),
}, (table) => [
        index("match_cache_puuid_idx").using("btree", table.puuid.asc().nullsLast().op("text_ops")),
]);

export const riotPlayerState = pgTable("riot_player_state", {
        puuid: text().primaryKey().notNull(),
        emaPerf: numeric("ema_perf", { precision: 6, scale:  2 }).default('50.00').notNull(),
        dayStartPrice: numeric("day_start_price", { precision: 10, scale:  2 }).default('10.00').notNull(),
        dayStartDate: date("day_start_date").default(sql`CURRENT_DATE`).notNull(),
        dailyChangePct: numeric("daily_change_pct", { precision: 8, scale:  4 }).default('0.0000').notNull(),
        updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
});

export const riotPlayers = pgTable("riot_players", {
        id: varchar().default(gen_random_uuid()).primaryKey().notNull(),
        platform: text().default('NA1').notNull(),
        queue: text().default('RANKED_SOLO_5x5').notNull(),
        summonerId: text("summoner_id").notNull(),
        summonerName: text("summoner_name").notNull(),
        leaguePoints: integer("league_points").default(0).notNull(),
        wins: integer().default(0).notNull(),
        losses: integer().default(0).notNull(),
        winrate: numeric({ precision: 5, scale:  2 }).default('0.00').notNull(),
        tier: text().default('CHALLENGER').notNull(),
        rank: text().default('I').notNull(),
        lastSyncedAt: timestamp("last_synced_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
        index("riot_player_lp_idx").using("btree", table.leaguePoints.asc().nullsLast().op("int4_ops")),
        unique("riot_player_platform_queue_summoner").on(table.platform, table.queue, table.summonerId),
]);

export const vaults = pgTable("vaults", {
        id: serial().primaryKey().notNull(),
        playerAlias: text("player_alias").notNull(),
        rank: text().notNull(),
        region: text().notNull(),
        winrate: numeric({ precision: 5, scale:  2 }).notNull(),
        performanceIndex: numeric("performance_index", { precision: 10, scale:  2 }).default('100.00').notNull(),
        momentum: numeric({ precision: 5, scale:  2 }).default('0.00').notNull(),
        lastTradePrice: numeric("last_trade_price", { precision: 10, scale:  2 }).notNull(),
        price24HAgo: numeric("price_24h_ago", { precision: 10, scale:  2 }).default('10.00').notNull(),
        volume24H: numeric("volume_24h", { precision: 15, scale:  2 }).default('0.00').notNull(),
        updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
        createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
        assetId: integer("asset_id"),
}, (table) => [
        foreignKey({
                        columns: [table.assetId],
                        foreignColumns: [assets.id],
                        name: "vaults_asset_id_assets_id_fk"
                }),
]);

export const performanceScores = pgTable("performance_scores", {
        id: serial().primaryKey().notNull(),
        assetId: text("asset_id").notNull(),
        matchId: text("match_id").notNull(),
        role: text().notNull(),
        matchScore: numeric("match_score", { precision: 8, scale:  4 }).notNull(),
        emaScore: numeric("ema_score", { precision: 8, scale:  4 }).notNull(),
        createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
        index("performance_scores_asset_idx").using("btree", table.assetId.asc().nullsLast().op("text_ops")),
        index("performance_scores_created_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamp_ops")),
]);

export const playerMatchMetrics = pgTable("player_match_metrics", {
        id: serial().primaryKey().notNull(),
        assetId: text("asset_id").notNull(),
        matchId: text("match_id").notNull(),
        game: text().default('LOL').notNull(),
        role: text().notNull(),
        metricsJson: jsonb("metrics_json").notNull(),
        createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
        index("player_match_metrics_asset_idx").using("btree", table.assetId.asc().nullsLast().op("text_ops")),
        index("player_match_metrics_created_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamp_ops")),
        unique("player_match_metrics_unique").on(table.assetId, table.matchId),
]);

export const roleBaselines = pgTable("role_baselines", {
        id: serial().primaryKey().notNull(),
        game: text().notNull(),
        queue: text().default('RANKED_SOLO').notNull(),
        tier: text().default('CHALLENGER').notNull(),
        role: text().notNull(),
        metric: text().notNull(),
        meanValue: numeric("mean_value", { precision: 12, scale:  4 }).notNull(),
        stdDev: numeric("std_dev", { precision: 12, scale:  4 }).notNull(),
        sampleSize: integer("sample_size").default(0).notNull(),
        updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
        index("role_baselines_role_idx").using("btree", table.game.asc().nullsLast().op("text_ops"), table.role.asc().nullsLast().op("text_ops")),
        unique("role_baselines_unique").on(table.game, table.queue, table.tier, table.role, table.metric),
]);

export const roleMetricWeights = pgTable("role_metric_weights", {
        id: serial().primaryKey().notNull(),
        game: text().notNull(),
        role: text().notNull(),
        metric: text().notNull(),
        weight: numeric({ precision: 6, scale:  4 }).notNull(),
}, (table) => [
        index("role_metric_weights_role_idx").using("btree", table.game.asc().nullsLast().op("text_ops"), table.role.asc().nullsLast().op("text_ops")),
        unique("role_metric_weights_unique").on(table.game, table.role, table.metric),
]);

export const assetMarketState = pgTable("asset_market_state", {
        assetId: integer("asset_id").primaryKey().notNull(),
        supply: numeric({ precision: 18, scale:  6 }).default('0.000000').notNull(),
        lastPrice: numeric("last_price", { precision: 18, scale:  6 }).default('10.000000').notNull(),
        lastUpdatedAt: timestamp("last_updated_at", { mode: 'string' }).defaultNow().notNull(),
        version: integer().default(0).notNull(),
}, (table) => [
        foreignKey({
                        columns: [table.assetId],
                        foreignColumns: [assets.id],
                        name: "asset_market_state_asset_id_assets_id_fk"
                }),
]);

export const appConfig = pgTable("app_config", {
        key: text().primaryKey().notNull(),
        value: text().notNull(),
        updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
});

export const assetValuationState = pgTable("asset_valuation_state", {
        assetId: integer("asset_id").primaryKey().notNull(),
        puuid: text().notNull(),
        recentPerformance: numeric("recent_performance", { precision: 8, scale:  4 }).default('50.0000').notNull(),
        consistencyScore: numeric("consistency_score", { precision: 8, scale:  4 }).default('50.0000').notNull(),
        historicalSkill: numeric("historical_skill", { precision: 8, scale:  4 }).default('50.0000').notNull(),
        activityScore: numeric("activity_score", { precision: 8, scale:  4 }).default('50.0000').notNull(),
        pviRaw: numeric("pvi_raw", { precision: 8, scale:  4 }).default('50.0000').notNull(),
        pviFinal: numeric("pvi_final", { precision: 8, scale:  4 }).default('50.0000').notNull(),
        pviAdjusted: numeric("pvi_adjusted", { precision: 8, scale:  4 }).default('50.0000').notNull(),
        confidenceScore: numeric("confidence_score", { precision: 6, scale:  4 }).default('0.0000').notNull(),
        fairValueGs: numeric("fair_value_gs", { precision: 10, scale:  4 }).default('5.0000').notNull(),
        divergencePct: numeric("divergence_pct", { precision: 10, scale:  4 }).default('0.0000').notNull(),
        lastMatchPulse: numeric("last_match_pulse", { precision: 8, scale:  4 }).default('50.0000').notNull(),
        updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
        index("asset_valuation_puuid_idx").using("btree", table.puuid.asc().nullsLast().op("text_ops")),
        index("asset_valuation_updated_idx").using("btree", table.updatedAt.asc().nullsLast().op("timestamp_ops")),
        foreignKey({
                        columns: [table.assetId],
                        foreignColumns: [assets.id],
                        name: "asset_valuation_state_asset_id_assets_id_fk"
                }),
]);

export const newsEvents = pgTable("news_events", {
        id: serial().primaryKey().notNull(),
        externalId: varchar("external_id", { length: 255 }).notNull(),
        title: text().notNull(),
        summary: text(),
        source: varchar({ length: 100 }),
        sourceUrl: text("source_url"),
        game: varchar({ length: 50 }),
        category: varchar({ length: 100 }),
        eventType: varchar("event_type", { length: 50 }),
        sentiment: varchar({ length: 20 }),
        impactLevel: varchar("impact_level", { length: 20 }),
        entityTags: jsonb("entity_tags"),
        publishedAt: timestamp("published_at", { withTimezone: true, mode: 'string' }),
        isActive: boolean("is_active").default(true),
        createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
        index("news_events_external_id_idx").using("btree", table.externalId.asc().nullsLast().op("text_ops")),
        index("news_events_game_idx").using("btree", table.game.asc().nullsLast().op("text_ops")),
        index("news_events_published_at_idx").using("btree", table.publishedAt.asc().nullsLast().op("timestamptz_ops")),
        index("news_events_sentiment_idx").using("btree", table.sentiment.asc().nullsLast().op("text_ops")),
        unique("news_events_external_id_unique").on(table.externalId),
]);

export const idempotencyKeys = pgTable("idempotency_keys", {
        id: serial().primaryKey().notNull(),
        key: text().notNull(),
        userId: text("user_id").notNull(),
        endpoint: text().notNull(),
        response: jsonb(),
        status: text().default('completed').notNull(),
        createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
}, (table) => [
        uniqueIndex("idempotency_unique").using("btree", table.key.asc().nullsLast().op("text_ops"), table.userId.asc().nullsLast().op("text_ops"), table.endpoint.asc().nullsLast().op("text_ops")),
]);

export const marketSyncRuns = pgTable("market_sync_runs", {
        id: serial().primaryKey().notNull(),
        marketId: integer("market_id").notNull(),
        startedAt: timestamp("started_at", { mode: 'string' }).notNull(),
        finishedAt: timestamp("finished_at", { mode: 'string' }),
        durationMs: integer("duration_ms"),
        status: text().notNull(),
        rowsFetched: integer("rows_fetched"),
        rowsUpdated: integer("rows_updated"),
        errorMessage: text("error_message"),
});

export const marketSyncStatus = pgTable("market_sync_status", {
        marketId: integer("market_id").primaryKey().notNull(),
        lastSuccessAt: timestamp("last_success_at", { mode: 'string' }),
        consecutiveFailures: integer("consecutive_failures").default(0),
        pausedUntil: timestamp("paused_until", { mode: 'string' }),
        lastError: text("last_error"),
});

export const assetPriceSnapshots = pgTable("asset_price_snapshots", {
        id: serial().primaryKey().notNull(),
        assetId: integer("asset_id").notNull(),
        price: numeric({ precision: 10, scale:  2 }).notNull(),
        volume24H: numeric("volume_24h", { precision: 15, scale:  2 }).default('0.00').notNull(),
        momentum: numeric({ precision: 8, scale:  4 }).default('0.0000').notNull(),
        recordedAt: timestamp("recorded_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
        index("asset_snap_asset_time_idx").using("btree", table.assetId.asc().nullsLast().op("int4_ops"), table.recordedAt.asc().nullsLast().op("int4_ops")),
        foreignKey({
                        columns: [table.assetId],
                        foreignColumns: [assets.id],
                        name: "asset_price_snapshots_asset_id_assets_id_fk"
                }),
]);

export const assetMarkets = pgTable("asset_markets", {
        assetId: integer("asset_id").primaryKey().notNull(),
        curveType: text("curve_type").default('LOG').notNull(),
        floorPrice: numeric("floor_price", { precision: 18, scale:  6 }).default('5.000000').notNull(),
        paramA: numeric("param_a", { precision: 18, scale:  6 }).default('5.000000').notNull(),
        paramB: numeric("param_b", { precision: 18, scale:  6 }).default('100.000000').notNull(),
        feeBps: integer("fee_bps").default(100).notNull(),
        platformFeeSplitBps: integer("platform_fee_split_bps").default(7000).notNull(),
        playerFeeSplitBps: integer("player_fee_split_bps").default(3000).notNull(),
        isEnabled: boolean("is_enabled").default(true).notNull(),
        updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
        foreignKey({
                        columns: [table.assetId],
                        foreignColumns: [assets.id],
                        name: "asset_markets_asset_id_assets_id_fk"
                }),
]);

export const assetNewsPulses = pgTable("asset_news_pulses", {
        id: serial().primaryKey().notNull(),
        assetId: integer("asset_id"),
        newsEventId: integer("news_event_id"),
        direction: varchar({ length: 20 }).notNull(),
        strength: numeric({ precision: 6, scale:  4 }).notNull(),
        reason: text(),
        decayUntil: timestamp("decay_until", { withTimezone: true, mode: 'string' }).notNull(),
        createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
        index("asset_news_pulses_asset_idx").using("btree", table.assetId.asc().nullsLast().op("int4_ops")),
        index("asset_news_pulses_decay_idx").using("btree", table.decayUntil.asc().nullsLast().op("timestamptz_ops")),
        index("asset_news_pulses_news_event_idx").using("btree", table.newsEventId.asc().nullsLast().op("int4_ops")),
        foreignKey({
                        columns: [table.assetId],
                        foreignColumns: [assets.id],
                        name: "asset_news_pulses_asset_id_assets_id_fk"
                }),
        foreignKey({
                        columns: [table.newsEventId],
                        foreignColumns: [newsEvents.id],
                        name: "asset_news_pulses_news_event_id_news_events_id_fk"
                }),
]);

export const portfolios = pgTable("portfolios", {
        id: serial().primaryKey().notNull(),
        userId: varchar("user_id").notNull(),
        balance: numeric({ precision: 15, scale:  2 }).default('10000.00').notNull(),
        updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
        foreignKey({
                        columns: [table.userId],
                        foreignColumns: [users.id],
                        name: "portfolios_user_id_users_id_fk"
                }),
        unique("portfolios_user_id_unique").on(table.userId),
]);

export const ledgerEntries = pgTable("ledger_entries", {
        id: serial().primaryKey().notNull(),
        userId: text("user_id").notNull(),
        portfolioId: integer("portfolio_id").notNull(),
        assetId: integer("asset_id"),
        type: text().notNull(),
        amount: numeric({ precision: 18, scale:  6 }).notNull(),
        currency: text().notNull(),
        referenceType: text("reference_type"),
        referenceId: integer("reference_id"),
        createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
}, (table) => [
        index("ledger_portfolio_idx").using("btree", table.portfolioId.asc().nullsLast().op("int4_ops")),
        index("ledger_reference_idx").using("btree", table.referenceType.asc().nullsLast().op("int4_ops"), table.referenceId.asc().nullsLast().op("text_ops")),
        index("ledger_user_idx").using("btree", table.userId.asc().nullsLast().op("text_ops")),
]);

export const triggerOrders = pgTable("trigger_orders", {
        id: varchar().default(gen_random_uuid()).primaryKey().notNull(),
        userId: varchar("user_id").notNull(),
        assetId: text("asset_id").notNull(),
        mode: text().default('SANDBOX').notNull(),
        side: text().notNull(),
        orderType: text("order_type").notNull(),
        triggerPrice: numeric("trigger_price", { precision: 18, scale:  6 }).notNull(),
        quantity: integer().notNull(),
        timeInForce: text("time_in_force").default('GTC').notNull(),
        status: text().default('OPEN').notNull(),
        createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
        updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
        triggeredAt: timestamp("triggered_at", { mode: 'string' }),
        executedAt: timestamp("executed_at", { mode: 'string' }),
        lastError: text("last_error"),
        clientOrderId: text("client_order_id"),
        maxSlippageBps: integer("max_slippage_bps"),
        priceAtTrigger: numeric("price_at_trigger", { precision: 18, scale:  6 }),
        priceAtExecution: numeric("price_at_execution", { precision: 18, scale:  6 }),
}, (table) => [
        index("trigger_orders_asset_mode_idx").using("btree", table.assetId.asc().nullsLast().op("text_ops"), table.mode.asc().nullsLast().op("text_ops")),
        index("trigger_orders_mode_status_updated_idx").using("btree", table.mode.asc().nullsLast().op("text_ops"), table.status.asc().nullsLast().op("timestamp_ops"), table.updatedAt.asc().nullsLast().op("timestamp_ops")),
        index("trigger_orders_status_mode_idx").using("btree", table.status.asc().nullsLast().op("text_ops"), table.mode.asc().nullsLast().op("text_ops")),
        index("trigger_orders_user_status_idx").using("btree", table.userId.asc().nullsLast().op("text_ops"), table.status.asc().nullsLast().op("text_ops")),
        foreignKey({
                        columns: [table.userId],
                        foreignColumns: [users.id],
                        name: "trigger_orders_user_id_users_id_fk"
                }),
]);

export const riotTrades = pgTable("riot_trades", {
        id: serial().primaryKey().notNull(),
        portfolioId: integer("portfolio_id").notNull(),
        puuid: text().notNull(),
        type: text().notNull(),
        shares: integer().notNull(),
        pricePerShare: numeric("price_per_share", { precision: 10, scale:  2 }).notNull(),
        totalCost: numeric("total_cost", { precision: 15, scale:  2 }).notNull(),
        fee: numeric({ precision: 10, scale:  2 }).notNull(),
        executedAt: timestamp("executed_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
        index("riot_trade_portfolio_idx").using("btree", table.portfolioId.asc().nullsLast().op("int4_ops")),
        index("riot_trade_puuid_idx").using("btree", table.puuid.asc().nullsLast().op("text_ops")),
        foreignKey({
                        columns: [table.portfolioId],
                        foreignColumns: [portfolios.id],
                        name: "riot_trades_portfolio_id_portfolios_id_fk"
                }),
]);

export const trades = pgTable("trades", {
        id: serial().primaryKey().notNull(),
        portfolioId: integer("portfolio_id").notNull(),
        vaultId: integer("vault_id").notNull(),
        assetId: integer("asset_id"),
        type: text().notNull(),
        shares: integer().notNull(),
        pricePerShare: numeric("price_per_share", { precision: 10, scale:  2 }).notNull(),
        totalCost: numeric("total_cost", { precision: 15, scale:  2 }).notNull(),
        fee: numeric({ precision: 10, scale:  2 }).notNull(),
        executedAt: timestamp("executed_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
        foreignKey({
                        columns: [table.assetId],
                        foreignColumns: [assets.id],
                        name: "trades_asset_id_assets_id_fk"
                }),
        foreignKey({
                        columns: [table.portfolioId],
                        foreignColumns: [portfolios.id],
                        name: "trades_portfolio_id_portfolios_id_fk"
                }),
        foreignKey({
                        columns: [table.vaultId],
                        foreignColumns: [vaults.id],
                        name: "trades_vault_id_vaults_id_fk"
                }),
]);

export const assetWatchlist = pgTable("asset_watchlist", {
        id: serial().primaryKey().notNull(),
        userId: varchar("user_id").notNull(),
        assetId: integer("asset_id").notNull(),
        createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
        index("asset_watchlist_user_idx").using("btree", table.userId.asc().nullsLast().op("text_ops")),
        foreignKey({
                        columns: [table.assetId],
                        foreignColumns: [assets.id],
                        name: "asset_watchlist_asset_id_assets_id_fk"
                }),
        foreignKey({
                        columns: [table.userId],
                        foreignColumns: [users.id],
                        name: "asset_watchlist_user_id_users_id_fk"
                }),
        unique("asset_watchlist_user_asset_unique").on(table.userId, table.assetId),
]);

export const watchlist = pgTable("watchlist", {
        id: serial().primaryKey().notNull(),
        userId: varchar("user_id").notNull(),
        vaultId: integer("vault_id").notNull(),
        createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
        foreignKey({
                        columns: [table.userId],
                        foreignColumns: [users.id],
                        name: "watchlist_user_id_users_id_fk"
                }),
        foreignKey({
                        columns: [table.vaultId],
                        foreignColumns: [vaults.id],
                        name: "watchlist_vault_id_vaults_id_fk"
                }),
        unique("user_vault_watchlist_unique").on(table.userId, table.vaultId),
]);

export const arenaBadges = pgTable("arena_badges", {
        code: text().primaryKey().notNull(),
        name: text().notNull(),
        description: text().notNull(),
        iconKey: text("icon_key").notNull(),
        rarity: text().default('common').notNull(),
        createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
});

export const achievementsCatalog = pgTable("achievements_catalog", {
        code: varchar().primaryKey().notNull(),
        name: text().notNull(),
        description: text().notNull(),
        iconKey: text("icon_key").default('trophy').notNull(),
        rarity: text().default('common').notNull(),
        xpReward: integer("xp_reward").default(0).notNull(),
        sortOrder: integer("sort_order").default(0).notNull(),
        createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
        updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
});

export const positions = pgTable("positions", {
        id: serial().primaryKey().notNull(),
        portfolioId: integer("portfolio_id").notNull(),
        vaultId: integer("vault_id").notNull(),
        assetId: integer("asset_id"),
        shares: integer().default(0).notNull(),
        averageCost: numeric("average_cost", { precision: 10, scale:  2 }).notNull(),
        updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
        index("portfolio_vault_idx").using("btree", table.portfolioId.asc().nullsLast().op("int4_ops"), table.vaultId.asc().nullsLast().op("int4_ops")),
        foreignKey({
                        columns: [table.assetId],
                        foreignColumns: [assets.id],
                        name: "positions_asset_id_assets_id_fk"
                }),
        foreignKey({
                        columns: [table.portfolioId],
                        foreignColumns: [portfolios.id],
                        name: "positions_portfolio_id_portfolios_id_fk"
                }),
        foreignKey({
                        columns: [table.vaultId],
                        foreignColumns: [vaults.id],
                        name: "positions_vault_id_vaults_id_fk"
                }),
        unique("portfolio_vault_unique").on(table.portfolioId, table.vaultId),
]);

export const riotPositions = pgTable("riot_positions", {
        id: serial().primaryKey().notNull(),
        portfolioId: integer("portfolio_id").notNull(),
        puuid: text().notNull(),
        shares: integer().default(0).notNull(),
        averageCost: numeric("average_cost", { precision: 10, scale:  2 }).notNull(),
        updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
        index("riot_pos_portfolio_idx").using("btree", table.portfolioId.asc().nullsLast().op("int4_ops")),
        foreignKey({
                        columns: [table.portfolioId],
                        foreignColumns: [portfolios.id],
                        name: "riot_positions_portfolio_id_portfolios_id_fk"
                }),
        unique("riot_pos_unique").on(table.portfolioId, table.puuid),
]);

export const arenaChallenges = pgTable("arena_challenges", {
        id: serial().primaryKey().notNull(),
        title: text().notNull(),
        description: text().notNull(),
        type: text().notNull(),
        target: integer().notNull(),
        rewardXp: integer("reward_xp").default(0).notNull(),
        startsAt: timestamp("starts_at", { mode: 'string' }).notNull(),
        endsAt: timestamp("ends_at", { mode: 'string' }).notNull(),
        status: text().default('active').notNull(),
        createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
        index("arena_challenges_dates_idx").using("btree", table.startsAt.asc().nullsLast().op("timestamp_ops"), table.endsAt.asc().nullsLast().op("timestamp_ops")),
        index("arena_challenges_status_idx").using("btree", table.status.asc().nullsLast().op("text_ops")),
]);

export const arenaProfiles = pgTable("arena_profiles", {
        userId: varchar("user_id").primaryKey().notNull(),
        avatarUrl: text("avatar_url"),
        avatarId: text("avatar_id").default('avatar_01'),
        bio: text(),
        createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
        updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
        foreignKey({
                        columns: [table.userId],
                        foreignColumns: [users.id],
                        name: "arena_profiles_user_id_users_id_fk"
                }),
]);

export const arenaEvents = pgTable("arena_events", {
        id: serial().primaryKey().notNull(),
        userId: varchar("user_id").notNull(),
        type: text().notNull(),
        xpDelta: integer("xp_delta").default(0).notNull(),
        metaJson: jsonb("meta_json"),
        createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
        index("arena_events_user_idx").using("btree", table.userId.asc().nullsLast().op("text_ops")),
]);

export const arenaSeasons = pgTable("arena_seasons", {
        id: serial().primaryKey().notNull(),
        name: text().notNull(),
        startsAt: timestamp("starts_at", { mode: 'string' }).notNull(),
        endsAt: timestamp("ends_at", { mode: 'string' }).notNull(),
        status: text().default('upcoming').notNull(),
        createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
        updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
        index("arena_seasons_ends_at_idx").using("btree", table.endsAt.asc().nullsLast().op("timestamp_ops")),
        index("arena_seasons_starts_at_idx").using("btree", table.startsAt.asc().nullsLast().op("timestamp_ops")),
        index("arena_seasons_status_idx").using("btree", table.status.asc().nullsLast().op("text_ops")),
]);

export const arenaTraderFollows = pgTable("arena_trader_follows", {
        id: serial().primaryKey().notNull(),
        followerUserId: text("follower_user_id").notNull(),
        followedUserId: text("followed_user_id").notNull(),
        createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
        index("arena_follows_followed_idx").using("btree", table.followedUserId.asc().nullsLast().op("text_ops")),
        index("arena_follows_follower_idx").using("btree", table.followerUserId.asc().nullsLast().op("text_ops")),
        foreignKey({
                        columns: [table.followedUserId],
                        foreignColumns: [users.id],
                        name: "arena_trader_follows_followed_user_id_users_id_fk"
                }).onDelete("cascade"),
        foreignKey({
                        columns: [table.followerUserId],
                        foreignColumns: [users.id],
                        name: "arena_trader_follows_follower_user_id_users_id_fk"
                }).onDelete("cascade"),
        unique("arena_follows_unique").on(table.followerUserId, table.followedUserId),
]);

export const arenaUserStats = pgTable("arena_user_stats", {
        userId: varchar("user_id").primaryKey().notNull(),
        xpTotal: integer("xp_total").default(0).notNull(),
        rank: text().default('Bronze').notNull(),
        realizedProfitTotal: numeric("realized_profit_total", { precision: 18, scale:  6 }).default('0').notNull(),
        tradesTotal: integer("trades_total").default(0).notNull(),
        winTrades: integer("win_trades").default(0).notNull(),
        lossTrades: integer("loss_trades").default(0).notNull(),
        bestTradePnl: numeric("best_trade_pnl", { precision: 18, scale:  6 }),
        worstTradePnl: numeric("worst_trade_pnl", { precision: 18, scale:  6 }),
        winStreakCurrent: integer("win_streak_current").default(0).notNull(),
        winStreakBest: integer("win_streak_best").default(0).notNull(),
        lossStreakCurrent: integer("loss_streak_current").default(0).notNull(),
        traderStyle: text("trader_style"),
        updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
        index("arena_user_stats_profit_idx").using("btree", table.realizedProfitTotal.asc().nullsLast().op("numeric_ops")),
        index("arena_user_stats_trades_idx").using("btree", table.tradesTotal.asc().nullsLast().op("int4_ops")),
        index("arena_user_stats_xp_idx").using("btree", table.xpTotal.asc().nullsLast().op("int4_ops")),
        foreignKey({
                        columns: [table.userId],
                        foreignColumns: [users.id],
                        name: "arena_user_stats_user_id_users_id_fk"
                }),
]);

export const draftEntries = pgTable("draft_entries", {
        id: varchar().default(gen_random_uuid()).primaryKey().notNull(),
        weekId: varchar("week_id").notNull(),
        userId: varchar("user_id").notNull(),
        lockedAt: timestamp("locked_at", { mode: 'string' }),
        totalScore: numeric("total_score", { precision: 10, scale:  4 }).default('0').notNull(),
        roleScore: numeric("role_score", { precision: 10, scale:  4 }).default('0').notNull(),
        performanceScore: numeric("performance_score", { precision: 10, scale:  4 }).default('0').notNull(),
        status: varchar().default('open').notNull(),
        createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
        index("draft_entries_user_id_idx").using("btree", table.userId.asc().nullsLast().op("text_ops")),
        foreignKey({
                        columns: [table.userId],
                        foreignColumns: [users.id],
                        name: "draft_entries_user_id_users_id_fk"
                }),
        foreignKey({
                        columns: [table.weekId],
                        foreignColumns: [draftWeeks.id],
                        name: "draft_entries_week_id_draft_weeks_id_fk"
                }),
        unique("draft_entries_week_user_unique").on(table.weekId, table.userId),
]);

export const arenaDuels = pgTable("arena_duels", {
        id: serial().primaryKey().notNull(),
        challengerUserId: text("challenger_user_id").notNull(),
        opponentUserId: text("opponent_user_id").notNull(),
        metric: text().default('highest_profit').notNull(),
        durationDays: integer("duration_days").default(7).notNull(),
        startDate: timestamp("start_date", { mode: 'string' }),
        endDate: timestamp("end_date", { mode: 'string' }),
        status: text().default('pending').notNull(),
        winnerUserId: text("winner_user_id"),
        resultType: text("result_type"),
        challengerSnapshot: jsonb("challenger_snapshot"),
        opponentSnapshot: jsonb("opponent_snapshot"),
        resolvedAt: timestamp("resolved_at", { mode: 'string' }),
        createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
        index("arena_duels_challenger_idx").using("btree", table.challengerUserId.asc().nullsLast().op("text_ops")),
        index("arena_duels_opponent_idx").using("btree", table.opponentUserId.asc().nullsLast().op("text_ops")),
        index("arena_duels_status_idx").using("btree", table.status.asc().nullsLast().op("text_ops")),
        foreignKey({
                        columns: [table.challengerUserId],
                        foreignColumns: [users.id],
                        name: "arena_duels_challenger_user_id_users_id_fk"
                }),
        foreignKey({
                        columns: [table.opponentUserId],
                        foreignColumns: [users.id],
                        name: "arena_duels_opponent_user_id_users_id_fk"
                }),
]);

export const draftPlayerWeekMetrics = pgTable("draft_player_week_metrics", {
        id: varchar().default(gen_random_uuid()).primaryKey().notNull(),
        playerId: varchar("player_id").notNull(),
        weekId: varchar("week_id").notNull(),
        roleCode: varchar("role_code").notNull(),
        matchesCount: integer("matches_count").default(0).notNull(),
        avgMatchScore: numeric("avg_match_score", { precision: 10, scale:  4 }).default('0').notNull(),
        weeklyPerformanceScore: numeric("weekly_performance_score", { precision: 10, scale:  4 }).default('0').notNull(),
        pviStart: numeric("pvi_start", { precision: 10, scale:  4 }),
        pviEnd: numeric("pvi_end", { precision: 10, scale:  4 }),
        pviDelta: numeric("pvi_delta", { precision: 10, scale:  4 }),
        fairValueStart: numeric("fair_value_start", { precision: 10, scale:  4 }),
        fairValueEnd: numeric("fair_value_end", { precision: 10, scale:  4 }),
        marketPriceStart: numeric("market_price_start", { precision: 10, scale:  4 }),
        marketPriceEnd: numeric("market_price_end", { precision: 10, scale:  4 }),
        undervaluationLevel: numeric("undervaluation_level", { precision: 10, scale:  4 }),
        breakoutScore: numeric("breakout_score", { precision: 10, scale:  4 }),
        risingStarScore: numeric("rising_star_score", { precision: 10, scale:  4 }),
        hiddenGemScore: numeric("hidden_gem_score", { precision: 10, scale:  4 }),
        eligible: boolean().default(false).notNull(),
        computedAt: timestamp("computed_at", { mode: 'string' }),
}, (table) => [
        index("draft_player_week_metrics_player_id_idx").using("btree", table.playerId.asc().nullsLast().op("text_ops")),
        index("draft_player_week_metrics_week_id_idx").using("btree", table.weekId.asc().nullsLast().op("text_ops")),
        foreignKey({
                        columns: [table.weekId],
                        foreignColumns: [draftWeeks.id],
                        name: "draft_player_week_metrics_week_id_draft_weeks_id_fk"
                }),
        unique("draft_pw_metrics_player_week_uq").on(table.playerId, table.weekId),
]);

export const draftUserSeasonStats = pgTable("draft_user_season_stats", {
        id: varchar().default(gen_random_uuid()).primaryKey().notNull(),
        userId: varchar("user_id").notNull(),
        seasonId: varchar("season_id").notNull(),
        draftScoreTotal: numeric("draft_score_total", { precision: 10, scale:  4 }).default('0').notNull(),
        draftWeeksPlayed: integer("draft_weeks_played").default(0).notNull(),
        avgDraftScore: numeric("avg_draft_score", { precision: 10, scale:  4 }).default('0').notNull(),
        createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
        foreignKey({
                        columns: [table.userId],
                        foreignColumns: [users.id],
                        name: "draft_user_season_stats_user_id_users_id_fk"
                }),
]);

export const seasonRewardDistributions = pgTable("season_reward_distributions", {
        id: serial().primaryKey().notNull(),
        seasonId: integer("season_id").notNull(),
        userId: text("user_id").notNull(),
        badgeCode: text("badge_code").notNull(),
        finalRank: integer("final_rank"),
        metaJson: jsonb("meta_json"),
        createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
        index("season_reward_dist_season_idx").using("btree", table.seasonId.asc().nullsLast().op("int4_ops")),
        foreignKey({
                        columns: [table.seasonId],
                        foreignColumns: [arenaSeasons.id],
                        name: "season_reward_distributions_season_id_arena_seasons_id_fk"
                }),
        unique("season_reward_dist_unique").on(table.seasonId, table.userId, table.badgeCode),
]);

export const draftEntryPicks = pgTable("draft_entry_picks", {
        id: varchar().default(gen_random_uuid()).primaryKey().notNull(),
        draftEntryId: varchar("draft_entry_id").notNull(),
        slotType: varchar("slot_type").notNull(),
        roleCode: varchar("role_code"),
        playerId: varchar("player_id").notNull(),
        score: numeric({ precision: 10, scale:  4 }).default('0').notNull(),
        scoreBreakdownJson: jsonb("score_breakdown_json"),
        createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
        index("draft_entry_picks_player_id_idx").using("btree", table.playerId.asc().nullsLast().op("text_ops")),
        foreignKey({
                        columns: [table.draftEntryId],
                        foreignColumns: [draftEntries.id],
                        name: "draft_entry_picks_draft_entry_id_draft_entries_id_fk"
                }),
]);

export const seasonRewards = pgTable("season_rewards", {
        id: serial().primaryKey().notNull(),
        seasonId: integer("season_id").notNull(),
        rankMin: integer("rank_min").notNull(),
        rankMax: integer("rank_max").notNull(),
        badgeCode: text("badge_code").notNull(),
        label: text(),
        createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
        index("season_rewards_season_idx").using("btree", table.seasonId.asc().nullsLast().op("int4_ops")),
        foreignKey({
                        columns: [table.badgeCode],
                        foreignColumns: [arenaBadges.code],
                        name: "season_rewards_badge_code_arena_badges_code_fk"
                }),
        foreignKey({
                        columns: [table.seasonId],
                        foreignColumns: [arenaSeasons.id],
                        name: "season_rewards_season_id_arena_seasons_id_fk"
                }).onDelete("cascade"),
]);

export const userAchievements = pgTable("user_achievements", {
        id: serial().primaryKey().notNull(),
        userId: varchar("user_id").notNull(),
        achievementCode: varchar("achievement_code").notNull(),
        unlockedAt: timestamp("unlocked_at", { mode: 'string' }).defaultNow().notNull(),
        metaJson: jsonb("meta_json"),
        createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
        index("user_achievements_user_unlocked_idx").using("btree", table.userId.asc().nullsLast().op("text_ops"), table.unlockedAt.asc().nullsLast().op("text_ops")),
        foreignKey({
                        columns: [table.achievementCode],
                        foreignColumns: [achievementsCatalog.code],
                        name: "user_achievements_achievement_code_achievements_catalog_code_fk"
                }),
        unique("user_achievements_user_code_uq").on(table.userId, table.achievementCode),
]);

export const userBadges = pgTable("user_badges", {
        id: serial().primaryKey().notNull(),
        userId: text("user_id").notNull(),
        badgeCode: text("badge_code").notNull(),
        metaJson: jsonb("meta_json"),
        awardedAt: timestamp("awarded_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
        index("user_badges_user_idx").using("btree", table.userId.asc().nullsLast().op("text_ops")),
        foreignKey({
                        columns: [table.badgeCode],
                        foreignColumns: [arenaBadges.code],
                        name: "user_badges_badge_code_arena_badges_code_fk"
                }),
        unique("user_badges_user_badge_unique").on(table.userId, table.badgeCode),
]);

export const draftWeeks = pgTable("draft_weeks", {
        id: varchar().default(gen_random_uuid()).primaryKey().notNull(),
        game: varchar().notNull(),
        region: varchar().notNull(),
        startAt: timestamp("start_at", { mode: 'string' }).notNull(),
        lockAt: timestamp("lock_at", { mode: 'string' }).notNull(),
        endAt: timestamp("end_at", { mode: 'string' }).notNull(),
        status: varchar().default('open').notNull(),
        createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
});

export const playerFeeBalance = pgTable("player_fee_balance", {
        assetId: integer("asset_id").primaryKey().notNull(),
        balance: numeric({ precision: 18, scale:  6 }).default('0.000000').notNull(),
        updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
        foreignKey({
                        columns: [table.assetId],
                        foreignColumns: [assets.id],
                        name: "player_fee_balance_asset_id_assets_id_fk"
                }),
]);

export const playerClaims = pgTable("player_claims", {
        id: serial().primaryKey().notNull(),
        userId: varchar("user_id").notNull(),
        assetId: integer("asset_id").notNull(),
        assetUid: text("asset_uid").notNull(),
        puuid: text(),
        claimStatus: varchar("claim_status", { length: 32 }).default('pending').notNull(),
        verificationMethod: varchar("verification_method", { length: 64 }).default('manual_admin_review').notNull(),
        evidenceNote: text("evidence_note"),
        requestedAt: timestamp("requested_at", { mode: 'string' }).defaultNow().notNull(),
        reviewedAt: timestamp("reviewed_at", { mode: 'string' }),
        reviewedBy: varchar("reviewed_by"),
        approvedAt: timestamp("approved_at", { mode: 'string' }),
        rejectedAt: timestamp("rejected_at", { mode: 'string' }),
        rejectionReason: text("rejection_reason"),
        revokedAt: timestamp("revoked_at", { mode: 'string' }),
}, (table) => [
        index("player_claims_asset_idx").using("btree", table.assetId.asc().nullsLast().op("int4_ops")),
        index("player_claims_status_idx").using("btree", table.claimStatus.asc().nullsLast().op("text_ops")),
        index("player_claims_user_idx").using("btree", table.userId.asc().nullsLast().op("text_ops")),
        foreignKey({
                        columns: [table.assetId],
                        foreignColumns: [assets.id],
                        name: "player_claims_asset_id_assets_id_fk"
                }).onDelete("cascade"),
        foreignKey({
                        columns: [table.userId],
                        foreignColumns: [users.id],
                        name: "player_claims_user_id_users_id_fk"
                }).onDelete("cascade"),
]);

export const assets = pgTable("assets", {
        id: serial().primaryKey().notNull(),
        marketId: integer("market_id").notNull(),
        assetUid: text("asset_uid").notNull(),
        entityType: text("entity_type").notNull(),
        externalId: text("external_id").notNull(),
        displayName: text("display_name").notNull(),
        symbol: text().default("").notNull(),
        lastTradePrice: numeric("last_trade_price", { precision: 10, scale:  2 }).default('10.00').notNull(),
        price24HAgo: numeric("price_24h_ago", { precision: 10, scale:  2 }).default('10.00').notNull(),
        volume24H: numeric("volume_24h", { precision: 15, scale:  2 }).default('0.00').notNull(),
        momentum: numeric({ precision: 8, scale:  4 }).default('0.0000').notNull(),
        providerJson: text("provider_json"),
        lastSyncedAt: timestamp("last_synced_at", { mode: 'string' }).defaultNow().notNull(),
        fundamentalPrice: numeric("fundamental_price", { precision: 18, scale:  6 }),
        fundamentalUpdatedAt: timestamp("fundamental_updated_at", { mode: 'string' }),
        createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
        updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
        index("assets_market_idx").using("btree", table.marketId.asc().nullsLast().op("int4_ops")),
        index("assets_price_idx").using("btree", table.lastTradePrice.asc().nullsLast().op("numeric_ops")),
        foreignKey({
                        columns: [table.marketId],
                        foreignColumns: [markets.id],
                        name: "assets_market_id_markets_id_fk"
                }),
        unique("assets_asset_uid_unique").on(table.assetUid),
]);

export const vaultSnapshots = pgTable("vault_snapshots", {
        id: serial().primaryKey().notNull(),
        vaultId: integer("vault_id").notNull(),
        price: numeric({ precision: 10, scale:  2 }).notNull(),
        performanceIndex: numeric("performance_index", { precision: 10, scale:  2 }).notNull(),
        recordedAt: timestamp("recorded_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
        foreignKey({
                        columns: [table.vaultId],
                        foreignColumns: [vaults.id],
                        name: "vault_snapshots_vault_id_vaults_id_fk"
                }),
]);

export const triggerOrderEvents = pgTable("trigger_order_events", {
        id: serial().primaryKey().notNull(),
        orderId: varchar("order_id").notNull(),
        eventType: text("event_type").notNull(),
        metaJson: jsonb("meta_json"),
        createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
        index("trigger_order_events_order_idx").using("btree", table.orderId.asc().nullsLast().op("text_ops")),
        foreignKey({
                        columns: [table.orderId],
                        foreignColumns: [triggerOrders.id],
                        name: "trigger_order_events_order_id_trigger_orders_id_fk"
                }),
]);

export const arenaSeasonLeaderboardSnapshot = pgTable("arena_season_leaderboard_snapshot", {
        id: serial().primaryKey().notNull(),
        seasonId: integer("season_id").notNull(),
        metric: text().notNull(),
        userId: text("user_id").notNull(),
        rankPosition: integer("rank_position").notNull(),
        value: numeric({ precision: 18, scale:  6 }).notNull(),
        createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
        index("arena_snapshot_season_metric_rank_idx").using("btree", table.seasonId.asc().nullsLast().op("int4_ops"), table.metric.asc().nullsLast().op("int4_ops"), table.rankPosition.asc().nullsLast().op("int4_ops")),
        foreignKey({
                        columns: [table.seasonId],
                        foreignColumns: [arenaSeasons.id],
                        name: "arena_season_leaderboard_snapshot_season_id_arena_seasons_id_fk"
                }),
]);

export const botProfiles = pgTable("bot_profiles", {
        id: serial().primaryKey().notNull(),
        userId: varchar("user_id").notNull(),
        strategy: varchar().notNull(),
        riskProfile: varchar("risk_profile").default('MEDIUM').notNull(),
        intervalMultiplier: numeric("interval_multiplier", { precision: 4, scale:  2 }).default('1.00').notNull(),
        createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
        index("bot_profiles_strategy_idx").using("btree", table.strategy.asc().nullsLast().op("text_ops")),
        index("bot_profiles_user_idx").using("btree", table.userId.asc().nullsLast().op("text_ops")),
        foreignKey({
                        columns: [table.userId],
                        foreignColumns: [users.id],
                        name: "bot_profiles_user_id_users_id_fk"
                }).onDelete("cascade"),
        unique("bot_profiles_user_id_unique").on(table.userId),
]);

export const playerPublicProfiles = pgTable("player_public_profiles", {
        id: serial().primaryKey().notNull(),
        assetId: integer("asset_id").notNull(),
        claimedByUserId: varchar("claimed_by_user_id").notNull(),
        claimId: integer("claim_id").notNull(),
        bio: text(),
        profileImageUrl: text("profile_image_url"),
        bannerUrl: text("banner_url"),
        headline: text(),
        socialLinksJson: text("social_links_json").default('[]').notNull(),
        teamAffiliation: varchar("team_affiliation", { length: 128 }),
        isVisible: boolean("is_visible").default(true).notNull(),
        createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
        lastUpdatedAt: timestamp("last_updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
        index("player_public_profiles_asset_idx").using("btree", table.assetId.asc().nullsLast().op("int4_ops")),
        index("player_public_profiles_user_idx").using("btree", table.claimedByUserId.asc().nullsLast().op("text_ops")),
        foreignKey({
                        columns: [table.assetId],
                        foreignColumns: [assets.id],
                        name: "player_public_profiles_asset_id_assets_id_fk"
                }).onDelete("cascade"),
        foreignKey({
                        columns: [table.claimId],
                        foreignColumns: [playerClaims.id],
                        name: "player_public_profiles_claim_id_player_claims_id_fk"
                }),
        foreignKey({
                        columns: [table.claimedByUserId],
                        foreignColumns: [users.id],
                        name: "player_public_profiles_claimed_by_user_id_users_id_fk"
                }).onDelete("set null"),
]);

export const wallets = pgTable("wallets", {
        id: serial().primaryKey().notNull(),
        userId: varchar("user_id").notNull(),
        currency: text().notNull(),
        availableBalance: numeric("available_balance", { precision: 18, scale:  6 }).default('0').notNull(),
        lockedBalance: numeric("locked_balance", { precision: 18, scale:  6 }).default('0').notNull(),
        totalBalance: numeric("total_balance", { precision: 18, scale:  6 }).default('0').notNull(),
        createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
        updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
        index("wallets_user_idx").using("btree", table.userId.asc().nullsLast().op("text_ops")),
        foreignKey({
                        columns: [table.userId],
                        foreignColumns: [users.id],
                        name: "wallets_user_id_users_id_fk"
                }).onDelete("cascade"),
        unique("wallets_user_currency_unique").on(table.userId, table.currency),
        check("wallets_available_non_negative", sql`available_balance >= (0)::numeric`),
        check("wallets_locked_non_negative", sql`locked_balance >= (0)::numeric`),
        check("wallets_total_invariant", sql`total_balance = (available_balance + locked_balance)`),
        check("wallets_total_non_negative", sql`total_balance >= (0)::numeric`),
]);

export const walletLedgerEntries = pgTable("wallet_ledger_entries", {
        id: serial().primaryKey().notNull(),
        userId: varchar("user_id").notNull(),
        walletId: integer("wallet_id").notNull(),
        currency: text().notNull(),
        entryType: text("entry_type").notNull(),
        direction: text().notNull(),
        amount: numeric({ precision: 18, scale:  6 }).notNull(),
        balanceAfter: numeric("balance_after", { precision: 18, scale:  6 }).notNull(),
        referenceType: text("reference_type"),
        referenceId: text("reference_id"),
        description: text(),
        metadata: jsonb(),
        createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
        index("wle_created_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamp_ops")),
        index("wle_ref_idx").using("btree", table.referenceType.asc().nullsLast().op("text_ops"), table.referenceId.asc().nullsLast().op("text_ops")),
        index("wle_user_idx").using("btree", table.userId.asc().nullsLast().op("text_ops")),
        index("wle_wallet_idx").using("btree", table.walletId.asc().nullsLast().op("int4_ops")),
        foreignKey({
                        columns: [table.walletId],
                        foreignColumns: [wallets.id],
                        name: "wallet_ledger_entries_wallet_id_wallets_id_fk"
                }).onDelete("restrict"),
        check("wle_amount_positive", sql`amount > (0)::numeric`),
]);

export const feeLedger = pgTable("fee_ledger", {
        id: serial().primaryKey().notNull(),
        assetId: integer("asset_id"),
        notional: numeric({ precision: 18, scale:  6 }).notNull(),
        feeTotal: numeric("fee_total", { precision: 18, scale:  6 }).notNull(),
        platformFee: numeric("platform_fee", { precision: 18, scale:  6 }).notNull(),
        playerFee: numeric("player_fee", { precision: 18, scale:  6 }).notNull(),
        createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
        referenceType: text("reference_type").notNull(),
        referenceId: text("reference_id").notNull(),
        currency: text().default('GS').notNull(),
        liquidityFee: numeric("liquidity_fee", { precision: 18, scale:  6 }).notNull(),
}, (table) => [
        index("fee_ledger_asset_time_idx").using("btree", table.assetId.asc().nullsLast().op("timestamp_ops"), table.createdAt.asc().nullsLast().op("int4_ops")),
        index("fee_ledger_ref_idx").using("btree", table.referenceType.asc().nullsLast().op("text_ops"), table.referenceId.asc().nullsLast().op("text_ops")),
        foreignKey({
                        columns: [table.assetId],
                        foreignColumns: [assets.id],
                        name: "fee_ledger_asset_id_assets_id_fk"
                }),
]);

export const systemWallets = pgTable("system_wallets", {
        id: serial().primaryKey().notNull(),
        walletType: text("wallet_type").notNull(),
        currency: text().notNull(),
        balance: numeric({ precision: 18, scale:  6 }).default('0.000000').notNull(),
        updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
        unique("system_wallets_wallet_type_currency_key").on(table.walletType, table.currency),
        check("system_wallets_currency_check", sql`currency = ANY (ARRAY['GS'::text, 'USDC'::text])`),
        check("system_wallets_wallet_type_check", sql`wallet_type = ANY (ARRAY['platform_revenue'::text, 'player_pool'::text, 'liquidity_pool'::text])`),
]);

export const systemWalletLedger = pgTable("system_wallet_ledger", {
        id: serial().primaryKey().notNull(),
        walletType: text("wallet_type").notNull(),
        currency: text().notNull(),
        direction: text().notNull(),
        amount: numeric({ precision: 18, scale:  6 }).notNull(),
        balanceAfter: numeric("balance_after", { precision: 18, scale:  6 }).notNull(),
        referenceType: text("reference_type"),
        referenceId: text("reference_id"),
        description: text(),
        metadata: jsonb(),
        createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
        index("swl_ref_idx").using("btree", table.referenceType.asc().nullsLast().op("text_ops"), table.referenceId.asc().nullsLast().op("text_ops")),
        index("swl_type_currency_idx").using("btree", table.walletType.asc().nullsLast().op("text_ops"), table.currency.asc().nullsLast().op("text_ops")),
        check("system_wallet_ledger_currency_check", sql`currency = ANY (ARRAY['GS'::text, 'USDC'::text])`),
        check("system_wallet_ledger_direction_check", sql`direction = ANY (ARRAY['credit'::text, 'debit'::text])`),
        check("system_wallet_ledger_wallet_type_check", sql`wallet_type = ANY (ARRAY['platform_revenue'::text, 'player_pool'::text, 'liquidity_pool'::text])`),
]);

export const playerEarningsLedger = pgTable("player_earnings_ledger", {
        id: serial().primaryKey().notNull(),
        assetId: integer("asset_id").notNull(),
        currency: text().notNull(),
        direction: text().notNull(),
        amount: numeric({ precision: 18, scale:  6 }).notNull(),
        balanceAfter: numeric("balance_after", { precision: 18, scale:  6 }).notNull(),
        referenceType: text("reference_type").notNull(),
        referenceId: text("reference_id").notNull(),
        createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
        index("pel_asset_currency_idx").using("btree", table.assetId.asc().nullsLast().op("text_ops"), table.currency.asc().nullsLast().op("int4_ops")),
        index("pel_ref_idx").using("btree", table.referenceType.asc().nullsLast().op("text_ops"), table.referenceId.asc().nullsLast().op("text_ops")),
        foreignKey({
                        columns: [table.assetId],
                        foreignColumns: [assets.id],
                        name: "player_earnings_ledger_asset_id_fkey"
                }),
        unique("pel_idempotency_key").on(table.assetId, table.currency, table.direction, table.referenceType, table.referenceId),
        check("player_earnings_ledger_currency_check", sql`currency = ANY (ARRAY['GS'::text, 'USDC'::text])`),
        check("player_earnings_ledger_direction_check", sql`direction = ANY (ARRAY['credit'::text, 'debit'::text])`),
]);

export const predictionPositions = pgTable("prediction_positions", {
        id: serial().primaryKey().notNull(),
        userId: varchar("user_id", { length: 128 }).notNull(),
        marketId: integer("market_id").notNull(),
        outcomeId: integer("outcome_id").notNull(),
        stake: numeric({ precision: 18, scale:  6 }),
        currency: varchar({ length: 10 }).default('GS').notNull(),
        payout: numeric({ precision: 18, scale:  6 }),
        payoutAt: timestamp("payout_at", { mode: 'string' }),
        status: varchar({ length: 20 }).default('active').notNull(),
        walletLedgerRef: varchar("wallet_ledger_ref", { length: 128 }),
        createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
        updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
        quantity: numeric({ precision: 18, scale:  6 }),
        avgPrice: numeric("avg_price", { precision: 18, scale:  6 }),
        costBasis: numeric("cost_basis", { precision: 18, scale:  6 }),
        realizedPnl: numeric("realized_pnl", { precision: 18, scale:  6 }),
        cancelledAt: timestamp("cancelled_at", { mode: 'string' }),
}, (table) => [
        index("idx_pred_positions_market_id").using("btree", table.marketId.asc().nullsLast().op("int4_ops")),
        index("idx_pred_positions_outcome_id").using("btree", table.outcomeId.asc().nullsLast().op("int4_ops")),
        index("idx_pred_positions_user_id").using("btree", table.userId.asc().nullsLast().op("text_ops")),
        foreignKey({
                        columns: [table.marketId],
                        foreignColumns: [predictionMarkets.id],
                        name: "prediction_positions_market_id_fkey"
                }).onDelete("restrict"),
        foreignKey({
                        columns: [table.outcomeId],
                        foreignColumns: [predictionOutcomes.id],
                        name: "prediction_positions_outcome_id_fkey"
                }).onDelete("restrict"),
]);

export const predictionOutcomes = pgTable("prediction_outcomes", {
        id: serial().primaryKey().notNull(),
        marketId: integer("market_id").notNull(),
        label: varchar({ length: 255 }).notNull(),
        description: text(),
        poolShare: numeric("pool_share", { precision: 18, scale:  6 }).default('0').notNull(),
        impliedProbability: numeric("implied_probability", { precision: 6, scale:  4 }),
        isWinner: boolean("is_winner").default(false),
        sortOrder: integer("sort_order").default(0).notNull(),
        metadata: jsonb(),
        createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
        code: varchar({ length: 50 }),
        payoutValue: numeric("payout_value", { precision: 18, scale:  6 }),
}, (table) => [
        index("idx_pred_outcomes_market_id").using("btree", table.marketId.asc().nullsLast().op("int4_ops")),
        foreignKey({
                        columns: [table.marketId],
                        foreignColumns: [predictionMarkets.id],
                        name: "prediction_outcomes_market_id_fkey"
                }).onDelete("cascade"),
]);

export const predictionEvents = pgTable("prediction_events", {
        id: serial().primaryKey().notNull(),
        uid: varchar({ length: 64 }).notNull(),
        title: varchar({ length: 255 }).notNull(),
        game: varchar({ length: 50 }).default('lol').notNull(),
        region: varchar({ length: 50 }),
        eventType: varchar("event_type", { length: 50 }).default('match').notNull(),
        teamA: varchar("team_a", { length: 100 }),
        teamB: varchar("team_b", { length: 100 }),
        scheduledAt: timestamp("scheduled_at", { mode: 'string' }),
        externalRef: varchar("external_ref", { length: 128 }),
        metadata: jsonb(),
        createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
        updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
        tournamentName: varchar("tournament_name", { length: 255 }),
        eventName: varchar("event_name", { length: 255 }),
        status: varchar({ length: 30 }).default('scheduled').notNull(),
}, (table) => [
        index("idx_pred_events_game").using("btree", table.game.asc().nullsLast().op("text_ops")),
        index("idx_pred_events_starts_at").using("btree", table.scheduledAt.asc().nullsLast().op("timestamp_ops")),
        index("idx_pred_events_status").using("btree", table.status.asc().nullsLast().op("text_ops")),
        unique("prediction_events_uid_key").on(table.uid),
]);

export const predictionMarkets = pgTable("prediction_markets", {
        id: serial().primaryKey().notNull(),
        uid: varchar({ length: 64 }).notNull(),
        eventId: integer("event_id"),
        question: varchar({ length: 512 }).notNull(),
        description: text(),
        status: varchar({ length: 20 }).default('draft').notNull(),
        resolvedOutcomeId: integer("resolved_outcome_id"),
        currency: varchar({ length: 10 }).default('GS').notNull(),
        poolTotal: numeric("pool_total", { precision: 18, scale:  6 }).default('0').notNull(),
        minStake: numeric("min_stake", { precision: 18, scale:  6 }).default('1.000000').notNull(),
        maxStake: numeric("max_stake", { precision: 18, scale:  6 }),
        opensAt: timestamp("opens_at", { mode: 'string' }),
        closesAt: timestamp("closes_at", { mode: 'string' }),
        resolvedAt: timestamp("resolved_at", { mode: 'string' }),
        settledAt: timestamp("settled_at", { mode: 'string' }),
        createdByUserId: varchar("created_by_user_id", { length: 128 }),
        metadata: jsonb(),
        createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
        updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
        slug: varchar({ length: 128 }),
        marketType: varchar("market_type", { length: 30 }).default('binary').notNull(),
        resolutionSource: varchar("resolution_source", { length: 128 }),
}, (table) => [
        index("idx_pred_markets_event_id").using("btree", table.eventId.asc().nullsLast().op("int4_ops")),
        index("idx_pred_markets_open_at").using("btree", table.opensAt.asc().nullsLast().op("timestamp_ops")),
        index("idx_pred_markets_slug").using("btree", table.slug.asc().nullsLast().op("text_ops")),
        index("idx_pred_markets_status").using("btree", table.status.asc().nullsLast().op("text_ops")),
        foreignKey({
                        columns: [table.eventId],
                        foreignColumns: [predictionEvents.id],
                        name: "prediction_markets_event_id_fkey"
                }).onDelete("restrict"),
        unique("prediction_markets_uid_key").on(table.uid),
        unique("prediction_markets_slug_key").on(table.slug),
]);

export const predictionOrders = pgTable("prediction_orders", {
        id: serial().primaryKey().notNull(),
        marketId: integer("market_id").notNull(),
        userId: varchar("user_id", { length: 128 }).notNull(),
        outcomeId: integer("outcome_id").notNull(),
        side: varchar({ length: 10 }).notNull(),
        orderType: varchar("order_type", { length: 10 }).notNull(),
        quantity: numeric({ precision: 18, scale:  6 }).notNull(),
        price: numeric({ precision: 18, scale:  6 }),
        totalValue: numeric("total_value", { precision: 18, scale:  6 }),
        status: varchar({ length: 20 }).default('pending').notNull(),
        idempotencyKey: varchar("idempotency_key", { length: 128 }),
        createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
        updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
        index("idx_pred_orders_market_id").using("btree", table.marketId.asc().nullsLast().op("int4_ops")),
        index("idx_pred_orders_status").using("btree", table.status.asc().nullsLast().op("text_ops")),
        index("idx_pred_orders_user_id").using("btree", table.userId.asc().nullsLast().op("text_ops")),
        foreignKey({
                        columns: [table.marketId],
                        foreignColumns: [predictionMarkets.id],
                        name: "prediction_orders_market_id_fkey"
                }).onDelete("restrict"),
        foreignKey({
                        columns: [table.outcomeId],
                        foreignColumns: [predictionOutcomes.id],
                        name: "prediction_orders_outcome_id_fkey"
                }).onDelete("restrict"),
        unique("prediction_orders_idempotency_key_key").on(table.idempotencyKey),
]);

export const predictionSettlements = pgTable("prediction_settlements", {
        id: serial().primaryKey().notNull(),
        marketId: integer("market_id").notNull(),
        userId: varchar("user_id", { length: 128 }).notNull(),
        positionId: integer("position_id"),
        grossPayout: numeric("gross_payout", { precision: 18, scale:  6 }).notNull(),
        fees: numeric({ precision: 18, scale:  6 }).default('0').notNull(),
        netPayout: numeric("net_payout", { precision: 18, scale:  6 }).notNull(),
        ledgerReferenceId: varchar("ledger_reference_id", { length: 128 }),
        settledAt: timestamp("settled_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
        index("idx_pred_settlements_market_id").using("btree", table.marketId.asc().nullsLast().op("int4_ops")),
        index("idx_pred_settlements_position_id").using("btree", table.positionId.asc().nullsLast().op("int4_ops")),
        index("idx_pred_settlements_user_id").using("btree", table.userId.asc().nullsLast().op("text_ops")),
        uniqueIndex("pred_settlements_position_unique").using("btree", table.positionId.asc().nullsLast().op("int4_ops")).where(sql`(position_id IS NOT NULL)`),
        foreignKey({
                        columns: [table.marketId],
                        foreignColumns: [predictionMarkets.id],
                        name: "prediction_settlements_market_id_fkey"
                }).onDelete("restrict"),
        foreignKey({
                        columns: [table.positionId],
                        foreignColumns: [predictionPositions.id],
                        name: "prediction_settlements_position_id_fkey"
                }).onDelete("restrict"),
]);

export const predictionPriceSnapshots = pgTable("prediction_price_snapshots", {
        id: serial().primaryKey().notNull(),
        marketId: integer("market_id").notNull(),
        outcomeId: integer("outcome_id").notNull(),
        price: numeric({ precision: 10, scale:  6 }).notNull(),
        volumeWindow: numeric("volume_window", { precision: 18, scale:  6 }),
        recordedAt: timestamp("recorded_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
        index("idx_pred_snapshots_market_outcome").using("btree", table.marketId.asc().nullsLast().op("int4_ops"), table.outcomeId.asc().nullsLast().op("int4_ops")),
        index("idx_pred_snapshots_recorded_at").using("btree", table.recordedAt.asc().nullsLast().op("timestamp_ops")),
        foreignKey({
                        columns: [table.marketId],
                        foreignColumns: [predictionMarkets.id],
                        name: "prediction_price_snapshots_market_id_fkey"
                }).onDelete("cascade"),
        foreignKey({
                        columns: [table.outcomeId],
                        foreignColumns: [predictionOutcomes.id],
                        name: "prediction_price_snapshots_outcome_id_fkey"
                }).onDelete("cascade"),
]);

export const predictionMarketStats = pgTable("prediction_market_stats", {
        id: serial().primaryKey().notNull(),
        marketId: integer("market_id").notNull(),
        volume24H: numeric("volume_24h", { precision: 18, scale:  6 }).default('0').notNull(),
        traders24H: integer("traders_24h").default(0).notNull(),
        lastPriceYes: numeric("last_price_yes", { precision: 10, scale:  6 }),
        lastPriceNo: numeric("last_price_no", { precision: 10, scale:  6 }),
        updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
        index("idx_pred_stats_market_id").using("btree", table.marketId.asc().nullsLast().op("int4_ops")),
        foreignKey({
                        columns: [table.marketId],
                        foreignColumns: [predictionMarkets.id],
                        name: "prediction_market_stats_market_id_fkey"
                }).onDelete("cascade"),
        unique("prediction_market_stats_market_id_key").on(table.marketId),
]);

export const predictionMarketEvents = pgTable("prediction_market_events", {
        id: serial().primaryKey().notNull(),
        marketId: integer("market_id").notNull(),
        eventType: varchar("event_type", { length: 50 }).notNull(),
        fromStatus: varchar("from_status", { length: 30 }),
        toStatus: varchar("to_status", { length: 30 }),
        actorUserId: varchar("actor_user_id", { length: 128 }),
        source: varchar({ length: 50 }),
        note: text(),
        metadata: jsonb(),
        createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
        index("idx_pred_mkt_events_created_at").using("btree", table.createdAt.asc().nullsLast().op("timestamp_ops")),
        index("idx_pred_mkt_events_event_type").using("btree", table.eventType.asc().nullsLast().op("text_ops")),
        index("idx_pred_mkt_events_market_id").using("btree", table.marketId.asc().nullsLast().op("int4_ops")),
        foreignKey({
                        columns: [table.marketId],
                        foreignColumns: [predictionMarkets.id],
                        name: "prediction_market_events_market_id_fkey"
                }).onDelete("cascade"),
]);

export const predictionEventCandidates = pgTable("prediction_event_candidates", {
        id: serial().primaryKey().notNull(),
        source: varchar({ length: 50 }).notNull(),
        sourceEventId: varchar("source_event_id", { length: 255 }).notNull(),
        sourceSeriesId: varchar("source_series_id", { length: 255 }),
        sourceLeagueId: varchar("source_league_id", { length: 255 }),
        sourceTournamentId: varchar("source_tournament_id", { length: 255 }),
        gameCode: varchar("game_code", { length: 50 }).default('lol').notNull(),
        leagueName: varchar("league_name", { length: 255 }),
        tournamentName: varchar("tournament_name", { length: 255 }),
        matchTitle: varchar("match_title", { length: 500 }),
        teamAName: varchar("team_a_name", { length: 150 }),
        teamBName: varchar("team_b_name", { length: 150 }),
        teamAExternalRef: varchar("team_a_external_ref", { length: 255 }),
        teamBExternalRef: varchar("team_b_external_ref", { length: 255 }),
        scheduledStartAt: timestamp("scheduled_start_at", { mode: 'string' }),
        originalStatus: varchar("original_status", { length: 100 }),
        normalizedStatus: varchar("normalized_status", { length: 50 }).default('pending').notNull(),
        winnerSide: varchar("winner_side", { length: 10 }),
        winnerExternalRef: varchar("winner_external_ref", { length: 255 }),
        dedupeKey: varchar("dedupe_key", { length: 512 }).notNull(),
        confidenceScore: numeric("confidence_score", { precision: 5, scale:  4 }),
        reviewStatus: varchar("review_status", { length: 50 }).default('pending').notNull(),
        visibilityState: varchar("visibility_state", { length: 50 }).default('hidden').notNull(),
        publishAt: timestamp("publish_at", { mode: 'string' }),
        reviewedBy: varchar("reviewed_by", { length: 64 }),
        reviewedAt: timestamp("reviewed_at", { mode: 'string' }),
        reviewNotes: text("review_notes"),
        rawPayload: jsonb("raw_payload"),
        normalizedPayload: jsonb("normalized_payload"),
        createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
        updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
        index("idx_candidate_dedupe_key").using("btree", table.dedupeKey.asc().nullsLast().op("text_ops")),
        index("idx_candidate_game_code").using("btree", table.gameCode.asc().nullsLast().op("text_ops")),
        index("idx_candidate_review_status").using("btree", table.reviewStatus.asc().nullsLast().op("text_ops")),
        index("idx_candidate_scheduled_start").using("btree", table.scheduledStartAt.asc().nullsLast().op("timestamp_ops")),
        unique("uq_candidate_source_event").on(table.source, table.sourceEventId),
        unique("prediction_event_candidates_dedupe_key_key").on(table.dedupeKey),
]);

export const predictionEventPublications = pgTable("prediction_event_publications", {
        id: serial().primaryKey().notNull(),
        candidateEventId: integer("candidate_event_id").notNull(),
        predictionEventId: integer("prediction_event_id"),
        publishedBy: varchar("published_by", { length: 64 }),
        publishedAt: timestamp("published_at", { mode: 'string' }).defaultNow().notNull(),
        publicationMode: varchar("publication_mode", { length: 50 }).default('manual').notNull(),
        notes: text(),
        createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
        index("idx_pub_candidate_event_id").using("btree", table.candidateEventId.asc().nullsLast().op("int4_ops")),
        index("idx_pub_prediction_event_id").using("btree", table.predictionEventId.asc().nullsLast().op("int4_ops")),
        foreignKey({
                        columns: [table.candidateEventId],
                        foreignColumns: [predictionEventCandidates.id],
                        name: "prediction_event_publications_candidate_event_id_fkey"
                }),
]);

export const predictionDisplayQueue = pgTable("prediction_display_queue", {
        id: serial().primaryKey().notNull(),
        entityType: varchar("entity_type", { length: 50 }).notNull(),
        entityId: integer("entity_id").notNull(),
        surface: varchar({ length: 100 }).notNull(),
        position: integer().notNull(),
        startsAt: timestamp("starts_at", { mode: 'string' }),
        endsAt: timestamp("ends_at", { mode: 'string' }),
        isActive: boolean("is_active").default(true).notNull(),
        curationLabel: varchar("curation_label", { length: 255 }),
        createdBy: varchar("created_by", { length: 64 }),
        updatedBy: varchar("updated_by", { length: 64 }),
        createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
        updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
        index("idx_display_queue_entity").using("btree", table.entityType.asc().nullsLast().op("int4_ops"), table.entityId.asc().nullsLast().op("text_ops")),
        index("idx_display_queue_is_active").using("btree", table.isActive.asc().nullsLast().op("bool_ops")),
        unique("uq_display_queue_surface_position").on(table.surface, table.position),
]);

export const playerEarningsBalance = pgTable("player_earnings_balance", {
        assetId: integer("asset_id").notNull(),
        currency: text().notNull(),
        accruedBalance: numeric("accrued_balance", { precision: 18, scale:  6 }).default('0.000000').notNull(),
        updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
        index("peb_asset_currency_idx").using("btree", table.assetId.asc().nullsLast().op("int4_ops"), table.currency.asc().nullsLast().op("text_ops")),
        foreignKey({
                        columns: [table.assetId],
                        foreignColumns: [assets.id],
                        name: "player_earnings_balance_asset_id_fkey"
                }),
        primaryKey({ columns: [table.assetId, table.currency], name: "player_earnings_balance_pkey"}),
        check("player_earnings_balance_currency_check", sql`currency = ANY (ARRAY['GS'::text, 'USDC'::text])`),
]);

export const arenaUserSeasonStats = pgTable("arena_user_season_stats", {
        seasonId: integer("season_id").notNull(),
        userId: text("user_id").notNull(),
        xpSeason: integer("xp_season").default(0).notNull(),
        rankSeason: text("rank_season").default('Bronze').notNull(),
        realizedProfitSeason: numeric("realized_profit_season", { precision: 18, scale:  6 }).default('0').notNull(),
        tradesSeason: integer("trades_season").default(0).notNull(),
        winTradesSeason: integer("win_trades_season").default(0).notNull(),
        lossTradesSeason: integer("loss_trades_season").default(0).notNull(),
        bestTradePnlSeason: numeric("best_trade_pnl_season", { precision: 18, scale:  6 }),
        worstTradePnlSeason: numeric("worst_trade_pnl_season", { precision: 18, scale:  6 }),
        winStreakCurrentSeason: integer("win_streak_current_season").default(0).notNull(),
        winStreakBestSeason: integer("win_streak_best_season").default(0).notNull(),
        lossStreakCurrentSeason: integer("loss_streak_current_season").default(0).notNull(),
        updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
        index("arena_season_stats_profit_idx").using("btree", table.seasonId.asc().nullsLast().op("int4_ops"), table.realizedProfitSeason.asc().nullsLast().op("numeric_ops")),
        index("arena_season_stats_wins_idx").using("btree", table.seasonId.asc().nullsLast().op("int4_ops"), table.winTradesSeason.asc().nullsLast().op("int4_ops")),
        index("arena_season_stats_xp_idx").using("btree", table.seasonId.asc().nullsLast().op("int4_ops"), table.xpSeason.asc().nullsLast().op("int4_ops")),
        foreignKey({
                        columns: [table.seasonId],
                        foreignColumns: [arenaSeasons.id],
                        name: "arena_user_season_stats_season_id_arena_seasons_id_fk"
                }),
        primaryKey({ columns: [table.seasonId, table.userId], name: "arena_user_season_stats_season_id_user_id_pk"}),
]);
