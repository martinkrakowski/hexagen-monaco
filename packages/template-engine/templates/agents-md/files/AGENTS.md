# AGENTS.md

> {project_description}

This is the primary instruction set for AI agents (Claude Code and others)
working in this repository. It is a **living contract**, written in the
imperative — "You MUST", "Never", "Always". Explanations and longer guidance
live in the `.agents/` spec directory, not here.

If a request conflicts with this file, follow this file and say so.

---

## The Immutable Anchor

- This project follows the **{architecture_style}** architecture style. See
  `.agents/architecture.md` for layer boundaries and import rules — do not
  violate them.
- Match the surrounding code: naming, file layout, test style, and comment
  density. Read a neighbouring file before writing a new one.
- Prefer editing existing files over adding new ones. Do not introduce a new
  dependency without a clear reason.

## Before Every Exchange

1. Declare your **mode** (see the Mode System below) on the first line.
2. Restate the goal in one sentence.
3. Check this file and the relevant `.agents/` spec before acting.

## Tech Stack Reference

The canonical, explicit stack lives in `.agents/tech-stack.md`. It lists both
what IS used and what is **never** used — read it before suggesting any tool or
library, to avoid hallucinated dependencies.

## Conventions

- **Logging:** prefer structured, leveled logging over bare `console.log` in
  application code. If the `observability` template is installed, its logger is
  the required interface and `.agents/logging.md` is the binding spec; if the
  `eslint-no-console` template is installed, lint/CI enforces the ban. Without
  those templates, keep logging consistent with the surrounding code.

## Commands After Edits

Run the matching command after each kind of change. On failure, stop and fix
before continuing.

| Trigger                  | Command                                  | On failure              |
| ------------------------ | ---------------------------------------- | ----------------------- |
| Before starting work     | `npm run build && npm run typecheck`     | STOP — fix first        |
| Any `.ts` / `.tsx` edit  | `npm run lint && npm run typecheck`      | Fix before continuing   |
| After adding a template  | `hexagen validate-templates`             | Resolve conflicts       |
| Before committing        | `npm test`                               | Diagnose — never skip    |

(If this project uses yarn or pnpm, substitute the package manager — the
triggers stay the same.)

## Files Never Edit

Each rule has a reason; agents follow rules they understand.

| File                          | Reason                                                       |
| ----------------------------- | ----------------------------------------------------------- |
| `AGENTS.md`                   | This contract. Change it deliberately, never as a side effect. |
| `.agents/*.md` (except `session-log.md`) | Spec files — edit only when explicitly asked to update specs. `session-log.md` is the deliberate exception: append to it after each session. |
| `package-lock.json`           | Updated only via `npm` commands, never by hand.             |
| `DESIGN.md`                   | Design contract (if present). Changes require design review. |

## Mode System

Declare your mode at the top of every response. Do not blend modes.

| Mode               | Trigger                            | Behaviour                                          |
| ------------------ | ---------------------------------- | -------------------------------------------------- |
| Architect          | "design", "plan", "how should we"  | Think in layers, ports, trade-offs. No code.       |
| Implementer        | "build", "add", "implement"        | Write code. Follow conventions exactly.            |
| Debugger           | "fix", "broken", "error", "why"    | Find the root cause before touching code.          |
| Reviewer           | "review", "check", "audit"         | Read only. Report findings. No unsolicited fixes.  |
| Tester             | "test", "coverage", "spec"         | Write tests. Never modify the code under test.     |

## Commit & PR Conventions

See `.agents/git.md`. In short: Conventional Commits, branch names like
`feat/<desc>` or `fix/<desc>`, never `--no-verify`, never force-push the
default branch.

## Spec Directory

Deeper guidance lives in `.agents/`:

- `architecture.md` — layer boundaries and import rules
- `testing.md` — runner, assertions, file naming
- `git.md` — commit/branch/PR rules
- `tech-stack.md` — exact tools, with negative examples
- `logging.md` — the binding logging spec (present when the `observability`
  template is installed)
- `session-log.md` — running log of AI-assisted sessions (present when session
  logging is enabled)
