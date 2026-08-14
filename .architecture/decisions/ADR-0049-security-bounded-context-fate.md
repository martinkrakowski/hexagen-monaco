# ADR-0049: Security Bounded-Context Fate — Register-and-Wire or Fold

**Date:** 2026-08-14
**Status:** Proposed
**Type:** Architecture
**Relates to:** HEX-009, MOD-005, HEX-018 (the `ports/in` misfiling this package exhibits); ADR-0043 (linter honors `depends_on` — the enforcement surface a registered context inherits); remediation-plan items 3.3 (MOD-005 leg), 6.6 (structural fate), 6.4(e) (the `ports/in → ports/out` move, conditional on keeping the package)

## Context

`@hexagen/security` is a fully-formed hexagonal package on disk that no in-repo
code consumes and no governance artifact knows about. It ships a driven port,
an adapter, an application use-case, and a domain value-object pair:

- **Port** `ISecretScanner` — `scan(rawConfig: string): Promise<Result<SanitizedConfig, SecretLeakError>>`
  (`packages/security/src/application/ports/in/secret-scanner.port.ts:10-16`). It is
  filed under `application/ports/in/` but is a **driven** contract — the adapter
  implements it and the use-case injects it — so it is on the wrong side of the
  in/out convention (the HEX-018 class; a keep decision inherits the 6.4(e)
  `ports/in → ports/out` move).
- **Adapter** `TuffleHogAdapter implements ISecretScanner`
  (`packages/security/src/infrastructure/adapters/tuffle-hog.adapter.ts:10`) — despite
  the name it is a **pure-regex** matcher over six hardcoded patterns
  (`tuffle-hog.adapter.ts:11-18`) with no TruffleHog CLI/dependency
  (`packages/security/package.json:12-14` lists only `@hexagen/shared` as a runtime
  dependency), and its redaction is stubbed ("For now, just return the dirty config",
  `tuffle-hog.adapter.ts:33-45`). It is a scaffold, not a working scanner.
- **Use-case** `SecretSanitizationUseCase`
  (`packages/security/src/application/use-cases/secret-sanitization.use-case.ts:8-16`),
  which merely forwards to the injected scanner.
- **Domain VOs** `SanitizedConfig` / `SecretLeakError` plus
  `createCleanConfig`/`createDirtyConfig`
  (`packages/security/src/domain/value-objects/sanitized-config.ts:1-39`), the only
  symbols the package barrel re-exports (`packages/security/src/index.ts:1-9`).

Three facts make the package **invisible to the architecture**:

1. **Not a registered bounded context.** `.architecture/manifest.yaml` lists 37
   contexts under `bounded_contexts` (`grep -c '^  - name:' .architecture/manifest.yaml`
   → 37) and the string `security` appears nowhere in it
   (`grep -i security .architecture/manifest.yaml` → no match). There is no
   `packages/security/context.yaml` and no `.architecture/contexts/**/security/context.yaml`
   (`find .architecture/contexts -iname '*security*'` → empty). The port-ownership
   map and `yarn lint:arch` therefore cannot see the scanner at all (HEX-009).
2. **Not in the TypeScript project graph.** `security` is absent from
   `tsconfig.base.json` (`grep -i security tsconfig.base.json` → no match). It is
   nonetheless a workspace member via the `packages/*` glob
   (root `package.json:9-13` declares `workspaces: ["apps/*","packages/*","tools/*"]`),
   so it installs and builds in isolation but participates in no project-references
   typecheck.
3. **Zero in-repo consumers.** No source imports `@hexagen/security`,
   `ISecretScanner`, `TuffleHogAdapter`, or `SecretSanitizationUseCase` anywhere
   outside the package itself (repo-wide grep excluding `node_modules`, `dist`,
   and `packages/security/` returns only the review's own `findings.json` /
   `inventory.json` docs, not code).

Separately, the package's `tsconfig.json` uses `module`/`moduleResolution: "Node16"`
and does **not** extend the base (`packages/security/tsconfig.json:4-5`), while the
workspace floor is `moduleResolution: "bundler"` / `module: "ESNext"`
(`tsconfig.base.json:9-10`), and `main` points at TS source `src/index.ts`
(`packages/security/package.json:5`). This is **MOD-005**. The audit
(`docs/planning/2026-08-13-architecture-review/AUDIT-2026-08-14.md:108`) lowered
MOD-005 to **low** and refuted its "drop `.js` specifiers" recommendation: the
`.js` import specifiers (e.g. `secret-scanner.port.ts:2-3`) are **load-bearing**
for a Node-ESM `dist`, not drift. The sound residue is: extend base, point
`main`/`types` at `dist`, keep the `.js` specifiers.

This ADR must decide the package's **structural fate** because two downstream
items branch on it and cannot be sequenced until it is settled:

- **Remediation-plan item 3.3** ships the MOD-005 tsconfig cleanup **only if this
  ADR keeps the package** (plan Wave 3, 3.3: "security tsconfig (extend base, dist
  main/types — **keep** `.js` specifiers …)" with the note "MOD-005 only if ADR 0.3
  keeps the package").
- **Remediation-plan item 6.6** (HEX-009, MOD-005) is literally "Security package
  fate per ADR 0.3 (register+wire or fold)" — it executes whichever branch this ADR
  selects — and **6.4(e)** (the `ports/in → ports/out` move) exists "(+ (e) security
  if ADR 0.3 keeps it)".

