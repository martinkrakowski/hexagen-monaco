# `mcp-server` — MCP Server (stdio) add-on template

Exposes the generated project's **application use-cases as MCP tools** over stdio,
so any MCP client (Claude Desktop/Code, IDE agents, an AgentCore Gateway, a
LangGraph tool node) can call them. An MCP tool is an **inbound adapter** over a
use-case you already have — no business logic moves into it.

Design intent: `docs/planning/generator-templates/18-mcp-server.md`. Requires
`env-setup`; soft-pairs with `error-handling` + `observability`.

## What it scaffolds

| File                                                      | Purpose                                                                                                       |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `src/infrastructure/mcp/sdk.ts`                           | Dynamic `import()` of `@modelcontextprotocol/sdk` (ADR-0010)                                                  |
| `src/infrastructure/mcp/server.ts`                        | Composition root: a `registerTransport(factory)` seam + `startServer()`                                       |
| `src/infrastructure/mcp/transport/stdio.ts`               | stdio transport **factory**                                                                                   |
| `src/infrastructure/mcp/transport/register-transports.ts` | Static transport registrations (base: stdio) — the `-http` addon extends this, never `server.ts`              |
| `src/infrastructure/mcp/registry/tool-registry.ts`        | `registerTool` seam + `applyTools()`                                                                          |
| `src/infrastructure/mcp/registry/register-all.ts`         | Static tool registrations                                                                                     |
| `src/infrastructure/mcp/tools/example.tool.ts`            | Worked tool: input validation, use-case call, **explicit `Result`→MCP mapping (incl. error path)**, `dry_run` |
| `bin/cli.ts`, `.mcp.json.example`, `.env.mcp.example`     | Entry point + client/env config                                                                               |
| `resources/`, `prompts/` (opt-in)                         | Read-only resource + reusable prompt stubs                                                                    |
| `*.test.ts`                                               | `node:test` scaffolds — emitted **only under `--with-tests`**                                                 |

Everything under `infrastructure/mcp/**` is `@hexagen-server-only` (ADR-0037): it
holds credentials + privileged use-cases and must never reach a client bundle.

## Adding a tool

1. Copy `tools/example.tool.ts`, wrap your use-case, and **keep the explicit
   error mapping + `dry_run`** — that example is the pattern every tool inherits.
2. Add one import + one `registerTool(...)` line in `registry/register-all.ts`.

(Static registration by design: the template engine can't codegen a loop over a
selected tool set, so the list is hand-maintained.)

## Transports

The base ships **stdio** — the secure local default (a subprocess of a trusted
client, no network surface). For network access, install the **`mcp-server-http`**
addon: it registers a `streamable-http` transport via `register-transports.ts`
(the factory seam), so it never rewrites `server.ts`. HTTP is always authenticated.

## Setup

`hexagen templates info mcp-server` for the checklist. In short: `npm install
@modelcontextprotocol/sdk zod`, set `MCP_SERVER_NAME`, then verify with
`npx @modelcontextprotocol/inspector npx tsx bin/cli.ts`.
