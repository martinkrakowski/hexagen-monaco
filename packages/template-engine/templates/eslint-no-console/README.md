# ESLint — no-console (logger enforcement) (`eslint-no-console`)

> A drop-in ESLint flat-config fragment that bans `console.*` so logging goes through the
> structured logger instead of `console.log` technical debt.

|               |                                                |
| ------------- | ---------------------------------------------- |
| **ID**        | `eslint-no-console`                            |
| **Category**  | Core infrastructure / lint                     |
| **Requires**  | —                                              |
| **Conflicts** | none                                           |
| **Branch**    | `feature/generator-template-eslint-no-console` |

Author/agent-facing reference, beside `manifest.json` — not emitted into projects.

## What it does

Closes the **enforcement gap** behind console.log debt: agents (and people) default to `console.log`
because nothing stops them. This ships the `no-console` rule the codebase already assumes exists
(several templates emit `// eslint-disable-next-line no-console` for legitimate console use). With the
rule in place, `console.*` shows up in lint — a `warn` (the non-breaking default) or a CI-failing
`error` — and the structured logger becomes the path of least resistance.

It's a **fragment**, not a whole config — it spreads into your existing `eslint.config.mjs` rather than
fighting it.

## What it scaffolds

- `eslint.no-console.mjs` — exports `noConsoleConfig` (a flat-config array): `no-console` at the chosen
  severity, plus an override turning it **off** for the sanctioned console sites.

## Install

`hexagen add eslint-no-console`. Question:

| Question        | Options (default)                                                |
| --------------- | ---------------------------------------------------------------- |
| `console_level` | `warn` / `error` (`warn`) — `warn` only nudges; `error` fails CI |

## Usage

```js
// eslint.config.mjs
import { noConsoleConfig } from "./eslint.no-console.mjs";

export default [
  ...baseConfig,
  ...noConsoleConfig, // last, so the no-console rule + exemptions win
];
```

```ts
// Then, instead of console.log:
import { logger } from "@/infrastructure/logging"; // from the observability template
logger.info({ userId }, "user.created");
```

## Notes for agents

- **The logger is the only sanctioned `console` site** (its transport). The fragment exempts
  `**/infrastructure/logging/**`, `**/server/startup/**`, `scripts/**`, and `**/*.config.*`; everything
  else must use the logger or an explicit `// eslint-disable-next-line no-console`.
- **`warn` for legacy, `error` for greenfield.** On an existing codebase start at `warn` to surface the
  backlog without blocking, then tighten to `error`.
- Pairs with [`observability`](../observability) (the logger) and [`agents-md`](../agents-md) (which
  carries the "use the logger, never `console.log`" directive). The rule is logger-agnostic — it bans
  `console.*` regardless of which logger you use.

## Checklist (post-install)

Install ESLint if needed; spread `noConsoleConfig` into `eslint.config.mjs` after your base config;
route logging through the structured logger; run lint to surface existing `console.*`; start at `warn`
on a legacy codebase, then tighten to `error`.

## Related

[`observability`](../observability) (structured logger), [`agents-md`](../agents-md) (logging directive),
[`ci-github-actions`](../ci-github-actions) (runs lint in CI).
