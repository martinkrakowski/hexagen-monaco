# ADR-0001: Persistence Wiring

**Status:** Accepted  
**Date:** 2026-03-11  
**Authors:** Architecture Co-pilot, Human Architect  
**Supersedes:** None

---

## Context

During implementation of the Monaco persistence wiring feature, the build pipeline surfaced cascading TypeScript errors. None were caused by incorrect application logic — every failure was caused by structural gaps in files the sync engine generated:

- Missing barrel exports
- Duplicate interface declarations
- Stale import paths
- TypeScript configuration that resolved cross-package imports to raw source files instead of compiled declarations

The sync engine generates files in isolation but does not validate the connected graph of exports, imports, and TypeScript configuration required for those files to build together as a monorepo package.

---

## Decision

We established a two-part configuration architecture and nine generator invariants enforced via a bootstrap sequence.

### 1. Configuration Separation

**manifest.yaml** — Reserved strictly for the domain architecture of the generated monorepo: bounded contexts, entities, value objects, ports, and use cases. Describes **what** to build, not **how** the generator behaves.

**generator.config.yaml** — Single source of truth for generator runtime behavior: bootstrap sequence, invariant priorities, failure behaviors, and the port ownership registry. Managed automatically by the SyncEngine. Manual edits are prohibited.

### 2. The Nine Generator Invariants

| Invariant                 | Priority | Failure Action  | Description                                                                                                                               |
| ------------------------- | -------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| composite-safety          | critical | abort + cleanup | Every tsconfig.json must contain "paths": {} to override inherited source mappings. All cross-package references must point to dist only. |
| barrel-ownership-boundary | critical | abort + cleanup | Barrels may only re-export types owned by the current bounded context. Validate both upward reachability and downward ownership boundary. |
| port-single-ownership     | critical | abort + cleanup | Each port interface belongs to exactly one bounded context. No duplicates. Generator maintains and auto-updates the ownership registry.   |
| dependency-consistency    | high     | abort           | Every @hexagen/\* import must have a matching entry in package.json dependencies. Generator auto-adds missing entries.                    |
| self-import-prevention    | high     | abort           | No package may import itself by name. Generator converts self-imports to relative paths automatically.                                    |
| signature-synchronization | high     | abort           | Generated consumers must derive exact signatures from the canonical port at generation time. Stale templates are not permitted.           |
| no-empty-stubs            | medium   | warn + continue | No barrel containing only export {} may exist in compiled source. Generator omits the barrel until it has at least one real export.       |
| exports-field-mandatory   | medium   | warn + continue | Every package.json must include a complete exports map. main and types point to dist/index.js and dist/index.d.ts.                        |

### 3. Root Causes Fixed

| Root Cause                        | Manual Fix Applied                                                                                                                                 |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| tsconfig paths inheritance        | Added "paths": {} to web-driver/tsconfig.json to override inherited mappings. TypeScript fell back to node_modules resolution via dist/index.d.ts. |
| Duplicate port declaration        | Deleted the duplicate. Updated adapter, intent handler, and test-domain to import from the canonical owning package.                               |
| Empty barrel stubs                | Added MonacoSession export to domain/index.ts. Added ports/in barrel to src/index.ts.                                                              |
| Stale type names in consumers     | Updated all consumers to derive signatures from the canonical port. Renamed: projectId → id, timestamp → lastModifiedAt.                           |
| Self-import by package name       | Replaced self-imports with relative paths.                                                                                                         |
| Missing package.json dependencies | Added both packages as dependencies.                                                                                                               |
| Debug scaffolding in src/         | Deleted test-domain.ts.                                                                                                                            |
| Wrong wiring stub signature       | Updated stub to accept Project and return the correct shape.                                                                                       |

### 4. Bootstrap Sequence

Nine steps execute as the mandatory final phase of every generation run. Memory-only operations precede file creation.

| #   | Step                            | Priority | Failure         |
| --- | ------------------------------- | -------- | --------------- |
| 1   | load-ownership-map              | critical | abort           |
| 2   | validate-port-ownership-map     | critical | abort           |
| 3   | generate-package-skeleton       | critical | abort + cleanup |
| 4   | enforce-tsconfig-paths-override | critical | abort + cleanup |
| 5   | generate-exports-field          | critical | abort + cleanup |
| 6   | synchronize-signatures          | high     | abort           |
| 7   | validate-barrel-chain           | high     | abort           |
| 8   | enforce-dependency-consistency  | high     | abort           |
| 9   | final-composite-reference-check | high     | abort           |

Critical failures (steps 1–5) trigger snapshot restore. High failures (steps 6–9) abort without cleanup — partial state is left visible for developer inspection.

---

## Consequences

### Positive

- Every generated package satisfies composite-safety invariant — no more TS6059 errors
- Port single-ownership eliminates duplicate declarations and type conflicts
- Barrel ownership boundary enforced — no cross-package re-exports
- Dependency consistency ensures all imports have corresponding package.json entries
- Self-imports converted automatically
- Consumer signatures synchronized from canonical ports at generation time

### Negative

- Existing projects require a sync run to satisfy new invariants
- generator.config.yaml is now auto-managed — any manual edits will be overwritten

### Neutral

- Empty barrel files now use comments instead of `export {}`
- Bootstrap sequence adds ~200ms per run but ensures structural integrity

---

## Verification

The reform is verified when:

1. `yarn build` passes cleanly from a cold cache with no manual intervention
2. Every generated package tsconfig.json contains `"paths": {}`
3. No port interface exists in more than one package
4. Every named export is reachable from the package root barrel
5. Every generated consumer's method signatures match the canonical port definition
6. Every `@hexagen/*` import has a matching package.json dependency
7. No generated package imports itself by name

---

## Related

- `.architecture/manifest.yaml` — Bounded context definitions
- `.architecture/generator.config.yaml` — Invariant definitions and port ownership registry
- `AGENTS.md` — Architectural constraints (`barrel-ownership-boundary`, `no-empty-stubs`)
