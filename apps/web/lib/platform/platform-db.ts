import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

/**
 * One sqlite file per container; rows are scoped by JWT `sub` (`owner_id`).
 * Do not assume replicas > 1.
 */

export function openPlatformDb(dbPath: string): Database.Database {
  if (dbPath !== ":memory:") {
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  // SQLite keeps FK enforcement off unless the connection opts in. The
  // CREATE TABLE statements below (and accounts/sessions) declare FKs;
  // without this they are comments.
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT,
      email TEXT,
      email_verified TEXT,
      image TEXT,
      github_login TEXT,
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
  `);
  // Owner columns / composite PKs must exist before any index that names
  // them. CREATE TABLE IF NOT EXISTS is a no-op on a pre-owner legacy
  // table, so migrate those tables first (PR review: index-before-column).
  //
  // `users.github_login` obeys the same rule: the CREATE above is a no-op on
  // an existing database, so the column arrives by ALTER before the partial
  // index below can name it.
  migrateUsersGithubLogin(db);
  migrateSavedProjects(db);
  migrateRunEvents(db);
  db.exec(`
    DROP INDEX IF EXISTS idx_users_github_login;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_github_login
      ON users (github_login COLLATE NOCASE) WHERE github_login IS NOT NULL;

    -- H1.1 (2026-08-20 hosting plan). An org is just another owner: its UUID
    -- goes in the same \`owner_id\` column every project statement already
    -- scopes by, so no store schema changes. Authorization lives entirely in
    -- membership resolution (H1.2 \`requireTenant\`).
    CREATE TABLE IF NOT EXISTS orgs (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL,
      name TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_orgs_slug ON orgs (slug);

    -- Personal users and orgs share the owner_id namespace. An org row whose
    -- id equals a user id would make requireTenant treat org membership as
    -- access to that user's personal projects. Block both insert directions.
    CREATE TRIGGER IF NOT EXISTS org_id_not_user_id
    BEFORE INSERT ON orgs
    FOR EACH ROW
    WHEN EXISTS (SELECT 1 FROM users WHERE id = NEW.id)
    BEGIN
      SELECT RAISE(ABORT, 'org id collides with an existing user');
    END;
    CREATE TRIGGER IF NOT EXISTS user_id_not_org_id
    BEFORE INSERT ON users
    FOR EACH ROW
    WHEN EXISTS (SELECT 1 FROM orgs WHERE id = NEW.id)
    BEGIN
      SELECT RAISE(ABORT, 'user id collides with an existing org');
    END;

    -- role: 'owner' (billing, membership, org delete) | 'member' (full
    -- project/run read-write). Two roles only -- H1.3/D-A2: viewer roles and
    -- per-project ACLs have no v1 buyer.
    --
    -- org_id is constrained to orgs: a membership whose org_id is a personal
    -- user id (no orgs row) would otherwise authorize against that user.
    CREATE TABLE IF NOT EXISTS org_members (
      org_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (org_id, user_id),
      FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_org_members_user
      ON org_members (user_id);

    -- Keyed by GitHub login, not user id: an invitee may have no account yet.
    -- It stays pending until their first sign-in populates users.github_login
    -- (P-A1), which is consistent with GitHub-only auth (D-H1).
    -- COLLATE NOCASE: GitHub logins are case-insensitive; Ada and ada are
    -- the same invitee.
    CREATE TABLE IF NOT EXISTS org_invites (
      org_id TEXT NOT NULL,
      github_login TEXT NOT NULL COLLATE NOCASE,
      role TEXT NOT NULL,
      invited_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      accepted_at TEXT,
      PRIMARY KEY (org_id, github_login),
      FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_org_invites_login
      ON org_invites (github_login) WHERE accepted_at IS NULL;

    -- P-A2. A team is a GRANTEE GROUPING, never an owner (D-A1): teams appear
    -- only in \`project_shares.grantee_type\`, so no project ever carries a team
    -- id in \`owner_id\` and ownership statements stay untouched. The slug is
    -- the share handle: \`@org-slug/team-slug\`.
    CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      slug TEXT NOT NULL,
      name TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_teams_org_slug
      ON teams (org_id, slug);

    -- NOT enforced here: there is no foreign key and no trigger, so SQLite
    -- accepts any (team_id, user_id) pair written directly. The rule lives in
    -- teams-store.addMember, which checks org_members and inserts in one
    -- transaction, and in orgs-store.removeMember, which deletes these rows in
    -- the same transaction as the org row. A team membership that outlives its
    -- org membership would be a grant nobody can see or revoke -- application
    -- code is what prevents it.
    CREATE TABLE IF NOT EXISTS team_members (
      team_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (team_id, user_id)
    );
    -- P-A3 asks "which teams is this user in" on every shared-project read.
    CREATE INDEX IF NOT EXISTS idx_team_members_user
      ON team_members (user_id);

    -- D-A6: narrow, and APPEND-ONLY BY CONSTRUCTION, not by schema -- SQLite
    -- would accept UPDATE or DELETE against this table. What makes the property
    -- hold is that no such statement is prepared anywhere in the codebase, and
    -- AuditLogRepository exposes only an append and a count; a guard test
    -- asserts that surface. v1 actions are team add/remove; share/revoke join
    -- in P-A4.
    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      actor_id TEXT NOT NULL,
      action TEXT NOT NULL,
      subject_owner_id TEXT,
      subject_id TEXT,
      grantee_type TEXT,
      grantee_id TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_log_subject
      ON audit_log (subject_owner_id, subject_id);

    -- P-A3. A grant is NOT ownership: a project has exactly one owner
    -- (saved_projects PK (owner_id, id)) and any number of grants beside it.
    -- grantee_type is user | org | team (D-A1 -- a team is a grantee, never an
    -- owner); role is read | write (D-A2).
    --
    -- Revocation is SOFT: revoked_at NULL means live, and every read filters
    -- on it. A hard delete would take the audit trail with it, and "who could
    -- see this project last March" is exactly the question a share table has
    -- to answer.
    CREATE TABLE IF NOT EXISTS project_shares (
      owner_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      grantee_type TEXT NOT NULL,
      grantee_id TEXT NOT NULL,
      role TEXT NOT NULL,
      granted_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      revoked_at TEXT,
      PRIMARY KEY (owner_id, project_id, grantee_type, grantee_id)
    );
    -- "what is shared with me" -- the grantee side, hit on every shared-list
    -- read and on every access resolution for a non-owner.
    CREATE INDEX IF NOT EXISTS idx_project_shares_grantee
      ON project_shares (grantee_type, grantee_id) WHERE revoked_at IS NULL;
    -- "who can see this project" -- the owner side, for the manage-shares view
    -- and for cascading revocation when an org or project goes away.
    CREATE INDEX IF NOT EXISTS idx_project_shares_subject
      ON project_shares (owner_id, project_id);
  `);
  db.exec(`
    DROP INDEX IF EXISTS idx_saved_projects_ord;
    CREATE INDEX IF NOT EXISTS idx_saved_projects_ord
      ON saved_projects (owner_id, ord);

    CREATE INDEX IF NOT EXISTS idx_run_events_created
      ON run_events (created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_run_events_run
      ON run_events (run_id);
    DROP INDEX IF EXISTS idx_run_events_project;
    CREATE INDEX IF NOT EXISTS idx_run_events_project
      ON run_events (owner_id, project_id);
    CREATE INDEX IF NOT EXISTS idx_run_events_owner
      ON run_events (owner_id, created_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_run_events_run_stage
      ON run_events (owner_id, run_id, stage);

    CREATE TABLE IF NOT EXISTS model_prices (
      model TEXT PRIMARY KEY,
      usd_per_1k_input REAL NOT NULL,
      usd_per_1k_output REAL NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS project_owner_state (
      owner_id TEXT PRIMARY KEY,
      initialized INTEGER NOT NULL
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

    -- One row per completed scan, owner-scoped (F-13).
    --
    -- Deliberately NOT a variant of saved_projects: savedProjectBodySchema
    -- requires formState + manifestYaml, neither of which a scan produces.
    --
    -- Bulk lives on the /data volume, not in the row: artifact_path +
    -- artifact_bytes reference the handoff zip / full findings.json, while the
    -- inline columns carry only already-clipped text and a capped findings
    -- sample. A large monorepo therefore cannot inflate a row.
    --
    -- schema_version is per-row, not per-database, because reads gate on it
    -- (see scan-records-store.ts) rather than migrating in place.
    CREATE TABLE IF NOT EXISTS scan_records (
      id TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      schema_version INTEGER NOT NULL,
      project_name TEXT NOT NULL,
      repo_ref TEXT,
      tier TEXT NOT NULL,
      verdict TEXT NOT NULL,
      exit_code INTEGER,
      files_scanned INTEGER,
      findings_fresh INTEGER NOT NULL,
      findings_baselined INTEGER NOT NULL,
      findings_stale INTEGER NOT NULL,
      findings_expired INTEGER NOT NULL,
      layout_excerpt TEXT,
      report_markdown TEXT,
      error_message TEXT,
      findings_sample TEXT NOT NULL,
      artifact_path TEXT,
      artifact_bytes INTEGER,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (owner_id, id)
    );
    CREATE INDEX IF NOT EXISTS idx_scan_records_owner
      ON scan_records (owner_id, created_at DESC);
    -- Trend queries are always "this repo, this owner, newest first".
    CREATE INDEX IF NOT EXISTS idx_scan_records_repo
      ON scan_records (owner_id, repo_ref, created_at DESC);

    -- Repair-outcome telemetry: one row per repair loop, owner-scoped.
    -- See repair-telemetry-store.ts for the grain argument and, more
    -- importantly, for the retention contract these two tables are shaped by.
    --
    -- ADDITIVE-ONLY MIGRATION. Both tables are new, so there is no prior shape
    -- to convert: CREATE TABLE IF NOT EXISTS plus CREATE INDEX IF NOT
    -- EXISTS is the whole of it. No ALTER, no DROP, no table rebuild, no data
    -- movement -- nothing on the live /data volume is read or rewritten, and
    -- re-running openPlatformDb on the same file is a no-op. Deliberately NOT
    -- given a migrateX() helper like saved_projects/run_events: those exist
    -- only because those tables predate owner_id, and inventing one here
    -- would add a rewrite path with nothing to rewrite.
    --
    -- Forward-only, and safe to roll back THROUGH: a previous deploy simply
    -- never queries these tables. sqlite does not mind the extra schema.
    --
    -- NOTE ON WHAT IS ABSENT: there is no project_id and no repo_ref column
    -- here, unlike run_events and scan_records. That is the point -- either
    -- would let a reader attach a repair history to a named project or
    -- owner/repo, which the shipped "nothing was kept" copy forbids. The
    -- only correlation key is an opaque run id the store validates on write.
    CREATE TABLE IF NOT EXISTS repair_runs (
      id TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      schema_version INTEGER NOT NULL,
      run_id TEXT NOT NULL,
      surface TEXT NOT NULL,
      outcome TEXT NOT NULL,
      rounds INTEGER NOT NULL,
      violations_initial INTEGER NOT NULL,
      violations_remaining INTEGER NOT NULL,
      attempts_total INTEGER NOT NULL,
      attempts_applied INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (owner_id, id)
    );
    -- run_id, not id, carries the uniqueness: a reconnect or a retried write
    -- re-sends the same loop and must upsert rather than double-count it
    -- (same reasoning as idx_run_events_run_stage).
    CREATE UNIQUE INDEX IF NOT EXISTS idx_repair_runs_run
      ON repair_runs (owner_id, run_id);
    CREATE INDEX IF NOT EXISTS idx_repair_runs_owner
      ON repair_runs (owner_id, created_at DESC);

    -- One row per (round, attempt-within-round). The per-run table above cannot
    -- express per-violation-class success rates, and this table cannot express
    -- "abandoned" -- abandonment is a property of the loop, not of an attempt.
    CREATE TABLE IF NOT EXISTS repair_attempts (
      id TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      schema_version INTEGER NOT NULL,
      run_id TEXT NOT NULL,
      round INTEGER NOT NULL,
      seq INTEGER NOT NULL,
      violation_class TEXT NOT NULL,
      violation_status TEXT NOT NULL,
      path TEXT NOT NULL,
      eligible INTEGER NOT NULL,
      applied INTEGER NOT NULL,
      changed_yaml INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL,
      ops_proposed INTEGER,
      ops_applied INTEGER,
      ops_skipped INTEGER,
      gate_reason TEXT,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (owner_id, id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_repair_attempts_slot
      ON repair_attempts (owner_id, run_id, round, seq);
    -- The eval read is "group every attempt by class", so the class leads.
    CREATE INDEX IF NOT EXISTS idx_repair_attempts_class
      ON repair_attempts (owner_id, violation_class, schema_version);
  `);
  seedModelPrices(db);
  return db;
}

