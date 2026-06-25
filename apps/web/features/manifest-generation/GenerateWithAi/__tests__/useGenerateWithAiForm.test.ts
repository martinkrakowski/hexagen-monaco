import { describe, it } from "vitest";
import assert from "node:assert";
import { renderHook, act } from "@testing-library/react";
import { useGenerateWithAiForm } from "../hooks/useGenerateWithAiForm";
describe("useGenerateWithAiForm", () => {
  it("Module exports useGenerateWithAiForm as a function", () => {
    assert.strictEqual(typeof useGenerateWithAiForm, "function");
  });

  it("setValue updates a field", () => {
    const { result } = renderHook(() => useGenerateWithAiForm());

    act(() => {
      const [, handlers] = result.current;
      handlers.setValue("description", "hello world");
    });

    const [formState] = result.current;
    assert.strictEqual(formState.description, "hello world");
  });

  it("isValid returns true at exactly 50000 chars", () => {
    const { result } = renderHook(() => useGenerateWithAiForm());
    const exactContent = "x".repeat(50000);

    act(() => {
      const [, handlers] = result.current;
      handlers.setValue("description", exactContent);
    });

    const [, handlers] = result.current;
    assert.strictEqual(handlers.isValid, true);
  });

  it("reset restores the initial state", () => {
    const { result } = renderHook(() => useGenerateWithAiForm());

    act(() => {
      const [, handlers] = result.current;
      handlers.setValue("description", "something");
    });
    act(() => {
      const [, handlers] = result.current;
      handlers.reset();
    });

    const [formState] = result.current;
    assert.strictEqual(formState.description, "");
    assert.strictEqual(formState.selectedExample, null);
  });
});
