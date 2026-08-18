import { describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { SignInPage } from "../SignInPage";

const signIn = vi.fn();
vi.mock("next-auth/react", () => ({
  signIn: (...args: unknown[]) => signIn(...args),
}));

describe("SignInPage", () => {
  it("renders the GitHub sign-in action with design-system primitives", () => {
    render(<SignInPage callbackUrl="/projects" />);
    assert.ok(screen.getByRole("heading", { name: "Sign in" }));
    const button = screen.getByRole("button", {
      name: /continue with github/i,
    });
    fireEvent.click(button);
    assert.equal(signIn.mock.calls.length, 1);
    assert.equal(signIn.mock.calls[0]?.[0], "github");
    assert.deepEqual(signIn.mock.calls[0]?.[1], { callbackUrl: "/projects" });
  });
});
