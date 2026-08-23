# ADR-0018: MVK Semantic Kernel Contracts

**Date:** 2026-04-20
**Status:** Accepted — partially superseded by ADR-0058 (2026-08-23): Q1/Q7 name `intent-compiler`, which no longer exists; the hybrid-controller model is unchanged
**Authors:** Human Architect
**Supersedes:** None (extends ADR-0005 shared kernel framing)

---

## Context

The HexaGen Monaco system requires a deterministic kernel that enforces architectural invariants at compile time and runtime. Prior to this ADR, the system had:

1. **No compiled intermediate representation.** TypeScript types alone do not guarantee runtime behavior; they can be bypassed by `as` casts, JSON parsing, or dynamic imports.

2. **No topology enforcement.** Packages imported each other freely, creating undocumented dependency cycles and layer violations.

3. **No information-state boundary.** UI components could hold semantic state (domain models, governance data) directly, violating the kernel-projection separation.

4. **No LLM ACL.** LLM inference accepted raw `LLMMessage[]` with no schema validation, meaning uncompiled prompts could bypass the compilation pipeline.

A series of architectural questions (Q1–Q13) were resolved through collaborative design. This ADR records those decisions as the foundation for all downstream ADRs (0019, 0020, 0021).

---

## Decision

### Q1 — Controller Hybrid

The system uses a **hybrid controller model**: intent is compiled by the deterministic kernel (intent-compiler), but the UI may also dispatch lightweight gestures directly. The kernel remains the authority for any mutation that changes the DomainAST.

### Q2 — Three-Layer Information-State Firewall

UI components are forbidden from holding semantic state. Enforcement is three-layered:

1. **Layer 1 (TypeScript brands):** `NoSemanticState<T>` and `AllowedProps<T>` subtract forbidden prop keys from component props at compile time.
2. **Layer 2 (ESLint):** Custom rules (`hexagen-ui/no-information-state`, `hexagen-ui/no-kernel-imports`, `hexagen-ui/no-feature-slice-imports`) block forbidden patterns at the linter level.
3. **Layer 3 (CI):** `scripts/validate-ui-boundary.sh` runs structural checks that fail CI on violation.

### Q3 — Contracts-First Architecture

Every bounded context defines its port interfaces before implementation. Ports are the compilation unit — they are the only legal cross-boundary contract. No package may depend on another package's implementation details.

### Q4 — Feature Slice Isolation

Feature slices under `apps/web/features/` may import from `@hexagen/ui`, `@hexagen/core-domain`, `@hexagen/shared`, and their own siblings. They **may not** import from other feature slices. Shared cross-slice logic belongs in a package or `@hexagen/shared`.

### Q5 — Prop and State Naming (Q5a/Q5b/Q5c)

- Q5a: Forbidden prop names (`data`, `error`, `loading`, `state`, `model`, `status`) are blocked at Layer 1 and Layer 2.
- Q5b: `useState` names must not carry semantic meaning (no `useState<Model>`, no `useState<DomainAST>`).
- Q5c: Import restrictions — `@hexagen/ui` and feature slices may only import from allowed packages, enforced at Layer 2 and Layer 3.

### Q6 — Path and Manifest Versioning

Packages are resolved via `tsconfig.paths` (`@hexagen/*` → `packages/*/src/index.ts`) for development and via `package.json` `exports` for production. The manifest version is incremented on every compilation pass.

### Q7 — Three-Plane Topology

The system is organized into four planes:

- **kernel** (deterministic): core-domain, intent-compiler, layout-engine, ui-projection-compiler, transaction-system, prompt-compiler, architectural-enforcement, wizard-orchestration, monaco-orchestration
- **projection** (visual): ui, visualization, web-driver
- **probabilistic** (LLM): local-llm, agentic-interaction, reconciliation-engine, mcp-server
- **infrastructure**: persistence, messaging, external-integration, deployment, sync, runtime
- **shared-kernel**: shared, core-domain

Projection and probabilistic planes may not import from each other. All cross-plane communication flows through the kernel.

## Amendment — 2026-08-17: `intent-compiler` is no longer a living kernel package

Q1 and Q7 name `intent-compiler` as the deterministic compiler and a kernel-plane member. ADR-0058 deleted that package (active, implemented, zero live consumers). The hybrid-controller model in Q1 is unchanged — the kernel remains the authority for DomainAST mutations — but the named compiler is gone. Q7's kernel list should be read without `intent-compiler`. Do not restore the package to satisfy this list.

### Q8 — LLM ACL

All LLM inputs must pass through `prompt-compiler`'s `SendStructuredRequestPort`. Raw `LLMMessage[]` construction outside the compilation pipeline is forbidden. The `WebLLMAdapter` implements `SendStructuredRequestPort` and validates responses against Zod schemas.

### Q9 — Compilation Pass Atomicity

Each compilation pass (e.g., `cp-2026-04-20-01`) is an atomic unit: spec, drift report, and TypeScript implementation are co-emitted. A pass either lands completely or not at all.

### Q10 — DomainCommand Shape

`DomainCommand` variants carry only `type` and `payload`. Intent lineage is carried by the separate `IntentLineage` shape, not by command-level `lineageId`/`timestamp` fields.

### Q11 — IntentLineage Separation

`IntentLineage` is the authoritative provenance record. It carries `lineageId`, `timestamp`, and chain-of-custody metadata. Commands reference lineage by `Identifier`, not by embedding lineage fields.

### Q12 — Co-Emission Discipline

When a spec changes, the TypeScript implementation and drift report must be updated in the same commit. No spec-only or code-only changes to MVK contracts.

### Q13 — Q13 Resolution

Q13 ("Should `runtime` be a shared kernel?") is resolved: `runtime` provides type guards and generators for MVK contracts and is classified as `shared-kernel`. It must be registered in `layer-rules.yaml` under `shared_kernels`.

---

## Consequences

### Positive

- UI cannot hold semantic state (firewall)
- Kernel sovereignty is established — deterministic code is never overridden by LLM output
- Three-plane topology prevents projection↔probabilistic coupling
- Contracts-first ensures testability and boundary enforcement
- MVK spec is canonical; TypeScript is the structural validator

### Negative

- Dual-truth period (manifest + MVK) until kernel packages reach steady state
- Three-layer firewall adds tooling overhead (custom ESLint plugin, CI shell script)
- Vertical-slice migration requires one-time feature folder reshuffle
- Breaking change for any code that directly constructs `LLMMessage[]` — must migrate to `SendStructuredRequestPort`

---

## Co-Emitted Artifacts

- `.architecture/mvk/drift-report-v1.md`
- `.architecture/mvk/spec-v1.md`
- `packages/core-domain/src/mvk/v1/index.ts`

## Compilation Pass

- Pass ID: `cp-2026-04-20-01`
- Snapshot SHA: `b061ccdb2c4b989a74fcd45130534e89c0926a04`

---

## Related

- ADR 0005: Shared Kernel Type Migration (this ADR extends its framing)
- ADR 0019: Execution DAG Architecture (depends on this ADR's topology)
- ADR 0020: Transaction Lifecycle & Speculative State Semantics (depends on this ADR via 0019)
- ADR 0021: Prompt Compilation & LLM ACL Enforcement (depends on this ADR's firewall and ACL)
