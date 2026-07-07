// crypto.randomUUID is used to stamp the turn id (getter-only global in Node —
// stub via vi.stubGlobal).
vi.stubGlobal("crypto", {
  randomUUID: () => "turn-uuid",
} as unknown as Crypto);

import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert";
import React from "react";
import { render, cleanup, fireEvent, waitFor } from "@testing-library/react";

import { AddPlanningSessionDialog } from "../AddPlanningSessionDialog";

// jsdom doesn't implement the native <dialog> modal API the @hexagen/ui Dialog
// calls (dialog.showModal()/close()) — stub it so the panel mounts.
HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute("open", "");
};
HTMLDialogElement.prototype.close = function () {
  this.removeAttribute("open");
};

// jsdom's <dialog> a11y is incomplete (subtree not exposed to role queries) —
// query the raw DOM by text/label instead.
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

describe("AddPlanningSessionDialog", () => {
  beforeEach(() => cleanup());

  it("disables submit until the transcript has content", () => {
    render(
      <AddPlanningSessionDialog
        open
        onClose={vi.fn()}
        onSubmit={vi.fn(async () => true)}
        submitError={null}
      />,
    );
    assert.strictEqual(button(/Add session/).disabled, true);
    fireEvent.change(textarea(), { target: { value: "# The session" } });
    assert.strictEqual(button(/Add session/).disabled, false);
  });

  it("submits one Imported turn (default title) and closes on success", async () => {
    const onClose = vi.fn();
    const onSubmit = vi.fn(async () => true);
    render(
      <AddPlanningSessionDialog
        open
        onClose={onClose}
        onSubmit={onSubmit}
        submitError={null}
      />,
    );

    fireEvent.change(textarea(), { target: { value: "# The session" } });
    fireEvent.click(button(/Add session/));

    await waitFor(() => assert.strictEqual(onClose.mock.calls.length, 1));
    assert.strictEqual(onSubmit.mock.calls.length, 1);
    const layer = onSubmit.mock.calls[0][0];
    assert.strictEqual(layer.kind, "brainstorm");
    assert.strictEqual(layer.title, "Planning session");
    assert.strictEqual(layer.turns.length, 1);
    assert.strictEqual(layer.turns[0].author, "Imported");
    assert.strictEqual(layer.turns[0].content, "# The session");
    assert.strictEqual(layer.turns[0].id, "turn-uuid");
  });

  it("uses the typed title when provided", async () => {
    const onSubmit = vi.fn(async () => true);
    render(
      <AddPlanningSessionDialog
        open
        onClose={vi.fn()}
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

    await waitFor(() => assert.strictEqual(onSubmit.mock.calls.length, 1));
    assert.strictEqual(onSubmit.mock.calls[0][0].title, "Vellum brainstorm");
  });

  it("stays open with the content intact when the write fails", async () => {
    const onClose = vi.fn();
    const onSubmit = vi.fn(async () => false);
    const { rerender } = render(
      <AddPlanningSessionDialog
        open
        onClose={onClose}
        onSubmit={onSubmit}
        submitError={null}
      />,
    );

    fireEvent.change(textarea(), { target: { value: "precious transcript" } });
    fireEvent.click(button(/Add session/));

    await waitFor(() => assert.strictEqual(onSubmit.mock.calls.length, 1));
    assert.strictEqual(onClose.mock.calls.length, 0, "dialog must stay open");
    assert.strictEqual(
      textarea().value,
      "precious transcript",
      "pasted content is not cleared on failure",
    );

    // The parent surfaces the persistence error; it renders inline.
    rerender(
      <AddPlanningSessionDialog
        open
        onClose={onClose}
        onSubmit={onSubmit}
        submitError="Not enough browser storage."
      />,
    );
    const alert = document.querySelector('[role="alert"]');
    assert.ok(alert);
    assert.match(alert.textContent || "", /Not enough browser storage/);
  });
});
