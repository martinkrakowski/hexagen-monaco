import { beforeEach, afterEach, describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// Stateful nav stub: the replay test needs a real `?org=` in useSearchParams
// and assertable push/replace logs — the lazy factory form, vi.mock is
// hoisted.
vi.mock("next/navigation", async () =>
  (
    await import("../../../features/workspace-shell/plan-phase/__tests__/nav-stub")
  ).statefulNavigationMock(),
);

import { navState } from "../../../features/workspace-shell/plan-phase/__tests__/nav-stub";
import type { HttpOrgsAdapter } from "../../lib/adapters/http-orgs.adapter";
import { OrgClient } from "../org/OrgClient";

type Gateway = Pick<HttpOrgsAdapter, "createOrg" | "listOrgs">;

const conflict = {
  success: false,
  error: { kind: "conflict", message: "org slug 'acme-robotics' exists" },
} as const;

function makeGateway(overrides: Partial<Gateway> = {}): Gateway {
  return {
    createOrg: vi.fn(async () => ({
      success: true as const,
      value: {
        id: "org-9",
        slug: "acme-robotics",
        name: "Acme Robotics",
        createdBy: "u1",
        createdAt: "2026-08-25T00:00:00.000Z",
      },
    })),
    listOrgs: vi.fn(async () => ({ success: true as const, value: [] })),
    ...overrides,
  } as Gateway;
}

function submitOrgForm() {
  fireEvent.change(screen.getByLabelText(/organization name/i), {
    target: { value: "Acme Robotics" },
  });
  fireEvent.click(screen.getByRole("button", { name: /create organization/i }));
}

describe("OrgClient", () => {
  beforeEach(() => {
    navState.reset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("create success carries the new org id forward via ?org=", async () => {
    render(<OrgClient gateway={makeGateway()} />);
    submitOrgForm();
    await waitFor(() =>
      assert.deepEqual(navState.pushCalls, ["/onboarding/team?org=org-9"]),
    );
  });

  it("409 with ?org= already carried: continues forward, no double-create", async () => {
    // Replay (refresh / Back onto a submitted form): the unique index already
    // prevents the duplicate; the container must treat "conflict + already
    // carried" as done and move on rather than erroring.
    navState.reset("org=org-1");
    const gateway = makeGateway({ createOrg: vi.fn(async () => conflict) });
    render(<OrgClient gateway={gateway} />);
    submitOrgForm();
    await waitFor(() =>
      assert.deepEqual(navState.pushCalls, ["/onboarding/team?org=org-1"]),
    );
    assert.equal(
      (gateway.listOrgs as ReturnType<typeof vi.fn>).mock.calls.length,
      0,
      "the carried id already answers the question — no listOrgs round-trip",
    );
  });

  it("409 where listOrgs shows the caller owns that slug: continues forward", async () => {
    const gateway = makeGateway({
      createOrg: vi.fn(async () => conflict),
      listOrgs: vi.fn(async () => ({
        success: true as const,
        value: [
          {
            id: "org-7",
            slug: "acme-robotics",
            name: "Acme",
            role: "owner" as const,
          },
        ],
      })),
    });
    render(<OrgClient gateway={gateway} />);
    submitOrgForm();
    await waitFor(() =>
      assert.deepEqual(navState.pushCalls, ["/onboarding/team?org=org-7"]),
    );
  });

  it("409 that is genuinely someone else's slug: surfaces 'taken', stays put", async () => {
    const gateway = makeGateway({ createOrg: vi.fn(async () => conflict) });
    render(<OrgClient gateway={gateway} />);
    submitOrgForm();
    await waitFor(() =>
      assert.match(
        screen.getByRole("alert").textContent ?? "",
        /taken — pick another/i,
      ),
    );
    assert.deepEqual(navState.pushCalls, []);
  });

  it("Skip setup POSTs onboarding completion then replaces to /projects/new", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(
          JSON.stringify({ onboardedAt: "2026-08-25T00:00:00.000Z" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<OrgClient gateway={makeGateway()} />);
    fireEvent.click(screen.getByRole("button", { name: /skip setup/i }));
    await waitFor(() =>
      assert.deepEqual(navState.replaceCalls, ["/projects/new"]),
    );
    const completionCall = fetchMock.mock.calls.find(
      ([url]) => url === "/api/account/onboarding",
    );
    assert.ok(completionCall, "skip must POST /api/account/onboarding");
    assert.equal(completionCall[1]?.method, "POST");
  });
});
