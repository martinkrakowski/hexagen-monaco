-- Migration 0003: the BYOK store tables and a write-order sequence.
-- The BYOK store (byok-store.ts) uses MAX(write_seq)+1 on SQLite and
-- nextval('byok_write_seq') on Postgres. A sequence value is taken when the
-- statement runs; gaps are possible. After a data load, set the sequence past
-- the highest write_seq copied in.
CREATE SEQUENCE byok_write_seq AS bigint;

CREATE TABLE byok_key_metadata (
  key_id      text PRIMARY KEY,
  user_id     text NOT NULL,
  provider    text NOT NULL,
  key_version integer NOT NULL,
  created_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  revoked_by  text,
  write_seq   bigint NOT NULL
);
CREATE INDEX idx_byok_meta_user_provider
  ON byok_key_metadata (user_id, provider);

CREATE TABLE byok_revocations (
  user_id    text NOT NULL,
  provider   text NOT NULL,
  key_id     text NOT NULL,
  revoked_at timestamptz NOT NULL,
  revoked_by text NOT NULL,
  PRIMARY KEY (user_id, provider)
);
