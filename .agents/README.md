# .agents/ — HexaGen Agent Specification Directory

This directory contains detailed operational specifications referenced by `AGENTS.md`.
Agents should not directly edit these files — they are generated from `AGENTS.md` + source specifications.

---

## Files

| File                          | Purpose                                     | Referenced By                  |
| ----------------------------- | ------------------------------------------- | ------------------------------ |
| `ORCHESTRATOR.md`             | Full Orchestrator Mode protocol             | `AGENTS.md` §Orchestrator Mode |
| `TESTING.md`                  | Testing protocol for Develop Mode           | `AGENTS.md` §Develop Mode      |
| `yaml-editing-disciplines.md` | YAML editing rules for .architecture/ files | `AGENTS.md` §YAML editing      |

---

## Usage

When `AGENTS.md` references one of these files, the agent must load and follow
the specification exactly. Do not summarize or deviate from the spec —
load the full file content before executing that mode.
