# Phase 7: Refactoring Assistant — Design Specification

**Status:** Design Complete — Ready for Implementation
**Estimated Effort:** 12-15 hours
**Priority:** P1 (High) — Enables autonomous architectural refactoring
**Created:** 2026-04-28
**Author:** Bob (Lead Architecture Developer)

---

## Executive Summary

The Refactoring Assistant is an AI-agent-friendly tool that enables **safe, automated refactoring** of TypeScript codebases while maintaining architectural integrity. It provides:

1. **Change Impact Analysis** — Identifies all files affected by a proposed refactoring
2. **Automated Refactoring Engine** — Executes common refactoring patterns using TypeScript AST manipulation
3. **Safe Refactoring Mode** — Validates architectural boundaries and runs tests before committing changes
4. **Rollback Capability** — Automatic rollback on validation failures

This tool bridges the gap between "manual refactoring" (error-prone, time-consuming) and "AI-suggested refactoring" (often breaks boundaries or introduces regressions).

---

## Problem Statement

### Current State (Gaps)

**Gap 1: No Change Impact Analysis**

- Renaming a port/entity/use-case requires manually finding all references
- Cross-package dependencies are invisible until build fails
- No way to preview "blast radius" before making changes

**Gap 2: Manual Refactoring is Error-Prone**

- Renaming requires 10-15 manual file edits
- Easy to miss barrel exports, test doubles, MCP tool registrations
- No validation that architectural boundaries are preserved

**Gap 3: No Safe Refactoring Workflow**

- Changes are applied immediately without validation
- No automatic rollback on test failures
- No way to preview changes before applying

**Gap 4: AI Agents Can't Refactor Safely**

- No tool to query "what files will this rename affect?"
- No tool to execute "rename X to Y across all layers"
- No tool to validate "does this refactoring preserve hexagonal boundaries?"

### Desired State

**Capability 1: Impact Analysis**

```bash
# Query impact before making changes
hexagen refactor analyze --rename-port UserRepositoryPort:UserStorePort

# Output:
# Impact Analysis: Rename UserRepositoryPort → UserStorePort
#
# Files to modify (8):
#   - packages/user-management/src/application/ports/out/user-repository.port.ts
#   - packages/user-management/src/infrastructure/adapters/postgres-user-repository.adapter.ts
#   - packages/user-management/src/infrastructure/adapters/index.ts
#   - packages/user-management/src/application/use-cases/create-user.use-case.ts
#   - packages/user-management/src/lib/wire.server.ts
#   - packages/user-management/__tests__/doubles/ports/user-repository.fake.ts
#   - packages/mcp-server/src/infrastructure/adapters/mcp-server.adapter.ts
#   - .architecture/manifest.yaml
#
# Cross-package dependencies (1):
#   - @hexagen/mcp-server imports UserRepositoryPort
#
# Architectural impact: SAFE (no boundary violations)
```

**Capability 2: Automated Refactoring**

```bash
# Execute refactoring with validation
hexagen refactor execute --rename-port UserRepositoryPort:UserStorePort --safe

# Output:
# [1/8] Analyzing impact...
# [2/8] Validating architectural boundaries...
# [3/8] Creating backup branch...
# [4/8] Applying changes...
# [5/8] Updating manifest.yaml...
# [6/8] Running yarn build && yarn typecheck...
# [7/8] Running yarn test...
# [8/8] Committing changes...
#
# ✅ Refactoring complete: UserRepositoryPort → UserStorePort
# Modified 8 files, 0 errors
```

**Capability 3: Safe Mode with Rollback**

```bash
# If validation fails, automatic rollback
hexagen refactor execute --rename-use-case CreateUser:RegisterUser --safe

# Output:
# [1/8] Analyzing impact...
# [2/8] Validating architectural boundaries...
# [3/8] Creating backup branch...
# [4/8] Applying changes...
# [5/8] Updating manifest.yaml...
# [6/8] Running yarn build && yarn typecheck...
# ❌ Build failed: Type error in create-user.use-case.ts:42
# [7/8] Rolling back changes...
# [8/8] Restoring from backup branch...
#
# ❌ Refactoring failed: Build errors detected
# Changes rolled back, workspace restored
```

