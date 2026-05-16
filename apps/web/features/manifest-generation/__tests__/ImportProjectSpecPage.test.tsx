import { test, describe } from "node:test";
import assert from "node:assert";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import ImportProjectSpecPage from "../ImportProjectSpecPage";

describe("ImportProjectSpecPage", () => {
  test("invalid YAML calls setParseError and displays parse error", () => {
    render(<ImportProjectSpecPage />);
    const textarea = screen.getByPlaceholderText(
      /Paste your structured config/i,
    );
    fireEvent.change(textarea, { target: { value: "invalid: [}" } });

    const errorHeading = screen.getByText(/Failed to parse config:/i);
    assert.ok(errorHeading);
    const errorMessage = screen.getByText(/Invalid config format/i);
    assert.ok(errorMessage);
  });

  test("valid YAML is parsed correctly without errors", () => {
    render(<ImportProjectSpecPage />);
    const textarea = screen.getByPlaceholderText(
      /Paste your structured config/i,
    );
    const validYaml = `name: test-project\nintent: generate`;
    fireEvent.change(textarea, { target: { value: validYaml } });

    const errorElement = screen.queryByText(/Failed to parse config:/i);
    assert.strictEqual(errorElement, null);
    const configLoaded = screen.getByText(/Config loaded/i);
    assert.ok(configLoaded);
  });

  test("valid JSON is parsed correctly without errors", () => {
    render(<ImportProjectSpecPage />);
    const textarea = screen.getByPlaceholderText(
      /Paste your structured config/i,
    );
    const validJson = JSON.stringify({
      name: "test-project",
      intent: "generate",
    });
    fireEvent.change(textarea, { target: { value: validJson } });

    const errorElement = screen.queryByText(/Failed to parse config:/i);
    assert.strictEqual(errorElement, null);
    const configLoaded = screen.getByText(/Config loaded/i);
    assert.ok(configLoaded);
  });
});
