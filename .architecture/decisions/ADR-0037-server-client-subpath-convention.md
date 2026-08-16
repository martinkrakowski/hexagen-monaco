# ADR-0037: /server and /client Subpath Export Convention

## Status

Accepted

## Context

The monorepo uses `@hexagen/*` packages with barrel-file imports enforced by ESLint's `no-restricted-imports`. The rule blocks deep subpath imports (`@hexagen/foo/bar`) to prevent coupling to internal package structure.

However, some packages have legitimate subpath exports — entry points that are part of the **published API surface**, not internal structure. For example, `@hexagen/project-configuration/server` exports Node.js-only functions (`mergeSplitManifest`) that must never reach a client bundle, while the default barrel (`@hexagen/project-configuration`) exports client-safe types and pure functions (`isIndexManifest`).

The existing `@hexagen/local-llm/shared` exception demonstrates this need but hardcodes a one-off pattern. As the manifest split introduces more server-only exports, every new subpath requires a manual ESLint exception — future drift.

## Decisions

### Decision 1: `/server` and `/client` are first-class subpath conventions

Any `@hexagen/*` package may declare `/server` and/or `/client` subpath exports in its `package.json` `exports` field. These are **published API surface**, not internal structure.

- `/server` — Node.js-only code. Uses `node:fs`, `node:path`, `js-yaml`, etc. Must never be imported from a client-bundled context.
- `/client` — Client-safe code. Zero Node.js built-in imports. Safe for browser/Next.js client bundles.
- Default barrel (`.`) — Equivalent to `/client` for packages that don't need the split. Client-safe by default.

Packages and tools allowed to consume `/server` subpaths (explicit enumeration):

| Package / Tool       | Justification                                                                                                                                               |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sync`               | CLI tool, server-only by nature (`plane: infrastructure`)                                                                                                   |
| `mcp-server`         | MCP server, no client bundle                                                                                                                                |
| `tui`                | Terminal UI, runs in Node.js                                                                                                                                |
| `project-generation` | Code generation, runs in Node.js                                                                                                                            |
| `tools/arch-linter`  | CLI tool in `tools/`, not subject to ESLint cross-package rules, but governed by this convention. Imports `@hexagen/project-configuration/server` directly. |

Packages **prohibited** from `/server` subpaths:

| Package                  | Reason                              |
| ------------------------ | ----------------------------------- |
| `web-driver`             | Client bundle — runs in browser     |
| `ui`                     | Client bundle — React components    |
| `visualization`          | Client bundle — D3/Canvas rendering |
| `model-settings`         | Client bundle — settings UI         |
| `ui-projection-compiler` | Client bundle — projection layer    |
| `manifest-generation`    | Has client-side codepath            |

### Decision 2: Server barrel must not re-export the client barrel

`server.ts` must not contain `export * from './index.js'` or any equivalent re-export of the client barrel.

Rationale: If `server.ts` re-exports the client barrel, the TypeScript declaration for `@hexagen/project-configuration/server` contains every client-safe symbol _plus_ the server-only symbols. Any tool — arch-linter, documentation generators, AI agents reading the exported surface — sees a merged API and cannot distinguish what is server-only. The boundary becomes a naming convention rather than an enforced contract.

The two-import pattern is the correct signal to maintainers:

```typescript
// In a server-only consumer (sync, mcp-server, etc.)
import { isIndexManifest } from "@hexagen/project-configuration"; // client-safe
import { mergeSplitManifest } from "@hexagen/project-configuration/server"; // server-only
```

The verbosity is load-bearing. It makes the boundary visible at the call site.

### Decision 3: ESLint rule encodes the convention, not instances

The `no-restricted-imports` pattern allowlist is updated to:

```json
["!@hexagen/*/server", "!@hexagen/*/client"]
```

This replaces the `!@hexagen/local-llm/shared` one-off. The `exports` field in each package's `package.json` remains the authority on whether a subpath exists; ESLint only governs the shape of allowed subpaths.

The `@hexagen/local-llm/shared` exception has been removed. Codemod completed in PR #68; all consumers now import from `@hexagen/local-llm/client`.

## Implementation Details

### Package barrel split pattern

```text
packages/foo/src/
├── index.ts ← client barrel (default export, zero Node deps)
└── server.ts ← server barrel (may import Node built-ins)
```

`package.json` exports:

```json
{
  ".": {
    "types": "./dist/index.d.ts",
    "import": "./dist/index.js"
  },
  "./server": {
    "types": "./dist/server.d.ts",
    "import": "./dist/server.js"
  }
}
```

`require` is intentionally omitted. All packages in this monorepo declare `"type": "module"`. CommonJS interop is not supported.

### `@hexagen-server-only` marker

Server barrel files include a machine-readable comment for future arch-linter v2 enforcement:

```typescript
// @hexagen-server-only
// This module uses Node.js built-ins. It must not be imported from:
//   - apps/web (client bundle)
//   - packages/web-driver
//   - packages/ui
//   - packages/visualization
// Enforcement: linter-config.yaml subpath_conventions (pending arch-linter v2)
```

### Per-package ESLint enforcement (interim)

While arch-linter v2 does not yet read `subpath_conventions`, client-bundle packages have a local `no-restricted-imports` rule blocking `@hexagen/*/server`:

```javascript
// packages/web-driver/eslint.config.js
{
  rules: {
    'no-restricted-imports': ['error', {
      patterns: [{
        group: ['@hexagen/*/server'],
        message: '@hexagen/*/server subpaths are server-only. This package runs in the client bundle.'
      }]
    }]
  }
}
```

Applied to: `web-driver`, `ui`, `visualization`, `model-settings`, `ui-projection-compiler`.

### Arch-linter `subpath_conventions` (aspirational)

```yaml
subpath_conventions:
  server:
    allowed_consumers:
      - sync
      - mcp-server
      - tui
      - project-generation
    enforcement: error
  client:
    allowed_consumers: []
    enforcement: warn
```

Not yet read by arch-linter. Serves as documented intent for arch-linter v2.

## Consequences

- No more one-off ESLint exceptions for each new server subpath.
- The two-import pattern at call sites makes server-boundary crossings auditable via `grep`.
- Client-bundle packages have real enforcement today via per-package ESLint rules.
- `@hexagen/local-llm/shared` remains as debt — see below.

## Amendment (2026-08-16 — `api-gateway` removed from the enumeration)

**Status:** ✅ Accepted · **Context:** architecture-remediation item 4.5, decision D3.

`api-gateway` has been struck from `server.allowed_consumers` in both places this ADR
carries the list — the justification table above and the `subpath_conventions` snapshot
further down — because the workspace it named no longer exists. `apps/api-gateway` was
deleted as 19 lines of unmodified `fastify-cli` scaffold that declared three workspace
dependencies and imported none of them; the HTTP surface it was reserved for is served by
`apps/web/app/api`. The entry was never load-bearing: the linter only reports a subpath
violation for a consumer it actually observes importing a `/server` path, and this one
never imported anything. Removing it narrows the enumeration to consumers that exist,
which is the property the list is for. The reasoning is recorded in
`docs/planning/2026-08-16-decision-dossier-and-remediation-followups.md` §1.1.

Nothing else in this ADR changes. The convention, the two-import call-site pattern and
the prohibited-package table stand as written.

## Debt

- **ADR-0035 normalization**: `@hexagen/local-llm/shared` → `@hexagen/local-llm/client`. **Resolved in PR #68.** All consumers migrated. Bypass removed from arch-linter; ESLint exception removed; `agentic-interaction` and `manifest-generation` added to `client.allowed_consumers` in linter-config.yaml.
