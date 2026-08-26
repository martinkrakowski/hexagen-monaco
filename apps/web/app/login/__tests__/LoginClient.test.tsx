import { beforeEach, describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { render, screen } from "@testing-library/react";

// Session state is per-test; the global next/navigation stub provides an
// inert useSearchParams (empty), which is exactly the no-callbackUrl case.
const sessionState: { status: string } = { status: "unauthenticated" };
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: null, status: sessionState.status }),
  signIn: vi.fn(),
}));

import { LoginClient, safeCallbackUrl } from "../LoginClient";

describe("safeCallbackUrl — the open-redirect gate", () => {
  it("keeps same-origin relative paths", () => {
    assert.equal(safeCallbackUrl("/projects/history"), "/projects/history");
  });

  it("refuses everything else, falling back to the front door", () => {
    for (const raw of [
      null,
      "",
      "//evil.example",
      "/\\evil.example", // backslash normalizes to "//" in browser URL parsing
      "https://evil.example/x",
      "javascript:alert(1)",
    ]) {
      assert.equal(safeCallbackUrl(raw), "/projects/new", String(raw));
    }
  });
});

describe("LoginClient", () => {
  beforeEach(() => {
    sessionState.status = "unauthenticated";
  });

  it("unauthenticated: renders the login screen, does not navigate", () => {
    const replace = vi.fn();
    render(<LoginClient router={{ replace }} />);
    assert.ok(screen.getByRole("button", { name: /continue with github/i }));
    assert.equal(replace.mock.calls.length, 0);
  });

  it("authenticated: bounces away with replace (Back must not return here)", () => {
    sessionState.status = "authenticated";
    const replace = vi.fn();
    const { container } = render(<LoginClient router={{ replace }} />);
    assert.equal(replace.mock.calls.length, 1);
    assert.equal(replace.mock.calls[0][0], "/projects/new");
    assert.equal(container.textContent, "");
  });
});
