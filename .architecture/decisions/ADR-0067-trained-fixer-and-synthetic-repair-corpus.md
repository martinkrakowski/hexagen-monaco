# ADR 0067: Trained Fixer over a Synthetic Repair Corpus

## Status

Proposed

## Context

Manifest generation runs a generate → check → repair loop. The check is
deterministic: the arch-linter and the zod schemas are exact oracles, not
judgements. Repair currently happens on two unrelated surfaces:

- `canAutoFix` / `applyDeterministicFix`
  (`packages/manifest-generation/src/domain/services/manifest-violation-fixer.ts`),
  a hand-maintained allow-list of roughly seven violation titles, consumed
  **client-side** by `ManifestPreview.tsx:164` and `ManifestAutoFixDrawer.tsx`.
- The staged server pipeline's LLM repair stages (Stage 6 verify-and-repair,
  Stage 7), which handle everything the allow-list does not.

The question raised was whether to train a model on the repository and use it in
this pipeline.

Two distinct proposals were conflated and must be separated, because they have
opposite answers.

**Training a generator.** Rejected. With a sound verifier in the loop,
correctness comes from search against the oracle, not from moving the prior.
Best-of-N or repair-until-clean yields provably valid output; a tuned generator
yields _more often_ valid output and no guarantee. The repository also offers
almost no signal for it — three `manifest*.yaml` files and forty
`.architecture` YAMLs total. Training on source code teaches code style, not
manifest generation, which is a different distribution wearing the same
filename. A tune would additionally freeze against a schema that is actively
moving (the scan envelope reached v1 this month) and would forfeit the
model-swap lever that `STAGE6_VALIDATOR_*` and the documented sweep baselines
exist to preserve.

**Training the fixer.** Accepted, and the reasoning that sinks the generator
case supports this one. The task is narrow — given `(violation, manifest)`,
emit a corrected manifest — with a bounded input alphabet and local edits rather
than whole-document generation. Labels are free and trustworthy: re-run the
linter and observe whether it passes. No human annotation, no reward model, no
ambiguity about what "correct" means. And `canAutoFix` already enumerates the
target: everything its allow-list returns `false` for is precisely the set a
model would serve.

### The corpus must be synthesised, not collected

The obvious way to build a repair corpus is to log production
`(prompt, output)` pairs. This is rejected on two independent grounds, either of
which is sufficient.

It contradicts a promise already shipped. Four places in the product tell users
their source is not kept:

- `features/landing/domain/creation-path.ts:80,82` — "We shallow-clone it, scan
  it, and delete the clone." / "Nothing is retained but the scan artifacts."
- `features/brownfield/views/TierPickerView.tsx:56`
- `features/brownfield/RepoEntry/RepoEntryView.tsx:93`
- `features/brownfield/ScanProgress/GithubScanPage.tsx:208` — "nothing was kept"

A manifest prompt carries the user's context names, layer structure and file
paths. Persisting it would make those sentences false. Changing the sentences to
match a new retention policy is a product and legal decision, not an
implementation detail, and it is not one this ADR takes.

It is also unnecessary, which is the stronger argument. A repair corpus can be
manufactured exactly, without users: take a **valid** manifest, apply a mutation
that injects a known violation, and record
`(mutated manifest + linter output → original manifest)`. The label is the
pre-mutation document, so it is correct by construction rather than by
inspection. Volume is bounded by mutation operators and seeds, not by traffic,
so the corpus exists before the product has users and covers violation classes
production may rarely produce. The repository already has mutation-testing
practice to build on.

This inverts the usual data-collection instinct: the privacy-safe path is also
the higher-quality one, because synthetic pairs carry a ground-truth label that
harvested pairs never have.

### What telemetry is for

Since training data is synthetic, persisted telemetry serves **evaluation**, not
training. The question it must answer is whether a tuned fixer beats the current
behaviour: for violation class X, did repair converge, in how many rounds, by
which path. That is metadata — enums, counts, durations — and carries no user
architecture, so it sits inside the retention promise rather than against it.

Today's `run-history-store.ts` cannot answer it: it records `stage`, `label`,
`durationMs`, `retryCount`, token counts and cost. It is a spend ledger, and it
knows nothing about violations or repair outcomes.

## Decision

1. **Do not train a generator.** Correctness stays with the deterministic
   oracle; generation improvements come from model swaps and constrained
   decoding, not weights.
2. **Target the fixer**, specifically the classes for which `canAutoFix`
   returns `false`. The deterministic fixer keeps precedence where it applies —
   a tuned model never overrides a fix that is already exact.
3. **Build the repair corpus synthetically**, by mutating valid manifests and
   using the pre-mutation document as the label. No production prompts or
   outputs are persisted for training.
4. **Add repair-outcome telemetry** recording only non-identifying metadata:
   violation class as a stable bounded value, which path handled it
   (deterministic / LLM / tuned / unfixed), round counts, durations, terminal
   outcome.
5. **Keep the retention promise unchanged.** Any future proposal to persist user
   content requires its own ADR and a copy change, and cannot be introduced as a
   consequence of this work.
6. **Gate adoption on measurement.** A tuned fixer ships only when telemetry
   shows it converging more often, or in fewer rounds, than the current path on
   the same violation classes. Absent that evidence it stays off.

## Consequences

The evaluation baseline must exist before the model. Telemetry lands first and
runs against current behaviour, so there is something to beat. Deploying the
D-P1 scan fixes will also shift these distributions — server-side scans
currently fail before doing real work — so pre-deploy numbers are not a valid
baseline.

Violation classes must become stable, bounded values. `canAutoFix` currently
branches on free-text titles and substring matches
(`desc.includes("missing ports")`). Free text cannot be a telemetry dimension:
it may embed user content and it drifts whenever a message is reworded, silently
splitting a class in two. Introducing stable codes is a prerequisite, and it
improves the fixer independently of any model.

The fixer's two surfaces must be reconciled, or the choice made explicit.
`applyDeterministicFix` runs in the browser; the LLM repair stages run on the
server. A tuned model serves one, not both, and "the fixer" currently names two
different things in two places.

Synthetic corpora cover the mutations they encode and nothing else. The
distribution is bounded by imagination rather than reality, and a class no
operator produces is a class the model never sees. Telemetry is the check on
that: classes appearing in production but absent from the corpus are the signal
to add operators.

A trained fixer that is wrong is not a correctness risk, because the linter
still gates every output — the failure mode is wasted rounds and cost, not an
invalid manifest reaching a user. This is the property that makes the fixer a
safe place to put a model and the generator an unsafe one.

## Alternatives considered

**Persist production pairs and fine-tune on them.** Rejected above: contradicts
shipped copy, and produces weaker labels than synthesis.

**Constrained decoding instead of a tuned fixer.** Not an alternative but a
complement, and cheaper. Enforcing the zod schema at decode time removes a class
of violations before repair runs at all. It should be done regardless; it
reduces the volume the fixer sees rather than replacing it.

**Extend the deterministic allow-list instead.** Preferred wherever a violation
has an exact repair — a deterministic fix is better than a probabilistic one on
every axis. The model is for the residue where the correct repair depends on
intent the linter cannot express, not for cases anyone can write a rule for.
