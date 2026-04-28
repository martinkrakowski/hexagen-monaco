# HexaGen Manifest CLI Tools — Agent Guidance

**Last Updated:** 2026-04-27  
**Purpose:** Prevent YAML corruption loops by documenting safe, CLI-based workflows for manifest editing.

---

## 1. Problem Statement

### Why Direct YAML Editing Fails

The `.architecture/manifest.yaml` file is a critical system document that defines the entire bounded context topology, ports, adapters, and dependencies. Editing it directly causes multiple failure modes:

- **Indentation Corruption**: YAML is whitespace-sensitive. Manual edits using `sed`, `awk`, or text editors easily misalign nested structures (e.g., under `ports:` or `adapters:`), making the file unparseable.
- **Validation Gaps**: Direct edits bypass the validation layer, allowing invalid configurations to slip through (e.g., duplicate port names, circular dependencies, missing required fields).
- **Incomplete Mutations**: Port registration without file scaffolding, or adapter registration without port contract, creates orphaned references.
- **Looping Behavior**: When an agent encounters a validation error after direct YAML edit, it often attempts to "fix" the YAML manually again, creating a correction loop that compounds the damage.

### Historical Context

This guidance emerged from the report-governance integration task, where direct manifest editing triggered a cascading series of indentation failures. Each attempted fix made the file less parseable, until restoring from git was the only recovery path.

**Learning:** Always use CLI tools for any manifest mutation. They handle validation, indentation, and cross-referential integrity automatically.

---

## 2. Available CLI Tools

All tools are available via MCP (Model Context Protocol) when running the `@hexagen/mcp-server`. They can be called by agents using structured JSON requests.

### Manifest Structure Tools

#### `hexagen_create_context`

**Description:** Register a new bounded context (core, supporting, driver, or shared-kernel type) in the manifest.

**Input Schema:**
| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `name` | string | Yes | Lowercase kebab-case, 3–50 chars, e.g. `user-management`. Cannot use reserved names: `shared`, `core`, `root`, `system`. |
| `type` | enum | Yes | One of: `core`, `supporting`, `driver`, `shared-kernel` |
| `description` | string | No | Free-form text describing the context's purpose. |
| `dry_run` | boolean | No | If `true`, validates input without persisting. Default: `false`. |

**Output:**

- `dryRun`: boolean — whether this was a dry run
- `registered`: boolean — context was created (false if already existed)
- `alreadyExisted`: boolean — context was already in manifest
- `message`: string — human-readable summary

**Common Usage:**

- Starting a new bounded context for a feature
- Expanding the architecture with supporting domains
- Creating shared-kernel contexts for cross-cutting concerns

**Example Call:**

```json
{
  "name": "hexagen_create_context",
  "arguments": {
    "name": "payment-processing",
    "type": "core",
    "description": "Handles payment authorization, capture, and reconciliation",
    "dry_run": false
  }
}
```

**Validation Error Examples:**

- `name must be lowercase kebab-case (e.g., 'user-management')` — use hyphens, not underscores or camelCase
- `cannot use reserved name 'core'` — rename to `core-domain`, `core-services`, etc.
- `type must be one of: core, supporting, driver, shared-kernel` — check enum values

---

#### `hexagen_create_port`

**Description:** Create an inbound or outbound port contract and register it in the manifest. Scaffolds the port interface file.

**Input Schema:**
| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `domain_name` | string | Yes | Name of the bounded context (must already exist). |
| `port_name` | string | Yes | Port identifier, e.g. `PaymentGatewayPort`. Usually PascalCase. |
| `type` | enum | Yes | One of: `inbound`, `outbound` |
| `dry_run` | boolean | No | Default: `false`. |

**Output:**

- `dryRun`: boolean
- `fileCreated`: string — path to created port interface file (optional)
- `message`: string

**Common Usage:**

- Adding inbound ports (HTTP handlers, message consumers, CLI commands)
- Adding outbound ports (database adapters, external service calls, file I/O)

**Example Calls:**

_Inbound port for HTTP REST endpoint:_

