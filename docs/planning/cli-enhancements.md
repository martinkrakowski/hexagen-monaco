Phase Architecture Overview

| Phase | Priority    | Features / Tasks                                                                                                                                                                          |
| ----- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | HIGH        | `hexagen arch diff` — Show manifest changes<br>`--force` flag everywhere — Non-interactive mode<br>`hexagen arch edit` — Direct YAML editor                                               |
| 2     | HIGH        | Test doubles for remove commands<br>Unit tests for remove commands                                                                                                                        |
| 3     | MEDIUM      | Unify YAML parsing — Single source of truth<br>`Result<T,E>` everywhere — Consistent error handling<br>Shared command base — DRY CLI commands                                             |
| 4     | MEDIUM      | `hexagen arch export` — Export to JSON/YAML<br>`hexagen arch import` — Import from file<br>Tab completion — Bash/Zsh/Fish support                                                         |
| 5     | MEDIUM/LOW  | Progress indicators — Spinners, progress bars<br>Better error messages — Actionable diagnostics<br>Colored output — ANSI escape codes<br>Interactive confirmation defaults — `--yes` flag |
| 6     | HIGH/MEDIUM | Command reference in AGENTS.md<br>Tutorial: Adding bounded context<br>Tutorial: Adding new port                                                                                           |
| 7     | LOW         | `--json` output — Machine-readable results<br>`--quiet` mode — Suppress non-essential output<br>Video/gif demos — README enhancements                                                     |

---

# 🚀 PHASE 1: CLI Enhancements (HIGH Priority)

## Feature 1.1: `hexagen arch diff` - Show Manifest Changes

### Architecture Overview

**Goal:** Preview changes before committing to manifest.yaml without writing files.

**Design Pattern:** Follows existing persistence layer with dry-run mode.

```typescript
interface DiffResult {
  type: "port" | "context";
  operation: "add" | "remove" | "modify";
  contextName?: string;
  name?: string;
  direction?: "in" | "out";
}

interface ManifestDiff {
  portsAdded: DiffResult[];
  portsRemoved: DiffResult[];
  contextsAdded: DiffResult[];
  contextsRemoved: DiffResult[];
  hasChanges: boolean;
}
```

### Atomic Implementation Steps

**STEP 1.1.1: Create diff module**

- File: `packages/sync/src/commands/arch/diff.ts`
- Responsibilities:
  - Load current manifest from `.architecture/manifest.yaml`
  - Compare with provided changes (via stdin or temp file)
  - Generate structured diff output
  - Support `--dry-run` mode

**STEP 1.1.2: Implement diff algorithms**

- File: `packages/sync/src/commands/arch/diff.ts` (same file, new functions)
- Functions to implement:

  ```typescript
  function diffPorts(
    current: string[],
    proposed: string[],
  ): { added: string[]; removed: string[] };

  function diffContexts(
    current: Manifest["bounded_contexts"],
    proposed: Manifest["bounded_contexts"],
  ): DiffResult[];
  ```

**STEP 1.1.3: Wire into CLI**

- File: `packages/sync/src/cli.ts`
- Add subcommand to arch command:
  ```typescript
  archCommand
    .command("diff")
    .description("Preview manifest changes before applying")
    .option(
      "--from <file>",
      "Source file to diff against",
      ".architecture/manifest.yaml",
    )
    .action(async (options) => {
      await runDiff(options);
    });
  ```

**STEP 1.1.4: Add test coverage**

- File: `packages/sync/__tests__/commands/arch/diff.test.ts`
- Test scenarios:
  - Identical manifests → no diff
  - Port addition → shows in portsAdded
  - Context removal → shows in contextsRemoved

---

## Feature 1.2: `--force` Flag Everywhere (Non-Interactive Mode)

### Architecture Overview

**Goal:** Enable scripting/automation by skipping confirmation prompts when `--force` is provided.

**Design Pattern:** Configuration flag passed through command handlers, conditional on user interaction.

```typescript
interface ForceFlags {
  force: boolean; // Skip port/context removal confirmations
  forceRoot: boolean; // Overwrite protected root files (existing)
  forceManifest: boolean; // New: skip manifest modification prompts
}
```

