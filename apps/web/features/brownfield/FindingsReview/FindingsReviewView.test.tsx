/**
 * S5 presentation.
 *
 * The transforms are covered by `baseline-draft.test.ts`; what is asserted
 * here is only what the DOM adds — that the consequence of baselining is
 * stated in words, that a scan whose findings were never read does not render
 * as a clean tree, and that the bulk affordance is per-rule and reason-bearing.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { ScanFindings } from "@/lib/project-scan/types";
import {
  FindingsReviewFooterActions,
  FindingsReviewView,
} from "./FindingsReviewView";
import {
  baselineRuleGroup,
  buildFindingsAdvisories,
  buildFindingsReviewRows,
  describeBaselineConsequence,
  describeUnavailableFindings,
  groupRowsByRule,
  readScanFindings,
  setFindingBaselined,
  summarizeFindingsSource,
  validateFindingsReview,
  type FindingsReviewRow,
  type FindingsReviewSource,
} from "./baseline-draft";

// jest-dom is a dependency but apps/web/vitest.setup.ts does not import it, so
// toBeInTheDocument/toHaveAttribute are NOT registered. Assertions here use
// toBeTruthy()/toBeNull()/getAttribute() instead.

const NOW = new Date("2026-08-20T12:00:00.000Z");

function collected(): ScanFindings {
  return {
    collected: true,
    fresh: [
      {
        rule: "npm-package-in-domain",
        file: "packages/orders/src/domain/order.ts",
        specifier: "zod",
        message: "npm package in domain layer",
      },
      {
        rule: "npm-package-in-domain",
        file: "packages/billing/src/domain/invoice.ts",
        specifier: "date-fns",
        message: "npm package in domain layer",
      },
      {
        rule: "server-marker-missing",
        file: "packages/billing/src/infra/db.ts",
        specifier: "",
        message: "missing server-only marker",
      },
    ],
    baselined: [],
    stale: [
      {
        rule: "cross-package-import",
        file: "packages/legacy/src/domain/old.ts",
        specifier: "@acme/legacy",
        message: "",
        reason: "deleted in the rewrite",
      },
    ],
    expired: [
      {
        rule: "subpath-convention",
        file: "packages/orders/src/index.ts",
        specifier: "./internal/thing",
        message: "",
        reason: "accepted last quarter",
        expires: "2026-06-01",
      },
    ],
  };
}

function renderView(options?: {
  source?: FindingsReviewSource;
  rows?: readonly FindingsReviewRow[];
}) {
  const source = options?.source ?? readScanFindings(collected());
  const rows = options?.rows ?? buildFindingsReviewRows(source);
  const validation = validateFindingsReview(rows, source, NOW);
  const handlers = {
    onToggleBaselined: vi.fn(),
    onReasonChange: vi.fn(),
    onExpiresChange: vi.fn(),
    onBaselineRule: vi.fn(),
    onClearRule: vi.fn(),
    onClearAll: vi.fn(),
  };
  render(
    <FindingsReviewView
      groups={groupRowsByRule(rows)}
      advisories={buildFindingsAdvisories(source)}
      counts={summarizeFindingsSource(source)}
      unavailable={describeUnavailableFindings(source)}
      validation={validation}
      consequence={describeBaselineConsequence(validation)}
      projectName="Acme Checkout"
      {...handlers}
    />,
  );
  return { handlers, rows, source, validation };
}

describe("FindingsReviewView", () => {
  it("names the consequence of accepting, in words", () => {
    renderView();
    expect(
      screen.getByRole("heading", {
        name: "3 findings are failing the gate. Decide which ones you are accepting.",
      }),
    ).toBeTruthy();
    expect(document.body.textContent).toMatch(
      /stops failing the gate, on this run and every run after it/,
    );
    expect(document.body.textContent).toMatch(
      /All 3 findings will keep failing the gate/,
    );
  });

  it("keeps the live summary mounted so a decision is announced", () => {
    renderView();
    const live = document.querySelector('[role="status"]');
    expect(live).toBeTruthy();
    expect(live?.getAttribute("aria-live")).toBe("polite");
  });

  it("puts each rule behind a real heading, largest group first and open", () => {
    renderView();
    const headings = screen.getAllByRole("heading", { level: 3 });
    expect(headings[0].textContent).toMatch(/npm-package-in-domain/);
    expect(headings[0].textContent).toMatch(/2 findings/);
    // The largest group's panel is open on arrival, the rest are not.
    const triggers = screen.getAllByRole("button", { expanded: true });
    expect(triggers.length).toBe(1);
  });

  it("groups dynamically — no rule name is hardcoded anywhere in the view", () => {
    const source = readScanFindings({
      ...collected(),
      fresh: [
        {
          rule: "a-rule-invented-tomorrow",
          file: "packages/x/src/a.ts",
          specifier: "",
          message: "brand new rule",
        },
      ],
    } as ScanFindings);
    renderView({ source });
    expect(screen.getAllByRole("heading", { level: 3 })[0].textContent).toMatch(
      /a-rule-invented-tomorrow/,
    );
  });

  it("leaves the justification field unusable until a finding is accepted", () => {
    renderView();
    const reason = screen.getAllByLabelText(
      /Why npm-package-in-domain in .* is accepted debt/,
    )[0] as HTMLInputElement;
    expect(reason.disabled).toBe(true);
  });

  it("raises an accept intent from the row checkbox", async () => {
    const user = userEvent.setup();
    const { handlers, rows } = renderView();
    // The accessible name carries the SPECIFIER too: rule + file alone is not
    // a finding's identity, so two rows differing only by specifier would
    // otherwise share a name and this query would be ambiguous.
    const box = screen.getByLabelText(
      `Accept ${rows[0].rule} in ${rows[0].file} (${rows[0].specifier}) as pre-existing debt`,
    );
    await user.click(box);
    expect(handlers.onToggleBaselined).toHaveBeenCalledWith(rows[0].key, true);
  });

  it("gives two findings differing only by specifier distinct accessible names", () => {
    // Distinct findings sharing rule+file must not collide: a screen-reader
    // user has to know WHICH import they are accepting.
    const { rows } = renderView();
    const names = rows
      .filter((r) => r.specifier)
      .map(
        (r) =>
          `Accept ${r.rule} in ${r.file} (${r.specifier}) as pre-existing debt`,
      );
    for (const name of names) {
      expect(screen.getAllByLabelText(name).length).toBe(1);
    }
  });

  it("bulk-accepts one rule under one typed reason, and clears without one", async () => {
    const user = userEvent.setup();
    const { handlers } = renderView();

    const field = screen.getByLabelText("Accept all 2 under one reason");
    await user.type(field, "predates adoption");
    await user.click(screen.getAllByRole("button", { name: "Accept all" })[0]);
    expect(handlers.onBaselineRule).toHaveBeenCalledWith(
      "npm-package-in-domain",
      "predates adoption",
    );

    // The refusal to bulk-accept without a reason is asserted against the pure
    // module (`baseline-draft.test.ts`), not here: jsdom's constraint
    // validation decides whether a `required` field even lets the submit event
    // fire, which would make this a test of jsdom rather than of the screen.
  });

  it("offers no repo-wide accept, and a repo-wide clear that is disabled when idle", () => {
    renderView();
    expect(screen.queryByRole("button", { name: /accept every/i })).toBeNull();
    expect(
      screen.queryByRole("button", { name: /accept all findings/i }),
    ).toBeNull();
    const clearAll = screen.getByRole("button", {
      name: "Clear every baseline",
    }) as HTMLButtonElement;
    expect(clearAll.disabled).toBe(true);
  });

  it("enables the repo-wide clear once something is accepted", () => {
    const source = readScanFindings(collected());
    const rows = baselineRuleGroup(
      buildFindingsReviewRows(source),
      "npm-package-in-domain",
      "predates adoption",
    );
    renderView({ source, rows });
    const clearAll = screen.getByRole("button", {
      name: "Clear every baseline",
    }) as HTMLButtonElement;
    expect(clearAll.disabled).toBe(false);
    expect(document.body.textContent).toMatch(
      /2 findings will be recorded as accepted debt/,
    );
  });

  it("separates entries the user cannot act on, and says why", () => {
    renderView();
    const section = screen
      .getByRole("heading", { name: "Baseline entries that need attention" })
      .closest("section");
    expect(section).toBeTruthy();
    expect(section?.textContent).toMatch(/not decisions you make here/);
    expect(within(section as HTMLElement).getByText("Expired")).toBeTruthy();
    expect(within(section as HTMLElement).getByText("Stale")).toBeTruthy();
    expect(section?.textContent).toMatch(
      /fails the gate even though the finding may already be fixed/,
    );
  });

  it("renders a failed read as a failure, never as a clean tree", () => {
    renderView({
      source: {
        kind: "not-collected",
        failureReason: "hexagen-lint exited 127",
      },
    });
    expect(
      screen.getByRole("heading", {
        name: "The scan could not read the findings",
      }),
    ).toBeTruthy();
    // The count-bearing headline must NOT appear: "0 findings are failing the
    // gate" is the false green this whole seam exists to prevent.
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(
      "This scan cannot be ratified",
    );
    expect(document.body.textContent).not.toMatch(
      /findings are failing the gate/,
    );
    expect(document.body.textContent).toMatch(/hexagen-lint exited 127/);
    expect(document.body.textContent).toMatch(/not a clean tree/);
    // No table, no counts, and nothing that reads as "0 findings".
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByRole("list", { name: "Finding counts" })).toBeNull();
  });

  it("renders an absent findings list as absent, not as empty", () => {
    renderView({ source: { kind: "not-reported" } });
    expect(
      screen.getByRole("heading", {
        name: "This scan reported no findings list",
      }),
    ).toBeTruthy();
    expect(document.body.textContent).toMatch(
      /An absent list is not an empty one/,
    );
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("says a genuinely clean scan is clean", () => {
    renderView({
      source: {
        kind: "collected",
        fresh: [],
        baselined: [],
        stale: [],
        expired: [],
      },
    });
    expect(
      screen.getByRole("heading", { name: "Nothing is failing the gate" }),
    ).toBeTruthy();
    expect(screen.getByRole("list", { name: "Finding counts" })).toBeTruthy();
  });
});

describe("FindingsReviewFooterActions", () => {
  function renderFooter(
    source: FindingsReviewSource,
    rows: readonly FindingsReviewRow[],
  ) {
    const validation = validateFindingsReview(rows, source, NOW);
    const onContinue = vi.fn();
    render(
      <FindingsReviewFooterActions
        validation={validation}
        consequence={describeBaselineConsequence(validation)}
        onBack={vi.fn()}
        onContinue={onContinue}
      />,
    );
    return { onContinue, validation };
  }

  it("tells a keyboard user what Continue will do before they press it", () => {
    const source = readScanFindings(collected());
    renderFooter(source, buildFindingsReviewRows(source));
    const button = screen.getByRole("button", { name: "Continue" });
    const describedBy = button.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy as string)?.textContent).toMatch(
      /keep failing the gate/,
    );
  });

  it("disables Continue and states the reason when a scan was never read", () => {
    renderFooter({ kind: "not-reported" }, []);
    const button = screen.getByRole("button", {
      name: "Continue",
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    const describedBy = button.getAttribute("aria-describedby");
    expect(document.getElementById(describedBy as string)?.textContent).toMatch(
      /not the same as a clean tree/,
    );
  });

  it("disables Continue while an accepted finding has no reason", () => {
    const source = readScanFindings(collected());
    const rows = buildFindingsReviewRows(source);
    renderFooter(source, setFindingBaselined(rows, rows[0].key, true));
    expect(
      (screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});
