---
id: 0001
subject: arch-linter
subjectKind: component
subjectVersion: "0.12.1"
fixedIn: null
class: coverage-gap
severity: low
surface: lint
status: wontfix
---

## What happens

The arch-linter never evaluates an application. Its scan loop reads one manifest
section — bounded contexts — and applications are declared in a sibling section
the linter does not read. An application is not a unit the layer rules skip; it
is outside the set they iterate.

**Closed as wontfix by the owner, with the scope decision recorded.** This is not
a gap to fill. Applications are outside the generator's product scope: the
generator does not emit them, so a lint unit it governs cannot be one. A unit has
to be something the bootstrap creates, the schema names, and the linter can fail
on. Making applications units would mean schema fields for paths the generator
never writes, discovery over directories that may be absent, empty or a
hand-rolled framework app, and gate lanes that cannot run on a fresh scaffold —
the only tree the claim could be proved against.

Encoding that would assert a product boundary that does not exist: _the generator
governs application composition roots_. It does not. An application a user adds
later sits outside the architectural scaffold; the root linter may pick it up if
they opt in, and the generator's gates should not require it.

The record is kept rather than deleted because the reasoning is the useful part:
a reader who notices applications go unevaluated should find the decision, not
re-derive the defect.

**Two earlier versions of this record were wrong**, and both reached the store.
The first described layer rules matching a package glob. The second, which
survived a review that sharpened it, described an application-rooted context
falling back to a package path that does not exist — a repro that cannot be
performed, because there are no application-rooted contexts. The mechanism was
only settled when two independent reviewers checked the scan loop rather than the
record.

Revisit only if the product scope changes to generating drivers under an
applications directory. That is a generator feature, not a linter patch.

## Minimal repro

Not applicable — the behaviour is by design. What was previously offered as a
repro (declare a context whose files live under an application directory) cannot
be performed: applications are not contexts.

## Fix

None. The claim is withdrawn.

Two things that follow, and belong elsewhere. The separate defect this record
previously blamed — a module whose resolved root is absent returns with no
diagnostic — is real, is independent of application scope, and is recorded as its
own finding. And any gate lane written against "each application is a lint unit"
should be retargeted at generated packages, which the generator does emit and can
therefore prove.
