# Hexagen Monaco — Positioning, Feature, and Gauntlet Integration Plan

> **Status banner (2026-08-17):** This is the strategy draft as originally written, preserved
> verbatim for reference. It was subsequently **verified against the tree and adversarially
> reviewed** — several factual claims below are wrong (some understate existing assets, some
> overstate them, and one distribution assumption contradicts the repository license).
> **Read the corrections first:**
> [`2026-08-17-positioning-plan-validation-and-adversarial-review.md`](./2026-08-17-positioning-plan-validation-and-adversarial-review.md)
> — and use
> [`2026-08-17-fde-gtm-development-runbook.md`](./2026-08-17-fde-gtm-development-runbook.md)
> as the execution document, not this file.

**Status:** Draft for review
**Author's note:** This document argues for a specific repositioning. Where I am confident, I say so plainly. Where the argument depends on an assumption you have not yet tested, I flag it as an assumption rather than smuggling it in as a fact.

---

## 1. Thesis

Hexagen Monaco is currently positioned as a **generator**: declarative DDD/hexagonal specs in, production-ready codebase out. That is the least defensible framing available, because generation quality is the thing frontier models improve at fastest and most visibly. Every capability release narrows the gap between your pipeline and a competent engineer pointing an agent at a well-written architecture document.

The repositioning: **Hexagen Monaco is an architectural conformance platform.** The manifest — a declarative, versioned, machine-checkable description of bounded contexts, ports, adapters, and their permitted relationships — is the durable asset. Generation becomes one consumer of the manifest rather than the product itself.

The strategic reason this works: **as agents write more code, architectural drift accelerates.** Agents are locally competent and globally forgetful. They will happily satisfy a ticket by importing an ORM client into a domain service. The same trend that commoditizes generation manufactures demand for conformance. You want to sell the shovel that becomes more necessary as the gold rush intensifies, not the one that gets 3D-printed next quarter.

**One-line positioning:**

> Your architecture, as an executable contract — enforced in CI, and enforced on your agents.

---

## 2. Market and Positioning

### 2.1 The problem statement, in the customer's words

> "We designed this system properly three years ago. There are ADRs. Nobody knows if any of them are still true, and now four agents are committing to it daily."

That sentence is the entire market. Notice it is a _pain_ statement, not a _capability_ statement — that is what makes it sellable.

### 2.2 Ideal Customer Profile

**Primary ICP — Teams with lost intent.**
Teams that deliberately adopted an architecture (hexagonal, clean, DDD, modular monolith, layered) and have since lost fidelity to it. Signals: an ADR folder whose last meaningful entry predates the current codebase, a TypeScript monorepo of 100k+ LOC, 5–50 engineers, active agent-assisted development.

**Secondary ICP — Platform and enablement teams.**
Groups whose mandate is standards across many repos. They buy dashboards and trend lines, not single-repo checks. This is where multi-repo pricing lives.

**Tertiary ICP — Forward-deployed engineers and consultancies.**
Small population, high leverage, referral-driven. Covered in depth in §2.5.

**Anti-ICP — say no to these.**

- Teams with no architectural intent to begin with. Nothing to drift from; the tool produces noise, they churn, and they tell people it was noisy.
- Greenfield-only shops. Your value compounds with codebase age.
- Non-TypeScript stacks, until inference is proven on one language.

**Assumption flagged:** the primary ICP is large enough. You have not validated this. §6 makes validating it the first gate.

### 2.3 Message hierarchy

| Audience            | What you lead with                                                                              |
| ------------------- | ----------------------------------------------------------------------------------------------- |
| Individual engineer | "Find out what your architecture actually looks like now — one command, no config."             |
| Tech lead           | "Stop re-litigating the same boundary violation in every code review."                          |
| Platform lead       | "Architectural conformance as a CI gate across every repo you own."                             |
| Engineering exec    | "Your agents now ship most of your code. This is how you keep it from becoming unmaintainable." |
| FDE / consultant    | "Understand a client's codebase in a day. Hand back documentation that can't go stale."         |

### 2.4 Objections, and honest answers

**"dependency-cruiser and eslint boundary plugins already do this."**
Correct for structural rules, and you should say so rather than pretend otherwise. The differentiator is semantic drift (§3.3) and manifest inference (§3.2) — a linter cannot infer intent from an existing codebase, and it cannot have an opinion about whether something is _still_ a domain service.

**"We'd have to write a manifest for our whole system."**
No — the tool infers a candidate and you ratify it. If you have to ask customers to write the manifest by hand, you have already lost. This is why inference is the product.

