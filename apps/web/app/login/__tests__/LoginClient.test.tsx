import { afterEach, beforeEach, describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { render, screen, waitFor } from "@testing-library/react";

// Session state is per-test; the global next/navigation stub provides an
// inert useSearchParams (empty), which is exactly the no-callbackUrl case.
const sessionState: { status: string } = { status: "unauthenticated" };
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: null, status: sessionState.status }),
  signIn: vi.fn(),
}));

import { LoginClient, safeCallbackUrl } from "../LoginClient";

/** Stub the onboarding-status GET the authenticated bounce now performs. */
function stubOnboardingFetch(onboardedAt: string | null) {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ onboardedAt }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    ),
  );
}

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

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("unauthenticated: renders the login screen, does not navigate", () => {
    const replace = vi.fn();
    render(<LoginClient router={{ replace }} />);
    assert.ok(screen.getByRole("button", { name: /continue with github/i }));
    assert.equal(replace.mock.calls.length, 0);
  });

  // The authenticated bounce is now a three-way: never-onboarded accounts go
  // through the onboarding wizard first (P-U4); everyone else — including
  // anyone whose status GET failed — goes to callbackUrl, because the check
  // must never strand a signed-in user on /login.

  it("authenticated + onboardedAt null: bounces into the onboarding wizard", async () => {
    sessionState.status = "authenticated";
    stubOnboardingFetch(null);
    const replace = vi.fn();
    const { container } = render(<LoginClient router={{ replace }} />);
    await waitFor(() =>
      assert.deepEqual(replace.mock.calls, [["/onboarding/welcome"]]),
    );
    assert.equal(container.textContent, "");
  });

  it("authenticated + already onboarded: bounces to callbackUrl with replace", async () => {
    sessionState.status = "authenticated";
    stubOnboardingFetch("2026-08-01T00:00:00.000Z");
    const replace = vi.fn();
    const { container } = render(<LoginClient router={{ replace }} />);
    await waitFor(() =>
      assert.deepEqual(replace.mock.calls, [["/projects/new"]]),
    );
    assert.equal(container.textContent, "");
  });

  it("authenticated + status fetch fails: falls back to callbackUrl", async () => {
    sessionState.status = "authenticated";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    const replace = vi.fn();
    render(<LoginClient router={{ replace }} />);
    await waitFor(() =>
      assert.deepEqual(replace.mock.calls, [["/projects/new"]]),
    );
  });
});
