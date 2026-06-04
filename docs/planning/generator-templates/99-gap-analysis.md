# Generator Templates — Gap Analysis & Test-Scaffolding Decision

**Date:** 2026-06-04
**Status:** Reconnaissance for the template-content expansion + the test-scaffolding policy decision (the gate before building net-new templates like the MCP family).
**Source:** inventory of `packages/template-engine/templates/` (44 real templates, excl. `__example__`) against the numbered plan docs + `JOB-INDEX.md`, plus a depth scan (emitted files / tests / env / error-handling per template).

## Gap buckets

### Planned-but-missing (design doc exists, no template implementation)

- **`mcp-server` + `mcp-server-http`** — fully designed in [`18-mcp-server.md`](./18-mcp-server.md) and catalogued in the JOB-INDEX, but **no `templates/` dir exists** for either (status header: _"Planned — design only, no manifest yet"_). This is the substantive build gap. Architecturally distinct: per the JOB-INDEX context-mapping, `mcp-server` is the **only** template that's its _own_ bounded context (an inbound/driving adapter that exposes the app's use-cases as MCP tools); `-http` is its transport+auth addon.

### Implemented-but-thin (template exists, happy-path only)

- **Systemic: 0 of 44 templates emit test scaffolding** for the code they generate. (The "emit-shape tests" in the JOB-INDEX are the _engine's_ tests that a template emits the right files — not tests handed to the user.) This is a **cross-template policy question**, not a per-template gap — see the decision below.
- Otherwise, thinness is **intentional**, not a gap: env wiring is declared on every template; error-handling is rich where it matters (`langgraph`, `llm-adapter`, `supabase`, `error-handling`, the auth providers); and the slim templates are addons-over-a-core by design — the 13 Adobe service add-ons (3 files each) lean on `adobe-firefly-core` (14 files), and `supabase-auth` / `llm-adapter-bedrock` are thin layers over their bases.

### Implemented-but-undocumented (template exists, no design doc — drift)

- **`eslint-no-console`** — in the JOB-INDEX catalog but has **no design doc** (0 hits): a one-file flat-config fragment added ad-hoc, design intent never recorded. The only real drift found. (The candidates we suspected — `nextauth` / `clerk` / `better-auth` — are well-documented, 5–6 docs each.) A short stub design doc can wait; the gap is recorded here so it isn't lost.

## Decision — test scaffolding

Templates scaffold **working code by default** and stay slim; test scaffolding is **opt-in** via a `--with-tests` flag at materialization time. The flag is **global** (one switch per generation) but its effect is **per-template**: each template authors its test scaffolds incrementally, and the flag honors whatever has been authored — so the policy rolls out template-by-template rather than as a global big-bang. **Rejected:** (a) always-emit tests, which doubles/triples template file count and bakes the template's test-structure opinions into projects that already have a test setup; (b) the status-quo no-tests, which leaves the highly regular, template-able infrastructure-layer test patterns — a BullMQ or Supabase adapter test is identical every time — as repeated manual work. **Constraint:** emitted tests must target the **generated project's own test runner**, not import a framework the project doesn't have. To make this a _mechanism_ and not just a principle: the assumed runner is a **declared property** of each test-authoring template (or inherited from the core scaffold's declared runner) — **never inferred**. A template author's concrete obligation is therefore "declare the runner you target, and match it," and `--with-tests` can refuse / warn when a template's declared runner doesn't match the project's.

## Sequencing implication

Settle the policy above first, **then** build the MCP family — authoring its test scaffolds from the start so it ships `--with-tests`-ready on day one, rather than retrofitting after every later template adopts the policy.

> Out of scope here but noted from the JOB-INDEX status table: the **CLI** `hexagen new --add` path is still ⏳ pending — separate from the **web** materialization shipped in #211–#223. Where the `--with-tests` flag surfaces (CLI flag vs. a web generation toggle / wizard option) is an implementation detail for the policy's first build.
