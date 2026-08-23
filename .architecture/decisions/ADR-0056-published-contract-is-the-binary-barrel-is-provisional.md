# ADR-0056: The Published Contract Is the Binary; the Root Barrel Is Provisional Under 0.x

**Date:** 2026-08-16
**Status:** Proposed
**Type:** Release / Public API
**Relates to:** ADR-0068 (published-CLI bundling — establishes that the shipped artifact is a self-contained `dist` per entry point), ADR-0052 (published `engines.node` tracks the toolchain floor — the change this ADR's minor-version rule had to fence), ADR-0054 (arch-lint enforcement posture — the source of the three new rule classes in the same release)

> This decision is referred to as **D6** in
> `docs/planning/2026-08-16-decision-dossier-and-remediation-followups.md` (§1.3),
> and closes remediation item **4.7**. That document records the investigation;
> this ADR records the decision it produced.

## Context

`@hexagen-monaco/sync` and `@hexagen-monaco/arch-linter` are co-published at one
version and consumed by every project the generator scaffolds. Remediation item
4.7 (from AUD-013) asked for a narrower public surface: `InMemoryConfigDouble` —
a **test double** — plus the `yaml-config` adapter and raw `fs-utils` were all
re-exported from `packages/sync/src/index.ts`. The item's primary proposal was a
`/testing` subpath for the double; unexporting was filed as the fallback.

Two findings inverted that ordering and set the release shape.

**1. The barrel is not the contract — the binary is.** Four checks, all run
against the tree at `af077ebd`:

- **Generated projects do not import the package.** No template under
  `packages/template-engine/templates/` and no generator emission references
  `@hexagen-monaco/sync` as an import specifier. The only emission that names
  the published scope at all is `root-file-templates.ts`, which writes
  `"@hexagen-monaco/sync": "^{toolchainVersion}"` and the matching arch-linter
  line into the scaffold's **devDependencies** — a tool pin, not an import.
  `__tests__/generators/namespacing.test.ts` already enforces exactly this:
  a tooling scope may appear in emitted files _only_ in that allowlisted
  devDependency position.
- **The contract fixture exercises `dist/cli.js`.** `__tests__/helpers/published-layout.ts`
  stages a physical copy of the built `dist` at
  `<fixture>/node_modules/@hexagen-monaco/sync/dist/` and spawns `dist/cli.js`
  from it; the four sibling contract suites (exit codes, dry-run purity,
  check-drift, toolchain version) all run through that helper. Every pinned
  behaviour of this package is pinned **through the binary**. Nothing pinned the
  barrel.
- **One import of the published name exists in the whole repo**, at
  `packages/sync/README.md:63`.
- **That import is of a function that has never existed.** The README's
  "Programmatic Usage" section reads
  `import { runSync } from "@hexagen-monaco/sync"`. `git log -S` over
  `packages/sync/src` across all refs returns no commit that ever introduced a
  `runSync` export. The package's only documented programmatic entry point was
  fictional, and no one noticed — which is itself the measurement.

All four held. A `/testing` subpath would therefore have been a second published
entry point, maintained across every future release, for **zero** callers. The
fallback is the better primary.

**2. The type-only removals are the smallest thing in the release.** Between
published `0.9.0` (git tag `v0.9.0`) and `main`, the consumer-visible changes are
manifest-level:

|                    | 0.9.0 (published)                | `main`                                       |
| ------------------ | -------------------------------- | -------------------------------------------- |
| `engines.node`     | `>=20`                           | `>=22.7.0` — **drops Node 20** (ADR-0052)    |
| `ts-morph` (sync)  | `^22.0.0` (bundles TS **5.4.2**) | `^27.0.2` (bundles TS **5.9.2**) — a major   |
| arch-linter rules  | —                                | **3 new classes** (ADR-0054 §2 layer purity) |
| `hexagen-lint` bin | `dist/index.js`                  | `dist/cli.js`                                |

Generated projects pin `^<engine version>`. Under 0.x, `^0.9.0` resolves
`>=0.9.0 <0.10.0` — so **a patch release would auto-adopt all of the above**
into every already-generated project on its next install: a Node-20 project
would start warning `EBADENGINE`, and a project that passed
`hexagen-lint` yesterday could fail its `architectural-integrity` CI check
today, having changed nothing. The minor is the only fence 0.x offers.

## Decision

**1. The supported contract of `@hexagen-monaco/sync` is the `hexagen` binary**
(`dist/cli.js`), and of `@hexagen-monaco/arch-linter` the `hexagen-lint` binary.
CLI commands, flags, exit codes and on-disk effects are the surface this project
commits to. That is the surface the contract suites pin, and the only surface a
generated project touches.

**2. The root barrel is PROVISIONAL under 0.x.** It is exported because the
monorepo's own packages need it — `project-generation` constructs `SyncEngine`,
and both `arch-linter` and `project-generation` import the `Manifest` type — not
because it is a product. External programmatic use is permitted and unsupported.
This is stated in `packages/sync/README.md` so the position is visible where a
consumer would look, rather than only here.

**3. A removal from the barrel rides a MINOR, never a patch.** Under 0.x a caret
range is minor-fenced and nothing else is, so the minor is the only signal
available. This applies to any narrowing of the exported set — a removed name, a
value demoted to type-only, a widened parameter type — not only to deletions.

**4. A removal must be named, individually, in that release's `CHANGELOG.md`
section.** "Trimmed the public barrel" is not a changelog entry; the names are.
A consumer's failure is `has no exported member 'X'`, and `X` is what they will
search the changelog for.

**5. Additions are not free either.** Adding a name widens a surface the project
then has to keep working across the rest of the 0.x line. It is not breaking and
needs no version fence, but it is a decision, not a refactor.

**6. The rule is enforced by a snapshot, not by review.**
`packages/sync/__tests__/contract/public-surface.contract.test.ts` asserts the
full set of names reachable from `src/index.ts`. It reads the declarations
statically with `ts-morph` (already a runtime dependency) rather than importing
the module, because a runtime `import *` sees only value exports — every
type-only export, including `Manifest` and `SyncConfig`, would be erased before
the test could observe it, and those are the names external consumers import
most. On drift the failure names each moved export and restates rules 3 and 4.

## Consequences

- **0.10.0 withdraws eight names** from the root barrel: `InMemoryConfigDouble`,
  `YamlConfigAdapter`, and the six `fs-utils` exports (`protectedFiles`,
  `isGeneratedFile`, `isProtectedRoot`, `isInScope`, `safeWriteFileAtomic`,
  `safeWriteFile`). Each is named in the 0.10.0 changelog section. The modules
  are untouched — they remain importable by module path inside `packages/sync`,
  and their existing test suites (`__tests__/fs-utils.test.ts`,
  `__tests__/infrastructure/adapters/yaml-config-adapter.test.ts`) already import
  them that way, so nothing in the repo changed shape.
- **In-repo consumer count for the withdrawn names: zero**, verified by grep
  before removal — `InMemoryConfigDouble` had no reference outside its own
  declaration anywhere in the repo, `YamlConfigAdapter` only its own test, and
  every `fs-utils` caller uses a relative `../fs-utils.js` path.
- **No `/testing` subpath is built.** If a real caller for the double ever
  appears, this decision is revisited then, with a caller to design against.
- **`packages/sync/README.md`'s programmatic example is corrected** from the
  fictional `runSync` to the `SyncEngine` construction that the in-repo consumer
  (`project-generation`'s `ExternalSyncEngineAdapter`) actually uses, and carries
  the provisional-surface notice.
- **Consumers on Node 20 are pinned to 0.9.x.** That is the intended effect of
  the fence, not a regression; ADR-0052 accepted the floor, and this ADR only
  decides how it reaches consumers.
- **The bill comes due at 1.0.** This ADR buys 0.x the freedom to shrink the
  barrel cheaply. At 1.0 the same removals become majors, so the set should be
  deliberately small by then — which is what the snapshot's "additions are not
  free" clause is defending.
- **Publishing stays human-gated.** This ADR governs _how_ a release is shaped,
  never _when_ one happens. Cutting the `v0.10.0` tag — which triggers the npm
  co-publish — remains a separate, explicitly approved step.

## Alternatives considered

- **A `/testing` subpath export for `InMemoryConfigDouble` (item 4.7's primary).**
  Rejected: a permanent second entry point, its own `exports` map key, its own
  build target and its own contract surface, for zero known callers. If the
  double is worth publishing, that case can be made when someone needs it.
- **Ship the removals as a patch.** Rejected: under 0.x a patch is inside every
  generated project's caret range, so it would carry the Node-20 drop, the
  ts-morph major and three new linter rule classes into those projects silently.
  The removals are the _smallest_ thing in this release; the release could not
  be a patch regardless of them.
- **Cut 1.0.0 instead.** Rejected as premature: 1.0 asserts the barrel is
  stable, which is exactly what this ADR declines to assert while the surface is
  still being trimmed.
- **Leave the barrel alone and document it as unsupported.** Rejected: a shipped
  test double is an invitation regardless of documentation, and the surface only
  gets more expensive to narrow the longer it ships.
