import { describe, it } from "vitest";
import assert from "node:assert/strict";
import React from "react";
import { render, screen } from "@testing-library/react";
import { GenesisSourcesSection } from "../GenesisSourcesSection";

describe("GenesisSourcesSection", () => {
  it("always shows the Draft brief row and the sessions-availability line; never an Add planning session control", () => {
    render(<GenesisSourcesSection originSpecText={null} />);

    assert.ok(screen.getByText("Draft brief"));
    // EXACT plan-phase empty-state copy (locked §5 Q1): the muted line is the
    // only home for the sessions hint pre-save.
    assert.ok(
      screen.getByText("Planning sessions are available after you save"),
    );
    // The left-footer "Add planning session" is hidden entirely in genesis —
    // this section must not reintroduce it.
    assert.equal(screen.queryByText("Add planning session"), null);
  });

  it("omits the Source row in the plain prompt flow (no origin spec)", () => {
    render(<GenesisSourcesSection originSpecText={null} />);
    assert.equal(screen.queryByText("Source"), null);
  });

  it("shows a read-only Source row with a first-line excerpt when an origin spec exists", () => {
    render(
      <GenesisSourcesSection
        originSpecText={"# Vellum spec\nsecond line never shown"}
      />,
    );

    assert.ok(screen.getByText("Source"));
    assert.ok(screen.getByText("# Vellum spec"));
    assert.equal(screen.queryByText(/second line never shown/), null);
  });

  it("truncates a long first line at 80 characters with an ellipsis", () => {
    const longLine = "x".repeat(120);
    render(<GenesisSourcesSection originSpecText={longLine} />);

    assert.ok(screen.getByText(`${"x".repeat(80)}…`));
  });
});
