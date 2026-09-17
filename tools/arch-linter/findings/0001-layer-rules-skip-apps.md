---
id: 0001
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

The arch-linter never evaluates an application. Its scan loop reads a single
manifest section — `manifest.bounded_contexts` — and applications are declared
in a sibling section the linter does not read at all. Nothing in the linter's
source refers to that section, so an application is not a unit the layer rules
can skip, reject or report on: it is outside the set they iterate. Whatever a
manifest claims about an application's files is backed by nothing the linter
runs, and no diagnostic says so, because nothing was asked to look.

**Corrected after review.** This record previously described a different
mechanism: that an application-rooted _context_ resolved to a package path that
does not exist, and that the linter skipped the module because the root was
missing. That skip is real and is a separate defect — a module whose resolved
root is absent returns silently, with no warning naming the module or the path
it looked for. It is not, however, why applications go unevaluated. There are no
application-rooted contexts; applications are not contexts. The earlier text
described a repro that cannot occur, and it survived two reviews, one of which
sharpened the wording without reaching the error. A finding that is wrong about
its mechanism is worse than a finding that is vague about it: the vague one gets
questioned, and this one would have been built on.

## Minimal repro

Declare an application in a manifest, give it source files, and introduce an
import from one of them that violates the layer rules the manifest declares for
it. Run the linter: it reports nothing and exits clean. Now delete the
application's entry entirely and run again: the output is identical, because the
entry was never read either way. Two manifests that disagree about an
application produce the same clean result, which is the property that makes the
gap invisible.

## Fix

Two changes, and the first is a decision rather than an edit.

Decide whether applications are lint units. If they are, the manifest needs a
lintable root per application and the scan loop needs to union applications with
bounded contexts — a schema change and a linter change together, because either
alone leaves the other half unable to express or to read it. If they are not,
withdraw the claim instead: say in the manifest documentation that applications
are out of scope, and name what does cover them, so a reader stops inferring a
guarantee from silence.

Separately, and regardless of that decision, make the missing-root skip report.
A gate that returns silently is indistinguishable from a gate that passed, and
this repository's own rule is that a gate which has not been shown to fail has
not been shown to exist. Emit a diagnostic naming the module and the path that
was looked for, and pin it with a test that goes red when the diagnostic is
removed.
