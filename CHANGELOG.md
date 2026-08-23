# Changelog

Release notes for the co-published `@hexagen-monaco/sync` and
`@hexagen-monaco/arch-linter` packages (they share one version, tagged `vX.Y.Z`).

**Release order:** merge the bump PR → tag the squash commit `vX.Y.Z` →
`publish.yml` runs on the tag → then deploy. `deploy.yml` refuses to ship
`main` while the version in `packages/sync/package.json` is absent from npm
(F1 preflight, #432): a merged bump blocks deploys until it is published. That
is the guard working, not a fault to bypass.

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
