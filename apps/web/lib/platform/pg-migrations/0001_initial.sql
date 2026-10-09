-- Migration 0001: the full Postgres schema, ported from platform-db.ts.
-- Every column type, primary key, index, unique index, foreign key and
-- trigger is preserved from the SQLite schema. See the migration brief for
-- the type-mapping rules (TEXT -> text, epoch-ms -> timestamptz, etc.).

-- The three hx_* functions give Postgres the same date helpers the stores
-- get from SQLite, so SQL text stays backend-agnostic.
CREATE FUNCTION hx_ts(ms bigint) RETURNS timestamptz LANGUAGE sql IMMUTABLE
  AS $$ SELECT timestamptz 'epoch' + ms * interval '1 millisecond' $$;
CREATE FUNCTION hx_ms(ts timestamptz) RETURNS bigint LANGUAGE sql IMMUTABLE
  AS $$ SELECT (extract(epoch from ts) * 1000)::bigint $$;
CREATE FUNCTION hx_day(ts timestamptz) RETURNS text LANGUAGE sql STABLE
  AS $$ SELECT to_char(ts AT TIME ZONE 'UTC', 'YYYY-MM-DD') $$;

-- users — auth subjects. email_verified / onboarded_at are nullable; both
-- arrive as NULL on existing rows (see platform-db.ts migrate* helpers).
CREATE TABLE users (
  id              text PRIMARY KEY,
  name            text,
  email           text,
  email_verified  timestamptz,
  image           text,
  github_login    text CHECK (github_login = lower(github_login)),
  onboarded_at    timestamptz,
  created_at      timestamptz NOT NULL
);
CREATE UNIQUE INDEX idx_users_email
  ON users (email) WHERE email IS NOT NULL AND email != '';
CREATE UNIQUE INDEX idx_users_github_login
  ON users (github_login) WHERE github_login IS NOT NULL;

CREATE TABLE accounts (
  provider            text NOT NULL,
  provider_account_id text NOT NULL,
  user_id             text NOT NULL,
  type                text NOT NULL,
  PRIMARY KEY (provider, provider_account_id),
  FOREIGN KEY (user_id) REFERENCES users (id)
);
CREATE INDEX idx_accounts_user
  ON accounts (user_id);

CREATE TABLE sessions (
  session_token text PRIMARY KEY,
  user_id       text NOT NULL,
  expires       timestamptz NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users (id)
);

CREATE TABLE verification_tokens (
  identifier text NOT NULL,
  token      text NOT NULL,
  expires    timestamptz NOT NULL,
  PRIMARY KEY (identifier, token)
);

-- saved_projects — the core project store. created_at / updated_at are epoch
-- millis in SQLite, mapped to timestamptz here. rev defaults to 1.
CREATE TABLE saved_projects (
  id         text NOT NULL,
  owner_id   text NOT NULL,
  name       text NOT NULL,
  payload    jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  ord        integer NOT NULL,
  rev        integer NOT NULL DEFAULT 1,
  updated_by text,
  PRIMARY KEY (owner_id, id)
);
CREATE INDEX idx_saved_projects_ord
  ON saved_projects (owner_id, ord);

-- run_events — telemetry for a single run. served_from_cache / used_llm
-- are INTEGER flags in SQLite -> boolean.
CREATE TABLE run_events (
  id                text PRIMARY KEY,
  owner_id          text NOT NULL,
  run_id            text NOT NULL,
  project_id        text,
  stage             integer NOT NULL,
  label             text NOT NULL,
  model             text,
  refiner_model     text,
  duration_ms       bigint NOT NULL,
  retry_count       integer NOT NULL,
  input_tokens      integer NOT NULL,
  output_tokens     integer NOT NULL,
  served_from_cache boolean NOT NULL,
  used_llm          boolean NOT NULL,
  summary           text NOT NULL,
  cost_cents        integer,
  created_at        timestamptz NOT NULL
);
CREATE INDEX idx_run_events_created
  ON run_events (created_at DESC);
CREATE INDEX idx_run_events_run
  ON run_events (run_id);
CREATE INDEX idx_run_events_project
  ON run_events (owner_id, project_id);
CREATE INDEX idx_run_events_owner
  ON run_events (owner_id, created_at DESC);
CREATE UNIQUE INDEX idx_run_events_run_stage
  ON run_events (owner_id, run_id, stage);

