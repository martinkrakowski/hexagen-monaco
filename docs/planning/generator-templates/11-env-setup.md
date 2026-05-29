# Template: Env Setup

**Branch:** `feature/generator-template-env-setup`

## Purpose

Generates a fully categorised `.env.example`, a secrets-safe `.env.local.example`, a Zod-based runtime environment validation schema, a `SETUP.md` first-day guide, and an env-check script. Eliminates the most common greenfield friction: missing env vars that produce confusing runtime errors instead of clear startup failures.

This template runs automatically as the first step when any other template is installed — it is the foundation all other templates build on.

---

## Install-Time Questions

| ID                  | Prompt                                             | Type    | Options                                       | Default            |
| ------------------- | -------------------------------------------------- | ------- | --------------------------------------------- | ------------------ |
| `cloud_or_local`    | Primary dev environment?                           | select  | `local`, `cloud-dev`, `both`                  | `local`            |
| `framework`         | Server framework?                                  | auto    | _(from project)_                              | `next.js`          |
| `strict_validation` | Fail hard at startup if required vars are missing? | boolean | —                                             | `true`             |
| `dotenv_tool`       | Env loading tool?                                  | select  | `next.js-built-in`, `dotenv`, `dotenv-expand` | `next.js-built-in` |

---

## Files Generated

```
.env.example                   # Full variable reference — committed to git
.env.local.example             # Secrets template — never committed to git
.gitignore                     # Ensures .env.local is ignored

src/
  config/
    env.ts                     # Zod schema + parsed, typed env object
    env.server.ts              # Server-only vars (never shipped to browser)
    env.client.ts              # Public vars (NEXT_PUBLIC_*)

scripts/
  check-env.ts                 # Validates .env.local against .env.example

SETUP.md                       # First-day human-readable guide
```

---

## .env.example Structure

Vars are grouped by concern with a comment header per group. Descriptions explain format, not just name.

```env
# ============================================================
# HEXAGEN PROJECT — Environment Variables
# Copy this file to .env.local and fill in your values.
# Never commit .env.local to version control.
# Run `yarn check:env` to validate your .env.local.
# ============================================================

# -------- App --------
NODE_ENV=development           # development | production | test
NEXT_PUBLIC_APP_URL=http://localhost:3000

# -------- LLM / xAI --------
# Get your API key: https://console.x.ai
# Free tier: TEXT_RPM=40, IMAGE_RPM=12, TPM=~131k
XAI_API_KEY=                   # Required: sk-...
XAI_BASE_URL=https://api.x.ai/v1
LLM_REASONING_MODEL=grok-3-mini
LLM_FAST_MODEL=grok-3-fast

# -------- Rate Limiting --------
TEXT_RPM=40
IMAGE_RPM=12
GENERAL_RPM=60
RATE_LIMIT_WARN_AT=0.8
RATE_LIMIT_DEBUG=false

# -------- Auth --------
AUTH_MODE=mock                 # mock | real
AUTH_SESSION_SECRET=           # Required in real mode: openssl rand -hex 32
AUTH_SESSION_MAX_AGE=604800

# -------- Supabase --------
# Get from: https://supabase.com/dashboard → Settings → API
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=     # Server-only — never prefix with NEXT_PUBLIC_

# -------- Redis / BullMQ --------
REDIS_URL=redis://localhost:6379
BULLMQ_FALLBACK_MODE=auto

# -------- Adobe IMS --------
ADOBE_IMS_CLIENT_ID=
ADOBE_IMS_REDIRECT_URI=http://localhost:3000/api/auth/callback
ADOBE_IMS_SCOPES=openid,AdobeID
ADOBE_IMS_ENVIRONMENT=prod     # prod | stage

# -------- Debug --------
PANELCRAFT_DEBUG=false         # Enables verbose logging across all subsystems
LOG_LEVEL=info                 # error | warn | info | debug
```

(Only sections for installed templates are included — other sections are omitted.)

