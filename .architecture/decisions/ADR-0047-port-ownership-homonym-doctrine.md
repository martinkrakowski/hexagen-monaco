# ADR-0047: Port Ownership and Homonym Doctrine: Delete Dead Copies, Do Not Cross-Import

**Date:** 2026-08-14
**Status:** Proposed
**Type:** Architecture
**Relates to:** SyncEngine invariant #3 `port-single-ownership` (`.agents/ORCHESTRATOR.md:195`), AGENTS.md port-ownership rule; executed by remediation-plan items 4.1 (deletion), 5.1 and 5.6 (write ports)

## Context

The 2026-08-13 architecture review (candidate ADR-C1, archived under
`docs/planning/2026-08-13-architecture-review/`) flagged a "port-homonym
cluster": one exported port name declared in several packages, claimed as an
ownership hazard. The 2026-08-14 adversarial audit
(`docs/planning/2026-08-13-architecture-review/AUDIT-2026-08-14.md`, ledger
rows HEX-005/006/007) confirmed the homonyms exist but neutralized the hazard
and **refuted the candidate's primary recommendation** — "import the owner's
published port." Two of the three clashes are dead code; the third is a benign
naming collision between structurally disjoint contracts. TypeScript's
structural typing means a homonym across two packages with no shared import
scope cannot bind to the wrong adapter. This ADR sets the doctrine the
audit's picture requires: **delete dead copies; keep a name-per-context homonym
only when the contracts are genuinely different and both live; never introduce a
cross-context port import to "de-duplicate."**

### Recomputed tallies (the candidate's 166/7 is not reproducible)

The candidate stated `export (interface|type) \w*Port` "appears under 166
names" with "seven names … declared in more than one file." Neither number
reproduces on the current tree. Regenerated from the working tree
(2026-08-14):

```
# unique exported *Port names (packages/**, excluding *.test.ts and __tests__)
rg -o --no-filename -g 'packages/**/*.ts' -g '!**/*.test.ts' -g '!**/__tests__/**' \
   'export (interface|type) (\w*Port)\b' -r '$2' | sort -u | wc -l   # -> 159

# real-source homonyms (same filters, also excluding **/templates/**),
# names declared in >1 file:
#   3  ProjectConfigurationReadPort
#   2  SecretVaultPort
#   2  ManifestGenerationPort
#   2  FileSystemPort
```

**159 unique names**, not 166. **4 real-source homonyms**, not 7 — the
candidate's higher homonym count came from counting generated
`packages/**/templates/**` Adobe/Firefly duplicates as clashes. Of the four,
`SecretVaultPort` is HEX-008 (a separate split/rename, remediation item 5.4);
the three this ADR governs are `ProjectConfigurationReadPort`,
`ManifestGenerationPort`, and `FileSystemPort`.

### The three clashes, verified against the current tree

**HEX-005 — `ManifestGenerationPort` (benign collision, both live).**
`packages/manifest-generation/src/application/ports/in/manifest-generation.port.ts:22`
declares an **inbound** port with a single `execute(description, options)`
method (implemented by `ServerManifestGenerationUseCase`).
`packages/mcp-server/src/application/ports/out/manifest-generation.port.ts:56`
declares an **outbound** port with `generateTopology` / `generateAdapters` /
`generateManifestPipeline` (consumed by mcp-server's generate-topology /
generate-adapters / generate-manifest-pipeline use cases and wired at
`packages/mcp-server/src/index.ts`). The method sets are disjoint; the two
never share an import scope. This is a naming collision, not an ownership
breach.

**HEX-006 — `ProjectConfigurationReadPort` (three copies, one live).** Declared
in `project-configuration`
(`packages/project-configuration/src/application/ports/out/project-configuration-read.port.ts:4`),
`mcp-server`
(`packages/mcp-server/src/application/ports/out/project-configuration-read.port.ts:4`),
and `sync`
(`packages/sync/src/application/ports/out/project-configuration-read.port.ts:4`).
Only mcp-server's is live — wired through its adapter, use case, and index
(`packages/mcp-server/src/infrastructure/adapters/project-configuration-read.adapter.ts:6`;
`packages/mcp-server/src/index.ts:51,110`). project-configuration's copy is
consumed only by its own dead `ReadManifestUseCase` (below). sync's copy backs
only `sync`'s `GetManifestResourceUseCase`, which has **no** production
composition importer — only tests reference it
(`packages/sync/__tests__/application/resource-use-cases.test.ts:8,33`; the
mcp-server `GetManifestResourceUseCase` imported at `mcp-server/src/index.ts:20`
and constructed at `:110` is a distinct copy).