-- orgs — an org is another owner (H1.1). id collides with user ids, guarded
-- by the trigger below.
CREATE TABLE orgs (
  id         text PRIMARY KEY,
  slug       text NOT NULL,
  name       text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX idx_orgs_slug
  ON orgs (slug);

-- org_members — membership in an org. org_id cascades on delete.
CREATE TABLE org_members (
  org_id     text NOT NULL,
  user_id    text NOT NULL,
  role       text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (org_id, user_id),
  FOREIGN KEY (org_id) REFERENCES orgs (id) ON DELETE CASCADE
);
CREATE INDEX idx_org_members_user
  ON org_members (user_id);

-- org_invites — keyed by GitHub login (not user id). COLLATE NOCASE in
-- SQLite becomes a CHECK that the login is already lower-cased. expires_at
-- has NO default here (the SQLite ALTER added DEFAULT '' then backfilled).
CREATE TABLE org_invites (
  org_id       text NOT NULL,
  github_login text NOT NULL CHECK (github_login = lower(github_login)),
  role         text NOT NULL,
  invited_by   text NOT NULL,
  created_at   timestamptz NOT NULL,
  expires_at   timestamptz NOT NULL,
  accepted_at  timestamptz,
  PRIMARY KEY (org_id, github_login),
  FOREIGN KEY (org_id) REFERENCES orgs (id) ON DELETE CASCADE
);
CREATE INDEX idx_org_invites_login
  ON org_invites (github_login) WHERE accepted_at IS NULL;

-- teams — a grantee grouping, never an owner (D-A1). No FK on org_id in
-- SQLite; the rule is enforced by application code.
CREATE TABLE teams (
  id         text PRIMARY KEY,
  org_id     text NOT NULL,
  slug       text NOT NULL,
  name       text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX idx_teams_org_slug
  ON teams (org_id, slug);

-- team_members — no FK in SQLite; enforced by application code.
CREATE TABLE team_members (
  team_id    text NOT NULL,
  user_id    text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (team_id, user_id)
);
CREATE INDEX idx_team_members_user
  ON team_members (user_id);

-- audit_log — append-only by construction (D-A6).
CREATE TABLE audit_log (
  id               text PRIMARY KEY,
  actor_id         text NOT NULL,
  action           text NOT NULL,
  subject_owner_id text,
  subject_id       text,
  grantee_type     text,
  grantee_id       text,
  created_at       timestamptz NOT NULL
);
CREATE INDEX idx_audit_log_subject
  ON audit_log (subject_owner_id, subject_id);

-- project_shares — soft-deleted via revoked_at (revocation is SOFT).
CREATE TABLE project_shares (
  owner_id      text NOT NULL,
  project_id    text NOT NULL,
  grantee_type  text NOT NULL,
  grantee_id    text NOT NULL,
  role          text NOT NULL,
  granted_by    text NOT NULL,
  created_at    timestamptz NOT NULL,
  revoked_at    timestamptz,
  PRIMARY KEY (owner_id, project_id, grantee_type, grantee_id)
);
CREATE INDEX idx_project_shares_grantee
  ON project_shares (grantee_type, grantee_id) WHERE revoked_at IS NULL;
CREATE INDEX idx_project_shares_subject
  ON project_shares (owner_id, project_id);

-- model_prices — seed data below. updated_at is epoch ms in SQLite,
-- stored as timestamptz; the seed uses now().
CREATE TABLE model_prices (
  model              text PRIMARY KEY,
  usd_per_1k_input   double precision NOT NULL,
  usd_per_1k_output  double precision NOT NULL,
  updated_at         timestamptz NOT NULL
);
INSERT INTO model_prices (model, usd_per_1k_input, usd_per_1k_output, updated_at) VALUES
  ('mercury-2',     0.25,  1.25,  now()),
  ('gpt-4o',        2.5,  10.0,  now()),
  ('openai/gpt-4o', 2.5,  10.0,  now())
ON CONFLICT DO NOTHING;

-- project_owner_state — whether an owner has been initialised. initialized
-- is an INTEGER flag in SQLite -> boolean.
CREATE TABLE project_owner_state (
  owner_id    text PRIMARY KEY,
  initialized boolean NOT NULL
);

-- owner_documents — per-owner document store. FK to saved_projects is
-- composite (owner_id, project_id) and cascades on delete.
CREATE TABLE owner_documents (
  owner_id   text NOT NULL,
  user_id    text NOT NULL,
  kind       text NOT NULL,
  id         text NOT NULL,
  project_id text,
  rev        integer NOT NULL,
  payload    jsonb NOT NULL,
  updated_at timestamptz NOT NULL,
  updated_by text,
  PRIMARY KEY (owner_id, user_id, kind, id),
  FOREIGN KEY (owner_id, project_id)
    REFERENCES saved_projects (owner_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_owner_documents_project
  ON owner_documents (owner_id, project_id);

-- entitlements — one row per user. current_period_end / updated_at are
-- epoch millis in SQLite -> timestamptz.
CREATE TABLE entitlements (
  user_id              text PRIMARY KEY,
  plan                 text NOT NULL,
  repo_limit           integer NOT NULL,
  stripe_customer_id   text,
  stripe_subscription_id text,
  status               text NOT NULL,
  current_period_end   timestamptz,
  updated_at           timestamptz NOT NULL
);

-- scan_records — one row per completed scan. findings_sample is JSON in
-- SQLite -> jsonb. rowid is a NEW column (SQLite has its implicit rowid);
-- the stores order by it.
CREATE TABLE scan_records (
  id                text NOT NULL,
  owner_id          text NOT NULL,
  schema_version    integer NOT NULL,
  project_name      text NOT NULL,
  repo_ref          text,
  tier              text NOT NULL,
  verdict           text NOT NULL,
  exit_code         integer,
  files_scanned     integer,
  findings_fresh    integer NOT NULL,
  findings_baselined integer NOT NULL,
  findings_stale    integer NOT NULL,
  findings_expired  integer NOT NULL,
  layout_excerpt    text,
  report_markdown   text,
  error_message     text,
  findings_sample   jsonb NOT NULL,
  artifact_path     text,
  artifact_bytes    bigint,
  created_at        timestamptz NOT NULL,
  rowid             bigint GENERATED ALWAYS AS IDENTITY,
  PRIMARY KEY (owner_id, id)
);
CREATE INDEX idx_scan_records_owner
  ON scan_records (owner_id, created_at DESC);
CREATE INDEX idx_scan_records_repo
  ON scan_records (owner_id, repo_ref, created_at DESC);

-- repair_runs — one row per repair loop. rowid is a NEW column.
CREATE TABLE repair_runs (
  id                  text NOT NULL,
  owner_id            text NOT NULL,
  schema_version      integer NOT NULL,
  run_id              text NOT NULL,
  surface             text NOT NULL,
  outcome             text NOT NULL,
  rounds              integer NOT NULL,
  violations_initial  integer NOT NULL,
  violations_remaining integer NOT NULL,
  attempts_total      integer NOT NULL,
  attempts_applied    integer NOT NULL,
  duration_ms         bigint NOT NULL,
  created_at          timestamptz NOT NULL,
  rowid               bigint GENERATED ALWAYS AS IDENTITY,
  PRIMARY KEY (owner_id, id)
);
CREATE UNIQUE INDEX idx_repair_runs_run
  ON repair_runs (owner_id, run_id);
CREATE INDEX idx_repair_runs_owner
  ON repair_runs (owner_id, created_at DESC);

-- repair_attempts — one row per (round, attempt-within-round).
-- eligible / applied / changed_yaml are INTEGER flags -> boolean.
CREATE TABLE repair_attempts (
  id               text NOT NULL,
  owner_id         text NOT NULL,
  schema_version   integer NOT NULL,
  run_id           text NOT NULL,
  round            integer NOT NULL,
  seq              integer NOT NULL,
  violation_class  text NOT NULL,
  violation_status text NOT NULL,
  path             text NOT NULL,
  eligible         boolean NOT NULL,
  applied          boolean NOT NULL,
  changed_yaml     boolean NOT NULL,
  duration_ms      bigint NOT NULL,
  ops_proposed     integer,
  ops_applied      integer,
  ops_skipped      integer,
  gate_reason      text,
  created_at       timestamptz NOT NULL,
  PRIMARY KEY (owner_id, id)
);
CREATE UNIQUE INDEX idx_repair_attempts_slot
  ON repair_attempts (owner_id, run_id, round, seq);
CREATE INDEX idx_repair_attempts_class
  ON repair_attempts (owner_id, violation_class, schema_version);

-- org_id_not_user_id — a personal user id must not collide with an org id
-- (SQLite trigger, same message text).
CREATE OR REPLACE FUNCTION org_id_not_user_id_fn()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF EXISTS (SELECT 1 FROM users WHERE id = NEW.id) THEN
    RAISE EXCEPTION 'org id collides with an existing user';
  END IF;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER org_id_not_user_id
BEFORE INSERT ON orgs
FOR EACH ROW EXECUTE FUNCTION org_id_not_user_id_fn();

-- user_id_not_org_id — the reverse direction.
CREATE OR REPLACE FUNCTION user_id_not_org_id_fn()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF EXISTS (SELECT 1 FROM orgs WHERE id = NEW.id) THEN
    RAISE EXCEPTION 'user id collides with an existing org';
  END IF;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER user_id_not_org_id
BEFORE INSERT ON users
FOR EACH ROW EXECUTE FUNCTION user_id_not_org_id_fn();
