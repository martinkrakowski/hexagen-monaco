# CPM Extensions the Orchestration Package Would Need

**Date:** 2026-09-30
**Status:** Proposal. Not implemented.
**Relates to:** `docs/planning/2026-09-29_orchestration-template.md` (OW9 row in §5; the owner decision
near the top; C6 and N1 in §9)

This is a proposal only. It ships no manifest, no schema, no tooling and no spec change. It records what
the orchestration package (`@hexagen-monaco/orchestration` and its skill) would need from the Context
Package Manifest (CPM) spec, so the owner can decide whether to take either extension into the spec.

The spec is cited by section number and heading only. It is the owner's unpublished v0.1 Draft, and this
repository is public, so nothing from it is reproduced here.

## 1. Why this exists

The plan's owner decision put CPM last: a proposal doc, with `compatibility.requires` and
`load_hint: "skill"` as the two extensions. The orchestration package is a tool plus a skill, not a
knowledge payload. Two things CPM cannot say today would matter if it were ever packaged as a context
package:

1. what the host must have installed for the package to work at all;
2. that the payload is a skill the agent loads on demand, not one of the load hints the spec has today.

## 2. Extension 1: `compatibility.requires`

### 2.1 The gap

Spec §3.9 "Compatibility" describes where a package has been tested and how it should be positioned.
It has no way to declare runtime capabilities the host must provide. A context package that only informs a model does not need one. A
package whose skill drives `gh`, `yarn` and `git worktree` does, and a consumer that cannot see that
requirement finds out when a gate runs and quietly does nothing.

### 2.2 Proposed shape

A new optional field inside `compatibility`. Each entry names a capability, and may carry a probe that
the consumer runs to check it.

```jsonc
"compatibility": {
  "requires": {
    "capabilities": [
      { "id": "cmd:gh",               "probe": ["gh", "--version"] },
      { "id": "cmd:yarn",             "probe": ["yarn", "--version"] },
      { "id": "git:worktree",         "probe": ["git", "worktree", "list"] },
      { "id": "file:ci-workflow",     "path_from": "config.ciWorkflow" },
      { "id": "host:lane",            "optional": true, "probe_from": "config.laneHosts[].check" }
    ]
  }
}
```

The field names are illustrative. The owner should choose them. What matters is the content, and that the
consumer, not the package, runs the probe.

### 2.3 What `doctor` checks today, and where

Every capability above is already checked by `hexagen-orchestration-doctor`. Citations are to
`tools/orchestration/src/doctor/doctor.ts`, as of base `7b5526ab`.

| Proposed capability         | What `doctor` does now                                                                                                                                    | Code                                   |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `cmd:gh`                    | Fails with "gh is not on PATH" when `deps.hasCommand("gh")` is false                                                                                      | `doctor.ts:322-330`                    |
| `cmd:yarn`                  | Same loop, same failure for `yarn`                                                                                                                        | `doctor.ts:322-330`                    |
| `git:worktree`              | Fails when `deps.supportsWorktrees()` is false, which covers a non-repository as well as a missing feature. The injected signature is declared separately | `doctor.ts:332-340`; `doctor.ts:82-83` |
| `file:ci-workflow`          | Fails when the configured `ciWorkflow` path does not exist. The path comes from the overlay (default `.github/workflows/ci.yml`)                          | `doctor.ts:310-320`                    |
| `host:lane`, transport      | Fails when a lane host's `dispatch[0]` is not on PATH                                                                                                     | `doctor.ts:163-173`                    |
| `host:lane`, reachability   | Fails when the ssh probe to a remote host does not succeed                                                                                                | `doctor.ts:175-188`                    |
| `host:lane`, `check`        | Fails when the host's own `check` command does not succeed or times out; skips with a notice when no `check` is declared                                  | `doctor.ts:190-205`                    |
| `host:lane`, clone identity | Warns when the clone's `user.email` differs from this repository's; skips when the read cannot be made                                                    | `doctor.ts:207-244`                    |
| Repository name             | Fails when `repo` is unset and could not be derived through `gh`                                                                                          | `doctor.ts:291-305`                    |

