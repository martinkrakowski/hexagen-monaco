import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import React from "react";
import { render, cleanup } from "@testing-library/react";

// Separate file from PlanPhaseView.test.tsx: this one mocks usePlanningSession
// itself (module-level vi.mock) to pin the archive-filter seam, while the main
// suite exercises the view with the REAL hook.
const lifecycle = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}));
vi.mock("../../contexts/WizardLifecycleContext", () => ({
  useWizardLifecycleContext: () => lifecycle.current,
}));

const planningSession = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}));
vi.mock("../session/usePlanningSession", () => ({
  usePlanningSession: () => planningSession.current,
}));

import { PlanPhaseView } from "../PlanPhaseView";

const bodyText = () => (document.body.textContent || "").replace(/\s+/g, " ");

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    sessionState: null,
    activeLayerId: null,
    draft: null,
    isRunning: false,
    seed: "",
    turns: [],
    start: vi.fn(async () => true),
    attach: vi.fn(),
    pause: vi.fn(async () => {}),
    resume: vi.fn(async () => {}),
    addSteering: vi.fn(async () => {}),
    forceConverge: vi.fn(async () => {}),
    end: vi.fn(async () => {}),
    beginFinalize: vi.fn(async () => {}),
    cancelFinalize: vi.fn(async () => {}),
    reset: vi.fn(),
    ...overrides,
  };
}

const layer = (id: string, title: string) => ({
  id,
  kind: "brainstorm",
  title,
  createdAt: 1,
  updatedAt: 1,
  turns: [{ id: `${id}-t1`, author: "You", content: `${title} content` }],
});

describe("PlanPhaseView archive filter (single hook instance)", () => {
  beforeEach(() => {
    cleanup();
    lifecycle.current = {
      loadedProject: {
        id: "p1",
        name: "Vellum",
        schemaVersion: 4,
        createdAt: 0,
        updatedAt: 0,
        formState: {},
        manifestYaml: "",
        layers: [layer("L-active", "Live one"), layer("L-old", "Archived one")],
      },
      addLayer: vi.fn(async () => "layer-id"),
      updateLayer: vi.fn(async () => true),
      appendLayerTurn: vi.fn(async () => ({
        id: "turn-id",
        author: "AI",
        content: "",
        at: 0,
      })),
      layersPersistError: null,
      clearLayersPersistError: vi.fn(),
    };
    planningSession.current = makeSession();
  });

  it("filters the ACTIVE session's layer out of the archive list (its turns render once, in the live panel)", () => {
    planningSession.current = makeSession({
      activeLayerId: "L-active",
      sessionState: {
        status: "critiquing",
        round: 1,
        maxRounds: 4,
        nextRole: "critic",
      },
      turns: [{ id: "t", author: "You", content: "live turn", role: "human" }],
    });
    render(<PlanPhaseView onNavigateToImport={vi.fn()} />);

    const text = bodyText();
    assert.match(text, /Archived one/, "non-active layer stays archived");
    assert.doesNotMatch(
      text,
      /Live one content/,
      "the active layer's archived rendering is suppressed",
    );
    assert.match(text, /live turn/, "the live panel renders the session turns");
  });

  it("renders ALL layers in the archive when no session is active", () => {
    render(<PlanPhaseView onNavigateToImport={vi.fn()} />);
    const text = bodyText();
    assert.match(text, /Live one content/);
    assert.match(text, /Archived one content/);
  });
});
