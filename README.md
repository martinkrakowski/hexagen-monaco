# HexaGen Monaco — Architecture Governance Engine

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

- **Boundary Leakage:** Preventing unauthorized cross-module imports via build-time enforcement.
- **Contract Drift:** Maintaining Port/Adapter integrity through TypeScript project references.
- **Dependency Graph Growth:** Restricting and visualizing uncontrolled growth in complex systems.
- **Orchestration Fragmentation:** Consolidating business logic through a deterministic intent bus.
- **Context Boundary Violations:** Validating domain isolation during rapid feature expansion.

## High-Level Architecture

HexaGen Monaco is a modular monolith composed of strictly isolated modules defined in `.architecture.yaml`.

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

The system treats architecture as a time-evolving asset. Unlike static generators, it tracks:

- **Module Splits:** Evolution of bounded contexts over time.
- **Port Mutations:** Historical tracking of contract changes.
- **Topology Shifts:** Auditable diffs of structural growth.

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
# .architecture.yaml (excerpt)

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
          - Grok
      - external_apis:
          - grok
          - git-provider-port
```

## Quick Start

```bash
git clone git@github.com:martinkrakowski/hexagen-monaco.git
cd hexagen-monaco
yarn install
yarn sync # Synchronize system bindings
yarn dev
```

---

## License

MIT.
Maintained by Martin Krakowski
