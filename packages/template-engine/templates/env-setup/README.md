# Env Setup (`env-setup`)

> The universal prerequisite: a categorised `.env.example`, Zod runtime validation with a
> server/client split, a `check-env` script, and a `SETUP.md` first-day guide.

|               |                                        |
| ------------- | -------------------------------------- |
| **ID**        | `env-setup`                            |
| **Category**  | Foundation                             |
| **Requires**  | —                                      |
| **Conflicts** | none                                   |
| **Branch**    | `feature/generator-template-env-setup` |

Author/agent-facing reference, beside `manifest.json` — not emitted into projects.

## What it does

Establishes the project's environment-variable contract. Almost every other template depends
on it (it owns `.env.example`, the `# required` annotation convention, and `check:env`).
Splits config into a server-only module and a client-safe module so secrets can't leak into a
browser bundle.

## What it scaffolds

- `src/config/env.server.ts` — server-only validated env (secrets live here).
- `src/config/env.client.ts` — client-safe env (`NEXT_PUBLIC_*` only).
- `src/config/env.ts` — barrel that re-exports **types only**.
- `scripts/check-env.ts` — validates `.env.local` before run/demo/deploy.
- `.env.example`, `.gitignore.hexagen`, `SETUP.md`.

## Install

`hexagen add env-setup`. Questions:

| Question            | Options (default)                                                    |
| ------------------- | -------------------------------------------------------------------- |
| `framework`         | `next.js` / `express` / `fastify` / `nitro` (`next.js`)              |
| `strict_validation` | `true` — fail hard at startup on missing required vars               |
| `dotenv_tool`       | `next.js-built-in` / `dotenv` / `dotenv-expand` (`next.js-built-in`) |

Env introduced: `NODE_ENV`, `NEXT_PUBLIC_APP_URL`.

## Usage

```ts
import { serverEnv } from "@/config/env.server"; // server code
import { clientEnv } from "@/config/env.client"; // client code

// package.json: "check:env": "tsx scripts/check-env.ts"
```

```bash
npm run check:env   # validates .env.local
```

## Notes for agents

- The **`# required` annotation is inline-only** — `check:env` parses `KEY=value # required`,
  not an own-line comment. Every `.env.<template>.example` follows this convention.
- Append the ignore rules: `cat .gitignore.hexagen >> .gitignore`. Never commit real secrets.
- Server code imports from `env.server`, client from `env.client` — the `env` barrel is types only.

## Checklist (post-install)

Install Zod; (optionally) a dotenv loader; append `.gitignore.hexagen`; `cp .env.example
.env.local` and set every `# required` var; add the `check:env` script; read `SETUP.md`.

## Related

Depended on by nearly every template — auth, LLM, infra, and the Adobe family.
