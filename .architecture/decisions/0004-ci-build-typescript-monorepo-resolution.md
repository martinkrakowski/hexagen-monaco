# ADR-0004: CI Build and TypeScript Monorepo Resolution

**Status:** Accepted  
**Date:** 2026-03-12  
**Authors:** Martin Krakowski, Claude (AI pair programmer)  
**Supersedes:** None  
**Related:** ADR-0002 (Sync Engine Structural Fixes)

## Context

The CI pipeline was failing with multiple TypeScript and Next.js build errors that did not reproduce locally. Investigation revealed fundamental differences between local development environments (with cached `dist/` folders from previous builds) and CI environments (clean slate).

### Symptoms Observed

1. **Next.js Turbopack errors**: `We couldn't find the Next.js package (next/package.json) from the project directory`
2. **TypeScript TS6059/TS6307 errors**: `File 'packages/X/src/...' is not under 'rootDir'`
3. **Module not found errors**: `Cannot find module '@hexagen/shared'`
4. **Missing CLI output**: `packages/sync/dist/cli.js not found`

### Root Cause Analysis

The root cause was **TypeScript path resolution behavior differences** between local and CI:

- **Locally**: `dist/` folders exist from previous builds. When TypeScript resolves `@hexagen/shared`, Node module resolution finds the compiled output via `package.json` exports.
- **In CI**: No `dist/` folders exist. The `paths` mapping in `tsconfig.base.json` resolves `@hexagen/shared` to `packages/shared/src/index.ts`, causing TypeScript to try including source files from other packages in the compilation, violating `rootDir` constraints.

## Decision

We implemented the following changes to ensure consistent builds across local and CI environments:

### 1. Override `paths` in Package TSConfigs

Each package's `tsconfig.json` now includes:

```json
{
  "compilerOptions": {
    "paths": {}
  }
}
```

**Rationale:** This prevents packages from inheriting the `paths` mapping from `tsconfig.base.json`. TypeScript falls back to Node module resolution, which correctly uses `package.json` exports to resolve workspace dependencies.

**Trade-off:** The `paths` in `tsconfig.base.json` are retained for IDE support and the Next.js web app, which benefits from source-level resolution during development.

### 2. Use Webpack for Next.js Production Builds

Changed `apps/web/package.json`:

```json
{
  "scripts": {
    "build": "next build --webpack"
  }
}
```

**Rationale:** Next.js 16's Turbopack has a bug where it ignores `turbopack.root` in certain CI environments. Webpack, with proper configuration, handles monorepo resolution correctly.

**Trade-off:** Slightly slower builds, but consistent behavior. Turbopack is still used for `next dev` (local development).

### 3. Explicit Workspace Dependencies

All cross-package imports must have corresponding entries in `package.json` dependencies:

```json
{
  "dependencies": {
    "@hexagen/shared": "workspace:*"
  }
}
```

**Rationale:** With `paths: {}`, TypeScript uses Node module resolution, which requires explicit dependency declarations. This also makes the dependency graph explicit and auditable.

### 4. Special Handling for Sync Package

The `sync` package requires `emitDeclarationOnly: false` to produce JavaScript files for the CLI. The tsconfig generator now skips this package:

```typescript
if (moduleName === "sync") {
  result.skipped.push(filePath);
  return result;
}
```

**Rationale:** The sync package is a CLI tool that must emit JavaScript, unlike other packages that only emit declarations (the bundler handles JS emission for libraries).

### 5. Prohibit Cross-Package Source Imports

Bad pattern (causes CI failures):

```typescript
import { Result } from "../../../../sync/src/domain/result.js";
```

Correct pattern:

```typescript
import { Result } from "@hexagen/shared";
```

**Rationale:** Relative imports that reach into other packages' `src/` directories bypass the module system and fail in CI where those source files aren't part of the compilation.

## Consequences

### Positive

- **Reproducible builds**: CI and local builds now behave identically
- **Explicit dependencies**: The dependency graph is clear from `package.json` files
- **Faster CI debugging**: Errors are consistent and reproducible locally with `rm -rf packages/*/dist && yarn build`
- **IDE support preserved**: `tsconfig.base.json` paths still work for editor intelligence

### Negative

- **Additional configuration**: Each package needs `"paths": {}` in its tsconfig
- **Sync generator complexity**: Must skip special packages like `sync`
- **Webpack overhead**: Production builds are slightly slower than Turbopack

### Neutral

- **No runtime impact**: These are purely build-time changes
- **Migration path**: If Turbopack fixes the monorepo root detection bug, we can switch back

## Verification

To verify the fix works, simulate CI locally:

```bash
rm -rf packages/*/dist .turbo node_modules/.cache
find . -name "*.tsbuildinfo" -delete
yarn turbo run build --force
hexagen sync --force --allow-dirty
yarn turbo run build --force
```

All three commands must pass for CI to succeed.

## References

- [Next.js Turbopack root configuration](https://nextjs.org/docs/app/api-reference/config/next-config-js/turbopack#root-directory)
- [TypeScript Project References](https://www.typescriptlang.org/docs/handbook/project-references.html)
- [Yarn Workspaces](https://yarnpkg.com/features/workspaces)
