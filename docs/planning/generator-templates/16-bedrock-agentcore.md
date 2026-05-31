# Template Family: Amazon Bedrock AgentCore

**Branches:**

- `feature/generator-template-bedrock-agentcore-runtime` — deploy target (DevOps)
- `feature/generator-template-bedrock-agentcore-services` — Memory / Gateway / Identity (AI / Agents)
- `feature/generator-template-bedrock` — Bedrock model inference provider (companion, inside `llm-adapter`)

**Status:** ✅ Implemented & merged (2026-05-31).

| Deliverable                              | Template id                  | PR            |
| ---------------------------------------- | ---------------------------- | ------------- |
| Companion — Bedrock model inference      | `llm-adapter-bedrock`        | #136 (merged) |
| Template 1 — deploy target (DevOps)      | `bedrock-agentcore-runtime`  | #137 (merged) |
| Template 2 — Memory / Gateway / Identity | `bedrock-agentcore-services` | #138 (merged) |

Both pre-coding decisions are resolved as shipped: **TS Container + HTTP contract** (not a
Python agent) and **hybrid provisioning** (`agentcore.json` + IAM policy + direct-SDK deploy CI).
The remaining items are live-AWS / GA-SDK validation only (see
[Cross-Cutting Risks & Open Questions](#cross-cutting-risks--open-questions)) — surfaced in
generated code comments and checklists, not code gaps. The out-of-scope v1 services
(Code Interpreter, Browser, Evaluations, Payments, Policy, Registry) remain future templates.

## Purpose

Make a Hexagen project a first-class citizen of **Amazon Bedrock AgentCore** — AWS's
serverless agent platform — without abandoning the project's TypeScript hexagonal
architecture. AgentCore is not a single product; it is a set of modular services:

| AgentCore service          | What it is                                                                    | How this family uses it                                                      |
| -------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **Runtime**                | Serverless, session-isolated container host for agents (ARM64, HTTP contract) | Deploy target — package the Hexagen app as an AgentCore-compatible container |
| **Memory**                 | Short-term (multi-turn) + long-term (cross-session) memory stores             | `MemoryPort` + adapter                                                       |
| **Gateway**                | Turns APIs / Lambdas / MCP servers into MCP tools behind one endpoint         | `ToolGatewayPort` + MCP client adapter                                       |
| **Identity**               | Agent identity + inbound/outbound auth, IdP-compatible (Cognito/Okta/Entra)   | `AgentIdentityPort` + adapter; bridges to existing auth templates            |
| **Observability**          | OTEL traces/logs/metrics → CloudWatch                                         | OTEL exporter wiring; integrates with the `observability` template           |
| Code Interpreter / Browser | Sandboxed code exec / managed browser tools                                   | Out of scope for v1 — noted as future                                        |

The user has selected the **full platform** scope: Runtime deploy target **and** the
Memory / Gateway / Identity service adapters **and** observability. Because that is a large
surface, it ships as a **template family** across the three branches above rather than one
monolithic template. They compose: installing `bedrock-agentcore-runtime` alone gives a
deployable agent; adding `bedrock-agentcore-services` layers in stateful/tool/identity
capabilities.

---

## The Core Architectural Decision (read this first)

**AgentCore's first-class CLI path scaffolds _Python_ agents** (Strands, LangGraph, Google
ADK, OpenAI Agents) via `agentcore create`. Hexagen projects are **TypeScript / hexagonal**.
We do **not** want to generate a parallel Python agent — that would split the codebase and
defeat the template's purpose.

The escape hatch: **AgentCore Runtime is fundamentally a container + an HTTP contract**, not
a Python runtime. Any container that:

1. Listens on **port 8080**,
2. Implements **`POST /invocations`** (the agent entrypoint; receives a JSON payload such as
   `{"prompt": "..."}`, may stream the response) and **`GET /ping`** (health, returns 200),
3. Is built for **ARM64 (AWS Graviton)**,

…can be deployed to AgentCore Runtime via the **Container build type**. So this family targets
AgentCore Runtime with the **existing Hexagen TS server**, exposing the two contract endpoints,
rather than scaffolding Python.

Consequences:

- The family **depends on `docker`** (it reuses/extends the multi-stage Dockerfile, forcing
  `--platform=linux/arm64`).
- We use the **AWS SDK / `InvokeAgentRuntime`** and (optionally) CDK for provisioning, but we
  do **not** require the `@aws/agentcore` Python-oriented `create` flow. The `agentcore` CLI
  can still be used by the developer for `deploy`/`invoke`/`logs` against our container, and
  the checklist documents that path.
- `agentcore.json` and `aws-targets.json` are generated as config the developer can hand to
  either the `agentcore` CLI or our own CDK stack.

> **Decision (resolved — shipped as the hybrid below):** provision via the **`@aws/agentcore` CLI's CDK**
> (less code, AWS-owned, but adds an npm global + Python/CDK prereqs) **vs.** a **thin
> hand-written CDK/SDK deploy** we own (more code, fewer external prereqs, full control).
> This plan assumes a **hybrid**: generate `agentcore.json` so the AWS CLI works out of the
> box, _and_ generate a minimal IAM policy + deploy GitHub Action that uses
> `aws bedrock-agentcore create-agent-runtime` / `InvokeAgentRuntime` directly so CI doesn't
> need the interactive CLI.

---

# Template 1 — `bedrock-agentcore-runtime` (DevOps)

**Branch:** `feature/generator-template-bedrock-agentcore-runtime`
**Requires:** `docker`, `env-setup`
**Soft deps:** `observability` (OTEL wiring), `bedrock` provider in `llm-adapter` (the model the agent calls)

## Install-Time Questions

| ID             | Prompt                                | Type    | Options / Default                                                    |
| -------------- | ------------------------------------- | ------- | -------------------------------------------------------------------- |
| `aws_region`   | AWS region for AgentCore Runtime?     | select  | `us-west-2` (default), `us-east-1`, `eu-central-1`, `ap-southeast-2` |
| `agent_name`   | AgentCore agent name?                 | text    | derived from project name                                            |
| `protocol`     | Runtime protocol?                     | select  | `HTTP` (default), `MCP`, `A2A`                                       |
| `build_type`   | Build type?                           | select  | `Container` (default — required for TS), `CodeZip`                   |
| `inbound_auth` | Inbound auth on the runtime endpoint? | select  | `IAM` (default), `OAuth`                                             |
| `provision`    | How to provision?                     | select  | `agentcore-cli` (default), `cdk`, `none` (config only)               |
| `deploy_ci`    | Generate a deploy GitHub Action?      | boolean | default `true`                                                       |

## Files Generated

```
Dockerfile.agentcore                       # ARM64, multi-stage, exposes 8080 (extends docker template's image)
src/infrastructure/agentcore/
  http/
    invocations.handler.ts                 # POST /invocations — adapts payload -> existing agent/use-case
    ping.handler.ts                        # GET /ping — health, 200
    server.ts                              # binds the two routes on :8080 (or reuses app server)
  runtime/
    payload.ts                             # zod schema for the invocation payload + response envelope
    session.ts                             # reads runtimeSessionId, threads it to Memory/observability
agentcore/
  agentcore.json                           # agent + resource config (agentcore CLI compatible)
  aws-targets.json                         # { account, region } deploy target
iam/
  agentcore-runtime-role.policy.json       # execution role: bedrock:InvokeModel*, logs, agentcore
.github/workflows/
  deploy-agentcore.yml                     # build ARM64 image -> ECR -> create/update agent runtime (if deploy_ci)
.env.agentcore.example
```

## Generated .env Variables

```env
# AgentCore Runtime
AWS_REGION=us-west-2
AGENTCORE_AGENT_NAME=
AGENTCORE_RUNTIME_ARN=                      # filled after first deploy; used by InvokeAgentRuntime
AGENTCORE_PROTOCOL=HTTP

# Auth (credential chain in prod; keys for local only)
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_SESSION_TOKEN=

# Inbound OAuth (only if inbound_auth=OAuth)
AGENTCORE_OAUTH_DISCOVERY_URL=
AGENTCORE_OAUTH_ALLOWED_AUDIENCE=
```

## HTTP Protocol Contract (the heart of Template 1)

`invocations.handler.ts` is the bridge between AgentCore and the hexagon:

The snippets below are illustrative, but generated code is held to the real bar: the repo is
`strict: true` (so `noImplicitAny` — every parameter is explicitly typed) and the handler
files are **server-only** under ADR-0037 (`// @hexagen-server-only`, never importable from a
client bundle — they use Node built-ins + the AWS SDK). The handlers are framework-agnostic
Web `Request`/`Response`.

```typescript
// POST /invocations  — @hexagen-server-only (ADR-0037)
// AgentCore sends an arbitrary JSON payload + a runtimeSessionId header/context.
// Contract: 200 with a JSON body, OR a streamed body when the use-case streams.
export async function handleInvocation(req: Request): Promise<Response> {
  const { prompt, stream, ...rest } = invocationPayloadSchema.parse(
    await req.json(),
  );
  const sessionId = readSessionId(req); // session.ts — seeds the correlation context (below)

  // Streaming path: the use-case yields chunks; bridge them to a ReadableStream / SSE.
  if (stream && agentUseCase.runStream) {
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        const enc = new TextEncoder();
        for await (const chunk of agentUseCase.runStream({
          prompt,
          sessionId,
          ...rest,
        })) {
          controller.enqueue(enc.encode(JSON.stringify(chunk) + "\n")); // AgentCore reads chunked body
        }
        controller.close();
      },
    });
    return new Response(body, {
      headers: { "content-type": "application/x-ndjson" },
    });
  }

  // Buffered path.
  const result = await agentUseCase.run({ prompt, sessionId, ...rest });
  return Response.json({ output: result }); // envelope matches payload.ts
}

// GET /ping  -> 200 { status: "Healthy" }   (also @hexagen-server-only)
```

Design rule: the handlers live in `infrastructure/`, depend only on an application-layer
port/use-case, and contain **no** AgentCore-specific business logic. Swapping AgentCore for
plain HTTP/Lambda is a handler change, nothing deeper.

**Correlation, not double-instrumentation.** `session.ts` reads the AgentCore
`runtimeSessionId` and **seeds the `observability` template's AsyncLocalStorage correlation
store with it** (using it as the correlation ID, or a deterministic derivation) at the top of
each invocation — so the app's structured logs and AgentCore's native OTEL→CloudWatch traces
share one ID instead of emitting two disjoint trace trees. The handler does **not** add its
own logging/tracing layer; it only seeds the context the existing logger already reads. If
`observability` is not installed, `session.ts` falls back to threading `sessionId` explicitly.

## Phases

**Phase 1 — Container & contract.** `Dockerfile.agentcore` (ARM64, `EXPOSE 8080`), the two
handlers, `server.ts`, payload schema. Validation: `docker buildx build --platform linux/arm64`
succeeds; `curl :8080/ping` → 200; `POST /invocations` round-trips a stubbed use-case.

**Phase 2 — Config generation.** `agentcore.json` + `aws-targets.json` from the answers, so
`agentcore deploy`/`agentcore invoke` work against the container. Validation: `agentcore validate`
passes on the generated config (documented manual step; not run in our CI).

**Phase 3 — IAM + provisioning.** Execution-role policy (`bedrock:InvokeModel`,
`bedrock-agentcore:*` for the runtime, `logs:*`, `cloudwatch:PutMetricData`). If
`provision=cdk`, a minimal CDK stack; if `agentcore-cli`, document the CLI path. Validation:
`aws iam simulate-principal-policy` smoke or a JSON-schema lint of the policy.

**Phase 4 — Deploy CI.** `deploy-agentcore.yml`: configure AWS creds (OIDC), `docker buildx`
ARM64 → push to ECR → `aws bedrock-agentcore create-agent-runtime` / update, capture ARN.
Gated on `deploy_ci`. Validation: `act`/yaml-lint; dry-run job.

**Phase 5 — Inbound auth.** If `inbound_auth=OAuth`, validate the bearer token in
`invocations.handler.ts` against `AGENTCORE_OAUTH_DISCOVERY_URL`/audience before dispatch;
otherwise rely on IAM (SigV4) at the runtime boundary. Validation: unit test rejecting a
bad-audience token.

## Post-Install Checklist (Runtime)

```
✅ bedrock-agentcore-runtime installed

  1. Enable model access for your chosen Bedrock model in the Bedrock console (per region).
  2. Bootstrap CDK once if provisioning via CDK: cdk bootstrap
  3. Build + smoke the contract locally:
       docker buildx build --platform linux/arm64 -f Dockerfile.agentcore -t agent .
       docker run -p 8080:8080 agent  &&  curl localhost:8080/ping
  4. Deploy:  agentcore deploy   (or push to main to trigger deploy-agentcore.yml)
  5. Invoke:  agentcore invoke --prompt "hello"   (or boto3 InvokeAgentRuntime with the ARN)
  6. Copy AGENTCORE_RUNTIME_ARN from `agentcore status` into .env.
  7. Logs/traces: agentcore logs ; agentcore traces list
```

---

# Template 2 — `bedrock-agentcore-services` (AI / Agents)

**Branch:** `feature/generator-template-bedrock-agentcore-services`
**Requires:** `env-setup`
**Soft deps:** `bedrock-agentcore-runtime` (sessionId threading), one auth provider (Identity bridge)

Ports + adapters for the stateful AgentCore services, each behind a hexagonal port so the
application layer never imports an AWS SDK directly.

## Install-Time Questions

| ID                  | Prompt                       | Type        | Options / Default                             |
| ------------------- | ---------------------------- | ----------- | --------------------------------------------- |
| `services`          | Which AgentCore services?    | multiselect | `memory`, `gateway`, `identity` (default all) |
| `memory_mode`       | Memory retention?            | select      | `shortTerm`, `longAndShortTerm` (default)     |
| `memory_strategies` | Long-term memory strategies? | multiselect | `SEMANTIC`, `SUMMARY`, `USER_PREFERENCE`      |
| `gateway_targets`   | Initial gateway tool source? | select      | `lambda`, `openapi`, `mcp`, `none`            |
| `identity_idp`      | Identity provider to bridge? | select      | `cognito`, `okta`, `entra`, `auth0`, `none`   |

## Files Generated (gated per `services`)

```
src/domain/ports/out/
  agent-memory.port.ts          # MemoryPort: store/retrieve short+long term, keyed by sessionId
  tool-gateway.port.ts          # ToolGatewayPort: listTools(), invokeTool(name, args)
  agent-identity.port.ts        # AgentIdentityPort: getWorkloadToken(), exchangeForOutbound()
src/infrastructure/agentcore/
  memory/
    agentcore-memory.adapter.ts # @aws-sdk/client-bedrock-agentcore (CreateEvent/RetrieveMemory)
    memory-config.ts            # strategy + retention config from answers
  gateway/
    agentcore-gateway.adapter.ts # MCP client over the Gateway endpoint
    mcp-tool-mapper.ts          # Gateway tool -> internal Tool shape
  identity/
    agentcore-identity.adapter.ts # workload identity + outbound credential exchange
    idp-bridge.ts               # maps {idp} claims -> UserContext (shared-types)
agentcore/agentcore.json         # MERGE: append memory/gateway/identity resource blocks
.env.agentcore-services.example
```

## Generated .env Variables

```env
# AgentCore Memory (if selected)
AGENTCORE_MEMORY_ID=
AGENTCORE_MEMORY_NAMESPACE=default

# AgentCore Gateway (if selected)
AGENTCORE_GATEWAY_URL=
AGENTCORE_GATEWAY_ID=

# AgentCore Identity (if selected)
AGENTCORE_WORKLOAD_IDENTITY_ARN=
AGENTCORE_IDP_DISCOVERY_URL=
```

## Key Design Decisions

**Ports are framework-neutral.** `MemoryPort.retrieve(sessionId, query)` returns domain
objects, not AWS shapes. This means an agent's use-case can run against AgentCore Memory in
prod and an in-memory fake in tests — the langgraph/agent code never changes.

**Gateway is consumed as MCP.** The adapter is an MCP client pointed at the Gateway endpoint;
tools surface through `ToolGatewayPort.listTools()`. This dovetails with `langgraph`'s tool
nodes and keeps tool wiring declarative.

**Identity bridges to existing auth.** `idp-bridge.ts` maps the configured IdP's claims onto
the `UserContext` domain type from **`shared-types`**, so AgentCore identity and the app's
own auth (`google-oauth`, `microsoft-entra`, etc.) speak the same currency. When
`identity_idp` matches an installed auth provider, reuse its claim mapping.

**`agentcore.json` is merged, not overwritten.** Template 2 appends resource blocks to the
file Template 1 created, using the engine's non-destructive emit (conflict copy if
user-modified).

