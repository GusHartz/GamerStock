CREATE TABLE "waitlist" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"discord" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "waitlist_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "access_requests" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"full_name" varchar NOT NULL,
	"email" varchar NOT NULL,
	"region" varchar,
	"primary_game" varchar,
	"username_interest" varchar,
	"note" text,
	"status" varchar DEFAULT 'pending' NOT NULL,
	"reviewed_by_user_id" varchar,
	"reviewed_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"token_hash" varchar NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"sid" varchar PRIMARY KEY NOT NULL,
	"sess" jsonb NOT NULL,
	"expire" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar,
	"first_name" varchar,
	"last_name" varchar,
	"profile_image_url" varchar,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"display_name" varchar,
	"password_hash" varchar,
	"games_selected" text[],
	"games_other" varchar,
	"role" varchar DEFAULT 'user',
	"email_verified" boolean DEFAULT false,
	"status" varchar DEFAULT 'active',
	"is_bot" boolean DEFAULT false,
	"must_change_password" boolean DEFAULT false,
	"blocked_at" timestamp,
	"last_login_at" timestamp,
	"created_by_admin" boolean DEFAULT false,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" serial PRIMARY KEY NOT NULL,
	"market_id" integer NOT NULL,
	"asset_uid" text NOT NULL,
	"entity_type" text NOT NULL,
	"external_id" text NOT NULL,
	"display_name" text NOT NULL,
	"symbol" text DEFAULT '' NOT NULL,
	"last_trade_price" numeric(10, 2) DEFAULT '10.00' NOT NULL,
	"price_24h_ago" numeric(10, 2) DEFAULT '10.00' NOT NULL,
	"volume_24h" numeric(15, 2) DEFAULT '0.00' NOT NULL,
	"momentum" numeric(8, 4) DEFAULT '0.0000' NOT NULL,
	"provider_json" text,
	"last_synced_at" timestamp DEFAULT now() NOT NULL,
	"fundamental_price" numeric(18, 6),
	"fundamental_updated_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "assets_asset_uid_unique" UNIQUE("asset_uid")
);
--> statement-breakpoint
CREATE TABLE "markets" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"game" text NOT NULL,
	"region" text DEFAULT 'global' NOT NULL,
	"scope" text DEFAULT 'default' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "markets_provider_game_region_scope_unique" UNIQUE("provider","game","region","scope")
);
--> statement-breakpoint
CREATE TABLE "riot_assets" (
	"puuid" text PRIMARY KEY NOT NULL,
	"game_name" text NOT NULL,
	"tag_line" text DEFAULT '' NOT NULL,
	"league_points" integer DEFAULT 0 NOT NULL,
	"wins" integer DEFAULT 0 NOT NULL,
	"losses" integer DEFAULT 0 NOT NULL,
	"winrate" numeric(5, 2) DEFAULT '0.00' NOT NULL,
	"last_trade_price" numeric(10, 2) NOT NULL,
	"price_24h_ago" numeric(10, 2) NOT NULL,
	"volume_24h" numeric(15, 2) DEFAULT '0.00' NOT NULL,
	"momentum" numeric(8, 4) DEFAULT '0.0000' NOT NULL,
	"last_synced_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "riot_match_cache" (
	"match_id" text PRIMARY KEY NOT NULL,
	"puuid" text NOT NULL,
	"game_start_timestamp" numeric(15, 0) DEFAULT '0' NOT NULL,
	"processed_at" timestamp DEFAULT now() NOT NULL,
	"team_position" text DEFAULT '' NOT NULL,
	"perf_score" numeric(6, 2) DEFAULT '50.00' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "riot_player_state" (
	"puuid" text PRIMARY KEY NOT NULL,
	"ema_perf" numeric(6, 2) DEFAULT '50.00' NOT NULL,
	"day_start_price" numeric(10, 2) DEFAULT '10.00' NOT NULL,
	"day_start_date" date DEFAULT CURRENT_DATE NOT NULL,
	"daily_change_pct" numeric(8, 4) DEFAULT '0.0000' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "riot_players" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" text DEFAULT 'NA1' NOT NULL,
	"queue" text DEFAULT 'RANKED_SOLO_5x5' NOT NULL,
	"summoner_id" text NOT NULL,
	"summoner_name" text NOT NULL,
	"league_points" integer DEFAULT 0 NOT NULL,
	"wins" integer DEFAULT 0 NOT NULL,
	"losses" integer DEFAULT 0 NOT NULL,
	"winrate" numeric(5, 2) DEFAULT '0.00' NOT NULL,
	"tier" text DEFAULT 'CHALLENGER' NOT NULL,
	"rank" text DEFAULT 'I' NOT NULL,
	"last_synced_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "riot_player_platform_queue_summoner" UNIQUE("platform","queue","summoner_id")
);
--> statement-breakpoint
CREATE TABLE "vault_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"vault_id" integer NOT NULL,
	"price" numeric(10, 2) NOT NULL,
	"performance_index" numeric(10, 2) NOT NULL,
	"recorded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vaults" (
	"id" serial PRIMARY KEY NOT NULL,
	"player_alias" text NOT NULL,
	"rank" text NOT NULL,
	"region" text NOT NULL,
	"winrate" numeric(5, 2) NOT NULL,
	"performance_index" numeric(10, 2) DEFAULT '100.00' NOT NULL,
	"momentum" numeric(5, 2) DEFAULT '0.00' NOT NULL,
	"last_trade_price" numeric(10, 2) NOT NULL,
	"price_24h_ago" numeric(10, 2) DEFAULT '10.00' NOT NULL,
	"volume_24h" numeric(15, 2) DEFAULT '0.00' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"asset_id" integer
);
--> statement-breakpoint
CREATE TABLE "performance_scores" (
	"id" serial PRIMARY KEY NOT NULL,
	"asset_id" text NOT NULL,
	"match_id" text NOT NULL,
	"role" text NOT NULL,
	"match_score" numeric(8, 4) NOT NULL,
	"ema_score" numeric(8, 4) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "player_match_metrics" (
	"id" serial PRIMARY KEY NOT NULL,
	"asset_id" text NOT NULL,
	"match_id" text NOT NULL,
	"game" text DEFAULT 'LOL' NOT NULL,
	"role" text NOT NULL,
	"metrics_json" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "player_match_metrics_unique" UNIQUE("match_id","asset_id")
);
--> statement-breakpoint
CREATE TABLE "role_baselines" (
	"id" serial PRIMARY KEY NOT NULL,
	"game" text NOT NULL,
	"queue" text DEFAULT 'RANKED_SOLO' NOT NULL,
	"tier" text DEFAULT 'CHALLENGER' NOT NULL,
	"role" text NOT NULL,
	"metric" text NOT NULL,
	"mean_value" numeric(12, 4) NOT NULL,
	"std_dev" numeric(12, 4) NOT NULL,
	"sample_size" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "role_baselines_unique" UNIQUE("game","queue","tier","role","metric")
);
--> statement-breakpoint
CREATE TABLE "role_metric_weights" (
	"id" serial PRIMARY KEY NOT NULL,
	"game" text NOT NULL,
	"role" text NOT NULL,
	"metric" text NOT NULL,
	"weight" numeric(6, 4) NOT NULL,
	CONSTRAINT "role_metric_weights_unique" UNIQUE("game","role","metric")
);
--> statement-breakpoint
CREATE TABLE "asset_valuation_state" (
	"asset_id" integer PRIMARY KEY NOT NULL,
	"puuid" text NOT NULL,
	"recent_performance" numeric(8, 4) DEFAULT '50.0000' NOT NULL,
	"consistency_score" numeric(8, 4) DEFAULT '50.0000' NOT NULL,
	"historical_skill" numeric(8, 4) DEFAULT '50.0000' NOT NULL,
	"activity_score" numeric(8, 4) DEFAULT '50.0000' NOT NULL,
	"pvi_raw" numeric(8, 4) DEFAULT '50.0000' NOT NULL,
	"pvi_final" numeric(8, 4) DEFAULT '50.0000' NOT NULL,
	"pvi_adjusted" numeric(8, 4) DEFAULT '50.0000' NOT NULL,
	"confidence_score" numeric(6, 4) DEFAULT '0.0000' NOT NULL,
	"fair_value_gs" numeric(10, 4) DEFAULT '5.0000' NOT NULL,
	"divergence_pct" numeric(10, 4) DEFAULT '0.0000' NOT NULL,
	"last_match_pulse" numeric(8, 4) DEFAULT '50.0000' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_config" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_market_state" (
	"asset_id" integer PRIMARY KEY NOT NULL,
	"supply" numeric(18, 6) DEFAULT '0.000000' NOT NULL,
	"last_price" numeric(18, 6) DEFAULT '10.000000' NOT NULL,
	"last_updated_at" timestamp DEFAULT now() NOT NULL,
	"version" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_markets" (
	"asset_id" integer PRIMARY KEY NOT NULL,
	"curve_type" text DEFAULT 'LOG' NOT NULL,
	"floor_price" numeric(18, 6) DEFAULT '5.000000' NOT NULL,
	"param_a" numeric(18, 6) DEFAULT '5.000000' NOT NULL,
	"param_b" numeric(18, 6) DEFAULT '100.000000' NOT NULL,
	"fee_bps" integer DEFAULT 100 NOT NULL,
	"platform_fee_split_bps" integer DEFAULT 7000 NOT NULL,
	"player_fee_split_bps" integer DEFAULT 3000 NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_news_pulses" (
	"id" serial PRIMARY KEY NOT NULL,
	"asset_id" integer,
	"news_event_id" integer,
	"direction" varchar(20) NOT NULL,
	"strength" numeric(6, 4) NOT NULL,
	"reason" text,
	"decay_until" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_price_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"asset_id" integer NOT NULL,
	"price" numeric(10, 2) NOT NULL,
	"volume_24h" numeric(15, 2) DEFAULT '0.00' NOT NULL,
	"momentum" numeric(8, 4) DEFAULT '0.0000' NOT NULL,
	"recorded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"user_id" text NOT NULL,
	"endpoint" text NOT NULL,
	"response" jsonb,
	"status" text DEFAULT 'completed' NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "market_sync_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"market_id" integer NOT NULL,
	"started_at" timestamp NOT NULL,
	"finished_at" timestamp,
	"duration_ms" integer,
	"status" text NOT NULL,
	"rows_fetched" integer,
	"rows_updated" integer,
	"error_message" text
);
--> statement-breakpoint
CREATE TABLE "market_sync_status" (
	"market_id" integer PRIMARY KEY NOT NULL,
	"last_success_at" timestamp,
	"consecutive_failures" integer DEFAULT 0,
	"paused_until" timestamp,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "news_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"external_id" varchar(255) NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"source" varchar(100),
	"source_url" text,
	"game" varchar(50),
	"category" varchar(100),
	"event_type" varchar(50),
	"sentiment" varchar(20),
	"impact_level" varchar(20),
	"entity_tags" jsonb,
	"published_at" timestamp with time zone,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "news_events_external_id_unique" UNIQUE("external_id")
);
--> statement-breakpoint
CREATE TABLE "trigger_order_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" varchar NOT NULL,
	"event_type" text NOT NULL,
	"meta_json" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trigger_orders" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"asset_id" text NOT NULL,
	"mode" text DEFAULT 'SANDBOX' NOT NULL,
	"side" text NOT NULL,
	"order_type" text NOT NULL,
	"trigger_price" numeric(18, 6) NOT NULL,
	"quantity" integer NOT NULL,
	"time_in_force" text DEFAULT 'GTC' NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"triggered_at" timestamp,
	"executed_at" timestamp,
	"last_error" text,
	"client_order_id" text,
	"max_slippage_bps" integer,
	"price_at_trigger" numeric(18, 6),
	"price_at_execution" numeric(18, 6)
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"portfolio_id" integer NOT NULL,
	"asset_id" integer,
	"type" text NOT NULL,
	"amount" numeric(18, 6) NOT NULL,
	"currency" text NOT NULL,
	"reference_type" text,
	"reference_id" integer,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "portfolios" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"balance" numeric(15, 2) DEFAULT '10000.00' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "portfolios_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "positions" (
	"id" serial PRIMARY KEY NOT NULL,
	"portfolio_id" integer NOT NULL,
	"vault_id" integer NOT NULL,
	"asset_id" integer,
	"shares" integer DEFAULT 0 NOT NULL,
	"average_cost" numeric(10, 2) NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "portfolio_vault_unique" UNIQUE("portfolio_id","vault_id")
);
--> statement-breakpoint
CREATE TABLE "riot_positions" (
	"id" serial PRIMARY KEY NOT NULL,
	"portfolio_id" integer NOT NULL,
	"puuid" text NOT NULL,
	"shares" integer DEFAULT 0 NOT NULL,
	"average_cost" numeric(10, 2) NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "riot_pos_unique" UNIQUE("portfolio_id","puuid")
);
--> statement-breakpoint
CREATE TABLE "riot_trades" (
	"id" serial PRIMARY KEY NOT NULL,
	"portfolio_id" integer NOT NULL,
	"puuid" text NOT NULL,
	"type" text NOT NULL,
	"shares" integer NOT NULL,
	"price_per_share" numeric(10, 2) NOT NULL,
	"total_cost" numeric(15, 2) NOT NULL,
	"fee" numeric(10, 2) NOT NULL,
	"executed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"id" serial PRIMARY KEY NOT NULL,
	"portfolio_id" integer NOT NULL,
	"vault_id" integer NOT NULL,
	"asset_id" integer,
	"type" text NOT NULL,
	"shares" integer NOT NULL,
	"price_per_share" numeric(10, 2) NOT NULL,
	"total_cost" numeric(15, 2) NOT NULL,
	"fee" numeric(10, 2) NOT NULL,
	"executed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_watchlist" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"asset_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "asset_watchlist_user_asset_unique" UNIQUE("user_id","asset_id")
);
--> statement-breakpoint
CREATE TABLE "watchlist" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"vault_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_vault_watchlist_unique" UNIQUE("user_id","vault_id")
);
--> statement-breakpoint
CREATE TABLE "achievements_catalog" (
	"code" varchar PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"icon_key" text DEFAULT 'trophy' NOT NULL,
	"rarity" text DEFAULT 'common' NOT NULL,
	"xp_reward" integer DEFAULT 0 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "arena_badges" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"icon_key" text NOT NULL,
	"rarity" text DEFAULT 'common' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "arena_challenges" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"type" text NOT NULL,
	"target" integer NOT NULL,
	"reward_xp" integer DEFAULT 0 NOT NULL,
	"starts_at" timestamp NOT NULL,
	"ends_at" timestamp NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "arena_duels" (
	"id" serial PRIMARY KEY NOT NULL,
	"challenger_user_id" text NOT NULL,
	"opponent_user_id" text NOT NULL,
	"metric" text DEFAULT 'highest_profit' NOT NULL,
	"duration_days" integer DEFAULT 7 NOT NULL,
	"start_date" timestamp,
	"end_date" timestamp,
	"status" text DEFAULT 'pending' NOT NULL,
	"winner_user_id" text,
	"result_type" text,
	"challenger_snapshot" jsonb,
	"opponent_snapshot" jsonb,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "arena_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"type" text NOT NULL,
	"xp_delta" integer DEFAULT 0 NOT NULL,
	"meta_json" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "arena_profiles" (
	"user_id" varchar PRIMARY KEY NOT NULL,
	"avatar_url" text,
	"avatar_id" text DEFAULT 'avatar_01',
	"bio" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "arena_season_leaderboard_snapshot" (
	"id" serial PRIMARY KEY NOT NULL,
	"season_id" integer NOT NULL,
	"metric" text NOT NULL,
	"user_id" text NOT NULL,
	"rank_position" integer NOT NULL,
	"value" numeric(18, 6) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "arena_seasons" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"starts_at" timestamp NOT NULL,
	"ends_at" timestamp NOT NULL,
	"status" text DEFAULT 'upcoming' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "arena_trader_follows" (
	"id" serial PRIMARY KEY NOT NULL,
	"follower_user_id" text NOT NULL,
	"followed_user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "arena_follows_unique" UNIQUE("follower_user_id","followed_user_id")
);
--> statement-breakpoint
CREATE TABLE "arena_user_season_stats" (
	"season_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"xp_season" integer DEFAULT 0 NOT NULL,
	"rank_season" text DEFAULT 'Bronze' NOT NULL,
	"realized_profit_season" numeric(18, 6) DEFAULT '0' NOT NULL,
	"trades_season" integer DEFAULT 0 NOT NULL,
	"win_trades_season" integer DEFAULT 0 NOT NULL,
	"loss_trades_season" integer DEFAULT 0 NOT NULL,
	"best_trade_pnl_season" numeric(18, 6),
	"worst_trade_pnl_season" numeric(18, 6),
	"win_streak_current_season" integer DEFAULT 0 NOT NULL,
	"win_streak_best_season" integer DEFAULT 0 NOT NULL,
	"loss_streak_current_season" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "arena_user_season_stats_season_id_user_id_pk" PRIMARY KEY("season_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "arena_user_stats" (
	"user_id" varchar PRIMARY KEY NOT NULL,
	"xp_total" integer DEFAULT 0 NOT NULL,
	"rank" text DEFAULT 'Bronze' NOT NULL,
	"realized_profit_total" numeric(18, 6) DEFAULT '0' NOT NULL,
	"trades_total" integer DEFAULT 0 NOT NULL,
	"win_trades" integer DEFAULT 0 NOT NULL,
	"loss_trades" integer DEFAULT 0 NOT NULL,
	"best_trade_pnl" numeric(18, 6),
	"worst_trade_pnl" numeric(18, 6),
	"win_streak_current" integer DEFAULT 0 NOT NULL,
	"win_streak_best" integer DEFAULT 0 NOT NULL,
	"loss_streak_current" integer DEFAULT 0 NOT NULL,
	"trader_style" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "draft_entries" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"week_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"locked_at" timestamp,
	"total_score" numeric(10, 4) DEFAULT '0' NOT NULL,
	"role_score" numeric(10, 4) DEFAULT '0' NOT NULL,
	"performance_score" numeric(10, 4) DEFAULT '0' NOT NULL,
	"status" varchar DEFAULT 'open' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "draft_entries_week_user_unique" UNIQUE("week_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "draft_entry_picks" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"draft_entry_id" varchar NOT NULL,
	"slot_type" varchar NOT NULL,
	"role_code" varchar,
	"player_id" varchar NOT NULL,
	"score" numeric(10, 4) DEFAULT '0' NOT NULL,
	"score_breakdown_json" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "draft_player_week_metrics" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" varchar NOT NULL,
	"week_id" varchar NOT NULL,
	"role_code" varchar NOT NULL,
	"matches_count" integer DEFAULT 0 NOT NULL,
	"avg_match_score" numeric(10, 4) DEFAULT '0' NOT NULL,
	"weekly_performance_score" numeric(10, 4) DEFAULT '0' NOT NULL,
	"pvi_start" numeric(10, 4),
	"pvi_end" numeric(10, 4),
	"pvi_delta" numeric(10, 4),
	"fair_value_start" numeric(10, 4),
	"fair_value_end" numeric(10, 4),
	"market_price_start" numeric(10, 4),
	"market_price_end" numeric(10, 4),
	"undervaluation_level" numeric(10, 4),
	"breakout_score" numeric(10, 4),
	"rising_star_score" numeric(10, 4),
	"hidden_gem_score" numeric(10, 4),
	"eligible" boolean DEFAULT false NOT NULL,
	"computed_at" timestamp,
	CONSTRAINT "draft_pw_metrics_player_week_uq" UNIQUE("player_id","week_id")
);
--> statement-breakpoint
CREATE TABLE "draft_user_season_stats" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"season_id" varchar NOT NULL,
	"draft_score_total" numeric(10, 4) DEFAULT '0' NOT NULL,
	"draft_weeks_played" integer DEFAULT 0 NOT NULL,
	"avg_draft_score" numeric(10, 4) DEFAULT '0' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "draft_weeks" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game" varchar NOT NULL,
	"region" varchar NOT NULL,
	"start_at" timestamp NOT NULL,
	"lock_at" timestamp NOT NULL,
	"end_at" timestamp NOT NULL,
	"status" varchar DEFAULT 'open' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "season_reward_distributions" (
	"id" serial PRIMARY KEY NOT NULL,
	"season_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"badge_code" text NOT NULL,
	"final_rank" integer,
	"meta_json" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "season_reward_dist_unique" UNIQUE("season_id","user_id","badge_code")
);
--> statement-breakpoint
CREATE TABLE "season_rewards" (
	"id" serial PRIMARY KEY NOT NULL,
	"season_id" integer NOT NULL,
	"rank_min" integer NOT NULL,
	"rank_max" integer NOT NULL,
	"badge_code" text NOT NULL,
	"label" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_achievements" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"achievement_code" varchar NOT NULL,
	"unlocked_at" timestamp DEFAULT now() NOT NULL,
	"meta_json" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_achievements_user_code_uq" UNIQUE("user_id","achievement_code")
);
--> statement-breakpoint
CREATE TABLE "user_badges" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"badge_code" text NOT NULL,
	"meta_json" jsonb,
	"awarded_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_badges_user_badge_unique" UNIQUE("user_id","badge_code")
);
--> statement-breakpoint
CREATE TABLE "bot_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"strategy" varchar NOT NULL,
	"risk_profile" varchar DEFAULT 'MEDIUM' NOT NULL,
	"interval_multiplier" numeric(4, 2) DEFAULT '1.00' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "bot_profiles_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "fee_ledger" (
	"id" serial PRIMARY KEY NOT NULL,
	"reference_type" text NOT NULL,
	"reference_id" text NOT NULL,
	"asset_id" integer,
	"currency" text DEFAULT 'GS' NOT NULL,
	"notional" numeric(18, 6) NOT NULL,
	"fee_total" numeric(18, 6) NOT NULL,
	"platform_fee" numeric(18, 6) NOT NULL,
	"player_fee" numeric(18, 6) NOT NULL,
	"liquidity_fee" numeric(18, 6) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "player_earnings_balance" (
	"asset_id" integer NOT NULL,
	"currency" text NOT NULL,
	"accrued_balance" numeric(18, 6) DEFAULT '0.000000' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "player_earnings_balance_asset_id_currency_pk" PRIMARY KEY("asset_id","currency")
);
--> statement-breakpoint
CREATE TABLE "player_earnings_ledger" (
	"id" serial PRIMARY KEY NOT NULL,
	"asset_id" integer NOT NULL,
	"currency" text NOT NULL,
	"direction" text NOT NULL,
	"amount" numeric(18, 6) NOT NULL,
	"balance_after" numeric(18, 6) NOT NULL,
	"reference_type" text NOT NULL,
	"reference_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "pel_idempotency_key" UNIQUE("asset_id","currency","reference_type","reference_id","direction")
);
--> statement-breakpoint
CREATE TABLE "player_fee_balance" (
	"asset_id" integer PRIMARY KEY NOT NULL,
	"balance" numeric(18, 6) DEFAULT '0.000000' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_wallet_ledger" (
	"id" serial PRIMARY KEY NOT NULL,
	"wallet_type" text NOT NULL,
	"currency" text NOT NULL,
	"direction" text NOT NULL,
	"amount" numeric(18, 6) NOT NULL,
	"balance_after" numeric(18, 6) NOT NULL,
	"reference_type" text,
	"reference_id" text,
	"description" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_wallets" (
	"id" serial PRIMARY KEY NOT NULL,
	"wallet_type" text NOT NULL,
	"currency" text NOT NULL,
	"balance" numeric(18, 6) DEFAULT '0.000000' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "system_wallets_type_currency_unique" UNIQUE("wallet_type","currency")
);
--> statement-breakpoint
CREATE TABLE "player_claims" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"asset_id" integer NOT NULL,
	"asset_uid" text NOT NULL,
	"puuid" text,
	"claim_status" varchar(32) DEFAULT 'pending' NOT NULL,
	"verification_method" varchar(64) DEFAULT 'manual_admin_review' NOT NULL,
	"evidence_note" text,
	"requested_at" timestamp DEFAULT now() NOT NULL,
	"reviewed_at" timestamp,
	"reviewed_by" varchar,
	"approved_at" timestamp,
	"rejected_at" timestamp,
	"rejection_reason" text,
	"revoked_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "player_public_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"asset_id" integer NOT NULL,
	"claimed_by_user_id" varchar NOT NULL,
	"claim_id" integer NOT NULL,
	"bio" text,
	"profile_image_url" text,
	"banner_url" text,
	"headline" text,
	"social_links_json" text DEFAULT '[]' NOT NULL,
	"team_affiliation" varchar(128),
	"is_visible" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallet_ledger_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"wallet_id" integer NOT NULL,
	"currency" text NOT NULL,
	"entry_type" text NOT NULL,
	"direction" text NOT NULL,
	"amount" numeric(18, 6) NOT NULL,
	"balance_after" numeric(18, 6) NOT NULL,
	"reference_type" text,
	"reference_id" text,
	"description" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "wle_amount_positive" CHECK (amount > 0)
);
--> statement-breakpoint
CREATE TABLE "wallets" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"currency" text NOT NULL,
	"available_balance" numeric(18, 6) DEFAULT '0' NOT NULL,
	"locked_balance" numeric(18, 6) DEFAULT '0' NOT NULL,
	"total_balance" numeric(18, 6) DEFAULT '0' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "wallets_user_currency_unique" UNIQUE("user_id","currency"),
	CONSTRAINT "wallets_available_non_negative" CHECK (available_balance >= 0),
	CONSTRAINT "wallets_locked_non_negative" CHECK (locked_balance >= 0),
	CONSTRAINT "wallets_total_non_negative" CHECK (total_balance >= 0),
	CONSTRAINT "wallets_total_invariant" CHECK (total_balance = available_balance + locked_balance)
);
--> statement-breakpoint
CREATE TABLE "prediction_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"uid" varchar(64) NOT NULL,
	"tournament_name" varchar(255),
	"event_name" varchar(255),
	"title" varchar(255) NOT NULL,
	"game" varchar(50) DEFAULT 'lol' NOT NULL,
	"region" varchar(50),
	"event_type" varchar(50) DEFAULT 'match' NOT NULL,
	"team_a" varchar(100),
	"team_b" varchar(100),
	"status" varchar(30) DEFAULT 'scheduled' NOT NULL,
	"scheduled_at" timestamp,
	"external_ref" varchar(128),
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "prediction_events_uid_unique" UNIQUE("uid")
);
--> statement-breakpoint
CREATE TABLE "prediction_market_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"market_id" integer NOT NULL,
	"event_type" varchar(50) NOT NULL,
	"from_status" varchar(30),
	"to_status" varchar(30),
	"actor_user_id" varchar(128),
	"source" varchar(50),
	"note" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prediction_market_stats" (
	"id" serial PRIMARY KEY NOT NULL,
	"market_id" integer NOT NULL,
	"volume_24h" numeric(18, 6) DEFAULT '0' NOT NULL,
	"traders_24h" integer DEFAULT 0 NOT NULL,
	"last_price_yes" numeric(10, 6),
	"last_price_no" numeric(10, 6),
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "prediction_market_stats_market_id_unique" UNIQUE("market_id")
);
--> statement-breakpoint
CREATE TABLE "prediction_markets" (
	"id" serial PRIMARY KEY NOT NULL,
	"uid" varchar(64) NOT NULL,
	"slug" varchar(128),
	"event_id" integer,
	"question" varchar(512) NOT NULL,
	"description" text,
	"market_type" varchar(30) DEFAULT 'binary' NOT NULL,
	"status" varchar(20) DEFAULT 'draft' NOT NULL,
	"resolved_outcome_id" integer,
	"currency" varchar(10) DEFAULT 'GS' NOT NULL,
	"pool_total" numeric(18, 6) DEFAULT '0' NOT NULL,
	"min_stake" numeric(18, 6) DEFAULT '1.000000' NOT NULL,
	"max_stake" numeric(18, 6),
	"opens_at" timestamp,
	"closes_at" timestamp,
	"resolved_at" timestamp,
	"settled_at" timestamp,
	"resolution_source" varchar(128),
	"created_by_user_id" varchar(128),
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "prediction_markets_uid_unique" UNIQUE("uid"),
	CONSTRAINT "prediction_markets_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "prediction_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"market_id" integer NOT NULL,
	"user_id" varchar(128) NOT NULL,
	"outcome_id" integer NOT NULL,
	"side" varchar(10) NOT NULL,
	"order_type" varchar(10) NOT NULL,
	"quantity" numeric(18, 6) NOT NULL,
	"price" numeric(18, 6),
	"total_value" numeric(18, 6),
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"idempotency_key" varchar(128),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "prediction_orders_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "prediction_outcomes" (
	"id" serial PRIMARY KEY NOT NULL,
	"market_id" integer NOT NULL,
	"code" varchar(50),
	"label" varchar(255) NOT NULL,
	"description" text,
	"pool_share" numeric(18, 6) DEFAULT '0' NOT NULL,
	"implied_probability" numeric(6, 4),
	"is_winner" boolean DEFAULT false,
	"payout_value" numeric(18, 6),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prediction_positions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(128) NOT NULL,
	"market_id" integer NOT NULL,
	"outcome_id" integer NOT NULL,
	"quantity" numeric(18, 6),
	"avg_price" numeric(18, 6),
	"cost_basis" numeric(18, 6),
	"realized_pnl" numeric(18, 6),
	"stake" numeric(18, 6),
	"currency" varchar(10) DEFAULT 'GS' NOT NULL,
	"payout" numeric(18, 6),
	"payout_at" timestamp,
	"cancelled_at" timestamp,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"wallet_ledger_ref" varchar(128),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prediction_price_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"market_id" integer NOT NULL,
	"outcome_id" integer NOT NULL,
	"price" numeric(10, 6) NOT NULL,
	"volume_window" numeric(18, 6),
	"recorded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prediction_settlements" (
	"id" serial PRIMARY KEY NOT NULL,
	"market_id" integer NOT NULL,
	"user_id" varchar(128) NOT NULL,
	"position_id" integer,
	"gross_payout" numeric(18, 6) NOT NULL,
	"fees" numeric(18, 6) DEFAULT '0' NOT NULL,
	"net_payout" numeric(18, 6) NOT NULL,
	"ledger_reference_id" varchar(128),
	"settled_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prediction_display_queue" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_type" varchar(50) NOT NULL,
	"entity_id" integer NOT NULL,
	"surface" varchar(100) NOT NULL,
	"position" integer NOT NULL,
	"starts_at" timestamp,
	"ends_at" timestamp,
	"is_active" boolean DEFAULT true NOT NULL,
	"curation_label" varchar(255),
	"created_by" varchar(64),
	"updated_by" varchar(64),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prediction_event_candidates" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" varchar(50) NOT NULL,
	"source_event_id" varchar(255) NOT NULL,
	"source_series_id" varchar(255),
	"source_league_id" varchar(255),
	"source_tournament_id" varchar(255),
	"game_code" varchar(50) DEFAULT 'lol' NOT NULL,
	"league_name" varchar(255),
	"tournament_name" varchar(255),
	"match_title" varchar(500),
	"team_a_name" varchar(150),
	"team_b_name" varchar(150),
	"team_a_external_ref" varchar(255),
	"team_b_external_ref" varchar(255),
	"scheduled_start_at" timestamp,
	"original_status" varchar(100),
	"normalized_status" varchar(50) DEFAULT 'pending' NOT NULL,
	"winner_side" varchar(10),
	"winner_external_ref" varchar(255),
	"dedupe_key" varchar(512) NOT NULL,
	"confidence_score" numeric(5, 4),
	"review_status" varchar(50) DEFAULT 'pending' NOT NULL,
	"visibility_state" varchar(50) DEFAULT 'hidden' NOT NULL,
	"publish_at" timestamp,
	"reviewed_by" varchar(64),
	"reviewed_at" timestamp,
	"review_notes" text,
	"raw_payload" jsonb,
	"normalized_payload" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "prediction_event_candidates_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "prediction_event_publications" (
	"id" serial PRIMARY KEY NOT NULL,
	"candidate_event_id" integer NOT NULL,
	"prediction_event_id" integer,
	"published_by" varchar(64),
	"published_at" timestamp DEFAULT now() NOT NULL,
	"publication_mode" varchar(50) DEFAULT 'manual' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vault_snapshots" ADD CONSTRAINT "vault_snapshots_vault_id_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."vaults"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vaults" ADD CONSTRAINT "vaults_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_valuation_state" ADD CONSTRAINT "asset_valuation_state_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_market_state" ADD CONSTRAINT "asset_market_state_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_markets" ADD CONSTRAINT "asset_markets_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_news_pulses" ADD CONSTRAINT "asset_news_pulses_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_news_pulses" ADD CONSTRAINT "asset_news_pulses_news_event_id_news_events_id_fk" FOREIGN KEY ("news_event_id") REFERENCES "public"."news_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_price_snapshots" ADD CONSTRAINT "asset_price_snapshots_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trigger_order_events" ADD CONSTRAINT "trigger_order_events_order_id_trigger_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."trigger_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trigger_orders" ADD CONSTRAINT "trigger_orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolios" ADD CONSTRAINT "portfolios_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_portfolio_id_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_vault_id_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."vaults"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "riot_positions" ADD CONSTRAINT "riot_positions_portfolio_id_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "riot_trades" ADD CONSTRAINT "riot_trades_portfolio_id_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_portfolio_id_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_vault_id_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."vaults"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_watchlist" ADD CONSTRAINT "asset_watchlist_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_watchlist" ADD CONSTRAINT "asset_watchlist_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlist" ADD CONSTRAINT "watchlist_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlist" ADD CONSTRAINT "watchlist_vault_id_vaults_id_fk" FOREIGN KEY ("vault_id") REFERENCES "public"."vaults"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arena_duels" ADD CONSTRAINT "arena_duels_challenger_user_id_users_id_fk" FOREIGN KEY ("challenger_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arena_duels" ADD CONSTRAINT "arena_duels_opponent_user_id_users_id_fk" FOREIGN KEY ("opponent_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arena_profiles" ADD CONSTRAINT "arena_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arena_season_leaderboard_snapshot" ADD CONSTRAINT "arena_season_leaderboard_snapshot_season_id_arena_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."arena_seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arena_trader_follows" ADD CONSTRAINT "arena_trader_follows_follower_user_id_users_id_fk" FOREIGN KEY ("follower_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arena_trader_follows" ADD CONSTRAINT "arena_trader_follows_followed_user_id_users_id_fk" FOREIGN KEY ("followed_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arena_user_season_stats" ADD CONSTRAINT "arena_user_season_stats_season_id_arena_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."arena_seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arena_user_stats" ADD CONSTRAINT "arena_user_stats_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_entries" ADD CONSTRAINT "draft_entries_week_id_draft_weeks_id_fk" FOREIGN KEY ("week_id") REFERENCES "public"."draft_weeks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_entries" ADD CONSTRAINT "draft_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_entry_picks" ADD CONSTRAINT "draft_entry_picks_draft_entry_id_draft_entries_id_fk" FOREIGN KEY ("draft_entry_id") REFERENCES "public"."draft_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_player_week_metrics" ADD CONSTRAINT "draft_player_week_metrics_week_id_draft_weeks_id_fk" FOREIGN KEY ("week_id") REFERENCES "public"."draft_weeks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_user_season_stats" ADD CONSTRAINT "draft_user_season_stats_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "season_reward_distributions" ADD CONSTRAINT "season_reward_distributions_season_id_arena_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."arena_seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "season_rewards" ADD CONSTRAINT "season_rewards_season_id_arena_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."arena_seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "season_rewards" ADD CONSTRAINT "season_rewards_badge_code_arena_badges_code_fk" FOREIGN KEY ("badge_code") REFERENCES "public"."arena_badges"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_achievements" ADD CONSTRAINT "user_achievements_achievement_code_achievements_catalog_code_fk" FOREIGN KEY ("achievement_code") REFERENCES "public"."achievements_catalog"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_badges" ADD CONSTRAINT "user_badges_badge_code_arena_badges_code_fk" FOREIGN KEY ("badge_code") REFERENCES "public"."arena_badges"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_profiles" ADD CONSTRAINT "bot_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_ledger" ADD CONSTRAINT "fee_ledger_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_earnings_balance" ADD CONSTRAINT "player_earnings_balance_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_earnings_ledger" ADD CONSTRAINT "player_earnings_ledger_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_fee_balance" ADD CONSTRAINT "player_fee_balance_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_claims" ADD CONSTRAINT "player_claims_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_claims" ADD CONSTRAINT "player_claims_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_public_profiles" ADD CONSTRAINT "player_public_profiles_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_public_profiles" ADD CONSTRAINT "player_public_profiles_claimed_by_user_id_users_id_fk" FOREIGN KEY ("claimed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_public_profiles" ADD CONSTRAINT "player_public_profiles_claim_id_player_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."player_claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_ledger_entries" ADD CONSTRAINT "wallet_ledger_entries_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prediction_market_events" ADD CONSTRAINT "prediction_market_events_market_id_prediction_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."prediction_markets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prediction_market_stats" ADD CONSTRAINT "prediction_market_stats_market_id_prediction_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."prediction_markets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prediction_markets" ADD CONSTRAINT "prediction_markets_event_id_prediction_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."prediction_events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prediction_orders" ADD CONSTRAINT "prediction_orders_market_id_prediction_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."prediction_markets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prediction_orders" ADD CONSTRAINT "prediction_orders_outcome_id_prediction_outcomes_id_fk" FOREIGN KEY ("outcome_id") REFERENCES "public"."prediction_outcomes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prediction_outcomes" ADD CONSTRAINT "prediction_outcomes_market_id_prediction_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."prediction_markets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prediction_positions" ADD CONSTRAINT "prediction_positions_market_id_prediction_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."prediction_markets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prediction_positions" ADD CONSTRAINT "prediction_positions_outcome_id_prediction_outcomes_id_fk" FOREIGN KEY ("outcome_id") REFERENCES "public"."prediction_outcomes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prediction_price_snapshots" ADD CONSTRAINT "prediction_price_snapshots_market_id_prediction_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."prediction_markets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prediction_price_snapshots" ADD CONSTRAINT "prediction_price_snapshots_outcome_id_prediction_outcomes_id_fk" FOREIGN KEY ("outcome_id") REFERENCES "public"."prediction_outcomes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prediction_settlements" ADD CONSTRAINT "prediction_settlements_market_id_prediction_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."prediction_markets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prediction_settlements" ADD CONSTRAINT "prediction_settlements_position_id_prediction_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."prediction_positions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prediction_event_publications" ADD CONSTRAINT "prediction_event_publications_candidate_event_id_prediction_event_candidates_id_fk" FOREIGN KEY ("candidate_event_id") REFERENCES "public"."prediction_event_candidates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "IDX_session_expire" ON "sessions" USING btree ("expire");--> statement-breakpoint
CREATE INDEX "assets_market_idx" ON "assets" USING btree ("market_id");--> statement-breakpoint
CREATE INDEX "assets_price_idx" ON "assets" USING btree ("last_trade_price");--> statement-breakpoint
CREATE INDEX "markets_provider_game_idx" ON "markets" USING btree ("provider","game");--> statement-breakpoint
CREATE INDEX "riot_asset_lp_idx" ON "riot_assets" USING btree ("league_points");--> statement-breakpoint
CREATE INDEX "match_cache_puuid_idx" ON "riot_match_cache" USING btree ("puuid");--> statement-breakpoint
CREATE INDEX "riot_player_lp_idx" ON "riot_players" USING btree ("league_points");--> statement-breakpoint
CREATE INDEX "performance_scores_asset_idx" ON "performance_scores" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "performance_scores_created_idx" ON "performance_scores" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "player_match_metrics_asset_idx" ON "player_match_metrics" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "player_match_metrics_created_idx" ON "player_match_metrics" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "role_baselines_role_idx" ON "role_baselines" USING btree ("game","role");--> statement-breakpoint
CREATE INDEX "role_metric_weights_role_idx" ON "role_metric_weights" USING btree ("game","role");--> statement-breakpoint
CREATE INDEX "asset_valuation_puuid_idx" ON "asset_valuation_state" USING btree ("puuid");--> statement-breakpoint
CREATE INDEX "asset_valuation_updated_idx" ON "asset_valuation_state" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "asset_news_pulses_asset_idx" ON "asset_news_pulses" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "asset_news_pulses_news_event_idx" ON "asset_news_pulses" USING btree ("news_event_id");--> statement-breakpoint
CREATE INDEX "asset_news_pulses_decay_idx" ON "asset_news_pulses" USING btree ("decay_until");--> statement-breakpoint
CREATE INDEX "asset_snap_asset_time_idx" ON "asset_price_snapshots" USING btree ("asset_id","recorded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_unique" ON "idempotency_keys" USING btree ("key","user_id","endpoint");--> statement-breakpoint
CREATE INDEX "news_events_external_id_idx" ON "news_events" USING btree ("external_id");--> statement-breakpoint
CREATE INDEX "news_events_published_at_idx" ON "news_events" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "news_events_sentiment_idx" ON "news_events" USING btree ("sentiment");--> statement-breakpoint
CREATE INDEX "news_events_game_idx" ON "news_events" USING btree ("game");--> statement-breakpoint
CREATE INDEX "trigger_order_events_order_idx" ON "trigger_order_events" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "trigger_orders_status_mode_idx" ON "trigger_orders" USING btree ("status","mode");--> statement-breakpoint
CREATE INDEX "trigger_orders_asset_mode_idx" ON "trigger_orders" USING btree ("asset_id","mode");--> statement-breakpoint
CREATE INDEX "trigger_orders_user_status_idx" ON "trigger_orders" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "trigger_orders_mode_status_updated_idx" ON "trigger_orders" USING btree ("mode","status","updated_at");--> statement-breakpoint
CREATE INDEX "ledger_user_idx" ON "ledger_entries" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ledger_portfolio_idx" ON "ledger_entries" USING btree ("portfolio_id");--> statement-breakpoint
CREATE INDEX "ledger_reference_idx" ON "ledger_entries" USING btree ("reference_type","reference_id");--> statement-breakpoint
CREATE INDEX "portfolio_vault_idx" ON "positions" USING btree ("portfolio_id","vault_id");--> statement-breakpoint
CREATE INDEX "riot_pos_portfolio_idx" ON "riot_positions" USING btree ("portfolio_id");--> statement-breakpoint
CREATE INDEX "riot_trade_portfolio_idx" ON "riot_trades" USING btree ("portfolio_id");--> statement-breakpoint
CREATE INDEX "riot_trade_puuid_idx" ON "riot_trades" USING btree ("puuid");--> statement-breakpoint
CREATE INDEX "asset_watchlist_user_idx" ON "asset_watchlist" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "arena_challenges_status_idx" ON "arena_challenges" USING btree ("status");--> statement-breakpoint
CREATE INDEX "arena_challenges_dates_idx" ON "arena_challenges" USING btree ("starts_at","ends_at");--> statement-breakpoint
CREATE INDEX "arena_duels_challenger_idx" ON "arena_duels" USING btree ("challenger_user_id");--> statement-breakpoint
CREATE INDEX "arena_duels_opponent_idx" ON "arena_duels" USING btree ("opponent_user_id");--> statement-breakpoint
CREATE INDEX "arena_duels_status_idx" ON "arena_duels" USING btree ("status");--> statement-breakpoint
CREATE INDEX "arena_events_user_idx" ON "arena_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "arena_snapshot_season_metric_rank_idx" ON "arena_season_leaderboard_snapshot" USING btree ("season_id","metric","rank_position");--> statement-breakpoint
CREATE INDEX "arena_seasons_status_idx" ON "arena_seasons" USING btree ("status");--> statement-breakpoint
CREATE INDEX "arena_seasons_starts_at_idx" ON "arena_seasons" USING btree ("starts_at");--> statement-breakpoint
CREATE INDEX "arena_seasons_ends_at_idx" ON "arena_seasons" USING btree ("ends_at");--> statement-breakpoint
CREATE INDEX "arena_follows_follower_idx" ON "arena_trader_follows" USING btree ("follower_user_id");--> statement-breakpoint
CREATE INDEX "arena_follows_followed_idx" ON "arena_trader_follows" USING btree ("followed_user_id");--> statement-breakpoint
CREATE INDEX "arena_season_stats_xp_idx" ON "arena_user_season_stats" USING btree ("season_id","xp_season");--> statement-breakpoint
CREATE INDEX "arena_season_stats_profit_idx" ON "arena_user_season_stats" USING btree ("season_id","realized_profit_season");--> statement-breakpoint
CREATE INDEX "arena_season_stats_wins_idx" ON "arena_user_season_stats" USING btree ("season_id","win_trades_season");--> statement-breakpoint
CREATE INDEX "arena_user_stats_xp_idx" ON "arena_user_stats" USING btree ("xp_total");--> statement-breakpoint
CREATE INDEX "arena_user_stats_profit_idx" ON "arena_user_stats" USING btree ("realized_profit_total");--> statement-breakpoint
CREATE INDEX "arena_user_stats_trades_idx" ON "arena_user_stats" USING btree ("trades_total");--> statement-breakpoint
CREATE INDEX "draft_entries_user_id_idx" ON "draft_entries" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "draft_entry_picks_player_id_idx" ON "draft_entry_picks" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "draft_player_week_metrics_player_id_idx" ON "draft_player_week_metrics" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "draft_player_week_metrics_week_id_idx" ON "draft_player_week_metrics" USING btree ("week_id");--> statement-breakpoint
CREATE INDEX "season_reward_dist_season_idx" ON "season_reward_distributions" USING btree ("season_id");--> statement-breakpoint
CREATE INDEX "season_rewards_season_idx" ON "season_rewards" USING btree ("season_id");--> statement-breakpoint
CREATE INDEX "user_achievements_user_unlocked_idx" ON "user_achievements" USING btree ("user_id","unlocked_at");--> statement-breakpoint
CREATE INDEX "user_badges_user_idx" ON "user_badges" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "bot_profiles_user_idx" ON "bot_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "bot_profiles_strategy_idx" ON "bot_profiles" USING btree ("strategy");--> statement-breakpoint
CREATE INDEX "fee_ledger_asset_time_idx" ON "fee_ledger" USING btree ("asset_id","created_at");--> statement-breakpoint
CREATE INDEX "fee_ledger_ref_idx" ON "fee_ledger" USING btree ("reference_type","reference_id");--> statement-breakpoint
CREATE INDEX "peb_asset_currency_idx" ON "player_earnings_balance" USING btree ("asset_id","currency");--> statement-breakpoint
CREATE INDEX "pel_asset_currency_idx" ON "player_earnings_ledger" USING btree ("asset_id","currency");--> statement-breakpoint
CREATE INDEX "pel_ref_idx" ON "player_earnings_ledger" USING btree ("reference_type","reference_id");--> statement-breakpoint
CREATE INDEX "swl_type_currency_idx" ON "system_wallet_ledger" USING btree ("wallet_type","currency");--> statement-breakpoint
CREATE INDEX "swl_ref_idx" ON "system_wallet_ledger" USING btree ("reference_type","reference_id");--> statement-breakpoint
CREATE INDEX "player_claims_user_idx" ON "player_claims" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "player_claims_asset_idx" ON "player_claims" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "player_claims_status_idx" ON "player_claims" USING btree ("claim_status");--> statement-breakpoint
CREATE INDEX "player_public_profiles_asset_idx" ON "player_public_profiles" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "player_public_profiles_user_idx" ON "player_public_profiles" USING btree ("claimed_by_user_id");--> statement-breakpoint
CREATE INDEX "wle_user_idx" ON "wallet_ledger_entries" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "wle_wallet_idx" ON "wallet_ledger_entries" USING btree ("wallet_id");--> statement-breakpoint
CREATE INDEX "wle_created_idx" ON "wallet_ledger_entries" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "wle_ref_idx" ON "wallet_ledger_entries" USING btree ("reference_type","reference_id");--> statement-breakpoint
CREATE INDEX "wallets_user_idx" ON "wallets" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_pred_events_game" ON "prediction_events" USING btree ("game");--> statement-breakpoint
CREATE INDEX "idx_pred_events_status" ON "prediction_events" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_pred_events_starts_at" ON "prediction_events" USING btree ("scheduled_at");--> statement-breakpoint
CREATE INDEX "idx_pred_mkt_events_market_id" ON "prediction_market_events" USING btree ("market_id");--> statement-breakpoint
CREATE INDEX "idx_pred_mkt_events_created_at" ON "prediction_market_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_pred_mkt_events_event_type" ON "prediction_market_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "idx_pred_stats_market_id" ON "prediction_market_stats" USING btree ("market_id");--> statement-breakpoint
CREATE INDEX "idx_pred_markets_status" ON "prediction_markets" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_pred_markets_event_id" ON "prediction_markets" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "idx_pred_markets_slug" ON "prediction_markets" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "idx_pred_markets_open_at" ON "prediction_markets" USING btree ("opens_at");--> statement-breakpoint
CREATE INDEX "idx_pred_orders_market_id" ON "prediction_orders" USING btree ("market_id");--> statement-breakpoint
CREATE INDEX "idx_pred_orders_user_id" ON "prediction_orders" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_pred_orders_status" ON "prediction_orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_pred_orders_idempotency_key" ON "prediction_orders" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "idx_pred_outcomes_market_id" ON "prediction_outcomes" USING btree ("market_id");--> statement-breakpoint
CREATE INDEX "idx_pred_positions_user_id" ON "prediction_positions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_pred_positions_market_id" ON "prediction_positions" USING btree ("market_id");--> statement-breakpoint
CREATE INDEX "idx_pred_positions_outcome_id" ON "prediction_positions" USING btree ("outcome_id");--> statement-breakpoint
CREATE INDEX "idx_pred_snapshots_market_outcome" ON "prediction_price_snapshots" USING btree ("market_id","outcome_id");--> statement-breakpoint
CREATE INDEX "idx_pred_snapshots_recorded_at" ON "prediction_price_snapshots" USING btree ("recorded_at");--> statement-breakpoint
CREATE INDEX "idx_pred_settlements_market_id" ON "prediction_settlements" USING btree ("market_id");--> statement-breakpoint
CREATE INDEX "idx_pred_settlements_user_id" ON "prediction_settlements" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_pred_settlements_position_id" ON "prediction_settlements" USING btree ("position_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_display_queue_surface_position" ON "prediction_display_queue" USING btree ("surface","position");--> statement-breakpoint
CREATE INDEX "idx_display_queue_entity" ON "prediction_display_queue" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "idx_display_queue_is_active" ON "prediction_display_queue" USING btree ("is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_candidate_source_event" ON "prediction_event_candidates" USING btree ("source","source_event_id");--> statement-breakpoint
CREATE INDEX "idx_candidate_dedupe_key" ON "prediction_event_candidates" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "idx_candidate_review_status" ON "prediction_event_candidates" USING btree ("review_status");--> statement-breakpoint
CREATE INDEX "idx_candidate_game_code" ON "prediction_event_candidates" USING btree ("game_code");--> statement-breakpoint
CREATE INDEX "idx_candidate_scheduled_start" ON "prediction_event_candidates" USING btree ("scheduled_start_at");--> statement-breakpoint
CREATE INDEX "idx_pub_candidate_event_id" ON "prediction_event_publications" USING btree ("candidate_event_id");--> statement-breakpoint
CREATE INDEX "idx_pub_prediction_event_id" ON "prediction_event_publications" USING btree ("prediction_event_id");