---

## Architecture

### Component Structure

```
packages/sync/src/
├── refactoring/
│   ├── index.ts                          # Public API
│   ├── impact-analyzer.ts                # Change impact analysis
│   ├── refactoring-engine.ts             # AST-based refactoring execution
│   ├── safe-refactoring-orchestrator.ts  # Safe mode with validation
│   ├── refactoring-patterns/             # Refactoring pattern implementations
│   │   ├── rename-port.pattern.ts
│   │   ├── rename-use-case.pattern.ts
│   │   ├── rename-entity.pattern.ts
│   │   ├── move-use-case.pattern.ts
│   │   └── extract-port.pattern.ts
│   └── validators/
│       ├── boundary-validator.ts         # Hexagonal boundary validation
│       ├── manifest-validator.ts         # Manifest consistency validation
│       └── test-validator.ts             # Test execution validation
```

### Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. IMPACT ANALYSIS PHASE                                        │
│                                                                  │
│  User Request                                                    │
│       ↓                                                          │
│  ImpactAnalyzer.analyze(refactoringRequest)                     │
│       ↓                                                          │
│  ┌─────────────────────────────────────────────────────┐       │
│  │ • Parse TypeScript AST (ts-morph)                    │       │
│  │ • Find all references to target symbol               │       │
│  │ • Identify cross-package dependencies                │       │
│  │ • Check manifest.yaml declarations                   │       │
│  │ • Detect barrel exports, test doubles, MCP tools     │       │
│  └─────────────────────────────────────────────────────┘       │
│       ↓                                                          │
│  ImpactAnalysisResult {                                         │
│    filesToModify: string[]                                      │
│    crossPackageDeps: Dependency[]                               │
│    architecturalImpact: "SAFE" | "BOUNDARY_VIOLATION"           │
│    estimatedChanges: number                                     │
│  }                                                               │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ 2. REFACTORING EXECUTION PHASE                                  │
│                                                                  │
│  ImpactAnalysisResult                                           │
│       ↓                                                          │
│  RefactoringEngine.execute(pattern, impactResult)               │
│       ↓                                                          │
│  ┌─────────────────────────────────────────────────────┐       │
│  │ • Load refactoring pattern (e.g., RenamePortPattern) │       │
│  │ • Apply AST transformations to each file             │       │
│  │ • Update barrel exports                              │       │
│  │ • Update manifest.yaml                               │       │
│  │ • Update test doubles                                │       │
│  │ • Update MCP tool registrations                      │       │
│  └─────────────────────────────────────────────────────┘       │
│       ↓                                                          │
│  RefactoringResult {                                            │
│    success: boolean                                             │
│    filesModified: string[]                                      │
│    errors: Error[]                                              │
│  }                                                               │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ 3. SAFE MODE VALIDATION PHASE (Optional)                        │
│                                                                  │
│  RefactoringResult                                              │
│       ↓                                                          │
│  SafeRefactoringOrchestrator.validate()                         │
│       ↓                                                          │
│  ┌─────────────────────────────────────────────────────┐       │
│  │ 1. Create backup branch (git worktree)               │       │
│  │ 2. Run yarn build && yarn typecheck                  │       │
│  │ 3. Run yarn lint:arch                                │       │
│  │ 4. Run yarn test                                     │       │
│  │ 5. If any fail → rollback from backup                │       │
│  │ 6. If all pass → commit changes                      │       │
│  └─────────────────────────────────────────────────────┘       │
│       ↓                                                          │
│  ValidationResult {                                             │
│    valid: boolean                                               │
│    buildPassed: boolean                                         │
│    testsPassed: boolean                                         │
│    archLintPassed: boolean                                      │
│  }                                                               │
└─────────────────────────────────────────────────────────────────┘
```

---

## Implementation Plan

### Phase 7.1: Impact Analyzer (3 hours)

**File:** `packages/sync/src/refactoring/impact-analyzer.ts`

**Responsibilities:**

- Parse TypeScript AST using ts-morph
- Find all references to a symbol (port, use case, entity)
- Identify cross-package dependencies
- Detect barrel exports, test doubles, MCP tool registrations
- Check manifest.yaml for declarations

**Key Functions:**

```typescript
export interface ImpactAnalysisRequest {
  type:
    | "rename-port"
    | "rename-use-case"
    | "rename-entity"
    | "move-use-case"
    | "extract-port";
  target: string; // e.g., "UserRepositoryPort"
  newName?: string; // e.g., "UserStorePort" (for renames)
  newLocation?: string; // e.g., "packages/user-store" (for moves)
}

