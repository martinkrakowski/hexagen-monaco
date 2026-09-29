---
id: 0002
subject: arch-linter
subjectKind: component
subjectVersion: "0.12.1"
fixedIn: null
class: coverage-gap
severity: medium
surface: lint
status: open
---

## What happens

A module whose resolved root directory does not exist is skipped, and the skip
produces no diagnostic. The linter does not name the module, does not name the
path it looked for, and does not count the module as unevaluated. It returns and
the run continues to a clean exit.

A gate that returns silently is indistinguishable from a gate that passed. The
tree that is fully evaluated and the tree with a typo in a module name produce
the same output, so the typo is invisible for as long as nobody compares the
scanned-file count against the manifest by hand.

This is independent of which units the linter governs. Whatever the set is, a
member of it that cannot be found should say so.

## Minimal repro

Declare a module in the manifest whose root directory does not exist — a
renamed package, a typo in the name, a context added before its directory. Run
the linter: it exits clean and reports nothing about that module. Delete the
entry entirely and run again: the output is identical. Two manifests that
disagree about a module produce the same clean result.

## Fix

Emit a diagnostic naming the module and the resolved path that was looked for,
and decide deliberately whether it warns or fails — a missing root is either a
manifest error or an expected state during a rename, and the record should say
which.

Pin it with a test that goes red when the diagnostic is removed. The repository's
own rule is that a gate which has not been shown to fail has not been shown to
exist, and this skip is the case that rule was written for.
