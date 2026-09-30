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
a linter run *after* the fact (`hexagen-lint --staged`). Grant closes that
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
or may also land. It is *compiled*, not authored free-hand — a human (or a
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
}
```

The first spec of this document had only `contexts` and `paths` — an
allowlist, not a grant. `id` is what a Trace record references (without it,
the next thread would have invented a second identity); `principal`/`agent`
separate who authorized a cycle from who executes it; `tools` scopes
*actions*, not only *locations*; `mode` distinguishes an agent that may
draft a change from one that may land it; `expires_at`/`revoked_at` make
time and revocation first-class even though this slice always mints a
fresh, short-lived grant rather than reading from a store.

### Compiling a grant

`compileGrant(contexts, manifest, extraPaths?)` (monaco profile only — see
below):

1. Look up each name in `manifest.bounded_contexts`. A name that is not a
   real context is a compile error (fail closed — see below), not a
   silently-dropped entry.
2. Expand each context to `packages/<context>/`.
3. Append `extraPaths` verbatim. Extras are **listed on the grant a human
   reviews** (`hexagen grant show`) exactly like context-derived paths —
   they never compile from a guess (there is no implicit "shared codegen
   target" expansion or similar heuristic), and `hexagen grant check`
   applies the same prefix rule to them as to every other entry in `paths`.
   Extras are additive to `paths`; they are never a way to widen `contexts`
   or imply a context wasn't really named.

This is the "reuse manifest.yaml" requirement: contexts are validated
against the same file `hexagen_get_manifest` and the arch linter already
treat as ground truth, so a grant can never name a context that does not
exist in the topology scan. `principal`/`agent`/`tools`/`mode`/`expires_at`
are not compiled from the manifest — they come from whoever is issuing the
grant (a human, or a CI policy) and are opaque to this compile step.

## Enforcement point

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

**Fail closed.** The check runs *before* `transactionManager` claims the
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
  unmuzzled by this slice.** A coding agent editing `apps/web`, or any
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

## Command spec (design only — not built)

```
hexagen grant compile --contexts <name>[,<name>...] --tools <tool>[,<tool>...]
    --mode <write|propose> --principal <id> --agent <id> [--path <extra>]...
    [--expires-in <duration>]
    Reads .architecture/manifest.yaml, validates each --contexts entry
    exists, emits the compiled Grant (with a fresh id and expires_at) as
    JSON on stdout (or --out <file>). Non-zero exit on an unknown context.

hexagen grant show <grant-file>
    Pretty-prints a compiled grant's id, principal, agent, contexts, paths
    (context-derived and extra, distinguished), tools, mode, and expiry for
    human review — the same object the runtime checks, not a paraphrase.

hexagen grant check <grant-file> <transaction-id>
    Dry-runs checkMutationAgainstGrant against a pending transaction's
    PendingManifestMutation without accepting it. Exit code communicates
    allow/deny for CI or a pre-accept hook.
```

None of these three subcommands exist yet in `@hexagen/sync`'s CLI. They
are named here so the acceptance tests below have a target shape, and so a
future implementation slice has a spec to build against rather than
inventing flags ad hoc.

## Acceptance tests

`packages/mcp-server/__tests__/kernel/grant.acceptance.test.ts` exercises a
standalone reference module (`packages/mcp-server/src/domain/grant.ts`) —
pure, dependency-free, no `fs`, no wiring into `AcceptTransactionToolUseCase`,
no CLI. It covers the "Keep" slice only: compiling `contexts`/`paths` from
a manifest, default deny, fail closed, and `paths` as a second, narrower
check. It does **not** yet cover `id`/`principal`/`agent`/`tools`/`mode`/
`expires_at`/`revoked_at` — those are schema-only until the Trace thread
gives `id` somewhere to be referenced from, per the explicit scope for that
thread: add those fields to the schema, don't rebuild this enforcement
slice around them yet. Both files are uncommitted spikes, not merged into
the running `mcp-server` package.
