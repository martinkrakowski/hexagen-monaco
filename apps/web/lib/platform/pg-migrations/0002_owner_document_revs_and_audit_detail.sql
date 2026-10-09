-- Migration 0002: the A3-00 schema.
--
-- (1) audit_log.detail: a refused precondition's row now says what was refused.
--     NULL on rows written before the column existed; the append path writes a
--     JSON object ({"method","sent","current"}) on Postgres via the text->jsonb
--     assignment cast, exactly as owner_documents.payload already does.
ALTER TABLE audit_log ADD COLUMN detail jsonb;

-- (2) owner_document_revs: per-author-per-tenant rev high-water mark. NO foreign
--     key, so the saved_projects ON DELETE CASCADE can never touch it (the bug
--     this migrates). The counter is moved only by document writes that go
--     through the store, so deletes, member removal, org deletion and the
--     project cascade all keep working with no change at delete time.
CREATE TABLE owner_document_revs (
  owner_id  text   NOT NULL,
  user_id   text   NOT NULL,
  last_rev  integer NOT NULL,
  PRIMARY KEY (owner_id, user_id)
);

-- (3) Backfill: a document keeps its rev, and its next write is
--     max(rev, counter)+1 = rev+1. Idempotent (no conflict possible here: one
--     row per author pair, and existing rows already exist only if the table
--     was migrated before).
INSERT INTO owner_document_revs (owner_id, user_id, last_rev)
  SELECT owner_id, user_id, MAX(rev)
    FROM owner_documents
    GROUP BY owner_id, user_id
ON CONFLICT (owner_id, user_id) DO NOTHING;
