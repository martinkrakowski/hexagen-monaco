import { describe, it, afterEach } from "vitest";
import assert from "node:assert/strict";
import * as React from "react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { CompanionBanner, type CompanionSuggestion } from "./CompanionBanner";

// Uses React.createElement instead of JSX so the file can live as .test.ts
// (the wizard's existing test runner glob is **/*.test.ts; expanding it to
// also pick up .test.tsx would surface pre-existing failures in unrelated
// test files — out of scope for this PR).
const h = React.createElement;

function mkSuggestion(
  id: string,
  name = id,
  description = "desc",
): CompanionSuggestion {
  return { id, name, description };
}

describe("CompanionBanner", () => {
  afterEach(() => cleanup());

  it("renders nothing when given an empty suggestion list", () => {
    const { container } = render(
      h(CompanionBanner, { suggestions: [], onAdd: () => {} }),
    );
    assert.equal(container.firstChild, null);
  });

  it("renders one row per suggestion and calls onAdd with the row id", () => {
    let added: string | null = null;
    render(
      h(CompanionBanner, {
        suggestions: [mkSuggestion("a"), mkSuggestion("b")],
        onAdd: (id) => {
          added = id;
        },
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: /\+ Add b/i }));
    assert.equal(added, "b");
  });

  it("hides only the dismissed row, keeping siblings visible", () => {
    render(
      h(CompanionBanner, {
        suggestions: [mkSuggestion("a"), mkSuggestion("b")],
        onAdd: () => {},
      }),
    );
    fireEvent.click(screen.getByLabelText("Dismiss a suggestion"));
    assert.equal(screen.queryByRole("button", { name: /\+ Add a/i }), null);
    assert.ok(screen.queryByRole("button", { name: /\+ Add b/i }));
  });

  it("hides the whole container when every row has been dismissed", () => {
    const { container } = render(
      h(CompanionBanner, {
        suggestions: [mkSuggestion("a")],
        onAdd: () => {},
      }),
    );
    fireEvent.click(screen.getByLabelText("Dismiss a suggestion"));
    assert.equal(container.firstChild, null);
  });

  it("collapses 4+ suggestions behind a [+N more] affordance and expands on click", () => {
    render(
      h(CompanionBanner, {
        suggestions: [
          mkSuggestion("a"),
          mkSuggestion("b"),
          mkSuggestion("c"),
          mkSuggestion("d"),
          mkSuggestion("e"),
        ],
        onAdd: () => {},
      }),
    );
    // Initial: a, b, c visible; d, e hidden.
    assert.ok(screen.queryByRole("button", { name: /\+ Add a/i }));
    assert.ok(screen.queryByRole("button", { name: /\+ Add c/i }));
    assert.equal(screen.queryByRole("button", { name: /\+ Add d/i }), null);

    // Two suggestions overflow.
    fireEvent.click(screen.getByRole("button", { name: "+2 more" }));

    // After expand: d and e visible.
    assert.ok(screen.queryByRole("button", { name: /\+ Add d/i }));
    assert.ok(screen.queryByRole("button", { name: /\+ Add e/i }));
  });

  it("renders the suggestion name and description text", () => {
    render(
      h(CompanionBanner, {
        suggestions: [
          mkSuggestion(
            "supabase-auth",
            "Supabase Auth",
            "adds @supabase/ssr middleware",
          ),
        ],
        onAdd: () => {},
      }),
    );
    assert.ok(screen.getByText("Supabase Auth"));
    assert.ok(
      screen.getByText(
        (_, el) => el?.textContent === " — adds @supabase/ssr middleware",
      ),
    );
  });

  it("re-shows a dismissed suggestion after it disappears and re-appears in the prop", () => {
    // Reproducer for the qodo PR #111 finding:
    // - User has Template A selected; banner shows suggestions [X, Y].
    // - User dismisses X. dismissed = {X}. Banner stays mounted because Y is visible.
    // - User deselects A. suggestions = [Y]. X is gone from the prop but
    //   the previous bug kept it in `dismissed`.
    // - User re-selects A. suggestions = [X, Y]. Without reconciliation X
    //   stays hidden; with reconciliation X re-appears.
    const { rerender } = render(
      h(CompanionBanner, {
        suggestions: [mkSuggestion("x"), mkSuggestion("y")],
        onAdd: () => {},
      }),
    );
    // Dismiss X.
    fireEvent.click(screen.getByLabelText("Dismiss x suggestion"));
    assert.equal(screen.queryByRole("button", { name: /\+ Add x/i }), null);
    assert.ok(screen.queryByRole("button", { name: /\+ Add y/i }));

    // Parent re-renders with only Y (X's parent template deselected).
    rerender(
      h(CompanionBanner, {
        suggestions: [mkSuggestion("y")],
        onAdd: () => {},
      }),
    );
    // Y still visible; X gone from prop entirely.
    assert.ok(screen.queryByRole("button", { name: /\+ Add y/i }));

    // Parent re-selects X's source template. suggestions includes X again.
    rerender(
      h(CompanionBanner, {
        suggestions: [mkSuggestion("x"), mkSuggestion("y")],
        onAdd: () => {},
      }),
    );
    // X must be visible again — the reconciliation effect dropped it from
    // `dismissed` when it disappeared, so its re-appearance is fresh.
    assert.ok(
      screen.queryByRole("button", { name: /\+ Add x/i }),
      "expected x to re-appear after parent re-selects its source template",
    );
  });

  it("keeps a dismissal active while the suggestion is still present across re-renders", () => {
    // Counterpart to the previous test: dismissal should NOT be cleared by
    // unrelated parent re-renders. As long as X is still in `suggestions`,
    // dismissing X keeps it hidden across structurally-equal prop updates.
    const { rerender } = render(
      h(CompanionBanner, {
        suggestions: [mkSuggestion("x"), mkSuggestion("y")],
        onAdd: () => {},
      }),
    );
    fireEvent.click(screen.getByLabelText("Dismiss x suggestion"));
    // Re-render with a fresh array but the same ids (simulates parent re-render).
    rerender(
      h(CompanionBanner, {
        suggestions: [mkSuggestion("x"), mkSuggestion("y")],
        onAdd: () => {},
      }),
    );
    assert.equal(
      screen.queryByRole("button", { name: /\+ Add x/i }),
      null,
      "dismissal must persist while the suggestion is still in the prop",
    );
    assert.ok(screen.queryByRole("button", { name: /\+ Add y/i }));
  });
});
