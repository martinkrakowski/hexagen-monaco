# ADR-0014: Code Generation as Post-Bootstrap Lifecycle Event

**Date:** 2026-04-07
**Status:** Accepted
**Type:** Architecture

## Context

During the implementation of project generation, a decision had to be made about what code gets generated during the initial bootstrap phase. The options were:

1. **Full generation** — Generate manifest + scaffold + implementation code (ports filled in, adapters implemented)
2. **Structural only** — Generate manifest + scaffold + empty stubs (ports/adapters as empty shells)

Option 1 was tempting because it delivers a "complete" project immediately, but it introduces significant complexity and coupling.

## Decision

**Project generation creates a structural skeleton only. Code generation is treated as a subsequent lifecycle event, not a bootstrapping event.**

### What Gets Generated on Bootstrap

- `.architecture/manifest.yaml` — The architecture definition
- Root configuration files — `package.json`, `tsconfig.json`, `turbo.json`, `.eslintrc.json`
- Bounded context directories — `packages/<context>/src/domain/`, `application/`, `infrastructure/`
- Empty barrel files — `index.ts` files that export nothing yet
- GitHub Actions workflow — `.github/workflows/sync-integrity.yml`

### What Gets Generated Later (Post-Bootstrap)

- Port interface implementations — The actual business logic
- Adapter implementations — Infrastructure code (database, API clients, etc.)
- Domain entities and value objects with actual behavior

These are generated via:

- CLI: `hexagen generate code` (via `@hexagen/code-generation`)
- Automated agents: Using MCP tools or OpenCode integration
- GitHub App: Opening Pull Requests automatically

## Rationale

### Pristine First Commit

A repository initialized with just the scaffolding has a clean, auditable first commit. This is valuable for:

- **Governance** — The initial commit establishes the architectural contract
- **Traceability** — You can always see what was scaffolded vs. what was added later
- **Git history clarity** — No mixed commits of "scaffold + generated code"

### Separation of Concerns

- **GenerateProjectUseCase** — Focused purely on establishing governance boundaries
- **Code generation** — Concerned with implementation, evolves independently
- **Different rates of change** — Architecture is stable; code changes frequently

### Scalability Concerns

Generating thousands of lines of code during a web UI wizard response would:

- Increase response latency significantly
- Consume server resources during the HTTP request
- Potentially timeout on serverless platforms

By deferring to a separate process, we keep the bootstrap fast and responsive.

### Automated Agent Compatibility

The human-guided modification loop (ADR-0012) is designed to work with the structural scaffold. The system receives:

- The manifest structure
- Empty port interfaces
- Clear boundaries to fill in

This is more tractable than trying to "fix" generated code that might not match the user's intent.

## Consequences

### Positive

- Fast, responsive bootstrap
- Clean git history with auditable first commit
- Architecture boundaries established before code is added
- Code generation can be run independently (CLI, agent, scheduled job)
- Automated agents can work with empty stubs more easily

### Negative

- User must run an additional step to get implementation code
- Two-phase workflow (bootstrap → code gen) requires documentation
- `@hexagen/code-generation` is not integrated into the web wizard yet

## References

- ADR-0010 (MCP Server Architecture) — Tools available for post-bootstrap code gen
- ADR-0011 (Terminal UI Architecture) — TUI can trigger code generation
- ADR-0012 (Human-Guided Modification Loop) — System fills in stubs after bootstrap
- `.architecture/manifest.yaml` — Bounded context definitions