```json
{
  "name": "hexagen_create_port",
  "arguments": {
    "domain_name": "payment-processing",
    "port_name": "CreatePaymentPort",
    "type": "inbound",
    "dry_run": false
  }
}
```

_Outbound port for database:_

```json
{
  "name": "hexagen_create_port",
  "arguments": {
    "domain_name": "payment-processing",
    "port_name": "PaymentRepositoryPort",
    "type": "outbound",
    "dry_run": false
  }
}
```

**Key Notes:**

- Inbound ports are typically injectable dependencies passed to use-cases
- Outbound ports represent contracts to external systems (repos, APIs, messaging)
- Port name convention: use `*Port` suffix for clarity

---

#### `hexagen_create_adapter`

**Description:** Create an infrastructure adapter that implements a port contract. Scaffolds the adapter implementation file.

**Input Schema:**
| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `port_name` | string | Yes | Name of the port being implemented, e.g. `PaymentRepositoryPort`. Must end with `Port`. |
| `infrastructure_name` | string | Yes | Bounded context where the adapter lives. Usually named `*-infrastructure`. |
| `dry_run` | boolean | No | Default: `false`. |

**Output:**

- `dryRun`: boolean
- `fileCreated`: string — path to created adapter file (optional)
- `message`: string

**Common Usage:**

- Creating PostgreSQL adapters for repository ports
- Creating REST client adapters for external APIs
- Creating message queue adapters for event publishing

**Example Call:**

```json
{
  "name": "hexagen_create_adapter",
  "arguments": {
    "port_name": "PaymentRepositoryPort",
    "infrastructure_name": "payment-infrastructure",
    "dry_run": false
  }
}
```

**Behavior:**

- Automatically derives adapter name: `PaymentRepository` + `Adapter` → `PaymentRepositoryAdapter`
- Links the adapter to the port in manifest for traceability
- Creates a scaffold with proper structure (imports, exports, class skeleton)

---

#### `hexagen_add_dependency`

**Description:** Register a dependency relationship between two modules. Use when module A imports from module B.

**Input Schema:**
| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `source_module` | string | Yes | Module that depends on the target (the importer). |
| `target_module` | string | Yes | Module being depended on (the imported). |
| `dry_run` | boolean | No | Default: `false`. |

**Output:**

- `dryRun`: boolean
- `updated`: boolean — dependency was added or already existed
- `message`: string

**Common Usage:**

- After implementing a cross-module import, declare it in manifest for linting
- Bridge dependencies when two contexts must communicate
- Document transitive dependencies for architecture documentation

**Example Calls:**

_Application layer depends on domain:_

```json
{
  "name": "hexagen_add_dependency",
  "arguments": {
    "source_module": "payment-processing/application",
    "target_module": "payment-processing/domain",
    "dry_run": false
  }
}
```

_One core context depends on shared-kernel:_

```json
{
  "name": "hexagen_add_dependency",
  "arguments": {
    "source_module": "user-management/core",
    "target_module": "shared-kernel",
    "dry_run": false
  }
}
```

**Validation:**

- If `target_module` does not exist, linter will reject it
- Circular dependencies are detected after `yarn lint:arch`
- Cross-layer imports (e.g., application importing infrastructure) are flagged as violations

---

### Port/Adapter Management Tools

#### `hexagen_remove_port`

**Description:** Remove an inbound or outbound port contract from a bounded context. Does not delete the scaffolded file, only the manifest reference.

**Input Schema:**
| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `context_name` | string | Yes | Bounded context containing the port. |
| `port_name` | string | Yes | Port to remove. |
| `direction` | enum | Yes | One of: `inbound`, `outbound` |
| `dry_run` | boolean | No | Default: `false`. |

**Output:**

- `dryRun`: boolean
- `removed`: boolean — port was found and removed
- `message`: string

**Common Usage:**

- Consolidating redundant ports
- Removing deprecated interfaces during refactoring
- Fixing duplicate port registrations (anti-pattern)

**Example Call:**

```json
{
  "name": "hexagen_remove_port",
  "arguments": {
    "context_name": "payment-processing",
    "port_name": "LegacyPaymentPort",
    "direction": "inbound",
    "dry_run": false
  }
}
```

