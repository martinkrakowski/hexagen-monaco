# Trace — kernel object spec

Status: design spec + acceptance tests. Not wired into any running server.
Does not reopen Grant design — see `docs/kernel/GRANT.md`, which is source
of truth for the Grant schema; this document only ever _references_
`Grant.id`, never redefines it.

## Why

`docs/kernel/GRANT.md` closes the "prompt text is not the limit" gap for
manifest mutations: a cycle either has a grant that covers what it's doing,
or `hexagen_accept_transaction` fails closed before anything is written.
What that gives a reviewer, or a CI gate, is a yes/no at the moment of the
write. It gives them nothing **after the fact** — no record of which cycle
ran under which grant, what it actually touched, or why it stopped. Trace
is that record: the fourth kernel object (with Manifest, Grant, Transaction),
and the one `hexagen report --handoff` / a CI gate reads to answer "what did
the agent do, under what authority, and is that evidence trustworthy" —
without re-running the cycle or trusting the agent's own summary of itself.

## What it is

A Trace is the append-only record of **one agent cycle run under one
Grant**: which grant, which higher-level goal it served, the ordered tool
calls it made, why it stopped, which transactions it touched, and when it
started and ended. It is written by whatever drives the cycle (the MCP
server today, an editor-agent harness once that adapter exists — see
`GRANT.md` "Known holes"), not reconstructed later from logs — a
reconstruction is exactly the kind of unverifiable self-summary Trace
exists to replace.

### Schema

See `docs/kernel/trace.schema.json`. Shape:

```ts
interface ToolCallRecord {
  /** Tool name, as it appears in the owning Grant's `tools`. */
  name: string;
  /** Digest of the call's arguments (e.g. "sha256:<hex>"), not the
   *  arguments themselves — Trace is evidence of what ran, not a payload
   *  store. A verifier with the original args can confirm the digest;
   *  Trace itself never needs to hold anything large or sensitive. */
  args_digest: string;
  /** Digest of the call's result, same reasoning as args_digest. */
  result_digest: string;
  /** ISO 8601 timestamp of this specific call. */
  time: string;
}

interface Trace {
  /** Must equal some Grant's `id`. See "Rules" — this is never optional
   *  and never a second identity invented by the Trace side. */
  grant_id: string;
  /** Opaque id for whatever prompted this cycle (a work-plan row, a
   *  ticket, a project thread) — not defined further by this spec. */
  goal_id: string;
  /** Every tool call the cycle made, in the order it made them. */
  tool_calls: ToolCallRecord[];
  /** Why the cycle stopped (see "halt_reason values" below). */
  halt_reason: string;
  /** Transaction ids (from @hexagen/transaction-system) this cycle
   *  created or touched, in the order they were touched. */
  transaction_ids: string[];
  /** ISO 8601. */
  started_at: string;
  /** ISO 8601. */
  ended_at: string;
}
```

#### `halt_reason` values

Not a closed enum in the schema (a kit adapter may need its own reasons),
but the vocabulary this spec expects every producer to reuse rather than
inventing a synonym for:

- `completed` — the cycle finished its goal normally.
- `grant_denied` — a write was attempted and denied by the grant (the
  `AcceptTransactionToolUseCase`-side check in `GRANT.md`, once built).
- `grant_expired` / `grant_revoked` — the grant's own fail-closed rules
  (below) stopped the cycle mid-way.
- `budget_exceeded` — a `max_files` or similar cap was hit.
- `error` — the cycle stopped on an unhandled failure, not a grant
  decision. A trace with `halt_reason: "error"` is still valid evidence:
  it records that the cycle failed, not that it succeeded.

### Storage

Append-only JSONL at `.hexagen/evidence/trace.jsonl` — the Field Kit
location, one JSON object per line, one line per completed cycle, never
rewritten or compacted in place (a compaction step, if one is ever needed,
produces a new file; it does not edit history). This repo has no
`.hexagen/` directory yet and this slice does not create one. **Spec
note, not an implementation:** until monaco has its own kit runtime,
a trace produced while dogfooding Grant/Trace inside this repo may be
mirrored under `docs/kernel/` (e.g. `docs/kernel/trace.sample.jsonl`) purely
as a human-readable example — that is a documentation convenience, never a
second canonical location. `.hexagen/evidence/trace.jsonl` is the only real
one.

## Rules

Stated as fail-closed checks — each one denies (refuses to treat the
write, or the trace, as valid evidence) rather than warns:

