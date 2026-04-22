# ADR-0002: Sync Engine Structural Fixes

**Status:** Accepted  
**Date:** 2026-03-11  
**Authors:** Architecture Co-pilot, Human Architect  
**Supersedes:** None

---

## Context

The HexaGen Monaco sync engine (`@hexagen/sync`) had several structural bugs that caused:

1. **Barrel corruption** — Generated barrels contained invalid relative imports (`../shared/result.js`, `../shared/ok.js`) that pointed to non-existent paths
2. **Silent failures** — The preflight build step failed silently due to stdout buffer overflow
3. **Dry-run mutations** — The reaper deleted files even in `--dry-run` mode
4. **Root file overwrites** — `hexagen sync --force` could overwrite protected root files (`turbo.json`, `.gitignore`)
5. **Delete-recreate cycles** — The reaper deleted folders containing only `index.ts`, which the sync engine then recreated
6. **Incorrect tsconfig references** — Generated `tsconfig.json` files had wrong relative paths for project references
7. **Blocked development workflow** — Git clean check prevented sync during active development
8. **Incomplete type coverage** — The `Manifest` type didn't model the full manifest.yaml structure

These issues were discovered during a comprehensive structural integrity audit of the codebase.

---

## Decision

We implemented fixes in two phases:

## Phase A — Stop Barrel Corruption

### 1. Remove Broken Shared Kernel Re-exports

**Files:** `barrels.ts`, `stubs.ts`, `layer-folders.ts`

**Before:**

```typescript
exportLines.unshift(
  `export * from '../shared/result.js';`,
  `export * from '../shared/ok.js';`,
);
```

**After:** Removed entirely.

**Rationale:**

- The shared kernel is a package (`@hexagen/shared`), not a relative folder
- Re-exporting from another package violates the `barrel-ownership-boundary` invariant
- Each package should import from `@hexagen/shared` directly where needed

### 2. Fix Empty Barrel Handling

**Files:** `barrels.ts`, `stubs.ts`, `layer-folders.ts`

**Before:**

```typescript
const content = exportLines.length > 0 ? exportLines.join("\n") : "export {};";
```

**After:**

```typescript
const content =
  exportLines.length > 0
    ? `${GENERATED_MARKER}\n\n${exportLines.join("\n")}\n`
    : `${GENERATED_MARKER}\n\n// No exports yet\n`;
```

**Rationale:**

- `export {};` violates the `no-empty-stubs` invariant
- A comment is clearer and signals intent without creating a stub export

### 3. Add YAML Loading Safety Guard

**File:** `layer-folders.ts`

**Before:**

```typescript
async function loadYaml<T>(filePath: string): Promise<T> {
  const content = await fs.readFile(filePath, "utf8");
  return yaml.load(content) as T;
}
```

**After:**

```typescript
async function loadYamlSafe<T>(filePath: string): Promise<T | null> {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return yaml.load(content) as T;
  } catch (e: any) {
    if (e.code === "ENOENT") {
      return null;
    }
    throw e;
  }
}
```

**Rationale:**

- Graceful degradation when optional config files are missing
- Prevents sync from crashing in new or partially configured workspaces

### 4. Fix Preflight Build Buffer Overflow

**File:** `preflight.ts`

**Before:**

```typescript
const { stdout, stderr } = await execAsync("yarn turbo run build");
```

**After:**

```typescript
const MAX_BUFFER = 1024 * 1024 * 10; // 10MB

if (dryRun) {
  logger.info("Pre‑flight: skipping build in dry-run mode");
  return;
}