function tableExists(db: Database.Database, table: string): boolean {
  const row = db
    .prepare(
      "SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?",
    )
    .get(table) as { ok: number } | undefined;
  return row !== undefined;
}

function tableHasColumn(
  db: Database.Database,
  table: string,
  column: string,
): boolean {
  const cols = db.pragma(`table_info(${table})`) as Array<{ name: string }>;
  return cols.some((col) => col.name === column);
}

function primaryKeyColumns(db: Database.Database, table: string): string[] {
  const cols = db.pragma(`table_info(${table})`) as Array<{
    name: string;
    pk: number;
  }>;
  return cols
    .filter((col) => col.pk > 0)
    .sort((a, b) => a.pk - b.pk)
    .map((col) => col.name);
}

const SAVED_PROJECTS_DDL = `
  id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  ord INTEGER NOT NULL,
  PRIMARY KEY (owner_id, id)
`;

/**
 * P-A1: `users.github_login`, added by ALTER on databases that predate it.
 *
 * Nullable and backfilled only at the next sign-in -- a migration must never
 * call GitHub. An existing user therefore has NULL here and must keep signing
 * in normally; the partial unique index permits any number of NULLs.
 */
function migrateUsersGithubLogin(db: Database.Database): void {
  if (!tableExists(db, "users")) return;
  if (tableHasColumn(db, "users", "github_login")) return;
  db.exec("ALTER TABLE users ADD COLUMN github_login TEXT");
}

