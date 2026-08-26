import { afterEach, describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { LoginScreen } from "../LoginScreen";

afterEach(cleanup);

describe("LoginScreen", () => {
  it("renders the app-sign-in framing, not the old publish framing", () => {
    render(<LoginScreen onSignIn={() => {}} />);
    assert.ok(
      screen.getByRole("heading", { name: /sign in to hexagen-monaco/i }),
    );
    // The 2026-08-25 owner decision: every plan requires an account. The
    // copy carries it so the framing cannot silently drift back.
    assert.ok(screen.getByText(/including the free tier/i));
  });

  it("the button starts sign-in exactly once per click", () => {
    const onSignIn = vi.fn();
    render(<LoginScreen onSignIn={onSignIn} />);
    fireEvent.click(
      screen.getByRole("button", { name: /continue with github/i }),
    );
    assert.equal(onSignIn.mock.calls.length, 1);
  });

  it("busy disables the button — no double OAuth round trips", () => {
    const onSignIn = vi.fn();
    render(<LoginScreen busy onSignIn={onSignIn} />);
    const button = screen.getByRole("button", {
      name: /continue with github/i,
    });
    assert.ok(button.hasAttribute("disabled"));
    fireEvent.click(button);
    assert.equal(onSignIn.mock.calls.length, 0);
  });
});
