# Sync Engine Reform

**Scope of Work & Implementation Plan**
Hexagen Monorepo · Feature: monaco-persistence wiring · March 2026

## 1. Background & Problem Statement

During implementation of the Monaco persistence wiring feature, the build pipeline surfaced a series of cascading TypeScript errors. None of the failures were caused by incorrect application logic — every error was caused by structural gaps in files the sync engine generated: missing barrel exports, duplicate interface declarations, stale import paths, and TypeScript configuration that resolved cross-package imports to raw source files instead of compiled declarations.

The sync engine generates files in isolation. It creates individual files correctly but does not validate the connected graph of exports, imports, and TypeScript configuration required for those files to build together as a monorepo package. Every manual fix applied during the debugging session represents a generator invariant that must be enforced automatically going forward.

## 2. Root Causes Identified

The following failures were identified and manually fixed. Each represents a gap the sync engine must close permanently.

| Root Cause                        | What Went Wrong                                                                                                                                                                                      | Manual Fix Applied                                                                                                                                 |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| tsconfig paths inheritance        | tsconfig.base.json paths mapped all @hexagen/\* to src/ source files. Every inheriting package resolved cross-package types to raw source, causing 40+ TS6059 errors.                                | Added "paths": {} to web-driver/tsconfig.json to override inherited mappings. TypeScript fell back to node_modules resolution via dist/index.d.ts. |
| Duplicate port declaration        | MonacoPersistencePort was declared in both @hexagen/monaco-orchestration (canonical) and @hexagen/web-driver (duplicate). The adapter implemented the local copy, causing a type conflict at wiring. | Deleted the duplicate. Updated adapter, intent handler, and test-domain to import from the canonical owning package.                               |
| Empty barrel stubs                | domain/index.ts contained only export {} — a stub. MonacoSession was defined but unreachable from the root barrel. ports/in barrel existed but was never wired into src/index.ts.                    | Added MonacoSession export to domain/index.ts. Added ports/in barrel to src/index.ts.                                                              |
| Stale type names in consumers     | Generated consumers used MonacoSessionState, loadSession — neither matched the actual port interface using MonacoSession, loadLatestSession, and Result<> return types.                              | Updated all consumers to derive signatures from the canonical port. Renamed: projectId → id, timestamp → lastModifiedAt.                           |
| Self-import by package name       | download-project.use-case.ts inside @hexagen/web-driver imported from '@hexagen/web-driver' by name. A package cannot import itself by its own package name.                                         | Replaced self-imports with relative paths.                                                                                                         |
| Missing package.json dependencies | local-storage-persistence.adapter.ts imported from @hexagen/monaco-orchestration and @hexagen/shared, but neither was listed in web-driver/package.json.                                             | Added both packages as dependencies. TypeScript had masked the gap via tsconfig.base.json paths.                                                   |
| Debug scaffolding in src/         | test-domain.ts was left in src/ and attempted to use TypeScript interfaces as runtime values — never valid. Also imported from a deleted deep path.                                                  | Deleted the file.                                                                                                                                  |
| Wrong wiring stub signature       | DownloadProjectPort stub accepted a string instead of Project and returned { error: ... } instead of { success, message } as declared by the port.                                                   | Updated stub to accept Project and return the correct shape.                                                                                       |

## 3. Configuration Architecture

Two configuration files govern the reformed system. Their separation is the foundational architectural decision.

### 3.1 .architecture.yaml

Reserved strictly for the domain architecture of the generated monorepo: bounded contexts, aggregates, entities, value objects, ports, and use cases of the target system. This file describes **what** to build, not **how** the generator behaves.

### 3.2 generator.config.yaml

Created at the workspace root. Single source of truth for generator runtime behavior: bootstrap sequence, invariant priorities, failure behaviors, and the port ownership registry. Managed automatically by the SyncEngine bounded context. Manual edits are strictly prohibited — the file is overwritten on the next port declaration or sync run.