function migrateSavedProjects(db: Database.Database): void {
  if (!tableExists(db, "saved_projects")) {
    db.exec(`CREATE TABLE saved_projects (${SAVED_PROJECTS_DDL})`);
    return;
  }
  const hasOwner = tableHasColumn(db, "saved_projects", "owner_id");
  const pk = primaryKeyColumns(db, "saved_projects");
  const compositePk = pk.length === 2 && pk[0] === "owner_id" && pk[1] === "id";
  if (hasOwner && compositePk) return;

  db.exec(`CREATE TABLE saved_projects_migrated (${SAVED_PROJECTS_DDL})`);
  if (hasOwner) {
    db.exec(`
      INSERT INTO saved_projects_migrated
        (id, owner_id, name, payload, created_at, updated_at, ord)
      SELECT id, owner_id, name, payload, created_at, updated_at, ord
        FROM saved_projects
    `);
  } else {
    db.exec(`
      INSERT INTO saved_projects_migrated
        (id, owner_id, name, payload, created_at, updated_at, ord)
      SELECT id, '', name, payload, created_at, updated_at, ord
        FROM saved_projects
    `);
  }
  db.exec(`
    DROP TABLE saved_projects;
    ALTER TABLE saved_projects_migrated RENAME TO saved_projects;
  `);
}

