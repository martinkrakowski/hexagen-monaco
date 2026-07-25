import { describe, it, afterEach } from "vitest";
import assert from "node:assert";
import { useState } from "react";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import { TextareaComposer } from "../TextareaComposer";

afterEach(cleanup);

// A deferred so a test can hold `onSubmit` open and probe in-flight behaviour.
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("TextareaComposer", () => {
  it("renders a textarea and a disabled Send until text is entered", () => {
    render(<TextareaComposer onSubmit={async () => true} />);
    const textarea = screen.getByRole("textbox");
    assert.strictEqual(textarea.tagName, "TEXTAREA");
    const send = screen.getByRole("button", { name: "Send" });
    assert.strictEqual(send.hasAttribute("disabled"), true);

    fireEvent.change(textarea, { target: { value: "hello" } });
    assert.strictEqual(send.hasAttribute("disabled"), false);
  });

  it("submits the trimmed text on Enter", async () => {
    const calls: string[] = [];
    render(
      <TextareaComposer
        onSubmit={async (t) => {
          calls.push(t);
          return true;
        }}
      />,
    );
    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "  plan the auth flow  " } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    await waitFor(() => assert.deepStrictEqual(calls, ["plan the auth flow"]));
  });

  it("does NOT submit on Shift+Enter (newline instead)", async () => {
    const calls: string[] = [];
    render(
      <TextareaComposer
        onSubmit={async (t) => {
          calls.push(t);
          return true;
        }}
      />,
    );
    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "line one" } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
    // give any stray microtask a chance to run
    await Promise.resolve();
    assert.strictEqual(calls.length, 0);
  });

  it("clears the draft when onSubmit resolves true", async () => {
    render(<TextareaComposer onSubmit={async () => true} />);
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "seed text" } });
    fireEvent.keyDown(textarea, { key: "Enter" });
    await waitFor(() => assert.strictEqual(textarea.value, ""));
  });

  it("keeps the draft when onSubmit resolves false (failed send is retryable)", async () => {
    let called = false;
    render(
      <TextareaComposer
        onSubmit={async () => {
          called = true;
          return false;
        }}
      />,
    );
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "seed text" } });
    fireEvent.keyDown(textarea, { key: "Enter" });
    await waitFor(() => assert.strictEqual(called, true));
    assert.strictEqual(textarea.value, "seed text");
  });

  it("ignores whitespace-only input", async () => {
    const calls: string[] = [];
    render(
      <TextareaComposer
        onSubmit={async (t) => {
          calls.push(t);
          return true;
        }}
      />,
    );
    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "   " } });
    fireEvent.keyDown(textarea, { key: "Enter" });
    await Promise.resolve();
    assert.strictEqual(calls.length, 0);
    assert.strictEqual(
      screen.getByRole("button", { name: "Send" }).hasAttribute("disabled"),
      true,
    );
  });

  it("does not double-submit while a request is in flight", async () => {
    const calls: string[] = [];
    const gate = deferred<boolean>();
    render(
      <TextareaComposer
        onSubmit={async (t) => {
          calls.push(t);
          return gate.promise;
        }}
      />,
    );
    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "once" } });
    // two synchronous Enter presses before the first resolves
    fireEvent.keyDown(textarea, { key: "Enter" });
    fireEvent.keyDown(textarea, { key: "Enter" });

    assert.strictEqual(calls.length, 1);
    gate.resolve(true);
    await waitFor(() =>
      assert.strictEqual((textarea as HTMLTextAreaElement).value, ""),
    );
  });

  it("blocks a truly synchronous double-submit (the ref guard is load-bearing)", async () => {
    const calls: string[] = [];
    const gate = deferred<boolean>();
    render(
      <TextareaComposer
        onSubmit={async (t) => {
          calls.push(t);
          return gate.promise;
        }}
      />,
    );
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "once" } });
    // Both keydowns dispatched inside ONE act() batch — no re-render/state
    // flush between them, so isSubmitting is still false on the second press
    // and only the synchronous inFlightRef guard can dedupe. (This fails if the
    // ref guard is removed; the separate-fireEvent test above would not.)
    act(() => {
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    assert.strictEqual(calls.length, 1);
    gate.resolve(true);
    await waitFor(() => assert.strictEqual(textarea.value, ""));
  });

  it("keeps the textarea editable while a request is in flight and shows no Stop", async () => {
    const gate = deferred<boolean>();
    render(<TextareaComposer onSubmit={async () => gate.promise} />);
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "in flight" } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    // Request is pending: unlike ChatComposer, the textarea is NOT disabled…
    assert.strictEqual(textarea.hasAttribute("disabled"), false);
    // …it still accepts edits…
    fireEvent.change(textarea, { target: { value: "still typing" } });
    assert.strictEqual(textarea.value, "still typing");
    // …and there is no Stop affordance.
    assert.strictEqual(screen.queryByRole("button", { name: /stop/i }), null);

    gate.resolve(true);
    // The submit resolves (Send re-enables). The draft typed mid-flight
    // ("still typing") differs from what was submitted ("in flight"), so it is
    // PRESERVED rather than wiped — clearing it would lose the user's text.
    await waitFor(() =>
      assert.strictEqual(
        screen.getByRole("button", { name: "Send" }).hasAttribute("disabled"),
        false,
      ),
    );
    assert.strictEqual(textarea.value, "still typing");
  });

  it("preserves a new draft typed while a submit is in flight", async () => {
    const gate = deferred<boolean>();
    render(<TextareaComposer onSubmit={async () => gate.promise} />);
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "first message" } });
    fireEvent.keyDown(textarea, { key: "Enter" });
    // The user keeps drafting the next message while the request is pending.
    fireEvent.change(textarea, { target: { value: "second draft" } });

    gate.resolve(true);
    // Resolving the FIRST submit must not clobber the newer draft — only the
    // exact text that was submitted is eligible to be cleared.
    await waitFor(() => assert.strictEqual(textarea.value, "second draft"));
    assert.strictEqual(textarea.value, "second draft");
  });

  it("keeps Enter as a normal key (no preventDefault) when a submit would no-op", async () => {
    const calls: string[] = [];
    render(
      <TextareaComposer
        onSubmit={async (t) => {
          calls.push(t);
          return true;
        }}
      />,
    );
    const textarea = screen.getByRole("textbox");
    // Whitespace-only: Enter must fall through to the browser's newline
    // insertion (not preventDefaulted) and must not submit. fireEvent returns
    // false when the event was canceled via preventDefault.
    fireEvent.change(textarea, { target: { value: "   " } });
    const notCanceled = fireEvent.keyDown(textarea, { key: "Enter" });
    assert.strictEqual(notCanceled, true);
    await Promise.resolve();
    assert.strictEqual(calls.length, 0);
  });

  it("preventDefaults Enter only when it will actually submit", () => {
    render(<TextareaComposer onSubmit={async () => true} />);
    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "ready" } });
    // A valid submit swallows the newline: fireEvent returns false (canceled).
    const canceled = fireEvent.keyDown(textarea, { key: "Enter" });
    assert.strictEqual(canceled, false);
  });

  it("does not crash (or leave the composer locked) when onSubmit rejects", async () => {
    render(
      <TextareaComposer
        onSubmit={async () => {
          throw new Error("network down");
        }}
      />,
    );
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "will fail" } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    // The rejection is absorbed: the draft is retained and the composer recovers
    // (Send re-enables), so no unhandled rejection and no permanent lock.
    await waitFor(() =>
      assert.strictEqual(
        screen.getByRole("button", { name: "Send" }).hasAttribute("disabled"),
        false,
      ),
    );
    assert.strictEqual(textarea.value, "will fail");
  });

  it("does not submit when disabled", async () => {
    const calls: string[] = [];
    render(
      <TextareaComposer
        disabled
        onSubmit={async (t) => {
          calls.push(t);
          return true;
        }}
      />,
    );
    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "blocked" } });
    fireEvent.keyDown(textarea, { key: "Enter" });
    await Promise.resolve();
    assert.strictEqual(calls.length, 0);
    assert.strictEqual(
      screen.getByRole("button", { name: "Send" }).hasAttribute("disabled"),
      true,
    );
  });

  // ── Controlled mode (Plan Workbench A2) ────────────────────────────────────
  // The workbench host lifts the draft so a right-pane view switch (which
  // unmounts the composer) can't lose typed text.

  describe("controlled mode (value/onValueChange)", () => {
    it("renders the lifted value and routes typing to onValueChange", () => {
      const changes: string[] = [];
      render(
        <TextareaComposer
          value="lifted draft"
          onValueChange={(v) => changes.push(v)}
          onSubmit={async () => true}
        />,
      );
      const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
      assert.strictEqual(textarea.value, "lifted draft");

      fireEvent.change(textarea, { target: { value: "lifted draft!" } });
      assert.deepStrictEqual(changes, ["lifted draft!"]);
      // Controlled: the DOM value tracks the PROP, which this render never
      // updated — the parent owns the state.
      assert.strictEqual(textarea.value, "lifted draft");
    });

    it('clears via onValueChange("") when onSubmit resolves true', async () => {
      const changes: string[] = [];
      render(
        <TextareaComposer
          value="send me"
          onValueChange={(v) => changes.push(v)}
          onSubmit={async () => true}
        />,
      );
      fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
      await waitFor(() => assert.deepStrictEqual(changes, [""]));
    });

    it("preserves a NEWER lifted draft typed while a submit is in flight", async () => {
      // Controlled twin of the uncontrolled mid-flight test above: the
      // inputRef skip-clear guard must also hold when the draft round-trips
      // through the parent's onValueChange → value re-render.
      const gate = deferred<boolean>();
      const changes: string[] = [];
      function Host() {
        const [value, setValue] = useState("first message");
        return (
          <TextareaComposer
            value={value}
            onValueChange={(v) => {
              changes.push(v);
              setValue(v);
            }}
            onSubmit={async () => gate.promise}
          />
        );
      }
      render(<Host />);
      const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
      fireEvent.keyDown(textarea, { key: "Enter" });
      // The user keeps drafting the next message while the request is pending.
      fireEvent.change(textarea, { target: { value: "second draft" } });
      assert.strictEqual(textarea.value, "second draft");

      gate.resolve(true);
      // Resolving the FIRST submit must not clear the newer lifted draft:
      // only the exact text that was submitted is eligible to be cleared.
      await waitFor(() =>
        assert.strictEqual(
          screen.getByRole("button", { name: "Send" }).hasAttribute("disabled"),
          false,
        ),
      );
      assert.strictEqual(textarea.value, "second draft");
      assert.deepStrictEqual(
        changes,
        ["second draft"],
        'no onValueChange("") clear fired against the newer draft',
      );
    });

    it("keeps the lifted draft when onSubmit resolves false", async () => {
      const changes: string[] = [];
      let called = false;
      render(
        <TextareaComposer
          value="keep me"
          onValueChange={(v) => changes.push(v)}
          onSubmit={async () => {
            called = true;
            return false;
          }}
        />,
      );
      fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
      await waitFor(() => assert.strictEqual(called, true));
      assert.strictEqual(changes.length, 0, "no clear on a failed send");
    });
  });
});
