# ADR-0000: Next.js with Webpack over Vite

**Status:** Accepted  
**Date:** 2026-01-15 (retroactive)  
**Deciders:** Architecture team  
**Supersedes:** None

## Context

When bootstrapping the HexaGen Monaco project, we needed to choose a build toolchain for the web application. The primary candidates were:

1. **Next.js** (with Webpack or Turbopack)
2. **Vite** (with React plugin)

Both are mature, well-supported options with active communities. This decision has significant implications for:

- Developer experience (dev server speed, HMR)
- Production capabilities (SSR, static generation, API routes)
- Monorepo integration (workspace package resolution)
- Long-term maintainability

## Decision

We chose **Next.js with Webpack** as the build toolchain for the web application.

### Why Next.js

| Capability                      | Next.js                       | Vite                        |
| ------------------------------- | ----------------------------- | --------------------------- |
| Server-Side Rendering           | ✅ Built-in (App Router)      | ⚠️ Manual setup required    |
| React Server Components         | ✅ Full support               | ❌ Not supported            |
| API Routes                      | ✅ Built-in (`/api/*`)        | ❌ Requires separate server |
| Static Generation               | ✅ Automatic optimization     | ⚠️ Plugin-based             |
| Image Optimization              | ✅ `next/image`               | ❌ Manual or plugin         |
| Edge Middleware                 | ✅ Built-in                   | ❌ Not available            |
| Incremental Static Regeneration | ✅ Built-in                   | ❌ Not available            |
| Deployment                      | ✅ Vercel-optimized, portable | ✅ Portable                 |

Next.js provides a comprehensive full-stack framework, while Vite is primarily a build tool that requires additional libraries for equivalent functionality.

### Why Webpack over Turbopack

Next.js offers two bundlers:

- **Turbopack** — Rust-based, faster dev server, newer
- **Webpack** — Mature, extensive plugin ecosystem, slower but reliable

We use Webpack because our monorepo requires `extensionAlias` for ESM resolution:

```javascript
// next.config.mjs
config.resolve.extensionAlias = {
  ".js": [".ts", ".tsx", ".js"],
  ".mjs": [".mts", ".mjs"],
};
```

**Why we need this:**

1. The `@hexagen/sync` package is a CLI tool that runs directly in Node.js
2. It uses `NodeNext` module resolution, which **requires** explicit `.js` extensions
3. Barrel files across all packages use `.js` extensions for consistency
4. When webpack sees `import './model/index.js'`, the `extensionAlias` tells it to resolve `index.ts` first

**Turbopack limitation:** As of March 2026, Turbopack does not support `extensionAlias`. It would fail to resolve `.js` imports to `.ts` source files.

## Alternatives Considered

### Vite

**Pros:**

- Faster dev server (native ESM, esbuild)
- Simpler configuration for SPAs
- Growing ecosystem
- Native `.js` → `.ts` resolution without workarounds

**Cons:**

- No React Server Components support
- No built-in API routes (would need Fastify/Express/Nitro)
- No built-in SSR streaming
- No Edge middleware
- Less mature for large production applications
- Migration would require significant rewrites

**Verdict:** The features we'd lose (RSC, API routes, SSR) outweigh the dev server speed benefits.

### Turbopack (Future)

**Pros:**

- 10x faster than Webpack in benchmarks
- Native to Next.js
- Incremental compilation

**Cons:**

- Missing `extensionAlias` support (blocking issue)
- Still maturing feature set

**Verdict:** Revisit when Turbopack adds `extensionAlias` support. Tracked in Appendix: Open Items of AGENTS.md.

### Extensionless Imports

We considered removing `.js` extensions from barrels:

```typescript
// Instead of:
export * from "./model/index.js";

// Use:
export * from "./model/index";
```

**Cons:**

- Breaks `@hexagen/sync` package which requires `NodeNext` resolution
- Would require splitting sync into a separate repository
- Inconsistent with ESM specification

**Verdict:** Not worth the architectural disruption.

## Consequences

### Positive

- ✅ Full access to Next.js App Router features (RSC, streaming SSR)
- ✅ Built-in API routes for `/api/generate` and `/api/download`
- ✅ Single framework for frontend and backend-for-frontend
- ✅ `extensionAlias` enables consistent ESM barrel format across monorepo
- ✅ Mature, battle-tested production builds
- ✅ Strong TypeScript integration

### Negative

- ⚠️ Slower dev server compared to Vite/Turbopack
- ⚠️ Cannot use Turbopack until `extensionAlias` is supported
- ⚠️ Webpack configuration complexity for monorepo resolution

### Neutral

- Dev and build both use `--webpack` flag for consistency
- Turbopack config is maintained in `next.config.mjs` for future migration

## Configuration

### package.json Scripts

```json
{
  "scripts": {
    "dev": "next dev --webpack -p 3000",
    "build": "next build --webpack"
  }
}
```

### next.config.mjs Key Settings

```javascript
// Monorepo package transpilation
transpilePackages: [
  "@hexagen/monaco-orchestration",
  "@hexagen/project-configuration",
  "@hexagen/shared",
  // ...
],

// Webpack extension resolution
webpack: (config) => {
  config.resolve.extensionAlias = {
    ".js": [".ts", ".tsx", ".js"],
    ".mjs": [".mts", ".mjs"],
  };
  // ...
}
```

## Review Triggers

Revisit this decision if:

1. Turbopack adds `extensionAlias` support → migrate from Webpack to Turbopack
2. Vite adds RSC support → re-evaluate Vite as an option
3. Dev server performance becomes a significant bottleneck
4. Next.js deprecates Webpack support

## Related

- [AGENTS.md — Appendix: Module Resolution](../../AGENTS.md#appendix-module-resolution)
- [ADR-0004: CI Build and TypeScript Monorepo Resolution](./0004-ci-build-typescript-monorepo-resolution.md)
- [ADR-0005: Shared Kernel Type Migration](./0005-shared-kernel-type-migration.md)
