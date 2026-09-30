# Lessons

Things learned the expensive way, so the next wave does not pay for them
again.

Each entry names where the lesson came from. An entry with no source is a
guess wearing the same clothes as a finding.

## Format

```
### What happened

### Why it was not caught

### Source

```

## On a mergerfs pool, `yarn install` fails transiently

### What happened

On midnight's mergerfs pool, `yarn install` failed once with EACCES and succeeded on the next run. Retry once before treating it as real.

### Why it was not caught

The failure looks like a permissions fault, so it reads as a real defect in the worktree.

### Source

Lane installs on the midnight host (`laneHosts` entry `midnight`), 2026-09.

## A host-local git email becomes a public trailer

### What happened

A squash merge turns a host-local `user.email` into a public `Co-authored-by` trailer. Set the host clone's local `user.email` to the GitHub noreply address. doctor WARNs on the mismatch.

### Why it was not caught

The address is invisible in the lane's own commits and only surfaces in the merged history.

### Source

hexagen-orchestration-doctor's `user.email` check; the A-30 lane-host design in `docs/planning/2026-09-29_orchestration-template.md` §12.4.
