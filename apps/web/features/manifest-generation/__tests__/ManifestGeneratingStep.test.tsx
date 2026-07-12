import React from "react";
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { render, screen } from "@testing-library/react";
import { ManifestGeneratingStep } from "../import-project-spec/ManifestGeneratingStep";
import { isAutoAppliedNotice } from "../import-project-spec/utils";
import type { StageValidationReport } from "../useStagedGenerationStream";

/**
 * The completion summary must lead with SUCCESS: Stage-6 findings are advisory
 * and never block the manifest, but the old panel rendered nothing on a clean
 * run and a warning-tinted "N issues … to address" panel otherwise — users read
 * every completed generation as "generated with errors" (Martin, 2026-07-11).
 */

const baseProps = {
  generationError: null,
  stepDetail: "",
  stageProgress: {},
  verboseLog: [],
};

function report(
  errors: string[] = [],
  warnings: string[] = [],
): StageValidationReport {
  return { errors, warnings, passed: errors.length === 0 };
}

describe("ManifestGeneratingStep completion summary", () => {
  it("shows an explicit success banner on a clean completed run", () => {
    render(
      <ManifestGeneratingStep
        {...baseProps}
        phase="complete"
        validationReport={report()}
      />,
    );
    assert.ok(
      screen.getByText(/Manifest generated successfully — ready to review/),
    );
    assert.ok(screen.getByRole("heading", { name: "Manifest Generated" }));
  });

  it("leads with success even when the review left advisory findings", () => {
    render(
      <ManifestGeneratingStep
        {...baseProps}
        phase="complete"
        validationReport={report(
          ["[R01] Context 'QueueAdapter' violates R01"],
          ["[R16] WebUI/UploadImagesPort: Port description is trivial"],
        )}
      />,
    );
    // Success banner first, findings framed as optional.
    assert.ok(
      screen.getByText(/Manifest generated successfully — ready to review/),
    );
    // Appears in the banner subtext AND the collapsed findings summary.
    assert.ok(screen.getAllByText(/optional improvements/).length >= 1);
    assert.ok(screen.getByText(/1 finding and 1 suggestion from the review/));
    // No error-flavored headline anywhere.
    assert.equal(screen.queryByText(/to address/), null);
  });

  it("does not show the success banner while generating or on failure", () => {
    const { rerender } = render(
      <ManifestGeneratingStep {...baseProps} phase="stage-3" />,
    );
    assert.equal(screen.queryByText(/Manifest generated successfully/), null);
    assert.ok(screen.getByRole("heading", { name: "Generating Manifest" }));

    rerender(
      <ManifestGeneratingStep
        {...baseProps}
        phase="complete"
        generationError="The generated manifest could not be parsed (apps.0.name: Required). Go back and try again."
      />,
    );
    assert.equal(screen.queryByText(/Manifest generated successfully/), null);
    assert.ok(screen.getByText(/could not be parsed/));
  });

  it("reframes a kept-original repair as advisory, not failure", () => {
    render(
      <ManifestGeneratingStep
        {...baseProps}
        phase="complete"
        validationReport={report(["[R01] finding"])}
        repairSummary={{
          attempted: true,
          applied: false,
          errorsBefore: 1,
          errorsAfter: 1,
          warningsBefore: 0,
          warningsAfter: 0,
        }}
      />,
    );
    assert.ok(
      screen.getByText(
        /original manifest was kept and the notes below remain advisory/,
      ),
    );
    assert.equal(screen.queryByText(/couldn't reduce the errors/), null);
  });

  it("reports the applied-repair branch with its before/after counts", () => {
    render(
      <ManifestGeneratingStep
        {...baseProps}
        phase="complete"
        validationReport={report([], ["[R16] trivial port description"])}
        repairSummary={{
          attempted: true,
          applied: true,
          errorsBefore: 3,
          errorsAfter: 1,
          warningsBefore: 1,
          warningsAfter: 1,
        }}
      />,
    );
    // "resolved 2 of 3 findings automatically — 1 remain as advisory notes"
    assert.ok(screen.getByText(/resolved 2 of 3 findings automatically/));
    assert.ok(screen.getByText(/1 remain as advisory notes/));
    // Still a success — an applied repair is not a failure.
    assert.ok(
      screen.getByText(/Manifest generated successfully — ready to review/),
    );
  });

  it("classifies Stage-5 schema-gate adjustments as auto-applied notices", () => {
    // Keep in sync with enforce-manifest-schema.ts advisory copy.
    const gateAdvisories = [
      "Coerced app entry 'web' to an object form — the manifest schema requires app entries to be objects with a 'name'.",
      `Dropped an app entry without a usable name ({"framework":"next.js"}) — the manifest schema requires every app to carry a string 'name'.`,
      "Dropped a context mapping missing an upstream/downstream endpoint ({}).",
      "Dropped 1 unnamed entities entry in context 'orders' — the manifest schema requires string names.",
    ];
    for (const advisory of gateAdvisories) {
      assert.equal(isAutoAppliedNotice(advisory), true, advisory);
    }
    // Reviewer findings must NOT be misfiled as notices.
    assert.equal(
      isAutoAppliedNotice(
        "Outbound port 'ImageRepository' is declared by 2 contexts (ImageDomain, WebUI) — in DDD a port has one owning context.",
      ),
      false,
    );
    // "Dropped " prefix alone is not enough without the schema-gate marker.
    assert.equal(
      isAutoAppliedNotice("Dropped the ball on this one entirely."),
      false,
    );
  });

  it("presents auto-applied adjustments as informational notices", () => {
    render(
      <ManifestGeneratingStep
        {...baseProps}
        phase="complete"
        validationReport={report(
          [],
          [
            "Renamed context 'ZipAdapter' to 'zip' to remove the banned technology token 'adapter' (R01) — a context is named for a business capability, not a technical pattern.",
          ],
        )}
      />,
    );
    assert.ok(
      screen.getByText(/1 adjustment was.*applied automatically/, {
        // summary text is broken across inline nodes
        exact: false,
      }),
    );
    assert.ok(screen.getByText(/No action needed/));
    // Notices alone must not suppress the success banner.
    assert.ok(
      screen.getByText(/Manifest generated successfully — ready to review/),
    );
  });
});
