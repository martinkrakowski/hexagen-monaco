# HexaGen Monaco: Manifest.yaml Auto-Generation Investigation Report

## Executive Summary

The `.architecture/manifest.yaml` file is **manually authored but generator-aware**. It serves as the single source of truth for the system's bounded contexts, ports, use cases, entities, and dependencies. Currently, **no code discovers or generates this file from the codebase itself**. The system is designed to work in two directions:

1. **Manifest → Code** (Current): Manual manifest edits trigger automatic code generation and scaffolding
2. **Code → Manifest** (Aspirational): No current implementation, but architectural patterns exist to support it

---

## 1. Current .architecture/manifest.yaml Structure

### Overview

- **Location**: `.architecture/manifest.yaml` (807 lines)
- **Bounded Contexts**: 24 contexts defined
- **Type System**: Comprehensive type definitions in `packages/sync/src/types/manifest.ts`
- **Version**: System version 0.2.0 (generator), architecture "modular-monolith"

### Top-Level Sections

```yaml
system: hexagen-monaco
scope: hexagen
architecture: modular-monolith
monorepo: { ... } # Package manager, build tool, workspaces, ESLint, TypeScript config
generator: { ... } # Version, sync config (idempotent, nonDestructive)
mvk: { ... } # MVK spec location, drift reports, ADR references
bounded_contexts: [...] # 24 core, supporting, shared-kernel, driver contexts
apps: [...] # 2 applications (web, api-gateway)
```

### Bounded Context Structure

Each context has:

```yaml
- name: core-domain # snake-case identifier
  type: core|supporting|shared-kernel|driver
  description: "Semantic kernel..."
  layers:
    domain:
      entities: [DomainAST, DomainNode, ...]
      value_objects: [NodeKind, EdgeKind, ...]
      ports:
        in: [...]
        out: [...]
    application:
      use_cases: [ParseGestureUseCase, ...]
      ports:
        in: [GestureParserPort, ...]
        out: [...]
      factories: [createWebUseCaseFactories]
    infrastructure:
      adapters: [LocalStoragePersistenceAdapter, ...]
  depends_on: [messaging, visualization]
  driver_for: apps/web # For driver contexts
  wiring: ["Intent Bus dispatches..."]
  generator:
    dependencies:
      monaco-editor: ^0.51.0
  packageJson: { ... } # Overrides
```

### Key Patterns

| Pattern                                     | Evidence                                                       |
| ------------------------------------------- | -------------------------------------------------------------- |
| **Ports are declared per context**          | `wizard-orchestration` has 9 in-ports, 4 out-ports             |
| **Entities/VOs are named, not implemented** | Just `[DomainAST, NodeKind]` — no structure                    |
| **Use cases are named**                     | `ParseGestureUseCase`, `ValidateTopologyUseCase`               |
| **No implementation code in manifest**      | Only architecture contracts, no method signatures              |
| **Dependencies are declared**               | `depends_on: [core-domain, shared]`                            |
| **Adapters are named**                      | `LocalStoragePersistenceAdapter` without implementation detail |
| **Generator directives are optional**       | Some contexts have `generator.dependencies`, others don't      |

---

## 2. Generator and SyncEngine Capabilities

### SyncEngine Architecture

**File**: `packages/sync/src/sync-engine.ts` (403 lines)

**Flow**:

1. Load manifest from `.architecture/manifest.yaml`
2. Validate manifest (duplicate context names, missing fields)
3. For each bounded context:
   - `ensureLayerFolders()` — create `src/{domain,application,infrastructure}/`
   - `generateBarrels()` — create recursive `index.ts` files
   - `generatePackageJson()` — create/merge `package.json`
   - `generateTsconfig()` — create `tsconfig.json` with project references
4. Optionally run `arch-linter` (skip in external mode)

**Code reads manifest to generate**:

- Directory structure (layers: domain, application, infrastructure)
- Package configuration (version, scripts, dependencies)
- TypeScript project references
- ESLint rules

### Current Generators

| Generator                | What It Does                          | Input from Manifest                                            |
| ------------------------ | ------------------------------------- | -------------------------------------------------------------- |
| `generateLayerFolders()` | Creates `src/{layer}` directories     | `generator.sync.layers` config                                 |
| `generateBarrels()`      | Creates recursive `index.ts` files    | Directory scanning (NOT manifest)                              |
| `generatePackageJson()`  | Creates/merges package.json           | `bounded_context.packageJson`, `workspaceDefaults.packageJson` |
| `generateTsconfig()`     | Creates tsconfig.json with references | `bounded_context.name`, manifest monorepo config               |
| `reapLegacyFolders()`    | Deletes empty folders                 | No manifest input                                              |