const { stdout, stderr } = await execAsync("yarn turbo run build", {
  maxBuffer: MAX_BUFFER,
});
```

**Rationale:**

- Turbo's verbose output exceeds Node's default 1MB buffer
- Dry-run mode should not require building (no files are written)

### 5. Fix Reaper Dry-Run and Deletion Logic

**File:** `reap.ts`

**Before:**

```typescript
const nonEmpty = entries.filter((e) => e !== "index.ts");
if (nonEmpty.length === 0) {
  await fs.rm(layerPath, { recursive: true, force: true });
}
```

**After:**

```typescript
if (entries.length === 0) {
  if (dryRun) {
    logger.info(`[DRY-RUN] would delete empty folder ${relativePath}`);
  } else {
    await fs.rm(layerPath, { recursive: true, force: true });
  }
}
```

**Rationale:**

- Dry-run must never mutate the filesystem
- Folders with `index.ts` are valid barrels maintained by the sync engine
- Deleting them creates a delete-recreate cycle

### 6. Root File Protection

**File:** `fs-utils.ts`

The `safeWriteFileAtomic` function was updated to require `--force-root` (not `--force`) to overwrite protected root files:

```typescript
if (isProtectedRoot(filePath, config) && !forceRoot) {
  logger.warn(`skipped (root protected, use --force-root) ${relativePath}`);
  return "protected";
}
```

The `ensureRootFiles()` method was removed from `sync-engine.ts` entirely — `turbo.json` and `.gitignore` are user-controlled files that the sync engine should never generate.

---

## Phase B — Fix Incorrect Generation

### 7. Fix tsconfig.json References Path

**File:** `tsconfig.ts`

**Before:**

```typescript
.map((name) => ({ path: `../packages/${name}/tsconfig.json` }));
```

**After:**

```typescript
.map((name) => ({ path: `../${name}/tsconfig.json` }));
```

**Rationale:**

- Packages are siblings in `packages/`, not nested under `packages/packages/`
- The path from `packages/foo` to `packages/bar` is `../bar`, not `../packages/bar`

### 8. Add `--allow-dirty` Flag

**Files:** `config.ts`, `sync-engine.ts`

**Before:**

```typescript
const { stdout: gitStatus } = await execAsync("git status --porcelain");
if (gitStatus && gitStatus.trim().length > 0) {
  throw new Error("Dirty git tree");
}
```

**After:**

```typescript
if (!allowDirty) {
  const { stdout: gitStatus } = await execAsync("git status --porcelain");
  if (gitStatus && gitStatus.trim().length > 0) {
    logger.error(
      "Git working tree is dirty. Commit or stash changes, or use --allow-dirty to proceed.",
    );
    throw new Error("Dirty git tree");
  }
} else {
  logger.warn("Skipping git clean check (--allow-dirty)");
}
```

**Rationale:**

- Developers iterating on sync changes need to test without committing every change
- The `--allow-dirty` flag is opt-in, preserving safety by default
- Error message now mentions the flag for discoverability

### 9. Expand Manifest Type Definitions

**File:** `types/manifest.ts`

**Before:** Minimal type with only `bounded_contexts[].name` and `packageJson`

**After:** Complete type definitions including:

```typescript
export interface BoundedContext {
  name: string;
  type?: BoundedContextType;
  description?: string;
  layers?: BoundedContextLayers;
  depends_on?: string[];
  driver_for?: string;
  wiring?: string[];
  generator?: BoundedContextGenerator;
  packageJson?: Record<string, unknown>;
}

export interface BoundedContextLayers {
  domain?: DomainLayer;
  application?: ApplicationLayer;
  infrastructure?: InfrastructureLayer;
}

export interface ApplicationLayer {
  use_cases?: string[];
  ports?: ApplicationPorts;
  factories?: string[];
}
```

Plus helper functions:

- `extractPorts()` — get in/out ports from a context
- `extractDependencies()` — get depends_on list
- `isSharedKernel()` / `isDriver()` — type guards

**Rationale:**

- Enables type-safe access to manifest data throughout the sync engine
- Supports future code generation from manifest (ports, entities, use cases)
- Documents the manifest schema in code

---

## Consequences

### Positive

- `hexagen sync --dry-run` is now safe and idempotent
- Barrels no longer contain invalid imports
- Protected root files cannot be accidentally overwritten
- Sync engine degrades gracefully when optional config is missing
- No more delete-recreate cycles for layer folders
- Developers can iterate on sync changes with `--allow-dirty`
- Full type coverage for manifest enables future code generation
- tsconfig references now resolve correctly

### Negative

- Existing barrels with `export {};` will be updated to use comments (one-time churn)
- Packages must explicitly import from `@hexagen/shared` (no implicit re-exports)

### Neutral

- The `--force-root` flag is required for intentional root file overwrites
- Empty folders are only deleted if truly empty (no `index.ts`)
- The `--allow-dirty` flag is available but not default

---

## Verification

All fixes were verified with:

```bash
yarn build        # 17 successful
yarn typecheck    # 21 successful
yarn lint         # 17 successful
hexagen sync --dry-run  # Completes without mutations
```

---

## Related

- `AGENTS.md` — Architectural invariants (`barrel-ownership-boundary`, `no-empty-stubs`)
- `.architecture/generator.config.yaml` — Invariant definitions
- `.architecture/manifest.yaml` — Bounded context definitions

---

## CLI Reference

After these changes, the sync engine supports:

| Flag            | Description                                             |
| --------------- | ------------------------------------------------------- |
| `--dry-run`     | Preview changes without writing files                   |
| `--force`       | Overwrite non-generated files in packages               |
| `--force-root`  | Overwrite protected root files (turbo.json, .gitignore) |
| `--allow-dirty` | Skip git clean check (for development)                  |
| `--strict`      | Fail on arch-linter warnings                            |