### Atomic Implementation Steps

**STEP 1.2.1: Define flag interface**

- File: `packages/sync/src/config.ts` (extend existing SyncFlags)
- Add new properties to configuration types
- Ensure type safety across all command handlers

**STEP 1.2.2: Update remove commands for --force**

- File: `packages/sync/src/commands/arch/remove/port.ts`
- Modify confirmation logic:
  ```typescript
  const confirmed = options.force || (await confirmRemoval(port, rl));
  if (!confirmed) {
    console.info("👋 Removal cancelled.");
    return;
  }
  ```

**STEP 1.2.3: Update context removal for --force**

- File: `packages/sync/src/commands/arch/remove/context.ts`
- Same pattern as port removal, applied to context confirmation

**STEP 1.2.4: Wire flags through CLI**

- File: `packages/sync/src/cli.ts`
- Add flag parsing:
  ```typescript
  .command("remove")
    .option("--force", "Skip confirmation prompts (for scripting)")
    .action(async (options) => { ... });
  ```

---

## Feature 1.3: `hexagen arch edit` - Direct YAML Editor

### Architecture Overview

**Goal:** Allow users to manually edit manifest.yaml via a safe interactive editor with validation.

**Design Pattern:** Similar to port/context wizards but allows arbitrary edits rather than guided input.

```typescript
interface EditSession {
  originalManifest: Manifest;
  editedContent: string; // Raw YAML from editor
  isValidYaml: boolean; // Parsed successfully?
  validationErrors: string[]; // YAML format errors
  semanticValidations: string[]; // Architecture rule violations
}

interface EditorResult {
  success: boolean;
  manifest?: Manifest; // If valid and user confirmed
  errors?: string[]; // If invalid or cancelled
}
```

### Atomic Implementation Steps

**STEP 1.3.1: Create editor module**

- File: `packages/sync/src/commands/arch/edit.ts`
- Responsibilities:
  - Read manifest.yaml
  - Launch external text editor (using child_process)
  - On save, validate YAML syntax and structure
  - Present validation errors to user with option to retry

**STEP 1.3.2: Implement YAML validation**

- File: `packages/sync/src/commands/arch/edit.ts` (new functions)
- Functions:

  ```typescript
  function parseYaml(content: string): {
    success: boolean;
    data?: Manifest;
    error?: Error;
  };

  function validateManifestStructure(manifest: Manifest): string[];
  // Returns list of semantic errors (e.g., "context 'users' has no layers defined")
  ```

**STEP 1.3.3: Implement editor launch logic**

- File: `packages/sync/src/commands/arch/edit.ts` (same file)
- Logic:
  - Detect preferred editor from environment (`$VISUAL`, `$EDITOR`)
  - Fall back to reasonable defaults (nano, vim, notepad)
  - Create temp manifest file for editing
  - Wait for editor to close
  - Read edited content and validate

**STEP 1.3.4: Wire into CLI**

- File: `packages/sync/src/cli.ts`
- Add subcommand:
  ```typescript
  archCommand
    .command("edit")
    .description("Manually edit manifest.yaml with validation")
    .action(async () => {
      await runEdit();
    });
  ```

---

# 🧪 PHASE 2: Testing Improvements (HIGH Priority)

## Feature 2.1: Test Doubles for Remove Commands

### Architecture Overview

**Goal:** Create test doubles that implement exact same interfaces as real adapters (test double parity).

**Design Pattern:** Per AGENTS.md §8, every port adapter must have a corresponding test double.

```typescript
// Real adapter interface
interface ContextPersistence {
  loadManifest(cwd: string): Manifest;
  saveManifest(manifest: Manifest, cwd: string): void;
}

// Test double (implements same interface)
export interface ContextPersistenceFake extends ContextPersistence {
  setLoadError(error: Error): void;
  setSaveError(error: Error): void;
  getLoadCount(): number;
  getSaveCount(): number;
  clear(): void;
}

// Implementation provides controlled behavior for testing
```