**Important:** After removal, ensure no adapters reference this port, else `yarn lint:arch` will fail.

---

#### `hexagen_remove_context`

**Description:** Remove a bounded context entirely from the manifest. Does not delete source files in the repository.

**Input Schema:**
| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `context_name` | string | Yes | Bounded context to remove. |
| `dry_run` | boolean | No | Default: `false`. |

**Output:**

- `dryRun`: boolean
- `removed`: boolean — context was found and removed
- `message`: string

**Common Usage:**

- Retiring obsolete domains
- Consolidating contexts during system redesign
- Removing test/experimental bounded contexts

**Example Call:**

```json
{
  "name": "hexagen_remove_context",
  "arguments": {
    "context_name": "old-billing-system",
    "dry_run": false
  }
}
```

**Safety Checks:**

- Linter will report dangling dependencies if other contexts reference the removed context
- Always verify no other contexts depend on this before removal

---

### Scaffolding Tools

#### `hexagen_scaffold_module`

**Description:** Generate a complete module structure (folder, layer subdirectories, barrel exports) and register the bounded context.

**Input Schema:**
| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `name` | string | Yes | Module name, lowercase kebab-case. |
| `layer` | enum | Yes | One of: `domain`, `application`, `infrastructure` |
| `context_type` | enum | No | One of: `core`, `supporting`, `driver`, `shared-kernel`. Default: `core`. |
| `dry_run` | boolean | No | Default: `false`. |

**Output:**

- `dryRun`: boolean
- `message`: string
- `filesCreated`: string[] — paths to created files
- `registeredInManifest`: boolean — context was registered

**Common Usage:**

- Rapid initialization of new bounded contexts with full DSL structure
- Bootstrapping new features with pre-built directories and barrel exports
- Ensuring consistent folder layout across teams

**Example Call:**

```json
{
  "name": "hexagen_scaffold_module",
  "arguments": {
    "name": "notification-service",
    "layer": "domain",
    "context_type": "supporting",
    "dry_run": false
  }
}
```

**Output Example:**

```
message: "Scaffolded module notification-service and registered in manifest."
filesCreated: [
  "packages/notification-service/src/domain/entities/index.ts",
  "packages/notification-service/src/domain/ports/index.ts",
  "packages/notification-service/src/domain/use-cases/index.ts",
  "packages/notification-service/src/application/index.ts",
  "packages/notification-service/src/infrastructure/index.ts",
  ...
]
```

---

### Validation & Inspection Tools

#### `hexagen_diff_manifest`

**Description:** Compare current manifest against a reference (git HEAD or a file) and return structural diff. Useful for understanding what changed before committing.

**Input Schema:**
| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `compare_source` | enum | No | One of: `git_head`, `file`. Default: `git_head`. |
| `file_path` | string | No | Path to manifest file (required if `compare_source == 'file'`). |

**Output:**

- `diff`: object — structured diff object
- `formatted`: string — human-readable diff (plain text)

**Common Usage:**

- Before committing, verify all manifest changes are intentional
- Debugging architecture changes during code review
- Understanding which contexts/ports/adapters were added/removed

**Example Calls:**

_Compare against git HEAD (default):_

```json
{
  "name": "hexagen_diff_manifest",
  "arguments": {}
}
```

_Compare against a specific file:_

```json
{
  "name": "hexagen_diff_manifest",
  "arguments": {
    "compare_source": "file",
    "file_path": "/path/to/backup-manifest.yaml"
  }
}
```

**Output Example (formatted text):**

```
Added contexts:
  + payment-processing (core)

Added ports:
  + payment-processing/inbound: PaymentGatewayPort
  + payment-processing/outbound: PaymentRepositoryPort

Modified dependencies:
  - app/domain -> user/domain (removed)
  + app/domain -> payment-processing/domain (added)
```

---

#### `hexagen_audit_boundaries`

**Description:** Run the architecture linter and return a structured report of violations, warnings, and architectural insights.

**Input Schema:**
| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `dry_run` | boolean | No | Default: `true` (linter is read-only). |