**"Architecture linters always get disabled."**
They do, because they open with four thousand violations. Baseline ratchet (§3.4) is the answer, and it should be in the first demo, not a v2 feature.

**"Isn't this just a prompt for Claude?"**
The check is not the value; the _persistent, versioned, diffable manifest_ and its history are. A prompt has no memory of what your architecture was supposed to be in March.

### 2.5 Why this repairs the FDE angle

The original FDE pitch was weak because FDEs are not scaffolding a greenfield service — they are landing quality work fast inside someone else's mess, under time pressure, with no institutional context. Conformance maps onto that job precisely:

- **Day 1–3:** Run inference on the client codebase. Produce a bounded-context map and a drift report. This is a credibility artifact in week one instead of week six, and it is the single highest-value moment in a forward-deployed engagement.
- **During engagement:** The manifest constrains your agents, so velocity does not purchase a mess.
- **At handoff:** The manifest _is_ the documentation deliverable — executable, versioned, and unable to go stale silently.

FDEs are a referral market rather than an ad market. The pitch must be a story one engineer tells another over a beer, and "I mapped their whole architecture on day two" is that story.

### 2.6 Distribution

**The wedge is an open-source CLI that posts a PR comment.**

1. `npx hexagen infer` — zero config, reads a repo, emits a candidate manifest and a drift report. Free forever.
2. CI action — runs the check on every PR, comments with drift introduced by _this_ PR only.
3. The PR comment is the marketing. You already know from CodeRabbit how a good PR comment builds habit and spreads inside an org without a sales motion.
4. Paid tier begins where state accumulates: hosted history, multi-repo dashboards, drift trend lines, SSO, agent-constraint integration.

**The moat is history, not features.** A year of drift trend data is not portable and not reproducible by a competitor who ships the same check. This is why server-side persistence (§4.2) is not optional infrastructure — it _is_ the business model.

### 2.7 Pricing shape

| Tier       | Who                       | What                                                                     |
| ---------- | ------------------------- | ------------------------------------------------------------------------ |
| OSS / Free | Individuals, single repos | CLI, inference, PR check, local manifest                                 |
| Team       | 5–50 engineers            | Hosted history, trend lines, up to N repos, agent constraint pack        |
| Platform   | Platform orgs             | Unlimited repos, cross-repo contract checking, org-wide policy, SSO/RBAC |
| Enterprise | Regulated / large         | Audit log, self-hosted or VPC option, SLA, support                       |

Do not price on seats if you can price on repos. Repos correlate with value delivered and do not punish the customer for adding engineers — which is precisely when agent-driven drift gets worse.

---

## 3. Feature Inventory — The Product

Every feature below is listed with its purpose. If a feature cannot be given a one-sentence purpose that a customer would recognize as their own problem, it should be cut.

### 3.1 Layer 0 — Existing assets to carry forward

| Feature                | Purpose                                                                         | Status                                      |
| ---------------------- | ------------------------------------------------------------------------------- | ------------------------------------------- |
| Manifest schema        | The declarative ground truth: contexts, ports, adapters, permitted dependencies | Exists — needs versioning                   |
| DDD/hexagonal model    | The opinionated architecture vocabulary the manifest expresses                  | Exists                                      |
| Generation pipeline    | Scaffold from manifest; demoted from headline to feature                        | Exists                                      |
| Wizard UI              | Manifest authoring and ratification surface                                     | Exists — repurpose for review, not creation |
| Capability negotiation | LLM provider gating                                                             | Exists                                      |
| BYOK security spec     | Customer-controlled keys for inference runs                                     | Spec only — not deployed                    |

**Note on the wizard:** its job changes. Today it creates a manifest from nothing. Tomorrow its primary job is _ratifying an inferred manifest_ — showing a human what was detected, what is ambiguous, and letting them confirm or correct. That is a smaller, better-defined UI problem than open-ended authoring.

### 3.2 Layer 1 — Manifest inference (**the product**)

This is the hard part, and therefore the moat. Everything else in this document is downstream of it working.

| Feature                     | Purpose                                                                                                        |
| --------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Repo ingestion              | Parse a TS monorepo: workspaces, package graph, import graph, module boundaries                                |
| Context candidate detection | Propose bounded contexts from directory structure, package layout, import clustering, and naming cohesion      |
| Port/adapter classification | Identify which modules act as ports vs adapters vs domain, and flag modules that are ambiguously both          |
| Contract extraction         | Derive published contracts between candidate contexts from actual cross-boundary usage                         |
| Confidence scoring          | Every inference carries a confidence; low-confidence items go to human ratification rather than being asserted |
| Ratification UI             | Human confirms, renames, merges, or splits candidate contexts; output is the ratified manifest                 |
| Manifest versioning         | Semver'd, diffable, git-committed; architecture changes become reviewable events                               |

