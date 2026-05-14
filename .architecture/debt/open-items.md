# Open Architecture Debt Items

Auto-read by: hexagen agents before modifying `tools/arch-linter` or `packages/local-llm`
Updated by: committer when items are resolved or discovered
Source of truth for items referenced by `TODO: ADR-XXXX` comments in source files

---

## OPEN

_(none)_

---

## RESOLVED

### DEBT-001: @hexagen/local-llm/shared → @hexagen/local-llm/client

- **Origin**: ADR-0035 (pre-convention). ADR-0037 records the normalization intent.
- **Resolution**: Codemod completed in PR #68. `./shared` export replaced by `./client`. Arch-linter bypass updated to package-specific check (only `agentic-interaction` and `manifest-generation` exempt). `marker_exclusions: []` is correctly empty — no server barrel needs exemption.

### FEAT-002: @hexagen-server-only marker enforcement (arch-linter v2.1)

- **Origin**: ADR-0037 defines a machine-readable `@hexagen-server-only` comment marker in server barrel files.
- **Resolution**: Implemented in `tools/arch-linter/src/server-marker-violation.ts`. Forward check (`checkUnexpectedMarker`) flags non-server files carrying the marker. Backward check (`checkMissingMarker`) flags server barrels missing the marker. `require_marker: true` activated after verifying the sole server barrel (`project-configuration/src/server.ts`) has the marker. 19 unit tests pass. Integrated into `index.ts` linter loop with enforcement-level routing.

### FEAT-001: Arch-Linter v2 — subpath_conventions enforcement

- **Resolution**: Implemented in `tools/arch-linter/src/index.ts`. Added `SubpathConvention` + `SubpathConventionConfig` interfaces, extended `LinterConfig` with `subpath_conventions` field. Implemented `isSubpathViolation()` as a pure function taking `(fromPackage, moduleSpecifier, scope, config)`. Integrated at import loop before `isCrossPackageViolation()`. Added `warnings[]` collection for `enforcement: warn`. Legacy bypass for `@hexagen/local-llm/shared` (DEBT-001). 9 unit tests pass using `node:test` + `node:assert/strict`.
- **Unlocks**: DEBT-001, FEAT-002

### FEAT-003: manifest-schema.ts alignment — dead schema in arch-linter

- **Finding**: `tools/arch-linter/src/manifest-schema.ts` used `modules[]` while the actual manifest uses `bounded_contexts[]`. Audit (2026-05-11) confirmed zero consumers — dead code.
- **Risk if left in place**: Next person touching arch-linter may import it thinking it is the validation path. Dead schema in a governance tool creates false confidence.
- **Resolution**: Deleted in commit `TBD`. Authoritative schema pointer added to `tools/arch-linter/src/index.ts` near the `mergeSplitManifest` import.
