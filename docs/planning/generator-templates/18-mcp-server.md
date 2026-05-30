# Template: MCP Server

**Branches:**

- `feature/generator-template-mcp-server` — stdio base
- `feature/generator-template-mcp-server-http` — HTTP transport + auth addon

## Purpose

Expose **the generated project's own application-layer use-cases as MCP tools**, so any MCP
client (Claude Desktop/Code, IDE agents, an AgentCore Gateway, a LangGraph tool node) can call
them over a standard protocol.

Architecturally this is the cheapest kind of template in the catalog: an MCP server is **another
inbound (driving) adapter** over use-cases that already exist. No business logic moves into it —
a tool is a zod-validated entry point that calls a use-case and serializes the result. The repo
already ships its own MCP server (`packages/mcp-server`,
[ADR-0010](../../../.architecture/decisions/ADR-0010-mcp-server-architecture.md)) on
`@modelcontextprotocol/sdk`, so this template productizes an established internal pattern for
generated projects.

## What this is NOT (read before installing)

| Looks similar                  | Actually is                                              | Direction                           |
| ------------------------------ | -------------------------------------------------------- | ----------------------------------- |
| `agents-md`                    | Docs telling AI agents how to work _on_ the codebase     | meta / documentation                |
| AgentCore **Gateway** (`16-…`) | Converts _existing external_ APIs/Lambdas into MCP tools | wraps third-party services          |
| **`mcp-server`** (this)        | Publishes _this app's own_ use-cases as MCP tools        | inbound adapter over your own ports |

---

## Revision note (review-driven)

An earlier single-template draft was rejected against four hard engine constraints (each verified
in code). The design below is the corrected version:

| Earlier draft                                                           | Engine reality                                                                                            | Correction                                                                                       |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `register-all.ts` "regenerated from the `tools` answer"                 | `interpolate()` is flat single-pass `{variable}` replacement — **no loops** (`shared/.../interpolate.ts`) | Ship a **static** `register-all.ts` + one always-emitted `example.tool.ts`; tools added manually |
| `tools` multiselect sourced "from the project's discoverable use-cases" | Manifest questions are **static**; the engine cannot inspect the target app's application layer           | Drop dynamic discovery; scaffold a generic example tool + docs                                   |
| "the form rejects `auth=none` unless `transport=stdio`"                 | `InteractiveQuestionEngine.ask()` validates **per-question only** — no cross-question hooks               | **Template split** (stdio base / http addon) + a runtime guard in the composition root           |
| HTTP-auth questions asked even when stdio is chosen                     | Questions are asked sequentially with no conditional display                                              | **Template split** removes the bloat entirely                                                    |
| (implicit) static `import` of the SDK                                   | ADR-0010: webpack chokes on the SDK's `node:` scheme → SDK must be **dynamically `import()`ed**           | Load `@modelcontextprotocol/sdk` via runtime `import()`                                          |

---

# Template 1 — `mcp-server` (stdio base)

**Branch:** `feature/generator-template-mcp-server`
**Requires:** `env-setup`
**Soft deps:** `error-handling` (domain error → MCP `isError` response), `observability` (tool-call latency + correlation id)

## Install-Time Questions

| ID            | Prompt                                  | Type    | Options / Default         |
| ------------- | --------------------------------------- | ------- | ------------------------- |
| `server_name` | MCP server name advertised to clients?  | text    | derived from project name |
| `resources`   | Scaffold MCP **resources** (read-only)? | boolean | default `false`           |
| `prompts`     | Scaffold reusable MCP **prompts**?      | boolean | default `false`           |

No `tools` question and no `transport`/`auth` questions — see Revision note. The base is
**stdio-only**, the secure local default (a subprocess of a trusted client, no network surface).

## Files Generated

```
src/infrastructure/mcp/                # @hexagen-server-only (ADR-0037)
  sdk.ts                               # dynamic import() wrapper for @modelcontextprotocol/sdk (ADR-0010)
  server.ts                            # composition root: builds McpServer, registers, wires stdio
  transport/
    stdio.ts                           # StdioServerTransport
  registry/
    tool-registry.ts                   # registerTool(name, schema, handler) — the seam (always emitted)
    register-all.ts                    # STATIC: imports + registers the example tool (and your added tools)
  tools/
    example.tool.ts                    # one always-emitted worked example wrapping a use-case
  resources/                           # (gated: resources=true)
  prompts/                             # (gated: prompts=true)
bin/
  cli.ts                               # entry point (run via `npx tsx`, or build → node dist/bin/cli.js)
.mcp.json.example                      # client config snippet (Claude Desktop / Code / IDE)
.env.mcp.example
```

