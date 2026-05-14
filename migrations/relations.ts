import { relations } from "drizzle-orm/relations";
import { assets, vaults, assetMarketState, assetValuationState, assetPriceSnapshots, assetMarkets, assetNewsPulses, newsEvents, users, portfolios, triggerOrders, riotTrades, trades, assetWatchlist, watchlist, positions, riotPositions, arenaProfiles, arenaTraderFollows, arenaUserStats, draftEntries, draftWeeks, arenaDuels, draftPlayerWeekMetrics, draftUserSeasonStats, arenaSeasons, seasonRewardDistributions, draftEntryPicks, arenaBadges, seasonRewards, achievementsCatalog, userAchievements, userBadges, playerFeeBalance, playerClaims, markets, vaultSnapshots, triggerOrderEvents, arenaSeasonLeaderboardSnapshot, botProfiles, playerPublicProfiles, wallets, walletLedgerEntries, feeLedger, playerEarningsLedger, predictionMarkets, predictionPositions, predictionOutcomes, predictionEvents, predictionOrders, predictionSettlements, predictionPriceSnapshots, predictionMarketStats, predictionMarketEvents, predictionEventCandidates, predictionEventPublications, playerEarningsBalance, arenaUserSeasonStats } from "./schema";

export const vaultsRelations = relations(vaults, ({one, many}) => ({
	asset: one(assets, {
		fields: [vaults.assetId],
		references: [assets.id]
	}),
	trades: many(trades),
	watchlists: many(watchlist),
	positions: many(positions),
	vaultSnapshots: many(vaultSnapshots),
}));

export const assetsRelations = relations(assets, ({one, many}) => ({
	vaults: many(vaults),
	assetMarketStates: many(assetMarketState),
	assetValuationStates: many(assetValuationState),
	assetPriceSnapshots: many(assetPriceSnapshots),
	assetMarkets: many(assetMarkets),
	assetNewsPulses: many(assetNewsPulses),
	trades: many(trades),
	assetWatchlists: many(assetWatchlist),
	positions: many(positions),
	playerFeeBalances: many(playerFeeBalance),
	playerClaims: many(playerClaims),
	market: one(markets, {
		fields: [assets.marketId],
		references: [markets.id]
	}),
	playerPublicProfiles: many(playerPublicProfiles),
	feeLedgers: many(feeLedger),
	playerEarningsLedgers: many(playerEarningsLedger),
	playerEarningsBalances: many(playerEarningsBalance),
}));

export const assetMarketStateRelations = relations(assetMarketState, ({one}) => ({
	asset: one(assets, {
		fields: [assetMarketState.assetId],
		references: [assets.id]
	}),
}));

export const assetValuationStateRelations = relations(assetValuationState, ({one}) => ({
	asset: one(assets, {
		fields: [assetValuationState.assetId],
		references: [assets.id]
	}),
}));

export const assetPriceSnapshotsRelations = relations(assetPriceSnapshots, ({one}) => ({
	asset: one(assets, {
		fields: [assetPriceSnapshots.assetId],
		references: [assets.id]
	}),
}));

export const assetMarketsRelations = relations(assetMarkets, ({one}) => ({
	asset: one(assets, {
		fields: [assetMarkets.assetId],
		references: [assets.id]
	}),
}));

export const assetNewsPulsesRelations = relations(assetNewsPulses, ({one}) => ({
	asset: one(assets, {
		fields: [assetNewsPulses.assetId],
		references: [assets.id]
	}),
	newsEvent: one(newsEvents, {
		fields: [assetNewsPulses.newsEventId],
		references: [newsEvents.id]
	}),
}));

export const newsEventsRelations = relations(newsEvents, ({many}) => ({
	assetNewsPulses: many(assetNewsPulses),
}));

export const portfoliosRelations = relations(portfolios, ({one, many}) => ({
	user: one(users, {
		fields: [portfolios.userId],
		references: [users.id]
	}),
	riotTrades: many(riotTrades),
	trades: many(trades),
	positions: many(positions),
	riotPositions: many(riotPositions),
}));

export const usersRelations = relations(users, ({many}) => ({
	portfolios: many(portfolios),
	triggerOrders: many(triggerOrders),
	assetWatchlists: many(assetWatchlist),
	watchlists: many(watchlist),
	arenaProfiles: many(arenaProfiles),
	arenaTraderFollows_followedUserId: many(arenaTraderFollows, {
		relationName: "arenaTraderFollows_followedUserId_users_id"
	}),
	arenaTraderFollows_followerUserId: many(arenaTraderFollows, {
		relationName: "arenaTraderFollows_followerUserId_users_id"
	}),
	arenaUserStats: many(arenaUserStats),
	draftEntries: many(draftEntries),
	arenaDuels_challengerUserId: many(arenaDuels, {
		relationName: "arenaDuels_challengerUserId_users_id"
	}),
	arenaDuels_opponentUserId: many(arenaDuels, {
		relationName: "arenaDuels_opponentUserId_users_id"
	}),
	draftUserSeasonStats: many(draftUserSeasonStats),
	playerClaims: many(playerClaims),
	botProfiles: many(botProfiles),
	playerPublicProfiles: many(playerPublicProfiles),
	wallets: many(wallets),
}));

