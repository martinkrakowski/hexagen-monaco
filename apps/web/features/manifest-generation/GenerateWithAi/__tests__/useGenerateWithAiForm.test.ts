import { describe, it } from "node:test";
import assert from "node:assert";
import { JSDOM } from "jsdom";
import { renderHook, act } from "@testing-library/react";
import { useGenerateWithAiForm } from "../hooks/useGenerateWithAiForm";

const dom = new JSDOM();
global.window = dom.window as unknown as Window & typeof globalThis;
global.document = dom.window.document;

describe("useGenerateWithAiForm", () => {
  it("Module exports useGenerateWithAiForm as a function", () => {
    assert.strictEqual(typeof useGenerateWithAiForm, "function");
  });

  it("loadFromFile sets description and filename atomically", () => {
    const { result } = renderHook(() => useGenerateWithAiForm());
    const content = "x".repeat(1000);
    const filename = "spec.yaml";

    act(() => {
      const [, handlers] = result.current;
      handlers.loadFromFile(content, filename);
    });

    const [formState] = result.current;
    assert.strictEqual(formState.description, content);
    assert.strictEqual(formState.loadedFileName, filename);
    assert.strictEqual(formState.selectedExample, null);
  });

  it("loadFromFile truncates exceeding MAX (50000 chars)", () => {
    const { result } = renderHook(() => useGenerateWithAiForm());
    const longContent = "x".repeat(51000);
    const filename = "large-spec.yaml";

    act(() => {
      const [, handlers] = result.current;
      handlers.loadFromFile(longContent, filename);
    });

    const [formState] = result.current;
    assert.strictEqual(formState.description.length, 50000);
  });

  it("clearFile resets description and filename", () => {
    const { result } = renderHook(() => useGenerateWithAiForm());
    const content = "x".repeat(1000);
    const filename = "spec.yaml";

    act(() => {
      const [, handlers] = result.current;
      handlers.loadFromFile(content, filename);
      handlers.clearFile();
    });

    const [formState] = result.current;
    assert.strictEqual(formState.description, "");
    assert.strictEqual(formState.loadedFileName, null);
  });

  it("isValid returns true at exactly 50000 chars", () => {
    const { result } = renderHook(() => useGenerateWithAiForm());
    const exactContent = "x".repeat(50000);

    act(() => {
      const [, handlers] = result.current;
      handlers.loadFromFile(exactContent, "exact-spec.yaml");
    });

    const [, handlers] = result.current;
    assert.strictEqual(handlers.isValid, true);
  });
});
