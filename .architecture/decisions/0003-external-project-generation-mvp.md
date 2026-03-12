# ADR-0002: External Project Generation MVP

**Status:** Accepted  
**Date:** 2026-03-12  
**Authors:** Architecture Co-pilot, Human Architect  
**Supersedes:** None

---

## Context

The HexaGen Monaco system had strong self-regeneration capabilities (`yarn sync`), but no way to generate **new** projects from scratch. The goal was to enable:

1. **UI-driven generation** — A wizard in the web UI collects project specifications
2. **External target directory** — Generate projects to arbitrary locations (not just self)
3. **Zip download** — Return generated projects as downloadable zip files

This required extending the sync engine to support "external mode" and creating new ports/adapters in the `project-generation` package.

---

## Decision

We implemented external project generation in four phases:

---

## Phase 1 — SyncEngine External Mode

### 1. Add `mode` Flag to SyncFlags

**File:** `packages/sync/src/config.ts`

```typescript
export interface SyncFlags {
  // ... existing fields
  mode: "self-regen" | "external";
}
```

**Rationale:** Distinguishes between self-regeneration and external generation.

### 2. Add `options` Parameter to SyncEngine

**File:** `packages/sync/src/sync-engine.ts`

```typescript
export interface SyncEngineOptions {
  targetRoot?: string;
  manifest?: Manifest;
}

export class SyncEngine {
  constructor(flags: SyncFlags, options?: SyncEngineOptions) {
    // ...
  }
}
```

**Rationale:** Allows external callers to specify:

- `targetRoot` — where to write files (instead of auto-detecting)
- `manifest` — in-memory manifest (instead of reading from disk)

### 3. Conditional Skips in External Mode

**Files:** `packages/sync/src/sync-engine.ts`

External mode skips steps that don't apply to fresh projects:

| Step            | Self-Regen | External   |
| --------------- | ---------- | ---------- |
| Git dirty check | ✅ Runs    | ❌ Skipped |
| Preflight build | ✅ Runs    | ❌ Skipped |
| Reaper          | ✅ Runs    | ❌ Skipped |
| Arch-linter     | ✅ Runs    | ❌ Skipped |

**Rationale:** Fresh projects have no git repo, nothing to build, nothing to reap, and are valid by construction.

---

## Phase 2 — Project Generation Package

### 4. New Ports

**Files:** `packages/project-generation/src/application/ports/out/`

```typescript
// ExternalProjectGeneratorPort
export interface GeneratorError {
  code: "GENERATION_FAILED" | "MANIFEST_INVALID" | "FS_ERROR";
  message: string;
  cause?: unknown;
}

export interface ExternalProjectGeneratorPort {
  generateAt(
    targetRoot: string,
    manifest: Manifest,
  ): Promise<Result<Project, GeneratorError>>;
}

// ZipCreatorPort
export interface ZipCreatorPort {
  createZip(project: Project): Promise<Result<Buffer, ZipCreatorError>>;
}
```

**Rationale:**

- Ports return `Result<T, E>` per architectural constraints (§8)
- Error types include codes for programmatic handling

### 5. New Adapters

**Files:** `packages/project-generation/src/infrastructure/adapters/`

- `ExternalSyncEngineAdapter` — wraps SyncEngine, collects file tree
- `JsZipCreatorAdapter` — creates zip using jszip

### 6. GenerateProjectUseCase

**File:** `packages/project-generation/src/application/generate-project-use-case.ts`

Orchestrates generation + optional zip creation:

```typescript
export class GenerateProjectUseCase {
  async execute(input: {
    targetRoot: string;
    manifest: Manifest;
    outputFormat: "files" | "zip";
  }): Promise<Result<GenerateProjectOutput, Error>> {
    // 1. Generate project via adapter
    // 2. Create zip if requested
    // 3. Return result
  }
}
```

---

## Phase 3 — Code Quality Fixes

### 7. Fix Dependencies

**File:** `packages/project-generation/package.json`

Added missing dependencies:

