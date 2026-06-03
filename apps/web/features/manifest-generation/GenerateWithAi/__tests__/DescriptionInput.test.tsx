import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import { JSDOM } from "jsdom";
import React from "react";
import { render, cleanup } from "@testing-library/react";
import { DescriptionInput } from "../DescriptionInput";

const dom = new JSDOM();
global.window = dom.window as unknown as Window & typeof globalThis;
global.document = dom.window.document;

beforeEach(() => {
  cleanup();
});

describe("DescriptionInput", () => {
  const defaultProps = {
    value: "",
    onChange: () => {},
    charCount: 0,
    disabled: false,
    isAiReady: true,
  };

  it('has aria-live="polite" on counter span', () => {
    const { container } = render(<DescriptionInput {...defaultProps} />);
    const counter = container.querySelector("[aria-live]");
    assert.strictEqual(counter?.getAttribute("aria-live"), "polite");
  });

  it("shows helper text when too short", () => {
    const { getByText } = render(
      <DescriptionInput {...defaultProps} charCount={5} />,
    );
    assert.match(
      getByText(/Minimum 10 characters/).textContent || "",
      /Minimum 10 characters/,
    );
  });

  it("hides helper text when empty", () => {
    const { container } = render(
      <DescriptionInput {...defaultProps} charCount={0} />,
    );
    assert.doesNotMatch(container.textContent || "", /Minimum 10 characters/);
  });
});
