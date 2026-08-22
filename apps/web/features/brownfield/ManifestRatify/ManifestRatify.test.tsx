/**
 * S4 boundary.
 *
 * jest-dom is not registered in `apps/web/vitest.setup.ts` — assertions use
 * `toBeTruthy()`/`getAttribute()`.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ManifestRatify } from "./ManifestRatify";
import type { BrownfieldManifestDraft } from "../BrownfieldFlow/types";

function draftOf(
  overrides: Partial<BrownfieldManifestDraft> = {},
): BrownfieldManifestDraft {
  return {
    system: "Acme Platform",
    scope: "acme",
    architecture: "modular-monolith",
    contexts: [
      {
        name: "orders",
        include: true,
        type: "core",
        description: "",
        dependsOn: [],
      },
    ],
    ...overrides,
  };
}

function renderRatify(draft: BrownfieldManifestDraft = draftOf()) {
  const onDraftChange = vi.fn();
  const onRatify = vi.fn();
  const onBack = vi.fn();

  render(
    <ManifestRatify
      draft={draft}
      onDraftChange={onDraftChange}
      onBack={onBack}
      onRatify={onRatify}
    />,
  );

  return { onDraftChange, onRatify, onBack };
}

describe("ManifestRatify", () => {
  it("keeps the draft controlled — every edit leaves the component", async () => {
    const user = userEvent.setup();
    const draft = draftOf({ scope: "acm" });
    const { onDraftChange } = renderRatify(draft);

    await user.type(screen.getByLabelText("npm scope"), "e");

    // The whole next draft, not a patch: the flow reducer owns it, so walking
    // back to S3 and returning cannot fork it.
    expect(onDraftChange).toHaveBeenCalledWith({ ...draft, scope: "acme" });
  });

  it("stores the scope verbatim and defers sanitizing to the payload", async () => {
    const user = userEvent.setup();
    const draft = draftOf({ scope: "@Acme" });
    const { onDraftChange } = renderRatify(draft);

    await user.type(screen.getByLabelText("npm scope"), "!");

    expect(onDraftChange).toHaveBeenCalledWith({ ...draft, scope: "@Acme!" });
  });

  it("hands the host the sanitized payload AND the draft as typed", async () => {
    const user = userEvent.setup();
    const draft = draftOf({ scope: "@Acme Corp!" });
    const { onRatify } = renderRatify(draft);

    await user.click(screen.getByRole("button", { name: /Continue/ }));

    expect(onRatify).toHaveBeenCalledTimes(1);
    const [payload, echoed] = onRatify.mock.calls[0] as [
      { scope: string; contexts: readonly unknown[] },
      BrownfieldManifestDraft,
    ];

    expect(payload.scope).toBe("acme-corp");
    expect(payload.contexts.length).toBe(1);
    // The draft goes back unchanged so returning to this screen shows what the
    // user typed, not what we normalised.
    expect(echoed.scope).toBe("@Acme Corp!");
  });

  it("does not ratify a draft the validator rejects", async () => {
    const user = userEvent.setup();
    const { onRatify } = renderRatify(
      draftOf({
        contexts: [
          {
            name: "orders",
            include: false,
            type: "core",
            description: "",
            dependsOn: [],
          },
        ],
      }),
    );

    await user.click(screen.getByRole("button", { name: /Continue/ }));

    expect(onRatify).not.toHaveBeenCalled();
  });

  it("passes Back straight through — it does not decide what Back means", async () => {
    const user = userEvent.setup();
    const { onBack, onRatify, onDraftChange } = renderRatify();

    await user.click(
      screen.getByRole("button", { name: /Back to the layout/ }),
    );

    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onRatify).not.toHaveBeenCalled();
    expect(onDraftChange).not.toHaveBeenCalled();
  });

  it("ratifying is the end of its job — no navigation, no fetch", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    try {
      const { onRatify } = renderRatify();

      await user.click(screen.getByRole("button", { name: /Continue/ }));

      // The success arm hands the payload up and stops. Which screen comes next
      // is the state machine's call (`RATIFY_MANIFEST` carries the fresh-finding
      // count, and a zero skips `findings_review`), so a router.push here would
      // give the flow two disagreeing ideas of where the user is.
      expect(onRatify).toHaveBeenCalledTimes(1);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("re-derives the preview and the gate from the draft it is given", () => {
    renderRatify(draftOf({ scope: "@Acme Corp!" }));

    expect(screen.getAllByText("acme-corp").length).toBeGreaterThan(0);
    expect(
      (screen.getByRole("button", { name: /Continue/ }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });
});