**Output:**

- `dryRun`: boolean
- `report`: LinterReport object containing:
  - `violations`: array of rule violations
  - `warnings`: array of low-priority issues
  - `pass`: boolean — all rules passed

**Common Usage:**

- After every manifest mutation, verify architecture integrity
- Debugging boundary violations and dependency cycles
- Generating reports for architecture documentation

**Example Call:**

```json
{
  "name": "hexagen_audit_boundaries",
  "arguments": {
    "dry_run": true
  }
}
```

**Violation Categories:**

- **Boundary Violation**: Module imports from another without declared dependency
- **Port Single Ownership**: Port exists in multiple contexts (duplicate registration)
- **Circular Dependency**: Two contexts depend on each other
- **Layer Violation**: Infrastructure imports from application/domain
- **Port Not Implemented**: Outbound port has no registered adapter

---

## 3. Best Practices for Agents

### Golden Rule: Always Use CLI Tools

❌ **NEVER do this:**

```bash
# Direct YAML editing causes corruption
sed -i 's/old-context/new-context/g' .architecture/manifest.yaml
```

✅ **Always do this:**

```json
{
  "name": "hexagen_remove_context",
  "arguments": { "context_name": "old-context" }
}
// Then
{
  "name": "hexagen_create_context",
  "arguments": { "name": "new-context", "type": "core" }
}
```

### Verification Pattern

After every manifest mutation:

1. **Call the tool** with payload
2. **Check the output** for `message` and `error` fields
3. **Run `yarn lint:arch`** to validate architecture integrity
4. **Check `hexagen_audit_boundaries`** for violations
5. **Run `hexagen_diff_manifest`** to inspect changes before commit

```bash
# After tool call, run:
yarn lint:arch
```

If this fails, **STOP**. Do not proceed to next step. Fix the violation using the appropriate CLI tool.

### Batching Pattern

When performing multi-step mutations, batch related operations:

1. **Create context** → verify
2. **Add ports** (inbound + outbound together) → verify
3. **Add dependencies** → verify
4. **Run full audit** → verify
5. **Commit** (only after all pass)

Example:

```json
[
  {
    "tool": "hexagen_create_context",
    "args": { "name": "order-processing", "type": "core" }
  },
  {
    "tool": "hexagen_create_port",
    "args": {
      "domain_name": "order-processing",
      "port_name": "CreateOrderPort",
      "type": "inbound"
    }
  },
  {
    "tool": "hexagen_create_port",
    "args": {
      "domain_name": "order-processing",
      "port_name": "OrderRepositoryPort",
      "type": "outbound"
    }
  },
  {
    "tool": "hexagen_add_dependency",
    "args": {
      "source_module": "order-processing/application",
      "target_module": "order-processing/domain"
    }
  }
]
// Run yarn lint:arch after all
```

### Error Recovery

If `yarn lint:arch` fails after a mutation:

1. **Read the violation message carefully** — it specifies the exact rule violated
2. **Identify the problematic tool call** — which mutation caused it?
3. **Use the appropriate CLI tool to fix it**:
   - Missing dependency? Use `hexagen_add_dependency`
   - Duplicate port? Use `hexagen_remove_port` on the duplicate
   - Invalid layer? Use `hexagen_remove_context` and recreate with correct type
4. **Re-run `yarn lint:arch`** to confirm fix
5. **Never manually edit YAML** to patch violations

---

## 4. Common Orchestration Patterns

### Pattern 1: Add New Bounded Context with Full DSL Structure

**Scenario:** Adding a new core domain for order management.

**Steps:**

```json
// Step 1: Create context
{
  "name": "hexagen_create_context",
  "arguments": {
    "name": "order-management",
    "type": "core",
    "description": "Manages order lifecycle, fulfillment, and cancellation"
  }
}
```

```json
// Step 2: Add inbound port (REST API)
{
  "name": "hexagen_create_port",
  "arguments": {
    "domain_name": "order-management",
    "port_name": "CreateOrderPort",
    "type": "inbound"
  }
}
```

