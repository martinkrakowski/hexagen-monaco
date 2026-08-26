import { describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { fireEvent, render, screen } from "@testing-library/react";

import { DoneStep } from "../DoneStep";

describe("DoneStep", () => {
  it("renders the org summary re-derived by the container", () => {
    render(
      <DoneStep
        summary={{
          org: {
            name: "Acme Robotics",
            slug: "acme-robotics",
            memberCount: 1,
            pendingInviteCount: 2,
          },
        }}
        onGoToWorkspace={() => {}}
      />,
    );
    assert.ok(screen.getByText(/acme robotics/i));
    assert.ok(screen.getByText(/1 member$/i));
    assert.ok(screen.getByText(/2 pending invites/i));
  });

  it("renders the personal-workspace summary when no org was created", () => {
    render(<DoneStep summary={{ org: null }} onGoToWorkspace={() => {}} />);
    assert.ok(screen.getByText(/personal workspace/i));
  });

  it("keeps 'Go to your workspace' live even when the summary fetch failed", () => {
    const onGoToWorkspace = vi.fn();
    render(
      <DoneStep
        validationMessage="Couldn't load your organization summary"
        onGoToWorkspace={onGoToWorkspace}
      />,
    );
    assert.ok(screen.getByRole("status"));
    fireEvent.click(
      screen.getByRole("button", { name: /go to your workspace/i }),
    );
    assert.equal(onGoToWorkspace.mock.calls.length, 1);
  });
});
