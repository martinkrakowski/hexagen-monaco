# HexaGen Monaco — Architecture Governance Engine

[![Architectural Integrity Check](https://github.com/martinkrakowski/hexagen-monaco/actions/workflows/sync-integrity.yml/badge.svg)](https://github.com/martinkrakowski/hexagen-monaco/actions/workflows/sync-integrity.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

**Manifest-Driven Frontend Architecture Governance Engine**

HexaGen Monaco enforces architectural boundaries through build-time analysis and tooling constraints. Reduces boundary leakage, business logic placement in view layers, and uncontrolled dependency graph expansion.

**Architecture should compile.**

HexaGen Monaco is a governance platform that encodes Domain-Driven Design (DDD) and Hexagonal Architecture into a versionable, enforceable system manifest. It treats system topology as executable data to shift coordination complexity from engineers to deterministic tooling.

## Why HexaGen Monaco Exists

Large React / Next.js monorepos degrade predictably over time through deep cross-feature coupling and business logic leakage into the view layer. HexaGen Monaco makes architecture **explicit, versionable, and enforceable** at the build level.

## Design Intent

HexaGen Monaco is not intended to be a universal framework. It is a governance tool optimized for modular frontend systems where architectural consistency is more valuable than maximal flexibility.

The platform favors **architectural stability, auditability, and long-term maintainability**. While conceptually inspired by architectural theory, it is designed for practical production constraints where the goal is to reduce structural decay in evolving codebases.

## Structural Risk Mitigation

HexaGen Monaco is designed to reduce structural decay in large frontend codebases. The platform focuses on mitigating practical production risks, including:

HexaGen Monaco focuses on reducing common failure modes in large frontend systems (or vertical slices). It prevents features from quietly reaching across module boundaries and creating hidden coupling. It keeps ports and adapters aligned so interfaces do not slowly diverge as the system evolves. It surfaces when the dependency graph begins expanding in ways that make the system harder to reason about. It keeps business logic from spreading across UI components by routing interactions through a consistent intent pipeline. It also protects domain boundaries as the codebase grows so one feature area does not gradually absorb responsibilities from another.

## High-Level Architecture

HexaGen Monaco is a modular monolith composed of strictly isolated modules defined in `.architecture./manifest.yaml`.

**Enforcement Mechanisms:**

- **TypeScript Project References:** Physical file-system isolation.
- **ESLint Boundaries:** Rules preventing unauthorized cross-package imports.
- **Turbo Pipeline:** Enforcing build-graph isolation.

## Architect Mode Modules

| Module                        | Core Responsibility                                                      |
| :---------------------------- | :----------------------------------------------------------------------- |
| **Project Configuration**     | Governance Core; manifest parsing and system topology.                   |
| **Code Generation**           | Manifest Compiler; generates hexagonal boilerplate and syncs workspaces. |
| **Architectural Enforcement** | Risk Mitigation; dependency linting and boundary validation.             |
| **Wizard Orchestration**      | Deterministic UI Engine; follows `Intent > Use Case > Projection`.       |
| **Monaco Orchestration**      | Semantic Editing; AST-based patching gated by confidence scoring.        |
| **Agentic Interaction**       | AI as Infrastructure; architectural assistant modeled behind ports.      |
| **Visualization**             | Interactive Graph; visualizes module-to-port-to-adapter mappings.        |
| **Persistence**               | Lifecycle Engine; tracks architectural evolution and version diffs.      |

---

## Architecture Evolution Tracking

The system treats architecture as something that evolves over time. Instead of generating a static structure once and leaving it to drift, it tracks how the architecture changes as the system grows:

- Module splits show how bounded contexts evolve as the codebase expands.
- Port changes are tracked so interface contracts do not silently drift over time.
- Structural changes are captured as auditable diffs, making it easier to understand how the system topology evolves.

---

## Tech Stack

- **Monorepo Engine:** Yarn 4 + Turborepo
- **Language:** TypeScript (Composite Projects)
- **Frontend Core:** React / Next.js
- **Manifest:** YAML
- **Analysis:** Babel/AST for semantic patching

---

## Example Manifest

```yaml
# .architecture/manifest.yaml (excerpt)

system: hexagen-monaco
architecture: modular-monolith

modules:
  - name: project-configuration
    description: Primary feature module for project generation & manifest handling
    entities:
      - ProjectSpec
      - BoundedContext
      - Entity
      - ValueObject
      - Port
      - UseCase
      - Adapter
    value_objects:
      - FileTreeNode
    use_cases:
      - GenerateProject
      - ValidateSpec
    ports:
      - ProjectGeneratorPort
    infrastructure:
      - persistence: drizzle
      - llm_providers:
          - Claude
      - external_apis:
          - claude
          - git-provider-port
```

## Quick Start

```bash
git clone git@github.com:martinkrakowski/hexagen-monaco.git
cd hexagen-monaco
yarn install
yarn build
npx hexagen --help
```

## CLI Commands

```bash
# Run the sync engine
npx hexagen sync                    # Generate artifacts
npx hexagen sync --dry-run         # Preview changes
npx hexagen sync --force           # Overwrite non-generated files
npx hexagen sync --strict          # Fail on linter warnings

# Manage architecture manifest
npx hexagen arch list              # List bounded contexts
npx hexagen arch validate          # Validate manifest against rules
npx hexagen arch port              # Scaffold a new port interactively
npx hexagen arch context           # Add a new bounded context interactively
npx hexagen arch remove port       # Remove a port from a context
npx hexagen arch remove port --force   # Remove without confirmation
npx hexagen arch remove context    # Remove a bounded context
npx hexagen arch remove context --force  # Remove without confirmation
npx hexagen arch diff              # Show manifest changes (current vs git HEAD)
npx hexagen arch diff --file <path>  # Compare against specific file
npx hexagen arch edit              # Edit manifest in editor (default: nano)
npx hexagen arch edit --editor vim # Use vim instead of nano
npx hexagen arch edit --validate-only  # Validate without editing
```

---

## License

MIT.
Maintained by Martin Krakowski
