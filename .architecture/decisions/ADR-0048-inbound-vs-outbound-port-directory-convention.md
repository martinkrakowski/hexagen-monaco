# ADR-0048: Inbound vs Outbound Port Directory Convention

**Date:** 2026-08-14
**Status:** Proposed
**Type:** Architecture
**Amends:** ADR-0010-mcp-server-architecture.md (retains stdio transport, dynamic SDK loading, dry-run-by-default, and the read-only-resources/write-tools split; supersedes its Decision §3 "MCP request handlers delegate to application use cases, which depend on ports" wording for the tool/resource path — handlers must depend on inbound port interfaces, not concrete `*UseCase` classes)
**Relates to:** ADR-0043 (linter derives cross-context import legality from manifest `depends_on`); remediation-plan items 6.4 (HEX-018) and 6.5 (HEX-019); security-package fate governed separately by remediation-plan item 6.6 / ADR item 0.3 (candidate C3)

## Context

The repository uses the hexagonal `ports/in` (driving/inbound — a driver such as
UI/HTTP/CLI calls the use case, which _implements_ the inbound port) versus
`ports/out` (driven/outbound — the use case calls a port that an infrastructure
adapter _implements_) split. Two current-tree realities violate that split, and
the convention it is measured against is **not documented where the candidate
brief claimed it was**.

### The convention is not defined in `workspace.config.yaml`

ADR candidate C2 attributed the "inbound = driving; outbound = driven" convention
to "workspace.config.yaml stubs." That attribution is wrong and this ADR corrects
it. `.architecture/workspace.config.yaml` references the two folder names only
twice, and in neither place does it define driving-vs-driven semantics:

1. As **sync layer subfolders** — `generator.sync.layers.application.subfolders`
   lists `ports/in`, `ports/out`, `use-cases`
   (`.architecture/workspace.config.yaml:451-453`). This is a folder-emission list,
   not a semantic rule.
2. As **disabled stub templates** — `generator.sync.stubs.templates.inPort`
   (`.architecture/workspace.config.yaml:488-490`) and `outPort`
   (`.architecture/workspace.config.yaml:491-493`) carry only the generic comments
   `// @generated in-port stub — edit freely` and
   `// @generated out-port stub — edit freely`, and the whole `stubs` block is
   `enabled: false` (`.architecture/workspace.config.yaml:486`). Both stub bodies
   are additionally identical (`export interface {name}Port {}`), so the templates
   themselves encode no directional distinction.

A grep of the file for `driving`, `driven`, `inbound`, `outbound`, or
`adapter implements` returns nothing. The convention is therefore **currently
unwritten** — it lives only in developer habit and in the ORCHESTRATOR Domain/Adapter
worker scope split (`.agents/ORCHESTRATOR.md:115` domain scope = "port interfaces";
`.agents/ORCHESTRATOR.md:136` infrastructure scope = "adapters"). AGENTS.md does not
document it either (its only nearby hit is an unrelated "event-driven" at
`AGENTS.md:86`). This ADR is the canonical statement of the convention.

### HEX-018 — driven ports parked under `ports/in`

Five packages place ports that are demonstrably **driven** (an infrastructure
adapter implements them) under `application/ports/in`, several with comments that
state the inversion in plain language:

- `packages/security/src/application/ports/in/secret-scanner.port.ts:10`
  (`ISecretScanner`) — implemented by
  `packages/security/src/infrastructure/adapters/tuffle-hog.adapter.ts:10`
  (`TuffleHogAdapter implements ISecretScanner`). security has **no** `ports/out`
  folder; its sole port is the misplaced driven one.
- `packages/governance/src/application/ports/in/policy-evaluator.port.ts:11`
  (`IPolicyEvaluator`) — implemented by
  `packages/governance/src/infrastructure/adapters/open-policy.adapter.ts:11`
  (`OpenPolicyAdapter implements IPolicyEvaluator`). governance also has no
  `ports/out` folder.
- monaco-orchestration, wizard-orchestration, and project-configuration carry
  `ports/in` files whose own doc comments say infrastructure adapters implement the
  contract — the definition of an **outbound** port
  (`packages/monaco-orchestration/src/application/ports/in/project-current-buffer-state.port.ts:4-5`
  "Infrastructure adapters (…) implement this contract";
  `packages/wizard-orchestration/src/application/ports/in/process-intent.port.ts:4`
  "Infrastructure adapters (…) implement this";
  `packages/project-configuration/src/application/ports/in/generate-project.port.ts:7`
  "Infrastructure adapter (…) implements this"). Unlike security and governance,
  these three packages already have a populated `application/ports/out` folder, so
  the fix is a relocation into an existing home rather than a new folder.

### HEX-019 — mcp-server tools depend on concrete use cases, not inbound ports

The mcp-server tool and resource adapters depend directly on concrete
`*UseCase` classes rather than on inbound port interfaces. The tool handler
`deps` bag is typed with 26 concrete use-case classes, imported across
`packages/mcp-server/src/infrastructure/adapters/mcp-server.types.ts:1-26`, and
each tool-family adapter invokes the concrete instance — e.g.
`deps.auditBoundariesToolUseCase.execute(...)`
(`packages/mcp-server/src/infrastructure/adapters/tools/audit-boundaries.ts:15`).
The package's only inbound port is the lifecycle port
`MCPServerPort { start(); stop(); }`
(`packages/mcp-server/src/application/ports/in/mcp-server.port.ts:1-4`), consumed
by `mcp-server.adapter.ts:1` — there is no per-tool inbound port.

