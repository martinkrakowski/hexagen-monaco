# LLM Adapter — Amazon Bedrock (`llm-adapter-bedrock`)

> Adds Amazon Bedrock (Converse API) as a provider to the `llm-adapter` router via its
> provider-registration seam — no base files overwritten. Auth uses the AWS credential chain.

|               |                                              |
| ------------- | -------------------------------------------- |
| **ID**        | `llm-adapter-bedrock`                        |
| **Category**  | LLM provider add-on                          |
| **Requires**  | `llm-adapter`, `error-handling`, `env-setup` |
| **Conflicts** | none                                         |
| **Branch**    | `feature/generator-template-bedrock`         |

Author/agent-facing reference, beside `manifest.json` — not emitted into projects.

## What it does

Registers a Bedrock adapter with the existing `llm-adapter` router. It only **adds** files (the
adapter, a registration module, Bedrock error mapping) — nothing in `llm-adapter` is overwritten.
Models are addressed by inference-profile id (e.g. `us.anthropic.claude-sonnet-4-…`).

## Service & API

- **Provider:** Amazon Bedrock Runtime, **Converse API** (`@aws-sdk/client-bedrock-runtime`).
- **Auth:** the AWS credential chain (task role on AWS, `AWS_*` locally). Optional Guardrails.

## Install

`hexagen add llm-adapter-bedrock`. Questions: `bedrock_region`, `bedrock_inference` (default
model id), `bedrock_guardrails` (bool). No new schema env vars; seeds `.env.bedrock.example` with
`BEDROCK_*` model overrides + optional `BEDROCK_GUARDRAIL_ID`. Emits the adapter,
`bedrock-register.ts`, `bedrock-errors.ts`, `.env.bedrock.example`.

## Usage

```ts
import "@/infrastructure/llm/adapters/bedrock-register"; // once, before constructing the router
import { LLMRouter } from "@/infrastructure/llm/router/llm-router";

const llm = new LLMRouter("bedrock"); // Bedrock as primary
```

## Notes for agents

- `npm install @aws-sdk/client-bedrock-runtime` (the only channel — no manifest `deps`).
- Enable model access in the Bedrock console (per account, per region) or calls return
  `AccessDeniedException`.
- Import the registration **before** constructing the router.
- Override models per tier via `BEDROCK_REASONING_MODEL` / `BEDROCK_FAST_MODEL` / `BEDROCK_VISION_MODEL`.

## Checklist (post-install)

Install the SDK; enable model access; import `bedrock-register` at startup; make Bedrock primary;
use the AWS credential chain; set model overrides + Guardrails if used.

## Related

Requires [`llm-adapter`](../llm-adapter), [`error-handling`](../error-handling), [`env-setup`](../env-setup).
