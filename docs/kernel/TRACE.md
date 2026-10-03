# Trace — kernel object spec

Status: spec. The `TraceWriteAdapter` and `hexagen evidence pack` implement it;
the acceptance tests below remain the standalone reference.
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

Two tools write Trace lines today. `hexagen_accept_transaction` writes one line
per accept or denial, with the pending mutation's tool as `tool_calls[0].name`.
`hexagen_propose_patch` (see `GRANT.md`) writes one line per call, allowed or
denied: `name` is `hexagen_propose_patch`, `goal_id` is the slice id,
`halt_reason` is `completed` for a stored proposal and otherwise the denial
code (`grant_denied`, `grant_expired`, `grant_revoked`; a patch the tool refuses
to read is `grant_denied` too), and `transaction_ids` is empty. A call with no
grant, or a grant with no `id`, is a `grant_missing` record. The proposal's
metadata (`.hexagen/proposals/<id>.json`) holds the `seq` of its `completed` line
as `traceSeq` (`null` when the trace is unchained and has no seq). A patch that cannot be stored, or a call whose `patch` is missing or not a string, is traced too (`error`, and `grant_denied` with reason "patch must be a string"). If the proposal's metadata cannot be stored after that
line was written, the patch is discarded and a best-effort `error` line follows
(`result`: `{proposal_id, discarded: true, reason}`), so no `completed` line is
left citing a proposal that does not exist. "Every call writes a trace line"
holds for a chained (brownfield) trace; in an unchained repo-mode trace a
`grant_missing` denial writes nothing.

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
   line is a defect" from `GRANT.md`. The denial itself is not lost: in a
   chained trace (see "Chain and tip") a call with no grant, or a grant with
   no `id`, is recorded as a `grant_missing` record (below). That record is
   a denial, carries no `grant_id`, and is never evidence of a write. A
   greenfield trace (a manifest is present) writes nothing for it, as before.
2. **A write whose grant is expired or revoked is fail closed.** Checked
   against the same two Grant fields `GRANT.md` added for exactly this:
   `expires_at` and `revoked_at`. A tool call recorded with `time` at or
   after `grant.revoked_at`, or after `grant.expires_at`, means the write
   it records should never have been allowed to happen — this rule is
   what makes those two fields load-bearing rather than decorative.
3. **A Trace without a matching `Grant.id` is invalid.** `trace.grant_id`
   must equal some real grant's `id`. A trace whose `grant_id` matches
   nothing is not "a trace with an unknown grant" to be tolerated — it is
   invalid evidence, full stop. This holds for denial lines too (a line
   whose `halt_reason` is not `completed`): they still have to cite a known
   grant. The one exception is the `grant_missing` record, which by
   definition has no grant to cite and must not carry a `grant_id`. This spec does **not** invent a second
   identity for a trace to carry independent of its grant; `grant_id` is
   the only identity a Trace has an opinion about.
4. **A line whose own timestamps contradict each other is invalid.**
   `started_at` and `ended_at` are checked against each other and against
   the line's `tool_calls`: `ended_at` is not before `started_at`, every
   `tool_calls[].time` is at or after `started_at` and at or before
   `ended_at` (a call exactly at either bound is inside it), and the calls
   are in time order — a later call with an earlier `time` is invalid,
   equal times are in order. A missing `started_at` or `ended_at`, or one
   that does not parse as a timestamp, is a reason and not a skip: a
   `completed` line without them is invalid, and so is a denial line's.
   This rule has no exemption for denial lines, unlike the allowlist and
   window checks in Rule 2: it compares values inside one line, written by
   one process, where a grant's window says nothing. A `grant_missing`
   record is not an evidence line — a single `time`, no window and no
   `tool_calls` — so the rule does not apply to it.

Rules 1–2 are checks a future _write_-side enforcement point makes (the
same accept-transaction choke point `GRANT.md` describes, extended to also
refuse an unattributed or out-of-window write); rules 3 and 4 are checks a
_reader_ of a trace file makes (a `hexagen evidence pack` run, or a CI
gate) before trusting what it finds. Both directions matter: a producer
that never emits an invalid trace, and a consumer that never trusts one it
didn't produce itself.