export const triggerOrdersRelations = relations(triggerOrders, ({one, many}) => ({
	user: one(users, {
		fields: [triggerOrders.userId],
		references: [users.id]
	}),
	triggerOrderEvents: many(triggerOrderEvents),
}));

export const riotTradesRelations = relations(riotTrades, ({one}) => ({
	portfolio: one(portfolios, {
		fields: [riotTrades.portfolioId],
		references: [portfolios.id]
	}),
}));

export const tradesRelations = relations(trades, ({one}) => ({
	asset: one(assets, {
		fields: [trades.assetId],
		references: [assets.id]
	}),
	portfolio: one(portfolios, {
		fields: [trades.portfolioId],
		references: [portfolios.id]
	}),
	vault: one(vaults, {
		fields: [trades.vaultId],
		references: [vaults.id]
	}),
}));

export const assetWatchlistRelations = relations(assetWatchlist, ({one}) => ({
	asset: one(assets, {
		fields: [assetWatchlist.assetId],
		references: [assets.id]
	}),
	user: one(users, {
		fields: [assetWatchlist.userId],
		references: [users.id]
	}),
}));

export const watchlistRelations = relations(watchlist, ({one}) => ({
	user: one(users, {
		fields: [watchlist.userId],
		references: [users.id]
	}),
	vault: one(vaults, {
		fields: [watchlist.vaultId],
		references: [vaults.id]
	}),
}));

export const positionsRelations = relations(positions, ({one}) => ({
	asset: one(assets, {
		fields: [positions.assetId],
		references: [assets.id]
	}),
	portfolio: one(portfolios, {
		fields: [positions.portfolioId],
		references: [portfolios.id]
	}),
	vault: one(vaults, {
		fields: [positions.vaultId],
		references: [vaults.id]
	}),
}));

export const riotPositionsRelations = relations(riotPositions, ({one}) => ({
	portfolio: one(portfolios, {
		fields: [riotPositions.portfolioId],
		references: [portfolios.id]
	}),
}));

export const arenaProfilesRelations = relations(arenaProfiles, ({one}) => ({
	user: one(users, {
		fields: [arenaProfiles.userId],
		references: [users.id]
	}),
}));

export const arenaTraderFollowsRelations = relations(arenaTraderFollows, ({one}) => ({
	user_followedUserId: one(users, {
		fields: [arenaTraderFollows.followedUserId],
		references: [users.id],
		relationName: "arenaTraderFollows_followedUserId_users_id"
	}),
	user_followerUserId: one(users, {
		fields: [arenaTraderFollows.followerUserId],
		references: [users.id],
		relationName: "arenaTraderFollows_followerUserId_users_id"
	}),
}));

export const arenaUserStatsRelations = relations(arenaUserStats, ({one}) => ({
	user: one(users, {
		fields: [arenaUserStats.userId],
		references: [users.id]
	}),
}));

export const draftEntriesRelations = relations(draftEntries, ({one, many}) => ({
	user: one(users, {
		fields: [draftEntries.userId],
		references: [users.id]
	}),
	draftWeek: one(draftWeeks, {
		fields: [draftEntries.weekId],
		references: [draftWeeks.id]
	}),
	draftEntryPicks: many(draftEntryPicks),
}));

export const draftWeeksRelations = relations(draftWeeks, ({many}) => ({
	draftEntries: many(draftEntries),
	draftPlayerWeekMetrics: many(draftPlayerWeekMetrics),
}));

export const arenaDuelsRelations = relations(arenaDuels, ({one}) => ({
	user_challengerUserId: one(users, {
		fields: [arenaDuels.challengerUserId],
		references: [users.id],
		relationName: "arenaDuels_challengerUserId_users_id"
	}),
	user_opponentUserId: one(users, {
		fields: [arenaDuels.opponentUserId],
		references: [users.id],
		relationName: "arenaDuels_opponentUserId_users_id"
	}),
}));

export const draftPlayerWeekMetricsRelations = relations(draftPlayerWeekMetrics, ({one}) => ({
	draftWeek: one(draftWeeks, {
		fields: [draftPlayerWeekMetrics.weekId],
		references: [draftWeeks.id]
	}),
}));