- `@hexagen/sync` — for SyncEngine import
- `js-yaml` — for manifest serialization

### 8. Fix tsconfig References

**File:** `packages/project-generation/tsconfig.json`

Added reference to `../sync`.

### 9. Fix sync Exports

**File:** `packages/sync/package.json`

Changed exports to point to `index.js` (was incorrectly pointing to `cli.js`).

### 10. Clean Up Duplicate Directory

Removed `packages/sync/packages/` — a duplicate nested directory.

### 11. Code Quality Improvements

- Moved `options` declaration before constructor (sync-engine.ts)
- Added JSDoc for `mode` flag (config.ts)
- Made `Project.files` immutable via `ReadonlyMap` (project.ts)
- Added fallback for `crypto.randomUUID()` (external-sync-engine.adapter.ts)
- Improved error messages in adapters
- Added error logging in API route
- Removed throwing stub export

---

## Phase 4 — Test Infrastructure

### 12. Test Doubles

**Files:** `packages/project-generation/__tests__/doubles/`

- `InMemoryProjectGeneratorDouble` — implements `ExternalProjectGeneratorPort`
- `InMemoryZipCreatorDouble` — implements `ZipCreatorPort`

### 13. Unit Tests

**File:** `packages/project-generation/__tests__/application/generate-project-use-case.test.ts`

5 tests covering:

- Happy path (files format)
- Happy path (zip format)
- Generator failure propagation
- Zip failure propagation
- Project properties verification

---

## Consequences

### Positive

- External projects can be generated to any directory
- Self-regeneration continues to work unchanged (backward compatible)
- All ports follow `Result<T, E>` pattern (no silent error swallowing)
- Test infrastructure enables future test-driven development
- Project entity now supports file trees for zip creation

### Negative

- Turbopack cannot resolve `@hexagen/project-generation` in Next.js (blocked by `emitDeclarationOnly`)
- Integration tests for adapter blocked by same issue
- API route uses stub until Turbopack issue resolved

### Neutral

- New dependency on `jszip` added to project-generation
- Manifest now includes `mode` flag (documented as programmatic-only)

---

## Verification

All phases verified with:

```bash
yarn build        # 17 successful
yarn typecheck   # 22 successful
yarn lint        # 17 successful (pre-existing violations in other packages)
yarn test        # 5 tests passing
yarn sync --dry-run  # Self-regen still works
```

---

## Related

- `AGENTS.md` — Architectural constraints (Result pattern, test double parity)
- `.architecture/manifest.yaml` — project-generation bounded context
- `.architecture/generator.config.yaml` — port ownership registry
- ADR-0001 — Previous sync engine fixes

---

## Known Issues

| Issue                                      | Status | Resolution                                       |
| ------------------------------------------ | ------ | ------------------------------------------------ |
| Turbopack can't resolve project-generation | Open   | Change `emitDeclarationOnly` to emit `.js` files |
| Integration tests blocked                  | Open   | Same as above                                    |

---

## Files Changed

### Packages/sync/

- `src/config.ts` — added mode flag
- `src/sync-engine.ts` — added options, external mode support
- `package.json` — fixed exports map

### Packages/project-generation/

- `src/domain/entities/project.ts` — added files field, immutability
- `src/application/ports/out/external-project-generator.port.ts` — new port
- `src/application/ports/out/zip-creator.port.ts` — new port
- `src/application/generate-project-use-case.ts` — updated
- `src/infrastructure/adapters/external-sync-engine.adapter.ts` — new adapter
- `src/infrastructure/adapters/jszip-creator.adapter.ts` — new adapter
- `src/index.ts` — exports
- `package.json` — added dependencies
- `tsconfig.json` — added sync reference
- `__tests__/` — test doubles and unit tests

### Apps/web/

- `app/api/generate/route.ts` — stub with TODO (blocked by Turbopack)

### Architecture/

- `.architecture/manifest.yaml` — added ports and adapters

### Cleanup/

- Removed 20 duplicate files in `packages/sync/packages/`
