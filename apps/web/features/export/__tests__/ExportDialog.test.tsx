// GH-publish PR-2: the error panel's Reconnect/sign-in affordance is gated on
// the typed errorCode (snake_case HTTP vocabulary), and a degraded-publish
// success renders the raw warning strings instead of the count-based add-on
// copy (which mislabels workflow-scope skips as "overridden by add-ons").

import { describe, it, vi, afterEach } from "vitest";
import assert from "node:assert/strict";
import React from "react";
import { render, cleanup } from "@testing-library/react";

import { ExportDialog } from "../ExportDialog";

// jsdom doesn't implement the native <dialog> modal API the @hexagen/ui Dialog
// calls (dialog.showModal()/close()) — stub it so the panel mounts. (Vitest's
// jsdom environment exposes HTMLDialogElement as a global.)
HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute("open", "");
};
HTMLDialogElement.prototype.close = function () {
  this.removeAttribute("open");
};

type ExportDialogProps = React.ComponentProps<typeof ExportDialog>;

function setup(overrides: Partial<ExportDialogProps> = {}) {
  const props: ExportDialogProps = {
    open: true,
    phase: "error",
    onClose: vi.fn(),
    onSubmit: vi.fn(),
    onRetry: vi.fn(),
    onBackToForm: vi.fn(),
    ...overrides,
  };
  render(<ExportDialog {...props} />);
  return props;
}

// Queries go against the raw DOM (text, not getByRole): jsdom's <dialog> a11y
// is incomplete — its subtree isn't exposed to role queries.
const bodyText = () => (document.body.textContent || "").replace(/\s+/g, " ");

function findButton(label: RegExp) {
  return Array.from(document.querySelectorAll("button")).find((b) =>
    label.test(b.textContent || ""),
  );
}

function clickButton(label: RegExp) {
  const btn = findButton(label);
  assert.ok(btn, `expected a button matching ${label}`);
  btn.click();
}

const CAVEAT = /stays limited until you reconnect/i;

describe("ExportDialog — error-code affordances", () => {
  afterEach(cleanup);

  it("workflow_scope_required → Reconnect GitHub button fires onReconnect, caveat line present", () => {
    const onReconnect = vi.fn();
    setup({
      error: "GitHub rejected this push — the token lacks workflow scope.",
      errorCode: "workflow_scope_required",
      onReconnect,
    });

    assert.match(bodyText(), CAVEAT);
    clickButton(/^Reconnect GitHub$/);
    assert.strictEqual(onReconnect.mock.calls.length, 1);
  });

  it("reauth_required → 'Sign in to GitHub' label, no scope caveat", () => {
    const onReconnect = vi.fn();
    setup({
      error: "GitHub session expired — sign in again to publish.",
      errorCode: "reauth_required",
      onReconnect,
    });

    assert.doesNotMatch(bodyText(), CAVEAT);
    assert.strictEqual(findButton(/^Reconnect GitHub$/), undefined);
    clickButton(/^Sign in to GitHub$/);
    assert.strictEqual(onReconnect.mock.calls.length, 1);
  });

  it("no errorCode (generic failure) → the message renders, neither reconnect button appears", () => {
    setup({
      error: "Repository creation failed.",
      onReconnect: vi.fn(),
    });

    assert.match(bodyText(), /Repository creation failed\./);
    assert.doesNotMatch(bodyText(), CAVEAT);
    assert.strictEqual(findButton(/^Reconnect GitHub$/), undefined);
    assert.strictEqual(findButton(/^Sign in to GitHub$/), undefined);
    // The existing error actions are untouched.
    assert.ok(findButton(/^Retry$/), "Retry still renders");
    assert.ok(findButton(/^Back to form$/), "Back to form still renders");
  });
});

describe("ExportDialog — degraded-publish success warnings", () => {
  afterEach(cleanup);

  it("warning strings replace the count-based add-on line; the errors-count line stays", () => {
    setup({
      phase: "success",
      success: {
        message: "Pushed to me/r",
        owner: "me",
        repo: "r",
        notices: { warnings: 1, errors: 1 },
        warningMessages: [
          "Skipped .github/workflows/sync-integrity.yml: the connected GitHub token lacks the 'workflow' scope.",
        ],
      },
    });

    const text = bodyText();
    assert.match(text, /Skipped \.github\/workflows\/sync-integrity\.yml/);
    // The add-on copy would mislabel this degraded publish.
    assert.doesNotMatch(text, /overridden by add-ons/i);
    // The errors-count line (add-on selection problems) is unaffected.
    assert.match(text, /was not applied/i);
    assert.match(text, /HEXAGEN-ADDON-NOTICES\.md/);
  });

  it("counts-only notices (no strings) keep the existing add-on warnings line", () => {
    setup({
      phase: "success",
      success: {
        message: "Pushed to me/r",
        owner: "me",
        repo: "r",
        notices: { warnings: 2, errors: 0 },
      },
    });

    assert.match(bodyText(), /2 generated files overridden by add-ons\./);
  });
});
