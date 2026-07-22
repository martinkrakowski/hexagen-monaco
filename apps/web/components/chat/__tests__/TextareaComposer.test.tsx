import { describe, it, afterEach } from "vitest";
import assert from "node:assert";
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
    await waitFor(() => assert.strictEqual(textarea.value, ""));
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
});
