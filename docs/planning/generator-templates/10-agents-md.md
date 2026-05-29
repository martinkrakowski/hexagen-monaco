# Template: AGENTS.md

**Branch:** `feature/generator-template-agents-md`

## Purpose

Generates a rich, pre-populated `AGENTS.md` file (and companion `.agents/` spec directory) that Claude Code reads as the primary instruction set. A high-quality `AGENTS.md` is the difference between an AI assistant that follows project conventions and one that fights them on every exchange.

---

## Install-Time Questions

| ID                    | Prompt                                   | Type    | Options                                             | Default                    |
| --------------------- | ---------------------------------------- | ------- | --------------------------------------------------- | -------------------------- |
| `project_name`        | Project name (for the header)?           | text    | —                                                   | _(from package.json name)_ |
| `project_description` | One-sentence project description?        | text    | —                                                   | _(required)_               |
| `primary_framework`   | Primary server framework?                | auto    | _(from other templates)_                            | `next.js`                  |
| `architecture_style`  | Architecture style?                      | select  | `hexagonal`, `layered`, `feature-based`, `monolith` | `hexagonal`                |
| `custom_personas`     | Custom agent personas (comma-separated)? | text    | —                                                   | _(empty)_                  |
| `protected_files`     | Files never to edit (comma-separated)?   | text    | —                                                   | `DESIGN.md,AGENTS.md`      |
| `session_logging`     | Include session logging structure?       | boolean | —                                                   | `true`                     |

---

## Files Generated

```
AGENTS.md                          # Primary instruction file (read by Claude Code)

.agents/
  architecture.md                  # Architecture decisions and layer boundaries
  testing.md                       # Test runner, assertion library, patterns
  git.md                           # Commit conventions, branch naming, PR rules
  tech-stack.md                    # Exact package/tool reference (no hallucinations)
  personas/
    <custom-persona>.md            # One file per custom persona (if provided)
```

---

## Key Design Decisions

**`AGENTS.md` is a living contract, not a README:** It is written in imperative second-person ("You MUST", "Never", "Always"). Suggestions and explanations belong in `.agents/` spec files, not in `AGENTS.md` itself.

**Mode declarations prevent context drift:** Every agent response starts with a mode declaration. This forces the agent to acknowledge which "hat" it's wearing (architect, implementer, debugger) and prevents mode-blending errors.

**Tech stack reference is explicit and negative:** The file lists both what IS used and what IS NOT used. Negative examples ("Never suggest Vitest or Jest — this project uses `node:test`") prevent the most common hallucinations.

**Protected files have a reason:** Each entry in the "Files Never Edit" list includes a one-line reason. Agents are more reliable when they understand why a rule exists, not just that it does.

**Auto-populated from other templates:** If `design-system` is installed, the DESIGN.md anchor rule is included. If `supabase` is installed, `getUser()` vs `getSession()` guidance is included. Templates compose into a coherent instruction set.

---

## Phase 1 — Core AGENTS.md Structure

**Goal:** A minimal, valid `AGENTS.md` that Claude Code reads correctly.

Structure:

```markdown
# AGENTS.md — <Project Name>

> <one-sentence description>

## The Immutable Anchor

## Before Every Exchange

## Tech Stack Reference

## Commands After Edits

## Files Never Edit

## Mode System

## Commit & PR Conventions
```

The file is generated once. Subsequent template installs append to relevant sections using comment-delimited zones (`<!-- BEGIN rate-limiting -->` / `<!-- END rate-limiting -->`).

Validation: File exists; Claude Code reads it without error (no broken markdown).

---

## Phase 2 — Tech Stack Reference

**Goal:** Explicit, correct tool table with negative examples to prevent hallucinations.

Generated from the set of installed templates + install-time questions:

```markdown
## Tech Stack Reference

| Tool               | Purpose            | Notes                                       |
| ------------------ | ------------------ | ------------------------------------------- |
| **Yarn**           | Package manager    | Workspaces monorepo                         |
| **Next.js 15**     | Web framework      | App Router; no Pages Router                 |
| **TypeScript 5**   | Language           | `strict: true`; all files `.ts` / `.tsx`    |
| **node:test**      | Test runner        | Built-in; `import from 'node:test'`         |
| **node:assert**    | Assertions         | `assert.strictEqual()`; never `expect()`    |
| **Turbo**          | Build orchestrator | `yarn build`, `yarn lint`, `yarn typecheck` |
| **Tailwind CSS 4** | Styling            | Extends tokens from `src/styles/tokens.css` |

**Never suggest:** Jest, Vitest, `expect()` API, Pages Router, `getSession()` (use `getUser()`).
```

Additional rows are appended by each installed template (e.g., BullMQ adds its row; LangGraph adds its row).

Validation: Each installed template's primary package appears in the table.

---

## Phase 3 — Architecture Mode System

