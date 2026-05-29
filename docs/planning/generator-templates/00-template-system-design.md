# Template System Design

**Branch:** `feature/generator-template-system-core`

## Purpose

Defines how add-on templates compose with Hexagen's core project generator. This document is the foundation all other template plans depend on.

---

## Core Concept

After a project is generated, users can apply one or more add-on templates. Each template scaffolds a vertical slice of production-ready infrastructure — files, env vars, config, and wiring — that would otherwise take hours to set up correctly.

Templates are:

- **Composable** — applied independently or in combination
- **Idempotent** — safe to re-run; generates only what is missing
- **Non-destructive** — never overwrites user-modified files; emits a warning comment instead
- **Declarative** — each template declares its install-time questions, outputs, and peer dependencies

---

## CLI Interface

### At generation time (init)

```bash
hexagen new my-project \
  --template hexagonal \
  --add rate-limiting,llm-adapter,auth-mock,docker,env-setup
```

### Post-generation (add)

```bash
hexagen add rate-limiting
hexagen add llm-adapter --provider xai,openai
hexagen add supabase --buckets images,exports
hexagen add bullmq --worker-mode same-process
```

### List available templates

```bash
hexagen templates list
hexagen templates info rate-limiting
```

---

## Template Manifest Format

Each template is a directory inside the generator's `templates/` folder with a `manifest.json`:

```json
{
  "id": "rate-limiting",
  "name": "Rate Limiting",
  "description": "Differentiated middleware with session+IP hybrid and configurable limits",
  "version": "1.0.0",
  "requires": ["env-setup"],
  "conflicts": [],
  "questions": [
    {
      "id": "framework",
      "prompt": "Which server framework?",
      "type": "select",
      "options": ["nitro", "nextjs-api", "express", "fastify"],
      "default": "nitro"
    }
  ],
  "envVars": ["TEXT_RPM", "IMAGE_RPM", "GENERAL_RPM", "RATE_LIMIT_WARN_AT"],
  "outputs": [
    "server/middleware/rate-limit.ts",
    "server/utils/rate-limiter.ts",
    "server/utils/get-client-ip.ts"
  ]
}
```

---

## Question Framework

Questions are asked once at `hexagen add` time. Answers are written to a local `.hexagen-template-config.json` in the generated project root (gitignored) so re-runs skip already-answered questions.

Question types:

- `select` — single choice from a list
- `multiselect` — multiple choices
- `text` — free text input with optional regex validation
- `boolean` — yes/no
- `auto` — derived from another template's answers (no prompt shown)

---

## File Conflict Resolution

When a template wants to write a file that already exists and has been modified by the user:

1. Generate the new content to `<file>.hexagen-update.ts`
2. Emit a warning to stdout with a diff summary
3. Never silently overwrite

When a file exists but is identical to the template default (no user changes):

- Overwrite silently (idempotent)

---

## Template Composition & Ordering

Templates declare `requires` — peer templates that must be applied first. The CLI resolves the dependency graph and applies templates in topological order.

Example resolution for `bullmq`:

```
bullmq → requires env-setup
bullmq → requires observability (for structured logging in workers)
```

Auto-detected composition: if `supabase` and `bullmq` are both present, the BullMQ template emits a Supabase-backed job result store automatically.

---

## Schema Integration

Templates may extend the `BoundedContextSchema` by registering additional fields via a `schema-extension.ts` file. These extensions are merged at manifest render time so generated architecture manifests reflect the template's infrastructure choices.

---

## Phases

### Phase 1 — Template Registry

- Define `TemplateManifest` interface and registry loader
- Implement `hexagen templates list` and `hexagen templates info`
- Wire registry into the `hexagen add` command stub

### Phase 2 — Question Engine

- Implement question rendering (terminal prompts)
- Persist answers to `.hexagen-template-config.json`
- Implement `auto` question resolution

### Phase 3 — File Emitter

- Implement atomic file write (temp → rename)
- Implement conflict detection (hash comparison)
- Implement conflict output (`<file>.hexagen-update.ts` + warning)

### Phase 4 — Dependency Resolution

- Parse `requires` graph
- Topological sort
- Auto-apply missing peer templates with confirmation prompt

### Phase 5 — Schema Extension Hook

- Allow templates to register `schema-extension.ts`
- Merge extensions at manifest generation time

### Phase 6 — Init Integration

- Wire `--add` flag into `hexagen new`
- Apply templates after core generation completes
- Print post-install checklist

---

## Post-Install Checklist

Every template emits a checklist section to stdout after install:

```
✅ rate-limiting installed

Next steps:
  1. Copy .env.rate-limit additions into your .env.local
  2. Set TEXT_RPM=40 and IMAGE_RPM=12 for xAI free tier
  3. Verify session cookie appears in browser DevTools on first request
  4. See SETUP.md → Rate Limiting for troubleshooting
```

---

## Validation & "It Works" Signal

```bash
hexagen validate templates
```

Checks:

- All required env vars are present in `.env.local` or `.env`
- All declared output files exist
- No `<file>.hexagen-update.ts` conflict files left unresolved
- TypeScript compiles cleanly after template application
