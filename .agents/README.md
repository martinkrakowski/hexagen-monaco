# .agents/ — HexaGen Agent Specification Directory

This directory contains detailed operational specifications referenced by `AGENTS.md`, plus bot-facing review material that is not an agent mode spec.

Agent mode specs (`ORCHESTRATOR.md`, `TESTING.md`, `REVIEW.md`, `yaml-editing-disciplines.md`) are maintained with `AGENTS.md`. Do not edit them as a side effect of an unrelated change. `PR_REVIEW_RUBRIC.md` is **bot-facing** (PR-Agent context), not an agent-authored mode spec.

---

## Files

| File                          | Purpose                                     | Referenced By                         |
| ----------------------------- | ------------------------------------------- | ------------------------------------- |
| `ORCHESTRATOR.md`             | Full Orchestrator Mode protocol             | `AGENTS.md` §Orchestrator Mode        |
| `TESTING.md`                  | Testing protocol for Develop Mode           | `AGENTS.md` §Develop Mode             |
| `REVIEW.md`                   | Review-bot comment disposition protocol     | `AGENTS.md` §Review & Archeology Mode |
| `yaml-editing-disciplines.md` | YAML editing rules for .architecture/ files | `AGENTS.md` §YAML editing             |
| `PR_REVIEW_RUBRIC.md`         | Bot-facing UI-contract rubric for PR-Agent  | `.pr_agent.toml` `repo_context_files` |

---

## Usage

When `AGENTS.md` references one of these files, the agent must load and follow
the specification exactly. Do not summarize or deviate from the spec —
load the full file content before executing that mode.