export interface ImpactAnalysisResult {
  filesToModify: Array<{
    path: string;
    reason: string; // e.g., "Imports UserRepositoryPort"
    layer: "domain" | "application" | "infrastructure" | "test" | "manifest";
  }>;
  crossPackageDeps: Array<{
    fromPackage: string;
    toPackage: string;
    symbol: string;
  }>;
  architecturalImpact: "SAFE" | "BOUNDARY_VIOLATION" | "UNKNOWN";
  estimatedChanges: number;
  warnings: string[];
}

export class ImpactAnalyzer {
  constructor(
    private readonly workspaceRoot: string,
    private readonly manifest: Manifest,
  ) {}

  async analyze(
    request: ImpactAnalysisRequest,
  ): Promise<Result<ImpactAnalysisResult, Error>> {
    // 1. Find all TypeScript files in workspace
    // 2. Parse each file with ts-morph
    // 3. Find references to target symbol
    // 4. Classify each reference by layer
    // 5. Check for cross-package dependencies
    // 6. Validate architectural boundaries
    // 7. Return impact analysis result
  }
}
```

**Algorithm:**

1. **Load workspace files**
   - Use `ts-morph` Project to load all `.ts` files
   - Filter by packages (exclude node_modules, dist)

2. **Find symbol references**
   - For each source file:
     - Find import statements referencing target symbol
     - Find type references in function signatures
     - Find class/interface declarations extending/implementing target
     - Find variable declarations with target type

3. **Classify references by layer**
   - Parse file path to determine layer (domain/application/infrastructure)
   - Check if reference crosses package boundaries
   - Flag boundary violations (e.g., domain importing infrastructure)

4. **Check manifest.yaml**
   - Parse manifest to find declarations of target symbol
   - Identify which bounded context owns the symbol

5. **Detect special files**
   - Barrel exports (`index.ts`)
   - Test doubles (`__tests__/doubles/`)
   - MCP tool registrations (`mcp-server/src/infrastructure/adapters/`)
   - Composition roots (`lib/wire.server.ts`)

6. **Return impact result**
   - List all files to modify
   - Flag architectural violations
   - Estimate number of changes

**Edge Cases:**

- Symbol not found → return error
- Symbol used in multiple packages → flag as cross-package dependency
- Symbol used in domain layer → flag as high-risk refactoring
- Circular dependencies → flag as warning

---

### Phase 7.2: Refactoring Patterns (4 hours)

**Files:**

- `packages/sync/src/refactoring/refactoring-patterns/rename-port.pattern.ts`
- `packages/sync/src/refactoring/refactoring-patterns/rename-use-case.pattern.ts`
- `packages/sync/src/refactoring/refactoring-patterns/rename-entity.pattern.ts`
- `packages/sync/src/refactoring/refactoring-patterns/move-use-case.pattern.ts`
- `packages/sync/src/refactoring/refactoring-patterns/extract-port.pattern.ts`

**Pattern Interface:**

```typescript
export interface RefactoringPattern {
  name: string;
  description: string;

  /**
   * Validate that the refactoring is safe to execute
   */
  validate(
    request: ImpactAnalysisRequest,
    impact: ImpactAnalysisResult,
  ): Result<void, Error>;

