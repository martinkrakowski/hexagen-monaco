# `.architecture/` — Architecture Governance Directory

This directory is the **single source of truth** for the architectural shape of the HexaGen Monaco monorepo. It governs code generation, boundary enforcement, and structural validation.

> **Warning:** Some files in this directory are auto-managed. See [File Ownership](#file-ownership) below.

---

## Table of Contents

- [Overview](#overview)
- [Directory Structure](#directory-structure)
- [File Ownership](#file-ownership)
- [manifest.yaml](#manifestyaml)
- [generator.config.yaml](#generatorconfigyaml)
- [Invariants](#invariants)
- [Architecture Decision Records](#architecture-decision-records)
- [Commands](#commands)
- [Troubleshooting](#troubleshooting)

- [Barrel Generation](#barrel-generation)
- [Shared Kernel Guidelines](#shared-kernel-guidelines)

---

## Overview

HexaGen Monaco treats architecture as **executable data**. Instead of relying on convention and code review to enforce boundaries, the system:

1. **Declares** architecture in `manifest.yaml` (bounded contexts, ports, use cases)
2. **Generates** package skeletons, barrels, and configuration via `npx hexagen sync`
3. **Validates** boundaries at build time via the arch-linter
4. **Enforces** invariants through the bootstrap sequence

This approach shifts coordination complexity from engineers to deterministic tooling.

---

## Directory Structure

```
.architecture/
├── README.md                  # This file
├── manifest.yaml              # Bounded contexts, ports, entities, use cases
├── generator.config.yaml      # Runtime state (auto-managed, DO NOT EDIT)
├── decisions/                 # Architecture Decision Records (ADRs)
│   ├── 0001-persistence-wiring.md
│   ├── 0002-sync-engine-structural-fixes.md
│   ├── 0003-external-project-generation-mvp.md
│   └── 0004-ci-build-typescript-monorepo-resolution.md
└── invariants/                # Boundary rules and linter configuration
    ├── layer-rules.yaml       # Layer dependency constraints
    └── linter-config.yaml     # Arch-linter package rules
```

---

## File Ownership

| File                    | Owner      | Editable?                            |
| ----------------------- | ---------- | ------------------------------------ |
| `manifest.yaml`         | Human      | ✅ Yes — edit to define architecture |
| `generator.config.yaml` | SyncEngine | ❌ No — auto-managed                 |
| `decisions/*.md`        | Human      | ✅ Yes — add new ADRs                |
| `invariants/*.yaml`     | Human      | ✅ Yes — configure rules             |
| `README.md`             | Human      | ✅ Yes                               |

**Never edit `generator.config.yaml` directly.** It contains runtime state (port ownership registry, bootstrap sequence) that is auto-updated by the sync engine.

---

## manifest.yaml

The manifest defines the **domain architecture** of the generated monorepo:

```yaml
system: hexagen-monaco
scope: hexagen
architecture: modular-monolith

bounded_contexts:
  - name: project-configuration
    type: core
    description: Governance core — manifest parsing, validation
    layers:
      domain:
        entities: [ProjectSpec, BoundedContext, Port]
      application:
        use_cases: [GenerateProjectUseCase, ValidateSpecUseCase]
        ports:
          in: [ValidateSpecPort, GenerateProjectPort]
          out: [ProjectGeneratorPort]
      infrastructure:
        adapters: []

apps:
  - name: web
    driver: next.js
    depends_on: [shared, project-configuration]
```

### Key Sections

| Section            | Purpose                                                  |
| ------------------ | -------------------------------------------------------- |
| `bounded_contexts` | Core domain modules in `packages/`                       |
| `apps`             | Application drivers in `apps/`                           |
| `monorepo`         | Workspace configuration (package manager, build tool)    |
| `generator`        | Sync engine settings (protected files, merge strategies) |

### After Editing

Always run after modifying `manifest.yaml`:

```bash
hexagen sync --allow-dirty    # Regenerate packages
yarn build                 # Verify compilation
yarn typecheck             # Verify types
```

---

## generator.config.yaml

**DO NOT EDIT** — This file is auto-managed by the sync engine.

It contains:

### Invariants

Nine structural rules enforced during generation:

| #   | Invariant                   | Priority | Description                              |
| --- | --------------------------- | -------- | ---------------------------------------- |
| 1   | `composite-safety`          | critical | tsconfig.json must contain `"paths": {}` |
| 2   | `barrel-ownership-boundary` | critical | No cross-package re-exports              |
| 3   | `port-single-ownership`     | critical | Each port belongs to one context         |
| 4   | `dependency-consistency`    | high     | Imports match package.json               |
| 5   | `self-import-prevention`    | high     | No self-imports by package name          |
| 6   | `signature-synchronization` | high     | Consumers derive from canonical ports    |
| 7   | `no-empty-stubs`            | medium   | No `export {}` barrels                   |
| 8   | `exports-field-mandatory`   | medium   | Complete exports map in package.json     |
| 9   | `test-double-parity`        | medium   | Test doubles match port interfaces       |

### Bootstrap Sequence

Steps executed during `npx hexagen sync`:

```
1. load-ownership-map              # memory-only
2. validate-port-ownership-map     # memory-only
3. generate-package-skeleton       # disk write
4. enforce-tsconfig-paths-override # patch tsconfig
5. generate-exports-field          # patch package.json
6. synchronize-signatures          # derive from ports
7. validate-barrel-chain           # check exports
8. enforce-dependency-consistency  # check imports
9. final-composite-reference-check # dist only
```

### Port Ownership Registry

Maps each port to its owning bounded context:

```yaml
ownership-registry:
  ports:
    MonacoPersistencePort: monaco-orchestration
    ValidateSpecPort: project-configuration
    IntentBusPort: messaging
```

This prevents duplicate port declarations across packages.

---

## Invariants

### `invariants/layer-rules.yaml`

Defines the hexagonal layer dependency constraints:

```yaml
layers:
  domain:
    allowed_imports: ["@hexagen/shared"]

  application:
    allowed_imports: ["domain", "@hexagen/shared"]

  infrastructure:
    allowed_imports: ["domain", "application", "@hexagen/shared"]
```

**Rule:** Domain never imports infrastructure or application. Application never imports infrastructure.

### `invariants/linter-config.yaml`

Configures the arch-linter:

```yaml
global_whitelist:
  - "@hexagen/shared"

package_rules:
  - name: "web-driver"
    restricted_to:
      - "@hexagen/shared"
```

---

## Architecture Decision Records

ADRs document significant architectural decisions. Located in `decisions/`.

### Current ADRs

| ADR  | Title                                     | Status   |
| ---- | ----------------------------------------- | -------- |
| 0000 | Next.js with Webpack over Vite            | Accepted |
| 0001 | Persistence Wiring                        | Accepted |
| 0002 | Sync Engine Structural Fixes              | Accepted |
| 0003 | External Project Generation MVP           | Accepted |
| 0004 | CI Build & TypeScript Monorepo Resolution | Accepted |
| 0005 | Shared Kernel Type Migration              | Accepted |

### ADR Format

```markdown
# ADR-NNNN: Title

**Status:** Proposed | Accepted | Deprecated | Superseded
**Date:** YYYY-MM-DD
**Authors:** Names

## Context

Why is this decision needed?

## Decision

What was decided?

## Consequences

What are the positive, negative, and neutral outcomes?
```

### Creating a New ADR

1. Create `decisions/NNNN-title.md` (next sequential number)
2. Use the format above
3. Set status to `Proposed`
4. After team review, update to `Accepted`

---

## Commands

### Sync Engine

```bash
# Regenerate all packages from manifest
hexagen sync

# Preview changes without writing
hexagen sync --dry-run

# Force overwrite non-generated files
hexagen sync --force

# Allow sync with uncommitted changes
hexagen sync --allow-dirty

# Overwrite protected root files (turbo.json, .gitignore)
hexagen sync --force-root

# Fail on arch-linter warnings
hexagen sync --strict
```

### Validation

```bash
# Run arch-linter standalone
yarn lint:arch

# Full validation suite
yarn build && yarn typecheck && yarn lint
```

### After Manifest Changes

```bash
# Recommended workflow
hexagen sync --allow-dirty
yarn build
yarn typecheck
```

### Manage Architecture Manifest

```bash
# List bounded contexts
hexagen arch list

# Validate manifest against rules
hexagen arch validate

# Scaffold a new port interactively
hexagen arch port

# Add a new bounded context interactively
hexagen arch context

# Remove a port from a context
hexagen arch remove port

# Remove a bounded context
hexagen arch remove context

# Show manifest changes (current vs git HEAD)
hexagen arch diff

# Compare against specific file
hexagen arch diff --file proposed.yaml
```

---

## Troubleshooting

### TS6059: File not under 'rootDir'

**Cause:** TypeScript is resolving `@hexagen/*` imports to source files instead of `dist/`.

**Fix:** Ensure the package's `tsconfig.json` contains:

```json
{
  "compilerOptions": {
    "paths": {}
  }
}
```

This overrides inherited path mappings and forces Node module resolution.

See: [ADR-0004](decisions/0004-ci-build-typescript-monorepo-resolution.md)

---

### TS2307: Cannot find module '@hexagen/X'

**Cause:** Missing dependency in `package.json`.

**Fix:** Add the dependency:

```json
{
  "dependencies": {
    "@hexagen/shared": "workspace:*"
  }
}
```

Then run `yarn install`.

---

### Arch-linter: Boundary Violation

**Cause:** Package imports from another module that isn't `@hexagen/shared`.

**Fix:** Either:

1. Move the shared type to `@hexagen/shared`
2. Define a port interface and implement an adapter
3. Update `invariants/linter-config.yaml` if the import is intentional

---

### Sync overwrites my changes

**Cause:** File is in a generated location.

**Fix:**

- For package files: Mark with `// @generated` comment to skip
- For root files: Use `--force-root` flag only when intentional
- For custom code: Place in `src/` subdirectories not managed by sync

---

### Build passes locally, fails in CI

**Cause:** Local machine has cached `dist/` folders from previous builds.

**Fix:** Simulate CI locally:

```bash
rm -rf packages/*/dist .turbo node_modules/.cache
find . -name "*.tsbuildinfo" -delete
yarn build
```

See: [ADR-0004](decisions/0004-ci-build-typescript-monorepo-resolution.md)

---

## Barrel Generation

The sync engine automatically generates barrel files (`index.ts`) for each layer in every package. Understanding how this works helps avoid common issues.

### How It Works

1. **Recursive traversal** — The generator walks `src/{layer}/` directories depth-first
2. **Exports all `.ts` files** — Each TypeScript file (except `index.ts`) gets an export
3. **Exports subdirectories** — Directories with their own `index.ts` are exported as modules
4. **Preserves hand-written barrels** — Files without the `@generated` marker are never overwritten

### Generated Barrel Format

```typescript
// @generated by @hexagen/sync

export * from "./entity-name.js";
export * from "./subdirectory/index.js";
```

### When Barrels Are Regenerated

- Running `npx hexagen sync` regenerates all barrels marked with `@generated`
- New files are automatically added to the appropriate barrel
- Deleted files are automatically removed from barrels

### Preserving Manual Exports

If you need custom export logic, remove the `@generated` marker:

```typescript
// Custom barrel - sync will not overwrite this file

export * from "./public-api.js";
// Internal types intentionally not exported
```

### Troubleshooting Barrel Issues

| Issue                       | Cause                             | Fix                               |
| --------------------------- | --------------------------------- | --------------------------------- |
| New file not exported       | Barrel not regenerated            | Run `npx hexagen sync`            |
| Export of `.d.js` (invalid) | `.d.ts` files in `src/`           | Delete stale `.d.ts` artifacts    |
| Circular export error       | A re-exports B which re-exports A | Restructure to break cycle        |
| "Not a module" error        | Empty barrel with `export {}`     | Add real exports or delete barrel |

---

## Shared Kernel Guidelines

The `@hexagen/shared` package is the **shared kernel** — types that multiple bounded contexts need to communicate.

### When to Add Types to Shared

Add a type to `@hexagen/shared` when:

| Condition                                    | Example                                                                 |
| -------------------------------------------- | ----------------------------------------------------------------------- |
| Multiple bounded contexts need the same type | `MonacoSession` used by `monaco-orchestration` and `web-driver`         |
| A driver needs to implement a port           | `MonacoPersistencePort` implemented by `LocalStoragePersistenceAdapter` |
| The type is part of a cross-context contract | `Result<T, E>`, `PersistenceError`                                      |

### When NOT to Add Types to Shared

Keep types in their owning package when:

| Condition                              | Example                                            |
| -------------------------------------- | -------------------------------------------------- |
| Only one context uses the type         | `WizardStep` (only used in `wizard-orchestration`) |
| It's an internal implementation detail | `YamlParserOptions` (internal to `sync`)           |
| It's a context-specific value object   | `EditorTheme` (internal to `monaco-orchestration`) |

### Adding a New Shared Type

1. Create the type in the appropriate layer:
   - Domain types → `packages/shared/src/domain/`
   - Ports → `packages/shared/src/application/ports/`
   - Errors → `packages/shared/src/errors/`

2. Run `npx hexagen sync` to regenerate barrels

3. Export from root barrel (`packages/shared/src/index.ts`) if needed

4. Update the original location to re-export (for backward compatibility):

   ```typescript
   // Re-export from @hexagen/shared for backward compatibility
   export { MyType } from "@hexagen/shared";
   ```

5. Update consumers to import from `@hexagen/shared`

### Related ADR

See [ADR-0005: Shared Kernel Type Migration](decisions/0005-shared-kernel-type-migration.md) for the rationale behind moving types to the shared kernel.

---

## Further Reading

- [AGENTS.md](../AGENTS.md) — Full architectural constraints and operating modes
- [README.md](../README.md) — Project overview
- [packages/sync/](../packages/sync/) — Sync engine implementation
- [tools/arch-linter/](../tools/arch-linter/) — Architectural linter implementation
