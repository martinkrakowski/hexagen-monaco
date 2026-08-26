// P-U5: TenantProvider — the React face of the module-level active-tenant
// store. Pins the two behaviors that keep a stale selection from rendering
// another tenant's UI: the reset-to-personal gate, and the focus refresh.
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { act, render, screen, waitFor, cleanup } from "@testing-library/react";
import type { Result } from "@hexagen/shared";
import type { OrgMembershipSummary } from "../../lib/platform";
import type { OrgsGatewayError } from "../lib/adapters/http-orgs.adapter";
import { getActiveTenantId, setActiveTenantId } from "../lib/active-tenant";
import { TenantProvider, useTenant } from "./TenantContext";

const orgA: OrgMembershipSummary = {
  id: "org-a",
  slug: "org-a",
  name: "Org A",
  role: "owner",
};

type ListResult = Result<OrgMembershipSummary[], OrgsGatewayError>;

function listPort(results: ListResult[]) {
  let call = 0;
  return {
    calls: () => call,
    async listOrgs(): Promise<ListResult> {
      const result = results[Math.min(call, results.length - 1)];
      call += 1;
      return result;
    },
  };
}

function Probe() {
  const { activeTenantId, orgs } = useTenant();
  return (
    <div>
      <span data-testid="active">{activeTenantId ?? "personal"}</span>
      <span data-testid="org-count">{orgs.length}</span>
    </div>
  );
}

beforeEach(() => {
  setActiveTenantId(null);
});

afterEach(() => {
  cleanup();
  setActiveTenantId(null);
  vi.restoreAllMocks();
});

describe("TenantProvider", () => {
  it("fetches orgs on mount and exposes the module store's selection", async () => {
    const port = listPort([{ success: true, value: [orgA] }]);
    render(
      <TenantProvider orgsPort={port}>
        <Probe />
      </TenantProvider>,
    );
    await waitFor(() =>
      assert.equal(screen.getByTestId("org-count").textContent, "1"),
    );
    assert.equal(screen.getByTestId("active").textContent, "personal");

    act(() => setActiveTenantId("org-a"));
    assert.equal(screen.getByTestId("active").textContent, "org-a");
  });

  it("resets a stale persisted selection (not in the fetched list) to personal, with a warning", async () => {
    setActiveTenantId("org-revoked");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const port = listPort([{ success: true, value: [orgA] }]);
    render(
      <TenantProvider orgsPort={port}>
        <Probe />
      </TenantProvider>,
    );
    await waitFor(() =>
      assert.equal(screen.getByTestId("active").textContent, "personal"),
    );
    assert.equal(getActiveTenantId(), null);
    assert.ok(
      warn.mock.calls.some((call) => String(call[0]).includes("org-revoked")),
    );
  });

  it("keeps a valid selection when the fetched list contains it", async () => {
    setActiveTenantId("org-a");
    const port = listPort([{ success: true, value: [orgA] }]);
    render(
      <TenantProvider orgsPort={port}>
        <Probe />
      </TenantProvider>,
    );
    await waitFor(() =>
      assert.equal(screen.getByTestId("org-count").textContent, "1"),
    );
    assert.equal(getActiveTenantId(), "org-a");
  });

  it("a FAILED fetch does not reset the selection (no basis to distrust it)", async () => {
    setActiveTenantId("org-a");
    const port = listPort([
      {
        success: false,
        error: { kind: "network", message: "offline" },
      },
    ]);
    render(
      <TenantProvider orgsPort={port}>
        <Probe />
      </TenantProvider>,
    );
    await waitFor(() => assert.ok(port.calls() >= 1));
    assert.equal(getActiveTenantId(), "org-a");
  });

  it("refreshes the org list on window focus (membership can change elsewhere)", async () => {
    const port = listPort([
      { success: true, value: [] },
      { success: true, value: [orgA] },
    ]);
    render(
      <TenantProvider orgsPort={port}>
        <Probe />
      </TenantProvider>,
    );
    await waitFor(() => assert.ok(port.calls() >= 1));
    assert.equal(screen.getByTestId("org-count").textContent, "0");

    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() =>
      assert.equal(screen.getByTestId("org-count").textContent, "1"),
    );
    assert.equal(port.calls(), 2);
  });
});
