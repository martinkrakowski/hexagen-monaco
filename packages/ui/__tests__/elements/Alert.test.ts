import { describe, it, afterEach } from "vitest";
import assert from "node:assert/strict";
import React from "react";
import { render, cleanup } from "@testing-library/react";
import { Alert } from "../../src/elements/Alert.js";

afterEach(() => {
  cleanup();
});

describe("Alert component", () => {
  it("renders children with role='status' by default (info tone)", () => {
    const { getByRole } = render(React.createElement(Alert, null, "Heads up"));
    const alert = getByRole("status");
    assert.match(alert.textContent ?? "", /Heads up/);
    assert.match(alert.className, /border-info/);
  });

  it("uses role='alert' only for the danger tone", () => {
    const { getByRole } = render(
      React.createElement(Alert, {
        tone: "danger",
        children: "Something is wrong",
      }),
    );
    const alert = getByRole("alert");
    assert.match(alert.textContent ?? "", /Something is wrong/);
    assert.match(alert.className, /border-destructive/);
  });

  it("uses role='status' for non-danger tones", () => {
    for (const tone of ["info", "success", "warning"] as const) {
      const { getByRole, unmount } = render(
        React.createElement(Alert, { tone, children: "Note" }),
      );
      const alert = getByRole("status");
      assert.equal(alert.getAttribute("role"), "status");
      unmount();
    }
  });

  it("applies tone-specific token classes", () => {
    const { getByRole } = render(
      React.createElement(Alert, { tone: "success", children: "Saved" }),
    );
    const alert = getByRole("status");
    assert.match(alert.className, /bg-success\/10/);
    assert.match(alert.className, /border-success\/50/);
  });

  it("renders an optional title", () => {
    const { getByText } = render(
      React.createElement(Alert, {
        title: "Import finished",
        children: "3 contexts",
      }),
    );
    const title = getByText("Import finished");
    assert.match(title.className, /font-medium/);
  });

  it("omits the title element when no title is given", () => {
    const { getByRole } = render(React.createElement(Alert, null, "Body"));
    const alert = getByRole("status");
    assert.equal(alert.querySelector("p"), null);
  });
});
