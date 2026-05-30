# Tech Stack Reference

The explicit, canonical list of tools. Read this before suggesting any library —
if it is not here (or is in "Never Suggest"), do not introduce it without asking.

## In Use

| Tool          | Purpose       | Notes                                              |
| ------------- | ------------- | -------------------------------------------------- |
| Next.js       | Web framework | App Router. Do not add Pages Router.               |
| React         | UI            | Function components + hooks; no class components.   |
| TypeScript    | Language      | `strict: true`. No `any` — narrow or use `unknown`. |
| node:test     | Test runner   | Built-in; `import { test } from "node:test"`.       |
| node:assert   | Assertions    | `node:assert/strict`; never `expect()`.            |

> Keep this table accurate. When you add a dependency (or a Hexagen template
> adds one), add its row here in the same change — a stale stack reference is
> how agents start hallucinating.

## Never Suggest

- **Jest / Vitest / Mocha / Chai** — this project uses `node:test` + `node:assert`.
- **The `expect()` API** — use `assert.*`.
- **Pages Router** — App Router only.
- **`any`** — use a precise type, a generic, or `unknown` with narrowing.
- A new HTTP client, date library, or state manager **before checking** whether
  the standard platform API (`fetch`, `Intl`, React state) already covers it.

## Per-Template Additions

Hexagen templates extend this stack. After installing a template, add its
primary packages here — e.g. BullMQ + ioredis (background jobs), LangGraph
(agent graphs), Supabase (storage). Run `hexagen validate-templates` to see
what is installed.
