import { sql } from "drizzle-orm";
import { db } from "../db";

const REQUIRED_TABLES = [
  "arena_profiles",
  "arena_user_stats",
  "arena_events",
  "achievements_catalog",
  "user_achievements",
  "arena_seasons",
  "arena_user_season_stats",
  "arena_badges",
  "user_badges",
  "arena_season_leaderboard_snapshot",
];

const CRITICAL_COLUMNS: Record<string, string[]> = {
  arena_user_stats: [
    "user_id", "xp_total", "rank", "realized_profit_total", "trades_total",
    "win_trades", "loss_trades", "win_streak_current", "win_streak_best", "loss_streak_current",
  ],
  arena_profiles: ["user_id", "avatar_url", "bio", "display_name"],
  arena_user_season_stats: [
    "season_id", "user_id", "xp_season", "rank_season", "realized_profit_season",
    "trades_season", "win_trades_season", "loss_trades_season",
    "win_streak_current_season", "win_streak_best_season", "loss_streak_current_season",
  ],
  arena_seasons: ["id", "name", "starts_at", "ends_at", "status"],
  achievements_catalog: ["code", "name", "description", "icon_key", "rarity", "xp_reward"],
  user_achievements: ["id", "user_id", "achievement_code", "unlocked_at"],
  arena_badges: ["code", "name", "description", "icon_key", "rarity"],
  user_badges: ["id", "user_id", "badge_code", "awarded_at"],
};

async function tableExists(tableName: string): Promise<boolean> {
  const result = await db.execute(
    sql.raw(`SELECT to_regclass('public.${tableName}') IS NOT NULL AS exists`)
  );
  return (result.rows[0] as any)?.exists === true;
}

async function getTableColumns(tableName: string): Promise<string[]> {
  const result = await db.execute(
    sql.raw(`SELECT column_name FROM information_schema.columns WHERE table_name = '${tableName}' AND table_schema = 'public'`)
  );
  return result.rows.map((r: any) => r.column_name);
}

async function getCount(tableName: string): Promise<number> {
  try {
    const result = await db.execute(sql.raw(`SELECT COUNT(*)::int AS count FROM "${tableName}"`));
    return (result.rows[0] as any)?.count ?? 0;
  } catch {
    return -1;
  }
}

export async function runDiagnostics() {
  const dbUrl = process.env.DATABASE_URL ?? "";
  const hostMatch = dbUrl.match(/@([^/:]+)/);
  const dbIdentifier = hostMatch ? hostMatch[1] : "unknown";

  const tables: Record<string, boolean> = {};
  for (const t of REQUIRED_TABLES) {
    tables[t] = await tableExists(t);
  }

  const columns: Record<string, string[]> = {};
  for (const [table, critCols] of Object.entries(CRITICAL_COLUMNS)) {
    if (tables[table]) {
      const actual = await getTableColumns(table);
      columns[table] = critCols.filter((c) => !actual.includes(c));
    } else {
      columns[table] = critCols;
    }
  }

  const achievementsCatalogCount = tables["achievements_catalog"] ? await getCount("achievements_catalog") : -1;
  const badgesCount = tables["arena_badges"] ? await getCount("arena_badges") : -1;

  const suggestedFixes: string[] = [];
  for (const [t, exists] of Object.entries(tables)) {
    if (!exists) suggestedFixes.push(`Table '${t}' is missing — run bootstrap to create it`);
  }
  for (const [t, missingCols] of Object.entries(columns)) {
    if (missingCols.length > 0) {
      suggestedFixes.push(`Table '${t}' missing columns: ${missingCols.join(", ")} — run bootstrap`);
    }
  }
  if (achievementsCatalogCount === 0) suggestedFixes.push("achievements_catalog is empty — run bootstrap with seed:true");
  if (badgesCount === 0) suggestedFixes.push("arena_badges is empty — run bootstrap with seed:true");

  return {
    env: process.env.NODE_ENV ?? "unknown",
    dbIdentifier,
    tables,
    missingColumns: columns,
    seedStatus: { achievementsCatalogCount, badgesCount },
    suggestedFixes,
    healthy: suggestedFixes.length === 0,
  };
}

async function execSafe(label: string, rawSql: string, actions: string[]) {
  try {
    await db.execute(sql.raw(rawSql));
    actions.push(`OK: ${label}`);
  } catch (err: any) {
    actions.push(`ERROR: ${label} — ${err.message}`);
  }
}