  /**
   * Execute the refactoring by applying AST transformations
   */
  execute(
    request: ImpactAnalysisRequest,
    impact: ImpactAnalysisResult,
  ): Promise<Result<RefactoringResult, Error>>;
}

export interface RefactoringResult {
  success: boolean;
  filesModified: string[];
  errors: Error[];
  warnings: string[];
}
```

**Pattern 1: Rename Port**

```typescript
export class RenamePortPattern implements RefactoringPattern {
  name = "rename-port";
  description = "Rename a port interface and update all references";

  validate(
    request: ImpactAnalysisRequest,
    impact: ImpactAnalysisResult,
  ): Result<void, Error> {
    // 1. Check that target is a port (ends with "Port")
    // 2. Check that newName is valid (PascalCase, ends with "Port")
    // 3. Check that newName doesn't already exist
    // 4. Check for boundary violations
    if (impact.architecturalImpact === "BOUNDARY_VIOLATION") {
      return err(
        new Error("Refactoring would violate architectural boundaries"),
      );
    }
    return ok(undefined);
  }

  async execute(
    request: ImpactAnalysisRequest,
    impact: ImpactAnalysisResult,
  ): Promise<Result<RefactoringResult, Error>> {
    const filesModified: string[] = [];
    const errors: Error[] = [];

    // 1. Rename port interface file
    const portFile = impact.filesToModify.find((f) =>
      f.reason.includes("Port declaration"),
    );
    if (portFile) {
      const result = await this.renamePortFile(
        portFile.path,
        request.target,
        request.newName!,
      );
      if (result.success) {
        filesModified.push(portFile.path);
      } else {
        errors.push(...result.errors);
      }
    }

    // 2. Update all import statements
    for (const file of impact.filesToModify.filter((f) =>
      f.reason.includes("Imports"),
    )) {
      const result = await this.updateImports(
        file.path,
        request.target,
        request.newName!,
      );
      if (result.success) {
        filesModified.push(file.path);
      } else {
        errors.push(...result.errors);
      }
    }

    // 3. Update barrel exports
    for (const file of impact.filesToModify.filter((f) =>
      f.path.endsWith("index.ts"),
    )) {
      const result = await this.updateBarrelExport(
        file.path,
        request.target,
        request.newName!,
      );
      if (result.success) {
        filesModified.push(file.path);
      } else {
        errors.push(...result.errors);
      }
    }

    // 4. Update manifest.yaml
    const manifestResult = await this.updateManifest(
      request.target,
      request.newName!,
    );
    if (manifestResult.success) {
      filesModified.push(".architecture/manifest.yaml");
    } else {
      errors.push(...manifestResult.errors);
    }

    // 5. Update test doubles
    for (const file of impact.filesToModify.filter((f) =>
      f.path.includes("__tests__/doubles"),
    )) {
      const result = await this.updateTestDouble(
        file.path,
        request.target,
        request.newName!,
      );
      if (result.success) {
        filesModified.push(file.path);
      } else {
        errors.push(...result.errors);
      }
    }

    return ok({
      success: errors.length === 0,
      filesModified,
      errors,
      warnings: [],
    });
  }

  private async renamePortFile(
    filePath: string,
    oldName: string,
    newName: string,
  ): Promise<Result<void, Error>> {
    // Use ts-morph to:
    // 1. Load source file
    // 2. Find interface declaration
    // 3. Rename interface
    // 4. Save file
    // 5. Rename file itself (user-repository.port.ts → user-store.port.ts)
  }

  private async updateImports(
    filePath: string,
    oldName: string,
    newName: string,
  ): Promise<Result<void, Error>> {
    // Use ts-morph to:
    // 1. Load source file
    // 2. Find import declarations
    // 3. Update named imports
    // 4. Update type references
    // 5. Save file
  }

  private async updateBarrelExport(
    filePath: string,
    oldName: string,
    newName: string,
  ): Promise<Result<void, Error>> {
    // Use ts-morph to:
    // 1. Load source file
    // 2. Find export declarations
    // 3. Update export names
    // 4. Save file
  }

