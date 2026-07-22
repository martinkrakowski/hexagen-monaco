# Changelog

Release notes for the co-published `@hexagen-monaco/sync` and
`@hexagen-monaco/arch-linter` packages (they share one version, tagged `vX.Y.Z`).

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
