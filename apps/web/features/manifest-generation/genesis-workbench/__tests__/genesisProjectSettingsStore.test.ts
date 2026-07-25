// crypto is a getter-only global in Node, so stub it via vi.stubGlobal (a plain
// `global.crypto =` throws "has only a getter") — and BEFORE the imports below:
// emptyFormValues seeds a bounded-context id via crypto.randomUUID at module
// eval, and createBlankProjectConfig mints one per seed call.
let uuidCounter = 0;
vi.stubGlobal("crypto", {
  randomUUID: () => `uuid-${(uuidCounter += 1)}`,
} as unknown as Crypto);

import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { deriveWorkspaceName } from "@hexagen/manifest-generation";
import {
  clearGenesisFormValues,
  loadEditedGenesisGovernance,
  loadGenesisFormValues,
  rekeyGenesisFormValues,
  saveGenesisFormValues,
  seedGenesisFormValues,
} from "../genesisProjectSettingsStore";

// Module-scoped store: reset between tests or snapshots bleed across them.
beforeEach(() => {
  clearGenesisFormValues();
});

describe("genesisProjectSettingsStore", () => {
  it("seeds from the carried name (slug + @slug namespace), and from emptyFormValues when the name step was bypassed", () => {
    const seeded = seedGenesisFormValues("Vellum Notes");
    // Computed via the same deriveWorkspaceName the production seed uses — the
    // test pins the SEEDING CONTRACT (name → slug → @slug), not the slug
    // algorithm itself.
    const slug = deriveWorkspaceName("Vellum Notes").name;
    assert.equal(seeded.governance.workspaceName, slug);
    assert.equal(seeded.governance.namespacePrefix, `@${slug}`);

    const bypassed = seedGenesisFormValues(null);
    assert.equal(bypassed.governance.workspaceName, "@hexagen");
    assert.equal(bypassed.governance.namespacePrefix, "@hexagen");
  });

  it("seeding clones — mutating one seeded config never leaks into the next seed", () => {
    const first = seedGenesisFormValues(null);
    first.governance.workspaceName = "@mutated";
    first.boundedContexts[0].name = "mutated-context";

    const second = seedGenesisFormValues(null);
    assert.equal(second.governance.workspaceName, "@hexagen");
    assert.equal(second.boundedContexts[0].name, "core");
  });

  it("load returns null when empty, the saved values for the same seed name, and null for a different flow", () => {
    assert.equal(loadGenesisFormValues("Vellum Notes"), null);

    const values = seedGenesisFormValues("Vellum Notes");
    values.governance.packageManager = "pnpm";
    saveGenesisFormValues("Vellum Notes", values);

    // Same flow (same ?name= seed): the edited values survive.
    assert.equal(loadGenesisFormValues("Vellum Notes"), values);
    // A DIFFERENT flow must not inherit them — reseed instead.
    assert.equal(loadGenesisFormValues("Other Project"), null);
    assert.equal(loadGenesisFormValues(null), null);
  });

  it("keys the bypassed flow on null too — a named flow's snapshot is invisible to it and vice versa", () => {
    saveGenesisFormValues(null, seedGenesisFormValues(null));
    assert.notEqual(loadGenesisFormValues(null), null);
    assert.equal(loadGenesisFormValues("Vellum Notes"), null);
  });

  it("re-keys the bypassed flow's snapshot to the manufactured hand-off name — the accept screen re-attaches that name as ?name=, so the round trip must find the edits under it", () => {
    const values = seedGenesisFormValues(null);
    values.governance.packageManager = "pnpm";
    saveGenesisFormValues(null, values);

    rekeyGenesisFormValues(null, "AI Project 3:45:12 PM");

    assert.equal(loadGenesisFormValues(null), null);
    assert.equal(loadGenesisFormValues("AI Project 3:45:12 PM"), values);
  });

  it("rekey no-ops when the store is empty or the snapshot belongs to a different flow", () => {
    // Empty store: nothing to move, nothing invented.
    rekeyGenesisFormValues(null, "AI Project 3:45:12 PM");
    assert.equal(loadGenesisFormValues("AI Project 3:45:12 PM"), null);

    // A named flow's snapshot must not be hijacked by a null-keyed re-key.
    const values = seedGenesisFormValues("Vellum Notes");
    saveGenesisFormValues("Vellum Notes", values);
    rekeyGenesisFormValues(null, "Other Project");
    assert.equal(loadGenesisFormValues("Vellum Notes"), values);
    assert.equal(loadGenesisFormValues("Other Project"), null);
  });

  it("clear drops the snapshot", () => {
    saveGenesisFormValues(
      "Vellum Notes",
      seedGenesisFormValues("Vellum Notes"),
    );
    clearGenesisFormValues();
    assert.equal(loadGenesisFormValues("Vellum Notes"), null);
  });
});

