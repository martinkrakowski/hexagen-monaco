import { describe, it, afterEach } from "vitest";
import assert from "node:assert/strict";
import React from "react";
import { render, cleanup } from "@testing-library/react";
import { FormField } from "../../src/modules/FormField.js";

afterEach(() => {
  cleanup();
});

function renderField(extra?: {
  validationMessage?: string;
  hint?: string;
  childDescribedBy?: string;
}) {
  return render(
    React.createElement(
      FormField,
      {
        label: "Email",
        htmlFor: "email",
        validationMessage: extra?.validationMessage,
        hint: extra?.hint,
      },
      React.createElement("input", {
        id: "email",
        type: "email",
        "aria-describedby": extra?.childDescribedBy,
      }),
    ),
  );
}

describe("FormField component", () => {
  it("renders the label wired to the control via htmlFor", () => {
    const { container } = renderField();
    const label = container.querySelector("label");
    assert.ok(label instanceof HTMLLabelElement);
    assert.equal(label.getAttribute("for"), "email");
    assert.equal(label.textContent, "Email");
    const input = container.querySelector("input");
    assert.ok(input instanceof HTMLInputElement);
  });

  it("renders no validation message and no aria-describedby by default", () => {
    const { container, queryByRole } = renderField();
    assert.equal(queryByRole("alert"), null);
    const input = container.querySelector("input");
    assert.equal(input?.getAttribute("aria-describedby"), null);
  });

  it("renders validationMessage with role='alert'", () => {
    const { getByRole } = renderField({
      validationMessage: "Enter a valid email address",
    });
    const message = getByRole("alert");
    assert.equal(message.textContent, "Enter a valid email address");
    assert.match(message.className, /text-destructive/);
  });

  it("wires aria-describedby on the child to the validation message", () => {
    const { container, getByRole } = renderField({
      validationMessage: "Required",
    });
    const input = container.querySelector("input");
    const message = getByRole("alert");
    assert.equal(input?.getAttribute("aria-describedby"), message.id);
    assert.equal(message.id, "email-validation");
  });

  it("wires aria-describedby to the hint", () => {
    const { container, getByText } = renderField({ hint: "We never share it" });
    const hint = getByText("We never share it");
    assert.equal(hint.id, "email-hint");
    const input = container.querySelector("input");
    assert.equal(input?.getAttribute("aria-describedby"), "email-hint");
  });

  it("joins hint, validation and pre-existing describedby ids", () => {
    const { container } = renderField({
      validationMessage: "Required",
      hint: "Helper",
      childDescribedBy: "external-note",
    });
    const input = container.querySelector("input");
    assert.equal(
      input?.getAttribute("aria-describedby"),
      "external-note email-hint email-validation",
    );
  });
});