**Design rule:** never assert what you can offer. A wrong inference stated confidently on a stranger's repo is fatal (§7.1). Ambiguity must be surfaced as ambiguity.

### 3.3 Layer 2 — Conformance engine

**Tier 1: Structural checks.** Import-graph rules — domain imports no adapters, cross-context traffic only via published contracts, ports declared in domain and implemented outside. Table stakes. Say openly that this tier overlaps existing OSS tooling.

**Tier 2: Semantic drift.** Where you actually differentiate, because it requires judgment against declared intent:

| Check                         | Purpose                                                                              |
| ----------------------------- | ------------------------------------------------------------------------------------ |
| Infrastructure leakage        | Detect a "domain service" that has accumulated I/O, ORM, HTTP, or framework concerns |
| Aggregate boundary violations | Transactions spanning aggregates that the manifest declares independent              |
| Language leakage              | One context's ubiquitous language appearing inside another's model                   |
| Anemic drift                  | Domain models degrading into data bags with logic migrating to services              |
| Contract erosion              | Callers depending on contract internals rather than the published surface            |
| Port bypass                   | Adapters reached directly, skipping the declared port                                |

Tier 2 checks are LLM-judged against the manifest, which means they need calibration, cost control, and a false-positive budget. Treat each as a product feature with its own precision target, not a prompt.

**Tier 3: Cross-repo contract conformance.** For platform customers: does service A still honor the contract service B declares? This is the feature that justifies the Platform tier and has no meaningful OSS substitute.

### 3.4 Layer 3 — Developer experience (adoption-critical)

| Feature                 | Purpose                                                                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Baseline ratchet**    | Record existing violations as accepted debt; enforce only on changed code. **This is the difference between adoption and uninstall.** |
| Drift score             | A single number, trended over time, that a lead can put in a slide                                                                    |
| PR comment              | Report only what _this_ PR introduced, with file/line and the manifest rule it violates                                               |
| Blame attribution       | Which PR introduced a given drift, and when                                                                                           |
| Suppression with expiry | Deliberate exceptions are legitimate; silent permanent ones are not — suppressions carry a reason and a date                          |
| Fix suggestions         | Concrete remediation, not "consider refactoring"                                                                                      |

### 3.5 Layer 4 — Agent constraint (the compounding bet)

The feature that converts this from a linter into a platform. Every team running agents on a nontrivial codebase currently solves this with prose in a context file and hope.

| Feature                     | Purpose                                                                                               |
| --------------------------- | ----------------------------------------------------------------------------------------------------- |
| Manifest-as-context export  | Emit the manifest in a form agent harnesses consume, so agents know the boundaries before writing     |
| Pre-commit conformance hook | Agent-authored changes are checked before they ever reach a PR                                        |
| Agent feedback loop         | On violation, return structured, actionable feedback the agent can act on autonomously                |
| Scoped work orders          | Constrain an agent to a specific context; treat cross-boundary edits as requiring explicit escalation |
| Harness integrations        | Claude Code, Codex-style harnesses, and your own orchestration layer                                  |

### 3.6 Layer 5 — Platform infrastructure (**currently missing; blocks all revenue**)

None of this is enjoyable and all of it is mandatory. Realistic effort assumes you are working alone with heavy agent assistance.

| Feature                       | Purpose                                                                                                                                             | Rough effort |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| **Authentication / identity** | No login means no accounts, no entitlement, no revenue                                                                                              | 1–2 weeks    |
| **Server-side persistence**   | Current client-side storage has triple-write desync and no schema versioning — a correctness liability the moment a second device touches a project | 2–4 weeks    |
| **Multi-tenancy**             | Real tenant boundary with row-level isolation; retrofitting this later is brutal                                                                    | 2–3 weeks    |
| **Billing and metering**      | Plan gating, usage limits, invoicing                                                                                                                | 1–2 weeks    |
| **BYOK deployment**           | Server-side key management per your existing AES-256-GCM spec                                                                                       | 1–2 weeks    |
| Run history and telemetry     | Cost per inference, stage failure rates, observability — also your own product analytics                                                            | 1–2 weeks    |
| Job queue / long-run infra    | Inference on a large monorepo is minutes-to-hours; it cannot live in a request cycle                                                                | 1–2 weeks    |