### Atomic Implementation Steps

**STEP 2.1.1: Create port removal test double interface**

- File: `packages/sync/__tests__/commands/arch/remove/port-fake.ts`
- Interface definition matching real adapter's public API
- Methods for controlling load/save behavior in tests

**STEP 2.1.2: Implement port removal fake class**

- File: `packages/sync/__tests__/commands/arch/remove/port-fake.ts` (same file)
- Implementation of interface with controlled side effects:
  - Track method call counts
  - Inject errors for failure scenarios
  - Return predefined manifests for specific inputs

**STEP 2.1.3: Create context removal test double interface**

- File: `packages/sync/__tests__/commands/arch/remove/context-fake.ts`
- Same pattern as port-fake, adapted for context operations

**STEP 2.1.4: Implement context removal fake class**

- File: `packages/sync/__tests__/commands/arch/remove/context-fake.ts` (same file)
- Full implementation with test control methods

---

## Feature 2.2: Unit Tests for Remove Commands

### Architecture Overview

**Goal:** Comprehensive test coverage for remove operations following the pattern established by port persistence tests.

**Test Categories per AGENTS.md §8:**

1. Happy path (valid operation succeeds)
2. Error handling (malformed input, file errors)
3. Edge cases (empty state, boundary conditions)

### Atomic Implementation Steps

**STEP 2.2.1: Create port removal test suite structure**

- File: `packages/sync/__tests__/commands/arch/remove/port.test.ts`
- Test file skeleton with describe/it blocks organized by scenario type

**STEP 2.2.2: Implement happy path tests (port)**

- File: `packages/sync/__tests__/commands/arch/remove/port.test.ts`
- Tests:
  - Valid selection → port removed from manifest
  - Confirmation y → operation completes
  - Atomic write succeeds → no temp file left behind

**STEP 2.2.3: Implement error handling tests (port)**

- File: `packages/sync/__tests__/commands/arch/remove/port.test.ts`
- Tests:
  - Manifest load failure → user-friendly error message, exit code 1
  - Invalid selection input → warning + retry prompt
  - Save failure → temp file cleanup, error reported

**STEP 2.2.4: Implement edge case tests (port)**

- File: `packages/sync/__tests__/commands/arch/remove/port.test.ts`
- Tests:
  - No contexts exist → informative message, graceful exit
  - No ports in any context → informative message
  - User cancels at confirmation → no changes made

**STEP 2.2.5: Create context removal test suite structure**

- File: `packages/sync/__tests__/commands/arch/remove/context.test.ts`
- Same organization as port tests

**STEP 2.2.6: Implement happy path tests (context)**

- File: `packages/sync/__tests__/commands/arch/remove/context.test.ts`
- Tests:
  - Valid selection → context removed from manifest
  - All ports in context also removed
  - Confirmation y → operation completes

**STEP 2.2.7: Implement error handling tests (context)**

- File: `packages/sync/__tests__/commands/arch/remove/context.test.ts`
- Tests:
  - Manifest load failure → graceful exit with message
  - Invalid selection input → retry prompt
  - Save failure → cleanup, error reported

**STEP 2.2.8: Implement edge case tests (context)**

- File: `packages/sync/__tests__/commands/arch/remove/context.test.ts`
- Tests:
  - Empty manifest (no contexts) → informative message
  - User cancels at confirmation → no changes made
  - Context with nested structures → all removed correctly

---

# 🏗️ PHASE 3: Architecture Improvements (MEDIUM Priority)

## Feature 3.1: Unify YAML Parsing

### Architecture Overview

**Goal:** Single source of truth for YAML loading/saving across entire CLI to ensure consistency and reduce duplication.

**Current State:** Multiple files independently import js-yaml and handle parsing:

- `port/persistence.ts` - uses generateManifestYaml
- `remove/port.ts` - direct require("js-yaml").load()
- `remove/context.ts` - direct load() call

**Target State:** Centralized YAML service with consistent error handling.