function migrateRunEvents(db: Database.Database): void {
  if (!tableExists(db, "run_events")) {
    db.exec(`
      CREATE TABLE run_events (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
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
      )
    `);
    return;
  }
  if (!tableHasColumn(db, "run_events", "owner_id")) {
    db.exec(
      "ALTER TABLE run_events ADD COLUMN owner_id TEXT NOT NULL DEFAULT ''",
    );
  }
  // Unique (owner_id, run_id, stage) is required for reconnect upserts.
  // Drop the older row when two events share that key.
  db.exec(`
    DELETE FROM run_events
     WHERE id IN (
       SELECT a.id
         FROM run_events a
         JOIN run_events b
           ON a.owner_id = b.owner_id
          AND a.run_id = b.run_id
          AND a.stage = b.stage
          AND (
            a.created_at < b.created_at
            OR (a.created_at = b.created_at AND a.id < b.id)
          )
     )
  `);
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

export const LOCAL_PLATFORM_DB_PATH = join(
  tmpdir(),
  "hexagen-monaco-platform.db",
);

export function resolvePlatformDbPath(
  env: Readonly<Partial<NodeJS.ProcessEnv>> = process.env,
): string {
  if (env.PLATFORM_DB_PATH) return env.PLATFORM_DB_PATH;
  if (env.NODE_ENV === "production") return "/data/platform.db";
  if (env.NODE_ENV === "test") return ":memory:";
  return LOCAL_PLATFORM_DB_PATH;
}

export const LOCAL_SCAN_ARTIFACTS_DIR = join(
  tmpdir(),
  "hexagen-monaco-scan-artifacts",
);

/**
 * Where scan artifact bytes (handoff zip, full findings.json) are written.
 *
 * Mirrors resolvePlatformDbPath so both land on the same persistent volume in
 * production. Kept out of the sqlite file on purpose: `payload TEXT` rows are
 * read whole, so a 30 MB zip in a row would be paid for on every list().
 *
 * NODE_ENV=test does NOT get an in-memory equivalent -- there is no such thing
 * for a directory -- so suites that exercise artifacts must pass an explicit
 * temp dir rather than relying on this default.
 */
export function resolveScanArtifactsDir(
  env: Readonly<Partial<NodeJS.ProcessEnv>> = process.env,
): string {
  if (env.SCAN_ARTIFACTS_DIR) return env.SCAN_ARTIFACTS_DIR;
  if (env.NODE_ENV === "production") return "/data/scan-artifacts";
  return LOCAL_SCAN_ARTIFACTS_DIR;
}

/**
 * Create the artifacts directory if absent. Separate from the row store, which
 * performs no filesystem I/O at all (see scan-records-store.ts).
 */
export function ensureScanArtifactsDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}
