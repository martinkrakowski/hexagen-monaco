# Open Architecture Debt Items

Auto-read by: hexagen agents before modifying `tools/arch-linter` or `packages/local-llm`
Updated by: committer when items are resolved or discovered
Source of truth for items referenced by `TODO: ADR-XXXX` comments in source files

---

## OPEN

### DEBT-001: @hexagen/local-llm/shared → @hexagen/local-llm/client

- **Origin**: ADR-0035 (pre-convention). ADR-0037 records the normalization intent.
- **Scope**: 26 consumer files — `agentic-interaction` (18), `manifest-generation` (8)
- **Key symbols**: `DomainModelId`, `SendStructuredRequestPort`, `createLLMRequest`, `LLMRequest`, `LLMResponse`
- **Blocked by**: ~~FEAT-001~~ (RESOLVED) → now unblocked
- **Remediation**:
  1. Add `./client` subpath to `packages/local-llm/package.json` exports (mirror `./shared`)
  2. Codemod: `@hexagen/local-llm/shared` → `@hexagen/local-llm/client` across 26 files
  3. Remove `./shared` export and ESLint exception
  4. Mark FEAT-001 as the verification gate
- **ESLint marker**: `!@hexagen/local-llm/shared` in root `.eslintrc.json:21` with `TODO: ADR-0037`

### FEAT-002: @hexagen-server-only marker enforcement (arch-linter v2.1)

- **Context**: ADR-0037 defines a machine-readable `@hexagen-server-only` comment marker in server barrel files. Arch-linter v2.1 could validate that files with this marker belong to a package declaring a `/server` subpath, and vice versa.
- **Blocked by**: ~~FEAT-001~~ (RESOLVED) → now unblocked
- **Estimate**: ~50 lines (requires AST comment parsing via ts-morph)

---

## RESOLVED

### FEAT-001: Arch-Linter v2 — subpath_conventions enforcement

- **Resolution**: Implemented in `tools/arch-linter/src/index.ts`. Added `SubpathConvention` + `SubpathConventionConfig` interfaces, extended `LinterConfig` with `subpath_conventions` field. Implemented `isSubpathViolation()` as a pure function taking `(fromPackage, moduleSpecifier, scope, config)`. Integrated at import loop before `isCrossPackageViolation()`. Added `warnings[]` collection for `enforcement: warn`. Legacy bypass for `@hexagen/local-llm/shared` (DEBT-001). 9 unit tests pass using `node:test` + `node:assert/strict`.
- **Unlocks**: DEBT-001, FEAT-002

### FEAT-003: manifest-schema.ts alignment — dead schema in arch-linter

- **Finding**: `tools/arch-linter/src/manifest-schema.ts` used `modules[]` while the actual manifest uses `bounded_contexts[]`. Audit (2026-05-11) confirmed zero consumers — dead code.
- **Risk if left in place**: Next person touching arch-linter may import it thinking it is the validation path. Dead schema in a governance tool creates false confidence.
- **Resolution**: Deleted in commit `TBD`. Authoritative schema pointer added to `tools/arch-linter/src/index.ts` near the `mergeSplitManifest` import.