---

## Key Design Decisions

**`.env.example` is the spec; `.env.local` is the secret:** The example file is committed and shows every variable with a description. The local file is gitignored and holds real values. This pattern is standard but often not scaffolded correctly — the template ensures `.gitignore` is correct from day one.

**Zod validation fails fast:** The env schema runs at module import time (server startup). A missing `XAI_API_KEY` produces: `Error: Missing required environment variable: XAI_API_KEY (needed for LLM calls)` — not a cryptic `undefined is not a function` error 10 requests later.

**Server vs client env split:** `env.server.ts` contains vars without `NEXT_PUBLIC_` prefix. Importing it in a client component produces a build error (Next.js tree-shaking strips it). `env.client.ts` contains only `NEXT_PUBLIC_` vars. This prevents accidental secret leakage.

**`check-env.ts` is a pre-flight tool:** Run before demo, CI, or deployment. Compares `.env.local` against `.env.example` and reports missing required vars with clear descriptions. Exits 0 if all required vars are present, 1 otherwise.

---

## Phase 1 — .env.example and .gitignore

**Goal:** Correct `.env.example` (committed) and `.gitignore` entries.

`.gitignore` ensures:

```
.env.local
.env.*.local
!.env.example
!.env.local.example
```

Validation: `git status` shows `.env.local` is ignored; `.env.example` is tracked.

---

## Phase 2 — Zod Env Schema

**Goal:** Runtime validation with helpful error messages.

```typescript
// src/config/env.server.ts
import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),

  // LLM
  XAI_API_KEY: z
    .string()
    .min(1, "XAI_API_KEY is required for LLM calls")
    .optional(),

  // Auth
  AUTH_MODE: z.enum(["mock", "real"]).default("mock"),
  AUTH_SESSION_SECRET: z
    .string()
    .min(32)
    .optional()
    .refine((val) => process.env.AUTH_MODE !== "real" || !!val, {
      message: "AUTH_SESSION_SECRET is required when AUTH_MODE=real",
    }),

  // Supabase
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  // ...
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  • ${i.path.join(".")}: ${i.message}`)
    .join("\n");
  throw new Error(
    `\n❌ Environment validation failed:\n${issues}\n\nSee .env.example for required variables.\n`,
  );
}

export const serverEnv = parsed.data;
```

Validation: Delete a required var, start server, assert error message is readable and specific.

---

## Phase 3 — Client Env Schema

**Goal:** Type-safe public env vars with no accidental server-only vars leaking to the browser.

```typescript
// src/config/env.client.ts
import { z } from "zod";

const ClientEnvSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
});

export const clientEnv = ClientEnvSchema.parse({
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
});
```

Validation: TypeScript — accessing `clientEnv.XAI_API_KEY` produces a compile error (it doesn't exist on the type).

---

## Phase 4 — check-env Script

**Goal:** Pre-flight script that reports missing required vars clearly.

```typescript
// scripts/check-env.ts
import { readFileSync } from "node:fs";

const example = readFileSync(".env.example", "utf-8");
const local = readFileSync(".env.local", "utf-8").split("\n");

const localKeys = new Set(
  local
    .filter((l) => !l.startsWith("#") && l.includes("="))
    .map((l) => l.split("=")[0].trim()),
);

const required = example
  .split("\n")
  .filter(
    (l) =>
      !l.startsWith("#") &&
      l.includes("=") &&
      !l.includes("=\n") &&
      l.split("=")[1]?.trim() === "",
  )
  .map((l) => l.split("=")[0].trim());

const missing = required.filter((k) => !localKeys.has(k) || !process.env[k]);

if (missing.length > 0) {
  console.error(
    `\n❌ Missing required env vars:\n${missing.map((k) => `  • ${k}`).join("\n")}\n`,
  );
  process.exit(1);
}
console.log("✅ All required env vars are set.");
```

`package.json` script: `"check:env": "tsx scripts/check-env.ts"`

Validation: Remove a required var from `.env.local`, run `yarn check:env`, assert exit code 1 and clear error message.

---

## Phase 5 — SETUP.md

**Goal:** A first-day human-readable guide that prevents the most common confusion.

Sections (populated based on installed templates):

```markdown
# Setup Guide

