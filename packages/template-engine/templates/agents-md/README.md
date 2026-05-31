# AGENTS.md (`agents-md`)

> A rich `AGENTS.md` (mode system, tech-stack reference, commands-after-edits table) plus a
> companion `.agents/` spec directory — the instructions your AI agents read.

|               |                                        |
| ------------- | -------------------------------------- |
| **ID**        | `agents-md`                            |
| **Category**  | Project meta / agent instructions      |
| **Requires**  | —                                      |
| **Conflicts** | none                                   |
| **Branch**    | `feature/generator-template-agents-md` |

Author/agent-facing reference, beside `manifest.json` — not emitted into projects.

## What it does

Generates the project's agent contract: a top-level `AGENTS.md` and a `.agents/` directory
documenting architecture, testing, git, and tech-stack conventions — so AI agents (and humans)
have one authoritative source of how this codebase works.

## What it scaffolds

`AGENTS.md`, `.agents/architecture.md`, `.agents/testing.md`, `.agents/git.md`,
`.agents/tech-stack.md`, and (gated) `.agents/session-log.md`.

## Install

`hexagen add agents-md`. Questions:

| Question                         | Options (default)                                                    |
| -------------------------------- | -------------------------------------------------------------------- |
| `project_description` (required) | one-sentence description                                             |
| `architecture_style`             | `hexagonal` / `layered` / `feature-based` / `monolith` (`hexagonal`) |
| `session_logging`                | `true` — emit `.agents/session-log.md`                               |

## Usage

Edit the generated files to match reality, then point your agent at `AGENTS.md` (this repo's own
convention is that `AGENTS.md` is canonical — `CLAUDE.md` redirects to it).

## Notes for agents

- Keep `.agents/tech-stack.md` current — add a row per installed Hexagen template.
- If session logging is enabled and you don't want it tracked, add `.agents/session-log.md` to
  `.gitignore`.

## Checklist (post-install)

Edit the description; confirm the architecture style matches the code; update the tech-stack table;
verify the agent reads `AGENTS.md`; gitignore the session log if desired.

## Related

Standalone (no dependencies). Complements every other template by documenting how they fit together.