```typescript
// packages/sync/src/yaml-service.ts
export interface YamlService {
  load(content: string): Manifest;
  save(manifest: Manifest): string;
  loadFromFile(path: string): Manifest;
  saveToFile(manifest: Manifest, path: string): void;
}

// Implementation uses singleton pattern or dependency injection
```

### Atomic Implementation Steps

**STEP 3.1.1: Create YAML service interface**

- File: `packages/sync/src/yaml-service.ts` (new file)
- Define interface with all parsing/loading methods
- Document error handling behavior for each method

**STEP 3.1.2: Implement YAML service class**

- File: `packages/sync/src/yaml-service.ts` (same file)
- Use js-yaml load/save functions
- Wrap in Result<T, E> pattern for type-safe errors
- Add validation step after loading (structure checks)

**STEP 3.1.3: Refactor port persistence to use service**

- File: `packages/sync/src/commands/arch/port/persistence.ts`
- Replace direct js-yaml imports with YAMLService dependency injection
- Update all read/write operations to use service methods

**STEP 3.1.4: Refactor remove commands to use service**

- File: `packages/sync/src/commands/arch/remove/port.ts`, `context.ts`
- Inject YAMLService and replace direct file I/O calls
- Ensure atomic write pattern preserved

**STEP 3.1.5: Create YAML service test suite**

- File: `packages/sync/__tests__/yaml-service.test.ts`
- Tests for:
  - Valid manifest loading → returns parsed object
  - Invalid YAML syntax → descriptive error message
  - Save/serialization → valid YAML output
  - Round-trip (load → save → load) → identical content

---

## Feature 3.2: Result<T, E> Pattern Everywhere

### Architecture Overview

**Goal:** Consistent error handling across all CLI operations using Result type pattern.

**Current State:** Mixed error handling patterns:

- Some functions use try/catch with process.exit()
- Some return Result types
- Inconsistent error propagation

**Target State:** All fallible operations return `Result<T, E>` for composable error handling.

```typescript
// packages/sync/src/types/result.ts (new file)
export type Result<T, E = Error> =
  | { success: true; value: T }
  | { success: false; error: E };

function ok<T>(value: T): Result<T> {
  return { success: true, value };
}
function err<E>(error: E): Result<never, E> {
  return { success: false, error };
}

// Usage in command handlers:
const result = loadManifest(manifestPath);
if (!result.success) {
  console.error(`Failed to load manifest: ${result.error.message}`);
  process.exit(1);
}
```

### Atomic Implementation Steps

**STEP 3.2.1: Create Result type utilities**

- File: `packages/sync/src/types/result.ts` (new file)
- Define Result<T, E> union type
- Implement helper functions: ok(), err(), map(), flatMap(), unwrap()

**STEP 3.2.2: Refactor manifest loading to use Result**

- File: `packages/sync/src/manifest-service.ts`
- Change loadManifest signature from throwing errors to returning Result<Manifest, LoadError>
- Update all callers to handle Result pattern

**STEP 3.2.3: RefactoryamlService methods to return Result**

- File: `packages/sync/src/yaml-service.ts` (created in STEP 3.1.1)
- All methods return Result<T, YamlError> with specific error types for each failure mode

**STEP 3.2.4: Refactor remove commands to use Result**

- Files: `packages/sync/src/commands/arch/remove/port.ts`, `context.ts`
- Replace process.exit() calls with Result returns from helper functions
- Main command handler decides whether to exit or continue based on Result value

**STEP 3.2.5: Create Result type test suite**

- File: `packages/sync/__tests__/types/result.test.ts`
- Tests for all utility functions (ok, err, map, flatMap, unwrap)
- Test error chaining and composition patterns

---

## Feature 3.3: Shared Command Base

### Architecture Overview

**Goal:** Reduce code duplication across CLI commands by extracting common functionality into shared base class/functions.

**Current Duplication Identified:**

- All interactive wizards use `rl.question()` wrapper function
- All file I/O uses same atomic write pattern (temp + rename)
- All confirmation prompts follow identical structure
- All error handling patterns are similar