```json
// Step 3: Add outbound port (database)
{
  "name": "hexagen_create_port",
  "arguments": {
    "domain_name": "order-management",
    "port_name": "OrderRepositoryPort",
    "type": "outbound"
  }
}
```

```json
// Step 4: Add outbound port (messaging)
{
  "name": "hexagen_create_port",
  "arguments": {
    "domain_name": "order-management",
    "port_name": "OrderEventPublisherPort",
    "type": "outbound"
  }
}
```

```json
// Step 5: Register dependency on shared-kernel
{
  "name": "hexagen_add_dependency",
  "arguments": {
    "source_module": "order-management/domain",
    "target_module": "shared-kernel"
  }
}
```

```bash
# Step 6: Verify
yarn lint:arch
```

**Expected Output:**

- All context, ports, and dependencies registered
- No linter violations
- `yarn lint:arch` passes

---

### Pattern 2: Refactor Existing Context Structure

**Scenario:** Consolidating two old contexts (`legacy-orders` and `order-fulfillment`) into one (`order-management`).

**Steps:**

```json
// Step 1: Inspect current state
{
  "name": "hexagen_diff_manifest",
  "arguments": { "compare_source": "git_head" }
}
```

Check the diff output to understand ports and dependencies of both old contexts.

```json
// Step 2: Create new unified context
{
  "name": "hexagen_create_context",
  "arguments": {
    "name": "order-management",
    "type": "core",
    "description": "Unified order processing domain"
  }
}
```

```json
// Step 3: Add all required ports
{
  "name": "hexagen_create_port",
  "arguments": {
    "domain_name": "order-management",
    "port_name": "CreateOrderPort",
    "type": "inbound"
  }
}
```

```json
// Step 4: Migrate dependencies from old contexts
{
  "name": "hexagen_add_dependency",
  "arguments": {
    "source_module": "order-management/application",
    "target_module": "order-management/domain"
  }
}
```

```bash
# Step 5: Verify new structure
yarn lint:arch
```

```json
// Step 6: Remove old contexts (only after verification)
{
  "name": "hexagen_remove_context",
  "arguments": { "context_name": "legacy-orders" }
}
```

```json
// Step 7: Remove second old context
{
  "name": "hexagen_remove_context",
  "arguments": { "context_name": "order-fulfillment" }
}
```

```bash
# Step 8: Final verification
yarn lint:arch
yarn test
git commit -m "Refactor: consolidate order management domains"
```

---

## 5. Anti-Patterns (What NOT to Do)

### Anti-Pattern 1: Direct YAML Editing

❌ **BAD:**

```bash
# NEVER use sed, awk, vim, or text editors directly
sed -i 's/my-context/new-context/g' .architecture/manifest.yaml
```

**Why:** Indentation corruption, validation bypass, orphaned references.

✅ **GOOD:**

```json
{ "name": "hexagen_remove_context", "arguments": { "context_name": "my-context" } }
{ "name": "hexagen_create_context", "arguments": { "name": "new-context", "type": "core" } }
```

---

### Anti-Pattern 2: Skipping `yarn lint:arch`

❌ **BAD:**

```bash
# Create context, add ports, then commit without verifying
yarn git add .architecture/manifest.yaml
yarn git commit -m "Add new context"
```

**Why:** Violations slip through into committed code. Other agents inherit broken architecture state.

✅ **GOOD:**

```bash
# Create context, add ports
yarn lint:arch  # VERIFY before commit
git commit -m "Add new context"
```

---

### Anti-Pattern 3: Modifying YAML After Tool Execution

❌ **BAD:**

```bash
# Use CLI tool, then "fix" the output by hand
hexagen_create_port --help
vim .architecture/manifest.yaml  # Then manually adjust indentation
```

**Why:** Introduces the same corruption the tool was designed to prevent.

✅ **GOOD:**

```bash
# Trust the tool. If output is wrong, report the error and retry.
# DO NOT manually edit after tool execution.
```

---

### Anti-Pattern 4: Circular Mutations Without Validation

❌ **BAD:**

```json
// Create context
// Remove port
// Add context again
// Add port again
// ... all without running yarn lint:arch between steps
```