  private async updateManifest(
    oldName: string,
    newName: string,
  ): Promise<Result<void, Error>> {
    // Use js-yaml to:
    // 1. Load manifest.yaml
    // 2. Find port declaration
    // 3. Update port name
    // 4. Save manifest.yaml
  }

  private async updateTestDouble(
    filePath: string,
    oldName: string,
    newName: string,
  ): Promise<Result<void, Error>> {
    // Use ts-morph to:
    // 1. Load source file
    // 2. Find class declaration
    // 3. Rename class
    // 4. Update implements clause
    // 5. Save file
    // 6. Rename file itself
  }
}
```

**Pattern 2: Rename Use Case** (Similar structure to RenamePortPattern)

**Pattern 3: Rename Entity** (Similar structure to RenamePortPattern)

**Pattern 4: Move Use Case** (More complex - involves moving files between packages)

**Pattern 5: Extract Port** (Creates new port from existing adapter)

---

### Phase 7.3: Refactoring Engine (2 hours)

**File:** `packages/sync/src/refactoring/refactoring-engine.ts`

**Responsibilities:**

- Load appropriate refactoring pattern
- Execute pattern with impact analysis result
- Collect results from all file modifications
- Report success/failure

```typescript
export class RefactoringEngine {
  private patterns: Map<string, RefactoringPattern> = new Map();

  constructor(workspaceRoot: string) {
    // Register all refactoring patterns
    this.patterns.set("rename-port", new RenamePortPattern(workspaceRoot));
    this.patterns.set(
      "rename-use-case",
      new RenameUseCasePattern(workspaceRoot),
    );
    this.patterns.set("rename-entity", new RenameEntityPattern(workspaceRoot));
    this.patterns.set("move-use-case", new MoveUseCasePattern(workspaceRoot));
    this.patterns.set("extract-port", new ExtractPortPattern(workspaceRoot));
  }

  async execute(
    request: ImpactAnalysisRequest,
    impact: ImpactAnalysisResult,
  ): Promise<Result<RefactoringResult, Error>> {
    const pattern = this.patterns.get(request.type);
    if (!pattern) {
      return err(new Error(`Unknown refactoring pattern: ${request.type}`));
    }

    // Validate before executing
    const validationResult = pattern.validate(request, impact);
    if (!validationResult.success) {
      return err(validationResult.error);
    }

    // Execute refactoring
    return await pattern.execute(request, impact);
  }
}
```

---

### Phase 7.4: Safe Refactoring Orchestrator (2 hours)

**File:** `packages/sync/src/refactoring/safe-refactoring-orchestrator.ts`

**Responsibilities:**

- Create backup branch before refactoring
- Execute refactoring
- Run validation suite (build, typecheck, lint:arch, test)
- Rollback on failure
- Commit on success

```typescript
export interface SafeRefactoringConfig {
  createBackup: boolean;
  runBuild: boolean;
  runTypecheck: boolean;
  runArchLint: boolean;
  runTests: boolean;
  autoCommit: boolean;
  commitMessage?: string;
}

export interface ValidationResult {
  valid: boolean;
  buildPassed: boolean;
  typecheckPassed: boolean;
  archLintPassed: boolean;
  testsPassed: boolean;
  errors: string[];
}

export class SafeRefactoringOrchestrator {
  constructor(
    private readonly workspaceRoot: string,
    private readonly impactAnalyzer: ImpactAnalyzer,
    private readonly refactoringEngine: RefactoringEngine,
  ) {}