### Why ADR-0010 must be amended, not silently overridden

ADR-0010 (Accepted, 2026-04-07) is the standing decision for mcp-server. Its
Decision §3 states "MCP request handlers delegate to application use cases, which
depend on ports. Adapters implement the ports."
(`.architecture/decisions/ADR-0010-mcp-server-architecture.md:26`), and its
package-structure sketch declares `use-cases/ # 8 use cases (3 resources, 5 tools)`
and `application/ports/out/ # 4 port interfaces` with **no** `ports/in`
(`.architecture/decisions/ADR-0010-mcp-server-architecture.md:72-73`). Two things
have since drifted from that ADR in the current tree, so the amendment must be
explicit:

- The tree now has **9** `ports/out` interface files
  (`packages/mcp-server/src/application/ports/out/`, excluding the `index.ts`
  barrel) and **26** use cases (19 tool + 7 resource,
  `packages/mcp-server/src/application/use-cases/*.use-case.ts`), not the 4 ports /
  8 use cases ADR-0010 described.
- ADR-0010's "handlers delegate to use cases" is precisely the pattern HEX-019
  flags: handlers bind to concrete use-case classes. Fixing HEX-019 changes the
  inbound wiring ADR-0010 blessed, so ADR-0010's §3 handler-wiring clause is
  amended here; everything else in ADR-0010 (stdio transport, dynamic SDK loading,
  dry-run-by-default, resources-read/tools-write) is **retained unchanged**.

## Decision

1. **Adopt and document the convention.** `ports/in` = **driving/inbound**: the
   use case implements the inbound port; a driver (UI route, CLI, MCP handler)
   depends on the port. `ports/out` = **driven/outbound**: the use case depends on
   the port; an infrastructure adapter implements it. The rule of thumb: **if an
   infrastructure adapter `implements` the interface, it is an outbound port and
   belongs in `ports/out`.** This ADR is the canonical source; the misattribution
   to `workspace.config.yaml` in candidate C2 is void.

2. **HEX-018 — relocate misplaced driven ports.** Move the driven ports currently
   under `application/ports/in` to `application/ports/out` in governance,
   monaco-orchestration, wizard-orchestration, and project-configuration; security's
   equivalent move is folded into the disposition of the security package's fate
   (remediation-plan item 6.6 / ADR item 0.3, candidate C3) and lands only if that
   decision keeps the package. Update the doc comments that read "Infrastructure
   adapters … implement this contract" so folder and comment agree. Genuine inbound
   ports (the use case implements them, a driver calls them) stay in `ports/in`.
   This is executed one package per PR (remediation-plan item 6.4).

3. **HEX-019 — mcp-server tools bind to inbound ports.** Introduce a per-tool /
   per-tool-family inbound port that each use case implements, and type the handler
   `deps` bag against those port interfaces instead of the concrete `*UseCase`
   classes. The existing lifecycle `MCPServerPort` stays as-is. Landed one PR per
   tool family (remediation-plan item 6.5), sequenced after item 6.4.

4. **Amend ADR-0010.** ADR-0010's Decision §3 ("handlers delegate to use cases")
   is superseded **only** for the inbound-wiring path: mcp-server handlers depend on
   inbound port interfaces, not concrete use-case classes. ADR-0010's other
   decisions are retained verbatim.

5. **Fix the generator so it stops implying the wrong thing.** The sync generator's
   `ports/in` stub emission and comments must not describe an inbound port as
   "adapter implements this." The generator emits an outbound stub under `ports/out`
   for driven ports and an inbound stub under `ports/in` for driving ports, with
   comments matching this ADR. The `workspace.config.yaml` stub templates
   (`.architecture/workspace.config.yaml:488-493`) gain direction-correct comment
   text (they are currently identical for `inPort`/`outPort`).

## Consequences

- **Folder moves across up to five packages plus mcp-server rewiring**, each as its
  own PR (remediation-plan 6.4 per package, 6.5 per tool family). governance gains
  its first `ports/out` folder; monaco-orchestration, wizard-orchestration, and
  project-configuration already have one; security's move is gated on the item-6.6 /
  ADR-0.3 keep-or-fold decision.
- **ADR-0010 is now historically accurate about mcp-server's inbound wiring.** Its
  drifted package sketch (4 ports / 8 use cases) is noted here as superseded by the
  current 9 ports / 26 use cases; future readers are pointed from ADR-0010 to this
  ADR for the inbound convention.
- **The convention is enforceable.** With the definition written down, the
  Wave-2 arch-linter work (remediation-plan 2.2, ADR item 0.8) can add a layer rule
  that flags a `ports/in` interface which an infrastructure adapter `implements` —
  turning HEX-018 into a CI-catchable regression instead of habit.
- **Generated projects inherit the corrected doctrine.** Because the sync generator
  stubs and their comments are the template every scaffolded project starts from,
  fixing the generator (Decision 5) means new projects emit direction-correct
  `ports/in` / `ports/out` folders and comments from day one — the twice-bitten
  "sync self-regen and external modes both need gating" trap applies, so both
  emission paths must be updated together.
- **No behavior change at runtime.** These are structural/type-level moves and
  wiring changes; adapters keep implementing the same contracts and use cases keep
  the same signatures. The risk is import-path churn, contained by the one-package-
  per-PR sequencing.
- **Downstream unblock.** Item 6.5 (HEX-019) depends on this ADR's amendment of
  ADR-0010; HEX-015 (use case implements an inbound port _and_ delegates I/O through
  an outbound port) is only expressible once the two directions have distinct,
  documented homes.