**HEX-007 — `FileSystemPort` + `NodeFileSystemAdapter` + `ReadManifestUseCase`
(dead cluster in project-configuration).**
`packages/project-configuration/src/application/use-cases/read-manifest.use-case.ts:6`
declares `ReadManifestUseCase`, which is repo-wide unreferenced and is **not
even re-exported** — the use-cases barrel
(`packages/project-configuration/src/application/use-cases/index.ts`) lists
generate-project / render-manifest / validate-spec /
validate-manifest-change, not read-manifest. Its collaborators
`FileSystemPort`
(`packages/project-configuration/src/application/ports/out/file-system.port.ts:1`,
also **not** in that package's `ports/out` barrel, which lists only telemetry /
project-config-schema / project-configuration-read) and `NodeFileSystemAdapter`
(`packages/project-configuration/src/infrastructure/adapters/node-file-system.adapter.ts`)
have no consumers other than that dead use case. sync's identically-named
`FileSystemPort`
(`packages/sync/src/application/ports/out/file-system.port.ts:9`) is live —
barrel-exported, implemented by `AtomicFileSystemAdapter`
(`packages/sync/src/infrastructure/adapters/atomic-file-system.adapter.ts:12`)
— and is a **different contract** (project-configuration's is
`readFile`/`mergeManifests`; sync's is an exists/atomic-write shape for
generators), so the two must not be unified.

### The write-port gap (HEX-002, HEX-014 — guidance retained)

Two application-layer use cases perform filesystem I/O directly instead of
delegating through a driven port:

- **HEX-002:**
  `packages/project-generation/src/application/generate-project-use-case.ts:19`
  imports `node:fs/promises` and calls `fs.mkdir` / `fs.writeFile` from the
  application layer (`:280-281`, `:300`, `:318`, `:337`). The package's
  `ports/out` barrel owns add-on-materializer / external-project-generator /
  project-exporter / zip-creator ports but **no filesystem write port**.
  (The separate `GenerateProjectPort` in `project-configuration`
  (`.../ports/in/generate-project.port.ts`) is an inbound contract; the
  `ports/in` vs `ports/out` misfiling question for driven contracts is the
  HEX-018 folder question, ADR 0.2, not this ADR.)
- **HEX-014:**
  `packages/template-engine/src/application/use-cases/validate-templates.use-case.ts:1`
  imports `node:fs/promises` (and `node:path`, `:2`) directly in the
  application layer.

These need a **driven read/write port** so the use case can be tested against
an in-memory filesystem double. Remediation item 5.6 pairs HEX-014 with
**HEX-015** — `ExportGraphImageUseCase` in `packages/visualization`
(`packages/visualization/src/application/use-cases/export-graph-image.ts`),
which performs DOM / fetch / html-to-image I/O (a _different_ kind of driven
I/O, not `node:fs`) — under the same "drop direct I/O behind an injected port"
rule, as two separate PRs. The audit kept the write-port recommendation; this
ADR authorizes it as doctrine.

### Governing invariant