  async executeWithValidation(
    request: ImpactAnalysisRequest,
    config: SafeRefactoringConfig,
  ): Promise<
    Result<RefactoringResult & { validation: ValidationResult }, Error>
  > {
    // 1. Analyze impact
    const impactResult = await this.impactAnalyzer.analyze(request);
    if (!impactResult.success) {
      return err(impactResult.error);
    }

    // 2. Create backup branch if enabled
    let backupBranch: string | null = null;
    if (config.createBackup) {
      backupBranch = await this.createBackupBranch();
    }

    try {
      // 3. Execute refactoring
      const refactoringResult = await this.refactoringEngine.execute(
        request,
        impactResult.value,
      );
      if (!refactoringResult.success) {
        if (backupBranch) {
          await this.rollbackFromBackup(backupBranch);
        }
        return err(new Error("Refactoring failed"));
      }

      // 4. Run validation suite
      const validationResult = await this.validate(config);
      if (!validationResult.valid) {
        if (backupBranch) {
          await this.rollbackFromBackup(backupBranch);
        }
        return err(new Error("Validation failed"));
      }

      // 5. Commit changes if enabled
      if (config.autoCommit) {
        await this.commitChanges(
          config.commitMessage || `refactor: ${request.type} ${request.target}`,
        );
      }

      // 6. Clean up backup branch
      if (backupBranch) {
        await this.deleteBackupBranch(backupBranch);
      }

      return ok({
        ...refactoringResult.value,
        validation: validationResult,
      });
    } catch (error) {
      // Rollback on any error
      if (backupBranch) {
        await this.rollbackFromBackup(backupBranch);
      }
      return err(error as Error);
    }
  }

  private async createBackupBranch(): Promise<string> {
    const branchName = `refactor-backup-${Date.now()}`;
    await execAsync(`git checkout -b ${branchName}`, {
      cwd: this.workspaceRoot,
    });
    return branchName;
  }

  private async rollbackFromBackup(backupBranch: string): Promise<void> {
    await execAsync(`git checkout ${backupBranch}`, {
      cwd: this.workspaceRoot,
    });
    await execAsync(`git reset --hard HEAD`, { cwd: this.workspaceRoot });
  }

  private async deleteBackupBranch(backupBranch: string): Promise<void> {
    await execAsync(`git branch -D ${backupBranch}`, {
      cwd: this.workspaceRoot,
    });
  }

  private async validate(
    config: SafeRefactoringConfig,
  ): Promise<ValidationResult> {
    const result: ValidationResult = {
      valid: true,
      buildPassed: true,
      typecheckPassed: true,
      archLintPassed: true,
      testsPassed: true,
      errors: [],
    };

    // Run build
    if (config.runBuild) {
      try {
        await execAsync("yarn build", {
          cwd: this.workspaceRoot,
          timeout: 60_000,
        });
      } catch (error) {
        result.buildPassed = false;
        result.valid = false;
        result.errors.push(`Build failed: ${(error as Error).message}`);
      }
    }

    // Run typecheck
    if (config.runTypecheck) {
      try {
        await execAsync("yarn typecheck", {
          cwd: this.workspaceRoot,
          timeout: 60_000,
        });
      } catch (error) {
        result.typecheckPassed = false;
        result.valid = false;
        result.errors.push(`Typecheck failed: ${(error as Error).message}`);
      }
    }

    // Run arch lint
    if (config.runArchLint) {
      try {
        await execAsync("yarn lint:arch", {
          cwd: this.workspaceRoot,
          timeout: 30_000,
        });
      } catch (error) {
        result.archLintPassed = false;
        result.valid = false;
        result.errors.push(`Arch lint failed: ${(error as Error).message}`);
      }
    }

    // Run tests
    if (config.runTests) {
      try {
        await execAsync("yarn test", {
          cwd: this.workspaceRoot,
          timeout: 120_000,
        });
      } catch (error) {
        result.testsPassed = false;
        result.valid = false;
        result.errors.push(`Tests failed: ${(error as Error).message}`);
      }
    }

    return result;
  }

  private async commitChanges(message: string): Promise<void> {
    await execAsync(`git add -A`, { cwd: this.workspaceRoot });
    await execAsync(`git commit -m "${message}"`, { cwd: this.workspaceRoot });
  }
}
```

---

### Phase 7.5: CLI Integration (1 hour)

**File:** `packages/sync/src/commands/refactor.ts`

**Responsibilities:**

- Parse CLI arguments
- Invoke refactoring orchestrator
- Display progress and results

```typescript
import { Command } from "commander";
import { ImpactAnalyzer } from "../refactoring/impact-analyzer.js";
import { RefactoringEngine } from "../refactoring/refactoring-engine.js";
import { SafeRefactoringOrchestrator } from "../refactoring/safe-refactoring-orchestrator.js";

