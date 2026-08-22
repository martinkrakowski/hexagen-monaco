import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  LayoutRatifyFooterActions,
  LayoutRatifyView,
} from "./LayoutRatifyView";
import {
  buildLayoutRatifyRows,
  renameContext,
  setContextIncluded,
  validateLayoutRows,
  type DetectedPackageSummary,
  type LayoutRatifyRow,
} from "./layout-draft";

// jest-dom is a dependency but apps/web/vitest.setup.ts does not import it, so
// toBeInTheDocument/toHaveAttribute are NOT registered. Assertions here use
// toBeTruthy()/toBeNull()/getAttribute() instead.

function detected(): DetectedPackageSummary[] {
  return [
    {
      root: "packages/orders",
      name: "orders",
      layers: {
        domain: ["src/domain"],
        infrastructure: ["src/db", "src/http"],
      },
    },
    {
      root: "packages/billing",
      name: "billing",
      layers: { domain: ["src/core"] },
    },
    { root: "packages/eslint-config", name: "eslint-config", layers: {} },
  ];
}

function renderView(
  rows: readonly LayoutRatifyRow[] = buildLayoutRatifyRows(detected()),
) {
  const handlers = {
    onToggleInclude: vi.fn(),
    onRenameContext: vi.fn(),
    onLayerDirectoriesChange: vi.fn(),
    onResetRow: vi.fn(),
  };
  render(
    <LayoutRatifyView
      rows={rows}
      validation={validateLayoutRows(rows)}
      projectName="Acme Checkout"
      {...handlers}
    />,
  );
  return handlers;
}

