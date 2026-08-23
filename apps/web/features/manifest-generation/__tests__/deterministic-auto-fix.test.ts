import { describe, it, expect } from "vitest";

import { runDeterministicAutoFix } from "../deterministic-auto-fix";

/**
 * Characterisation tests for the browser repair loop, written to the CURRENT
 * behaviour rather than to a desired one — the repair-telemetry plan's P0 risk
 * row asks for exactly this before anything about the fixer is refactored.
 *
 * Two properties are asserted, and they pull in opposite directions on purpose:
 *
 * 1. The applied fixes and the settled YAML are what they always were. If a
 *    change to the loop moved either, the baseline ADR-0067 gates on would be
 *    measuring different behaviour from the one that shipped.
 * 2. The fall-through set is complete, and is taken from the SETTLED document —
 *    not from the first pass, which stops at its first fix.
 *
 * jest-dom is not registered by apps/web/vitest.setup.ts, so assertions here
 * stay on plain vitest matchers.
 */

/** Titles of the fall-through entries, in report order. */
function fallThroughTitles(
  outcome: ReturnType<typeof runDeterministicAutoFix>,
): string[] {
  return outcome.fellThrough.map((entry) => entry.violation.title);
}

/**
 * A context whose outbound ports collide on their adapter base.
 *
 * `StoragePort` claims `StorageAdapter` (first-match-wins in the view parser),
 * so the second `StoragePort` is reported unconnected — and the fixer then
 * REFUSES to synthesize, because its exact-base skip sees `Storage` already
 * present among the adapters. Allow-listed by `canAutoFix`, untouched by
 * `applyDeterministicFix`: the "permanently unfixable" class the parser's own
 * first-match-wins comment describes, and precisely the residue a trained
 * fixer would target.
 */
const COLLIDING_PORTS = `    layers:
      application:
        ports:
          in: [StoreFilePort]
          out: [StoragePort, StoragePort]
      infrastructure:
        adapters: [StorageAdapter]
`;

const SETTLED_WITH_RESIDUE = `system: acme
scope: internal
architecture: modular-monolith
bounded_contexts:
  - name: files
    type: core
    description: File storage.
${COLLIDING_PORTS}`;

/** Same document, but `scope:` missing so the first pass has a fix to make. */
const NEEDS_ONE_FIX_THEN_RESIDUE = `system: acme
architecture: modular-monolith
bounded_contexts:
  - name: files
    type: core
    description: File storage.
${COLLIDING_PORTS}`;

describe("runDeterministicAutoFix — what it fixes", () => {
  it("settles a document missing scope and architecture, applying both fixes", () => {
    const outcome = runDeterministicAutoFix("system: acme\n");

    expect(outcome.appliedTitles).toEqual([
      "Scope Missing",
      "Architecture Missing",
    ]);
    expect(outcome.yaml).toMatch(/scope: internal/);
    expect(outcome.yaml).toMatch(/architecture: modular-monolith/);
    // Two fixes, each ending its own pass, plus the terminal no-change pass.
    expect(outcome.rounds).toBe(3);
    expect(outcome.fellThrough.length).toBe(0);
  });

  it("leaves a document it cannot improve byte-identical", () => {
    const outcome = runDeterministicAutoFix(SETTLED_WITH_RESIDUE);

    expect(outcome.yaml).toBe(SETTLED_WITH_RESIDUE);
    expect(outcome.appliedTitles).toEqual([]);
    expect(outcome.rounds).toBe(1);
  });

  it("is idempotent — re-running on its own output changes nothing", () => {
    const once = runDeterministicAutoFix(NEEDS_ONE_FIX_THEN_RESIDUE);
    const twice = runDeterministicAutoFix(once.yaml);

    expect(twice.yaml).toBe(once.yaml);
    expect(twice.appliedTitles).toEqual([]);
    expect(twice.rounds).toBe(1);
    // The residue is a property of the settled document, so it survives.
    expect(fallThroughTitles(twice)).toEqual(fallThroughTitles(once));
  });
});

describe("runDeterministicAutoFix — the fall-through set", () => {
  it("records a violation the allow-list does not cover", () => {
    // An unterminated flow collection: the parser reports one `Invalid YAML`
    // item and nothing else, and `canAutoFix` refuses it explicitly.
    const outcome = runDeterministicAutoFix("foo: [1, 2");

    expect(outcome.appliedTitles).toEqual([]);
    expect(outcome.fellThrough.length).toBe(1);
    expect(outcome.fellThrough[0].violation.title).toBe("Invalid YAML");
    expect(outcome.fellThrough[0].reason).toBe("not-allow-listed");
  });

  // The `fix-made-no-change` reason is implemented and returned, but NOT
  // asserted here, because no fixture I could build reaches it.
  //
  // Every candidate turned out to be repaired rather than refused: a duplicate
  // `out:` port is not a violation at all, a port with no adapter is fixed by
  // the Zero Adapters rule, unconnected ports are fixed, and a shared-kernel
  // with no ports raises nothing for the exemption to decline. That was worth
  // finding out: the original version of this test asserted a port collision
  // fell through, and it did not -- the document it used validates clean.
  //
  // So the honest state is that the residue observed today is entirely
  // `not-allow-listed`, and `fix-made-no-change` is an unexercised branch. It
  // is left in place rather than removed because P2 wires this to real
  // documents, where a rule that runs and refuses is exactly the case the
  // baseline needs to distinguish. Deleting it now would make the telemetry
  // unable to express the distinction the moment it appears.

  it("reports the residue of the SETTLED document, not of the first pass", () => {
    // Pass 1 fixes `Scope Missing`; pass 2 walks every item against the
    // repaired document. The residue reported is the terminal pass's, so a
    // violation that WAS repaired never appears as residue.
    const outcome = runDeterministicAutoFix(NEEDS_ONE_FIX_THEN_RESIDUE);

    expect(outcome.appliedTitles).toContain("Scope Missing");
    expect(fallThroughTitles(outcome)).not.toContain("Scope Missing");
  });

  it("never reports an item the parser passed", () => {
    const outcome = runDeterministicAutoFix(NEEDS_ONE_FIX_THEN_RESIDUE);

    for (const entry of outcome.fellThrough) {
      expect(entry.violation.status).not.toBe("pass");
    }
  });
});
