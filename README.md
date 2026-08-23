<p align="center"><img src="https://hexagen-monaco.cloud/images/hexagen-monaco-logo.svg" width="350" alt="Hexagen-Monaco Logo"></p>

<div align="center">

# Hexagen-Monaco <br> Governance Engine for Human and Agentic Systems

[![Architectural Integrity Check](https://github.com/martinkrakowski/hexagen-monaco/actions/workflows/sync-integrity.yml/badge.svg)](https://github.com/martinkrakowski/hexagen-monaco/actions/workflows/sync-integrity.yml)
[![License: FSL-1.1-Apache-2.0 (wedge)](<https://img.shields.io/badge/License-FSL--1.1--Apache--2.0%20(wedge)-blue.svg>)](./tools/arch-linter/LICENSE)
[![License: Source-Available (platform)](<https://img.shields.io/badge/License-Source--Available%20(platform)-orange.svg>)](./LICENSE)

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

### Add-on templates

Generated projects opt into **44 production-ready templates** — typed LLM adapters, auth providers, rate limiting, observability, background jobs, Docker/CI, the Adobe Firefly / Creative Cloud family, and more — composable and applied at any time:

```bash
npx hexagen templates list             # browse available templates
npx hexagen templates info <id>        # inspect questions, outputs, dependencies
npx hexagen add llm-adapter docker     # install one or more (dependencies auto-resolved)
npx hexagen validate-templates         # health-check installed templates
```

Full catalog and behavior (composable / idempotent / non-destructive / dependency-aware): [Generator Add-On Templates](#generator-add-on-templates).

## Documentation

For **architectural planning** and **remediation plans**, see the dedicated documentation:

- [Documentation Hub](docs/README.md)
- [Decisions](docs/index.md)
- [Planning & Core Implementation](docs/planning/)

The `.architecture/` directory remains the single source of truth for machine-enforced contracts and primary ADRs.

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

The manifest is the source of truth. The linter compiles invariants into a verdict. Humans review violations in either control plane. Agents propose remediations through the MCP server's tool surface. Changes proposed through the web control plane are captured as transactions and merge only after explicit approval. The MCP server's mutation tools currently write to the manifest directly — gated by deterministic structural and referential validation (split-manifest protection, dependency-cycle refusal, port/context referential checks) rather than by human approval; routing those writes through the same transaction-approval path is planned follow-up work.

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

When the linter detects a boundary violation, pressing `r` sends the violation context to an LLM, which selects a remediation from an allow-listed set of MCP tools (audit, add-dependency, create-port, create-adapter, scaffold-module); the TUI then executes the selected tool through a local MCP client immediately — pressing `r` is the operator's sign-off, and the structural/referential write gates described in The Governance Loop above are what stand between the agent's suggestion and the manifest. A review-before-apply step is planned follow-up work. Key bindings: `j/k` to navigate, `Tab` to switch panes, `r` to request an agent remediation, `u` to refresh, `q` to quit.

```bash
yarn workspace @hexagen/tui dev       # development
yarn workspace @hexagen/tui start     # built
```

### Publishing to GitHub

A generated project can be **downloaded as a ZIP** or **published directly to a new GitHub repository**. From the wizard's summary step an operator can create the repo and commit the scaffold, and from the Monaco editor **push subsequent edits** straight back to it — no leaving the app.

- **Authentication.** GitHub OAuth via NextAuth (`GitHubProvider`, scope `read:user user:email repo workflow` — `workflow` so published trees may contain `.github/workflows/*`, such as the injected sync-integrity CI workflow). The access token is read server-side from the session JWT and still **never reaches the browser** — the client only ever sees commit URLs and status. A revoked or expired token is surfaced as a distinct `reauth_required` response so the operator is prompted to re-authenticate rather than shown a generic failure.
- **Publish — `POST /api/export/github`.** Creates the repository under the authenticated user or an organization (`/user/repos` vs `/orgs/{owner}/repos`), then writes the generated tree through the Git Data API — blobs → tree → commit → fast-forward ref — onto the repository's actual default branch. The new repo's identity (`{ owner, repo, branch, htmlUrl, … }`) is persisted on the saved project (`SavedProject.githubLink`, client-side IndexedDB) so the project remembers where it was published and reconnects on reload.
- **Editor push — `POST /api/push/github`.** Commits the editor's current file set to the connected repository as an incremental, base-on-HEAD commit and returns the commit URL. The wizard and editor surfaces report progress and the resulting repository link.

The GitHub plumbing lives in the infrastructure plane: a shared `GitHubGitDataClient` backs both the `GitHubExporterAdapter` (publish) and the `GitHubRepositoryWriterAdapter` behind a `RepositoryWriterPort` (editor push), all in `@hexagen/external-integration` and wired at the composition root. `project-generation` stays decoupled from the GitHub implementation — it depends only on `@hexagen/shared` and `@hexagen/sync`.

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

**Retry with model escalation.** Stage-3 structured config generation uses `STAGE3_ESCALATION_CONFIG` (3 default retries, then up to 3 escalated retries on a stronger model). The escalation model is **opt-in**: it ships as `escalationModel: undefined` and is injected at the wiring layer from the `LLM_ESCALATION_MODEL` env var — hardcoding a model name (e.g. `gpt-4o`) would 404 on non-OpenAI providers (NVIDIA, vLLM, Ollama, Anthropic). When unset, the escalated retries are skipped. The generic `DEFAULT_ESCALATION_CONFIG` provides the same 3 + 3 pattern for use cases that need to fall back to a stronger model on persistent failure. Both live in `packages/agentic-interaction/src/application/use-cases/staged-generation/retry-with-escalation.ts`.

**Confidence-gated type review.** `ClassifyContextTypeUseCase` emits a confidence score on every inferred context type; results below the threshold are flagged `needsTypeReview` and surfaced to the human reviewer, never auto-applied.

**MCP server (stdio).** The `mcp-server` context exposes the entire governance surface to MCP-compatible clients — Claude Code, Copilot, the TUI's own client — over stdio transport:

- **7 read resources:** manifest, dependency graph, linter report, decisions, invariants, linter config, workspace context.
- **19 tools:** audit boundaries, diff manifest, scaffold module, create / remove port / context / adapter, add dependency, generate topology / adapters / manifest pipeline, accept / reject / get / list transaction, log agent remediation, initialize feature worktree, submit architectural spec.

Mutation tools write to the manifest directly, behind deterministic fail-closed write gates (split-manifest protection, dependency-cycle refusal, port/context referential checks — see The Governance Loop above). The transaction accept/reject tools operate on proposals from the web control plane's transaction flow; routing the MCP mutation tools through that same approval path is planned follow-up work.

## Architecture Topology

Hexagen-Monaco is a modular monolith. Thirty-one bounded contexts live across five planes; the manifest at `.architecture/manifest.yaml` is the single source of truth.

| Plane              | Context                | Responsibility                                                                                 |
| ------------------ | ---------------------- | ---------------------------------------------------------------------------------------------- |
| **Core**           | project-configuration  | Governance core; manifest parsing and topology validation                                      |
| **Core**           | wizard-orchestration   | Deterministic UI engine; `Intent → Use Case → Projection`                                      |
| **Core**           | monaco-orchestration   | Semantic patching via `ts-morph`, confidence-gated mutations                                   |
| **Core**           | project-generation     | Hexagonal boilerplate generation from manifest specs                                           |
| **Core**           | governance             | Decisions, invariants, and architectural policy state                                          |
| **Core**           | ai-pipeline            | Staged generation pipeline orchestration                                                       |
| **Core**           | transaction-system     | Speculative state machine, backpressure, semantic caching (frozen)                             |
| **Core**           | layout-engine          | Deterministic layout for visualization projections                                             |
| **Core**           | ui-projection-compiler | Compiles projection specs into renderable UI trees                                             |
| **Core**           | prompt-compiler        | Compiles prompts; ACL between domain and LLM ports                                             |
| **Core**           | manifest-generation    | Manifest synthesis from architectural specs                                                    |
| **Core**           | llm-driver             | Domain-side driver for LLM-backed use cases                                                    |
| **Core**           | report-governance      | Governance reporting and remediation audit trail                                               |
| **Core**           | byok                   | Bring-your-own-key secret handling for cloud LLMs                                              |
| **Probabilistic**  | agentic-interaction    | Outbound LLM ports, R16-R18 quality controls, retry + escalation                               |
| **Probabilistic**  | mcp-server             | Stdio MCP server; 7 governance reads, 19 tools (mutations behind deterministic write gates)    |
| **Probabilistic**  | local-llm              | WebGPU/WebLLM inference, IndexedDB model + chat persistence                                    |
| **Probabilistic**  | reconciliation-engine  | Reconciles agent proposals against current manifest state                                      |
| **Projection**     | web-driver             | Next.js application shell; HITL canvas host                                                    |
| **Projection**     | ui                     | Shared React components for projection planes                                                  |
| **Projection**     | visualization          | Architecture graph rendering (React Flow)                                                      |
| **Projection**     | model-settings         | Model configuration and provider selection UI                                                  |
| **Infrastructure** | sync                   | Manifest-to-workspace synchronization engine                                                   |
| **Infrastructure** | template-engine        | Add-on template system — manifest-driven scaffolds, dependency resolution, idempotent emission |
| **Infrastructure** | persistence            | Storage adapters (Drizzle, IndexedDB)                                                          |
| **Infrastructure** | messaging              | Cross-context event delivery                                                                   |
| **Infrastructure** | external-integration   | Outbound adapters to external APIs                                                             |
| **Infrastructure** | deployment             | Build and release artifacts                                                                    |
| **Infrastructure** | runtime                | Process and worker lifecycle                                                                   |
| **Shared-Kernel**  | core-domain            | Cross-plane domain primitives                                                                  |
| **Shared-Kernel**  | shared                 | Type-only utilities permitted in any plane                                                     |

Two runtime surfaces expose the governance planes: `apps/web` (Next.js visual control plane, which also serves the HTTP API under `app/api`) and `apps/tui` (Ink terminal control plane).

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

## Generator Add-On Templates

Beyond scaffolding the architecture, Hexagen-Monaco ships **44 opt-in add-on templates** — production-ready infrastructure slices a generated project can apply at any time. Each template is self-contained: it declares its own questions, dependencies, output files, required env vars, and post-install checklist, then emits typed, hexagonal-architecture-aligned code into the project.

```bash
npx hexagen templates list             # list available templates (✅ marks installed)
npx hexagen templates info <id>        # inspect a template's questions, outputs, deps
npx hexagen add <id> [<id> ...]        # install one or more (dependencies auto-resolved)
npx hexagen add <id> --force           # re-apply an installed template
npx hexagen validate-templates         # verify installed templates are healthy
```

Templates are:

- **Composable** — any subset applies together; conflicts (e.g. competing auth providers) are declared and enforced at install time.
- **Dependency-aware** — install order is topologically sorted; missing dependencies and cycles are caught before any file is written.
- **Non-destructive** — a user-modified generated file is never overwritten; a `.hexagen-update.<ext>` conflict copy is written alongside it.
- **Idempotent** — re-running `hexagen add` on an unchanged project is a no-op (generated files are SHA-256 tracked).

### Catalog

- **Foundation** — `env-setup` (categorised `.env`, Zod validation, `check-env`, `SETUP.md`) · `shared-types` (`UserContext`, env-overridable mock user, session helpers)
- **Core infrastructure** — `rate-limiting` · `llm-adapter` (typed port + xAI/OpenAI/Anthropic/Ollama adapters, model routing, retry) · `error-handling` (3-layer hierarchy, RFC 7807, React error boundary) · `observability` (structured logging, correlation IDs, `/api/health`) · `eslint-no-console`
- **Auth** — `auth-mock`; real providers `google-oauth` · `github-oauth` · `microsoft-entra` · `magic-link` · `adobe-ims-spa` · `supabase-auth`; standalone frameworks `nextauth` · `clerk` · `better-auth` _(providers are mutually exclusive)_
- **Persistence & jobs** — `supabase` (SSR client, storage, RLS stubs, optional Drizzle) · `bullmq` (typed queues, workers, Redis fallback, optional Bull Board)
- **AI & agents** — `langgraph` (typed agent graph, checkpointing, streaming, HITL) · `llm-adapter-bedrock` (Bedrock Converse adapter) · `bedrock-agentcore-runtime` (AgentCore deploy target) · `bedrock-agentcore-services` (Memory / Gateway / Identity)
- **Adobe Firefly & Creative Cloud** (17) — `adobe-firefly-core` foundation + service add-ons `generate` · `upscale` · `composite` · `content-tagging` · `media` · `custom-models`; app automation `adobe-photoshop` · `adobe-lightroom` · `adobe-illustrator` · `adobe-indesign` · `adobe-express` · `adobe-creative-production` · `adobe-substance-3d`; presigned storage `adobe-firefly-storage-s3` · `-gcs` · `-azure`
- **DevOps** — `docker` (multi-stage Dockerfile, compose + dev override, image-push action) · `ci-github-actions` (build/typecheck/lint/test CI, Vercel/Railway/Fly/VPS deploy, PR previews, Dependabot)
- **DX & docs** — `design-system` (CSS tokens, Tailwind extension, base components, optional Storybook) · `agents-md` (rich `AGENTS.md` + `.agents/` spec directory)

Per-template design docs and the full dependency graph live in [`docs/planning/generator-templates/`](docs/planning/generator-templates/).

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

# Add-on templates
npx hexagen templates list             # list templates (✅ = installed)
npx hexagen templates info <id>        # inspect a template
npx hexagen add <id> [<id> ...]        # install (dependencies auto-resolved)
npx hexagen validate-templates         # health-check installed templates

# Apps
yarn workspace @hexagen/web dev
yarn workspace @hexagen/tui dev
```

## Example Manifest

```yaml
# .architecture/manifest.yaml (illustrative excerpt — simplified for reading.
# Real bounded_contexts entries are flat maps; ports and layer detail live in
# per-context context.yaml files. Runtime LLM settings (retries, escalation)
# are code/env-level config, not manifest fields — see "Retry with model
# escalation" above.)

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
```

## Testing & CI

Tests run in CI only. Local pre-commits run lint and typecheck (~2–5s); the full suite runs against a clean GitHub Actions environment. The test runner is **Vitest** (ADR-0044); assertions are `node:assert/strict` or Vitest `expect()` — both are fine.

```bash
yarn test                                       # every workspace that defines a test task
yarn workspace @hexagen/web-driver test         # one workspace
yarn workspace @hexagen/web-driver exec vitest  # one workspace, watch mode
```

`yarn test` is `turbo test`, and Turbo rejects unrecognised flags rather than forwarding
them — `yarn test --watch` and `yarn test --coverage` both fail with `unexpected argument`.
Use the per-workspace forms above, or `yarn test -- <flag>` to pass the flag through to the
test tasks Turbo selects.

**`yarn test` is not "every workspace".** Turbo runs the `test` script of each workspace that
defines one and silently no-ops the rest, so the command's scope is not visible in its own
output. To see the real scope:

```bash
yarn turbo run test --dry=json | jq -r '.tasks[] | select(.task=="test") | "\(.package)\t\(.command)"'
```

Workspaces printing `<NONEXISTENT>` have no `test` script and are contributing nothing. As of
2026-08-16 that is 3 of 38 — `@hexagen/shared`, `@hexagen/model-settings` and
`@hexagen/runtime`. Closing that gap is remediation item **8.11**.

**There is no coverage tooling wired in this repo**: no provider is installed and no Vitest
coverage config exists anywhere. That is a recorded, deliberate deferral with a re-open
trigger, not an oversight — and the no-op workspaces above are precisely why, since a
coverage percentage would only instrument the files a runner loads and would therefore
_improve_ as that gap widened. See decision **D4** in
[`docs/planning/2026-08-15-architecture-remediation-execution-runbook.md`](docs/planning/2026-08-15-architecture-remediation-execution-runbook.md).

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
- **Testing:** Vitest (ADR-0044)

---

## For existing `@hexagen-monaco/sync` users

Generation stays. If you installed the CLI to scaffold Hexagonal monorepos, that path remains supported. The product headline is now architectural conformance — the same engine that emits a layout also checks that the tree still matches it. 0.11.0 is a breaking minor: a project that passed the linter on 0.9.x can fail on 0.11.0. That candor is the contract going forward.

## License

Hexagen-Monaco is a three-layer product (ADR-0061, ADR-0066).

**Wedge.** `@hexagen-monaco/arch-linter` and the future adopt / bootstrap / report commands and CI action are licensed under the [Functional Source License, Version 1.1, Apache 2.0 Future License](./tools/arch-linter/LICENSE) (FSL-1.1-Apache-2.0; SPDX identifier `FSL-1.1-ALv2`). Internal use — including commercial internal use — is permitted. Offering a competing product or service on the wedge is not. Each published version converts to Apache-2.0 two years after it is made available.

**Platform.** `@hexagen-monaco/sync` (the generator), the web app, staged generation, hosted history, and the agent-constraint pack remain proprietary under the [Source-Available Evaluation License](./LICENSE). New packages default to this license unless they are deliberately placed in the wedge.

Already-published npm tarballs at version 0.9.0 and earlier stay on the evaluation license forever. From 0.11.0, the wedge packages ship under FSL-1.1-Apache-2.0.

The **Hexagen-Monaco** name is a trademark of Krakowski Cloud Solutions, LLC and is independent of the code licenses.

For commercial licensing, enterprise support, and assisted brownfield adoption tooling, open a GitHub issue at https://github.com/martinkrakowski/hexagen-monaco/issues with the title prefix `[commercial]` or email commercial@hexagen.dev.

Maintained by Martin Krakowski