describe("LayoutRatifyView", () => {
  it("frames the mapping as a proposal, not a result", () => {
    renderView();
    expect(
      screen.getByRole("heading", {
        name: "3 packages found. Confirm the ones that are bounded contexts.",
      }),
    ).toBeTruthy();
    expect(document.body.textContent).toMatch(
      /proposals from the scan of Acme Checkout, not assertions/,
    );
    expect(document.body.textContent).toMatch(
      /nothing is written until you continue/,
    );
  });

  it("renders one include control per package, pre-set from the evidence", () => {
    renderView();
    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxes.length).toBe(3);
    expect(
      (
        screen.getByRole("checkbox", {
          name: "Include packages/orders as a bounded context",
        }) as HTMLInputElement
      ).checked,
    ).toBe(true);
    // No layer directory was found here, so it is proposed as NOT a context.
    expect(
      (
        screen.getByRole("checkbox", {
          name: "Include packages/eslint-config as a bounded context",
        }) as HTMLInputElement
      ).checked,
    ).toBe(false);
  });

  it("makes declining exactly as cheap as accepting", async () => {
    const user = userEvent.setup();
    const handlers = renderView();
    await user.click(
      screen.getByRole("checkbox", {
        name: "Include packages/orders as a bounded context",
      }),
    );
    expect(handlers.onToggleInclude).toHaveBeenCalledWith(
      "packages/orders",
      false,
    );
  });

  it("raises a rename per keystroke without swallowing it", async () => {
    const user = userEvent.setup();
    const handlers = renderView();
    const field = screen.getByRole("textbox", {
      name: "Context name for packages/orders",
    });
    await user.type(field, "X");
    expect(handlers.onRenameContext).toHaveBeenCalledWith(
      "packages/orders",
      "ordersX",
    );
  });

  it("locks the name field of an excluded package", () => {
    renderView();
    const field = screen.getByRole("textbox", {
      name: "Context name for packages/eslint-config",
    }) as HTMLInputElement;
    expect(field.disabled).toBe(true);
  });

  it("says what the scan found, and says 'not found' as a fact", () => {
    renderView();
    expect(document.body.textContent).toMatch(
      /No known layer directory was found here/,
    );
    // The wording is deliberately absolute — the detector records only aliases
    // that exist on disk, so this is never a confidence score.
    expect(document.body.textContent).not.toMatch(
      /confidence|likely|probably/i,
    );
  });

  it("marks a row a human changed, so a proposal is never mistaken for a decision", () => {
    const rows = renameContext(
      buildLayoutRatifyRows(detected()),
      "packages/billing",
      "invoicing",
    );
    renderView(rows);
    expect(screen.getAllByText("edited").length).toBe(1);
    expect(document.body.textContent).toMatch(/1 edited by you/);
  });

  it("shows a collision inline, on both rows, and blocks with a reason", () => {
    const rows = renameContext(
      buildLayoutRatifyRows(detected()),
      "packages/billing",
      "orders",
    );
    renderView(rows);

    const field = screen.getByRole("textbox", {
      name: "Context name for packages/billing",
    });
    expect(field.getAttribute("aria-invalid")).toBe("true");
    const describedBy = field.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy ?? "")?.textContent).toMatch(
      /packages\/orders/,
    );

    expect(screen.getByRole("status").textContent).toMatch(
      /Fix the highlighted context names/,
    );
  });

  it("blocks an all-excluded layout without hiding the grid that fixes it", () => {
    let rows = buildLayoutRatifyRows(detected());
    for (const row of rows) {
      rows = setContextIncluded(rows, row.packageRoot, false);
    }
    renderView(rows);

    expect(screen.getByRole("status").textContent).toMatch(
      /installs? a gate that checks nothing|checks nothing/,
    );
    // The checkboxes MUST still be on screen — swapping the grid for an empty
    // state would strand the user with no way to undo the exclusion.
    expect(screen.getAllByRole("checkbox").length).toBe(3);
    expect(screen.queryByRole("table")).toBeTruthy();
  });

  it("renders the no-packages case as an empty state, with no grid", () => {
    renderView([]);
    expect(
      screen.getByRole("heading", {
        name: "No workspace packages were detected",
      }),
    ).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("opens one row's layer editor with a named group per layer", async () => {
    const user = userEvent.setup();
    renderView();
    await user.click(
      screen.getByRole("button", {
        name: "Layer directories for packages/orders",
      }),
    );

    expect(
      screen.getByRole("group", {
        name: "Domain directories for packages/orders",
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole("group", {
        name: "Presentation directories for packages/orders",
      }),
    ).toBeTruthy();
    expect(document.body.textContent).toMatch(
      /Found on disk: src\/db, src\/http/,
    );
    expect(document.body.textContent).toMatch(/Not found on disk/);
  });

  it("raises the whole directory list when a chip is added", async () => {
    const user = userEvent.setup();
    const handlers = renderView();
    await user.click(
      screen.getByRole("button", {
        name: "Layer directories for packages/orders",
      }),
    );

    // ChipInput's own <label> carries no htmlFor, so the control is addressed
    // by its `name` — see the note in LayoutRatifyView.
    const field = document.querySelector(
      'input[name="packages/orders:domain"]',
    ) as HTMLInputElement;
    expect(field).toBeTruthy();
    await user.type(field, "src/model{Enter}");

    expect(handlers.onLayerDirectoriesChange).toHaveBeenCalledWith(
      "packages/orders",
      "domain",
      ["src/domain", "src/model"],
    );
  });

  it("offers an undo for an overruled row, and nothing to undo otherwise", async () => {
    const user = userEvent.setup();
    const rows = renameContext(
      buildLayoutRatifyRows(detected()),
      "packages/orders",
      "ordering",
    );
    const handlers = renderView(rows);

    await user.click(
      screen.getByRole("button", {
        name: "Layer directories for packages/orders",
      }),
    );
    const reset = screen.getByRole("button", {
      name: "Reset packages/orders to what the scan detected",
    }) as HTMLButtonElement;
    expect(reset.disabled).toBe(false);
    await user.click(reset);
    expect(handlers.onResetRow).toHaveBeenCalledWith("packages/orders");

    await user.click(
      screen.getByRole("button", {
        name: "Layer directories for packages/billing",
      }),
    );
    expect(
      (
        screen.getByRole("button", {
          name: "Reset packages/billing to what the scan detected",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
});

describe("LayoutRatifyFooterActions", () => {
  function renderFooter(rows: readonly LayoutRatifyRow[]) {
    const onBack = vi.fn();
    const onContinue = vi.fn();
    render(
      <LayoutRatifyFooterActions
        validation={validateLayoutRows(rows)}
        onBack={onBack}
        onContinue={onContinue}
      />,
    );
    return { onBack, onContinue };
  }

  it("continues when the layout is ratifiable", async () => {
    const user = userEvent.setup();
    const { onContinue } = renderFooter(buildLayoutRatifyRows(detected()));
    const button = screen.getByRole("button", { name: "Continue" });
    expect((button as HTMLButtonElement).disabled).toBe(false);
    await user.click(button);
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it("tells a keyboard user why a dead Continue is dead", () => {
    let rows = buildLayoutRatifyRows(detected());
    for (const row of rows) {
      rows = setContextIncluded(rows, row.packageRoot, false);
    }
    renderFooter(rows);

    const button = screen.getByRole("button", { name: /Continue/ });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    const describedBy = button.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy ?? "")?.textContent).toMatch(
      /Include at least one package/,
    );
  });
});
