import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";

import { useGovernanceKeys } from "../derive-governance-keys";
import { scopeGovernanceKey } from "../scope-governance-key";

describe("useGovernanceKeys", () => {
  it("with a null project id returns the unsaved-scope key and no adoption sources", () => {
    const { result } = renderHook(() =>
      useGovernanceKeys({
        currentStepIndex: 0,
        activeItem: null,
        expandedQuestionId: "q1",
        projectId: null,
      }),
    );

    const bare = `step:${result.current.currentStepId}:q:q1`;
    expect(result.current.contextKey).toBe(scopeGovernanceKey(null, bare));
    expect(result.current.adoptionSources).toEqual([]);
  });

  it("with a project id returns the scoped key and both sources (unsaved first, then bare)", () => {
    const { result } = renderHook(() =>
      useGovernanceKeys({
        currentStepIndex: 0,
        activeItem: null,
        expandedQuestionId: "q1",
        projectId: "projX",
      }),
    );

    const bare = `step:${result.current.currentStepId}:q:q1`;
    expect(result.current.contextKey).toBe(scopeGovernanceKey("projX", bare));
    expect(result.current.adoptionSources).toEqual([
      scopeGovernanceKey(null, bare),
      bare,
    ]);
  });
});