**Goal:** Named modes that route the agent to the correct behaviour for the current task.

Default modes:

```markdown
## Mode System

Declare your mode at the top of every response.

| Mode               | Trigger                           | Behaviour                                         |
| ------------------ | --------------------------------- | ------------------------------------------------- |
| 🏗️ **Architect**   | "design", "plan", "how should we" | Think in layers, ports, and trade-offs. No code.  |
| 🔨 **Implementer** | "build", "add", "implement"       | Write code. Follow conventions exactly.           |
| 🐛 **Debugger**    | "fix", "broken", "error", "why"   | Diagnose root cause before touching code.         |
| 📖 **Reviewer**    | "review", "check", "audit"        | Read only. Report findings. No unsolicited fixes. |
| 🧪 **Tester**      | "test", "coverage", "spec"        | Write tests. Never modify the code under test.    |
```

If `custom_personas` is provided, additional modes are appended:

```markdown
| 🎨 **UI Designer** | "mockup", "layout", "component" | Follow DESIGN.md. Propose before implementing. |
```

Validation: Mode table is syntactically valid markdown; all mode names are unique.

---

## Phase 4 — Commands After Edits

**Goal:** Explicit command table so the agent always validates its own work.

Generated based on installed templates:

```markdown
## Commands After Edits

| Trigger                 | Command                                     | On Failure            |
| ----------------------- | ------------------------------------------- | --------------------- |
| Before starting work    | `yarn build && yarn typecheck && yarn lint` | STOP — fix first      |
| Any .ts / .tsx edit     | `yarn lint && yarn typecheck`               | Fix before continuing |
| Any .architecture/ edit | `yarn lint:arch`                            | STOP                  |
| After adding a template | `hexagen validate templates`                | Resolve conflicts     |
| Before committing       | `yarn test`                                 | Diagnose — never skip |
```

Validation: All commands exist in `package.json` scripts or as bin executables.

---

## Phase 5 — Files Never Edit List

**Goal:** Explicit list with reasons that prevent accidental mutation of critical files.

```markdown
## Files Never Edit

| File                          | Reason                                                  |
| ----------------------------- | ------------------------------------------------------- |
| `AGENTS.md`                   | This file. Edit it only via `hexagen update agents-md`. |
| `DESIGN.md`                   | Design contract. Changes require design review.         |
| `.architecture/manifest.yaml` | Edited only via `hexagen manifest`.                     |
| `yarn.lock`                   | Updated only via `yarn` commands, never manually.       |
```

Additional entries appended by templates:

- `docker-compose.yml` is appended by `docker` template (with note: use override file for dev changes)

Validation: All listed files exist in the generated project.

---

## Phase 6 — Session Logging Structure (opt-in)

**Goal:** Structured log template for AI-assisted sessions, enabling retrospective review.

```markdown
## Session Log

After each AI-assisted work session, append an entry to `.agents/session-log.md`:

\`\`\`

## Session: <date> — <topic>

**Mode:** Implementer
**Changes:**

- ...
  **Decisions Made:**
- ...
  **Left Open:**
- ...
  \`\`\`
```

`.gitignore` addition:

```
# Uncomment to keep session logs out of version control:
# .agents/session-log.md
```

Validation: `.agents/session-log.md` placeholder is created with an example entry.

---

## Phase 7 — Spec File Population

**Goal:** Pre-populate `.agents/` spec files with project-specific guidance.

`.agents/testing.md`:

- Test runner: `node:test`
- Assertion library: `node:assert`
- File naming: `*.test.ts` (not `.spec.ts` for unit tests)
- Mock strategy: no external mock libraries; use `node:test`'s `mock.fn()`
- Test location: `__tests__/` adjacent to the module under test

`.agents/git.md`:

- Branch naming: `feat/<ticket>-<description>`, `fix/<ticket>-<description>`
- Commit format: Conventional Commits
- PR: squash merge; title = commit message
- Never: `--no-verify`, `--force-push main`

`.agents/architecture.md`:

- Layer diagram (generated from `architecture_style`)
- Import rules (domain never imports infrastructure)
- Port naming convention (e.g., `*.port.ts`, `*.adapter.ts`)

Validation: All three spec files are non-empty and syntactically valid markdown.

---

## Post-Install Checklist

```
✅ agents-md installed

Next steps:
  1. Edit AGENTS.md → "project_description" line to describe your project accurately
  2. Review .agents/tech-stack.md — add any tools not auto-detected
  3. Update MOCK_USER_ROLES in .agents/ if custom roles are used
  4. Run: cat AGENTS.md to verify Claude Code will read the correct instructions
  5. Add AGENTS.md to your onboarding docs so new team members understand AI session conventions
```

---

## Template Dependencies

- No required dependencies
- Enriched by: every other template (each appends to relevant AGENTS.md sections)
- Extended by: `design-system` (adds DESIGN.md anchor rule)