The per-host sub-checks are assembled in `checkLaneHost` (`doctor.ts:153-247`) and run for every
configured host at `doctor.ts:342-344`. The injected capabilities (`hasCommand`, `supportsWorktrees`,
`runCheck`, `runRemote`, `localUserEmail`) are declared at `doctor.ts:71-109`.

### 2.4 What does not fit a static field

- **Lane hosts are project configuration, not package properties.** The set of hosts and their `check`
  commands live in the project's overlay, so a package can only say "a lane host, if any, with a working
  `check`", and the probe has to be resolved from project config. That is why the sketch above has
  `probe_from` and `path_from`. Whether CPM should allow a package to point at consumer configuration at
  all is an open question (section 6).
- **`doctor` distinguishes FAIL, WARN and SKIP.** Its header comment sets out the rules
  (`doctor.ts:14-55`): "could not check" is never a pass, and a WARN never moves the exit code. A
  declarative `requires` needs at least required versus optional to express that. The `optional` flag in
  the sketch is the minimum, and would not capture SKIP.
- **Some checks are not availability checks.** The `user.email` comparison and the
  `waveStatusPort`/`forbiddenPorts` consistency check (`doctor.ts:119-130`) are consistency checks on the
  overlay. They belong to the tool, not to a capability list. The proposal does not try to express them.

## 3. Extension 2: `load_hint: "skill"`

### 3.1 The gap

Spec §3.3 "Delivery" gives `load_hint` for a `static` package as a closed enum of three values, none of
which describes a skill. A skill is a payload the agent discovers from a short description and
loads on demand when the task calls for it, and it may bring referenced files with it. Declaring it
`system` would tell a consumer to place it in every prompt, which is the opposite of the intent, and
would spend the token footprint the skill mechanism exists to avoid.

### 3.2 Proposed change

Add a fourth enum value, `"skill"`, to `delivery.load_hint` for `kind: "static"`. A consumer that
understands it loads the entry as a skill: description always visible, body loaded on demand. A consumer
that does not understand it must treat the value as unknown rather than fall back to `system` silently;
the owner should decide what the spec requires there (section 6).

### 3.3 Why this is a MINOR change

The spec versions itself under its own rules. The footer of the document says that changes to the spec are governed by the rules of §4, and that renaming or removing a field is MAJOR. The proposal does
neither. It adds an enum value, and every existing manifest stays valid and keeps its meaning. By the
spec's own terms that is additive, so it is MINOR: v0.1 to v0.2.

Section 4 "Versioning semantics for context" defines the bumps for a package by whether existing
consumers' answers change. The analogy holds: an existing consumer's behaviour on an existing package
does not change.

Two caveats, both for the owner:

- Section 4 is written about package versions, and the footer extends it to the spec by reference. The
  spec does not say in terms that adding an enum value is MINOR. The reading above is an inference.
- `compatibility.requires` (section 2) is also an addition of an optional field, and is MINOR on the
  same reasoning. Both could land together in one v0.2.

## 4. What is deferred, and why

### 4.1 No manifest is shipped

Spec §8 "Minimum viable tooling" lists `cpm validate` first, described as schema validation plus
cross-field checks. It does not exist. A manifest with no validator is an unchecked claim, and this
package's whole design is to refuse unchecked claims (the `doctor` header says as much at
`doctor.ts:27-30`). Shipping a manifest file would also commit to field names (section 2.2) the spec
owner has not chosen. No manifest is written here, and none should be until `cpm validate` exists and
the two extensions are either accepted or rejected.

### 4.2 L1 is deferred

