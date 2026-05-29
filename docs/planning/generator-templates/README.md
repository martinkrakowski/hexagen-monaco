# Generator Add-On Templates — Planning Index

Optional, composable templates applied at `hexagen new` time or via `hexagen add <template>` after generation.

## Foundation (always applied first)

| #   | Template               | Plan                                                           | Summary                                                                              |
| --- | ---------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 00  | Template System Design | [00-template-system-design.md](./00-template-system-design.md) | CLI, question engine, file emitter, conflict resolution, dependency resolution       |
| 11  | Env Setup              | [11-env-setup.md](./11-env-setup.md)                           | `.env.example`, `.env.local.example`, Zod validation, `SETUP.md`, `check-env` script |

## Core Infrastructure

| #   | Template       | Plan                                           | Priority | Key Value                                                                    |
| --- | -------------- | ---------------------------------------------- | -------- | ---------------------------------------------------------------------------- |
| 01  | Rate Limiting  | [01-rate-limiting.md](./01-rate-limiting.md)   | P0       | Session+IP hybrid, differentiated text/image/general limits, debug logging   |
| 02  | LLM Adapter    | [02-llm-adapter.md](./02-llm-adapter.md)       | P0       | Port interface, model constants, reasoning routing, retry, structured output |
| 12  | Error Handling | [12-error-handling.md](./12-error-handling.md) | P0       | 3-layer error hierarchy, RFC 7807 HTTP mapping, React boundary               |
| 13  | Observability  | [13-observability.md](./13-observability.md)   | P0       | Correlation IDs, structured logging, `/api/health`, OpenTelemetry            |

## Auth

| #   | Template      | Plan                                         | Priority | Key Value                                                               |
| --- | ------------- | -------------------------------------------- | -------- | ----------------------------------------------------------------------- |
| 03  | Auth Mock     | [03-auth-mock.md](./03-auth-mock.md)         | P1       | `AUTH_MODE=mock\|real`, UserContext, session cookie, real provider stub |
| 04  | Adobe IMS SPA | [04-adobe-ims-spa.md](./04-adobe-ims-spa.md) | P1       | PKCE flow, token exchange, auto-refresh, fills auth-mock real stub      |

## Persistence & Background Jobs

| #   | Template | Plan                               | Priority | Key Value                                                                |
| --- | -------- | ---------------------------------- | -------- | ------------------------------------------------------------------------ |
| 05  | Supabase | [05-supabase.md](./05-supabase.md) | P1       | SSR client, storage helpers, auth helpers, type generation, RLS examples |
| 06  | BullMQ   | [06-bullmq.md](./06-bullmq.md)     | P2       | Typed queues, workers, Redis fallback, Bull Board, Supabase result store |

## AI / Agents

| #   | Template  | Plan                                 | Priority | Key Value                                                                 |
| --- | --------- | ------------------------------------ | -------- | ------------------------------------------------------------------------- |
| 07  | LangGraph | [07-langgraph.md](./07-langgraph.md) | P2       | AgentGraphPort, state, nodes, checkpointing, streaming, human-in-the-loop |

## DevOps

| #   | Template            | Plan                                                 | Priority | Key Value                                                                       |
| --- | ------------------- | ---------------------------------------------------- | -------- | ------------------------------------------------------------------------------- |
| 08  | Docker              | [08-docker.md](./08-docker.md)                       | P2       | Multi-stage Dockerfile, docker-compose, dev override, GitHub Actions image push |
| 14  | CI / GitHub Actions | [14-ci-github-actions.md](./14-ci-github-actions.md) | P1       | Build+test+lint CI, Vercel/Railway/Fly/VPS deploy, PR previews, Dependabot      |

## UI / DX

| #   | Template      | Plan                                         | Priority | Key Value                                                                |
| --- | ------------- | -------------------------------------------- | -------- | ------------------------------------------------------------------------ |
| 09  | Design System | [09-design-system.md](./09-design-system.md) | P1       | `DESIGN.md`, CSS tokens, Tailwind config, base components, Storybook     |
| 10  | AGENTS.md     | [10-agents-md.md](./10-agents-md.md)         | P1       | Rich instruction set, mode system, tech stack reference, session logging |

---

## Dependency Graph

```
env-setup               (prerequisite for all)
├── rate-limiting
│   └── (enriches) observability
├── llm-adapter
│   └── (required by) langgraph
├── error-handling
│   └── (uses) observability
├── observability
├── auth-mock
│   └── (extended by) adobe-ims-spa
│   └── (extended by) supabase
├── supabase
│   └── (enriches) bullmq (result store)
│   └── (enriches) langgraph (checkpointer)
├── bullmq
│   └── (enriches) docker (redis service)
├── docker
│   └── (integrates with) ci-github-actions
├── design-system
│   └── (enriches) agents-md (anchor rule)
└── agents-md
```

## Install Order (when applying all at once)

1. `env-setup`
2. `agents-md` + `design-system` (no deps)
3. `error-handling` + `observability` (no deps)
4. `llm-adapter`
5. `rate-limiting`
6. `auth-mock`
7. `supabase`
8. `adobe-ims-spa` (requires auth-mock)
9. `bullmq`
10. `langgraph` (requires llm-adapter)
11. `docker`
12. `ci-github-actions`