```typescript
// packages/sync/src/commands/shared.ts (new file)
export interface BaseCommandOptions {
  force?: boolean;
  quiet?: boolean;
}

export async function ask(
  rl: readline.Interface,
  prompt: string,
): Promise<string> {
  return new Promise((resolve) => rl.question(prompt, resolve));
}

export async function confirm(
  rl: readline.Interface,
  prompt: string,
  force?: boolean,
): Promise<boolean> {
  if (force) return true;
  const answer = await ask(rl, `${prompt} (y/n): `);
  return answer.toLowerCase() === "y";
}

export async function atomicWrite(
  path: string,
  content: string,
  logger?: Logger,
): Promise<Result<void, Error>> {
  // Temp file + rename pattern with error handling
}
```

### Atomic Implementation Steps

**STEP 3.3.1: Create shared command utilities module**

- File: `packages/sync/src/commands/shared.ts` (new file)
- Extract common functions from existing commands:
  - ask() wrapper for readline.Interface
  - confirm() with force flag support
  - atomicWrite() helper with temp file handling

**STEP 3.3.2: Create base command class/interface**

- File: `packages/sync/src/commands/shared.ts` (same file, new exports)
- Define abstract interface for all arch commands:
  ```typescript
  export interface BaseArchCommand {
    execute(options: BaseCommandOptions): Promise<void>;
    getCommandName(): string;
    getDescription(): string;
  }
  ```

**STEP 3.3.3: Refactor port wizard to use shared utilities**

- File: `packages/sync/src/commands/arch/port.ts` (or command.ts if split)
- Replace inline ask() wrapper with imported shared.ask()
- Use shared.confirm() instead of custom confirmation logic
- Use shared.atomicWrite() for manifest persistence

**STEP 3.3.4: Refactor context wizard to use shared utilities**

- File: `packages/sync/src/commands/arch/context/wizard.ts`
- Same pattern as port wizard, applying shared functions

**STEP 3.3.5: Refactor remove commands to use shared utilities**

- Files: `packages/sync/src/commands/arch/remove/port.ts`, `context.ts`
- Apply shared.ask(), confirm(), and atomicWrite() consistently
- Ensure force flag behavior works correctly across all removal operations

---

# 📦 PHASE 4: Additional Features (MEDIUM Priority)

## Feature 4.1: `hexagen arch export` - Export Manifest to File

### Atomic Implementation Steps

**STEP 4.1.1: Create export command module**

- File: `packages/sync/src/commands/arch/export.ts`
- Load manifest from `.architecture/manifest.yaml`
- Support multiple output formats via flags: --format json|yaml
- Write to specified file or stdout if no path provided

**STEP 4.1.2: Implement format conversion logic**

- File: `packages/sync/src/commands/arch/export.ts` (same file)
- JSON export: `JSON.stringify(manifest, null, 2)` with proper formatting
- YAML export: Use yamlService.save() for consistent serialization

**STEP 4.1.3: Wire into CLI with flags**

- File: `packages/sync/src/cli.ts`
- Add subcommand:
  ```typescript
  archCommand
    .command("export")
    .description("Export manifest to file in JSON or YAML format")
    .option("--format <type>", "Output format (yaml|json)", "yaml")
    .option("-o, --output <path>", "Output file path (stdout if omitted)")
    .action(async (options) => {
      await runExport(options);
    });
  ```

**STEP 4.1.4: Add export tests**

- File: `packages/sync/__tests__/commands/arch/export.test.ts`
- Test JSON vs YAML output formats
- Verify file write with --output flag
- Test stdout output when no path provided

---

## Feature 4.2: `hexagen arch import` - Import Manifest from File

### Atomic Implementation Steps

**STEP 4.2.1: Create import command module**

- File: `packages/sync/src/commands/arch/import.ts` (new file)
- Load manifest from provided file path
- Validate structure before importing
- Compare with current manifest to detect changes
- Option to merge or overwrite

**STEP 4.2.2: Implement validation logic**

- File: `packages/sync/src/commands/arch/import.ts` (same file)
- Check required fields exist in imported manifest
- Validate context names follow snake_case format
- Validate port names follow PascalCase format

**STEP 4.2.3: Implement merge vs overwrite modes**