`.agents/ORCHESTRATOR.md` records `port-single-ownership` as a **critical**
SyncEngine invariant (#3; failure: abort + cleanup, `:195`), and lists
"Resolving port ownership conflicts" as a Primary-reserved, non-delegable task
(`:185`). AGENTS.md forbids leaking infrastructure into inner layers. The
homonym cluster does not violate the single-ownership _invariant_ as the
SyncEngine computes it (the clashing declarations live in different packages'
own trees, each owning its copy) — but three of the copies are dead weight that
misleads readers, the manifest, and the arch-linter into believing a shared
contract exists. The decision below removes that misdirection without inventing
a shared owner.

## Decision

### 1. Delete dead port copies; do not cross-import (supersedes ADR-C1 option 1 for HEX-006/007)

The dead clusters are **deleted**, not re-homed onto a single published owner
and not imported across contexts. Concretely (landed in remediation item 4.1):

- Delete project-configuration's dead trio: `ReadManifestUseCase`,
  `ProjectConfigurationReadPort`, `FileSystemPort`, and `NodeFileSystemAdapter`.
- Delete sync's dead `ProjectConfigurationReadPort` copy and its
  test-only `GetManifestResourceUseCase` (or keep the use case only if a
  production consumer is wired — the scout's zero-consumers proof decides).

**No consumer package may add a workspace dependency on another context solely
to import that context's port type.** Cross-context port imports couple bounded
contexts through their internal contracts and defeat the point of the port
boundary; the candidate's "import the owner's published type" is refuted for
this cluster. If two contexts genuinely need the same behavior, that is a
shared-kernel decision (option 3 below), made explicitly — not an ad-hoc
import.

### 2. Keep a name-per-context homonym only when both contracts are live and disjoint (HEX-005)

`ManifestGenerationPort` stays declared in both `manifest-generation` (inbound
`execute`) and `mcp-server` (outbound generate-topology/adapters/pipeline)
because both are live and their method sets are disjoint — structural typing
makes cross-binding impossible. To remove reader ambiguity, **rename
mcp-server's homonym** to a context-specific name (e.g.
`ManifestGenerationOrchestrationPort`) as low-priority polish. This is a rename
within one package, not a cross-context import and not an ADR-blocking change.

### 3. Shared-kernel lift is the exception, taken only for truly generic operations

A port moves into `@hexagen/shared` **only** when its operations are
context-agnostic (per ADR-0005's shared-kernel migration doctrine). Manifest
read/merge and atomic-write are context-specific (they encode the manifest-merge
shape and the sync generator's atomic-write dialect respectively) and do **not**
qualify. No "kitchen-sink" shared `FileSystemPort` is created to satisfy
HEX-002/014 — see decision 4.

### 4. Application-layer I/O goes behind a context-owned driven port (HEX-002, HEX-014)

Each use case that performs external I/O gains a **driven (outbound) port owned
by its own context**, injected via the composition root, with an in-memory
double for tests:

- `project-generation` gets a write/mkdir port that
  `generate-project-use-case.ts` depends on instead of `node:fs/promises`
  (remediation item 5.1).
- `template-engine`'s `validate-templates.use-case.ts` drops direct `node:fs`
  for an injected read/write port (remediation item 5.6). The sibling
  `visualization` `ExportGraphImageUseCase` (HEX-015, also item 5.6) drops its
  direct DOM/fetch/html-to-image I/O behind an injected port under the same rule.

These filesystem ports are **per-context** (`GeneratorFsPort`, a template-engine
`TemplateFsPort`, etc.), not a single shared `FileSystemPort` — consistent with
decision 3 and with keeping sync's live `FileSystemPort` distinct.

## Consequences

- **Deletion, not renaming, closes HEX-006/007; rename (polish) closes HEX-005.**
  Item 4.1 removes the dead code (project-configuration's `ReadManifestUseCase` /
  `ProjectConfigurationReadPort` / `FileSystemPort` / `NodeFileSystemAdapter`
  and sync's dead `ProjectConfigurationReadPort` copy) with a scout-recorded
  zero-consumers proof (grep + typecheck + test), per the remediation-plan
  delegation rules. No cross-context workspace dependency is added; no manifest
  port-ownership conflict is created for the Primary to resolve.
- **The homonym count drops on its own terms.** After 4.1, the real-source
  homonyms are `SecretVaultPort` (handled by 5.4) and — until the mcp-server
  rename — `ManifestGenerationPort`. Re-running the tally command above is the
  acceptance check.
- **New driven ports are context-owned.** Because each context declares
  its own port, the SyncEngine `port-single-ownership` invariant holds by
  construction, and the arch-linter's layer rules (once ADR 0.8 lands) will
  flag any future direct `node:fs` import from an application/domain layer.
- **Generated projects inherit the doctrine, not a shared FS port.** The sync
  generator continues to emit per-context ports; it must **not** be changed to
  emit a shared `FileSystemPort`. Downstream scaffolds get the same rule: write
  I/O sits behind a context-owned driven port with an in-memory double.
- **What this ADR does not decide.** The `ports/in` vs `ports/out` misfiling of
  driven contracts (the `GenerateProjectPort` question, HEX-018) is ADR 0.2's
  scope. `SecretVaultPort` (HEX-008) is item 5.4. This ADR is limited to
  ownership/homonym doctrine and the driven-port authorization for
  HEX-002/014/015.
- **Refuted recommendation recorded.** "Import the owner's published port" is
  explicitly not adopted (per the audit and the plan's "explicitly dropped"
  list); the archived candidate ADR-C1 option (1) for HEX-005/006/007 is
  superseded by deletion. This is captured so the deletion in 4.1 is not later
  "corrected" back into a cross-context import.