export const draftUserSeasonStatsRelations = relations(draftUserSeasonStats, ({one}) => ({
	user: one(users, {
		fields: [draftUserSeasonStats.userId],
		references: [users.id]
	}),
}));

export const seasonRewardDistributionsRelations = relations(seasonRewardDistributions, ({one}) => ({
	arenaSeason: one(arenaSeasons, {
		fields: [seasonRewardDistributions.seasonId],
		references: [arenaSeasons.id]
	}),
}));

export const arenaSeasonsRelations = relations(arenaSeasons, ({many}) => ({
	seasonRewardDistributions: many(seasonRewardDistributions),
	seasonRewards: many(seasonRewards),
	arenaSeasonLeaderboardSnapshots: many(arenaSeasonLeaderboardSnapshot),
	arenaUserSeasonStats: many(arenaUserSeasonStats),
}));

export const draftEntryPicksRelations = relations(draftEntryPicks, ({one}) => ({
	draftEntry: one(draftEntries, {
		fields: [draftEntryPicks.draftEntryId],
		references: [draftEntries.id]
	}),
}));

export const seasonRewardsRelations = relations(seasonRewards, ({one}) => ({
	arenaBadge: one(arenaBadges, {
		fields: [seasonRewards.badgeCode],
		references: [arenaBadges.code]
	}),
	arenaSeason: one(arenaSeasons, {
		fields: [seasonRewards.seasonId],
		references: [arenaSeasons.id]
	}),
}));

export const arenaBadgesRelations = relations(arenaBadges, ({many}) => ({
	seasonRewards: many(seasonRewards),
	userBadges: many(userBadges),
}));

export const userAchievementsRelations = relations(userAchievements, ({one}) => ({
	achievementsCatalog: one(achievementsCatalog, {
		fields: [userAchievements.achievementCode],
		references: [achievementsCatalog.code]
	}),
}));

export const achievementsCatalogRelations = relations(achievementsCatalog, ({many}) => ({
	userAchievements: many(userAchievements),
}));

export const userBadgesRelations = relations(userBadges, ({one}) => ({
	arenaBadge: one(arenaBadges, {
		fields: [userBadges.badgeCode],
		references: [arenaBadges.code]
	}),
}));

export const playerFeeBalanceRelations = relations(playerFeeBalance, ({one}) => ({
	asset: one(assets, {
		fields: [playerFeeBalance.assetId],
		references: [assets.id]
	}),
}));

export const playerClaimsRelations = relations(playerClaims, ({one, many}) => ({
	asset: one(assets, {
		fields: [playerClaims.assetId],
		references: [assets.id]
	}),
	user: one(users, {
		fields: [playerClaims.userId],
		references: [users.id]
	}),
	playerPublicProfiles: many(playerPublicProfiles),
}));

export const marketsRelations = relations(markets, ({many}) => ({
	assets: many(assets),
}));

export const vaultSnapshotsRelations = relations(vaultSnapshots, ({one}) => ({
	vault: one(vaults, {
		fields: [vaultSnapshots.vaultId],
		references: [vaults.id]
	}),
}));

export const triggerOrderEventsRelations = relations(triggerOrderEvents, ({one}) => ({
	triggerOrder: one(triggerOrders, {
		fields: [triggerOrderEvents.orderId],
		references: [triggerOrders.id]
	}),
}));

export const arenaSeasonLeaderboardSnapshotRelations = relations(arenaSeasonLeaderboardSnapshot, ({one}) => ({
	arenaSeason: one(arenaSeasons, {
		fields: [arenaSeasonLeaderboardSnapshot.seasonId],
		references: [arenaSeasons.id]
	}),
}));

export const botProfilesRelations = relations(botProfiles, ({one}) => ({
	user: one(users, {
		fields: [botProfiles.userId],
		references: [users.id]
	}),
}));

export const playerPublicProfilesRelations = relations(playerPublicProfiles, ({one}) => ({
	asset: one(assets, {
		fields: [playerPublicProfiles.assetId],
		references: [assets.id]
	}),
	playerClaim: one(playerClaims, {
		fields: [playerPublicProfiles.claimId],
		references: [playerClaims.id]
	}),
	user: one(users, {
		fields: [playerPublicProfiles.claimedByUserId],
		references: [users.id]
	}),
}));

export const walletsRelations = relations(wallets, ({one, many}) => ({
	user: one(users, {
		fields: [wallets.userId],
		references: [users.id]
	}),
	walletLedgerEntries: many(walletLedgerEntries),
}));

export const walletLedgerEntriesRelations = relations(walletLedgerEntries, ({one}) => ({
	wallet: one(wallets, {
		fields: [walletLedgerEntries.walletId],
		references: [wallets.id]
	}),
}));