**Key sections:**

- `port-ownership-map` — central registry mapping port interfaces to their owning package. Auto-updated via OwnershipRegistryPort.
- `invariant-priorities` — severity level for each named invariant (critical / high / medium).
- `failure-behaviors` — action taken per priority level (abort+cleanup / abort / warn+continue).
- `bootstrap-sequence` — ordered list of nine steps executed as the mandatory final phase of every generation run.

## 4. The Nine Generator Invariants

Every generated package must satisfy all nine invariants before the generator exits.

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

## 5. Bootstrap Sequence

Nine steps execute as the mandatory final phase of every generation run. Memory-only operations precede file creation. File-mutating and file-validating operations follow skeleton generation.

| #   | Step                            | Priority | Failure         | Note                                                                                                               |
| --- | ------------------------------- | -------- | --------------- | ------------------------------------------------------------------------------------------------------------------ |
| 1   | load-ownership-map              | critical | abort           | Memory-only — reads generator.config.yaml into in-memory registry before any file is touched.                      |
| 2   | validate-port-ownership-map     | critical | abort           | Memory-only — checks registry for duplicate port declarations. No cleanup needed: no workspace exists yet.         |
| 3   | generate-package-skeleton       | critical | abort + cleanup | Creates folder structure, minimal tsconfig stubs, and package.json stubs on disk.                                  |
| 4   | enforce-tsconfig-paths-override | critical | abort + cleanup | Patches each generated tsconfig.json to add "paths": {}, overriding inherited source mappings.                     |
| 5   | generate-exports-field          | critical | abort + cleanup | Patches each generated package.json with a complete exports map for subpath import resolution.                     |
| 6   | synchronize-signatures          | high     | abort           | Reads canonical port interfaces from generated files and derives exact signatures for all consumers.               |
| 7   | validate-barrel-chain           | high     | abort           | Verifies full upward reachability from every export to the root barrel, and ownership boundary in both directions. |
| 8   | enforce-dependency-consistency  | high     | abort           | Scans all generated imports and ensures each @hexagen/\* import has a matching package.json dependency entry.      |
| 9   | final-composite-reference-check | high     | abort           | Verifies no tsconfig project references point to source files — only dist/ declarations are permitted.             |

Critical failures (steps 1–5) trigger snapshot restore via `FileSystemPort.snapshotWorkspace() → restoreSnapshot()`. If snapshot fails, the partial workspace is deleted. High failures (steps 6–9) abort without cleanup intentionally — partial state is left visible for developer inspection.

## 6. Domain Model — SyncEngine Bounded Context

### 6.1 Entities & Value Objects

| Name                   | Kind         | Purpose                                                                                 |
| ---------------------- | ------------ | --------------------------------------------------------------------------------------- |
| GeneratedPackage       | Entity       | Root aggregate. Owns tsconfig, barrels, and package.json state for a generated package. |
| ExportChain            | Entity       | Linked list of re-exports from leaf file to root barrel. Used by ValidateBarrelChain.   |
| PortOwnershipRecord    | Value Object | Immutable record of port name → owning package. Written to generator.config.yaml.       |
| PackageDependencyGraph | Entity       | Graph of @hexagen/\* imports to required package.json entries.                          |
| BootstrapStep          | Value Object | Describes one bootstrap step: name, priority, failure mode, and note.                   |
| InvariantViolation     | Value Object | Structured description of a failed invariant: name, severity, affected files, message.  |
| FailureBehavior        | Value Object | Encodes action (abort/warn) and cleanup flag for a given priority level.                |
| InvariantPriority      | Type alias   | Union: 'critical' \| 'high' \| 'medium'. Shared across all ports and use cases.         |
| FailureMode            | Type alias   | Union: 'abort' \| 'abort + cleanup' \| 'warn'. Shared across all ports and use cases.   |

### 6.2 Ports

