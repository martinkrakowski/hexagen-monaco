// crypto is a getter-only global in Node, so stub it via vi.stubGlobal (a plain
// `global.crypto =` throws "has only a getter"). Textual position is cosmetic:
// Vitest hoists imports, so emptyFormValues' module-eval id is minted by the
// REAL crypto.randomUUID before this line runs — the stub only makes the ids
// createBlankProjectConfig mints at RUNTIME (one per seed) deterministic,
// and no assertion reads either batch.
let uuidCounter = 0;
vi.stubGlobal("crypto", {
  randomUUID: () => `uuid-${(uuidCounter += 1)}`,
} as unknown as Crypto);

import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { deriveWorkspaceName } from "@hexagen/manifest-generation";
import { GenesisProjectSettingsSection } from "../GenesisProjectSettingsSection";
import { clearGenesisFormValues } from "../genesisProjectSettingsStore";

// Module-scoped store backs the section: reset between tests or a previous
// test's edits masquerade as this test's survival.
beforeEach(() => {
  clearGenesisFormValues();
});

const workspaceNameInput = () =>
  screen.getByLabelText("Workspace Name") as HTMLInputElement;

describe("GenesisProjectSettingsSection", () => {
  it("renders the plan-phase field set under the settings landmark, seeded from the carried name", () => {
    render(<GenesisProjectSettingsSection carriedName="Vellum Notes" />);

    assert.ok(
      document.querySelector('section[aria-label="Project settings"]'),
      "the settings section landmark is present",
    );

    // Same field groups as the plan phase (plan §3.2): identity, template,
    // package manager, naming conventions.
    // Computed via the production slug derivation, not hardcoded — the test
    // pins name → workspaceName seeding, not the slug algorithm.
    const slug = deriveWorkspaceName("Vellum Notes").name;
    assert.equal(workspaceNameInput().value, slug);
    assert.ok(screen.getByText("Namespace Prefix"));
    assert.ok(screen.getByText("Architectural Template"));
    assert.ok(screen.getByText("Package Manager"));
    assert.ok(screen.getByText("Context Directory Pattern"));
    assert.ok(screen.getByText("Adapter Suffix"));
  });

  it("falls back to the wizard's emptyFormValues when the name step was bypassed", () => {
    render(<GenesisProjectSettingsSection carriedName={null} />);
    assert.equal(workspaceNameInput().value, "@hexagen");
  });

  it("keeps edits across unmount/remount with the same carried name (the accept screen's Back/Regenerate round trip)", () => {
    const first = render(
      <GenesisProjectSettingsSection carriedName="Vellum Notes" />,
    );
    fireEvent.change(workspaceNameInput(), {
      target: { value: "@survived-back" },
    });
    // Back/Regenerate clears usePendingManifest and remounts the page — the
    // only surviving carrier is the module store this section mirrors into.
    first.unmount();

    render(<GenesisProjectSettingsSection carriedName="Vellum Notes" />);
    assert.equal(workspaceNameInput().value, "@survived-back");
  });

  it("reseeds for a different carried name — a new flow must not inherit the previous flow's edits", () => {
    const first = render(
      <GenesisProjectSettingsSection carriedName="Vellum Notes" />,
    );
    fireEvent.change(workspaceNameInput(), {
      target: { value: "@stale-edit" },
    });
    first.unmount();

    render(<GenesisProjectSettingsSection carriedName="Fresh Project" />);
    assert.equal(
      workspaceNameInput().value,
      deriveWorkspaceName("Fresh Project").name,
    );
  });
});