**Why:** If an intermediate step fails, you won't know until the end. Harder to debug.

✅ **GOOD:**

```json
// Create context → yarn lint:arch
// Remove port → yarn lint:arch
// Add context again → yarn lint:arch
// Add port again → yarn lint:arch
```

---

### Anti-Pattern 5: Assuming Adapter Creation is Enough

❌ **BAD:**

```json
// Create adapter WITHOUT creating the port first
{
  "name": "hexagen_create_adapter",
  "arguments": {
    "port_name": "PaymentRepositoryPort",
    "infrastructure_name": "payment-infrastructure"
  }
}
```

**Why:** Linter will complain `Port PaymentRepositoryPort not found`. Adapter has no contract.

✅ **GOOD:**

```json
// Step 1: Create port
{ "name": "hexagen_create_port", "arguments": { "domain_name": "payment", "port_name": "PaymentRepositoryPort", "type": "outbound" } }
// Step 2: Create adapter
{ "name": "hexagen_create_adapter", "arguments": { "port_name": "PaymentRepositoryPort", "infrastructure_name": "payment-infrastructure" } }
```

---

## 6. Error Handling Guide

### Common Error Messages and Resolutions

#### Error: `[arch-lint] Boundary Violation: module-a imports module-b without declared dependency`

**Root Cause:** Code imports from another module, but manifest doesn't register the dependency.

**Fix:**

```json
{
  "name": "hexagen_add_dependency",
  "arguments": {
    "source_module": "module-a",
    "target_module": "module-b"
  }
}
```

Then:

```bash
yarn lint:arch
```

---

#### Error: `[arch-lint] Port Single Ownership Violation: port X exists in contexts A and B`

**Root Cause:** Port name was accidentally registered in two contexts.

**Fix:**

```json
{
  "name": "hexagen_remove_port",
  "arguments": {
    "context_name": "context-b", // The duplicate
    "port_name": "DuplicatePort",
    "direction": "outbound"
  }
}
```

Then:

```bash
yarn lint:arch
```

---

#### Error: `[arch-lint] Circular Dependency: A → B → C → A`

**Root Cause:** Contexts form a cycle. Break it by removing one edge.

**Fix:**

1. Identify which dependency is the "wrong" direction (typically application → infrastructure)
2. Remove it:

```json
{
  "name": "hexagen_remove_dependency",
  "arguments": {
    "source_module": "context-c",
    "target_module": "context-a"
  }
}
```