## Generated .env Variables

```env
# MCP server (stdio base)
MCP_SERVER_NAME=
MCP_TRANSPORT=stdio
```

## Key Design Decisions

**Static registration, manual tools.** `tool-registry.ts` exposes
`registerTool(name, schema, handler)`. `register-all.ts` is a **static** file that imports the
always-emitted `example.tool.ts` and any tools the developer adds by hand — it never tries to
loop over a selected set (impossible under flat interpolation). Adding a tool = write a
`*.tool.ts`, add one import + `registerTool(...)` line. Documented, not codegen'd.

**Dynamic SDK import (ADR-0010).** `sdk.ts` loads `@modelcontextprotocol/sdk` via runtime
`import()`, not a static top-level import, mirroring the monorepo's own server. This avoids
webpack `node:`-scheme resolution errors in client-bundled apps **and** means a missing SDK fails
at runtime with a clear message rather than breaking the build.

**Tools are inbound adapters, not new logic.** `example.tool.ts` validates input with zod, calls
an existing use-case, maps the `Result` to an MCP response. The hexagon is untouched.

**Dry-run for write tools.** Following ADR-0010 decision #5, any generated tool that mutates state
takes a `dry_run` flag (validate, change nothing). The example tool demonstrates it.

**Server-only (ADR-0037).** All `infrastructure/mcp/**` is `// @hexagen-server-only` — it holds
credentials and privileged use-cases and must never reach a client bundle; the generated app gets
the per-package ESLint guard.

**Strict typing.** Repo is `strict: true`; handlers are explicitly typed
(`handler(input: z.infer<typeof Schema>): Promise<ToolResult>`), no implicit `any`.

## Phases

1. **SDK wrapper + server + stdio + registry.** `sdk.ts` (dynamic import), `McpServer`,
   `StdioServerTransport`, `tool-registry.ts`, static `register-all.ts`, `bin/cli.ts`,
   `example.tool.ts`. Validation: `npx @modelcontextprotocol/inspector npx tsx bin/cli.ts` lists
   and calls the example tool.
2. **Resources / prompts (gated).** Optional read-only resources + reusable prompts.
3. **Client config.** `.mcp.json.example` for Claude Desktop/Code + IDE.

## Post-Install Checklist (base)

```
✅ mcp-server installed (stdio)

  1. Install the SDK (no manifest deps field — this is the only channel):
       npm install @modelcontextprotocol/sdk
  2. Set MCP_SERVER_NAME.
  3. Add a tool: copy tools/example.tool.ts, wrap your use-case, add an import + registerTool() in register-all.ts.
  4. Add .mcp.json.example to your MCP client, pointing at:  npx tsx bin/cli.ts
     (.ts is not executable by node directly — use tsx, or build and run node dist/bin/cli.js)
  5. Verify:  npx @modelcontextprotocol/inspector npx tsx bin/cli.ts
  6. For remote/HTTP access, install the mcp-server-http addon.
```

---

# Template 2 — `mcp-server-http` (HTTP transport + auth addon)

**Branch:** `feature/generator-template-mcp-server-http`
**Requires:** `mcp-server`
**Conflicts:** none

Splitting HTTP out (a) removes the auth/transport prompt noise from stdio installs and (b) makes
HTTP transport **always authenticated** — there is no `auth=none` path to validate against,
because the unsafe combination is structurally excluded rather than rejected at prompt time.

## Install-Time Questions

| ID          | Prompt                       | Type   | Options / Default           |
| ----------- | ---------------------------- | ------ | --------------------------- |
| `auth`      | Auth for the HTTP transport? | select | `bearer` (default), `oauth` |
| `http_port` | HTTP port?                   | text   | `3333`                      |

`auth` has **no `none` option** — installing this addon means exposing the server over the
network, which is always authenticated.

## Files Generated

```
src/infrastructure/mcp/
  transport/
    http.ts                            # Streamable-HTTP transport on MCP_HTTP_PORT
  auth/
    bearer.ts                          # (gated: auth=bearer) token check
    oauth.ts                           # (gated: auth=oauth) OAuth resource-server check
  guard.ts                             # composition-root guard (below) — always emitted
.env.mcp-http.example
```

