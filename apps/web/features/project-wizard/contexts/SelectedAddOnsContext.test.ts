// JSDOM globals must exist before @testing-library/react is imported.
import { describe, it, afterEach } from "vitest";
import assert from "node:assert/strict";
import React from "react";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useForm, FormProvider, type DefaultValues } from "react-hook-form";
import type { ProjectConfig } from "@hexagen/project-configuration";
import {
  SelectedAddOnsProvider,
  useSelectedAddOns,
} from "./SelectedAddOnsContext";

afterEach(() => cleanup());

// Wraps the hook in a real form + the (form-backed) selection provider.
function makeWrapper(defaultAddOns: Record<string, unknown> = {}) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    const form = useForm<ProjectConfig>({
      defaultValues: {
        addOnsAnswers: defaultAddOns,
      } as unknown as DefaultValues<ProjectConfig>,
    });
    return React.createElement(
      FormProvider,
      { ...form },
      React.createElement(SelectedAddOnsProvider, null, children),
    );
  };
}

describe("SelectedAddOnsContext (form-backed by addOnsAnswers)", () => {
  it("toggling writes the add-on into addOnsAnswers (the canvas + persistence source)", () => {
    const { result } = renderHook(() => useSelectedAddOns(), {
      wrapper: makeWrapper(),
    });
    assert.deepEqual(result.current.selectedIds, []);

    act(() => result.current.toggle("bullmq"));
    assert.deepEqual(result.current.selectedIds, ["bullmq"]);
    assert.equal(result.current.isSelected("bullmq"), true);

    act(() => result.current.toggle("bullmq"));
    assert.deepEqual(result.current.selectedIds, []);
  });

  it("derives selection from existing addOnsAnswers, so it survives a reload", () => {
    const { result } = renderHook(() => useSelectedAddOns(), {
      wrapper: makeWrapper({ supabase: { project: "x" }, bullmq: {} }),
    });
    assert.deepEqual(result.current.selectedIds.sort(), ["bullmq", "supabase"]);
    assert.equal(result.current.isSelected("supabase"), true);
    assert.equal(result.current.isSelected("docker"), false);
  });

  it("resolveSelection swaps a conflicting selection atomically", () => {
    const { result } = renderHook(() => useSelectedAddOns(), {
      wrapper: makeWrapper({ "auth-mock": {} }),
    });
    act(() => result.current.resolveSelection(["clerk"], ["auth-mock"]));
    assert.deepEqual(result.current.selectedIds, ["clerk"]);
  });
});