- File: `packages/sync/src/commands/arch/import.ts` (same file, new functions)
- Merge mode: combine contexts, resolve conflicts by timestamp or user selection
- Overwrite mode: replace entire manifest with imported version

**STEP 4.2.4: Wire into CLI with flags**

- File: `packages/sync/src/cli.ts`
- Add subcommand:
  ```typescript
  archCommand
    .command("import")
    .description("Import manifest from file (merge or overwrite)")
    .requiredOption("--from <path>", "Source file to import from")
    .option("--mode <type>", "Import mode (merge|overwrite)", "merge")
    .action(async (options) => {
      await runImport(options);
    });
  ```

**STEP 4.2.5: Add import tests**

- File: `packages/sync/__tests__/commands/arch/import.test.ts`
- Test valid manifest import with merge mode
- Test overwrite mode replaces entire manifest
- Test validation errors for malformed manifests

---

## Feature 4.3: Tab Completion Support

### Architecture Overview

**Goal:** Enable bash/zsh/fish tab completion for all CLI commands and flags.

**Design Pattern:** Commander.js has built-in support for generating completion scripts.

```bash
# User runs once to install completions
hexagen completion > /usr/local/etc/bash_completion/hexagen
source /usr/local/etc/bash_completion/hexagen

# Or use generated script directly
eval "$(hexagen completion --shell bash)"
```

### Atomic Implementation Steps

**STEP 4.3.1: Add Commander.js completion generation**

- File: `packages/sync/src/cli.ts` (modify existing program definition)
- Ensure all commands and options are properly named for completion
- Commander.js will generate completions automatically from command structure

**STEP 4.3.2: Create completion script generator**

- File: `packages/sync/src/commands/completion.ts` (new file)
- Function to output bash/zsh/fish completion scripts
- Use Commander.js program.generateCompletion() method

**STEP 4.3.3: Wire completion subcommand into CLI**

- File: `packages/sync/src/cli.ts`
- Add hidden subcommand:
  ```typescript
  program
    .command("completion")
    .description("Output shell completion script")
    .option("--shell <type>", "Shell type (bash|zsh|fish)", "bash")
    .action(() => {
      generateCompletion();
    });
  ```

**STEP 4.3.4: Add README documentation for tab completion**

- File: `README.md` (modify existing file)
- Document how to install completions for each shell type
- Provide example commands and troubleshooting tips

---

# 🎨 PHASE 5: User Experience Improvements (MEDIUM/LOW Priority)

## Feature 5.1: Progress Indicators

### Atomic Implementation Steps

**STEP 5.1.1: Create progress utility module**

- File: `packages/sync/src/utils/progress.ts` (new file)
- Functions for creating spinner animations and progress bars
- Support both terminal and non-terminal output modes

**STEP 5.1.2: Integrate spinners into sync engine**

- File: `packages/sync/src/sync-engine.ts`
- Add spinner during long-running operations (file generation, validation)
- Update spinner status messages dynamically

**STEP 5.1.3: Wire --force to skip interactive prompts in remove commands**

- Files: `packages/sync/src/commands/arch/remove/port.ts`, `context.ts`
- When force flag is true, skip all confirmation prompts and proceed directly with deletion

---

## Feature 5.2: Better Error Messages

### Atomic Implementation Steps

**STEP 5.2.1: Create error types module**

- File: `packages/sync/src/types/errors.ts` (new file)
- Define specific error classes for different failure modes:
  - ManifestLoadError with context-aware message
  - ValidationError with suggested fixes
  - PermissionError with resolution steps

**STEP 5.2.2: Update all error handling to use new types**

- Files: All command handlers and service layers
- Replace generic Error objects with specific error types
- Ensure each error type has actionable message for users

---

## Feature 5.3: Colored Output

### Atomic Implementation Steps

**STEP 5.3.1: Create color utility module**

- File: `packages/sync/src/utils/colors.ts` (new file)
- Functions to wrap text with ANSI escape codes
- Detect terminal support for colors, fall back gracefully

**STEP 5.3.2: Apply colors throughout CLI output**

