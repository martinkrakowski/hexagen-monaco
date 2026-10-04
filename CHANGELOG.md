# Changelog

Release notes for the co-published `@hexagen-monaco/sync` and
`@hexagen-monaco/arch-linter` packages (they share one version, tagged `vX.Y.Z`).

**Release order:** merge the bump PR → tag the squash commit `vX.Y.Z` →
`publish.yml` runs on the tag → then deploy. `deploy.yml` refuses to ship
`main` while the version in `packages/sync/package.json` is absent from npm
(F1 preflight, #432): a merged bump blocks deploys until it is published. That
is the guard working, not a fault to bypass.

## 0.14.0

**Six brownfield plans land as one release, and the piece that was missing is
`hexagen evidence verify`.** Everything before this release could _write_ the
evidence — a signed grant, a hash-chained trace, a contract, a slice — and
nothing read it back. `evidence verify` is the reader: given a git range and the
commits' `.hexagen/` evidence, it finds, after the fact, any change to the slice
or to a grant's paths that no key-anchored trace line accounts for. Around it:
a `--base` ratchet that fails a PR which weakens its own contract, a `closed`
contract rule kind (the default-deny the slice could describe but not express),
`hexagen grant list`, a fourth Trace rule on each line's own timeline, and a CI
gate recipe a client repo can copy.

**Minor, not patch.** Four new commands or command flags, one new contract rule
kind, one new reader rule that can fail a pack, and the generated-project change
below. Generated projects pin `^<engine version>`, so a project scaffolded by
0.13.x stays on 0.13.x until the pin is changed.

### ⚠️ Generated projects: the turbo pin moves, and turbo's agent-guidance block is opted out

turbo 2.11.5 added an `agentGuidance` key — it is in that release's
`schema.json`, and in neither 2.10.0's nor 2.11.0's. From that version on, when
turbo detects an AI agent (`AI_AGENT` / `CLAUDECODE`) it appends a
`<!-- BEGIN:turborepo-agent-rules -->` block to the repo-root `AGENTS.md` on every
repo-scoped command, and re-adds it if removed. In a generated project that edits
a tree the generator owns, and `hexagen sync --check` then reports a dirty file
nobody edited.

- **A new project** gets `"agentGuidance": false` in its root `turbo.json` — on
  the built-in path and on the manifest `turboConfig` path alike. A manifest may
  override it explicitly with `monorepo.turboConfig.agentGuidance`; an
  author-supplied `rootFiles.turbo.template` is a full-file override and stays
  verbatim.
- **The generated `turbo` pin moves from `^2.0.0` to `^2.11.5`.** The key exists
  only from that release on, so the wider range could pair the opt-out with a
  turbo whose schema has no such key.
- **An existing project changes nothing until it re-syncs with `--force-root`.**
  `turbo.json` is a protected root file, so a plain `sync` skips it, present or
  not. **Raise the project's own `turbo` dependency to `^2.11.5` and reinstall
  first** — otherwise the generated `turbo.json` would carry a key an older
  installed turbo does not know. Editing `package.json` yourself is the direct
  route; `--only` takes several paths, so while that file is still exactly what
  hexagen generated, one scoped run can take both:
  `hexagen sync --force-root --only package.json turbo.json` (that rewrites the
  whole `package.json` from the template, so do not use it on a root
  `package.json` you have edited). If the upgrade is not happening now, leave
  `turbo.json` alone until it is: an older turbo has no agent-guidance block to
  write, so there is nothing to opt out of yet.
- hexagen-monaco's own root `turbo.json` and its turbo 1.x dependency are
  untouched; the pin and the key are for generated projects only.

### New commands and flags (`@hexagen-monaco/sync`)

- **`hexagen evidence verify --since <ref> [--until <ref>] --grant <file>…`.** A
  read-only pass that opens no file under `.hexagen/` for writing. It takes the
  slice from `<since>` and the trace, tip and proposals from `<until>` through
  git, so only committed evidence counts and a committed blob cannot change under
  it; it requires `<since>` to be an ancestor of `<until>`. Coverage is a join,
  not a new field: a candidate line covers a path when some
  `.hexagen/proposals/<id>.json` names its `seq` and its grant, and its
  `paths` reproduce that line's `result_digest` — so an edited `paths` breaks the
  digest instead of being believed. Exit 1 names each unaccounted file; exit 2 is
  bad input or unsound evidence — a truncated diff, a trace rewritten since
  `<since>`, a missing or unusable tip, a proposal that does not reproduce its
  line's digest, a grant that does not verify.
  **It requires a recorded tip** (owner-confirmed 2026-10-04): `tip.json` is the
  only thing that binds a line to the engagement key, so a missing tip, one whose
  HMAC does not verify, or one the trace no longer matches — it ends below the
  tip's `seq`, or the line at that `seq` differs — exits 2 before any coverage is
  judged. A line _above_ the tip is not an error: it is unanchored, it covers
  nothing, and a change that only such a line would have covered is reported as
  unaccounted, exit 1. Hence **pack before you verify**. Two limits it states
  itself: it proves an authorized line covering a path exists, not that the line
  is true; and until Trace carries paths itself, a change applied through
  `hexagen_accept_transaction` is unaccounted here, because that writer leaves no
  path list behind (see "Deferred", below).
- **`hexagen contract check --base <ref>`.** The ratchet: it reads
  `.hexagen/contract.json` and `.hexagen/slice.json` **at** `<ref>` with
  `git show` and exits 1 when the tree has made the gate weaker — a
  `knownViolations` entry added, re-pointed or extended, a rule removed, weakened
  or re-kinded, a `closed` rule's `except` added or widened, a severity moved
  `error` → `warn`, a new slice exclude, a slice path removed or narrowed.
  `--allow-growth --reason "<why>"` is the deliberate way through. Detection, not
  a write-time refusal: the change is already committed, so each finding prints as
  `growth: …` with the hash the base was read at.
- **`hexagen grant list`.** A read-only listing of every entry in
  `.hexagen/grants/` — status from the shared `checkGrantWindow`, the signature
  verdict from the key resolved once for the run, `--status` to filter and
  `--json` for the same rows. Every entry becomes a row, never a hidden one: an
  entry that is not a valid grant — a symlink, which is listed and never read, an
  off-allow-list or forbidden name, unparseable JSON, a value that is not a
  grant, a file over the per-file cap, one that vanishes mid-read — is an
  `invalid` row, and any invalid row (like any row `--status` hid, or any
  unverified signature) exits 1. `.hexagen/grants/` now has one enumerator,
  shared with `workbook export`.
- **`contract propose --closed`, and the `closed` contract rule kind.** A
  `{id, kind: closed, except[], severity}` rule has no `from` or `to`: it flags
  any edge from inside the slice to a target that is neither in the slice nor
  under an `except` prefix, and excludes beat excepts. `contract propose --closed`
  proposes one that excepts exactly today's crossing targets — it never widens a
  target, reports the targets it cannot propose, and shell-quotes the command it
  prints. `contract show` warns when a single closed rule's excepts cover every
  package outside the slice, which is a slice that permits everything.

### The trace has a fourth rule

Rule 4 (`traceRuleReasons`, the one implementation `evidence pack` and
`workbook export` share) judges each line against its own timestamps: `ended_at`
at or after `started_at`, every tool call inside that window compared at full
precision, and calls in order. A missing or unparsable `started_at` / `ended_at`
is a reason, not a skip — on a `completed` line and on a denial line alike.
`started_at`/`ended_at` were already carried and shape-checked, and no rule read
them. Both writers already bind one timestamp and pass it as the call's `time`,
`started_at` and `ended_at`, so a trace this kit writes is unaffected; a
hand-edited or third-party trace whose own timestamps contradict is now rejected
rather than packed.

### A CI gate for client repos

`docs/ci/brownfield-gate.yml` is a complete example workflow for a repo that
holds only `.hexagen/` and no manifest — step 0 (the inputs are tracked), step 1
`observe`, step 2 `slice check` as a non-blocking drift report, step 3
`contract check --base` against a pinned PR base with a first-PR bootstrap, step
4 `evidence pack`, step 4b `evidence verify`. Every step prints
`step <n> exit <code>` and the job stops at the first non-zero one except step 2.
Step 4 is the whole-trace gate — every line of the committed trace is checked,
chain, line shape, Rules 1 to 4 and the cited grants — and the bundle it writes
is discarded, so a green run keeps none: the client reproduces one by re-running
`hexagen evidence pack` over the committed trace, which is the same HMAC'd,
re-checkable-with-the-engagement-key judgement step 4 makes (no command takes a
saved zip yet). The one `EDIT SPOT` is `HEXAGEN_VERSION`, and steps 3 and 4b make
**0.14.0 the minimum**, because they are the commands this release ships. The
recipe that explains the gate is `docs/ci/brownfield-gate-recipe.md`, and
`packages/sync/__tests__/contract/brownfield-gate.contract.test.ts` executes that
workflow's own step scripts against the built CLI on a fixture client repo, so
the two cannot drift apart.

### Also in this release

- **`contract propose` (without `--closed`) shell-quotes its `add-rule` lines**
  (#763), with the same helper `--closed` uses, so a slice path containing a
  space or a `;` no longer splits or runs anything when the printed command is
  pasted.
- The sync README documents every Field Kit command merged in #753–#760, each
  checked against the merged code and the built CLI, and `docs/kernel/GRANT.md`
  now names `hexagen_propose_patch` as the Field Kit adapter that exists today
  rather than describing it as a future one.
- `docs/kernel/TRACE.md` specifies `evidence verify` command by command, and
  `GRANT.md` drops the unused `extraPaths`.
- Test-only: the web workbench's integration waits are deterministic again
  (#723/#752), which also fixed four bugs in `useStagedGenerationStream` found
  while chasing the race. Neither change touches a published package.

**Deferred: 1B, the Option A follow-on.** Option A would add an optional
`paths: string[]` to each `tool_calls[]` record inside the hash chain, so a
change applied through `hexagen_accept_transaction` becomes accountable too. It
is a schema change plus a port and adapter change, and the owner chose Option D
first (read the paths back from the proposal metadata the writer already leaves
beside the line), so 1B has not started and does not exist until Option A is
chosen.

`@hexagen-monaco/arch-linter` is re-published at the same version for the
co-release. It has no functional change in this release.

## 0.13.0

**The brownfield workbook CLI.** `hexagen` can now work inside an existing client
repository without generating anything. It observes what the repo actually
contains, lets you draw a slice and a contract over it, issues a signed grant
that bounds an agent to that slice, records what the agent did in a
hash-chained trace, and packs the result into one evidence bundle. Everything it
writes lives in a `.hexagen/` sidecar that is git-excluded by default. Nothing
reaches the client's history unless you stage it explicitly.

**Minor, not patch.** New commands, plus the generated-project change below.
Generated projects pin `^<engine version>`, so a project scaffolded by 0.12.x
stays on 0.12.x until the pin is changed.

### ⚠️ `hexagen sync` now emits a Prettier config

Generated projects get a root Prettier config (#684), registered as a protected
file, so a re-sync does not overwrite a hand-edited copy. Before this, a
generated project had a `format` script but no config, so its first format run
reformatted everything to Prettier's defaults. **A new project** gets the file
at generation. **An existing project does not:** `.prettierrc.json` is a
protected root file, so a plain `sync` skips it (`skipped (root protected, use
--force-root)`) even when it is absent. To add it, run `hexagen sync
--force-root --only .prettierrc.json`. `--only` limits the forced write to
that one file, so no other protected root file is overwritten. The emitted format glob no longer includes `md`.

### New commands (`@hexagen-monaco/sync`)

- **`hexagen observe`.** A read-only scan of a client repo. It records the
  packages, the cross-package import edges and the unresolved imports, in the
  repo's own names, with no invented layers or types (#727, #731). It writes
  `.hexagen/observed.json` only with `--out … --yes`.
- **`hexagen slice init|show|check` and `hexagen contract add-rule|check`.** These
  draw the slice an engagement may touch and the `forbid` / `allow-only` rules
  between path prefixes. `check` is fail-closed: an incomplete scan never
  reports clean (#734).
- **`hexagen grant key init|issue|show|check|revoke`.** These manage the
  engagement key and HMAC-signed grants that bound an agent's tools, paths,
  mode and expiry (#711, #729, #732, #735). The key stays under `~/.hexagen/keys/`,
  outside the repo.
- **`hexagen evidence pack`.** It verifies the hash-chained trace against the
  grants and writes a signed evidence zip (#733).
- **`hexagen workbook export`.** It writes the whole workbook (observed report,
  slice, contract, grants, proposals and evidence) as one HMAC-indexed bundle
  for the browser viewer. `--stage` is the only path into client history: it
  stages the exact pinned bytes and never commits (#739).

### Also in this release

- **The MCP server's `hexagen_propose_patch`** (in the monorepo; the MCP
  server is not published to npm). It writes propose-only patches
  under `.hexagen/proposals/`, bounded by the grant and the slice. You apply
  them yourself with `git apply -p1` (#738).
- **The contract rule semantics moved into the shared kernel,** so the CLI and
  the web viewer judge edges with one implementation (#743). Behaviour is
  unchanged with one exception: a `knownViolations[].expires` value that is not
  a real calendar date (for example `2026-02-30`) is now rejected when the
  contract is parsed. `hexagen contract check` still exits 2 on it, as before;
  the error now comes from the schema and still names the entry and the date.

`@hexagen-monaco/arch-linter` is re-published at the same version for the
co-release. It has no functional change in this release; only two findings documents were added to its tree.

## 0.12.1

**Patch. `@hexagen-monaco/arch-linter` could not analyse a single file on
Windows.** If you run `hexagen-lint` on Windows, 0.12.0 and earlier exit 2 with
`NOTHING WAS CHECKED for module '<name>' … 0 source files remain` on every run.
Upgrade.

### The defect

The linter compared two path conventions that never match on Windows:
`ts-morph` returns TypeScript's form — forward slashes on **every** platform —
while the module root came from `path.join` / `path.resolve` and is
backslashed on Windows. The prefix test therefore matched nothing, every module
scanned zero files, and the run aborted.

Nothing was mis-reported as clean: the fail-closed vacuity guard refused to
call an empty scan a pass, which is why the failure is loud. But the tool was
unusable on Windows, and CI could not see it because the suites that exercise
the CLI were skipped on that platform.

macOS and Linux are unaffected — the two conventions coincide there, which is
why this survived since the affected call site was introduced.

### Also in this release

- The Windows CI leg now runs the linter's CLI suites (they were skipped with
  no recorded reason). Eleven suites were re-enabled; the twelfth keeps a skip
  that now states what is genuinely POSIX-bound.
- Two arch-linter tests asserted only that a diagnostic was _absent_, which a
  zero-file run satisfies. They now assert a non-zero files-scanned count
  first, so they fail on exactly the defect above.

No API, CLI-flag, or output-format changes. `@hexagen-monaco/sync` is
re-published at the same version for the co-release; it has no functional
change in this patch.

## 0.12.0

Everything `hexagen scan` and the brownfield import flow need from the
published CLI. **0.11.0 on npm has no `scan` command**; the production web
app has been running it from the monorepo checkout (D-P1, #616) rather than
from the registry. This release closes that gap.

**Minor, not patch**, for the same reason 0.11.0 was: a caret range on `0.11.x`
would otherwise pull the two behaviour changes below into every generated
project on its next install. Generated projects pin `^<engine version>`; a
project scaffolded by 0.11.x stays on 0.11.x until the pin is changed.

### ⚠️ A project that passed the linter on 0.11.0 can fail on 0.12.0

`hexagen-lint` now enforces **context-declaration accuracy** (#621, ADR-0057):
every port and adapter a `context.yaml` declares must name a symbol the code
actually exports. Declarations were prose before — nothing read them. The
direction is one-way by decision: a _declared_ element that resolves to
nothing is a violation; an exported symbol the registry does not name reports
nothing. Run `hexagen-lint` before bumping the pin; the fix is either to
correct the declaration or to delete it.

### ⚠️ `hexagen sync` no longer emits unused layer folders

A configured layer directory is created only when the bounded-context YAML
lists real content for it — entities, ports, adapters, use-cases, factories
(#554, HEX-025). Missing `layers:`, empty objects and empty lists emit
nothing. Existing projects are unaffected on disk (sync does not delete), but
a `sync --check` that previously reported dozens of `created` layer ops now
reports none. The six `@generated` empty `export {};` barrels in
`core-domain` and `runtime` are gone from the reference tree (#548).

### `hexagen scan` — brownfield import in one command (new)

```text
hexagen scan [--root <path>] [--yes] [--dry-run] [--force]
             [--skip-bootstrap] [--no-report] [--handoff] [--handoff-out <path>]
```

Composes adopt → bootstrap → lint → report (#557). Refuses to write without
`--yes`; `--dry-run` prints the proposed layout and writes nothing. Exit codes
keep the 0 / 1 / 2 contract (clean / findings / could-not-run).

- **Machine-readable envelope** on the final stdout line, after the human
  output, on success _and_ failure — a consumer learns _why_ a scan could not
  run instead of inferring it from an exit code (#577; schema in
  `@hexagen/shared`, versioned, with a golden fixture, #569).
- The envelope carries the **`hexagen-lint --json` findings and the scanned
  file count** (#597). `introduced` / `baselineGrowth` are deliberately
  absent: the linter fills them only under `--pr-diff`, which a first import
  cannot have.
- `--handoff` writes the **Tier-A upload zip** the hosted import route
  ingests; `--handoff-out` names the path (#588). `--handoff` with
  `--no-report` or `--dry-run` is refused before any write.
- `hexagen-report.md` is what `report` actually writes; the envelope names it
  and carries its markdown directly (#577 — the old probe list named three
  files that were never produced).

### `hexagen-lint`

- Every human-readable run prints
  `Ratchet: N suppressed / M stale / K fresh (<baseline>)`, including zeros
  (#537). `--json` is unchanged.
- Context-declaration check, as above (#621).

### `hexagen arch refactor`

Reports a named warning — `Could not parse <path> (syntactic); impact for
this file is incomplete` — instead of a silent, confident result when a file
that mentions the target symbol cannot be parsed (#538). Semantic errors are
excluded so consumer trees do not flood the channel.

### Fixes

- **Probe parity** across adopt, bootstrap `--dry-run` and scan (#561): a
  dangling `layout.yaml` / manifest symlink is an _existing_ path (it blocks
  overwrite without `--force`), `EACCES` propagates instead of reading as
  "absent", and bootstrap `--dry-run` runs the overwrite guard _before_
  reporting `Would write:`.
- `MigrateManifestUseCase` no longer imports `node:util` from the domain
  layer (#550); `template-engine` domain no longer imports `node:path` (#545).

### License text

The `LICENSE` file inside the `@hexagen-monaco/sync` tarball was a copy of
the root platform licence whose preamble described sync as a _wedge_ package
"licensed separately" — while being that file. The preamble now states what
ADR-0066 decided: sync is platform (Source-Available Evaluation License);
`@hexagen-monaco/arch-linter` is the only wedge (FSL-1.1-Apache-2.0, SPDX
`FSL-1.1-ALv2`). **No licence terms change**; only the description of which
package is under which terms. ADR-0061 is marked superseded by ADR-0066
(#627, #629).

## 0.11.0

Prepared as 0.10.0 in #485; **never tagged or published**. Shipped as **0.11.0**
so the number matches the tree that also carries the post-#485 FDE, adopt, and
bootstrap work. There is no `@hexagen-monaco/sync@0.10.0` on npm.

**Read the first two sections before upgrading.** This is a **minor**, not a
patch, and deliberately so: under 0.x semver a caret range resolves
`^0.9.0` → `>=0.9.0 <0.10.0`, so a 0.9.x patch would have pushed every change
below into every already-generated project automatically on its next install.
The minor is the fence. Generated projects pin `^<engine version>` for both
packages, so a project scaffolded by 0.9.x stays on 0.9.x until someone
changes that pin on purpose.

### License boundary (ADR-0061, ADR-0066)

Already-published tarballs of `@hexagen-monaco/sync` and
`@hexagen-monaco/arch-linter` at **≤0.9.0** remain under the Source-Available
Evaluation License **forever**.

**Published `0.11.0` tarballs (what `npm view` serves today):**
`@hexagen-monaco/arch-linter@0.11.0` `license` is `FSL-1.1-ALv2`
(FSL-1.1-Apache-2.0 family);
`@hexagen-monaco/sync@0.11.0` `license` is `UNLICENSED` (Source-Available
Evaluation License, ADR-0066). This changelog edit does not change either
published tarball.

Later source-tree edits follow the same split unless a later release notes
otherwise.

### ⚠️ Node 20 is no longer supported

`engines.node` moves from `>=20` to **`>=22.7.0`** for **both** packages
(ADR-0052 — the published floor tracks the repo's own toolchain floor rather
than trailing it). Installing on Node 20 now produces an `EBADENGINE`
warning, and the bundles are built against, and only tested on, Node ≥ 22.7.
**If you are on Node 20, stay on 0.9.x or upgrade Node first.**

### ⚠️ `hexagen-lint` gains three new rule classes

`@hexagen-monaco/arch-linter` grows a **layer-purity** policy (ADR-0054 §2),
covering three holes the previous layer check structurally could not see —
its finding was gated on the import resolving to an in-project source file, so
none of these ever produced output:

- **`cross-layer-relative-import`** — a specifier starting with `.` or `/` used
  to be treated as "relative import within the same package → allowed", so
  `domain/x.ts` importing `../infrastructure/db.js` went uninspected.
- **`node-builtin-in-layer`** — `node:fs` in a domain or application layer
  resolves to no source file, so it was invisible.
- **`npm-package-in-domain`** — a bare package specifier resolves into
  `node_modules` (excluded from the walk) or nowhere, likewise invisible. This
  class reads a declarative `domain_package_allowlist` from
  `linter-config.yaml`; **generated projects get an empty allowlist by
  default** (ADR-0054 §4), so a project that needs an exception must state it.

### FDE kit

Not in the published 0.9.0 tarball. 0.9.0 does not have these commands or
flags.

- `hexagen report` / `hexagen report --handoff` — HTML/Markdown engagement
  artifact (context map, drift vs baseline, git ratchet trend, suppression
  ledger) and a zip of report + manifest + layout + baseline + ledger.
- `hexagen-lint --ratchet --pr-diff` — per-PR violation comment (silent when
  clean), rename-aware identity remapping, machine-enforced baseline growth.
- Baseline entries accept optional `reason` and `expires` (`YYYY-MM-DD`);
  unknown fields are rejected; expired suppressions fail the gate.
- Composite action `.github/actions/hexagen-conformance` wraps the linter
  ratchet + `sync --check`. Generated projects vendor that action.

**A project that passed the linter on 0.9.x can therefore fail on 0.11.0** —
in `hexagen-lint` directly, in the `architectural-integrity` CI workflow, and
in `hexagen sync`, which runs the linter for you. The findings are real (they
were always violations; the linter simply could not see them), so the fix is
the code or a declared allowlist entry, not a downgrade.

### Removed from the `@hexagen-monaco/sync` root barrel

The supported contract of this package is the **`hexagen` binary** —
`@hexagen-monaco/sync`'s root barrel is **provisional under 0.x**, and this
release trims it to what a consumer can legitimately drive (ADR-0056). Every
withdrawn name is listed here, by name, because that is what the ADR obliges a
removal to do:

- **`InMemoryConfigDouble`** — a test double. Shipping a fake as public API
  invited consumers to build against a fixture.
- **`YamlConfigAdapter`** — an infrastructure adapter. Consumers drive
  configuration through the CLI; constructing the adapter directly reaches past
  the port.
- The six `fs-utils` names — **`protectedFiles`**, **`isGeneratedFile`**,
  **`isProtectedRoot`**, **`isInScope`**, **`safeWriteFileAtomic`**,
  **`safeWriteFile`**. These are the engine's internal write plumbing; their
  safety invariants (scope filter, protected-root guard, generated-marker
  check) only hold inside a `SyncConfig`-shaped run.

Everything else the barrel exported in 0.9.0 is unchanged — including
`SyncEngine`, `Manifest`, `SyncConfig`, the `application/ports/out` types, and
the `manifest-service` functions. `__tests__/contract/public-surface.contract.test.ts`
now snapshots the full set, so the next removal is a deliberate red-then-green
edit rather than a judgement call.

### Other published-manifest changes

- **`ts-morph` `^22.0.0` → `^27.0.2`** in `@hexagen-monaco/sync` (a major).
  ts-morph bundles its own TypeScript, so the bundled compiler moves
  **5.4.2 → 5.9.2**. `@hexagen-monaco/arch-linter` was already on `^27.0.2`;
  this brings the two packages onto one ts-morph line.
- **`hexagen-lint`'s bin target moves** from `dist/index.js` to `dist/cli.js`
  (GOD-002 split: `dist/index.js` is now the side-effect-free library barrel
  and must not be exec'd). The `hexagen-lint` command itself is unchanged.
- **`js-yaml` `^4.1.0` → `^4.1.1`** in both packages.

### Also in this cycle

The linter gains an opt-in **ratchet baseline** (`ratchet-baseline.ts`) and
**optional YAML config** loading, so a project can adopt a stricter posture
incrementally instead of in one jump — see ADR-0054.

- **`hexagen adopt` / `hexagen bootstrap`** (#529, #533) — assisted brownfield
  adoption and greenfield bootstrap. The published CLI registers `bootstrap`
  once, via `program.addCommand(bootstrapCommander)`.
- **FDE kit wiring** (#530) — `hexagen report` / `--handoff`,
  `hexagen-lint --ratchet --pr-diff`, and the vendored
  `.github/actions/hexagen-conformance` composite action.
- **arch-linter CLI harden** (#533) — missing declared module dirs skip (DoD
  for generated repos); unscoped name collisions are workspace imports only
  when the resolved path is one; ignore-only modules still fail vacuity.

## 0.9.0

Lock-step version bump — **no functional changes** to `@hexagen-monaco/sync`
or `@hexagen-monaco/arch-linter` this cycle. The release carries a large
web-app cycle that ships via the VPS deploy (not npm):

- **AI governance chat on the accept view** (#388, #391–#402): a chat panel on
  the project-accept view that explains governance findings and applies
  AI-suggested manifest fixes, plus the generator fixes that arc surfaced —
  shared-kernel exemption from the minimum-interface contract, adapter→port
  implements re-inference on import (phantom R04/R05), deterministic R01
  auto-resolve, and a single-ownership advisory for ports shared across
  contexts.
- **Import hardening** (#407–#411): generated manifests are guaranteed to
  parse on the accept screen, the generating step summarizes success-first,
  the Hexagen `contexts:` manifest dialect imports deterministically, a corpus
  regression harness adds crash-proofing and truncation detection, and
  dialect-declared bindings/descriptions are honored on import (alvaro-ai RCA).
- **Project planning layers** (#403–#405, #414–#416, ADR-0045): projects gain
  a provenance layer stack — brainstorm/decisions capture at import-accept,
  provenance links from a manifest back to its planning session, turn
  splitting, LLM decisions extraction, and interactive in-app brainstorm
  sessions v1 (proposer⇄critic loop with convergence detection and a
  finalize→import handoff).

## 0.8.1

Generated-project **app scaffolding** gains real, build-verified starter
templates for seven more frameworks, generated Vue apps lint their SFCs, and
generated projects scaffold their tests on Vitest. No functional changes to
`@hexagen-monaco/arch-linter` (lock-step bump).

### Sync engine (`@hexagen-monaco/sync`)

- **Real app framework templates.** `hexagen sync` now emits proper starter apps
  for **Express, NestJS, Serverless (AWS Lambda), Vue, React Router, Remix, and
  Angular**. Previously only Nitro and Next.js were real — every other wizard
  framework selection silently fell back to a bare plain-TypeScript app. Each
  scaffold is minimal-but-real: framework `package.json`, `tsconfig`, entry
  point, and any required config files (e.g. `angular.json`, `vite.config.ts`,
  `serverless.yml`).
- **Build-verified end-to-end.** Every framework scaffold was generated and run
  through `npm install` + its own typecheck **and full build** (`tsc` /
  `nest build` / `nitro build` / `vite build` / `ng build` / `next build` /
  `remix vite:build`). Fixes from that pass:
  - Remix is pinned to the **React 18** line its v2 peer dependencies require (a
    React 19 pin failed `npm install` with `ERESOLVE`).
  - Next.js scaffolds gain a root `app/layout.tsx`, a Next-shaped `tsconfig`
    (`noEmit`, `jsx: "preserve"`, `.next/types` in `include`), and the
    `@types/react` / `@types/react-dom` its `tsc --noEmit` needs.
  - Angular's `tsconfig` pins its own `rootDir` / `composite` so it doesn't
    inherit incompatible monorepo-base settings.
  - Every generated app now ships the `@eslint/js` + `typescript-eslint`
    packages its `eslint.config.js` imports, so `npm run lint` actually runs.
- **Vue SFC linting.** A generated Vue app's `eslint.config.js` is now Vue-aware
  (eslint-plugin-vue flat config + a `vue-eslint-parser` → TypeScript-parser
  handoff), so it lints `.vue` single-file components instead of erroring.
- **Vitest test scaffolding (ADR-0044).** Generated projects scaffold their
  tests on Vitest: the `--with-tests` path emits a per-package `vitest.config.ts`
  (with a `dist/**` exclude), a `test` script, and a `vitest` devDependency, and
  `hexagen add` emits test scaffolds only when `--with-tests` is passed.

### Architecture linter (`@hexagen-monaco/arch-linter`)

No functional changes — lock-step version bump.

## 0.8.0

Lock-step version bump — **no functional changes** to `@hexagen-monaco/sync` or
`@hexagen-monaco/arch-linter` this cycle. The release carries web-app work that
ships via the VPS deploy (not npm): free-tier **daily quotas** (per-anonymous-
session generation/chat caps on a durable SQLite store) and the
`tencent/hy3-preview` chat model.

## 0.7.1

The sync-toolchain remediation **Wave C** plus its review fix-forwards. All
changes are backward-compatible for existing projects; the one consumer-visible
note is the `schemaVersion` skew below.

### Sync engine (`@hexagen-monaco/sync`)

- **Manifest `schemaVersion` gate + `hexagen manifest migrate`** (RCA #6). The
  root manifest can carry a `schemaVersion`; a newer-than-supported manifest now
  fails with a guided "upgrade the toolchain" message **before** the strict
  parse, instead of a misleading "unrecognized key". `hexagen manifest migrate`
  stamps/forwards it without touching a single comment.
- **Leaf `.gitkeep` in empty layer directories** (RCA, consumer-CI). Git can't
  track an empty directory, so a freshly-scaffolded layer skeleton drifted on a
  fresh checkout (`sync --check` reported phantom directory creates). The
  generator now emits a `.gitkeep` in each leaf layer dir.
- **cwd-first workspace-root resolution** (RCA #7). The CLI now resolves the
  workspace from your current directory first, then the install location —
  fixing global/`npx` installs, which previously walked a cache directory and
  failed with a terse error. The exhausted-probes error now names the probes and
  the npx/global footgun.
- **`sync --check` fails on a missing manifest** (B1). The drift gate previously
  synthesized an empty manifest and exited 0 — green-lighting a tree it never
  measured. It now exits non-zero with a clear message; plain `--dry-run` keeps
  its empty-manifest preview tolerance.
- **Loadable ownership registry** (RCA #9). The generated
  `generator.config.yaml` ownership block no longer emits duplicate YAML mapping
  keys when two contexts share a port/adapter name (it was unloadable by strict
  parsers); names contested across contexts get context-qualified keys, and
  YAML-hostile context names are safely quoted on both key and value sides.
- **Truthful scaffold governance docs** (RCA #9). `AGENTS.md`, the observability
  logging spec, and the env-setup sidecar now assert only what the scaffold
  actually installs.
- Clearer `findWorkspaceRoot` errors: a `package.json` that exists but can't be
  read/parsed is now surfaced instead of misreported as "no workspaces array".

### Arch-linter (`@hexagen-monaco/arch-linter`)

- **Cross-context imports honor the manifest's `depends_on`** (ADR-0043, RCA
  #8). A dependency declared in `manifest.yaml` now legalizes the import with no
  `linter-config.yaml` edit. Contexts typed `shared-kernel` are importable from
  anywhere; `cannot_import` remains the explicit per-edge veto. The change is
  strictly loosening — no project gets _new_ violations.
- Success/relay messages now name exactly what was checked, instead of the
  blanket "compliant with manifest.yaml".

### Upgrade note

Older _published_ CLIs/linters predate `schemaVersion` and will strict-reject a
manifest that carries it. Only newly-scaffolded projects (whose pins are ≥ the
writer) and explicitly-migrated projects get the stamp; nothing existing is
rewritten without running `hexagen manifest migrate`.

## 0.7.0

Sync-toolchain Waves A+B: truthful sync counts, the `sync --check` drift gate,
single-owner barrel generation, and the rollback journal.