_(Note: If `hexagen_remove_dependency` isn't available, restructure using ports/adapters to break the cycle.)_

Then:

```bash
yarn lint:arch
```

---

#### Error: `YAML parse error: mapping values are not allowed here`

**Root Cause:** YAML indentation is corrupted (usually from direct editing).

**Recovery:**

1. Restore manifest from git:
   ```bash
   git checkout .architecture/manifest.yaml
   ```
2. Re-apply mutations using CLI tools (do NOT edit YAML by hand)
3. Verify:
   ```bash
   yarn lint:arch
   ```

---

#### Error: `Port PaymentRepositoryPort not found in any context`

**Root Cause:** Adapter was created before port, or port was removed without removing adapters.

**Fix:**

1. Check if port exists:
   ```json
   { "name": "hexagen_diff_manifest", "arguments": {} }
   ```
2. If port is missing, create it:
   ```json
   {
     "name": "hexagen_create_port",
     "arguments": {
       "domain_name": "payment",
       "port_name": "PaymentRepositoryPort",
       "type": "outbound"
     }
   }
   ```
3. Re-create adapter:
   ```json
   {
     "name": "hexagen_create_adapter",
     "arguments": {
       "port_name": "PaymentRepositoryPort",
       "infrastructure_name": "payment-infrastructure"
     }
   }
   ```

Then:

```bash
yarn lint:arch
```

---

## 7. Integration with Sub-Agent Workflows

### For Orchestrator Agents

When delegating manifest-related work to sub-agents:

1. **Inject this file** into the sub-agent's system prompt:

   ```
   Read `.agents/manifest-cli-guidance.md` for best practices.
   ```

2. **Specify which tools are required** for the task:

   ```
   Use hexagen_create_context and hexagen_create_port to implement the bounded context DSL.
   Use hexagen_audit_boundaries after all mutations.
   ```

3. **Enforce verification gates**:
   ```
   After every tool call, run: yarn lint:arch
   If linter fails, fix using appropriate CLI tool (never manual YAML editing).
   ```

### For Sub-Agents Receiving Delegated Tasks

When asked to modify `.architecture/manifest.yaml`:

1. **Read this file first** (no permission needed, just read it)
2. **Plan your tool calls** before executing (e.g., create context → add ports → add dependencies)
3. **Execute tools in sequence**, verifying after each step
4. **Report back** with summary of changes and linter status:

   ```
   Completed:
   - Created context: order-management
   - Added ports: CreateOrderPort (inbound), OrderRepositoryPort (outbound)
   - Added dependency: order-management/application → order-management/domain

   Verification: yarn lint:arch ✓ PASSED
   ```

### Template for Sub-Agent Instructions

When delegating manifest work:

```markdown
## Manifest Mutation Task

You are tasked with updating `.architecture/manifest.yaml` using CLI tools.

### Required Reading

- `.agents/manifest-cli-guidance.md` (mandatory before any tool use)

### Constraints

- **NEVER edit YAML directly**. Always use hexagen CLI tools.
- After every tool call, run `yarn lint:arch` to verify architecture integrity.
- If linter fails, use appropriate CLI tool to fix (do NOT manually edit YAML).

### Tools Available

- hexagen_create_context
- hexagen_create_port
- hexagen_add_dependency
- hexagen_audit_boundaries
- hexagen_diff_manifest

### Success Criteria

- All manifest changes applied using CLI tools
- `yarn lint:arch` passes
- `hexagen_diff_manifest` shows intentional changes only
- No YAML files were edited manually

### Your Task

[Specific mutation request here]
```

---

## 8. Quick Reference: Tool Selection Matrix

Use this table to choose the right tool for your task:

| Task                           | Tool(s)                    | Verification     |
| ------------------------------ | -------------------------- | ---------------- |
| Add new bounded context        | `hexagen_create_context`   | `yarn lint:arch` |
| Add port to context            | `hexagen_create_port`      | `yarn lint:arch` |
| Create adapter for port        | `hexagen_create_adapter`   | `yarn lint:arch` |
| Connect modules via dependency | `hexagen_add_dependency`   | `yarn lint:arch` |
| Remove redundant port          | `hexagen_remove_port`      | `yarn lint:arch` |
| Remove obsolete context        | `hexagen_remove_context`   | `yarn lint:arch` |
| Scaffold full module           | `hexagen_scaffold_module`  | `yarn lint:arch` |
| Check for violations           | `hexagen_audit_boundaries` | (read-only)      |
| Review recent changes          | `hexagen_diff_manifest`    | (read-only)      |

---

## 9. Troubleshooting Checklist

Before asking for help, verify:

- [ ] Have you read this entire file? (`manifest-cli-guidance.md`)
- [ ] Did you use CLI tools, not direct YAML editing?
- [ ] Did you run `yarn lint:arch` after each mutation?
- [ ] Did you run `hexagen_audit_boundaries` to check for violations?
- [ ] Did you compare manifest changes with `hexagen_diff_manifest`?
- [ ] If linter failed, did you use CLI tools to fix (not manual edit)?
- [ ] Are all required fields present in tool input (check schema)?
- [ ] Did you restore from git before retrying (if corruption occurred)?

---

## 10. Summary

**The core principle:** CLI tools are defensive barriers against YAML corruption. They validate, scaffold, and maintain referential integrity automatically.

**When in doubt:** Use the tool. If the tool fails, read the error message, fix using another tool, and verify with `yarn lint:arch`. Never reach for a text editor.

**Report issues:** If a CLI tool itself is broken (not your usage of it), report to: https://github.com/anomalyco/opencode/issues

---

**End of Guidance Document**

Generated for HexaGen Monaco team. Last reviewed: 2026-04-27.
