# ADR-0001: Sync Engine Structural Fixes

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
4. **Root file overwrites** — `yarn sync --force` could overwrite protected root files (`turbo.json`, `.gitignore`)
5. **Delete-recreate cycles** — The reaper deleted folders containing only `index.ts`, which the sync engine then recreated

These issues were discovered during a comprehensive structural integrity audit of the codebase.

---

## Decision

We implemented the following fixes across the sync engine:

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
const content = exportLines.length > 0
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

### 6. Root File Protection (Previously Applied)

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

## Consequences

### Positive

- `yarn sync --dry-run` is now safe and idempotent
- Barrels no longer contain invalid imports
- Protected root files cannot be accidentally overwritten
- Sync engine degrades gracefully when optional config is missing
- No more delete-recreate cycles for layer folders

### Negative

- Existing barrels with `export {};` will be updated to use comments (one-time churn)
- Packages must explicitly import from `@hexagen/shared` (no implicit re-exports)

### Neutral

- The `--force-root` flag is required for intentional root file overwrites
- Empty folders are only deleted if truly empty (no `index.ts`)

---

## Verification

All fixes were verified with:

```bash
yarn build        # 17 successful
yarn typecheck    # 21 successful
yarn lint         # 17 successful
yarn sync --dry-run  # Completes without mutations
```

---

## Related

- `AGENTS.md` — Architectural invariants (`barrel-ownership-boundary`, `no-empty-stubs`)
- `.architecture/generator.config.yaml` — Invariant definitions
- `.architecture/manifest.yaml` — Bounded context definitions

---

## Open Items

The following issues remain for Phase B:

1. `tsconfig.ts` — References path uses wrong relative path (`../packages/${name}` vs `../${name}`)
2. `sync-engine.ts` — Git clean check blocks sync during development (needs `--allow-dirty` flag)
3. `types/manifest.ts` — Missing type definitions for `ports`, `entities`, `use_cases`, `adapters`