export async function runBootstrap(options: {
  seed?: boolean;
  createSeason1?: boolean;
  activateSeason1?: boolean;
}) {
  const { seed = true, createSeason1 = false, activateSeason1 = false } = options;
  const actions: string[] = [];

  // --- Create tables ---
  await execSafe("CREATE arena_profiles", `
    CREATE TABLE IF NOT EXISTS arena_profiles (
      user_id TEXT PRIMARY KEY,
      avatar_url TEXT,
      bio TEXT,
      display_name TEXT,
      updated_at TIMESTAMP DEFAULT NOW() NOT NULL
    )
  `, actions);

  await execSafe("CREATE arena_user_stats", `
    CREATE TABLE IF NOT EXISTS arena_user_stats (
      user_id TEXT PRIMARY KEY,
      xp_total INTEGER NOT NULL DEFAULT 0,
      rank TEXT NOT NULL DEFAULT 'Bronze',
      realized_profit_total NUMERIC(18,6) NOT NULL DEFAULT 0,
      trades_total INTEGER NOT NULL DEFAULT 0,
      win_trades INTEGER NOT NULL DEFAULT 0,
      loss_trades INTEGER NOT NULL DEFAULT 0,
      best_trade_pnl NUMERIC(18,6),
      worst_trade_pnl NUMERIC(18,6),
      win_streak_current INTEGER NOT NULL DEFAULT 0,
      win_streak_best INTEGER NOT NULL DEFAULT 0,
      loss_streak_current INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMP DEFAULT NOW() NOT NULL
    )
  `, actions);

  await execSafe("CREATE arena_events", `
    CREATE TABLE IF NOT EXISTS arena_events (
      id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      xp_delta INTEGER NOT NULL DEFAULT 0,
      meta_json JSONB,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL
    )
  `, actions);
  await execSafe("IDX arena_events user_id", `CREATE INDEX IF NOT EXISTS arena_events_user_id_idx ON arena_events(user_id)`, actions);

  await execSafe("CREATE achievements_catalog", `
    CREATE TABLE IF NOT EXISTS achievements_catalog (
      code TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      icon_key TEXT NOT NULL,
      rarity TEXT NOT NULL DEFAULT 'common',
      xp_reward INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL
    )
  `, actions);

  await execSafe("CREATE user_achievements", `
    CREATE TABLE IF NOT EXISTS user_achievements (
      id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      achievement_code TEXT NOT NULL REFERENCES achievements_catalog(code),
      unlocked_at TIMESTAMP DEFAULT NOW() NOT NULL,
      CONSTRAINT user_achievements_user_code_unique UNIQUE(user_id, achievement_code)
    )
  `, actions);
  await execSafe("IDX user_achievements user_id", `CREATE INDEX IF NOT EXISTS user_achievements_user_id_idx ON user_achievements(user_id)`, actions);

  await execSafe("CREATE arena_seasons", `
    CREATE TABLE IF NOT EXISTS arena_seasons (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      starts_at TIMESTAMP NOT NULL,
      ends_at TIMESTAMP NOT NULL,
      status TEXT NOT NULL DEFAULT 'upcoming',
      created_at TIMESTAMP DEFAULT NOW() NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW() NOT NULL
    )
  `, actions);
  await execSafe("IDX arena_seasons status", `CREATE INDEX IF NOT EXISTS arena_seasons_status_idx ON arena_seasons(status)`, actions);

  await execSafe("CREATE arena_user_season_stats", `
    CREATE TABLE IF NOT EXISTS arena_user_season_stats (
      season_id INTEGER NOT NULL REFERENCES arena_seasons(id),
      user_id TEXT NOT NULL,
      xp_season INTEGER NOT NULL DEFAULT 0,
      rank_season TEXT NOT NULL DEFAULT 'Bronze',
      realized_profit_season NUMERIC(18,6) NOT NULL DEFAULT 0,
      trades_season INTEGER NOT NULL DEFAULT 0,
      win_trades_season INTEGER NOT NULL DEFAULT 0,
      loss_trades_season INTEGER NOT NULL DEFAULT 0,
      best_trade_pnl_season NUMERIC(18,6),
      worst_trade_pnl_season NUMERIC(18,6),
      win_streak_current_season INTEGER NOT NULL DEFAULT 0,
      win_streak_best_season INTEGER NOT NULL DEFAULT 0,
      loss_streak_current_season INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMP DEFAULT NOW() NOT NULL,
      PRIMARY KEY (season_id, user_id)
    )
  `, actions);

  await execSafe("CREATE arena_badges", `
    CREATE TABLE IF NOT EXISTS arena_badges (
      code TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      icon_key TEXT NOT NULL,
      rarity TEXT NOT NULL DEFAULT 'common',
      created_at TIMESTAMP DEFAULT NOW() NOT NULL
    )
  `, actions);

  await execSafe("CREATE user_badges", `
    CREATE TABLE IF NOT EXISTS user_badges (
      id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      badge_code TEXT NOT NULL REFERENCES arena_badges(code),
      meta_json JSONB,
      awarded_at TIMESTAMP DEFAULT NOW() NOT NULL,
      CONSTRAINT user_badges_user_badge_unique UNIQUE(user_id, badge_code)
    )
  `, actions);
  await execSafe("IDX user_badges user_id", `CREATE INDEX IF NOT EXISTS user_badges_user_idx ON user_badges(user_id)`, actions);

  await execSafe("CREATE arena_season_leaderboard_snapshot", `
    CREATE TABLE IF NOT EXISTS arena_season_leaderboard_snapshot (
      id SERIAL PRIMARY KEY,
      season_id INTEGER NOT NULL REFERENCES arena_seasons(id),
      metric TEXT NOT NULL,
      user_id TEXT NOT NULL,
      rank_position INTEGER NOT NULL,
      value NUMERIC(18,6) NOT NULL,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL
    )
  `, actions);
  await execSafe("IDX snapshot season_metric_rank", `CREATE INDEX IF NOT EXISTS arena_snapshot_season_metric_rank_idx ON arena_season_leaderboard_snapshot(season_id, metric, rank_position)`, actions);

  // --- Add missing columns (ALTER TABLE ... ADD COLUMN IF NOT EXISTS) ---
  const colPatches: [string, string, string][] = [
    ["arena_user_stats", "win_streak_current", "ALTER TABLE arena_user_stats ADD COLUMN IF NOT EXISTS win_streak_current INTEGER NOT NULL DEFAULT 0"],
    ["arena_user_stats", "win_streak_best", "ALTER TABLE arena_user_stats ADD COLUMN IF NOT EXISTS win_streak_best INTEGER NOT NULL DEFAULT 0"],
    ["arena_user_stats", "loss_streak_current", "ALTER TABLE arena_user_stats ADD COLUMN IF NOT EXISTS loss_streak_current INTEGER NOT NULL DEFAULT 0"],
    ["arena_user_stats", "best_trade_pnl", "ALTER TABLE arena_user_stats ADD COLUMN IF NOT EXISTS best_trade_pnl NUMERIC(18,6)"],
    ["arena_user_stats", "worst_trade_pnl", "ALTER TABLE arena_user_stats ADD COLUMN IF NOT EXISTS worst_trade_pnl NUMERIC(18,6)"],
  ];

  for (const [table, col, alterSql] of colPatches) {
    await execSafe(`ADD COLUMN ${table}.${col}`, alterSql, actions);
  }

  // --- Seed ---
  if (seed) {
    await seedAchievements(actions);
    await seedBadges(actions);
  }

  // --- Season 1 ---
  if (createSeason1) {
    await ensureSeason1(activateSeason1, actions);
  }

  const after = await runDiagnostics();
  return { ok: true, actions, after };
}

