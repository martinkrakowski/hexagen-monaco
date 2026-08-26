import { describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { fireEvent, render, screen, within } from "@testing-library/react";

import type { OrgInviteReceipt } from "@/lib/adapters/http-orgs.adapter";
import { INVITE_STATUS_COPY, InvitesStep } from "../InvitesStep";

function renderStep(
  overrides: Partial<Parameters<typeof InvitesStep>[0]> = {},
) {
  const handlers = {
    onInvite: vi.fn(),
    onBack: vi.fn(),
    onContinue: vi.fn(),
    onSkip: vi.fn(),
  };
  render(<InvitesStep invites={[]} {...handlers} {...overrides} />);
  return handlers;
}

const EXPIRES = "2026-09-08T12:00:00.000Z";

describe("InvitesStep", () => {
  it("Invite submits the trimmed handle with the selected role", () => {
    const handlers = renderStep();
    fireEvent.change(screen.getByLabelText(/github handle/i), {
      target: { value: "  octocat  " },
    });
    fireEvent.change(screen.getByLabelText(/^role$/i), {
      target: { value: "owner" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^invite$/i }));
    assert.deepEqual(handlers.onInvite.mock.calls, [["octocat", "owner"]]);
    // The field clears for the next handle.
    assert.equal(
      (screen.getByLabelText(/github handle/i) as HTMLInputElement).value,
      "",
    );
  });

  it("Invite is disabled for an empty handle", () => {
    const handlers = renderStep();
    const invite = screen.getByRole("button", { name: /^invite$/i });
    assert.ok(invite.hasAttribute("disabled"));
    fireEvent.click(invite);
    assert.equal(handlers.onInvite.mock.calls.length, 0);
  });

  it("renders each 202 receipt with the receipt's expiry", () => {
    renderStep({
      invites: [{ githubLogin: "octocat", role: "member", expiresAt: EXPIRES }],
    });
    const list = screen.getByRole("list", { name: /pending invites/i });
    const [entry] = within(list).getAllByRole("listitem");
    assert.match(entry.textContent ?? "", /octocat/);
    assert.ok(entry.textContent?.includes(INVITE_STATUS_COPY));
    assert.match(
      entry.textContent ?? "",
      new RegExp(new Date(EXPIRES).toLocaleDateString()),
    );
  });

  it("anti-enumeration: entry copy is IDENTICAL for different handles", () => {
    // The server answers 202 whether or not the handle has an account here
    // (D-A4); the UI must not re-introduce the distinction. Two receipts for
    // two different handles must render character-identical copy once the
    // handle itself is removed.
    const invites: OrgInviteReceipt[] = [
      { githubLogin: "definitely-exists", role: "member", expiresAt: EXPIRES },
      { githubLogin: "no-such-user-xyz", role: "member", expiresAt: EXPIRES },
    ];
    renderStep({ invites });
    const list = screen.getByRole("list", { name: /pending invites/i });
    const entries = within(list).getAllByRole("listitem");
    assert.equal(entries.length, 2);
    // Compare the two COPY lines (identity line with the handle masked, and
    // the status line verbatim). The avatar initials are excluded on purpose:
    // they derive from the handle itself, not from whether it has an account.
    const copyLines = (entry: HTMLElement, handle: string) =>
      Array.from(entry.querySelectorAll("p")).map((p) =>
        (p.textContent ?? "").split(handle).join("<handle>"),
      );
    assert.deepEqual(
      copyLines(entries[0], invites[0].githubLogin),
      copyLines(entries[1], invites[1].githubLogin),
      "invite entries must read identically regardless of whether the handle has an account",
    );
  });

  it("Continue and Skip setup raise their callbacks", () => {
    const handlers = renderStep();
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    fireEvent.click(screen.getByRole("button", { name: /skip setup/i }));
    assert.equal(handlers.onContinue.mock.calls.length, 1);
    assert.equal(handlers.onSkip.mock.calls.length, 1);
  });
});
