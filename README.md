<p align="center"><img src="https://hexagen-monaco.cloud/images/hexagen-monaco-logo.svg" width="350" alt="Hexagen-Monaco Logo"></p>

<div align="center">

# Hexagen-Monaco <br> Governance Engine for Human and Agentic Systems

[![Architectural Integrity Check](https://github.com/martinkrakowski/hexagen-monaco/actions/workflows/sync-integrity.yml/badge.svg)](https://github.com/martinkrakowski/hexagen-monaco/actions/workflows/sync-integrity.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

**Architecture should compile**

<a href="https://hexagen-monaco.cloud/">View application demo</a>

</div>

## Quick Start

```bash
git clone git@github.com:martinkrakowski/hexagen-monaco.git
cd hexagen-monaco
corepack enable && yarn install
yarn build
npx hexagen --help
```

The full CLI reference is in [CLI Reference](#cli-reference).

## The Problem

Architectural decay is rarely visible until the cost of correcting it becomes systemic. In enterprise systems — and now in codebases increasingly authored by autonomous agents — bounded contexts merge silently through shared utilities, business logic leaks into adapters, and dependency edges form across layers that were never meant to touch. The damage is done before anyone files an alert.

Linting rules and review etiquette are not enough. When the actors mutating the system include both humans and LLM-driven agents, the architecture itself must be the contract that everyone — human or otherwise — is forced to honor.

## The Solution — Governance as Compiled Code

Hexagen-Monaco treats architecture as a first-class, executable artifact. A single manifest.yaml encodes the system topology — planes, bounded contexts, ports, adapters, and layer rules — as deterministic data. The same manifest drives the visual canvas, the linter, and the tool surface AI agents are restricted to. Architectural decisions stop being documents that drift from reality and become rules the build enforces against every contributor, human or agentic.

## The Governance Loop

Every mutation in the system, whether issued by a human in the visual control plane, an operator in the terminal control plane, or an LLM through the MCP server, flows through the same closed loop:

```
Manifest  ──►  Linter (hexagen-lint)  ──►  HITL Surface (Web / TUI)
   ▲                                              │
   │                                              ▼
Transaction  ◄──────────  Agent / Operator (via MCP server)
```

The manifest is the source of truth. The linter compiles invariants into a verdict. Humans review violations in either control plane. Agents propose remediations through the MCP server's tool surface. Every proposed change is captured as a transaction and only merges into the manifest after explicit approval — making the audit trail symmetric between human and agentic contributors.

## Human Control Planes (HITL)

Two operator surfaces participate in the governance loop: a visual control plane in the browser and a terminal control plane on the engineer's workstation. Both consume the same manifest state the linter compiles against and the MCP server reads from — the operator's view is the system's view. Operators inspect the same architectural state the system enforces.

### Visual Control Plane (Web)

The Next.js application is the visual control plane. It surfaces the manifest's bounded contexts, ports, adapters, and dependency edges as a governance surface where human operators inspect invariants, review agent-proposed mutations, and accept or reject transactions before they reach `main`. The canvas is a window onto governance state, not a separate model of it.

<p align="center">
  <img src="https://hexagen-monaco.cloud/images/ui-canvas-01.png" alt="Architecture canvas — bounded context graph with hexagonal nodes and dependency edges" width="720" />
</p>

<p align="center">
  <img src="https://hexagen-monaco.cloud/images/ui-canvas-02.png" alt="Architecture canvas — expanded view showing port and adapter detail panels" width="720" />
</p>

<p align="center">
  <img src="https://hexagen-monaco.cloud/images/ui-canvas-03.png" alt="Architecture canvas — dependency flow visualization across module boundaries" width="720" />
</p>

### Terminal Control Plane (TUI)

The terminal control plane (`apps/tui`) built with [Ink](https://github.com/vadimdemedes/ink) is the local operator surface for engineers reviewing governance state without leaving the terminal. Three panes expose live state: bounded-context navigation, the active invariant set, and a boundary-violation inspector. Filesystem watching on the manifest keeps the operator's view synchronized with what the linter and MCP server observe — there is no stale local cache to diverge.

<p align="center">
  <img src="https://hexagen-monaco.cloud/images/tui-violation-inspector.png" alt="TUI violation inspector — three-pane layout showing navigation tree, rule engine, and boundary violation details" width="720" />
</p>

When the linter detects a boundary violation, pressing `r` routes the violation context through a local MCP client to an agent, which proposes a remediation grounded in the manifest. The proposal is captured for review; no mutation reaches the manifest without operator sign-off. Key bindings: `j/k` to navigate, `Tab` to switch panes, `r` to request an agent remediation, `u` to refresh, `q` to quit.

```bash
yarn workspace @hexagen/tui dev       # development
yarn workspace @hexagen/tui start     # built
```

## Agentic Governance Layer

AI in Hexagen-Monaco is not a first-class domain actor. It is governed infrastructure modeled behind explicit ports, with quality controls and an escalation strategy that treat LLM output the same way the build treats any other untrusted input.

**LLM ports (three, all in the `probabilistic` plane).** Every inference call is routed through one of:

- `LLMProviderPort` — generic request/response abstraction in `agentic-interaction`.
- `CloudLLMProviderPort` — OpenAI-compatible cloud inference with `preferredCloudModel`, BYOK key handling, and cancellation signals.
- `LocalLLMProviderPort` — browser-side WebGPU inference via WebLLM (MLC AI) in the `local-llm` plane, with IndexedDB model caching for offline operation.

No domain code references a provider by name. Switching providers, swapping in a local WebGPU model, or routing through a future inference backend is an adapter concern — not an architectural one.

**Outbound port quality controls.** The agentic-interaction context applies deterministic validation to every LLM-proposed port before it is allowed into the manifest pipeline. Implemented in `packages/agentic-interaction/src/domain/services/port-quality-validator.ts`:

| Rule    | Check                                                                                                                         |
| ------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **R16** | Port description is trivial or the justification is a degenerate restatement of the port name.                                |
| **R17** | The port's `forAggregate` reference does not match any known aggregate root.                                                  |
| **R18** | Port name leaks infrastructure or platform metadata (Vercel, FlyIO, AWS, GCP, `*Client`, `*Adapter`, `*Host`, `*Platform` …). |

**Retry with model escalation.** Stage-3 structured config generation uses `STAGE3_ESCALATION_CONFIG` (3 default retries, then 3 escalated retries with `escalationModel: "gpt-4o"`). The generic `DEFAULT_ESCALATION_CONFIG` provides the same 3 + 3 pattern for use cases that need to fall back to a stronger model on persistent failure. Both live in `packages/agentic-interaction/src/application/use-cases/staged-generation/retry-with-escalation.ts`.

**Confidence-gated type review.** `ClassifyContextTypeUseCase` emits a confidence score on every inferred context type; results below the threshold are flagged `needsTypeReview` and surfaced to the human reviewer, never auto-applied.

**MCP server (stdio).** The `mcp-server` context exposes the entire governance surface to MCP-compatible clients — Claude Code, Copilot, the TUI's own client — over stdio transport:

- **7 read resources:** manifest, dependency graph, linter report, decisions, invariants, linter config, workspace context.
- **19 tools:** audit boundaries, diff manifest, scaffold module, create / remove port / context / adapter, add dependency, generate topology / adapters / manifest pipeline, accept / reject / get / list transaction, log agent remediation, initialize feature worktree, submit architectural spec.

All mutations are transaction-gated. The MCP server is constrained by the same manifest invariants as every other mutation surface; it can only propose changes that the linter and the human reviewer approve.

## Architecture Topology

Hexagen-Monaco is a modular monolith. Thirty bounded contexts live across five planes; the manifest at `.architecture/manifest.yaml` is the single source of truth.

| Plane              | Context                | Responsibility                                                   |
| ------------------ | ---------------------- | ---------------------------------------------------------------- |
| **Core**           | project-configuration  | Governance core; manifest parsing and topology validation        |
| **Core**           | wizard-orchestration   | Deterministic UI engine; `Intent → Use Case → Projection`        |
| **Core**           | monaco-orchestration   | Semantic patching via `ts-morph`, confidence-gated mutations     |
| **Core**           | project-generation     | Hexagonal boilerplate generation from manifest specs             |
| **Core**           | governance             | Decisions, invariants, and architectural policy state            |
| **Core**           | ai-pipeline            | Staged generation pipeline orchestration                         |
| **Core**           | intent-compiler        | Compiles user intent into structured use-case input              |
| **Core**           | layout-engine          | Deterministic layout for visualization projections               |
| **Core**           | ui-projection-compiler | Compiles projection specs into renderable UI trees               |
| **Core**           | prompt-compiler        | Compiles prompts; ACL between domain and LLM ports               |
| **Core**           | manifest-generation    | Manifest synthesis from architectural specs                      |
| **Core**           | llm-driver             | Domain-side driver for LLM-backed use cases                      |
| **Core**           | report-governance      | Governance reporting and remediation audit trail                 |
| **Core**           | byok                   | Bring-your-own-key secret handling for cloud LLMs                |
| **Probabilistic**  | agentic-interaction    | Outbound LLM ports, R16-R18 quality controls, retry + escalation |
| **Probabilistic**  | mcp-server             | Stdio MCP server; 7 governance reads, 19 transaction-gated tools |
| **Probabilistic**  | local-llm              | WebGPU/WebLLM inference, IndexedDB model + chat persistence      |
| **Probabilistic**  | reconciliation-engine  | Reconciles agent proposals against current manifest state        |
| **Projection**     | web-driver             | Next.js application shell; HITL canvas host                      |
| **Projection**     | ui                     | Shared React components for projection planes                    |
| **Projection**     | visualization          | Architecture graph rendering (React Flow)                        |
| **Projection**     | model-settings         | Model configuration and provider selection UI                    |
| **Infrastructure** | sync                   | Manifest-to-workspace synchronization engine                     |
| **Infrastructure** | persistence            | Storage adapters (Drizzle, IndexedDB)                            |
| **Infrastructure** | messaging              | Cross-context event delivery                                     |
| **Infrastructure** | external-integration   | Outbound adapters to external APIs                               |
| **Infrastructure** | deployment             | Build and release artifacts                                      |
| **Infrastructure** | runtime                | Process and worker lifecycle                                     |
| **Shared-Kernel**  | core-domain            | Cross-plane domain primitives                                    |
| **Shared-Kernel**  | shared                 | Type-only utilities permitted in any plane                       |

Three runtime surfaces expose the governance planes: `apps/web` (Next.js visual control plane), `apps/tui` (Ink terminal control plane), `apps/api-gateway` (HTTP surface for the canvas).

## Enforcement Stack

Four independent enforcement layers prevent unauthorized mutations from reaching `main`:

- **TypeScript project references** isolate package compilation graphs at the file-system level.
- **ESLint boundaries** reject unauthorized cross-package imports during local development.
- **Turborepo pipeline** enforces build-graph isolation and caches per-package outputs.
- **`hexagen-lint`** validates the manifest against `.architecture/invariants/linter-config.yaml` — per-context subpath conventions, per-package import allow-lists, and a global whitelist.

`hexagen-lint` discovers the project root in this order: `--root <path>` argument, then `HEXAGEN_ROOT` env var, then a walk-up for `.architecture/manifest.yaml`, then a walk-up for a `package.json` containing a `workspaces` field.

## Architecture Evolution Tracking

The manifest is versioned and diffable. Three tracking surfaces support change review:

- **Module splits** show how bounded contexts decompose as the system grows.
- **Port contract diffs** surface drift in interface signatures before downstream adapters break.
- **Manifest diffs** (`hexagen arch diff`) compare the working tree against `git HEAD` or any specified revision — the same diff feeds the MCP `DiffManifestToolUseCase` for agentic review.

## CLI Reference

```bash
# Sync — compile the manifest into workspace artifacts
npx hexagen sync                       # generate artifacts
npx hexagen sync --dry-run             # preview changes
npx hexagen sync --force               # overwrite non-generated files
npx hexagen sync --strict              # fail on linter warnings

# Manifest management
npx hexagen arch list                  # list bounded contexts
npx hexagen arch validate              # validate manifest against invariants
npx hexagen arch port                  # scaffold a port (interactive)
npx hexagen arch context               # add a bounded context (interactive)
npx hexagen arch remove port [--force]
npx hexagen arch remove context [--force]
npx hexagen arch diff                  # working tree vs git HEAD
npx hexagen arch diff --file <path>    # compare against a file
npx hexagen arch edit                  # open manifest in $EDITOR (default: nano)
npx hexagen arch edit --editor vim
npx hexagen arch edit --validate-only

# Linter (architectural integrity)
hexagen-lint --root /path/to/project
HEXAGEN_ROOT=/path/to/project hexagen-lint
yarn lint:arch                         # workspace convenience target

# Apps
yarn workspace @hexagen/web dev
yarn workspace @hexagen/tui dev
```

## Example Manifest

```yaml
# .architecture/manifest.yaml (excerpt)

system: hexagen-monaco
architecture: modular-monolith

planes:
  core: [project-configuration, wizard-orchestration, monaco-orchestration, ...]
  probabilistic:
    [agentic-interaction, mcp-server, local-llm, reconciliation-engine]
  projection: [web-driver, ui, visualization, model-settings]
  infrastructure: [sync, persistence, messaging, deployment, runtime, ...]
  shared-kernel: [core-domain, shared]

bounded_contexts:
  - name: agentic-interaction
    type: supporting
    plane: probabilistic
    status: active
    ports:
      - LLMProviderPort
      - CloudLLMProviderPort
      - SuggestionEnginePort
      - SecretVaultPort
    quality_controls:
      - R16 # trivial description / degenerate justification
      - R17 # invalid forAggregate reference
      - R18 # infrastructure / platform name leak
    escalation:
      default: { retries: 3, escalated: 3 }
      stage3: { retries: 3, escalated: 3, escalationModel: gpt-4o }
```

## Testing & CI

Tests run in CI only. Local pre-commits run lint and typecheck (~2–5s); the full suite runs against a clean GitHub Actions environment. The test runner is Node's built-in `node:test`.

```bash
yarn test                              # full suite
yarn workspace @hexagen/web-driver test
yarn test --watch
yarn test --coverage
```

The [`.github/workflows/sync-integrity.yml`](.github/workflows/sync-integrity.yml) workflow runs on every PR and on pushes to `main` / `develop`:

1. **Build** — `yarn turbo run build`
2. **Typecheck** — `yarn turbo run typecheck`
3. **Lint** — `yarn turbo run lint` (architecture + ESLint)
4. **Linter integrity** — `yarn workspace @hexagen/sync run cli sync --dry-run`
5. **Test suite** — `yarn turbo run test`

All steps must pass before merging to `main`.

## Tech Stack

- **Monorepo:** Yarn 4 + Turborepo
- **Language:** TypeScript (composite project references)
- **Canvas:** Next.js + React Flow
- **Terminal UI:** Ink
- **Semantic patching:** `ts-morph`
- **Local inference:** WebLLM (MLC AI) on WebGPU
- **MCP transport:** stdio
- **Manifest:** YAML
- **Testing:** `node:test`

---

## License

HexaGen Monaco is licensed under the [Business Source License (BSL) 1.1](./LICENSE). 

**What this means:**
- You can read the source code, run it locally, and use it freely for internal development, testing, and academic research.
- You **cannot** use this software in a commercial production deployment or offer it as a managed service without a commercial license.

For commercial licensing inquiries, enterprise support, and access to the automated brownfield ingestion engine, please contact Krakowski Cloud Solutions, LLC.

Maintained by Martin Krakowski