Spec §6 "Conformance levels" places L1 ("Evaluated") at L0 plus `evals` with a baseline without the
package. Running that for a skill means an agentic harness: an agent doing a multi-step orchestration
task, with and without the skill, scored. No such harness exists. `cpm eval` (§8) is also unbuilt. The
package would be declared L0 at most, and nothing would be claimed beyond what can be checked.

### 4.3 The overlay replaced `requires.capabilities` in this wave

The orchestration plan resolved C6 and N1 without CPM. The capability checks that a
`requires.capabilities` field would have declared became `doctor`'s own checks, reading the project's
overlay (OW-D7 per the plan's C6 row; OW-D5/B-1 in the `doctor.ts:36-38` comment). The overlay is the source of truth
for the configured `ciWorkflow` and the lane hosts, and `doctor` is the consumer. So the wave shipped
the behaviour without the field. This proposal is the route by which the field could later be declared in
a manifest as well, with `doctor` as the reference implementation of its checks.

N1 (Claude Code skill frontmatter such as `compatibility` and `license`) was not used in the wave for the
same reason, and this proposal does not adopt it either: a frontmatter block on the skill would be a third
capability list beside `doctor` and a manifest, and every duplicated list is one that drifts. If CPM takes
`requires`, the manifest is the declaration and the skill's frontmatter stays descriptive.

## 5. If the owner accepts

In order, and none of it in this repository's current wave:

1. The owner decides the field names and the FAIL/WARN/SKIP question (section 6), and versions the spec.
2. `cpm validate` exists and understands both additions.
3. A manifest for the orchestration package is written and validated, at L0.
4. `doctor` and the manifest are cross-checked, so the two lists of capabilities cannot drift. The
   failure mode to prevent is the one the plan already flags for any duplicated source of truth.
5. L1 waits for an agentic eval harness.

## 6. Open questions for the spec owner

1. **Naming and namespace.** Is `requires` right inside `compatibility` (§3.9), or does it belong in its
   own top-level section next to `dependencies` (§3.10), since it describes the host rather than tested
   models?
2. **Who runs the probe?** Is a probe argv in a manifest acceptable at all, given the spec's concern
   with injection (§6 states a scan over payloads and tool descriptions)? An argv a consumer executes is
   a new attack surface. The alternative is a fixed vocabulary of capability ids with probes defined by
   the consumer. Spec §3.5 `guardrails.validators` already declares consumer-runnable executables; should
   `requires` reuse that shape?
3. **Severity.** Should `requires` distinguish required from optional, and should a consumer be allowed
   to report "could not check" as a third outcome distinct from a pass?
4. **Pointing at consumer config.** Should a package be allowed to reference the consumer's own
   configuration (a CI workflow path, lane hosts), or must `requires` be static? Section 2.4 argues that
   without it, the lane-host checks cannot be expressed.
5. **Unknown `load_hint`.** What must a consumer do with a value it does not recognise: reject the
   package, or load it under a documented default? The answer decides whether adding `"skill"` is truly
   harmless to older consumers. The §3.1 `cpm` field is the spec-version pin a consumer reads first, which is
   the existing mechanism for an older consumer meeting a newer manifest.
6. **Skill entry shape.** What is the `entry` of a `skill` delivery: a single file with front matter, or
   a directory? The orchestration skill carries reference files beside its entry.
7. **Does a skill need its own `kind`?** Or is `static` with `load_hint: "skill"` the right home? The
   latter is the smaller change, and is what this proposal assumes.
8. **Versioning of the spec itself.** May the owner confirm that adding an optional field and adding an
   enum value are MINOR under the footer's rule, given that §4 does not state it for spec changes
   directly?

## 7. Spec sections cited

§3.1 Identity, §3.3 Delivery, §3.5 Guardrails, §3.9 Compatibility, §3.10 Dependencies, §4 Versioning
semantics for context, §6 Conformance levels, §8 Minimum viable tooling, and the closing versioning line of the document.
