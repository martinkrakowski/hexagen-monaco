# Bedrock AgentCore Services (`bedrock-agentcore-services`)

> Hexagonal ports + adapters for Amazon Bedrock AgentCore stateful services — Memory, Gateway
> (APIs/Lambdas/MCP as MCP tools), and Identity (workload token + IdP claim bridge to `UserContext`).

|               |                                                         |
| ------------- | ------------------------------------------------------- |
| **ID**        | `bedrock-agentcore-services`                            |
| **Category**  | LLM / agents — stateful services                        |
| **Requires**  | `env-setup`                                             |
| **Conflicts** | none                                                    |
| **Branch**    | `feature/generator-template-bedrock-agentcore-services` |

Author/agent-facing reference, beside `manifest.json` — not emitted into projects.

## What it does

Adds ports + adapters for AgentCore's stateful services, gated by which you enable:

- **Memory** — multi-turn + long-term recall (`SEMANTIC` / `SUMMARY` / `USER_PREFERENCE` strategies).
- **Gateway** — exposes APIs/Lambdas/MCP servers as MCP tools.
- **Identity** — bridges a workload token + IdP claims onto `UserContext`.

The application layer depends only on the ports; adapters sit behind them at the composition root.

## Service & API

- **SDK:** `@aws-sdk/client-bedrock-agentcore`. Ports: `AgentMemoryPort`, `ToolGatewayPort`,
  `AgentIdentityPort` (each emitted only if its service is selected).

## Install

`hexagen add bedrock-agentcore-services`. Questions: `services` (multiselect:
memory/gateway/identity), `memory_mode`, `memory_strategies` (multiselect), `gateway_targets`
(`lambda`/`openapi`/`mcp`/`none`), `identity_idp` (`cognito`/`okta`/`entra`/`auth0`/`none`).
Emits the gated port/adapter sets under `src/{domain/ports/out,infrastructure/agentcore}/…` plus
`agentcore/agentcore-services.json`, `.env.agentcore-services.example`.

## Usage

```ts
// Wire each adapter behind its port at the composition root, e.g.:
import { AgentCoreMemoryAdapter } from "@/infrastructure/agentcore/memory/agentcore-memory.adapter";
const memory: AgentMemoryPort = new AgentCoreMemoryAdapter();
```

## Notes for agents

- `npm install @aws-sdk/client-bedrock-agentcore` (the only channel — no manifest `deps`).
- Provision: `agentcore add memory --strategies …`, `agentcore add gateway`, then `agentcore deploy`;
  copy `AGENTCORE_MEMORY_ID` / `AGENTCORE_GATEWAY_URL` / `AGENTCORE_WORKLOAD_IDENTITY_ARN` from `agentcore status`.
- **Merge** `agentcore-services.json` into the runtime's `agentcore.json` (this template doesn't overwrite it).
- The Gateway adapter is a minimal MCP-over-HTTP client — swap in `@modelcontextprotocol/sdk` for the
  full handshake if needed.
- Identity: confirm `idp-bridge.ts` maps your IdP's claims onto `UserContext` (reuse an installed
  auth provider's mapping if present).

## Checklist (post-install)

Install the SDK; provision the enabled resources; copy the ids; extend the runtime IAM policy;
merge the services JSON; wire adapters behind ports; run port-fake tests before live AWS.

## Related

Pairs with [`bedrock-agentcore-runtime`](../bedrock-agentcore-runtime). Requires [`env-setup`](../env-setup).
