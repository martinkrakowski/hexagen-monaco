# ADR-0057: Manifest `layers.*` Lists Are a Curated Ownership Registry, Not a File Inventory

**Date:** 2026-08-16
**Status:** Proposed
**Type:** Architecture
**Relates to:** HEX-018 (remediation-plan item 6.4) — this ADR is the **document-only disposition** of that item, decided in `docs/planning/2026-08-16-decision-dossier-and-remediation-followups.md` §1.5; ADR-0047 (port ownership and homonym doctrine); ADR-0048 (inbound vs outbound port directory convention); ADR-0043 (linter derives cross-context import legality from manifest `depends_on`); ADR-0054 (arch-lint enforcement posture — the ratchet this ADR declines to extend)

> Numbering note: the highest pre-existing record was ADR-0056; this ADR takes the next contiguous slot. The historical ADR-0009/0010 numbering collisions are not reused.

## Context

Review bots repeatedly flag the same defect class against
`.architecture/contexts/**/context.yaml`: a bounded context declares fewer
`layers.application.ports` / `layers.infrastructure.adapters` entries than the
package contains files. The flag is framed as drift, and the implied remedy is
to complete the lists.

**No bot configuration exists in this repository.** The bots are enforcing a rule
the repository wrote about itself — `AGENTS.md` Develop-Mode item 5, "Every file
maps to a named element in `manifest.yaml`", restated as a merge-checklist line in
`.agents/ORCHESTRATOR.md`. That is the actual source of the flags, and it is the
line this ADR changes.

### The rule is one the repo wrote, does not follow, and cannot check

Measured on the working tree at `a727df4d`, across the 34 split context files:

| Measure                                        | Declared | On disk |
| ---------------------------------------------- | -------- | ------- |
| Ports (`layers.application.ports.in` + `.out`) | 96       | 142     |
| Adapters (`layers.infrastructure.adapters`)    | 56       | 118     |

Excluding `**/templates/**` (customer payload, not host source) and test files.
Counting only files that actually export a matching `*Port` / `*Adapter` symbol,
**41 of 125 port files (33%) and 58 of 102 adapter files (57%) name no declared
entry.** 11 contexts carry no `ports:` key at all; 12 carry no `out:` key.

The rule also cannot be checked. `yarn lint:arch` never reads manifest `layers`:
it consumes `bounded_contexts` structurally, and only `name` / `type` /
`depends_on` (`tools/arch-linter/src/cross-package-violation.ts:37-42`). Every
`layers` reference inside `tools/arch-linter/src/` resolves to `layerRules.layers`
— the **linter-config** layer-import table, an unrelated document. So the rule
asserted by `AGENTS.md` has no enforcing mechanism anywhere in the toolchain, and
the command the rule tells the agent to run to verify it is blind to it.

A rule that is stated as universal, obeyed by roughly half the tree, and checked
by nothing is not a standard. It is a permanent generator of review noise, and it
misdirects every reader who assumes a green `lint:arch` means the lists are sound.

### What actually consumes these lists

The dossier survey found twelve consumers. **Ten are indifferent to
completeness** — they render, diff, or count whatever is present. The two that are
not both argue _against_ enforcement:

- **The grounded LLM prompt** (`packages/prompt-compiler`,
  `infrastructure/adapters/app-compatibility.adapter.ts:42` and
  `infrastructure/adapters/migrated-grounded-prompt.adapter.ts:68`) renders
  `Object.entries(...).slice(0, 10)` under `PORT OWNERSHIP (selected):`. The repo
  produces ~95 entries and shows 10. **Adding the ~45 missing entries would push
  real ones out of the window.** Here completeness is structurally irrelevant and
  _accuracy_ is the only thing that pays — a phantom entry inside the window
  actively teaches the model a port that does not exist, two lines above the
  prompt's own `port-single-ownership [critical]` assertion.
- **`hexagen_create_adapter`** and the manifest emission contract _write_ these
  lists. They need the keys to exist and to be well-formed; they gain nothing from
  the keys being exhaustive.

### Why completeness was rejected

