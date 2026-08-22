/**
 * S4 presentation.
 *
 * jest-dom is a dependency but `apps/web/vitest.setup.ts` does not import it, so
 * `toBeInTheDocument`/`toHaveAttribute` are NOT registered — assertions here use
 * `toBeTruthy()`, `toBeNull()` and `getAttribute()`.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ManifestRatifyView } from "./ManifestRatifyView";
import type { ManifestRatifyViewProps } from "./ManifestRatifyView";
import { validateManifestDraft } from "./manifest-draft";
import { previewScope } from "./scope-preview";
import type {
  BrownfieldManifestContextDraft,
  BrownfieldManifestDraft,
} from "../BrownfieldFlow/types";

function contextOf(
  overrides: Partial<BrownfieldManifestContextDraft> = {},
): BrownfieldManifestContextDraft {
  return {
    name: "orders",
    include: true,
    type: "core",
    description: "",
    dependsOn: [],
    ...overrides,
  };
}

function draftOf(
  overrides: Partial<BrownfieldManifestDraft> = {},
): BrownfieldManifestDraft {
  return {
    system: "Acme Platform",
    scope: "acme",
    architecture: "modular-monolith",
    contexts: [contextOf({ name: "orders" }), contextOf({ name: "billing" })],
    ...overrides,
  };
}

type Handlers = Pick<
  ManifestRatifyViewProps,
  | "onChangeSystem"
  | "onChangeScope"
  | "onChangeArchitecture"
  | "onPatchContext"
  | "onToggleDependency"
  | "onBack"
  | "onContinue"
>;

function renderView(draft: BrownfieldManifestDraft = draftOf()) {
  const handlers: Handlers = {
    onChangeSystem: vi.fn(),
    onChangeScope: vi.fn(),
    onChangeArchitecture: vi.fn(),
    onPatchContext: vi.fn(),
    onToggleDependency: vi.fn(),
    onBack: vi.fn(),
    onContinue: vi.fn(),
  };

  render(
    <ManifestRatifyView
      draft={draft}
      scopePreview={previewScope(draft.scope)}
      problems={validateManifestDraft(draft)}
      {...handlers}
    />,
  );

  return handlers;
}

describe("the scope preview", () => {
  it("shows what will be written before the user commits to it", () => {
    renderView(draftOf({ scope: "@Acme Corp!" }));

    // The value the manifest gets, on screen at the same time as the value the
    // user typed — which is the whole reason this screen previews rather than
    // silently sanitizing on submit.
    expect(screen.getAllByText("acme-corp").length).toBeGreaterThan(0);
    expect((screen.getByLabelText("npm scope") as HTMLInputElement).value).toBe(
      "@Acme Corp!",
    );
  });

  it("names each rule that fired rather than leaving the user to diff strings", () => {
    renderView(draftOf({ scope: "@Acme Corp!" }));

    expect(document.body.textContent).toMatch(/npm scopes are lower-case/);
    expect(document.body.textContent).toMatch(/the leading @ is added back/);
    expect(document.body.textContent).toMatch(
      /cannot start or end with a separator/,
    );
  });

  it("says so plainly when nothing had to change", () => {
    renderView(draftOf({ scope: "acme" }));

    expect(document.body.textContent).toMatch(/Exactly what you typed/);
  });

  it("shows no preview at all for an empty field", () => {
    renderView(draftOf({ scope: "" }));

    expect(document.body.textContent).not.toMatch(/Written to the manifest as/);
  });

  it("updates politely, so a screen reader is not interrupted mid-word", () => {
    renderView(draftOf({ scope: "@Acme Corp!" }));

    const live = document.querySelector('[aria-live="polite"]');
    expect(live).toBeTruthy();
    expect(live?.textContent).toMatch(/acme-corp/);
  });

  it("never rewrites the field under the cursor", async () => {
    const user = userEvent.setup();
    const handlers = renderView(draftOf({ scope: "ac" }));

    await user.type(screen.getByLabelText("npm scope"), "!");

    // The raw keystroke is what leaves the view. Sanitizing here would move the
    // caret and hide the transform the preview exists to show.
    expect(handlers.onChangeScope).toHaveBeenCalledWith("ac!");
  });
});

describe("the context grid", () => {
  it("renders one row per candidate, with a caption for the table list", () => {
    renderView();

    expect(
      screen.getByRole("table", {
        name: /Candidate bounded contexts/,
      }),
    ).toBeTruthy();
    expect(screen.getByLabelText("Name of context 1")).toBeTruthy();
    expect(screen.getByLabelText("Name of context 2")).toBeTruthy();
  });

  it("raises an include intent addressed by index, not by name", async () => {
    const user = userEvent.setup();
    const handlers = renderView();

    await user.click(
      screen.getByRole("checkbox", {
        name: "Include billing in the manifest",
      }),
    );

    expect(handlers.onPatchContext).toHaveBeenCalledWith(1, { include: false });
  });

  it("offers every context type hexagen writes", () => {
    renderView();

    const select = screen.getByLabelText("Type of orders") as HTMLSelectElement;
    expect(select.options.length).toBe(5);
  });

  it("starts every dependency edge unticked — bootstrap infers none", async () => {
    const user = userEvent.setup();
    renderView();

    await user.click(
      screen.getByRole("button", { name: "Dependencies of orders" }),
    );

    const edge = screen.getByRole("checkbox", {
      name: "orders depends on billing",
    }) as HTMLInputElement;
    expect(edge.checked).toBe(false);
  });

  it("raises a dependency intent naming both ends of the edge", async () => {
    const user = userEvent.setup();
    const handlers = renderView();

    await user.click(
      screen.getByRole("button", { name: "Dependencies of orders" }),
    );
    await user.click(
      screen.getByRole("checkbox", { name: "orders depends on billing" }),
    );

    expect(handlers.onToggleDependency).toHaveBeenCalledWith(
      0,
      "billing",
      true,
    );
  });

  it("explains an empty dependency panel instead of showing an empty box", async () => {
    const user = userEvent.setup();
    renderView(draftOf({ contexts: [contextOf({ name: "orders" })] }));

    await user.click(
      screen.getByRole("button", { name: "Dependencies of orders" }),
    );

    expect(document.body.textContent).toMatch(/nothing to depend on/);
  });

  it("shows an empty state, not an empty table, when the scan found nothing", () => {
    renderView(draftOf({ contexts: [] }));

    expect(document.body.textContent).toMatch(
      /No candidate contexts came out of the scan/,
    );
    expect(screen.queryByRole("table")).toBeNull();
  });
});

describe("the ratify gate", () => {
  it("lets a complete draft through", () => {
    renderView();

    const button = screen.getByRole("button", {
      name: /Continue/,
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
  });

  it("blocks zero included contexts, and says why", () => {
    renderView(
      draftOf({
        contexts: [
          contextOf({ name: "orders", include: false }),
          contextOf({ name: "billing", include: false }),
        ],
      }),
    );

    const button = screen.getByRole("button", {
      name: /Continue/,
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(document.body.textContent).toMatch(
      /Include at least one bounded context/,
    );
  });

  it("blocks a nameless system and points the field at the message", () => {
    renderView(draftOf({ system: "" }));

    const field = screen.getByLabelText("System name");
    const describedBy = field.getAttribute("aria-describedby");

    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy as string)?.textContent).toMatch(
      /Give the system a name/,
    );
  });

  it("blocks an edge into a context the user excluded", () => {
    renderView(
      draftOf({
        contexts: [
          contextOf({ name: "orders", dependsOn: ["billing"] }),
          contextOf({ name: "billing", include: false }),
        ],
      }),
    );

    expect(document.body.textContent).toMatch(
      /"orders" depends on "billing", which is not an included context/,
    );
  });

  it("does not rely on the grey button to explain itself", () => {
    renderView(draftOf({ system: "", scope: "" }));

    // A disabled control with no stated reason is a dead end; the count is what
    // tells a user who scrolled past the inline messages to go back up.
    expect(document.body.textContent).toMatch(
      /2 things still have to be settled/,
    );
  });

  it("counts what is included and what is not", () => {
    renderView(
      draftOf({
        contexts: [
          contextOf({ name: "orders" }),
          contextOf({ name: "billing", include: false }),
        ],
      }),
    );

    const tally = screen.getByRole("list", { name: "Context tally" });
    expect(tally.textContent).toMatch(/1 included/);
    expect(tally.textContent).toMatch(/1 excluded/);
  });

  it("offers a way back to the layout step", async () => {
    const user = userEvent.setup();
    const handlers = renderView();

    await user.click(
      screen.getByRole("button", { name: /Back to the layout/ }),
    );

    expect(handlers.onBack).toHaveBeenCalledTimes(1);
  });
});

describe("the architecture pick", () => {
  it("offers the three architectures hexagen writes, as one radiogroup", () => {
    renderView();

    expect(
      screen.getByRole("radiogroup", { name: "Architecture" }),
    ).toBeTruthy();
    expect(screen.getAllByRole("radio").length).toBe(3);
  });

  it("raises the picked architecture", async () => {
    const user = userEvent.setup();
    const handlers = renderView();

    await user.click(screen.getByRole("radio", { name: /Microservices/ }));

    expect(handlers.onChangeArchitecture).toHaveBeenCalledWith("microservices");
  });

  it("selects nothing rather than guessing when the draft carries a value it does not offer", () => {
    renderView(draftOf({ architecture: "serverless" }));

    const checked = screen
      .getAllByRole("radio")
      .filter((radio) => (radio as HTMLInputElement).checked);
    expect(checked.length).toBe(0);
  });
});
