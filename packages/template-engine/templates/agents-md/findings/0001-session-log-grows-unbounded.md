---
id: 0001
subject: agents-md
subjectKind: template
subjectVersion: "1.0.0"
fixedIn: null
class: unbounded-growth
severity: high
surface: dx
status: open
---

## What happens

The `AGENTS.md` this template emits instructs agents to append session notes
to `.agents/session-log.md`. The instructions give the file no rotation, no
size bound and no cursor: every session appends, and any agent told to consult
it pays the whole file as input. Growth is unbounded, and the cost is paid on
every read — the artifact meant to make agents faster slowly makes every
subsequent agent slower.

## Minimal repro

A project that has run the template's workflow N times re-reads
`.agents/session-log.md` before acting: its size, and the tokens an agent
spends on it, grow at every append with no boundary anywhere in the template's
instructions.

## Fix

Bound the log in the template's instructions: define a maximum size (or a
session window); when it is exceeded, rotate `.agents/session-log.md` to a
dated archive the log itself names and start a fresh page that references the
archive. Appends are unbounded no more: the file a working agent must read
stays small, and everything older is opt-in.