**Notably absent**:

- No generator discovers ports from code
- No generator reads entities/value objects from code
- No generator reads adapters from code
- No generator reads use cases from code

### Bootstrap Sequence (from AGENTS.md & generator.config.yaml)

```
1. load-ownership-map              (memory-only, from generator.config.yaml)
2. validate-port-ownership-map     (memory-only)
3. generate-package-skeleton       (create directories)
4. enforce-tsconfig-paths-override (TypeScript path mapping)
5. generate-exports-field          (package.json exports)
6. synchronize-signatures          (port interface signatures)
7. validate-barrel-chain           (no circular exports)
8. enforce-dependency-consistency  (package.json matches imports)
9. final-composite-reference-check (tsconfig.json correctness)
```

**None of these discover code or update the manifest.**

### Generator.config.yaml Purpose

**File**: `.architecture/generator.config.yaml` (136 lines)

**What it contains**:

- Invariant definitions (9 invariants: composite-safety, barrel-ownership-boundary, port-single-ownership, etc.)
- Bootstrap sequence
- Failure behaviors (critical → abort+cleanup, high → abort, medium → warn)
- **Ownership Registry** — Maps ports to their owning bounded context:

```yaml
ownership-registry:
  ports:
    # shared-kernel
    # (no ports declared)

    # project-configuration — in-ports
    TelemetryPort: project-configuration
    GenerateProjectPort: project-configuration
    # ... 30+ entries
```

**Key insight**: The ownership registry is **manually maintained**. When a new port is created, a human must:

1. Update the manifest (add port to bounded context)
2. Manually update `generator.config.yaml` ownership registry

---

## 3. Manual vs Auto-Generated Today

### What's Manually Edited

| File                    | Section                                  | Frequency          | Reason                            |
| ----------------------- | ---------------------------------------- | ------------------ | --------------------------------- |
| `manifest.yaml`         | `bounded_contexts[]`                     | Per new feature    | Establish architecture boundaries |
| `manifest.yaml`         | `apps[]`                                 | Rare               | Add new app framework             |
| `manifest.yaml`         | `layers.*.use_cases[]`                   | Per use case       | Define application contracts      |
| `manifest.yaml`         | `layers.*.ports[]`                       | Per port           | Define hexagonal interface        |
| `manifest.yaml`         | `layers.*.entities[]`, `value_objects[]` | Per domain concept | Document domain model             |
| `manifest.yaml`         | `depends_on[]`                           | When refactoring   | Update dependency graph           |
| `generator.config.yaml` | `ownership-registry.ports`               | Per new port       | Map port to owning context        |
| `AGENTS.md`             | Section 7 (Bootstrap)                    | Rare               | Update generation invariants      |

### What's Auto-Generated

| File                                         | Trigger            | Content                                 |
| -------------------------------------------- | ------------------ | --------------------------------------- |
| `packages/{name}/package.json`               | `yarn sync`        | Name, scripts, dependencies, version    |
| `packages/{name}/tsconfig.json`              | `yarn sync`        | Extends root, project references, paths |
| `packages/{name}/src/{layer}/index.ts`       | `yarn sync`        | Re-exports from layer (barrel files)    |
| `packages/{name}/src/{layer}/{sub}/index.ts` | `yarn sync`        | Same, for subfolders                    |
| `.github/workflows/sync-integrity.yml`       | Project generation | CI workflow for linting                 |
| `packages/{name}/eslint.config.js`           | Project generation | Shared ESLint rules                     |

### What's Protected (Never Overwritten)

| File                                                 | Why                                     |
| ---------------------------------------------------- | --------------------------------------- |
| `.gitignore`                                         | User-controlled                         |
| `turbo.json`                                         | User-controlled (unless `--force-root`) |
| `yarn.lock`                                          | Package manager controlled              |
| Hand-written `src/**/*.ts`                           | User code                               |
| Barrels without `@generated by @hexagen/sync` marker | User code                               |

---

## 4. Generator Logic for Manifest

### Code-to-Manifest Discovery

**Currently**: NONE. The system does NOT introspect code to update the manifest.

**Why**:

- ADR-0014 explicitly states that project generation creates a "structural skeleton only"
- Code generation is treated as a separate lifecycle event (post-bootstrap)
- The manifest is meant to establish architectural contracts FIRST, then code fills it in

**Example workflow**:

1. Human writes: `manifest.yaml` with port `GetUserPort`
2. `yarn sync` creates `src/application/ports/in/get-user.port.ts`
3. Human writes the port interface body
4. `yarn sync` runs again (no changes to manifest needed)

### Boundary Discovery

**Current capability**: Extract ports from manifest using helper functions:

```typescript
export function extractPorts(context: BoundedContext): {
  inPorts: string[];
  outPorts: string[];
};

export function extractDependencies(context: BoundedContext): string[];

export function isSharedKernel(context: BoundedContext): boolean;
```

These read the manifest, they don't generate it.

### Port Ownership Tracking

**File**: `generator.config.yaml` `ownership-registry`

This is the **only** centralized mapping of ports to contexts. It's manually maintained and used for:

- Invariant validation (port-single-ownership)
- Linter checks (detect duplicate port declarations)
- Not for discovery

---

## 5. Architecture Decisions and ADRs

### Relevant ADRs

| ADR          | Decision                                                        | Impact on Auto-Generation                                                      |
| ------------ | --------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **ADR-0002** | SyncEngine Structural Fixes — barrel ownership, protected files | Establishes that re-exporting from other packages violates boundaries          |
| **ADR-0014** | Code Generation as Post-Bootstrap                               | Manifest is structural skeleton ONLY; implementation code comes later          |
| **ADR-0003** | External Project Generation MVP                                 | ExternalSyncEngineAdapter can generate scaffold from a manifest                |
| **ADR-0010** | MCP Server Architecture                                         | Ports for manifest reads/writes exist (`ManifestWritePort`) but not generation |

### Key Quote from ADR-0014

> **"Project generation creates a structural skeleton only. Code generation is treated as a subsequent lifecycle event, not a bootstrapping event."**

This explicitly rejects auto-generation of port implementations from discovered code.

### Dependency Consistency Check

**File**: `packages/sync/src/linter.ts`

The linter runs `yarn workspace @hexagen/arch-linter lint:arch`, which validates:

- No duplicate port declarations
- Port-single-ownership invariant
- Barrel imports stay within boundaries
- Declared dependencies match actual imports

**But it doesn't generate the manifest.**

---

## 6. Agent Interaction Patterns

### From AGENTS.md (Section 3 & 5)

**Architect Mode** (triggered by "architect", "design", "plan", "update .architecture/manifest.yaml"):

> "When proposing architecture changes, reference the exact section of the manifest"
> "In Architect Mode, produce only the changed manifest section"

**Develop Mode** (triggered by "develop [feature]"):

> "Every file must correspond to a named element in `.architecture/manifest.yaml`. **Manifest-first**: when adding or changing a port/use-case/entity, update the manifest and run `yarn lint:arch` before writing or modifying any implementation file."

### Current Workflow

1. Agent updates `manifest.yaml` ← Manual edit
2. Agent runs `yarn lint:arch` ← Validates manifest
3. Agent creates implementation files (port interfaces, adapters, etc.)
4. Agent runs `yarn sync` ← Generator creates scaffolding
5. Human reviews and approves

**The manifest update step is ALWAYS manual.**

---

## 7. What Could Feasibly Be Auto-Generated

### Tier 1: High Confidence (Can be built now with existing patterns)

#### 7.1 Port Ownership Registry Auto-Population

**Today**: Manually edited in `generator.config.yaml`

**Could be auto-generated from**:

- Walk all `src/**/ports/{in,out}/*.port.ts` files
- Parse TypeScript interface definitions
- Match them to manifest declarations
- Auto-populate ownership registry

**Implementation approach**:

- Add a new generator: `generators/ownership-registry.ts`
- Parse TypeScript AST (using ts-morph or similar)
- Match exported interfaces to manifest port names
- Write to `generator.config.yaml` ownership-registry section

**Preconditions**:

- Ports are already named consistently in manifest
- Port files follow naming convention `{PortName}.port.ts`

---

#### 7.2 Bounded Context Structure Validation Report

**Today**: Manual review by agent

**Could be auto-generated**:

- Scan `packages/{name}/src/` directory
- Verify it matches manifest declaration for that context
- Generate a report: "Missing adapters listed in manifest", "Extra files not in manifest", etc.