## Denials

A line whose `halt_reason` is not `completed` documents a refused attempt,
not an authorized write. Its tool is outside the grant, or its time is outside
the grant's window, because that is why it was refused; so a reader skips the
allowlist and window checks for it (Rule 2 and the `tools` check apply only to
`completed` lines). Such lines, together with `grant_missing` records, are
reported in a separate `denials` section of the pack and **never** count as
evidence that a write was allowed: the pack's `evidence` count and list hold
`completed` lines only.

`grant_missing` is the record for a call that carried no grant, or a grant with
no `id`:

```json
{
  "kind": "grant_missing",
  "seq": 7,
  "prev_hash": "…",
  "time": "…",
  "tool": "…",
  "reason": "…",
  "goal_id": "…",
  "args_digest": "sha256:…"
}
```

`goal_id` and `args_digest` are optional; there is no `grant_id`. It uses
`time`, not `at`, to match `tool_calls[].time`. See `trace.schema.json`.

## Chain and tip

A greenfield trace is plain JSONL with no integrity of its own; it is left
exactly as it was, and a pack refuses it. A **brownfield** trace is a hash
chain. Which one a file is follows from the file: the last _complete_ line (one
that ends in a newline and parses) decides, even when a torn tail follows it
(chained: the chain continues; unchained: plain appends continue, and
`grant_missing` is not written). The manifest decides only for an absent file,
an empty file, or one with no complete line at all: no
`.architecture/manifest.yaml` under the workspace root (the test the grant-key
resolver uses) means chained.

- Every line carries `seq` (0 for the first line, then +1) and `prev_hash`:
  the SHA-256 (hex) of the previous line's canonical bytes, where canonical
  means JSON with keys sorted at every depth, including that line's own
  `prev_hash`. Keys sort in JavaScript's own order, so integer-like keys
  (`"2"`, `"10"`) come first, in numeric order. Lines may hold plain JSON values
  only (no `undefined`, dates, `NaN` or other non-JSON values): a verifier in
  another language must reproduce the same bytes. The first line's `prev_hash` is 64 zeros (genesis). Lines are
  written in their canonical form.
