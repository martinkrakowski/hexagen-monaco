import { describe, it } from "vitest";
import assert from "node:assert/strict";

import { collapseApplications } from "@/applications-config";
import { createEmptyContext } from "./createEmptyContext";

// Split out of the old applications-config test when `collapseApplications`
// moved to a slice-neutral home: the seam under test here is the wizard's
// BoundedContextStep add handler, so it belongs to the wizard slice.
describe("createEmptyContext inherits the Applications selection", () => {
  it("a context created AFTER the Applications step carries the project's UI/API choice (ADR-0041 gap-closer)", () => {
    // Simulates the BoundedContextStep add handler: collapse existing contexts,
    // pass the selection into createEmptyContext.
    const existing = [
      { uiFramework: "Remix" as const, infrastructureTarget: "nitro" as const },
    ];
    const { uiFramework, infrastructureTarget } =
      collapseApplications(existing);

    const created = createEmptyContext({ uiFramework, infrastructureTarget });

    assert.equal(created.uiFramework, "Remix");
    assert.equal(created.infrastructureTarget, "nitro");
  });

  it("falls back to the single-app preset (Next.js + Nitro) with no selection", () => {
    const created = createEmptyContext();
    assert.equal(created.uiFramework, "Next.js");
    assert.equal(created.infrastructureTarget, "nitro");
  });
});
