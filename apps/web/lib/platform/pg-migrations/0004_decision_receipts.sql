-- Migration 0004: Jev decision receipts (J1c). Ported from the SQLite tables
-- in platform-db.ts with the same type mapping as 0001:
--   INTEGER 0/1 flags -> boolean (reviewer, agreement);
--   epoch-ms created_at -> timestamptz;
--   REAL -> double precision.
--
-- Retention contract (see decision-receipts-store.ts): closed-set, numeric or
-- opaque-identifier columns ONLY -- never state text, context names, project
-- text, the key or any user id. The reviewer's identity is reduced to a
-- boolean before the write (reviewer = sub === JEV_REVIEWER_SUB), so no user
-- id can ride in. There is deliberately NO owner_id column: the daily-spend
-- ceiling and the agreement report are deployment-wide measurements, not
-- per-owner data, and an owner column here would be a user id by another
-- name. The only correlation keys are opaque ids the store validates on
-- write.

-- decision_calls -- one row per Jev decision-advice HTTP call.
CREATE TABLE decision_calls (
  id             text PRIMARY KEY,
  schema_version integer NOT NULL,
  created_at     timestamptz NOT NULL,
  use            text NOT NULL,
  model          text NOT NULL,
  request_id     text NOT NULL,
  generation_id  text NOT NULL,
  reviewer       boolean NOT NULL,
  cost_micro_usd bigint,
  latency_ms     integer,
  status         text NOT NULL
);
-- The daily-ceiling read is "sum cost since midnight UTC" (invariant 6), so
-- created_at leads the only index this table needs.
CREATE INDEX idx_decision_calls_created
  ON decision_calls (created_at);

-- decision_answers -- one row per question in a call, keyed
-- (call_id, question_index). Answers are a context type (U-A) or an option
-- INDEX (U-C), never question text, option text or any other free text; the
-- closed sets live in decision-receipts-store.ts, which validates them at the
-- boundary. owner_review is the one nullable enum: it is written later, by
-- the owner-review route (J5b), and starts empty.
CREATE TABLE decision_answers (
  call_id        text NOT NULL,
  question_index integer NOT NULL,
  mode           text NOT NULL,
  jev_answer     text NOT NULL,
  jev_confidence double precision NOT NULL,
  today_answer   text NOT NULL,
  today_source   text NOT NULL,
  agreement      boolean NOT NULL,
  owner_review   text,
  PRIMARY KEY (call_id, question_index)
);
