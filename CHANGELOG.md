# Changelog

Release notes for the co-published `@hexagen-monaco/sync` and
`@hexagen-monaco/arch-linter` packages (they share one version, tagged `vX.Y.Z`).

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
