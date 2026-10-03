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
   equal times are in order. Timestamps are compared at the precision they
   carry, so a difference below a millisecond is still a difference. A call
   whose own `time` does not parse is a reason here too, on every line: it
   is reported once, by this rule, and the comparisons skip it rather than
   compare a null — so an order error names the last call whose `time` did
   parse. A missing `started_at` or `ended_at`, or one that does not parse
   as a timestamp, is a reason and not a skip: a
   `completed` line without them is invalid, and so is a denial line's.
   This rule has no exemption for denial lines, unlike Rule 2 and the
   `tools` check: it compares values inside one line, written by one process,
   where a grant's window says nothing. A `grant_missing`
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

```
hexagen evidence verify --since <git-ref> [--until <git-ref>]
                         --grant <file>... [--root <dir>]
                         [--key-file <path>] [--engagement <id>]
                         [--allow-empty]
```

Judges a git range against the trace in the `<until>` tree. It reads only: it
never writes `.hexagen/`, and it never stops a write — it finds an unaccounted
one after the fact.

1. **The range.** The changed files in `<since>..<until>` (default `HEAD`) come
   from `git diff --name-status -M -z`, never `--name-only`, which prints one
   name per side of a rename and loses which side moved. Every `R` and `C`
   record is expanded into both paths and each is judged on its own. Squash
   merges and rebases need nothing special: the test is the age of a line, not
   the shape of the commit graph. A shallow clone that cannot resolve
   `<since>` exits 2 rather than passing, and so does a `<since>` that is not an
   ancestor of `<until>` — read backwards, the range would judge a change against
   evidence that predates it.
2. **The evidence is the tree, not the checkout.** The trace, the tip and the
   proposals are read with `git show <until>:<path>` (the proposals enumerated
   with `git ls-tree -r <until>`), so only evidence committed at `<until>` counts
   and a committed blob cannot change under the command — no writer lock is
   taken, because there is nothing to lock. The slice is the one file read from
   the working tree, since it is the kit's own configuration. A trace or a
   proposal that is only in the working copy is not evidence for the range, and
   the line it would have covered stays unaccounted.
3. **The trace** is checked exactly as `pack` checks it — the same chain,
   line-shape and Rules pass — and the anchored tip is **required**, not
   optional. A broken chain, a torn line, a tip that does not anchor, a tip whose
   HMAC does not verify, or no `tip.json` at all exits 2 **before any coverage is
   judged**, because a trace that is not sound evidence cannot say what covers
   what, and no tip means nothing is bound to the engagement key.
4. **Only a line appended after `<since>` is a candidate,** and freshness is a
   history claim rather than a number: the line the trace holds at `seq`
   `lastSeqAtSince` at `<since>` must be byte-identical to the one it holds now,
   or the run exits 2 with `trace rewritten since <since>`. A line qualifies
   only when its `seq` is above that `lastSeqAtSince`. If the trace was not
   tracked at `<since>`, the command exits 2: neither `tool_calls[].time` (the
   server's clock) nor a commit's committer date proves a line was appended
   after `<since>`, and clock skew or an adjusted date could make a stale line
   look fresh. An old covering line therefore never covers a new change, even
   though it still covers that file's earlier state.
5. **Only a key-anchored line covers.** The chain binds every line to the one
   above it, but only `tip.json` binds the head to the engagement key, so a line
   may cover a file only when its `seq` is at or below `tip.seq` (with that
   tip's HMAC verified). A line above the tip is a chain any editor could have
   extended, and it covers nothing: the run fails with `cover exists but is not
anchored: run hexagen evidence pack`. **Pack before you verify** — a
   key-holder runs `hexagen evidence pack` over the trace first, and only the
   anchored head can account for a change.
6. **Coverage, by join, not by a new field.** A candidate covers a file when it
   is `completed` and joins a proposal: some `.hexagen/proposals/<id>.json`
   whose `traceSeq` is the line's `seq`, whose `grantId` equals the line's
   `grant_id`, and whose `result_digest` recomputes correctly. The digest is
   rebuilt as `{ halt_reason, proposal_id, paths }` in that key order over the
   proposal's `paths` as the writer recorded them, and compared to the line's
   own `result_digest`; insertion order is the writer's, so the reader must not
   canonicalise it. A `paths` entry edited after the line was written breaks
   that digest instead of being believed, which is why no Trace field was added
   to carry the paths. Only a proposal naming a line above `lastSeqAtSince` can
   be a candidate, so only those are read strictly: an older one covers nothing
   and is ignored however it is shaped. `traceSeq: null` means the trace was
   unchained when the proposal was written, so there is no line to join and
   nothing is covered. Changed paths and proposal paths are compared NFC-folded,
   so two spellings of one name are one file. The covering call is the one that
   carries the proposal's digest: the path and the time always come from the
   same record, never one from a record and one from another in the same line,
   and that call's `time` must be inside the grant's window (`checkGrantWindow`,
   the same function the accept path and `grant check` call). A read-only call
   may omit the paths, and then covers nothing.
7. **Scope.** A file is judged when it is inside the slice (minus its excludes)
   or inside any supplied grant's `paths`. Coverage itself is scoped to one
   grant: a file must sit inside the paths of _the_ grant whose line covers it,
   so another supplied grant's paths never widen coverage. Changes outside both
   are intentionally not judged — the kit has no say there — and the command
   prints how many it skipped.
8. **Exit codes.** 0 when nothing is unaccounted. 1 when a changed in-scope file
   has no covering line, naming each one with the nearest candidate line. 2 for
   bad input or bad state: an unreadable, unsigned or duplicated `--grant`, a
   missing or unusable engagement key, an unresolvable `<since>`, a `<since>`
   that is not an ancestor of `<until>`, a trace that is absent at `<until>` or
   not sound, a missing tip, a trace that was not tracked at `<since>`, a trace
   rewritten since `<since>`, a proposal that does not reproduce its line's
   `result_digest`, and an empty diff without `--allow-empty` (which prints
   `empty diff: nothing was checked` and exits 0 with it). A clean result never
   means "nothing was looked at" by default.

Two of its limits are worth stating plainly. It proves that an authorized line
covering a path exists; it cannot prove the line is true, only that the agent
reported its paths honestly. And it does not stop a write — a line written after
the commit still covers once a key-holder packs it, so the barrier against a
forgery is the engagement key behind the tip and the pack that anchors it. Until
Trace carries paths itself, a change applied through
`hexagen_accept_transaction` is unaccounted here, because that writer leaves no
path list anywhere: this command is narrower than "every change the kit
governs".

**Running it in CI.** Two things the exit codes alone do not tell you:

- **The engagement key comes from a secret, never from the checkout.** Pass
  `--key-file "$HEXAGEN_GRANT_KEY_FILE"` (or set `HEXAGEN_GRANT_KEY_FILE`)
  pointing at a key written from a CI secret in the job. A key committed to the
  repository — including the in-repo `.hexagen/grant-signing.key` that repo mode
  creates — makes every anchor and every grant signature checkable by anyone who
  can read the tree, which is the same as no barrier at all.
- **Every `--grant` the trace ever cites, not the ones this PR used.** Rule 3 is
  judged over the whole file: a line citing a grant no supplied file verifies
  cites no known grant, so the trace is unsound evidence and the run exits 2. A
  CI job therefore has to pass the full grant set (the artefacts
  `hexagen workbook export --stage` names), and a run that exits 2 with
  `matches no known` is a missing grant file, not a bad trace.

Both subcommands of `hexagen evidence` are specified here. `hexagen grant
issue|show|check|revoke` are specified in `GRANT.md`; nothing here redefines
them.

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