- All command handlers and service layers
- Colors for success/error/warning/status indicators
- Respect --no-color flag for scripting use cases

---

## Feature 5.4: Interactive Confirmation Defaults

### Atomic Implementation Steps

**STEP 5.4.1: Create confirmation configuration module**

- File: `packages/sync/src/config.ts` (modify existing file)
- Add default confirmation behavior settings
- Support environment variables for customization

**STEP 5.4.2: Apply defaults to remove commands**

- Files: `packages/sync/src/commands/arch/remove/port.ts`, `context.ts`
- Use configured defaults when --force not specified

---

# 📚 PHASE 6: Documentation (HIGH/MEDIUM Priority)

## Feature 6.1: Command Reference in AGENTS.md

### Atomic Implementation Steps

**STEP 6.1.1: Document all arch commands with examples**

- File: `AGENTS.md` (modify existing file, CLI reference section)
- Add detailed command reference for all hexagen arch subcommands
- Include usage examples and flag descriptions

---

## Feature 6.2: Tutorial - Adding a New Bounded Context

### Atomic Implementation Steps

**STEP 6.2.1: Create tutorial markdown file**

- File: `docs/tutorials/adding-bounded-context.md` (new directory/file)
- Step-by-step guide for users following wizard workflow
- Include screenshots or terminal output examples

---

## Feature 6.3: Tutorial - Adding a New Port

### Atomic Implementation Steps

**STEP 6.3.1: Create tutorial markdown file**

- File: `docs/tutorials/adding-port.md` (new directory/file)
- Similar structure to context tutorial, port-specific content
- Include common patterns and best practices

---

# 🔧 PHASE 7: LOW Priority Polish

## Feature 7.1: --json Output Mode

### Atomic Implementation Steps

**STEP 7.1.1: Add JSON output option to list/validate commands**

- File: `packages/sync/src/cli.ts` (modify command definitions)
- Add --json flag that outputs machine-readable results instead of formatted text
- Ensure all structured data is properly serialized

---

## Feature 7.2: --quiet Mode

### Atomic Implementation Steps

**STEP 7.2.1: Create quiet mode configuration**

- File: `packages/sync/src/config.ts` (modify existing file)
- Add quiet flag to suppress non-essential output
- Only show errors and final status in quiet mode

---

## Feature 7.3: Video/GIF Demos

### Atomic Implementation Steps

**STEP 7.3.1: Create demo recordings**

- Record terminal sessions demonstrating key workflows
- Convert to GIF format for README integration
- Keep file sizes reasonable, optimize compression

---

# 📊 Implementation Priority Matrix

```
┌───────────┬───────┬─────────────────────────────────────────────────────────┐
│ Phase     │ Days  │ Tasks                                                    │
├───────────┼───────┼─────────────────────────────────────────────────────────┤
│ PHASE 1   │ 2-3   │ diff, --force flag, edit command                        │
│ PHASE 2   │ 1     │ test doubles + unit tests for remove                    │
│ PHASE 3   │ 1     │ YAML service, Result pattern, shared base               │
│ PHASE 4   │ 0.5   │ export, import, tab completion                          │
│ PHASE 5   │ 0.5   │ progress, error messages, colors, defaults              │
│ PHASE 6   │ 0.5   │ AGENTS.md reference + tutorials                         │
│ PHASE 7   │ 0.25  │ --json, --quiet, demos                                  │
├───────────┼───────┼─────────────────────────────────────────────────────────┤
│ TOTAL     │ ~6    │ 49 atomic steps across all phases                       │
└───────────┴───────┴─────────────────────────────────────────────────────────┘
```

---

# 🎯 Getting Started: First Three Steps

Ready to begin implementation? Start with these three immediate actions:

**STEP 1.1.1:** Create `packages/sync/src/commands/arch/diff.ts` with basic diff module structure

**STEP 2.1.1:** Create `packages/sync/__tests__/commands/arch/remove/port-fake.ts` test double interface

**STEP 3.1.1:** Create `packages/sync/src/yaml-service.ts` YAML service interface definition