**Implementation**:

- New generator: `generators/structure-report.ts`
- Output: Machine-readable YAML or JSON

---

### Tier 2: Medium Confidence (Requires design decisions)

#### 7.3 Skeleton Manifest from Directory Scan

**Scenario**: Given a pre-existing monorepo with packages, generate a starter manifest

**Could discover**:

- Bounded contexts from `packages/*/` directories
- Use cases from `src/application/use-cases/*.ts` files
- Ports from `src/application/ports/{in,out}/*.ts` files
- Entities from `src/domain/entities/*.ts` files
- Adapters from `src/infrastructure/adapters/*.ts` files

**Challenges**:

- No semantic meaning in file names alone (which is a domain entity vs. a value object?)
- Port ownership ambiguous without cross-referencing imports
- Type relationships not extractable without AST parsing
- Would need human review/refinement anyway

**Feasibility**: Medium-high, but requires:

- TypeScript AST parsing (ts-morph)
- Smart defaults for type classification
- Reviewer template/wizard for ambiguous cases

---

#### 7.4 Dependency Graph from Import Analysis

**Could analyze**:

- Walk all `src/**/*.ts` files
- Extract `import ... from '@hexagen/*'` statements
- Build dependency graph
- Detect missing `depends_on` entries

**Challenges**:

- Imports inside a context don't always mean inter-context dependencies
- Transitive dependencies vs. direct dependencies
- Need to exclude internal-to-package imports

**Feasibility**: Medium (with caveats)

---

### Tier 3: Low Confidence (Architectural questions remain)

#### 7.5 Full Manifest from Code

**Scenario**: User provides existing TypeScript code, system generates manifest

**Challenges**:

- No standard way to mark domain entities vs. value objects in TypeScript
- Port ownership ambiguous without DDD documentation
- Use case semantics not derivable from code alone
- Circular reasoning: need manifest to validate, need code to generate manifest

**Feasibility**: Low — requires human-defined conventions or metadata (decorators, comments)

---

## 8. Gaps and Limitations in Current Tooling

### Gap 1: No Code-to-Manifest Reverse Engineering

**Issue**: If a human writes code first (e.g., a new port interface), the manifest is NOT automatically updated.

**Impact**: Manual burden to keep manifest in sync during rapid iteration

**Example**:

- Developer adds `src/application/ports/in/NewFeaturePort.ts`
- Manifest is now out of sync with actual code
- Linter won't catch this because it validates manifest → code, not code → manifest

### Gap 2: No Port Signature Synchronization Generator

**Issue**: `generator.config.yaml` mentions "synchronize-signatures" bootstrap step, but no implementation exists.

**Impact**: If a port interface signature changes, callers are not updated

**Code evidence**:

- `sync-engine.ts` line 246: `// Reap legacy layer folders` — reaper only deletes, doesn't sync
- No signature generator in `packages/sync/src/generators/`

### Gap 3: No Ownership Registry Auto-Maintenance

**Issue**: When adding a port to the manifest, developer must ALSO manually add it to `generator.config.yaml` ownership registry.

**Impact**:

- Two sources of truth diverge easily
- Linter can't validate port-single-ownership until both are updated
- Error-prone manual process

**Evidence**:

- `generator.config.yaml` line 72-74: "Auto-updated during sync — do not edit manually" is aspirational, not actual

### Gap 4: No Discovery of Adapters/Implementations

**Issue**: Manifest lists adapter names (e.g., `LocalStoragePersistenceAdapter`), but nothing validates they exist or implement the correct port.

**Impact**: Manifest can list non-existent adapters without consequence

### Gap 5: No Drift Detection

**Issue**: MVK spec mentions "drift-report-v1.md", but no generator creates or maintains it.

**Impact**: Manual oversight required to detect manifest → code drift

**Evidence**:

- `manifest.yaml` line 154: `driftReport: .architecture/mvk/drift-report-v1.md` — but file doesn't exist or isn't auto-generated

---

## 9. Recommendations for Auto-Generation Tooling

### Short Term (1-2 sprints)

#### 9.1 Ownership Registry Auto-Sync Generator

**Priority**: HIGH

**Implementation**:

1. Create `generators/ownership-registry.ts`
2. Scan manifest for all declared ports
3. Cross-reference with `generator.config.yaml`
4. Auto-add missing entries, flag removed entries
5. Integrate into bootstrap sequence after `load-ownership-map`