| Port                      | Direction | Key Methods / Purpose                                                                                    |
| ------------------------- | --------- | -------------------------------------------------------------------------------------------------------- |
| SyncOrchestratorPort      | in        | executeFullSync(workspaceRoot): Result<SyncReport> — primary entry point for the main generator.         |
| OwnershipRegistryPort     | out       | loadOwnershipMap(), registerPortOwnership(), canDeclarePort(), getOwningPackage() — read/write registry. |
| GeneratorConfigPort       | out       | getBootstrapSequence(), getFailureBehavior(), getInvariantPriority() — read-only static config access.   |
| FileSystemPort            | out       | snapshotWorkspace(), restoreSnapshot(), writeFile(), deleteDirectory() — disk operations with rollback.  |
| TypeScriptAnalyzerPort    | out       | analyzeImports(), resolveExportChain(), validateDistReferences() — ts-morph based analysis.              |
| PackageJsonPort           | out       | readPackageJson(), addDependency(), writeExportsField() — package.json read/write.                       |
| TsconfigWriterPort        | out       | readTsconfig(), enforcePathsOverride(), writeTsconfig() — tsconfig read/write.                           |
| BarrelRebuilderPort       | out       | validateUpwardReachability(), validateOwnershipBoundary(), rebuildBarrel() — barrel chain ops.           |
| ExportsFieldGeneratorPort | out       | generateExportsField(packageRoot): ExportsMap — derives correct exports map from package structure.      |

### 6.3 Use Cases

| Use Case                            | Responsibility                                                                                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| LoadOwnershipMapUseCase             | Reads generator.config.yaml into memory. Handles missing file as empty bootstrap case.                                                            |
| ValidatePortOwnershipMapUseCase     | Checks loaded registry for duplicate port declarations. Returns InvariantViolation on conflict.                                                   |
| GeneratePackageSkeletonUseCase      | Creates folder structure, minimal tsconfig stubs, and package.json stubs. Takes snapshot before writing.                                          |
| EnforceTsconfigPathsOverrideUseCase | Patches all generated tsconfig.json files to include "paths": {}. Validates patch was applied correctly.                                          |
| GenerateExportsFieldUseCase         | Derives and writes a complete exports map to each generated package.json.                                                                         |
| SynchronizePortSignaturesUseCase    | Reads canonical port interfaces and patches all consumer signatures to match exactly.                                                             |
| ValidateBarrelChainUseCase          | Walks export chain from every leaf to root barrel. Validates upward reachability and ownership boundary.                                          |
| EnforceDependencyConsistencyUseCase | Scans all imports, auto-adds missing @hexagen/\* entries to package.json dependencies.                                                            |
| FinalCompositeReferenceCheckUseCase | Validates no tsconfig project references point to source files.                                                                                   |
| ExecuteBootstrapSequenceUseCase     | Orchestrator — reads bootstrap sequence and delegates each step. Contains no step logic directly. Step notes carried verbatim as inline comments. |

## 7. Implementation Plan

Implementation proceeds slice by slice, each independently testable. The orchestrator is built last — only after all nine step use cases have passing unit tests individually.