// Plan Workbench C2 (locked plan §5 Q5): the field-level diff behind the
// hand-off's identity reconciliation. Only fields the user actually EDITED
// (snapshot differs from THIS flow's own seed) may outrank the
// carriedName-derived and AI-derived values.
describe("loadEditedGenesisGovernance", () => {
  it("reports nothing when the store is empty or belongs to a different flow", () => {
    assert.deepEqual(loadEditedGenesisGovernance("Vellum Notes"), {});

    saveGenesisFormValues(
      "Other Project",
      seedGenesisFormValues("Other Project"),
    );
    assert.deepEqual(loadEditedGenesisGovernance("Vellum Notes"), {});
    assert.deepEqual(loadEditedGenesisGovernance(null), {});
  });

  it("reports nothing for an UNEDITED snapshot — untouched seed defaults (e.g. the bypassed flow's @hexagen) must never masquerade as user edits", () => {
    saveGenesisFormValues(null, seedGenesisFormValues(null));
    assert.deepEqual(loadEditedGenesisGovernance(null), {});

    saveGenesisFormValues(
      "Vellum Notes",
      seedGenesisFormValues("Vellum Notes"),
    );
    assert.deepEqual(loadEditedGenesisGovernance("Vellum Notes"), {});
  });

  it("reports exactly the fields that differ from the seed, trimming identity values", () => {
    const values = seedGenesisFormValues("Vellum Notes");
    values.governance.workspaceName = "  vellum-edited  ";
    values.governance.packageManager = "pnpm";
    saveGenesisFormValues("Vellum Notes", values);

    assert.deepEqual(loadEditedGenesisGovernance("Vellum Notes"), {
      workspaceName: "vellum-edited",
      packageManager: "pnpm",
    });
  });

  it("treats a blanked identity field as NOT edited — an emptied value must fall through the precedence chain, never become system/scope", () => {
    const values = seedGenesisFormValues("Vellum Notes");
    values.governance.workspaceName = "   ";
    values.governance.namespacePrefix = "";
    saveGenesisFormValues("Vellum Notes", values);

    assert.deepEqual(loadEditedGenesisGovernance("Vellum Notes"), {});
  });

  it("keeps the diff baseline ACROSS a rekey — untouched @hexagen seed defaults must not surface as edits under the manufactured name on the second hand-off", () => {
    // Bypassed flow: null seed, user edits ONLY packageManager.
    const values = seedGenesisFormValues(null);
    values.governance.packageManager = "pnpm";
    saveGenesisFormValues(null, values);

    // Hand-off #1 rekeys the snapshot to the manufactured AI-derived name.
    rekeyGenesisFormValues(null, "test-system");

    // Hand-off #2 (after Back/Regenerate re-attached ?name=test-system):
    // the baseline must still be the NULL seed the flow started from — a
    // baseline recomputed from "test-system" would report the untouched
    // "@hexagen" identity defaults as edits and clobber system/scope.
    assert.deepEqual(loadEditedGenesisGovernance("test-system"), {
      packageManager: "pnpm",
    });
  });

  it("keeps the ORIGINAL baseline when the rekeyed snapshot is overwritten by later same-key saves (the remounted form keeps mirroring edits)", () => {
    const values = seedGenesisFormValues(null);
    values.governance.packageManager = "pnpm";
    saveGenesisFormValues(null, values);
    rekeyGenesisFormValues(null, "test-system");

    // Post-Back remount: the section saves under the re-attached name key.
    const later = structuredClone(values);
    later.governance.workspaceTemplate = "strict-enterprise";
    saveGenesisFormValues("test-system", later);

    assert.deepEqual(loadEditedGenesisGovernance("test-system"), {
      packageManager: "pnpm",
      workspaceTemplate: "strict-enterprise",
    });
  });

  it("reports template and naming-convention edits (formValues-only fields), copying the naming object", () => {
    const values = seedGenesisFormValues(null);
    values.governance.workspaceTemplate = "strict-enterprise";
    values.governance.namingConventions.adapterSuffix = ".gateway.ts";
    saveGenesisFormValues(null, values);

    const edited = loadEditedGenesisGovernance(null);
    assert.equal(edited.workspaceTemplate, "strict-enterprise");
    assert.deepEqual(edited.namingConventions, {
      contextDirectoryPattern: "packages/",
      adapterSuffix: ".gateway.ts",
    });
    // A defensive copy: the caller mutating the result must not write back
    // into the live snapshot.
    assert.notEqual(
      edited.namingConventions,
      values.governance.namingConventions,
    );
    assert.equal(edited.workspaceName, undefined);
    assert.equal(edited.namespacePrefix, undefined);
  });
});