## Prerequisites

- Node.js 22+, Yarn 4.x
- (If using Redis) Docker or redis-server installed

## First-Time Setup

1. `cp .env.example .env.local`
2. Fill in required values (see sections below)
3. `yarn install`
4. `yarn check:env` ← validates your .env.local
5. `yarn dev`

## LLM / xAI

**Getting an API key:**

1. Sign up at https://console.x.ai
2. Create a new API key under Settings → API Keys
3. Set `XAI_API_KEY=sk-...` in .env.local

**Free tier limits:**

- TEXT_RPM=40 (requests per minute for text)
- IMAGE_RPM=12 (requests per minute for images)
- TPM ≈ 131,000 (tokens per minute)

Set `RATE_LIMIT_DEBUG=true` during development to see proximity-to-limit warnings.

## Auth

**Mock mode (default):** `AUTH_MODE=mock` — no setup required. A session cookie is auto-minted on first request.

**Real mode:** Set `AUTH_MODE=real` and generate a session secret:
\`\`\`
openssl rand -hex 32
\`\`\`
Paste the output as `AUTH_SESSION_SECRET`.

## Supabase

1. Create a project at https://supabase.com
2. Go to Settings → API
3. Copy the Project URL → `NEXT_PUBLIC_SUPABASE_URL`
4. Copy the `anon` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
5. Copy the `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (server-only)

⚠️ Never prefix `SUPABASE_SERVICE_ROLE_KEY` with `NEXT_PUBLIC_` — this would expose it to the browser.

## Redis / BullMQ

Local: `redis-server` or `docker compose up redis`

Redis Cloud: Set `REDIS_URL=rediss://...` from the Redis Cloud console.

Upstash: `REDIS_URL=rediss://default:<token>@...upstash.io:...`

If Redis is unavailable, set `BULLMQ_FALLBACK_MODE=auto` to run jobs synchronously.

## Adobe IMS

**Credential type:** Use **Single Page App** (not Web App — deprecated).

1. Go to Adobe Developer Console → Create Project → Add API → Adobe IMS
2. Select "Single Page App" credential type
3. Add your redirect URI: `http://localhost:3000/api/auth/callback`
4. Copy the Client ID → `ADOBE_IMS_CLIENT_ID`
5. No client secret is needed for SPA credentials.

⚠️ `read_organizations` scope requires an Adobe enterprise account with org admin approval.

## Common Issues

| Symptom                                   | Cause                             | Fix                                           |
| ----------------------------------------- | --------------------------------- | --------------------------------------------- |
| `undefined is not a function` at LLM call | `XAI_API_KEY` not set             | Run `yarn check:env`                          |
| 429 immediately on first request          | RPM too low for your tier         | Increase `TEXT_RPM` or check xAI console      |
| Session cookie not set                    | Wrong `sameSite` in non-HTTPS dev | Set `COOKIE_SECURE=false` for local dev       |
| `Auth session not found`                  | `AUTH_SESSION_SECRET` missing     | Generate with `openssl rand -hex 32`          |
| IMS redirect fails                        | Redirect URI mismatch             | Must match exactly in Adobe Developer Console |
```

Validation: `SETUP.md` exists; all sections correspond to installed templates.

---

## Post-Install Checklist

```
✅ env-setup installed

Next steps:
  1. cp .env.example .env.local
  2. Fill in required values (look for lines with empty = values)
  3. yarn check:env  ← run this before every demo or deploy
  4. Read SETUP.md for provider-specific setup instructions
```

---

## Template Dependencies

- No dependencies (this template is a prerequisite for all others)
- Auto-enriched by every other template (each appends its section to SETUP.md and vars to .env.example)