## Phases

**Phase 1 — Ports.** Define the three ports; compile-only. Validation: tsc.

**Phase 2 — Memory adapter.** `CreateEvent` (write turn) + `RetrieveMemory` (semantic/summary
recall) via `@aws-sdk/client-bedrock-agentcore`. Validation: mocked-SDK unit tests for
store + retrieve; in-memory fake for the port.

**Phase 3 — Gateway adapter.** MCP client; `listTools`/`invokeTool`; map errors to the LLM/
tool error hierarchy. Validation: mock MCP server, assert tool discovery + invoke.

**Phase 4 — Identity adapter + IdP bridge.** Workload identity token fetch, outbound
credential exchange, claim→`UserContext` mapping. Validation: unit test mapping sample
Cognito/Okta claims to `UserContext`.

**Phase 5 — Config merge + checklist.** Append resource blocks to `agentcore.json`; checklist
covers `agentcore add memory|gateway`, granting the runtime role access to each resource.

## Post-Install Checklist (Services)

```
✅ bedrock-agentcore-services installed

  0. Install the SDK (no manifest deps field — this is the only channel):
       npm install @aws-sdk/client-bedrock-agentcore
  1. Provision the resources:  agentcore add memory --strategies SEMANTIC ; agentcore add gateway ; agentcore deploy
  2. Copy AGENTCORE_MEMORY_ID / GATEWAY_URL / WORKLOAD_IDENTITY_ARN from `agentcore status` into .env.
  3. Grant the runtime execution role access to the new Memory/Gateway resources.
  4. If using Identity: register your IdP discovery URL and confirm claim mapping to UserContext.
  5. Run the port fakes test suite to confirm wiring before hitting live AWS.
```

