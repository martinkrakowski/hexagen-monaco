// crypto.randomUUID is used to stamp the turn id (getter-only global in Node —
// stub via vi.stubGlobal).
vi.stubGlobal("crypto", {
  randomUUID: () => "turn-uuid",
} as unknown as Crypto);

import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import React from "react";
import { render, cleanup, fireEvent, waitFor } from "@testing-library/react";

import { AddPlanningSessionView } from "../AddPlanningSessionView";

// Behavior pins ported verbatim from the deleted AddPlanningSessionDialog
// suite (PR B, plan req 4b): the ingestion contract is unchanged, only the
// chrome moved from a modal <Dialog> to an inline right-pane view — which is
// also why this suite needs NO HTMLDialogElement stubs anymore. The dialog's
// "closes on success" pin became host behavior ("on success select the new
// layer") and lives in PlanPhaseView.test.tsx; its view-level residue here is
// the fields resetting on a successful submit.

function button(label: RegExp): HTMLButtonElement {
  const btn = Array.from(document.querySelectorAll("button")).find((b) =>
    label.test(b.textContent || ""),
  );
  assert.ok(btn, `expected a button matching ${label}`);
  return btn as HTMLButtonElement;
}

function textarea(): HTMLTextAreaElement {
  const el = document.querySelector("textarea");
  assert.ok(el, "expected the transcript textarea");
  return el as HTMLTextAreaElement;
}

