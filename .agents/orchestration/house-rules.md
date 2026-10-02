# House rules

Rules this project holds itself to. Written for the agent that will work
here, so each one says what to do rather than what to avoid.

## Wave Observability

A delegated wave is only as good as its record. Three things make that
record, and all three come from this overlay rather than from a constant:

**Events.** The orchestrator emits every wave event, through
`hexagen-orchestration-wave-event`, into `<wave log dir>/events.jsonl`. A lane
emits none: its commits and its PR are its record, and the orchestrator emits
the event for each stage it observes. The log is the only source of what a
wave did. Nothing is inferred from a process list or a directory name.

**Status.** `hexagen-orchestration-wave-status` serves the wave from that
log. The server is read-only and loopback-only: it answers GET requests on
127.0.0.1, and it starts, kills and merges nothing. Its port is `waveStatusPort` in `.agents/orchestration/config.yaml` (default 4318), and it refuses every port in `forbiddenPorts`.

**The log directory is yours.** `waveLogDir` decides where waves are read
from. It is per-repository on purpose. This project sets it to
`$HOME/.waves-hexagen` (`waveLogDir` in `config.yaml`) and never `~/.waves`. That directory is shared
between projects, and a status server that scans it will read another
project's waves and report them as this project's.

> **Action for the human:** paste the section above into `AGENTS.md`.
> It is the one instruction in this overlay that a tool cannot carry for
> you, and an agent that has not read it will not know the wave is
> observable at all.

## Working here

- Read `.agents/orchestration/config.yaml` before starting. It is the source
  for the plan directory, the gate steps and the ports in play.
- A rule with no test is not a rule. Name the test.
- When something is discovered that should have been known earlier, it goes
  in `lessons.md`, with the source it came from.
- `.claude/` is gitignored, so each checkout links the skill with `mkdir -p .claude/skills && ln -s ../../.agents/skills/orchestrate-wave .claude/skills/orchestrate-wave`.
