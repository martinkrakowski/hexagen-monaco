# Refactoring Assistant — Technical Documentation

## Overview

The Refactoring Assistant is a production-grade toolchain for performing safe, validated architectural refactorings across the hexagen-monaco monorepo. It provides automated impact analysis, cross-package dependency tracking, and rollback-safe execution with architectural boundary validation.

## Documentation Index

### Core Components

1. **[Impact Analyzer](./impact-analyzer.md)** — Cross-package dependency analysis and refactoring impact assessment
2. **[Refactoring Patterns](./refactoring-patterns.md)** — Domain-specific refactoring operations (rename port, use case, entity)
3. **[Refactoring Engine](./refactoring-engine.md)** — File system mutation engine with atomic operations
4. **[Safe Refactoring Orchestrator](./safe-refactoring-orchestrator.md)** — Git-backed validation and rollback orchestration
5. **[CLI Integration](./cli-integration.md)** — Command-line interface for refactoring operations

### Architecture

- **Package:** `@hexagen/sync`
- **Location:** `packages/sync/src/refactoring/`
- **Architectural Layer:** Application + Infrastructure
- **Dependencies:** `@hexagen/governance`, `@hexagen/project-configuration`, Node.js fs/git

### Quick Start

```bash
# Analyze refactoring impact
yarn hexagen arch refactor analyze --type port --target UserRepositoryPort --new-name UserStoragePort

# Execute safe refactoring with validation
yarn hexagen arch refactor rename-port UserRepositoryPort UserStoragePort

# Preview changes without applying
yarn hexagen arch refactor rename-use-case CreateUser CreateUserAccount --dry-run
```

### Design Principles

1. **Safety First** — All refactorings create git backup branches before execution
2. **Validation-Driven** — Architectural boundaries validated before and after changes
3. **Atomic Operations** — All file mutations succeed or rollback completely
4. **Observable** — Detailed impact analysis and progress reporting
5. **Deterministic** — Same input always produces same output

### Status

✅ **Production Ready** — All phases complete and validated

- Phase 7.1: Design Specification
- Phase 7.2: Impact Analyzer
- Phase 7.3: Refactoring Patterns
- Phase 7.4: Refactoring Engine
- Phase 7.5: Safe Refactoring Orchestrator
- Phase 7.6: CLI Integration

### Related Documentation

- [`.architecture/manifest.yaml`](../../.architecture/manifest.yaml) — Architectural boundaries
- [`AGENTS.md`](../../AGENTS.md) — Development rules and constraints
- [`packages/sync/README.md`](../../packages/sync/README.md) — CLI tooling overview
