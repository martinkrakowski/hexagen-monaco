vi.stubGlobal("crypto", {
  randomUUID: () => "turn-uuid",
} as unknown as Crypto);

import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert";
import React from "react";
import { render, cleanup, fireEvent, waitFor } from "@testing-library/react";

// PlanPhaseView reads the project + layer mutations from the wizard lifecycle
// context. Mock the hook (the provider needs the whole workspace tree).
const lifecycle = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}));
vi.mock("../../contexts/WizardLifecycleContext", () => ({
  useWizardLifecycleContext: () => lifecycle.current,
}));

import { PlanPhaseView } from "../PlanPhaseView";

HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute("open", "");
};
HTMLDialogElement.prototype.close = function () {
  this.removeAttribute("open");
};

const bodyText = () => (document.body.textContent || "").replace(/\s+/g, " ");

// The Plan phase now also renders the live-session seed textarea; the paste
// dialog's textarea must be selected by its label, not document order.
const transcriptTextarea = () =>
  document.querySelector(
    'textarea[aria-label="Session transcript (markdown)"]',
  ) as HTMLTextAreaElement;

const renderView = () => render(<PlanPhaseView onNavigateToImport={vi.fn()} />);

function button(label: RegExp): HTMLButtonElement {
  const btn = Array.from(document.querySelectorAll("button")).find((b) =>
    label.test(b.textContent || ""),
  );
  assert.ok(btn, `expected a button matching ${label}`);
  return btn as HTMLButtonElement;
}

function project(layers: unknown[] = []) {
  return {
    id: "p1",
    name: "Vellum",
    schemaVersion: 4,
    createdAt: 0,
    updatedAt: 0,
    formState: {},
    manifestYaml: "",
    layers,
  };
}

describe("PlanPhaseView", () => {
  beforeEach(() => {
    cleanup();
    lifecycle.current = {
      loadedProject: project(),
      addLayer: vi.fn(async () => "layer-id"),
      updateLayer: vi.fn(async () => true),
      appendLayerTurn: vi.fn(async () => "turn-id"),
      layersPersistError: null,
      clearLayersPersistError: vi.fn(),
    };
  });

  it("renders the guard state when no saved project is loaded (direct ?phase=plan URL)", () => {
    lifecycle.current.loadedProject = null;
    renderView();
    assert.match(bodyText(), /Save the project to attach planning sessions/);
  });

  it("shows the empty state with an add action when the project has no layers", () => {
    renderView();
    assert.match(bodyText(), /No planning session yet/);
    assert.ok(button(/Add planning session/));
  });

  it("renders each layer's title, turn count, and turns", () => {
    lifecycle.current.loadedProject = project([
      {
        id: "L1",
        kind: "brainstorm",
        title: "Initial brainstorm",
        createdAt: 1,
        updatedAt: 1,
        turns: [
          { id: "t1", author: "Grok", content: "propose" },
          { id: "t2", author: "Claude", content: "critique" },
        ],
      },
    ]);
    renderView();
    const text = bodyText();
    assert.match(text, /Initial brainstorm/);
    assert.match(text, /2 turns/);
    assert.match(text, /propose/);
    assert.match(text, /critique/);
    assert.doesNotMatch(text, /No planning session yet/);
  });

  it("adds a pasted session through addLayer with the loaded project's id", async () => {
    renderView();
    fireEvent.click(button(/Add planning session/));

    const textarea = transcriptTextarea();
    fireEvent.change(textarea, { target: { value: "the transcript" } });
    fireEvent.click(button(/Add session/));

    const addLayer = lifecycle.current.addLayer as ReturnType<typeof vi.fn>;
    await waitFor(() => assert.strictEqual(addLayer.mock.calls.length, 1));
    const [projectId, layer] = addLayer.mock.calls[0];
    assert.strictEqual(projectId, "p1");
    assert.strictEqual(layer.turns[0].content, "the transcript");
  });

  it("does not show a stale persistence error from an unrelated write before any submit", () => {
    // persistError is instance-wide (a failed wizard autosave sets it too);
    // opening the dialog must not present it as a session-save failure.
    lifecycle.current.layersPersistError = {
      kind: "SerializationFailed",
      message: "unrelated autosave failure",
    };
    renderView();
    fireEvent.click(button(/Add planning session/));
    assert.strictEqual(
      document.querySelector('[role="alert"]'),
      null,
      "no error shown before a submit from this dialog",
    );
  });

  it("shows generic failure copy when addLayer fails without a persistence error", async () => {
    lifecycle.current.addLayer = vi.fn(async () => null);
    lifecycle.current.layersPersistError = null;
    renderView();
    fireEvent.click(button(/Add planning session/));
    const textarea = transcriptTextarea();
    fireEvent.change(textarea, { target: { value: "content" } });
    fireEvent.click(button(/Add session/));

    await waitFor(() => {
      const alert = document.querySelector('[role="alert"]');
      assert.ok(alert, "failure without a mapped error still surfaces");
      assert.match(alert.textContent || "", /Couldn't save the session/);
    });
  });

  it("maps a quota failure to actionable copy", async () => {
    lifecycle.current.addLayer = vi.fn(async () => null);
    lifecycle.current.layersPersistError = {
      kind: "StorageQuotaExceeded",
      message: "IDB storage quota exceeded",
    };
    renderView();
    fireEvent.click(button(/Add planning session/));
    const textarea = transcriptTextarea();
    fireEvent.change(textarea, { target: { value: "big transcript" } });
    fireEvent.click(button(/Add session/));

    await waitFor(() => {
      const alert = document.querySelector('[role="alert"]');
      assert.ok(alert, "quota error surfaces inline");
      assert.match(alert.textContent || "", /Not enough browser storage/);
    });
  });
});
