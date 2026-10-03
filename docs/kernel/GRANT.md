# Grant — kernel object spec

Status: design spec + acceptance tests, revised after review. Not done —
this is monaco's **compiler profile** for Grant (the shape monaco's own
manifest-driven enforcement needs), not yet the Field Kit's general Grant.
See "Monaco profile vs. the Field Kit Grant" below. Nothing here is wired
into any running server.

## Why

Today `docs/agent-constraint-workflow.md` pins an agent to one bounded
context by **telling it so in the system prompt** ("You are working only
in the `<context>` bounded context..."). That is advice, not a limit: an
agent (or a bug in a tool call) that ignores it hits no runtime check, only
a linter run _after_ the fact (`hexagen-lint --staged`). Grant closes that
gap: it is a **compiled object**, not a sentence, checked at the one point
where a mutation stops being speculative and starts touching disk —
transaction accept. Prompt text is not the limit; `hexagen_accept_transaction`
is.

Grant is one of four kernel objects (the others: **Manifest**, the topology
scan already produces; **Transaction**, the propose/accept/reject flow that
already exists in `@hexagen/transaction-system`; **Trace**, a follow-up that
ties a completed cycle back to the grant it ran under). This spec covers
Grant only, and does not reopen Trace.

## What it is

A Grant is the smallest contract for **one agent cycle**: who is running it,
which agent identity, which manifest contexts and workspace paths it may
write to, which write tools it may invoke, and whether it may only propose
or may also land. It is _compiled_, not authored free-hand — a human (or a
CI policy) names the contexts and tools, and the grant expands them into
concrete path prefixes and a required expiry. It is symmetric in intent —
the same compiled object is what a human reviewer reads to know the cycle's
scope, and what the runtime enforces — but that symmetry has a hole; see
"Known holes" below.

### Schema

See `docs/kernel/grant.schema.json`. Shape:

```ts
interface Grant {
  /** Stable id. Trace hangs off this, not off contexts/paths. */
  id: string;
  /** Who authorized this cycle (human account, CI policy, ...). */
  principal: string;
  /** Which agent identity this grant was issued to. */
  agent: string;
  /** Manifest bounded-context names — monaco's compile step only. */
  contexts: string[];
  /** Workspace-relative path prefixes. The field every check uses. */
  paths: string[];
  /** Which write tools this cycle may invoke, not only where. */
  tools: string[];
  /** "propose" may create a Transaction; "write" may also accept it. */
  mode: "write" | "propose";
  /** Optional blast-radius cap independent of path scope. */
  max_files?: number;
  /** ISO 8601. Required even when v1 mints one grant per cycle and
   *  discards it — that's a usage policy, not a reason to omit the field. */
  expires_at: string;
  /** Set on early revocation; absent on an active grant. */
  revoked_at?: string;
  /** HMAC-SHA256 (hex) over every field above, keyed by the trust root at
   *  .hexagen/grant-signing.key. Verified before any other check — see
   *  "Enforcement point" below. */
  signature?: string;
}
```

The first spec of this document had only `contexts` and `paths` — an
allowlist, not a grant. `id` is what a Trace record references (without it,
the next thread would have invented a second identity); `principal`/`agent`
separate who authorized a cycle from who executes it; `tools` scopes
_actions_, not only _locations_; `mode` distinguishes an agent that may
draft a change from one that may land it; `expires_at`/`revoked_at` make
time and revocation first-class even though this slice always mints a
fresh, short-lived grant rather than reading from a store.

### Compiling a grant

`compileGrant(contexts, manifest)` (monaco profile only — see below):

1. Look up each name in `manifest.bounded_contexts`. A name that is not a
   real context is a compile error (fail closed — see below), not a
   silently-dropped entry.
2. Expand each context to `packages/<context>/`.

The compiled path list is exactly the named contexts expanded to
`packages/<context>/`. Extra paths are never compiled from a guess (there is no
implicit "shared codegen target" expansion or similar heuristic): a client repo
names them explicitly with `hexagen grant issue --paths`, which takes the same
prefixes `hexagen grant check` applies.

This is the "reuse manifest.yaml" requirement: contexts are validated
against the same file `hexagen_get_manifest` and the arch linter already
treat as ground truth, so a grant can never name a context that does not
exist in the topology scan. `principal`/`agent`/`tools`/`mode`/`expires_at`
are not compiled from the manifest — they come from whoever is issuing the
grant (a human, or a CI policy) and are opaque to this compile step.

## Enforcement point

**Signature check runs first, before any scope check.** A caller-supplied
grant with every field a reviewer would want — the right tools, contexts,
paths, a future `expires_at` — is not authorization on its own: nothing
about those fields says a trusted issuer actually minted this grant rather
than the same agent it's meant to limit assembling one for itself.
`GrantSignaturePort.verify(grant)` checks `grant.signature` as an
HMAC-SHA256 (hex) over `canonicalGrantPayload(grant)` — every other field,
as JSON with keys in a fixed sorted order — keyed by the secret at
`.hexagen/grant-signing.key`. A grant with no signature, a signature from
the wrong key, or a signature over fields that were changed after signing
all verify false and are denied with the same `grant_denied` code as any
other check, before `checkGrantMode`/`checkGrantWindow`/
`checkMutationAgainstGrant` ever run. `GrantSignatureAdapter` fails closed
on every way trust can't be established — no key file, malformed hex in
either the key or the signature, an I/O error reading the key — never by
throwing past the check.

**Signature verification.** This closes the "self-asserted grant" gap (a
Qodo finding on PR #697) on the verification side: `hexagen_accept_
transaction` now refuses anything not signed by `.hexagen/grant-signing.key`.
`hexagen grant issue` (see "Commands" below) mints a signed grant. The key
is found by the shared resolver (`@hexagen/shared/node/grant-key`): `--key-file`,
`HEXAGEN_GRANT_KEY_FILE`, then `~/.hexagen/keys/<engagement>.key` in a client
repo (create it with `hexagen grant key init --engagement <id>`) or
`.hexagen/grant-signing.key` in repo mode (created by `issue` on first use).
Treat it like any other credential; never commit it.

**The general rule:** any write — through any tool, MCP or otherwise —
whose target path falls outside `grant.paths`, or whose tool identity falls
outside `grant.tools`, is denied. That is the rule Grant exists to state,
and it is meant to bind every write surface a repo has, not one.

**The first adapter, built here, covers only MCP manifest mutations.** The
transaction flow (`@hexagen/transaction-system`, driven by
`AcceptTransactionToolUseCase` in `@hexagen/mcp-server`) already has a
choke point for that surface: **none of the seven manifest-mutation tools
write anything. They propose a `Transaction`; `hexagen_accept_transaction`
is the only call that reaches `ManifestWritePort` / `ScaffoldingPort`.**
That is where a path-and-tool allowlist belongs for this surface — before
`applyPendingManifestMutation` runs, not after — and `mode: "propose"` vs
`"write"` maps directly onto "may create a Transaction" vs "may also
accept it."

**The second adapter, for client repos: `hexagen_propose_patch`.** A client
repo has no manifest and no transactions; an agent there proposes a unified
diff and the FDE applies it. The MCP tool `hexagen_propose_patch` (input:
`patch`, `grant`, optional `goal_id`) is **propose-only**: it never applies the
patch and never writes anywhere in the working tree. An allowed patch is
stored as `.hexagen/proposals/<id>.patch` with `<id>.json` beside it (the
`ProposalMeta` format: id, grantId, sliceId, tool, paths, traceSeq (null for an unchained trace), createdAt),
and the FDE applies it with `git apply -p1`. A grant names the tool in `tools`
(`--tools hexagen_propose_patch`) like any other. Checks, in order, each
denying before the next runs:

1. the grant has an `id` that is a non-empty string (else a `grant_missing`
   trace record);
2. `checkGrantSignature`, then `checkGrantWindow`;
3. the diff parses strictly: every `diff --git` header, `---`/`+++` line and
   rename/copy line is read (both sides of a rename or copy), `/dev/null` is
   a created or deleted file and never a path, and each path goes through
   `normalizeSlicePath`. Symlink modes (`120000`), submodule mode (`160000`),
   binary patches, quoted paths that cannot be decoded safely, a patch with no
   file headers, any line outside the header/hunk grammar and a patch over
   1 MiB are refused.
   Any path equal to or under `.hexagen/` or `.git/` (first segment,
   case-sensitive), as parsed or as resolved on disk, is refused, whatever the grant or
   slice say;
4. `checkWriteAgainstGrant` with tool `hexagen_propose_patch` over every path;
5. the slice: every path inside `slice.paths` and outside `excludes`; no
   `.hexagen/slice.json` is a deny, and a grant wider than the slice is still
   bounded by it;
6. the on-disk spelling: each path is resolved through `realpath` (the
   deepest existing parent, then the part that does not exist yet), must stay
   under the repo root and under a granted prefix, and the slice check runs
   again on that spelling, so a case- or normalisation-insensitive filesystem
   (APFS, NTFS) or a symlinked directory cannot reach an excluded path.
   A path that is itself an existing symlink is denied ("path is a symlink; git
   apply would rewrite its target"): git reads a link's target as its content
   and keeps mode 120000, so a mode-less patch would retarget the link while
   `realpath` resolved through it. The slice comparison NFC-normalises both the
   path and every slice entry, so an exclude holds in either Unicode form.

`checkGrantMode` is **never** run: propose-only grants carry `mode: "propose"`
(plan BW-D9). Every call, allowed or denied, writes one trace line: `goal_id`
is the slice id (the caller's `goal_id`, else `no-slice`, only when there is
no usable slice), `halt_reason` is `completed` or the denial code, and a call
with no grant or no grant id writes `grant_missing`. A malformed or refused
patch is recorded as `grant_denied`, the nearest code in the shared
vocabulary; its reason is in the tool's reply.

Each `PendingManifestMutation` names exactly one context it would write to
(the create-context/scaffold-module `name`, the create-port/create-adapter
`domain_name`/`infrastructure_name`, the remove-port/remove-context
`context_name`, add-dependency's `sourceModule` — never the dependency
`targetModule`, which is read, not written) and one tool (its own MCP tool
name). `checkMutationAgainstGrant` derives both and checks:

1. is the mutation's tool name in `grant.tools`?
2. is the mutation's context in `grant.contexts`?
3. does the context's expected path (`packages/<context>/`) fall under one
   of `grant.paths`?

All three must hold. Any one check failing is enough to reject on its own —
`tools` and `contexts` are independent because a grant can right-size
either one without touching the other (e.g. narrow to `create-port` only
within an otherwise fully-granted context).

**Default deny.** A mutation whose tool is not in `grant.tools`, or whose
context is not in `grant.contexts`, is rejected, full stop — there is no
partial-match or "warn but allow" mode. An empty `grant.contexts` (or an
empty `grant.tools`) denies every mutation. This is what "slice-scoped
rules default deny outside the slice" means concretely: every check is a
positive allowlist match, never a blocklist.

**Fail closed.** The check runs _before_ `transactionManager` claims the
transaction (`compareAndSetStatus(..., "pending", "speculative")`), so a
rejected mutation never transitions state and never reaches
`ManifestWritePort`/`ScaffoldingPort` — no compensating rollback is needed
because nothing ran. Symmetrically: if a mutation somehow reached accept
with **no** transaction line at all (`readPendingMutation` returns `null`),
that is a defect in the proposing tool, not something the grant should
paper over by silently no-op-ing — `applyPendingManifestMutation` already
requires a `PendingManifestMutation`, so this class of bug fails typecheck
before it fails at runtime. A write with no grant check at all is the same
class of defect, one layer up — see "Known holes."

## Known holes

Stating these here rather than glossing over them:

- **Every write surface that never becomes a `PendingManifestMutation` is
  unmuzzled by this slice,** except patches proposed through
  `hexagen_propose_patch` (above), which is propose-only. A coding agent that
  writes client files directly through an editor or shell tool is still
  unmuzzled. A coding agent editing `apps/web`, or any
  client file, through a regular file-write tool never enters
  `hexagen_accept_transaction` — the general rule above says that write
  should be denied when its path is outside `grant.paths`, but no adapter
  enforces that yet. For monaco's own dogfood (this repo, where the manifest
  mutation tools are the only sanctioned write path into `.architecture/`)
  that gap doesn't bite. For the Field Kit, dropped onto a client repo where
  agents edit arbitrary files with an editor tool, it does — closing it
  needs a second adapter at the editor/shell-write layer, not just this
  MCP one, before Grant can be called complete there.
- **Human symmetry is only real if humans can't bypass accept-transaction
  either.** The claim that "the reviewer sees the same object the runtime
  checks" holds only if `.architecture/manifest.yaml` (and any path a grant
  covers) can't be hand-edited or written by the workbench outside the
  transaction flow. If it can, the human side of the symmetry is etiquette,
  not enforcement. Out-of-band writes are explicitly out of scope for this
  slice and are a known hole, not an assumed non-issue.

## Monaco profile vs. the Field Kit Grant

`docs/kernel/grant.schema.json` is **monaco's compiled profile**: it adds
`contexts` because monaco has a `manifest.yaml` to compile against, and
that compile step is how `paths` gets filled in for this repo. The Field
Kit's own schema, for a client repo that may have no such manifest, is not
this file — it lives at `.hexagen/grant.schema.json` in that repo and
requires only `paths` + `tools` as its core; `contexts` is an optional,
monaco-specific extra a client repo can ignore entirely. Every enforcement
point, on either profile, checks `paths`/`tools`/`mode`/`expires_at`
identically — `contexts` is purely how one profile happens to derive
`paths`, never something a checker branches on.

## Commands

`hexagen grant issue` was built in place of the designed `compile` (it signs
the grant and takes `--paths`/`--contexts` directly). `show` and `check` are
built too, and so are `revoke` and `list`. All five live in `@hexagen/sync`
(`packages/sync/src/commands/grant/`).

```
hexagen grant list [--status live|expired|revoked|invalid|all]
                   [--workspace-root <path>] [--key-file <path>] [--engagement <id>]
                   [--json]
    A read-only listing of every *.json under <root>/.hexagen/grants/. It reads
    through the same sidecar guards as
    `hexagen workbook export` — the allow-list, the realpath containment, the
    per-file cap and an O_NOFOLLOW read — so it never becomes a third
    enumerator of that directory, and it never searches upward or follows a
    symlink out. Shape comes from `parseGrant`, the signature verdict from
    `verifyGrantSignature` (which is handed the key resolved once for the whole
    listing), and each row's status from `checkGrantWindow` (never re-derived
    here), so a listing cannot disagree with `check`.
    A file that cannot be read as a grant becomes a row, not a failed call:
    a symlink is `invalid: symlink` and is never read, and so are an
    off-allow-list name, a name the key/env pattern forbids, unparseable JSON,
    a JSON value that is not a grant, a file over the per-file cap, and any
    filesystem error an entry raises (an entry that vanishes mid-read is
    `invalid: vanished before it could be read`). One unreadable grant never
    hides the others. Rows are sorted by expires_at descending, then id. Prints
    the workspace root, the key path and the key fingerprint, never the key, the
    time the window was evaluated at, and a footer saying the listing is a
    snapshot and that `live` speaks about the window only. --status filters the
    printed rows and nothing else: the summary always totals every row
    (`<n> shown (--status <s>); all <every row>`), so a failure the filter
    dropped stays on screen.
    Exit 0 only if at least one grant was read, every grant read verifies and
    no row is invalid; 1 if no grant was read, any row is invalid, or any grant
    read fails its signature — including one --status filtered out of the
    printed rows; 2 bad input (an unknown --status, an unresolvable workspace
    root, an unreadable directory) or a missing .hexagen/ or .hexagen/grants/.
    --json prints an array of the same rows on stdout, with the key line and
    the footer on stderr.

hexagen grant show <grant-file>
    [--workspace-root <path>] [--key-file <path>] [--engagement <id>]
    Pretty-prints id, principal, agent, contexts (when present), paths, tools,
    mode, max_files, expires_at and revoked_at, then the window status and the
    signature status (verified, or why not). The key is the one the shared
    resolver finds (--key-file, HEXAGEN_GRANT_KEY_FILE, the engagement from
    .hexagen/slice.json or --engagement, or the in-repo key in repo mode).
    Prints the key path and fingerprint, never the key.
    Exit 0 the signature verifies; 1 it does not (the reason is printed);
    2 bad input (unreadable file, not JSON, not a grant, an invalid
    .hexagen/slice.json in a client repo). The window is
    informational here: a revoked or expired grant with a valid signature
    still exits 0. `check` enforces it.

hexagen grant check <grant-file> --tool <tool> --path <path>...
    [--workspace-root <path>] [--key-file <path>] [--engagement <id>]
    The Field Kit form. Verifies the signature, then the window
    (checkGrantWindow), then runs checkWriteAgainstGrant (tool, paths,
    max_files). It does not run checkGrantMode: client grants are
    propose-only. With no manifest at the workspace root (a client repo) it
    also denies a path outside slice.paths or inside slice.excludes, even if
    the grant allows it. Prints ALLOW or DENY with the reason, the
    workspace root, the key path and the key fingerprint. When --key-file or
    --engagement was given and the signature fails, the reason also names the
    key the server would use without the override, with both fingerprints.
    Exit 0 allow; 1 deny (including a missing, weak or mismatched key);
    2 bad input (missing --tool or --path, a malformed path, an unreadable
    grant file, an invalid .hexagen/slice.json, an invalid expires_at/revoked_at (an ISO
    date-time with an offset is required), a repeated --tool, a repo with a
    manifest, a transaction id). --path may be repeated or list several
    paths; every one is checked. The Field Kit form is for client repos: in a
    repo with a manifest, mutations are checked at accept, so check exits 2.
    The workspace root is the git toplevel unless --workspace-root is given.
    In a client repo with no .hexagen/slice.json, check denies (exit 1): the
    slice bounds every write. Paths are judged by text only; the MCP
    `hexagen_propose_patch` tool also checks the on-disk spelling, which this
    CLI does not.

hexagen grant check <grant-file> <transaction-id>
    The monaco form. NOT built: pending transactions live in the MCP
    server process (an in-memory store), which the CLI cannot reach without
    wiring that server. It exits 2 and says so. Deferred.
```

```
hexagen grant revoke <grant-file> [--at <iso>] [--yes]
    [--workspace-root <path>] [--key-file <path>] [--engagement <id>]
    Sets revoked_at (default now; --at is an ISO date-time with an offset)
    and re-signs the grant with the same key, over the same canonical payload
    as `issue`. It first verifies the grant under the resolved key and
    refuses (exit 1, nothing written) one that does not verify: it never signs
    what it cannot vouch for. Prints a preflight and writes only with --yes
    (exit 2 without it). The file is replaced through a temp file in the same
    directory and an atomic rename. In a client repo the grant file must be
    under <root>/.hexagen/. Idempotent: a grant that already has revoked_at
    exits 0 with "already revoked at <time>" and no write, unless --at is
    earlier than the recorded time, which moves it earlier. Prints the grant
    id, revoked_at, the key path and the fingerprint, never the key.
    Exit 0 revoked or already revoked; 1 the signature does not verify;
    2 bad input (invalid --at, unreadable or malformed grant, file outside
    .hexagen/, no --yes).
```

`revoke` works in a repo with a manifest too: it verifies and re-signs with the
in-repo key (`.hexagen/grant-signing.key`), and the grant file may be anywhere
(the `.hexagen/` restriction applies to client repos only). A future `--at`
schedules the revocation: the grant stays valid until then, and the preflight
warns. A value at or after `expires_at` has no effect, and the preflight warns
about that too. The file's permission bits are preserved.
The grant path is resolved once and, in a client repo, its directory is checked
to still be under `.hexagen/` right before the rename; a swap of an ancestor
in the instant between that check and the rename is a residual window that this
narrows but does not close. A `<grant>.lock` file (created exclusively, holding
the pid, never auto-broken) serialises concurrent revokes: a held lock exits 2.
When `--key-file` or `--engagement` selects a key other than the server's
default, `revoke` warns with both paths and fingerprints, because the server
would deny that grant as a signature failure, not report it as revoked.

Two different ways to end up with a `revoked_at` field, and they read
differently (BW-D5):

- Editing `revoked_at` by hand breaks the signature, because `revoked_at` is
  part of the signed payload. `check` then denies the grant as a **signature
  failure**, not as revoked.
- `hexagen grant revoke` re-signs the grant, so the signature still verifies
  and `check` denies it with the `grant_revoked` reason.

Deleting the engagement key (`~/.hexagen/keys/<engagement>.key`) revokes every
grant in that engagement at once: nothing verifies any more, so every write is
denied. Use it as an emergency stop.

## Acceptance tests

`docs/kernel/spike/grant.acceptance.test.ts` exercises a standalone
reference module (`docs/kernel/spike/grant.ts`) — pure, dependency-free,
no `fs`, no wiring into `AcceptTransactionToolUseCase`, no CLI. It covers
the "Keep" slice only: compiling `contexts`/`paths` from a manifest,
default deny, fail closed, and `paths` as a second, narrower check. It
does **not** yet cover `id`/`principal`/`agent`/`tools`/`mode`/
`expires_at`/`revoked_at` — those are schema-only until the Trace thread
gives `id` somewhere to be referenced from, per the explicit scope for that
thread: add those fields to the schema, don't rebuild this enforcement
slice around them yet. Both files live under `docs/kernel/spike/`, deliberately
outside `packages/mcp-server/src` and its barrel — `mcp-server` does not
import them, and they are not merged into the running package.