- The writer holds an exclusive lock (`trace.jsonl.lock`, created with
  `O_EXCL`, holding `pid:time:random`; a lock whose process is gone, or whose
  inner timestamp is older than 30 s, is stale). Removing a lock, whether
  breaking a stale one or releasing one's own, happens under a second `O_EXCL`
  file, `trace.jsonl.lock.break`, and re-checks that the file is the one judged
  stale (or still holds the releaser's token), so a late waiter or a holder that
  outlived the age limit never removes a live lock. An aged break file is
  removed only after re-checking that it is still the file judged stale; the
  few microseconds between that check and the unlink are not closed, and need a
  crashed breaker plus a waiter taking the file in exactly that gap. The lock is
  keyed on the trace's real path, so the writer and the pack lock the same file
  through any alias. It is held across reading the last line, appending and
  fsync, so concurrent writers cannot fork the chain.
- The format is chosen inside that same lock hold, never before it, so a
  manifest that appears or vanishes, or a writer caught mid-append, cannot mix
  formats in one file. A new file starts at genesis; an existing chained file
  continues; an existing unchained (greenfield) file stays plain, is never
  converted or rewritten, and cannot be packed. To start a chained trace where
  an unchained file exists, move that file aside first (rename it; the next
  write creates a new chained file at genesis). A torn tail refuses only on a
  chained file, until it is moved aside or repaired. A plain file's torn tail is
  appended after, exactly as before the chain existed. A lone fragment (no
  complete line) is appended to in repo mode (a manifest is present) and
  refused when there is no manifest.
- `.hexagen/evidence/tip.json` (`{seq, hash, hmac}`) anchors the head: the
  `seq` and hash of the last line a pack accepted, HMAC'd with the engagement
  key. A chain that only looks backwards cannot see tail truncation or a file
  restarted from genesis; the tip can. It is written only by a successful pack,
  via a temp file and rename.

HMACs use the engagement key (the grant-signing key resolved by
`@hexagen/shared/node/grant-key`), over `hexagen-tip-v1\n<canonical {seq,hash}>`
for the tip and `hexagen-bundle-v1\n<canonical index without hmac>` for the
bundle. Limits: the bundle is linked into place from a temp file in the
validated directory after re-resolving that directory's real path; a swap in
the few microseconds between that check and the link, by someone who can
already write in `.hexagen/`, is not closed. A tip protects only what a pack has already anchored. Deleting
`tip.json` removes the anchor, and the next pack then passes on the chain
checks alone. Restoring an older bundle's `tip.json`, after truncating the
trace to that `seq`, also passes, so the anchor protects only against
truncation below the oldest tip an attacker cannot restore. Record each new tip
out of band: the pack prints it on stderr (`seq`, hash, hmac) and each
`verdicts.json` records the previous tip's `seq` and hash (`previousTip`).

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

## Command spec

```
hexagen evidence pack <trace> --grant <file>... --out <zip>
                      [--root <dir>] [--key-file <path>] [--engagement <id>]
```

Reads every line of `<trace>` (which must be `<root>/.hexagen/evidence/trace.jsonl`,
the one file the tip anchors; one Trace per line, per "Storage") and checks:

0. the trace is read under the writer's lock, so a half-finished append is not
   seen;
1. the chain over every line: `seq` equals the position, `prev_hash` equals
   the hash of the previous line, the first line starts at genesis. An edited,
   reordered or deleted interior line breaks it; an unchained line fails;
2. a **torn last line** (invalid JSON, or no trailing newline) fails the pack;
3. the four Rules above on every line, with denials skipping only the
   allowlist and window checks — the timeline rule (Rule 4) applies to them
   too (see "Denials"). Each `--grant` file's signature is verified with the
   engagement key; a line citing a grant that does not verify cites no known
   grant;
4. the anchored tip: when `tip.json` exists, its HMAC must verify and the line
   at `tip.seq` must exist with that hash. Otherwise the pack fails.

On success it writes `<zip>` (which must resolve under `<root>/.hexagen/`, never
under `.hexagen/evidence/`, never a name `BUNDLE_FORBIDDEN_PATH_PATTERN`
forbids, and never an existing file: it is linked into place, not replaced):
`bundle.json` (the BW0 index, `hmac` over it with the engagement key),
`evidence/trace.jsonl`, `evidence/verdicts.json` (a verdict per line, a
`denials` section and the `evidence` count), `evidence/tip.json` and the grants
the trace references under `grants/`; then it writes the new `tip.json`.

It exits 1 on any invalid line or failed check, writing no bundle and leaving
the tip unchanged; a bundle that exists is a bundle that passed. It exits 2 for
usage or precondition problems (a missing or weak key, `--out` outside
`.hexagen/`, a trace the tip does not anchor, an empty trace).

Only this one subcommand is specified here. `hexagen grant issue|show|
check` are specified in `GRANT.md`; nothing here redefines them.

## Acceptance tests

`docs/kernel/spike/trace.acceptance.test.ts` exercises a standalone
reference module (`docs/kernel/spike/trace.ts`) — pure, dependency-free,
no `fs`, no wiring into any running tool or the CLI. It covers exactly the
first three Rules above as a retrospective validator (the logic
`hexagen evidence pack` would run): a trace matching a live grant is
valid; a trace with no `grant_id` is invalid; a trace whose `grant_id`
matches no supplied grant is invalid; a trace with a call timestamped at or
after `revoked_at` is invalid; a trace with a call timestamped strictly
after `expires_at` is invalid (exactly at `expires_at` is still in-window
and valid). Rule 4 is not in the spike: it lives in `traceRuleReasons`
(`packages/shared/src/types/trace-rules.ts`), the one implementation the
pack and the MCP server's `checkTrace` both call. Both files live under
`docs/kernel/spike/`, matching where
`grant.ts` and its tests were moved in `GRANT.md` — deliberately outside
`packages/mcp-server/src` and its barrel; `mcp-server` does not import
them.