**Honest total: roughly two to three months of un-fun work before anyone can pay you.** This is the single largest execution risk in the plan, and it is why §6 defers all of it behind a validation gate. Do not build auth for a product nobody has confirmed they want.

### 3.7 Layer 6 — Enterprise

Build only against a signed commitment, never speculatively: SSO/SAML, RBAC, audit log of manifest changes, self-hosted/VPC deployment, SLA and support, compliance posture.

---

## 4. Hexagen and the Gauntlet Loop

Two distinct relationships, and the second is the more valuable one.

### 4.1 Hexagen as a Gauntlet _subject_ — how to build the inference engine

The inference engine is an unusually good Gauntlet target, because it satisfies the pattern's hardest requirement naturally: **a concrete, inspectable, non-negotiable bar.**

| Gauntlet component | Instantiation                                                                                                                                                               |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Goal               | "Infer an architecturally accurate manifest from an arbitrary TypeScript monorepo"                                                                                          |
| Bar                | A set of real open-source repos with known, documented architectures — plus, where available, a hand-authored ground-truth manifest                                         |
| Pieces             | Context detection, port/adapter classification, contract extraction, confidence calibration, drift rules individually                                                       |
| Real artifact      | The inferred manifest, run against real repos                                                                                                                               |
| Critic judgment    | Does the inferred manifest _predict_ the codebase's actual structure? Precision and recall against ground truth, plus a blind read on whether a senior engineer would wince |

The critic here can do something rare: **falsify.** Given an inferred manifest, generate structural predictions ("nothing in `billing` imports `identity` internals") and check them against the repo. That is measurable rather than vibes, which is exactly the condition under which the Gauntlet pattern produces real gains instead of confident-sounding polish.

**Build a ground-truth corpus first.** Ten to twenty repos with hand-authored manifests. Tedious, and it is the difference between a loop that improves and a loop that drifts.

### 4.2 Hexagen as Gauntlet _infrastructure_ — the strategically important part

Recall the weakest link in the Gauntlet pattern for engineering work: _the bar must be named, fetchable, and comparable._ For visual work this is easy — screenshots. For engineering it is genuinely hard, which is why most attempts degrade into "compare against this repo," a bar the critic can only read rather than measure.

**The manifest is a machine-checkable, project-specific quality bar.** That is the missing primitive.

This gives Hexagen a role in every Gauntlet run on a codebase it governs:

| Gauntlet need         | What Hexagen supplies                                                                              |
| --------------------- | -------------------------------------------------------------------------------------------------- |
| Objective bar         | The ratified manifest — a formal statement of what "correct" means for _this_ system               |
| Critic tooling        | The conformance engine, which the critic runs rather than eyeballs                                 |
| Ratchet metric        | Drift score — an actual number that must monotonically improve, replacing "does this look better?" |
| Termination criterion | Zero new drift plus baseline reduction target reached — **a principled stop condition**            |
| Decomposition hint    | Bounded contexts are natural independent pieces, exactly what the lead agent needs to fan out over |

That last two rows deserve emphasis. The Gauntlet doc's weakest advice is "no fixed iteration count, loop until the critic declares a win" — a critic instructed to name the single largest remaining gap will _always_ name one, so runs terminate on budget exhaustion rather than quality. A drift score converts termination from an aesthetic judgment into a threshold. **That is a genuine contribution to the pattern, not a marketing line.**

And bounded contexts solving the decomposition problem is not a small thing either: the pattern requires the lead agent to split work into independently improvable pieces, and a manifest hands it a principled partition instead of an invented one.

### 4.3 Reference loop — "Gauntlet-guided remediation"

A concrete product feature, sellable on its own:

1. **Input:** ratified manifest + current drift report.
2. **Lead agent** decomposes by bounded context; each context with drift becomes a piece.
3. **Builder** remediates drift within one context.
4. **Critic** (fresh context, given only the manifest and current code) runs the conformance engine, verifies drift decreased, verifies tests still pass, and independently checks that no _new_ drift was introduced elsewhere.
5. **Ratchet:** keep the candidate only on a strict drift-score improvement with no test regressions.
6. **Terminate** at target drift score, budget ceiling, or three consecutive rounds with no improvement.

Note step 6 includes the cost ceiling and the stall detector that the original pattern lacks. Long runs are fine; unbounded runs are how you spend four figures polishing a module nobody uses.