export function createRefactorCommand(): Command {
  const cmd = new Command("refactor");
  cmd.description("Analyze and execute safe refactorings");

  // Analyze subcommand
  cmd
    .command("analyze")
    .description("Analyze impact of a proposed refactoring")
    .option("--rename-port <old:new>", "Rename a port interface")
    .option("--rename-use-case <old:new>", "Rename a use case")
    .option("--rename-entity <old:new>", "Rename an entity")
    .action(async (options) => {
      // Parse options and invoke ImpactAnalyzer
      // Display impact analysis result
    });

  // Execute subcommand
  cmd
    .command("execute")
    .description("Execute a refactoring")
    .option("--rename-port <old:new>", "Rename a port interface")
    .option("--rename-use-case <old:new>", "Rename a use case")
    .option("--rename-entity <old:new>", "Rename an entity")
    .option("--safe", "Run in safe mode with validation and rollback")
    .option("--no-backup", "Skip creating backup branch")
    .option("--no-tests", "Skip running tests")
    .option("--auto-commit", "Automatically commit changes on success")
    .action(async (options) => {
      // Parse options and invoke SafeRefactoringOrchestrator
      // Display progress and results
    });

  return cmd;
}
```

---

## Testing Strategy

### Unit Tests

**File:** `packages/sync/__tests__/refactoring/impact-analyzer.test.ts`

```typescript
describe("ImpactAnalyzer", () => {
  it("should find all references to a port", async () => {
    // Arrange: Create test workspace with port and references
    // Act: Analyze impact of renaming port
    // Assert: All references found
  });

  it("should detect cross-package dependencies", async () => {
    // Arrange: Create test workspace with cross-package import
    // Act: Analyze impact
    // Assert: Cross-package dependency detected
  });

  it("should flag boundary violations", async () => {
    // Arrange: Create test workspace with domain importing infrastructure
    // Act: Analyze impact
    // Assert: Boundary violation flagged
  });
});
```

**File:** `packages/sync/__tests__/refactoring/rename-port.pattern.test.ts`

```typescript
describe("RenamePortPattern", () => {
  it("should rename port interface", async () => {
    // Arrange: Create test port file
    // Act: Execute rename pattern
    // Assert: Interface renamed
  });

  it("should update all import statements", async () => {
    // Arrange: Create test files importing port
    // Act: Execute rename pattern
    // Assert: All imports updated
  });

  it("should update manifest.yaml", async () => {
    // Arrange: Create test manifest with port declaration
    // Act: Execute rename pattern
    // Assert: Manifest updated
  });
});
```

### Integration Tests

**File:** `packages/sync/__tests__/refactoring/safe-refactoring.integration.test.ts`

```typescript
describe("SafeRefactoringOrchestrator (Integration)", () => {
  it("should execute refactoring with validation", async () => {
    // Arrange: Create test workspace
    // Act: Execute safe refactoring
    // Assert: Refactoring applied, validation passed
  });

  it("should rollback on validation failure", async () => {
    // Arrange: Create test workspace with failing test
    // Act: Execute safe refactoring
    // Assert: Changes rolled back
  });
});
```

---

## Edge Cases & Error Handling

### Edge Case 1: Symbol Not Found

**Scenario:** User requests rename of non-existent symbol
**Handling:** Return error from ImpactAnalyzer with clear message

### Edge Case 2: Circular Dependencies

**Scenario:** Refactoring creates circular dependency
**Handling:** Detect in validation phase, rollback

### Edge Case 3: Cross-Package Boundary Violation

**Scenario:** Refactoring would violate hexagonal boundaries
**Handling:** Flag in impact analysis, block execution

### Edge Case 4: Concurrent Modifications

**Scenario:** Files modified during refactoring
**Handling:** Use git worktree for isolation, detect conflicts

### Edge Case 5: Partial Failure

**Scenario:** Some files updated successfully, others fail
**Handling:** Rollback all changes, report which files failed

---

## Performance Considerations

### Optimization 1: Incremental Analysis

- Cache AST parsing results
- Only re-parse modified files
- Use ts-morph's incremental compilation

### Optimization 2: Parallel Execution

- Analyze files in parallel (worker threads)
- Apply transformations in parallel where safe

### Optimization 3: Lazy Loading

- Load refactoring patterns on-demand
- Don't parse entire workspace upfront

---

## Rollout Plan

### Phase 1: Core Implementation (8 hours)

- Implement ImpactAnalyzer
- Implement RenamePortPattern
- Implement RefactoringEngine
- Unit tests

### Phase 2: Safe Mode (2 hours)

- Implement SafeRefactoringOrchestrator
- Add validation suite
- Add rollback mechanism

### Phase 3: Additional Patterns (2 hours)

- Implement RenameUseCasePattern
- Implement RenameEntityPattern
- Integration tests

### Phase 4: CLI Integration (1 hour)

- Add refactor command
- Add progress reporting
- Documentation

---

## Success Criteria

✅ **Impact Analysis Works**

- Can analyze rename-port, rename-use-case, rename-entity
- Detects all file references
- Flags boundary violations

✅ **Refactoring Execution Works**

- Can execute rename-port pattern
- Updates all files correctly
- Updates manifest.yaml

✅ **Safe Mode Works**

- Creates backup branch
- Runs validation suite
- Rolls back on failure

✅ **Tests Pass**

- All unit tests pass
- All integration tests pass
- No regressions in existing functionality

---

## Future Enhancements

### Enhancement 1: AI-Powered Refactoring Suggestions

- Analyze codebase for refactoring opportunities
- Suggest "Extract Port" when adapter has no interface
- Suggest "Move Use Case" when use case is in wrong package

### Enhancement 2: Refactoring History

- Track all refactorings in `.architecture/refactoring-history.yaml`
- Enable undo/redo of refactorings
- Generate refactoring reports

### Enhancement 3: Interactive Mode

- Prompt user to confirm each file modification
- Show diff before applying
- Allow selective application

---

## Appendix: TypeScript AST Manipulation Examples

### Example 1: Rename Interface

```typescript
import { Project } from "ts-morph";

