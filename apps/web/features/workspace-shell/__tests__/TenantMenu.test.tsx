// P-U5: the desktop header's tenant switcher. Auth-gated rendering, org
// selection through the shared module store, and the sign-out wiring.
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

const sessionState = vi.hoisted(() => ({
  status: "unauthenticated" as string,
  user: null as { login?: string; name?: string } | null,
}));
const signOutSpy = vi.hoisted(() => vi.fn());

vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: sessionState.user ? { user: sessionState.user } : null,
    status: sessionState.status,
  }),
  signIn: vi.fn(),
  signOut: signOutSpy,
}));

import type { Result } from "@hexagen/shared";
import type { OrgMembershipSummary } from "../../../lib/platform";
import type { OrgsGatewayError } from "../../../app/lib/adapters/http-orgs.adapter";
import {
  getActiveTenantId,
  setActiveTenantId,
} from "../../../app/lib/active-tenant";
import { TenantProvider } from "../../../app/contexts/TenantContext";
import { TenantMenu } from "../TenantMenu";

const orgA: OrgMembershipSummary = {
  id: "org-a",
  slug: "org-a",
  name: "Acme Robotics",
  role: "member",
};

function orgsPort(orgs: OrgMembershipSummary[]) {
  return {
    async listOrgs(): Promise<
      Result<OrgMembershipSummary[], OrgsGatewayError>
    > {
      return { success: true, value: orgs };
    },
  };
}

function renderMenu(orgs: OrgMembershipSummary[] = [orgA]) {
  return render(
    <TenantProvider orgsPort={orgsPort(orgs)}>
      <TenantMenu />
    </TenantProvider>,
  );
}

beforeEach(() => {
  sessionState.status = "authenticated";
  sessionState.user = { login: "martin", name: "Martin K" };
  setActiveTenantId(null);
  signOutSpy.mockClear();
});

afterEach(() => {
  cleanup();
  setActiveTenantId(null);
});

describe("TenantMenu", () => {
  it("renders nothing when unauthenticated", async () => {
    sessionState.status = "unauthenticated";
    sessionState.user = null;
    const { container } = renderMenu();
    // Flush the provider's mount-time org fetch so its setState lands
    // inside act; the menu must still render nothing afterwards.
    await act(async () => {});
    assert.equal(container.textContent, "");
  });

  it("renders nothing without a TenantProvider (wizard chrome mounts Header alone)", () => {
    const { container } = render(<TenantMenu />);
    assert.equal(container.textContent, "");
  });

  it("authenticated: shows the personal login as the current tenant", async () => {
    renderMenu();
    await waitFor(
      () => assert.ok(screen.getByRole("group")), // <details> maps to role "group"
    );
    assert.ok(screen.getByLabelText("Tenant: martin"));
  });

  it("selecting an org switches the shared store; selecting Personal switches back", async () => {
    renderMenu();
    await waitFor(() =>
      assert.ok(screen.getByRole("button", { name: /acme robotics/i })),
    );

    fireEvent.click(screen.getByRole("button", { name: /acme robotics/i }));
    assert.equal(getActiveTenantId(), "org-a");
    // The summary now names the org.
    assert.ok(screen.getByLabelText("Tenant: Acme Robotics"));

    fireEvent.click(screen.getByRole("button", { name: /martin.*personal/i }));
    assert.equal(getActiveTenantId(), null);
  });

  it("shows the caller's role on each org row", async () => {
    renderMenu();
    await waitFor(() => assert.ok(screen.getByText("member")));
  });

  it("Sign out calls next-auth signOut with the /login callback", async () => {
    renderMenu();
    await waitFor(() =>
      assert.ok(screen.getByRole("button", { name: /sign out/i })),
    );
    fireEvent.click(screen.getByRole("button", { name: /sign out/i }));
    assert.equal(signOutSpy.mock.calls.length, 1);
    assert.deepEqual(signOutSpy.mock.calls[0][0], { callbackUrl: "/login" });
  });

  it("links to the Account page", async () => {
    renderMenu();
    await waitFor(() => {
      const link = screen.getByRole("link", { name: /account/i });
      assert.equal(link.getAttribute("href"), "/account");
    });
  });
});
