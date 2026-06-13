# Logging Spec

This spec ships with the `observability` template. The logger it mandates is
installed at `src/infrastructure/logging/logger.ts` — if you are reading this
file, that logger exists in this project.

## The Rule

Use the structured logger for all application logging. Import it from the
`src/infrastructure/logging` barrel (the module's public surface — not the
individual files), via a relative path or your project's path alias:

```ts
import { logger } from "../infrastructure/logging";

logger.info({ userId }, "user.created");
```

**Never `console.log`** in application code — it has no level, no correlation
id, and no redaction, and it becomes technical debt the moment it lands.

## Exempt Sites

The only places `console` is acceptable:

- the logger transport itself (`src/infrastructure/logging/`)
- server startup/shutdown messages emitted before the logger exists
- one-off scripts outside the app runtime
- config files evaluated at build time

## Enforcement

If the `eslint-no-console` template is also installed, this rule is enforced in
lint/CI. Otherwise it relies on code review — the rule stands either way.