const project = new Project();
const sourceFile = project.addSourceFileAtPath("port.ts");

// Find interface
const interfaceDecl = sourceFile.getInterface("UserRepositoryPort");
if (interfaceDecl) {
  // Rename interface
  interfaceDecl.rename("UserStorePort");

  // Save file
  await sourceFile.save();
}
```

### Example 2: Update Import Statement

```typescript
const sourceFile = project.addSourceFileAtPath("use-case.ts");

// Find import declaration
const importDecl = sourceFile.getImportDeclaration(
  (decl) =>
    decl.getModuleSpecifierValue() === "../ports/out/user-repository.port.js",
);

if (importDecl) {
  // Update named import
  const namedImport = importDecl
    .getNamedImports()
    .find((ni) => ni.getName() === "UserRepositoryPort");
  if (namedImport) {
    namedImport.setName("UserStorePort");
  }

  await sourceFile.save();
}
```

### Example 3: Update Barrel Export

```typescript
const sourceFile = project.addSourceFileAtPath("index.ts");

// Find export declaration
const exportDecl = sourceFile.getExportDeclaration(
  (decl) => decl.getModuleSpecifierValue() === "./user-repository.port.js",
);

if (exportDecl) {
  // Update module specifier
  exportDecl.setModuleSpecifier("./user-store.port.js");

  // Update named export
  const namedExport = exportDecl
    .getNamedExports()
    .find((ne) => ne.getName() === "UserRepositoryPort");
  if (namedExport) {
    namedExport.setName("UserStorePort");
  }

  await sourceFile.save();
}
```

---

**End of Design Specification**

This design is ready for implementation. Estimated total effort: 12-15 hours.