Enforcing it means roughly 150 additions whose **direction is not derivable from
the tree**: 25 port files sit in folders carrying no `in`/`out` signal, and for the
five packages HEX-018 names, ADR-0048 established that the folder signal is _known
wrong_ (driven ports parked under `ports/in`). It would also need a new ratchet
baseline key scheme, and it is gated behind an unstarted plan item. There is no
consumer willing to pay for it.

### Why deleting the lists was rejected

It would break the live `hexagen_create_adapter` write path and a published
emission contract.

## Decision

### 1. The lists are a curated ownership registry

`layers.application.ports` and `layers.infrastructure.adapters` in
`.architecture/contexts/**/context.yaml` record **which bounded context owns a
named architectural element**. They are not, and are not required to become, an
inventory of the files on disk.

**The filesystem is the authoritative inventory.** A port or adapter file is real
because it exists and is imported, not because it is listed. An absent entry is
not drift and is not a defect.

Consequences, stated so they cannot be re-litigated per PR:

- **Do not add an entry merely because a file was created.** Declare an element
  when its context genuinely owns it as part of the contract other contexts,
  tools, or the grounded prompt should see.
- **Never delete a file because it is unlisted.** Non-membership carries no
  information about liveness.
- **An entry naming no exported symbol is a defect**, not a to-do. The registry's
  one hard invariant is _accuracy_: every entry must name a symbol that exists,
  spelled exactly as exported, attributed to the context whose package defines it,
  and declared in exactly one context (ADR-0047's `port-single-ownership`).
- **Direction follows ADR-0048** — `in` = driving, `out` = driven — regardless of
  which folder the file currently sits in.

### 2. Ownership follows the definition site

Where a port's canonical definition has moved and the original context retains only
a re-export shim, the registry entry moves with the definition. This ADR applies
that rule to three ports whose canonical definitions now live in
`packages/shared`: `LoggerPort`, `MonacoPersistencePort`, and
`WizardPersistencePort`. To the extent ADR-0009 attributes `MonacoPersistencePort`
to `monaco-orchestration`, that attribution is superseded — `monaco-orchestration`
keeps the compatibility re-export, not the ownership claim.

### 3. `AGENTS.md` states the rule the repo actually holds

Develop-Mode item 5 and the `.agents/ORCHESTRATOR.md` checklist line are rewritten
to state the registry doctrine, to name the split `context.yaml` files rather than
the pre-split monolithic `manifest.yaml`, and to say plainly that `yarn lint:arch`
does not verify these lists.

### 4. No enforcement mechanism is added, and the one that pretended to exist is deleted

`packages/sync/src/generators/validators/` and its `validators.ts` re-export shim
are deleted. `validateBoundedContext` and its four helpers were introduced
2026-04-28, and `git log -S` shows the symbols never acquired a caller: nothing
outside the directory imports the shim, and `packages/sync/src/index.ts` — the
package's only export entry — does not reference `generators/` at all.

They were also unusable. They probe `${name.toLowerCase()}.in-port.ts` /
`.out-port.ts` and `${name.toLowerCase()}.adapter.ts`; the repository convention is
kebab-case `*.port.ts` and `*.adapter.ts`. Simulated against the current tree and
the current manifests, they emit **231 errors and 156 warnings, and not one of the
231 file-existence probes resolves** — a 100% false-positive rate.

Their continued existence is precisely what makes reviewers and bots believe an
enforcement mechanism exists. Deleting them makes the absence of one legible, which
is the honest state and the one this ADR ratifies.

## Consequences

**Positive.** The stated rule and the observed practice agree, so the recurring bot
flag loses its warrant and can be dispositioned by citing this ADR. The registry
gains a hard, cheap invariant (accuracy) in place of a soft, expensive one
(completeness) — and accuracy is the property the only quality-sensitive consumer,
the grounded prompt, actually needs. `packages/sync` loses ~11 KB of dead code that
would have red-walled CI the moment anyone wired it.

**Negative.** The registry stays partial, so it cannot be used as a discovery index
— readers must go to the filesystem. Accuracy has no automated check; it is held by
review. If a future consumer needs completeness, this ADR must be superseded rather
than quietly worked around, and the direction-derivation problem ADR-0048 documents
will have to be solved first.

**Neutral.** No runtime behaviour changes. No published contract changes: the
deleted validators were never exported from `@hexagen/sync`.
