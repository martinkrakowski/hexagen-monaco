---
id: 0002
subject: orchestration
subjectKind: template
subjectVersion: "1.0.0"
fixedIn: "1.0.0"
class: host-assumption
severity: medium
surface: build
status: fixed
---

## What happens

Every file this template emits passes through `interpolate()`, which rewrites a bare
`{identifier}` with the matching answer and leaves anything it cannot resolve in place with a
warning. A GraphQL query that selects a field inside a selection set is written
`{thread{isResolved}}`, and `isResolved` matches the placeholder grammar exactly.

Shipped as a template output, that line is not prose — it is emitted into a consumer project, where
`isResolved` is not an answer key. The consumer gets a warning, keeps the literal `{isResolved}`,
and a GraphQL query that never resolves. The warning is the only evidence, and it reads as a
template bug rather than a syntax error in a shell-out, so it is easy to dismiss and then debug
twice.

The hazard is a property of the emitter, not of any one file: a corpus with brace density (GraphQL
mutations, JSON payloads, template literals) cannot be hand-escaped cheaply, because every
re-sync from the source reintroduces unescaped braces.

## Minimal repro

Add an output whose source file contains `mutation($id:ID!){resolveReviewThread(input:{threadId:$id}){thread{isResolved}}}`
to a template manifest, install it, and read the emitted file: `{isResolved}` survives verbatim and
the emitter's warning list names `isResolved` as an unresolved template variable.

## Fix

Ship the affected templates scrubbed rather than raw. This template's brief reference carries the
prompt templates an orchestrator dispatches from, and the GraphQL line that resolved a review
thread lives in the stage prose, not in any brief; the line is omitted rather than escaped, so the
emitted corpus carries no GraphQL selection set at all.

Where brace-bearing syntax is genuinely needed in a future output, the correct answer is doubling
the braces (`{{`/`}}`, which `interpolate()` turns back into one) — not a per-file escape hatch
scattered across the emitter. Escaping in the source keeps the engine's behaviour uniform, which is
what makes the warning on an unescaped brace trustworthy.