**Benefit**: Eliminates manual sync burden, makes generator.config.yaml actually auto-maintained

**Effort**: ~2-3 hours (AST parsing not needed, just manifest walking)

---

#### 9.2 Structure Validation Report Generator

**Priority**: MEDIUM

**Implementation**:

1. Create `generators/structure-report.ts`
2. For each bounded context:
   - Scan actual `packages/{name}/src/` directory
   - Compare against manifest declaration
   - Report: missing files, extra files, inconsistencies
3. Output JSON/YAML
4. Integrate into sync output

**Benefit**: Early detection of manifest-code divergence

**Effort**: ~3-4 hours

---

### Medium Term (1-2 months)

#### 9.3 TypeScript AST-Based Port Discovery

**Priority**: MEDIUM-HIGH

**Implementation**:

1. Use `ts-morph` to parse all `src/**/ports/**/*.port.ts` files
2. Extract exported interface names
3. Validate against manifest
4. Generate report or auto-suggest manifest updates
5. Add linter rule: "Port declared in manifest but not in code" → warn

**Benefit**: Detect unimplemented ports before linting

**Effort**: ~8-10 hours

---

#### 9.4 Dependency Graph Auto-Detection

**Priority**: MEDIUM

**Implementation**:

1. Scan all `src/**/*.ts` files
2. Parse `import ... from '@hexagen/...'` statements
3. Build inter-context dependency graph
4. Compare against manifest `depends_on`
5. Flag missing/extra dependencies
6. Optional: Auto-update manifest

**Benefit**: Ensures manifest dependencies match actual code

**Effort**: ~6-8 hours

---

### Long Term (1+ quarter)

#### 9.5 Reverse Generation from Existing Code

**Priority**: LOW (aspirational for template-based generation)

**Design questions**:

- Should use TypeScript decorators? JSDoc? Comments?
- How do humans mark @DomainEntity vs. @ValueObject?
- How do we derive use case boundaries from code?

**Prerequisite**: Establish metadata conventions in generated code

---

### Architectural Pattern: Bidirectional Sync Model

Instead of "manifest-only" or "code-only", consider:

```
manifest.yaml ←→ code/
     ↓               ↓
   schema         actual
   validators     implementation
```

**Rules**:

1. Manifest remains source of truth for architecture contracts
2. Code is source of truth for implementations
3. Two-phase validation:
   - **Phase 1**: Manifest → Code (ensure code stubs exist)
   - **Phase 2**: Code → Manifest (warn on discrepancies)
4. Both can trigger sync operations:
   - Manifest change → `yarn sync` regenerates scaffolding
   - Code change → `yarn sync --validate` reports divergence

---

## 10. Current State Summary Table

| Aspect                    | Status               | Evidence                                        |
| ------------------------- | -------------------- | ----------------------------------------------- |
| **Manifest → Code**       | ✅ Fully implemented | `SyncEngine` generators, ADR-0014               |
| **Code → Manifest**       | ❌ Not implemented   | No discovery generators exist                   |
| **Ownership Registry**    | ⚠️ Manual only       | generator.config.yaml must be edited by hand    |
| **Port Discovery**        | ❌ Not implemented   | No AST parser exists                            |
| **Adapter Validation**    | ❌ Not implemented   | Adapters listed but not verified to exist       |
| **Dependency Validation** | ⚠️ Partial           | Linter checks imports, but not against manifest |
| **Signature Sync**        | ❌ Not implemented   | "synchronize-signatures" bootstrap step is stub |
| **Drift Detection**       | ❌ Not implemented   | mvk/drift-report mentioned but not generated    |

---

## 11. Conclusion

**The manifest is currently a manually-authored, generator-aware contract document.** It is NOT auto-generated from code, though the architecture contains patterns that could support it:

1. **Manifest defines structure** → Generators create scaffolding
2. **Code fills in implementations** → Linter validates boundaries
3. **Manifest stays manually curated** → Ensures architectural intent is explicit

**To make manifest.yaml fully auto-generated**, the system would need:

- **Phase 1** (Low Risk): Auto-sync ownership registry, detect structure divergence
- **Phase 2** (Medium Risk): AST-based port discovery, dependency graph analysis
- **Phase 3** (High Risk): Reverse generation from existing code (requires metadata conventions)

**Recommendation**: Start with Phase 1 (ownership registry auto-sync) to eliminate the most manual pain point, then evaluate Phase 2 based on feedback from that implementation.
