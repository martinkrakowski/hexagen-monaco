# Bedrock AgentCore Runtime (`bedrock-agentcore-runtime`)

> Deploy the Hexagen TypeScript server to Amazon Bedrock AgentCore Runtime as an ARM64 container
> implementing the HTTP contract (`POST /invocations`, `GET /ping`). No Python agent scaffolding.

|               |                                                        |
| ------------- | ------------------------------------------------------ |
| **ID**        | `bedrock-agentcore-runtime`                            |
| **Category**  | LLM / agents — deployment                              |
| **Requires**  | `docker`, `env-setup`                                  |
| **Conflicts** | none                                                   |
| **Branch**    | `feature/generator-template-bedrock-agentcore-runtime` |

Author/agent-facing reference, beside `manifest.json` — not emitted into projects.

## What it does

Packages the app as an AgentCore Runtime container: the HTTP handlers AgentCore calls
(`/invocations`, `/ping`), payload/session helpers, an ARM64 `Dockerfile.agentcore`,
`agentcore.json`, an IAM execution policy, and an optional deploy workflow. You implement
`AgentRuntimePort` and pass it to `createAgentCoreServer()`.

## Service & API

- **Platform:** Amazon Bedrock AgentCore Runtime. **Contract:** `POST /invocations`, `GET /ping`.
- **Build:** ARM64 **Container** (required for a TypeScript runtime).
- **Inbound auth:** `IAM` (SigV4) or `OAuth` (fail-closed until a verifier is registered).

## Install

`hexagen add bedrock-agentcore-runtime`. Questions: `aws_region`, `agent_name`, `protocol`
(`HTTP`/`MCP`/`A2A`), `build_type` (`Container`), `inbound_auth` (`IAM`/`OAuth`), `provision`
(`agentcore-cli`/`cdk`/`none`), `deploy_ci` (bool). Emits `Dockerfile.agentcore`, the
`infrastructure/agentcore/*` handlers, `agentcore/agentcore.json`, the IAM policy,
`.env.agentcore.example`, and gated `deploy-agentcore.yml` / `infra/agentcore-stack.ts`.

## Usage

```ts
// src/infrastructure/agentcore/http/server.ts
import { createAgentCoreServer } from "./server";
createAgentCoreServer(myAgentRuntimePort); // implement AgentRuntimePort (run / optional runStream)
```

```bash
docker buildx build --platform linux/arm64 -f Dockerfile.agentcore -t agent .
docker run -p 8080:8080 agent && curl localhost:8080/ping
```

## Notes for agents

- **Enable model access** in the Bedrock console (per account/region) or invocations fail with
  `AccessDeniedException`.
- Provision via `agentcore deploy` (CLI) or `cdk deploy`; copy `AGENTCORE_RUNTIME_ARN` from
  `agentcore status`.
- With [`observability`](../observability) installed, the handler seeds the correlation store from
  `runtimeSessionId` so app logs + AgentCore OTEL→CloudWatch traces share one id.
- `inbound_auth=OAuth` is fail-closed: register a verifier via `setTokenVerifier()` at startup.

## Checklist (post-install)

Enable model access; implement `AgentRuntimePort`; build + smoke `/ping` locally; provision;
attach the IAM policy; invoke; set the runtime ARN; configure OAuth verifier if used.

## Related

Requires [`docker`](../docker), [`env-setup`](../env-setup). Stateful services:
[`bedrock-agentcore-services`](../bedrock-agentcore-services).