export const feeLedgerRelations = relations(feeLedger, ({one}) => ({
	asset: one(assets, {
		fields: [feeLedger.assetId],
		references: [assets.id]
	}),
}));

export const playerEarningsLedgerRelations = relations(playerEarningsLedger, ({one}) => ({
	asset: one(assets, {
		fields: [playerEarningsLedger.assetId],
		references: [assets.id]
	}),
}));

export const predictionPositionsRelations = relations(predictionPositions, ({one, many}) => ({
	predictionMarket: one(predictionMarkets, {
		fields: [predictionPositions.marketId],
		references: [predictionMarkets.id]
	}),
	predictionOutcome: one(predictionOutcomes, {
		fields: [predictionPositions.outcomeId],
		references: [predictionOutcomes.id]
	}),
	predictionSettlements: many(predictionSettlements),
}));

export const predictionMarketsRelations = relations(predictionMarkets, ({one, many}) => ({
	predictionPositions: many(predictionPositions),
	predictionOutcomes: many(predictionOutcomes),
	predictionEvent: one(predictionEvents, {
		fields: [predictionMarkets.eventId],
		references: [predictionEvents.id]
	}),
	predictionOrders: many(predictionOrders),
	predictionSettlements: many(predictionSettlements),
	predictionPriceSnapshots: many(predictionPriceSnapshots),
	predictionMarketStats: many(predictionMarketStats),
	predictionMarketEvents: many(predictionMarketEvents),
}));

export const predictionOutcomesRelations = relations(predictionOutcomes, ({one, many}) => ({
	predictionPositions: many(predictionPositions),
	predictionMarket: one(predictionMarkets, {
		fields: [predictionOutcomes.marketId],
		references: [predictionMarkets.id]
	}),
	predictionOrders: many(predictionOrders),
	predictionPriceSnapshots: many(predictionPriceSnapshots),
}));

export const predictionEventsRelations = relations(predictionEvents, ({many}) => ({
	predictionMarkets: many(predictionMarkets),
}));

export const predictionOrdersRelations = relations(predictionOrders, ({one}) => ({
	predictionMarket: one(predictionMarkets, {
		fields: [predictionOrders.marketId],
		references: [predictionMarkets.id]
	}),
	predictionOutcome: one(predictionOutcomes, {
		fields: [predictionOrders.outcomeId],
		references: [predictionOutcomes.id]
	}),
}));

export const predictionSettlementsRelations = relations(predictionSettlements, ({one}) => ({
	predictionMarket: one(predictionMarkets, {
		fields: [predictionSettlements.marketId],
		references: [predictionMarkets.id]
	}),
	predictionPosition: one(predictionPositions, {
		fields: [predictionSettlements.positionId],
		references: [predictionPositions.id]
	}),
}));

export const predictionPriceSnapshotsRelations = relations(predictionPriceSnapshots, ({one}) => ({
	predictionMarket: one(predictionMarkets, {
		fields: [predictionPriceSnapshots.marketId],
		references: [predictionMarkets.id]
	}),
	predictionOutcome: one(predictionOutcomes, {
		fields: [predictionPriceSnapshots.outcomeId],
		references: [predictionOutcomes.id]
	}),
}));

export const predictionMarketStatsRelations = relations(predictionMarketStats, ({one}) => ({
	predictionMarket: one(predictionMarkets, {
		fields: [predictionMarketStats.marketId],
		references: [predictionMarkets.id]
	}),
}));

export const predictionMarketEventsRelations = relations(predictionMarketEvents, ({one}) => ({
	predictionMarket: one(predictionMarkets, {
		fields: [predictionMarketEvents.marketId],
		references: [predictionMarkets.id]
	}),
}));

export const predictionEventPublicationsRelations = relations(predictionEventPublications, ({one}) => ({
	predictionEventCandidate: one(predictionEventCandidates, {
		fields: [predictionEventPublications.candidateEventId],
		references: [predictionEventCandidates.id]
	}),
}));

export const predictionEventCandidatesRelations = relations(predictionEventCandidates, ({many}) => ({
	predictionEventPublications: many(predictionEventPublications),
}));

export const playerEarningsBalanceRelations = relations(playerEarningsBalance, ({one}) => ({
	asset: one(assets, {
		fields: [playerEarningsBalance.assetId],
		references: [assets.id]
	}),
}));

export const arenaUserSeasonStatsRelations = relations(arenaUserSeasonStats, ({one}) => ({
	arenaSeason: one(arenaSeasons, {
		fields: [arenaUserSeasonStats.seasonId],
		references: [arenaSeasons.id]
	}),
}));