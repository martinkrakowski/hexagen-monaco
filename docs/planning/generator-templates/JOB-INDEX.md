# Generator Add-On Templates — Job Index

> **Status:** Core framework shipped (`feature/generator-template-system-core`, PR #83).
> Most templates now ship scaffold content; the `docker` template landed on `feature/generator-template-docker`.
> All standalone templates now ship scaffold content (`ci-github-actions` landed on `feature/generator-template-ci-github-actions`).
> The **Amazon Bedrock AgentCore** family ([`16-bedrock-agentcore.md`](./16-bedrock-agentcore.md))
> is now fully implemented: `bedrock-agentcore-runtime` on `feature/generator-template-bedrock-agentcore-runtime`,
> `bedrock-agentcore-services` on `feature/generator-template-bedrock-agentcore-services`, and the
> `llm-adapter-bedrock` companion on `feature/generator-template-bedrock`.
> The **Adobe Firefly Services** family ([`17-adobe-firefly.md`](./17-adobe-firefly.md)) is
> underway: `adobe-firefly-core`, `adobe-firefly-upscale`, `adobe-firefly-generate`,
> `adobe-firefly-content-tagging`, `adobe-firefly-composite`, `adobe-photoshop`, `adobe-lightroom`,
> `adobe-illustrator`, `adobe-indesign`, and the `adobe-firefly-storage-s3` presigner are
> **implemented** (through illustrator merged to `main`); the remaining 5 service addons + 2 storage
> presigners (GCS/Azure) are design-only (Core Generative done bar media/custom-models; Creative Automation underway).
> Planned (design only, no manifest yet): **`mcp-server`** ([`18-mcp-server.md`](./18-mcp-server.md)).

---

## What This Feature Set Is

The generator template system lets a Hexagen project opt-in to production-ready infrastructure slices at generation time or after the fact. Each template is a self-contained unit that knows its own questions, dependencies, output files, required env vars, and post-install checklist.

The core design principle is **compress time-to-production for greenfield projects**. A new project applying the right subset of templates should be able to push to a real deployment with observability, typed error handling, background jobs, and working auth in the same day it was created — without any of the usual copy-paste archaeology.

---

## Core Design Properties

| Property             | Behaviour                                                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **Composable**       | Any subset of templates can be applied together; conflicts between templates are declared and enforced at install time                     |
| **Idempotent**       | Re-running `hexagen add` on an unchanged project is a no-op                                                                                |
| **Non-destructive**  | If a generated file was user-modified, a `.hexagen-update.<ext>` conflict copy is written alongside it — the original is never overwritten |
| **Dependency-aware** | `resolveDependencies()` topologically sorts the install order; missing dependencies and cycles are caught before any files are written     |
| **Declarative**      | Everything a template needs is expressed in its `manifest.json` — no imperative install scripts                                            |

---

## CLI Reference

```bash
# List available templates (marks installed ones with ✅)
hexagen templates list

# Inspect a specific template
hexagen templates info <id>

# Install one or more templates (resolves deps automatically)
hexagen add <id> [<id> ...]

# Re-apply already-installed templates
hexagen add <id> --force

# Verify installed templates are healthy (missing files, unset env vars, open conflicts)
hexagen validate-templates
```

At project generation time (not yet wired):

```bash
hexagen new my-project --add rate-limiting,llm-adapter,env-setup,docker
```

---

## Template Catalog

### Foundation

| ID             | Branch                                     | One-liner                                                                                        | Requires    |
| -------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------ | ----------- |
| `env-setup`    | `feature/generator-template-env-setup`     | Categorised `.env.example`, Zod validation, `check-env` script, `SETUP.md` first-day guide       | —           |
| `shared-types` | `feature/shared-types-and-derived-answers` | `UserContext` domain type, `MOCK_USER` (env-overridable), session-cookie helpers + `COOKIE_NAME` | `env-setup` |

`env-setup` is the universal prerequisite. `shared-types` is the auth-ecosystem prerequisite, depended on by `auth-mock` and every real auth provider.

---

### Core Infrastructure

| ID               | Branch                                      | One-liner                                                                                                        | Priority |
| ---------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------- |
| `rate-limiting`  | `feature/generator-template-rate-limiting`  | Differentiated middleware (text/image/general), session+IP hybrid ID, configurable limits, 429 handling          | P0       |
| `llm-adapter`    | `feature/generator-template-llm-adapter`    | Typed port interface, provider adapters (xAI/OpenAI/Anthropic/Ollama), model constants, reasoning routing, retry | P0       |
| `error-handling` | `feature/generator-template-error-handling` | 3-layer error hierarchy, RFC 7807 HTTP mapping, LLM error classes, React error boundary                          | P0       |
| `observability`  | `feature/generator-template-observability`  | Structured JSON logging, correlation IDs via AsyncLocalStorage, request middleware, `/api/health`                | P0       |

---

### Auth

| ID                | Branch                                       | One-liner                                                                                      | Priority |
| ----------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------- |
| `auth-mock`       | `feature/shared-types-and-derived-answers`   | Dev-only AUTH_MODE=mock root middleware (slimmed v3.0 — types moved to `shared-types`)         | P1       |
| `google-oauth`    | `feature/generator-template-google-oauth`    | OAuth 2.0 code flow, encrypted session, optional hosted-domain restriction, root middleware    | P1       |
| `github-oauth`    | `feature/generator-template-github-oauth`    | OAuth App flow, primary-email + org gate, encrypted session, root middleware                   | P1       |
| `microsoft-entra` | `feature/generator-template-microsoft-entra` | Entra ID PKCE, Microsoft Graph profile + group fetch, AAD group→role mapping, root middleware  | P1       |
| `magic-link`      | `feature/generator-template-magic-link`      | HMAC-signed single-use tokens, Resend/Nodemailer transport, encrypted session, root middleware | P1       |
| `adobe-ims-spa`   | `feature/generator-template-adobe-ims-spa`   | PKCE-flow login/callback/logout routes, encrypted token store, auto-refresh, root middleware   | P1       |
| `supabase-auth`   | `feature/shared-types-and-derived-answers`   | `@supabase/ssr` session middleware on top of `supabase` (auto-resolves)                        | P1       |

---

### Persistence & Background Jobs

| ID         | Branch                                | One-liner                                                                                                                              | Priority |
| ---------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `supabase` | `feature/generator-template-supabase` | SSR-safe client, storage helpers, RLS stubs, type generation, optional Drizzle (storage-only; `supabase-auth` adds session middleware) | P1       |
| `bullmq`   | `feature/generator-template-bullmq`   | Typed queues, workers, Redis fallback to in-process, optional Bull Board dashboard                                                     | P2       |

---

### AI / Agents

| ID                           | Branch                                                  | One-liner                                                                                                           | Priority |
| ---------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | -------- |
| `langgraph`                  | `feature/generator-template-langgraph`                  | `AgentGraphPort`, typed state, node stubs, graph compilation, checkpointing, streaming, HITL                        | P2       |
| `llm-adapter-bedrock`        | `feature/generator-template-bedrock`                    | Bedrock inference addon to `llm-adapter` — Converse API adapter, `classifyAwsError`, AWS credential chain           | P2       |
| `bedrock-agentcore-services` | `feature/generator-template-bedrock-agentcore-services` | AgentCore Memory / Gateway (MCP) / Identity ports + adapters, IdP→`UserContext` bridge                              | P2       |
| `mcp-server`                 | `feature/generator-template-mcp-server`                 | Exposes the app's own use-cases as MCP tools — inbound adapter, **stdio base**, static registry, dynamic SDK import | P2       |
| `mcp-server-http`            | `feature/generator-template-mcp-server-http`            | HTTP transport + auth (bearer/oauth) addon for `mcp-server` — always-authenticated, startup safety guard            | P2       |

---

### DevOps

| ID                          | Branch                                                 | One-liner                                                                                               | Priority |
| --------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | -------- |
| `docker`                    | `feature/generator-template-docker`                    | Multi-stage Dockerfile, docker-compose + dev override, `.dockerignore`, image-push GitHub Action        | P2       |
| `ci-github-actions`         | `feature/generator-template-ci-github-actions`         | Build+typecheck+lint+test CI, Vercel/Railway/Fly/VPS deploy, PR previews, Dependabot                    | P1       |
| `bedrock-agentcore-runtime` | `feature/generator-template-bedrock-agentcore-runtime` | AgentCore Runtime deploy target — ARM64 container, HTTP contract (`/invocations`, `/ping`), IAM, CDK/CI | P2       |

---

### DX / AI Collaboration

| ID              | Branch                                     | One-liner                                                                                       | Priority |
| --------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------- | -------- |
| `design-system` | `feature/generator-template-design-system` | `DESIGN.md` anchor, CSS tokens, Tailwind extension, base component stubs, optional Storybook    | P1       |
| `agents-md`     | `feature/generator-template-agents-md`     | Rich `AGENTS.md` + `.agents/` spec directory, mode system, tech-stack reference, commands table | P1       |

---

## Dependency Graph

```
env-setup (prerequisite for all)
├── rate-limiting
├── llm-adapter
│   ├── langgraph
│   └── llm-adapter-bedrock (Bedrock inference addon; ships @aws-sdk/client-bedrock-runtime)
├── error-handling
├── observability
├── shared-types (UserContext + MOCK_USER + session-manager)
│   └── auth-mock (dev AUTH_MODE=mock middleware)
│       ├── google-oauth
│       ├── github-oauth
│       ├── microsoft-entra
│       ├── magic-link
│       ├── adobe-ims-spa
│       └── supabase-auth (also requires supabase)
├── supabase (storage/database, no auth)
│   └── supabase-auth (adds @supabase/ssr session middleware)
├── bullmq
│   └── docker (adds redis service to compose)
│       ├── ci-github-actions
│       └── bedrock-agentcore-runtime (AgentCore deploy target; soft: observability)
│           └── bedrock-agentcore-services (Memory/Gateway/Identity; hard req: env-setup, soft: runtime)
├── mcp-server (stdio base; exposes the app's use-cases as MCP tools; soft: error-handling, observability)
│   └── mcp-server-http (HTTP transport + auth addon; soft: docker)
├── design-system
└── agents-md
```

> `bedrock-agentcore-services` hard-requires only `env-setup`; it is drawn under
> `bedrock-agentcore-runtime` to show the intended pairing (soft dep for `runtimeSessionId`
> threading). The `llm-adapter-bedrock` addon and the AgentCore family are detailed in
> [`16-bedrock-agentcore.md`](./16-bedrock-agentcore.md).

Conflicts declared in manifests:

- All six real auth providers (`google-oauth`, `github-oauth`, `microsoft-entra`, `magic-link`, `adobe-ims-spa`, `supabase-auth`) are mutually exclusive (each ships a root middleware; only one can win).
- The three standalone frameworks (`nextauth`, `clerk`, `better-auth`) conflict with all six real providers and with `auth-mock`.
- `supabase` (storage-only) has no auth-provider conflicts — coexists with any auth provider.

---

## Context & Plane Mapping (generated-project architecture)

This maps each template onto the bounded-context model the monorepo itself uses
(`.architecture/manifest.yaml`: a modular monolith of **planes** — `shared-kernel`, `core`,
`probabilistic`, `infrastructure`, `projection` — each holding bounded contexts typed
`core | supporting | shared-kernel`). It exists to make the **generated project's** intended
architecture explicit.

**The rule: templates do not map 1:1 to bounded contexts.** Most are _adapters_ or
_cross-cutting concerns_ that attach to a **shared hexagon** — every template emits into the same
`src/domain/ports` · `src/application` · `src/infrastructure` tree (one hexagon, many adapters),
not into parallel domains. Three consequences:

- **Many templates collapse into one context.** The five `llm-adapter` providers, the six auth
  providers, and the fourteen Adobe Firefly templates are **adapters within one integration /
  identity context each**, not 5 / 6 / 14 contexts.
- **Cross-cutting templates belong to no context.** `env-setup`, `error-handling`,
  `observability`, `rate-limiting`, `docker`, `ci-github-actions` are plumbing used _by_ every
  context.
- **A new bounded context appears only when a template carries a genuine subdomain** (own
  entities, invariants, ubiquitous language). This catalog is infrastructure-and-capability
  oriented, so almost none do — the generated project grows new contexts when the _developer's_
  domain does, which no template pre-decides.

| Template(s)                                                  | Plane            | Target context (in generated project) | Role                                                           |
| ------------------------------------------------------------ | ---------------- | ------------------------------------- | -------------------------------------------------------------- |
| `shared-types`                                               | `shared-kernel`  | `shared` (UserContext, session)       | **Shared kernel** (not a context)                              |
| `error-handling`                                             | `shared-kernel`  | `shared` (error hierarchy)            | Cross-cutting kernel                                           |
| `env-setup`, `observability`, `rate-limiting`                | `infrastructure` | — (spans all)                         | Cross-cutting concern (no context)                             |
| `docker`, `ci-github-actions`, `bedrock-agentcore-runtime`   | `infrastructure` | `deployment` / `runtime`              | Cross-cutting deploy target                                    |
| `llm-adapter` (+ `-bedrock`), Adobe Firefly family           | `infrastructure` | `external-integration`                | **Adapters** in one context                                    |
| `supabase`, `supabase-auth`                                  | `infrastructure` | `persistence`                         | **Adapters** in one context                                    |
| `bullmq`                                                     | `infrastructure` | `messaging`                           | **Adapters** in one context                                    |
| `auth-mock` + 6 providers (`google-oauth` … `supabase-auth`) | `core` (support) | `identity` (supporting)               | **Adapters** (mutually exclusive)                              |
| `langgraph`, `bedrock-agentcore-services`                    | `probabilistic`  | `agentic` (supporting)                | Ports + adapters (agent state/tools)                           |
| `mcp-server` (+ `-http` addon)                               | `probabilistic`  | `mcp-server` (supporting, **thin**)   | **Own context** — delivery boundary (http = transport adapter) |
| `design-system`                                              | `projection`     | `ui` / design-system (supporting)     | Projection concern                                             |
| `agents-md`                                                  | — (docs)         | — (no runtime code)                   | Meta / documentation                                           |

**Why `mcp-server` is the lone "own context" among them:** it is an _inbound/driving_ adapter
that exposes other contexts' use-cases. The monorepo classifies its own MCP server the same way
(`.architecture/contexts/probabilistic/mcp-server`, `probabilistic` plane). It qualifies as a
context only as a deliberately **anemic, supporting delivery boundary** — it must delegate to
existing use-cases and hold no domain logic (`18-mcp-server.md` enforces "tools are inbound
adapters, not new logic"). The moment it absorbs business rules, the boundary is wrong.

> Drawing a separate bounded context around _every_ template would place boundaries on technical
> lines — the classic distributed-monolith anti-pattern (duplicated domain concepts, artificial
> seams, a `shared` kernel everything secretly reaches into). The `shared-kernel` plane exists
> precisely to prevent that fragmentation.

---

## Implementation Status

| Layer                                | Status     | Notes                                                                                                                                                                  |
| ------------------------------------ | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@hexagen/template-engine` domain    | ✅ Shipped | Manifest schema, config model, `conflictFilePath()`, question types                                                                                                    |
| Dependency resolver                  | ✅ Shipped | DFS topological sort, cycle + missing + conflict detection                                                                                                             |
| `AddTemplateUseCase`                 | ✅ Shipped | Questions, file emission, config persistence, checklist                                                                                                                |
| `ValidateTemplatesUseCase`           | ✅ Shipped | Missing files, missing env vars, open conflict files                                                                                                                   |
| `FileSystemFileEmitter`              | ✅ Shipped | SHA-256 idempotency, atomic write, extension-preserving conflict files                                                                                                 |
| `InteractiveQuestionEngine`          | ✅ Shipped | select / multiselect / text / boolean / auto                                                                                                                           |
| CLI commands                         | ✅ Shipped | `templates list`, `templates info`, `add`, `validate-templates`                                                                                                        |
| `interpolate()` in `@hexagen/shared` | ✅ Shipped | Unified — no more duplicate in file-emitter                                                                                                                            |
| Template manifests (all 14)          | ✅ Shipped | Questions, outputs, env vars, checklist, dependency declarations                                                                                                       |
| **Template file content**            | ✅ Done    | Scaffold files landed for all standalone templates (incl. `env-setup`, `error-handling`, `observability`, `docker`, `design-system`, `agents-md`, `ci-github-actions`) |
| `--add` flag at `hexagen new`        | ⏳ Pending | Wire `AddTemplateUseCase` into the generation pipeline                                                                                                                 |
| `RemoteTemplateRegistry` adapter     | ⏳ Future  | Port abstraction already in place                                                                                                                                      |

---

## Adding a New Template

1. Create `packages/template-engine/templates/<id>/manifest.json` — declare questions, outputs, envVars, requires, conflicts, checklist.
2. Create `packages/template-engine/templates/<id>/files/<output-path>` for each output — use `{variable}` placeholders matching question IDs.
3. The template is immediately available via `hexagen templates list` and `hexagen add <id>` — no registration step required.

Manifest schema reference: `packages/template-engine/src/domain/template-manifest.ts`.
Smoke-test template: `packages/template-engine/templates/__example__/`.

---

## Architecture

```
@hexagen/template-engine
│
├── domain/
│   ├── template-manifest.ts   TemplateManifest, validateManifest()
│   ├── template-config.ts     TemplateConfig, TemplateInstallRecord, emptyConfig()
│   ├── question.ts            TemplateQuestion union, AnswerMap
│   └── conflict-path.ts       conflictFilePath() — extension-preserving conflict names
│
├── application/
│   ├── resolve-dependencies.ts  DFS topological sort
│   ├── use-cases/
│   │   ├── add-template.use-case.ts
│   │   └── validate-templates.use-case.ts
│   └── ports/
│       ├── template-registry.port.ts
│       ├── question-engine.port.ts
│       ├── file-emitter.port.ts
│       └── template-config-store.port.ts
│
└── infrastructure/
    ├── template-registry.adapter.ts    FileSystemTemplateRegistry
    ├── question-engine.adapter.ts      InteractiveQuestionEngine
    ├── file-emitter.adapter.ts         FileSystemFileEmitter
    └── template-config-store.adapter.ts FileSystemTemplateConfigStore

@hexagen/shared
└── types/interpolate.ts   interpolate() — canonical {variable} engine

@hexagen/sync
└── src/commands/
    ├── add/index.ts        hexagen add
    ├── add/validate.ts     hexagen validate-templates
    └── templates/          hexagen templates list|info
```

State is persisted in `.hexagen-template-config.json` at the project root (gitignored is fine; tracks installed versions, answers, generated-file hashes).

---

## Related Files

| File                                                             | Purpose                                                                                                                                     |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| [`00-template-system-design.md`](./00-template-system-design.md) | Full system design — manifest format, question types, conflict resolution, phase plan                                                       |
| [`16-bedrock-agentcore.md`](./16-bedrock-agentcore.md)           | Amazon Bedrock AgentCore template family — Runtime deploy target, Memory/Gateway/Identity services, + `llm-adapter-bedrock` inference addon |
| [`17-adobe-firefly.md`](./17-adobe-firefly.md)                   | Adobe Firefly Services family — `adobe-firefly-core` foundation (IMS S2S auth, jobs, storage) + 13 service addons                           |
| [`18-mcp-server.md`](./18-mcp-server.md)                         | MCP server template — exposes the generated app's use-cases as MCP tools (inbound adapter, stdio/HTTP, registration seam)                   |
| [`README.md`](./README.md)                                       | Dependency graph and install-order quick reference                                                                                          |
| `packages/template-engine/`                                      | Implementation                                                                                                                              |
| `packages/template-engine/templates/`                            | All template manifests and (future) scaffold files                                                                                          |
| `packages/sync/src/commands/add/`                                | CLI wiring                                                                                                                                  |
| PR #83                                                           | Initial implementation                                                                                                                      |