describe("AddPlanningSessionView", () => {
  beforeEach(() => cleanup());

  it("renders as a plain full-height section — no modal dialog element", () => {
    render(
      <AddPlanningSessionView
        onCancel={vi.fn()}
        onSubmit={vi.fn(async () => true)}
        submitError={null}
      />,
    );
    assert.ok(
      document.querySelector('section[aria-label="Add planning session"]'),
      "the view is a labeled section (right-pane main view)",
    );
    assert.equal(
      document.querySelector("dialog"),
      null,
      "req 4b: the modal is gone",
    );
  });

  it("disables submit until the transcript has content", () => {
    render(
      <AddPlanningSessionView
        onCancel={vi.fn()}
        onSubmit={vi.fn(async () => true)}
        submitError={null}
      />,
    );
    assert.equal(button(/Add session/).disabled, true);
    fireEvent.change(textarea(), { target: { value: "# The session" } });
    assert.equal(button(/Add session/).disabled, false);
  });

  it("fires onCancel from the Cancel action without submitting", () => {
    const onCancel = vi.fn();
    const onSubmit = vi.fn(async () => true);
    render(
      <AddPlanningSessionView
        onCancel={onCancel}
        onSubmit={onSubmit}
        submitError={null}
      />,
    );
    fireEvent.change(textarea(), { target: { value: "typed but abandoned" } });
    fireEvent.click(button(/Cancel/));
    assert.equal(onCancel.mock.calls.length, 1);
    assert.equal(onSubmit.mock.calls.length, 0, "Cancel never submits");
  });

  it("submits one Imported turn (default title) and resets the fields on success", async () => {
    const onSubmit = vi.fn(async () => true);
    render(
      <AddPlanningSessionView
        onCancel={vi.fn()}
        onSubmit={onSubmit}
        submitError={null}
      />,
    );

    fireEvent.change(textarea(), { target: { value: "# The session" } });
    fireEvent.click(button(/Add session/));

    await waitFor(() => assert.equal(onSubmit.mock.calls.length, 1));
    const layer = onSubmit.mock.calls[0][0];
    assert.equal(layer.kind, "brainstorm");
    assert.equal(layer.title, "Planning session");
    assert.equal(layer.turns.length, 1);
    assert.equal(layer.turns[0].author, "Imported");
    assert.equal(layer.turns[0].content, "# The session");
    assert.equal(layer.turns[0].id, "turn-uuid");
    // The host unmounts the view on success; the view still resets so the
    // contract doesn't depend on that.
    await waitFor(() => assert.equal(textarea().value, ""));
  });

  it("uses the typed title when provided", async () => {
    const onSubmit = vi.fn(async () => true);
    render(
      <AddPlanningSessionView
        onCancel={vi.fn()}
        onSubmit={onSubmit}
        submitError={null}
      />,
    );

    const titleInput = document.querySelector(
      "input[type=text]",
    ) as HTMLInputElement;
    fireEvent.change(titleInput, {
      target: { value: "  Vellum brainstorm  " },
    });
    fireEvent.change(textarea(), { target: { value: "content" } });
    fireEvent.click(button(/Add session/));

    await waitFor(() => assert.equal(onSubmit.mock.calls.length, 1));
    assert.equal(onSubmit.mock.calls[0][0].title, "Vellum brainstorm");
  });

  it("keeps the content intact when the write fails and surfaces the error inline", async () => {
    const onSubmit = vi.fn(async () => false);
    const { rerender } = render(
      <AddPlanningSessionView
        onCancel={vi.fn()}
        onSubmit={onSubmit}
        submitError={null}
      />,
    );

    fireEvent.change(textarea(), { target: { value: "precious transcript" } });
    fireEvent.click(button(/Add session/));

    await waitFor(() => assert.equal(onSubmit.mock.calls.length, 1));
    assert.equal(
      textarea().value,
      "precious transcript",
      "pasted content is not cleared on failure",
    );

    // The parent surfaces the persistence error; it renders inline.
    rerender(
      <AddPlanningSessionView
        onCancel={vi.fn()}
        onSubmit={onSubmit}
        submitError="Not enough browser storage."
      />,
    );
    const alert = document.querySelector('[role="alert"]');
    assert.ok(alert);
    assert.match(alert.textContent || "", /Not enough browser storage/);
  });

  // --- Delimiter-based turn splitting (ported unchanged) ---------------------

  const checkbox = (): HTMLInputElement | null =>
    document.querySelector('input[type="checkbox"]');

  const bodyText = () => (document.body.textContent || "").replace(/\s+/g, " ");

  it("offers no split checkbox for zero or one ## heading", () => {
    render(
      <AddPlanningSessionView
        onCancel={vi.fn()}
        onSubmit={vi.fn(async () => true)}
        submitError={null}
      />,
    );
    fireEvent.change(textarea(), { target: { value: "plain prose" } });
    assert.equal(checkbox(), null);
    fireEvent.change(textarea(), {
      target: { value: "## Overview\n\none section" },
    });
    assert.equal(checkbox(), null, "a single heading is not a session");
  });

  it("shows a default-checked split checkbox with a live turn count on detection", () => {
    render(
      <AddPlanningSessionView
        onCancel={vi.fn()}
        onSubmit={vi.fn(async () => true)}
        submitError={null}
      />,
    );
    fireEvent.change(textarea(), {
      target: { value: "## Grok\n\npropose\n\n## Claude\n\ncritique" },
    });
    const box = checkbox();
    assert.ok(box, "split checkbox appears when >= 2 headings match");
    assert.equal(box.checked, true, "split defaults to on");
    assert.match(bodyText(), /Split into turns by/);
    assert.match(bodyText(), /2 turns detected/);

    // Preamble adds an Imported turn to the live count.
    fireEvent.change(textarea(), {
      target: {
        value: "context first\n\n## Grok\n\npropose\n\n## Claude\n\ncritique",
      },
    });
    assert.match(bodyText(), /3 turns detected/);
  });

  it("splits into authored turns on submit when the checkbox is checked", async () => {
    const onSubmit = vi.fn(async () => true);
    render(
      <AddPlanningSessionView
        onCancel={vi.fn()}
        onSubmit={onSubmit}
        submitError={null}
      />,
    );
    fireEvent.change(textarea(), {
      target: {
        value: "intro\n\n## Grok\n\npropose\n\n## Claude\n\ncritique",
      },
    });
    fireEvent.click(button(/Add session/));

    await waitFor(() => assert.equal(onSubmit.mock.calls.length, 1));
    const layer = onSubmit.mock.calls[0][0];
    assert.deepEqual(
      layer.turns.map((t: { author: string }) => t.author),
      ["Imported", "Grok", "Claude"],
    );
    assert.equal(layer.turns[1].content, "propose");
    assert.equal(layer.turns[2].content, "critique");
  });

  it("offers no split for >=2 headings whose sections are ALL empty and falls back to one lossless Imported turn", async () => {
    // splitTurnsByAuthorHeadings returns [] here; the view must normalize
    // that to "no split" (a bare truthiness check would submit turns: [] and
    // persist a turn-less layer).
    const onSubmit = vi.fn(async () => true);
    render(
      <AddPlanningSessionView
        onCancel={vi.fn()}
        onSubmit={onSubmit}
        submitError={null}
      />,
    );
    const content = "## Grok\n## Claude\n";
    fireEvent.change(textarea(), { target: { value: content } });
    assert.equal(checkbox(), null, "an all-empty split is not offered at all");
    fireEvent.click(button(/Add session/));

    await waitFor(() => assert.equal(onSubmit.mock.calls.length, 1));
    const layer = onSubmit.mock.calls[0][0];
    assert.equal(layer.turns.length, 1, "never a turn-less layer");
    assert.equal(layer.turns[0].author, "Imported");
    assert.equal(layer.turns[0].content, content, "lossless fallback");
  });

  it("keeps the lossless single-Imported-turn behavior when unchecked", async () => {
    const onSubmit = vi.fn(async () => true);
    render(
      <AddPlanningSessionView
        onCancel={vi.fn()}
        onSubmit={onSubmit}
        submitError={null}
      />,
    );
    const content = "## Grok\n\npropose\n\n## Claude\n\ncritique";
    fireEvent.change(textarea(), { target: { value: content } });
    const box = checkbox();
    assert.ok(box);
    fireEvent.click(box);
    assert.equal(box.checked, false);
    fireEvent.click(button(/Add session/));

    await waitFor(() => assert.equal(onSubmit.mock.calls.length, 1));
    const layer = onSubmit.mock.calls[0][0];
    assert.equal(layer.turns.length, 1);
    assert.equal(layer.turns[0].author, "Imported");
    assert.equal(layer.turns[0].content, content, "lossless");
  });
});