---

# Companion — Bedrock model inference (split addon: `llm-adapter-bedrock`)

**Branch:** `feature/generator-template-bedrock`
**Requires:** `llm-adapter`, `error-handling`, `env-setup`

AgentCore agents need a model to call. An earlier draft of this plan added Bedrock as a
**sixth provider option inside `llm-adapter`**. A code review (see _Revision note_ below)
showed that is unsafe, and it is corrected here: Bedrock ships as a **separate addon
template `llm-adapter-bedrock` that `requires: ["llm-adapter"]`** — the template-splitting
pattern of record for conditional external dependencies (`engine-gated-outputs.md` →
"What gating is NOT applied to"; precedent: `supabase` / `supabase-auth`).

**Why splitting, not a gated provider option (the trap):**

- The engine does **flat `{variable}` interpolation only** — no conditional blocks inside a
  file (`engine-gated-outputs.md`). So `llm-router.ts` / `index.ts` import their adapters
  **statically and unconditionally**.
- Gating `bedrock-llm-client.adapter.ts` off (when Bedrock isn't selected) would leave those
  static imports dangling → **TS/bundler resolution failure**.
- Not gating it means the adapter — and its **`@aws-sdk/client-bedrock-runtime`** import —
  ships to **every** `llm-adapter` user. The other five adapters are vanilla `fetch`
  (zero-dependency); only Bedrock needs a heavyweight SDK, so this would break the build for
  everyone who didn't `npm install` it.
- `TemplateManifest` has **no `dependencies` field** (`domain/template-manifest.ts`), and
  `validateManifest` silently drops unknown keys — so a manifest cannot install the SDK; that
  must be a **checklist instruction**.

A separate addon resolves all three: its files (adapter + Bedrock-registered router/constants)
are only emitted when the addon is installed, and the SDK install lives in its checklist.

Summary (full detail tracked on its branch):

- Manifest `llm-adapter-bedrock`: `requires: ["llm-adapter"]`; questions `bedrock_region`,
  `bedrock_inference`, `bedrock_guardrails`.
- Emits `src/infrastructure/llm/adapters/bedrock-llm-client.adapter.ts` using
  `@aws-sdk/client-bedrock-runtime` **`ConverseCommand`** (provider-agnostic across Bedrock
  model families; not `InvokeModel`).
- Registers Bedrock in the router. **Preferred:** add a small provider-registration seam to the
  base `llm-adapter` (`registerProvider(name, factory)` consulted by `llm-router.ts`) so the
  addon registers without overwriting base files. **Fallback** (matches `supabase-auth`'s
  overwrite style): the addon re-emits `llm-router.ts` / `models.ts` / `capabilities.ts` /
  `index.ts` with Bedrock wired in — accepting that these become base-coupled copies that
  trip a `.hexagen-update` conflict file if the user has edited them. Prefer the seam to avoid
  that coupling.
- `MODELS.bedrock` (env-overridable inference-profile IDs); Bedrock IDs in `capabilities.ts`.
  (Model IDs in env vars is **consistent with the existing convention** — every provider's
  model names already resolve from env, e.g. `OPENAI_REASONING_MODEL`; the adapter remains the
  AWS↔domain translation boundary, so this does not breach ADR-0017.)
- New `classifyAwsError()` in `llm-errors.ts` mapping SDK exceptions
  (`ThrottlingException`→`LLMRateLimitError`, `AccessDeniedException`→`LLMAuthError`,
  `ValidationException`→non-retryable `LLMServiceError`, `ModelTimeoutException`/`5xx`→retryable).
- Auth = AWS credential chain (no `BEDROCK_API_KEY`); `check-env` must treat `AWS_*` as
  **optional** so IAM-role deploys pass.
- Checklist includes **`npm install @aws-sdk/client-bedrock-runtime`** (the only channel for
  the dependency — there is no manifest deps field).

> **Revision note (review-driven):** the in-template "sixth provider" framing was rejected for
> the compile/dependency hazards above. The same lesson applies to **Template 2** — its
> AgentCore service adapters pull `@aws-sdk/client-bedrock-agentcore`, which is exactly why
> those already live in their own template (everyone installing it wants the SDK) and why its
> checklist must carry the `npm install`. The build-time hazard is structural to the engine,
> not specific to Bedrock.

---

## Dependency Graph (this family)

```
env-setup
├── llm-adapter
│   └── llm-adapter-bedrock             ← companion (split addon, requires llm-adapter)
├── docker (ARM64 image)
│   └── bedrock-agentcore-runtime       ← Template 1 (deploy target)
│       └── bedrock-agentcore-services  ← Template 2 (memory/gateway/identity)
├── observability  ───────────────────▶ OTEL → CloudWatch (soft dep of Template 1)
└── shared-types  ────────────────────▶ UserContext (Identity claim mapping, Template 2)
```

Catalog placement: Template 1 under **DevOps** (sibling to `docker`, `ci-github-actions`);
Template 2 under **AI / Agents** (sibling to `langgraph`); companion as a standalone
`llm-adapter-bedrock` addon (sibling to `supabase-auth`), **not** a provider option inside
`llm-adapter`.

---

## Cross-Cutting Risks & Open Questions

> **Resolution status (post-implementation):** #1, #2, #3, #4, #5, #7, #9 are resolved as shipped
> across the three merged templates. The only items still requiring a live AWS account / GA SDK to
> confirm are **#6's open detail** (exact session-id field) and the AgentCore data-plane SDK command
> shapes used by the Memory/Identity adapters — both flagged in generated code comments. #8 is
> intentionally out of scope for v1.

1. **TS vs Python runtime** — confirm the Container-build + HTTP-contract approach (above) is
   acceptable vs. scaffolding a separate Python agent. This is the load-bearing decision.
   — ✅ **Resolved:** Container + HTTP contract shipped in `bedrock-agentcore-runtime`.
2. **Provisioning path** — `@aws/agentcore` CLI (extra Node/Python/CDK prereqs) vs. our own
   thin CDK/SDK deploy. Plan assumes the hybrid; confirm.
   — ✅ **Resolved:** hybrid shipped (`agentcore.json` + IAM policy + direct-SDK deploy CI; optional CDK stack).
3. **`check-env` + `AWS_*` optionality** — coordinate with `env-setup` so IAM-role deploys
   don't fail the env gate (same constraint as the Bedrock inference companion).
4. **ARM64 build** — `docker buildx` (Graviton) must be available in CI; the `docker` template's
   image may need a `--platform=linux/arm64` variant.
5. **Model access is a hard prerequisite** — Bedrock returns `AccessDeniedException` until each
   model is enabled per-account/per-region; surfaced in checklists, not as a stack trace.
6. **Observability overlap** — resolved in the HTTP-contract section: `session.ts` seeds the
   `observability` AsyncLocalStorage correlation store from `runtimeSessionId` so app logs and
   AgentCore's native OTEL→CloudWatch traces share one ID. The handler adds **no** second
   logging/tracing layer. Open detail: confirm the exact field AgentCore exposes the session id
   on (header vs. runtime context) in `readSessionId`.
7. **Region resolution — don't override the SDK cascade.** The `.env.example` may carry an
   `AWS_REGION` default (it's an example), but **adapter/runtime code must not pass a hardcoded
   region literal** to the AWS SDK client. On Graviton/ECS the region is resolved natively
   (env → shared profile → IMDS/IRSA); pass `region` to the client **only** when the user
   explicitly set `AWS_REGION`/`BEDROCK_REGION`, otherwise omit it and let the SDK cascade win.
   A literal fallback like `?? "us-east-1"` would silently mis-region in-cluster.
8. **Scope creep** — Code Interpreter, Browser, Evaluations, Payments, Policy, Registry are
   explicitly **out of scope for v1**; list as future templates if demand appears.
9. **Preview surface** — the AgentCore Harness (config-based agent loop) and parts of the CLI
   are preview; pin the family to the GA Runtime + Memory/Gateway/Identity surface and avoid
   preview-only features in generated code.

---

## Suggested Build Order

1. **Companion `llm-adapter-bedrock` addon** (`requires: llm-adapter`) — smallest, unblocks "agent has a model."
2. **Template 1 `bedrock-agentcore-runtime`** — deployable agent (depends on `docker`).
3. **Template 2 `bedrock-agentcore-services`** — Memory → Gateway → Identity, in that order.

Each is independently shippable and independently valuable, matching the family's compose-any-subset
property.
