import { afterEach, beforeEach, describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { render, screen, waitFor } from "@testing-library/react";

// Stateful nav stub: DoneClient reads `?org=` from useSearchParams.
vi.mock("next/navigation", async () =>
  (
    await import("../../../features/workspace-shell/plan-phase/__tests__/nav-stub")
  ).statefulNavigationMock(),
);

import { navState } from "../../../features/workspace-shell/plan-phase/__tests__/nav-stub";
import { DoneClient } from "../done/DoneClient";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Serve GET /api/orgs and the members listing, counting every call. Each
 * response resolves through a TIMER, not a bare microtask: if the summary
 * effect ever loops (the per-render-adapter bug this suite pins), a
 * microtask-only stub would let that loop starve the event loop and hang the
 * whole run inside act() — a timer tick per cycle keeps waitFor observable,
 * so the regression fails as an assertion instead of a timeout.
 */
function stubOrgFetches() {
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, _init?: RequestInit) => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      const url = String(input);
      if (url === "/api/orgs") {
        return jsonResponse({
          orgs: [
            { id: "org-1", slug: "acme", name: "Acme Robotics", role: "owner" },
          ],
        });
      }
      if (url === "/api/orgs/org-1/members") {
        return jsonResponse({
          members: [{ userId: "u1", role: "owner", createdAt: "x" }],
          pendingInvites: [],
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("DoneClient", () => {
  beforeEach(() => {
    navState.reset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches the summary exactly once, even across extra re-renders", async () => {
    // Deliberately NO injected gateway: this pins the DEFAULT adapter being a
    // stable module-level instance. When it was constructed per render, the
    // summary effect (which depends on it) re-ran after every setSummary
    // re-render — an infinite refetch loop (review flag on #667).
    navState.reset("org=org-1");
    const fetchMock = stubOrgFetches();
    const { rerender } = render(<DoneClient />);
    await waitFor(() => assert.ok(screen.getByText(/acme robotics/i)));
    assert.equal(fetchMock.mock.calls.length, 2); // /api/orgs + members

    rerender(<DoneClient />);
    rerender(<DoneClient />);
    // Let any wrongly re-armed effect fire before counting.
    await waitFor(() => assert.ok(screen.getByText(/acme robotics/i)));
    assert.equal(
      fetchMock.mock.calls.length,
      2,
      "re-renders must not re-run the summary fetch",
    );
  });

  it("personal path (no ?org=) settles without any fetch", async () => {
    // INJECTED gateway here, unlike the test above: the personal path's
    // effect branch is fully synchronous, so reproducing the per-render
    // default under it is a sync effect cascade that hangs act() outright —
    // the org-path test above is the mutation sentinel; this one only pins
    // "no org, no I/O".
    const fetchMock = stubOrgFetches();
    const listOrgs = vi.fn();
    const { rerender } = render(<DoneClient gateway={{ listOrgs } as never} />);
    await waitFor(() => assert.ok(screen.getByText(/personal workspace/i)));
    rerender(<DoneClient gateway={{ listOrgs } as never} />);
    await waitFor(() => assert.ok(screen.getByText(/personal workspace/i)));
    assert.equal(fetchMock.mock.calls.length, 0);
    assert.equal(listOrgs.mock.calls.length, 0);
  });
});