export async function seedAchievements(actions: string[]) {
  const count = await getCount("achievements_catalog");
  if (count !== 0) {
    actions.push(`SKIP: achievements_catalog already has ${count} rows`);
    return;
  }

  const achievements = [
    { code: "FIRST_TRADE", name: "First Trade", description: "Execute your first trade", icon_key: "activity", rarity: "common", xp_reward: 50 },
    { code: "TEN_TRADES", name: "Active Trader", description: "Execute 10 trades", icon_key: "trending-up", rarity: "common", xp_reward: 100 },
    { code: "HUNDRED_TRADES", name: "Veteran Trader", description: "Execute 100 trades", icon_key: "award", rarity: "rare", xp_reward: 300 },
    { code: "FIRST_PROFIT", name: "In the Green", description: "Close your first profitable trade", icon_key: "dollar-sign", rarity: "common", xp_reward: 100 },
    { code: "BIG_WIN_20PCT", name: "Big Win", description: "Close a trade with 20%+ profit", icon_key: "zap", rarity: "rare", xp_reward: 250 },
    { code: "PROFIT_100", name: "Centurion", description: "Accumulate $100 in realized profit", icon_key: "coins", rarity: "common", xp_reward: 150 },
    { code: "PROFIT_1000", name: "Grand Master", description: "Accumulate $1,000 in realized profit", icon_key: "gem", rarity: "epic", xp_reward: 500 },
    { code: "THREE_WINS_ROW", name: "Hot Streak", description: "Win 3 trades in a row", icon_key: "flame", rarity: "rare", xp_reward: 250 },
    { code: "COMEBACK_KID", name: "Comeback Kid", description: "Win after 3+ consecutive losses", icon_key: "refresh-cw", rarity: "epic", xp_reward: 400 },
    { code: "DAILY_TRADER_3", name: "Consistent", description: "Trade on 3 different calendar days", icon_key: "calendar", rarity: "rare", xp_reward: 300 },
  ];

  for (const a of achievements) {
    await execSafe(
      `SEED achievement ${a.code}`,
      `INSERT INTO achievements_catalog (code, name, description, icon_key, rarity, xp_reward) VALUES ('${a.code}','${a.name.replace(/'/g, "''")}','${a.description.replace(/'/g, "''")}','${a.icon_key}','${a.rarity}',${a.xp_reward}) ON CONFLICT DO NOTHING`,
      actions
    );
  }
}

