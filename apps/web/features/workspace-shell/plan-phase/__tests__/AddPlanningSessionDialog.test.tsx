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

  // --- Phase 2: delimiter-based turn splitting -----------------------------

  const checkbox = (): HTMLInputElement | null =>
    document.querySelector('input[type="checkbox"]');

  const bodyText = () => (document.body.textContent || "").replace(/\s+/g, " ");

  it("offers no split checkbox for zero or one ## heading", () => {
    render(
      <AddPlanningSessionDialog
        open
        onClose={vi.fn()}
        onSubmit={vi.fn(async () => true)}
        submitError={null}
      />,
    );
    fireEvent.change(textarea(), { target: { value: "plain prose" } });
    assert.strictEqual(checkbox(), null);
    fireEvent.change(textarea(), {
      target: { value: "## Overview\n\none section" },
    });
    assert.strictEqual(checkbox(), null, "a single heading is not a session");
  });

  it("shows a default-checked split checkbox with a live turn count on detection", () => {
    render(
      <AddPlanningSessionDialog
        open
        onClose={vi.fn()}
        onSubmit={vi.fn(async () => true)}
        submitError={null}
      />,
    );
    fireEvent.change(textarea(), {
      target: { value: "## Grok\n\npropose\n\n## Claude\n\ncritique" },
    });
    const box = checkbox();
    assert.ok(box, "split checkbox appears when >= 2 headings match");
    assert.strictEqual(box.checked, true, "split defaults to on");
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
      <AddPlanningSessionDialog
        open
        onClose={vi.fn()}
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

    await waitFor(() => assert.strictEqual(onSubmit.mock.calls.length, 1));
    const layer = onSubmit.mock.calls[0][0];
    assert.deepStrictEqual(
      layer.turns.map((t: { author: string }) => t.author),
      ["Imported", "Grok", "Claude"],
    );
    assert.strictEqual(layer.turns[1].content, "propose");
    assert.strictEqual(layer.turns[2].content, "critique");
  });

  it("offers no split for >=2 headings whose sections are ALL empty and falls back to one lossless Imported turn", async () => {
    // splitTurnsByAuthorHeadings returns [] here; the dialog must normalize
    // that to "no split" (a bare truthiness check would submit turns: [] and
    // persist a turn-less layer).
    const onSubmit = vi.fn(async () => true);
    render(
      <AddPlanningSessionDialog
        open
        onClose={vi.fn()}
        onSubmit={onSubmit}
        submitError={null}
      />,
    );
    const content = "## Grok\n## Claude\n";
    fireEvent.change(textarea(), { target: { value: content } });
    assert.strictEqual(
      checkbox(),
      null,
      "an all-empty split is not offered at all",
    );
    fireEvent.click(button(/Add session/));

    await waitFor(() => assert.strictEqual(onSubmit.mock.calls.length, 1));
    const layer = onSubmit.mock.calls[0][0];
    assert.strictEqual(layer.turns.length, 1, "never a turn-less layer");
    assert.strictEqual(layer.turns[0].author, "Imported");
    assert.strictEqual(layer.turns[0].content, content, "lossless fallback");
  });

  it("keeps the lossless single-Imported-turn behavior when unchecked", async () => {
    const onSubmit = vi.fn(async () => true);
    render(
      <AddPlanningSessionDialog
        open
        onClose={vi.fn()}
        onSubmit={onSubmit}
        submitError={null}
      />,
    );
    const content = "## Grok\n\npropose\n\n## Claude\n\ncritique";
    fireEvent.change(textarea(), { target: { value: content } });
    const box = checkbox();
    assert.ok(box);
    fireEvent.click(box);
    assert.strictEqual(box.checked, false);
    fireEvent.click(button(/Add session/));

    await waitFor(() => assert.strictEqual(onSubmit.mock.calls.length, 1));
    const layer = onSubmit.mock.calls[0][0];
    assert.strictEqual(layer.turns.length, 1);
    assert.strictEqual(layer.turns[0].author, "Imported");
    assert.strictEqual(layer.turns[0].content, content, "lossless");
  });
});