### 4.4 What this means strategically

If the Gauntlet pattern (or anything like it) becomes standard practice for agent-driven engineering, **every such loop needs a bar, and most teams have no way to produce one.** Hexagen manufactures bars. That is a considerably better business than manufacturing scaffolds.

Treat this as a thesis to test, not a certainty. The pattern is young and its durability is unproven.

---

## 5. Where generation fits now

Do not delete it. Reframe it:

- **Manifest-conformant scaffolding** — new contexts generated already conformant, so the tool that finds drift also prevents it.
- **Proof of round-trip** — infer a manifest from a real repo, regenerate a scaffold from that manifest, and show they agree. This is a strong demo _and_ an internal correctness check on inference.
- **Onboarding path** — greenfield users start with generation and inherit conformance for free.

Generation becomes the on-ramp and the retention story. It stops being the headline.

---

## 6. Build order and gates

Each phase has an explicit kill criterion. The point of gates is to make abandoning cheap.

**Phase 0 — Validation (2–4 weeks). No infrastructure work.**
Build inference as a local CLI only, no auth, no server, no persistence beyond a local file. Run it against 5–10 repos you did not design, ideally including at least one you have access to through a client relationship. Show the output to five engineers who are not you.

> **Gate:** Do at least three of five engineers agree the inferred contexts are right and the drift found is real? If it only works on Hexagen-generated codebases, stop. You have an excellent personal tool, which is a good thing to own and a bad thing to spend a year monetizing.

**Phase 1 — The wedge (4–8 weeks).**
Ship the OSS CLI and CI action. Baseline ratchet from day one. Structural checks plus two or three high-precision semantic checks. No accounts.

> **Gate:** Are teams other than yours running it in CI a month after install, without being asked?

**Phase 2 — Platform (8–12 weeks).**
Only now build §3.6: auth, server persistence, multi-tenancy, billing, job queue. Ship hosted history and trend lines. This is when you charge money.

> **Gate:** Do teams convert to paid for history and dashboards? If the free check is enough for everyone, the moat is not where this plan assumes it is.

**Phase 3 — Agent constraint (ongoing).**
Manifest-as-context, pre-commit hooks, harness integrations, Gauntlet-guided remediation.

**Phase 4 — Enterprise.** Against signed commitments only.

---

## 7. Risks, ranked

**7.1 First-run inference quality — existential.**
You get one attempt. If the first report on a stranger's repo names bounded contexts that make a senior engineer wince, they close the tab permanently and tell colleagues it was noisy. Unrecoverable. This should govern the entire build order: over-invest in confidence scoring and ambiguity surfacing, and prefer saying "unclear" to guessing.

**7.2 ICP too narrow.**
"Teams that intended an architecture and lost it" may be a much smaller market than it feels like from inside your own practice. Phase 0 tests this. Do not skip it because you are confident.

**7.3 Semantic check precision.**
LLM-judged checks with a bad false-positive rate get disabled just as fast as noisy linters. Each Tier 2 check needs a measured precision target before it ships enabled by default. Ship them off by default until they earn it.

**7.4 Solo execution against a two-to-three-month infrastructure block.**
The unglamorous work in §3.6 is where solo projects die — not from difficulty, but from the motivation cliff between "interesting inference problem" and "implementing password reset." The gates exist partly to make sure you only pay this cost once you know it is worth paying.

**7.5 Frontier models absorbing the category.**
Plausible that agent harnesses ship native architectural memory. The hedge is the persistent, versioned, human-ratified manifest and its accumulated history — state, not capability. Capability gets absorbed; state does not.

**7.6 Opinionation.**
The tool encodes strict hexagonal DDD. Teams that hold a different architecture will experience it as a straitjacket. Decide deliberately whether the manifest schema becomes architecture-agnostic (larger market, weaker checks) or stays opinionated (smaller market, sharper product). Recommendation: stay opinionated through Phase 2, revisit after.

---

## 8. Open questions

1. Do you want this to be a business, or an excellent tool that makes your consulting work better? Both are legitimate, and they imply very different plans. The infrastructure block in §3.6 is only worth paying for the first.
2. Which real client codebase can you legally and ethically run Phase 0 inference against?
3. Is there a language after TypeScript, and does the manifest schema assume otherwise today?
4. OSS license choice — permissive drives adoption, copyleft protects the check but constrains enterprise use.
5. Does the ground-truth corpus (§4.1) get built by hand, and are you willing to spend the two weeks it takes?
