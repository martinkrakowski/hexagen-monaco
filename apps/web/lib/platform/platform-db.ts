import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Single-tenant-per-deployment: one sqlite file per container — do not add
 * row-level tenancy or assume replicas > 1.
 */

export function openPlatformDb(dbPath: string): Database.Database {
  if (dbPath !== ":memory:") {
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT,
      email TEXT,
      email_verified TEXT,
      image TEXT,
      created_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email
      ON users (email) WHERE email IS NOT NULL AND email != '';

    CREATE TABLE IF NOT EXISTS accounts (
      provider TEXT NOT NULL,
      provider_account_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      PRIMARY KEY (provider, provider_account_id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_accounts_user
      ON accounts (user_id);

    CREATE TABLE IF NOT EXISTS sessions (
      session_token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS verification_tokens (
      identifier TEXT NOT NULL,
      token TEXT NOT NULL,
      expires TEXT NOT NULL,
      PRIMARY KEY (identifier, token)
    );

    CREATE TABLE IF NOT EXISTS saved_projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      ord INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_saved_projects_ord
      ON saved_projects (ord);

    CREATE TABLE IF NOT EXISTS run_events (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      project_id TEXT,
      stage INTEGER NOT NULL,
      label TEXT NOT NULL,
      model TEXT,
      refiner_model TEXT,
      duration_ms INTEGER NOT NULL,
      retry_count INTEGER NOT NULL,
      input_tokens INTEGER NOT NULL,
      output_tokens INTEGER NOT NULL,
      served_from_cache INTEGER NOT NULL,
      used_llm INTEGER NOT NULL,
      summary TEXT NOT NULL,
      cost_cents INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_run_events_created
      ON run_events (created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_run_events_run
      ON run_events (run_id);
    CREATE INDEX IF NOT EXISTS idx_run_events_project
      ON run_events (project_id);

    CREATE TABLE IF NOT EXISTS model_prices (
      model TEXT PRIMARY KEY,
      usd_per_1k_input REAL NOT NULL,
      usd_per_1k_output REAL NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS entitlements (
      user_id TEXT PRIMARY KEY,
      plan TEXT NOT NULL,
      repo_limit INTEGER NOT NULL,
      stripe_customer_id TEXT,
      stripe_subscription_id TEXT,
      status TEXT NOT NULL,
      current_period_end INTEGER,
      updated_at INTEGER NOT NULL
    );
  `);
  seedModelPrices(db);
  return db;
}

function seedModelPrices(db: Database.Database): void {
  const now = Date.now();
  const seed = db.prepare(`
    INSERT OR IGNORE INTO model_prices
      (model, usd_per_1k_input, usd_per_1k_output, updated_at)
    VALUES (?, ?, ?, ?)
  `);
  // Catalog prices used only to compute cost-per-run; not live billing.
  seed.run("mercury-2", 0.25, 1.25, now);
  seed.run("gpt-4o", 2.5, 10.0, now);
  seed.run("openai/gpt-4o", 2.5, 10.0, now);
}

const DEFAULT_DB_PATH =
  process.env.NODE_ENV === "production" ? "/data/platform.db" : ":memory:";

export function resolvePlatformDbPath(): string {
  return process.env.PLATFORM_DB_PATH ?? DEFAULT_DB_PATH;
}