`server.ts` (from the base) gains an HTTP branch keyed on `MCP_TRANSPORT`. Because the engine
can't conditionally rewrite the base file, the addon emits `guard.ts` and the base's `server.ts`
imports it from a stable path that exists only after this addon is installed — so the addon
**re-emits `server.ts`** with the HTTP branch wired in (the `supabase-auth`-style overwrite;
accepts a `.hexagen-update` conflict copy if the user edited it).

## Generated .env Variables

```env
# MCP server (HTTP transport)
MCP_TRANSPORT=streamable-http
MCP_HTTP_PORT=3333
MCP_AUTH_MODE=bearer                   # bearer | oauth
MCP_BEARER_TOKEN=                      # required when MCP_AUTH_MODE=bearer
MCP_OAUTH_ISSUER_URL=                  # required when MCP_AUTH_MODE=oauth
MCP_ALLOWED_TOOLS=                     # optional allowlist (comma-separated); empty = all registered
```

## Key Design Decision — defense-in-depth runtime guard

The CLI cannot reject `transport=http + auth=none` at prompt time
(`InteractiveQuestionEngine` validates per-question only). The structural fix is this split (no
`auth=none` option here). The **belt-and-braces** fix is a runtime guard, since `.env` is
hand-edited after generation:

```typescript
// src/infrastructure/mcp/guard.ts  — @hexagen-server-only
export function assertSafeTransport(env: NodeJS.ProcessEnv): void {
  if (
    env.MCP_TRANSPORT === "streamable-http" &&
    (env.MCP_AUTH_MODE ?? "none") === "none"
  ) {
    throw new Error(
      "Refusing to start: MCP_TRANSPORT=streamable-http requires MCP_AUTH_MODE=bearer|oauth.",
    );
  }
}
```

Called first in the composition root, so an unsafe `.env` fails fast at startup, not in
production.

## Phases

1. **HTTP transport + guard.** `http.ts`, `guard.ts`, re-emit `server.ts` HTTP branch. Validation:
   an MCP HTTP client completes initialize + tools/list + tools/call.
2. **Auth (gated).** Bearer or OAuth resource-server check before dispatch. Validation: 401 on bad
   token; tool runs on good; `assertSafeTransport` throws when auth unset.

## Post-Install Checklist (HTTP addon)

```
✅ mcp-server-http installed

  1. Set MCP_AUTH_MODE + MCP_BEARER_TOKEN (or MCP_OAUTH_ISSUER_URL) and MCP_HTTP_PORT.
  2. Never set MCP_AUTH_MODE=none with HTTP transport — the server refuses to start (guard.ts).
  3. Review MCP_ALLOWED_TOOLS — empty means all registered tools are reachable over the network.
  4. To expose via AgentCore Gateway, register the HTTP server URL as a Gateway target (16-bedrock-agentcore.md).
  5. Containerize with the `docker` template for remote deploy.
```

---

## Template Dependencies

- `mcp-server`: requires `env-setup`; soft `error-handling`, `observability`.
- `mcp-server-http`: requires `mcp-server`; soft `docker` (containerize remote transport).
- Composes with: AgentCore **Gateway** (register as a target), `llm-adapter` / `langgraph` /
  Adobe Firefly (their use-cases are natural tools).

---

## Risks & Open Questions

1. **Security is the real cost.** Exposing use-cases as callable tools is an attack surface,
   sharpest over HTTP. Mitigations are first-class: stdio-only base, HTTP split with no
   `auth=none` option, the startup guard, `MCP_ALLOWED_TOOLS`, and tools running under existing
   app permission checks (the MCP layer adds, never bypasses, them).
2. **Spec/SDK churn.** Pin `@modelcontextprotocol/sdk` to the repo's line (`^1.0.0`) and state the
   targeted spec revision; dynamic import means the version is resolved at runtime (ADR-0010 risk).
3. **Manual tool wiring is the v1 contract.** No auto-discovery of the application layer (engine
   can't inspect the target project). The example tool + docs are the supported path; auto-gen of
   use-case schemas is a follow-up, not v1.
4. **`server.ts` overwrite coupling.** The HTTP addon re-emits `server.ts`; if the user edited it,
   they get a `.hexagen-update` conflict copy to reconcile. A registration-seam for transports
   (base exposes `registerTransport()`) would avoid the overwrite — preferred if the base is built
   with that seam from the start.
5. **Premature for thin projects.** If the app has no meaningful use-cases, an MCP server is
   scaffolding over nothing — keep it opt-in, never a generation default.
6. **Long-running tools.** Tools wrapping long jobs (Firefly media, Substance) should return a job
   handle, not block the call; document the async-tool pattern.
