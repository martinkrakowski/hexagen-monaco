# ADR-0061: Three-Layer Fair-Source License Split

**Date:** 2026-08-17
**Status:** Accepted
**Type:** Licensing
**Runbook ID:** D-1
**Relates to:** ADR-0060 (D-3 — business, the prerequisite), ADR-0062 (D-2 public copy), [`2026-08-17-fde-gtm-development-runbook.md`](../../docs/planning/2026-08-17-fde-gtm-development-runbook.md) Phase −1 D-1, [`2026-08-17-positioning-plan-independent-review.md`](../../docs/planning/2026-08-17-positioning-plan-independent-review.md) §7 and §8

> Numbering note: Phase −1 batch. The historical ADR-0009/0010 numbering collisions are not reused.

## Context

The tree ships under a Source-Available Evaluation License: no commercial production use, no managed service, no redistribution. Published tarballs inherit that license because `scripts/prepare-publish-package.js` falls back to the repo-root `LICENSE` when a package has none. Package READMEs restate the evaluation terms. There is no ADR for licensing.

That license blocks the motion ADR-0060 chose. A funnel needs commercial _internal_ use of the check. The evaluation grant forbids it, including the consulting-adjacent case "run this in your CI during the engagement."

Two options in earlier drafts were a false dichotomy (independent review §7):

- **Option A — Apache-2.0 open-core.** Maximum adoption, zero defense against "HexagenLint Cloud" or a harness vendor folding the engine in.
- **Option B — stay fully proprietary.** Legally simple, and it keeps the current production-use ban that forecloses even engagement CI.

The fair-source middle (FSL / FCL / BSL) is the family built for a paid product that still wants a public wedge. Sole copyright sits with Krakowski Cloud Solutions, LLC; there is no CLA debt. Relicensing a subset is a decision, not a negotiation. "Never transitions to open source" appears only in `README.md`; it is not a term of `LICENSE` (independent review N4).

`packages/sync` is the real sub-decision. It is co-published with the linter today, but it contains the generator. Options were: (a) FSL the whole package; (b) extract `sync --check` (what `sync-integrity.yml` consumes) into the linter or a small new package, FSL that, and keep generation proprietary.

FSL is not OSI-approved. Enterprise legal will flag it; that review belongs in the Phase 0 trial, not after the first "yes."

## Decision

**Three-layer fair-source.** The wedge is FSL-1.1-Apache-2.0. The platform stays proprietary. The hosted free tier is Terms of Service, not a code license.

| Layer         | Components                                                                                                             | License                                 | Rationale                                                                                                                                                                        |
| ------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Wedge**     | `tools/arch-linter`, future `adopt` / `bootstrap` / `report` commands, the CI action, and the whole of `packages/sync` | **FSL-1.1-Apache-2.0**                  | Free for any internal use, including commercial internal use. Prohibits competing offerings. Each published version converts to Apache-2.0 two years after it is made available. |
| **Platform**  | Web app, staged generation, hosted history / dashboards, multi-repo, agent-constraint pack                             | Proprietary commercial (root `LICENSE`) | This is the product. History, dashboards, and the agent pack are the moat.                                                                                                       |
| **Free tier** | Hosted product under ToS                                                                                               | Terms of service, not a code license    | Already built (durable quota store). The planned GitHub-login subscription gate is the paid boundary.                                                                            |

### Sync sub-decision

**FSL the whole of `packages/sync`.** Independent review §7.1: keep the co-published pair on one license.

Extracting `--check` was rejected: it splits a co-versioned pair onto two licenses, complicates the publish pipeline, and buys little protection. The 2-year-old converted version of a fast-moving tool is not a competitive threat relative to that cost. Generation stays in the same package; the headline change (conformance) does not require hiding the generator behind a second license.

### FCL trigger

FCL (FSL + ELv2-style limits) is used **only if a self-hosted paid tier is sold**. It is not applied speculatively. Until that product exists, the platform license stays the current proprietary evaluation/commercial grant.

### New packages default proprietary

A new package is proprietary (root `LICENSE`) unless a change to this ADR deliberately places it in the wedge. Wedge membership is an explicit list, not a "published ⇒ FSL" heuristic.

### Version boundary

Already-published tarballs of `@hexagen-monaco/sync` and `@hexagen-monaco/arch-linter` at **≤0.9.0** (the last published release) remain under the evaluation license **forever**. 0.10.0 is untagged and unpublished. The FSL relicense applies from the next release that is actually published. This is recorded in `CHANGELOG.md` and is not itself a release.

### Trademark

The **Hexagen-Monaco** mark is protected independently of the code licenses. FSL's grant does not include trademark rights beyond identifying origin (FSL § Trademarks). One sentence in the public README states this; it does not belong in the FSL text.

### Partner-facing interpretation of FSL competing-use

FSL-1.1 permits "professional services that you provide to a licensee using the Software" and forbids making the Software available in a commercial product or service that substitutes for it or offers the same or substantially similar functionality.

Written down before anyone asks:

- **A consultancy may run the wedge in a client repository** — install `hexagen-lint` / `hexagen` / the CI action, produce a report, leave the check in the client's CI after the engagement. That is professional services to a licensee, plus the client's own internal use.
- **A consultancy may not resell "conformance as a service" on the wedge** — hosting the linter, selling a competing check as a product, or wrapping the engine as a managed offering. That is Competing Use.

Bespoke certainty for a named enterprise belongs in that customer's commercial agreement, never as a rider on the public FSL. A prior draft's "FSL rider / perpetual internal-use grant" was rejected in adjudication: FSL-1.1's own grant is already perpetual per-release for every non-competing purpose; a bespoke rider increases legal-review friction and muddies the Apache conversion.

### Why this beats the two rejected options

- vs. Apache-2.0 open-core: FSL preserves paid-product defensibility (nobody ships "HexagenLint Cloud" or folds the current engine into a competing harness) while losing almost no adoption surface. Users Apache attracts that FSL does not are competitors and license-purists; the funnel targets neither. The delayed Apache conversion keeps the OSS-credibility signal.
- vs. stay proprietary: the evaluation license forbids the customer's own production CI use, which is the entire FDE motion.

## Consequences

- `tools/arch-linter/LICENSE` and `packages/sync/LICENSE` carry the official FSL-1.1-Apache-2.0 text. Their `package.json` `license` field is `FSL-1.1-Apache-2.0`; the file is authoritative (there is no bare SPDX short-form guarantee).
- Root `LICENSE` remains the proprietary platform license. It is not copied into FSL tarballs. `scripts/prepare-publish-package.js` fails if a published package has no per-package `LICENSE`.
- Public README copy is rewritten under ADR-0062. Package READMEs restate FSL, not the evaluation terms.
- If external contributions are ever accepted on FSL packages, a DCO or lightweight CLA lands _first_. Sole ownership is what keeps future license moves free.
- FSL is not OSI-approved. Budget legal-review cycles into the Phase 0 trial.
- Relicense is release-gated. Shipping these files on `main` does not change the terms of tarballs already on npm.