export async function seedBadges(actions: string[]) {
  const count = await getCount("arena_badges");
  if (count !== 0) {
    actions.push(`SKIP: arena_badges already has ${count} rows`);
    return;
  }

  const badges = [
    { code: "S1_CHAMPION", name: "Season 1 Champion", description: "#1 overall profit for the season", icon_key: "crown", rarity: "legendary" },
    { code: "S1_ELITE_TRADER", name: "Elite Trader", description: "Top 1% profit for the season", icon_key: "diamond", rarity: "epic" },
    { code: "S1_MASTER_TRADER", name: "Master Trader", description: "Top 10% profit for the season", icon_key: "shield-diamond", rarity: "rare" },
    { code: "S1_RANKED_TRADER", name: "Ranked Trader", description: "Top 25% profit for the season", icon_key: "shield", rarity: "common" },
    { code: "S1_PROFIT_ELITE", name: "Profit Elite", description: "Top 1% realized profit for the season", icon_key: "chart-up", rarity: "epic" },
    { code: "S1_XP_ELITE", name: "XP Elite", description: "Top 1% XP earner for the season", icon_key: "bolt", rarity: "epic" },
    { code: "S1_SHARPSHOOTER", name: "Sharpshooter", description: "Top 1% win rate for the season (min 20 trades)", icon_key: "target", rarity: "epic" },
    { code: "S1_PARTICIPANT", name: "Season 1 Participant", description: "Completed 10+ trades in Season 1", icon_key: "ticket", rarity: "common" },
  ];

  for (const b of badges) {
    await execSafe(
      `SEED badge ${b.code}`,
      `INSERT INTO arena_badges (code, name, description, icon_key, rarity) VALUES ('${b.code}','${b.name.replace(/'/g, "''")}','${b.description.replace(/'/g, "''")}','${b.icon_key}','${b.rarity}') ON CONFLICT DO NOTHING`,
      actions
    );
  }
}

export async function ensureSeason1(activate: boolean, actions: string[]) {
  const existing = await db.execute(sql.raw(`SELECT id FROM arena_seasons WHERE name='Season 1' LIMIT 1`));
  let seasonId: number | null = (existing.rows[0] as any)?.id ?? null;

  if (!seasonId) {
    const inserted = await db.execute(sql.raw(
      `INSERT INTO arena_seasons (name, starts_at, ends_at, status) VALUES ('Season 1', NOW(), NOW() + INTERVAL '365 days', 'upcoming') RETURNING id`
    ));
    seasonId = (inserted.rows[0] as any)?.id ?? null;
    actions.push(`OK: Created Season 1 with id=${seasonId}`);
  } else {
    actions.push(`SKIP: Season 1 already exists (id=${seasonId})`);
  }

  if (activate && seasonId) {
    await execSafe("Close existing active seasons", `UPDATE arena_seasons SET status='closed', updated_at=NOW() WHERE status='active' AND id != ${seasonId}`, actions);
    await execSafe("Activate Season 1", `UPDATE arena_seasons SET status='active', updated_at=NOW() WHERE id=${seasonId}`, actions);
  }
}