An unwired package advertising a fake hexagon (a scaffold adapter with a
misleading name and stubbed redaction, validated by no manifest) is a governance
liability: the manifest is the source of truth for what the system does, and this
package is a decision the codebase has been deferring, not making. This ADR
forces the decision rather than leaving a fifth invisible package.

## Decision

Both options below are **live**; a human selects one by merging this ADR with the
chosen branch struck through or annotated. The trade-offs are stated so the
choice turns on one fact — **is secret scanning about to be called from
generation/sync/wizard within the next planning horizon?**

### Option A — Register `security` as a supporting context and wire it

Add it to the architecture as a first-class supporting/infrastructure context and
give it a real caller:

1. Author `.architecture/contexts/**/security/context.yaml` declaring the driven
   port `ISecretScanner` as **outbound** (`ports/out`), the `TuffleHogAdapter`
   implementer, and the `SecretSanitizationUseCase` inbound use-case; add the
   `- name: security` entry to `.architecture/manifest.yaml` `bounded_contexts`
   (matching the `name` / `type` / `plane` / `status` / `file:` shape of the
   existing 37, e.g. the `core-domain` entry at `.architecture/manifest.yaml:37-41`).
   **Primary-reserved** per the orchestrator rules — worker-drafted YAML,
   Primary-applied.
2. Move the port from `application/ports/in/` to `ports/out/` (the HEX-018 /
   6.4(e) move) so its filed direction matches its driven role.
3. Add the `tsconfig.base.json` project reference and apply the MOD-005 cleanup
   (extend base, `main`/`types` → `dist`, **keep** the `.js` specifiers).
4. Wire at least one real consumer (sync / project-generation / wizard) so the
   context is not registered-but-still-dead — e.g. scan generated `.env`/config
   scaffolds before export.

**Choose A only if** secret scanning is genuinely imminent. Registering without
wiring (steps 1-3 without step 4) is the worst outcome: it makes the linter
validate a hexagon that still has zero consumers, and hardens the misleading
`TuffleHogAdapter` scaffold into the manifest.

### Option B — Fold the scanner and delete the package (recommended pending the imminence fact)

Retire `@hexagen/security` as an independent context:

1. Move `SanitizedConfig`/`SecretLeakError` and, if the port is retained, the
   scanner contract into an existing owner. `@hexagen/governance` is the natural
   home (it is a registered active context — `.architecture/manifest.yaml:102` —
   that already owns policy evaluation and has the layer scaffolding:
   `packages/governance/src/{domain,application/ports/in,infrastructure/adapters}`
   all exist), which keeps a security concern inside a registered context. A
   `@hexagen/shared` shared-kernel port is the alternative only if the contract is
   truly generic (it is not — it is a scanning policy, not a primitive).
2. Delete `packages/security/` (a workspace member, so removal drops it from the
   `packages/*` glob automatically; no manifest entry to remove since it was never
   registered).
3. MOD-005 dissolves — there is no tsconfig to reconcile.

**Choose B if** scanning will stay unused for another planning horizon. Per the
candidate's framing (`docs/planning/2026-08-13-architecture-review/ADR-CANDIDATES.md:94-96`):
"an unwired package with a fake hexagon is worse than no package" (the candidate
phrases the trigger as "if it will stay unused for another quarter"). Given the
audit's overall posture — the `security` scanner is a **scaffold** (stubbed
redaction, misnamed regex adapter, zero consumers) and no wiring is scheduled in
any current wave — B is the **recommended default**. It is the same
dead-scaffold disposition Wave 4 applies to the other unwired hexagons
(external-integration's dead auth hexagon, plan item 4.4).

### What this ADR does **not** decide

It does not change the MOD-005 **`.js`-specifier** convention (kept under both
options; the audit refuted removal) and does not, by itself, execute either
branch — 6.6 does, gated on this acceptance. If Option A is chosen, 3.3's
MOD-005 leg becomes in-scope; if Option B, 3.3 drops that leg entirely and
6.4(e) is dropped.

## Consequences

- **Downstream items unblock deterministically.** 6.6 executes the selected
  branch; 3.3's MOD-005 leg and 6.4(e) are in-scope **iff** Option A is chosen,
  and are struck from the plan iff Option B is chosen. No item proceeds until this
  ADR is merged.
- **Manifest honesty either way.** After acceptance the manifest either lists
  `security` (A) or the codebase no longer carries an unregistered hexagon (B).
  The linter's port-ownership map stops having a blind spot; `yarn lint:arch`
  either sees a real context or sees no orphan.
- **Option A cost:** one `context.yaml`, one `bounded_contexts` entry, one
  `tsconfig.base.json` reference, `package_rules`/`depends_on` linter entries
  (which then bind under ADR-0043), the port-direction move, **and** a genuine
  consumer — otherwise the registration is theatre. The `TuffleHogAdapter` name
  and stubbed redaction should be corrected as part of wiring so the manifest does
  not bless a scaffold.
- **Option B cost:** a move + delete; governance (or shared) absorbs the VOs;
  MOD-005 disappears; the misleading adapter scaffold is removed rather than
  hardened.
- **Generated projects inherit the doctrine.** The published sync generator and
  arch-linter should not scaffold a bounded context that has no consumer and no
  manifest entry. Whichever way this resolves, the rule downstream projects
  inherit is: **a hexagonal package is either a registered, wired context or it is
  not created** — no invisible fifth-package scaffolds. This aligns with the
  Wave-2 enforcement ratchet, which (once real) would flag exactly this
  unregistered-package class.
- **No supersession.** No prior ADR governs `@hexagen/security`; this is the
  first decision of record for the package.