| #   | Slice                                    | Depends On  | Deliverables                                                                                                                                                      |
| --- | ---------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | generator-config-yaml-adapter ✓ COMPLETE | None        | OwnershipRegistryPort, GeneratorConfigPort, YamlConfigAdapter, InMemoryConfigDouble, wiring.ts. Tests covering conflict detection, immutability, and error cases. |
| 2   | load-ownership-map-use-case              | Slice 1     | LoadOwnershipMapUseCase returning Result<OwnershipRegistry, GeneratorError>. Establishes StepReport pattern for all subsequent steps.                             |
| 3   | validate-port-ownership-map-use-case     | Slice 2     | ValidatePortOwnershipMapUseCase. Tests for new port, same-owner re-declaration, and conflict.                                                                     |
| 4   | file-system-port-with-snapshot           | None        | FileSystemPort interface + adapter. snapshotWorkspace(), restoreSnapshot(), rm-rf fallback. Tests for disk failure rollback.                                      |
| 5   | generate-package-skeleton-use-case       | Slices 3–4  | GeneratePackageSkeletonUseCase. Creates minimal folder structure. Takes snapshot before writing.                                                                  |
| 6   | enforce-tsconfig-paths-override-use-case | Slice 5     | EnforceTsconfigPathsOverrideUseCase + TsconfigWriterPort + adapter.                                                                                               |
| 7   | generate-exports-field-use-case          | Slice 5     | GenerateExportsFieldUseCase + ExportsFieldGeneratorPort + adapter.                                                                                                |
| 8   | synchronize-port-signatures-use-case     | Slice 5     | SynchronizePortSignaturesUseCase + TypeScriptAnalyzerPort (ts-morph).                                                                                             |
| 9   | validate-barrel-chain-use-case           | Slice 5     | ValidateBarrelChainUseCase + BarrelRebuilderPort.                                                                                                                 |
| 10  | enforce-dependency-consistency-use-case  | Slice 5     | EnforceDependencyConsistencyUseCase + PackageJsonPort.                                                                                                            |
| 11  | final-composite-reference-check-use-case | Slice 5     | FinalCompositeReferenceCheckUseCase.                                                                                                                              |
| 12  | execute-bootstrap-sequence-use-case      | Slices 2–11 | ExecuteBootstrapSequenceUseCase orchestrator. Integration tests for full happy path and each failure mode.                                                        |

## 8. Known Risks & Open Items

### 8.1 Ownership Registry Drift

The auto-maintenance contract depends on a `PortDeclaredEvent` being raised whenever any new port is created. If someone adds a port without raising the event, the registry silently drifts.

**Mitigation:**

- Add a lint rule or pre-commit hook scanning for port interface declarations not present in generator.config.yaml.

### 8.2 Concurrent Sync Sessions

YamlConfigAdapter uses instance-level caching with no file locking. Two sync sessions running concurrently against the same workspace root will produce conflicting writes.

**Mitigation:**

- Document single-session limitation as an acceptance criterion. Implement file locking or atomic writes before enabling concurrent CI.

### 8.3 Static vs Dynamic Cache Fields

The adapter does not distinguish cacheable-forever data (bootstrap sequence, failure behaviors) from cacheable-until-write data (ownership map). Future maintainers may not know which fields are safe to cache aggressively.

**Mitigation:**

- Add explicit comments in the adapter marking which fields are immutable at runtime and which are write-sensitive.

### 8.4 Step-to-Use-Case Mapping

ExecuteBootstrapSequenceUseCase must map step name strings to concrete use case classes. The strategy (registry map, strategy pattern, convention-based lookup) is not yet defined and affects testability.

**Resolution required:**

- Define the mapping strategy as the first decision when implementing Slice 12. Do not defer to inside the implementation.

## 9. Acceptance Criteria — Full Reform

The sync engine reform is complete when all of the following are true:

1. `yarn build` passes cleanly from a cold cache with no manual intervention after any generation run.
2. Every generated package tsconfig.json contains `"paths": {}` — verified by the composite-safety invariant.
3. No port interface exists in more than one package — verified by port-single-ownership and the ownership registry.
4. Every named export in every generated file is reachable from the package root barrel — verified by ValidateBarrelChain.
5. Every generated consumer's method signatures match the canonical port definition exactly — verified by SynchronizeSignatures.
6. Every `@hexagen/*` import has a matching package.json dependency — verified by EnforceDependencyConsistency.
7. No generated package imports itself by name — verified by self-import-prevention.
8. No barrel file containing only `export {}` exists in any compiled source tree.
9. generator.config.yaml is updated automatically on every new port declaration with no manual step required.
10. ExecuteBootstrapSequenceUseCase integration tests cover the full happy path and each critical/high failure mode with correct rollback behavior.