1. **A write with no `grant_id` is fail closed.** This is a rule on the
   _write_, enforced at the same point `GRANT.md`'s enforcement point
   describes (`hexagen_accept_transaction` for the MCP adapter) — a
   mutation that would produce a trace entry with no grant to attribute it
   to must never be allowed to happen, symmetrically with "no Transaction
   line is a defect" from `GRANT.md`.
2. **A write whose grant is expired or revoked is fail closed.** Checked
   against the same two Grant fields `GRANT.md` added for exactly this:
   `expires_at` and `revoked_at`. A tool call recorded with `time` at or
   after `grant.revoked_at`, or after `grant.expires_at`, means the write
   it records should never have been allowed to happen — this rule is
   what makes those two fields load-bearing rather than decorative.
3. **A Trace without a matching `Grant.id` is invalid.** `trace.grant_id`
   must equal some real grant's `id`. A trace whose `grant_id` matches
   nothing is not "a trace with an unknown grant" to be tolerated — it is
   invalid evidence, full stop. This spec does **not** invent a second
   identity for a trace to carry independent of its grant; `grant_id` is
   the only identity a Trace has an opinion about.

Rules 1–2 are checks a future _write_-side enforcement point makes (the
same accept-transaction choke point `GRANT.md` describes, extended to also
refuse an unattributed or out-of-window write); rule 3 is a check a
_reader_ of a trace file makes (a `hexagen evidence pack` run, or a CI
gate) before trusting what it finds. Both directions matter: a producer
that never emits an invalid trace, and a consumer that never trusts one it
didn't produce itself.

## Relationship to Grant and Transaction

- **Grant → Trace:** every Trace's `grant_id` names the Grant that
  authorized the cycle it records. Trace never re-derives `contexts` /
  `paths` / `tools` / `mode` from itself — a reader who needs to know what
  the cycle was _allowed_ to do looks up the grant by `grant_id`; a Trace
  only records what it _did_.
- **Transaction → Trace:** `transaction_ids` ties a cycle's trace to the
  `@hexagen/transaction-system` transactions it created or accepted, so a
  reader can cross-reference "this trace says it touched these
  transactions" against the transaction manager's own record of what
  those transactions actually did. Trace does not duplicate a
  transaction's contents (its `PendingManifestMutation`, its status
  history) — only its id, the same "digest, not payload" reasoning as
  `args_digest`/`result_digest`.

## Known holes

This spec does not attempt to close either hole named in `GRANT.md`
"Known holes" — an editor-agent write that never becomes a
`PendingManifestMutation`, or a hand-edit to `.architecture/` outside the
transaction flow. A cycle that writes through either path today produces
no Transaction to reference and therefore cannot produce a valid Trace
either — that is the same gap one layer up, not a new one, and it is out
of scope for this slice for the same reason it was out of scope for Grant:
closing it needs a second adapter (editor/shell-write), not a change to
what Trace or Grant _mean_.

## Command spec (design only — not built)

```
hexagen evidence pack <trace-jsonl-file> [--grant <grant-file>] [--out <bundle>]
    Reads every line of the JSONL file (one Trace per line, per "Storage"
    above — not a single record), validates the three Rules above against
    each one, and emits a bundle (all traces, the grants they name, and a
    pass/fail verdict per line) for a CI gate or a human reviewer.
    Non-zero exit if ANY line fails any Rule — one invalid trace in the
    file is enough to fail the whole pack; an invalid trace never produces
    a bundle that reads as evidence of anything, and a bundle never
    reports "pass" while silently dropping a bad line.
```

Only this one subcommand is specified here. `hexagen grant compile|show|
check` remain as specified in `GRANT.md`; nothing here redefines them.

## Acceptance tests

`docs/kernel/spike/trace.acceptance.test.ts` exercises a standalone
reference module (`docs/kernel/spike/trace.ts`) — pure, dependency-free,
no `fs`, no wiring into any running tool or the CLI. It covers exactly the
three Rules above as a retrospective validator (the logic
`hexagen evidence pack` would run): a trace matching a live grant is
valid; a trace with no `grant_id` is invalid; a trace whose `grant_id`
matches no supplied grant is invalid; a trace with a call timestamped at or
after `revoked_at` is invalid; a trace with a call timestamped strictly
after `expires_at` is invalid (exactly at `expires_at` is still in-window
and valid). Both files live under `docs/kernel/spike/`, matching where
`grant.ts` and its tests were moved in `GRANT.md` — deliberately outside
`packages/mcp-server/src` and its barrel; `mcp-server` does not import
them.
