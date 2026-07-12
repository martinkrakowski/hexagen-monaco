import { describe, it } from "vitest";
import assert from "node:assert";

import {
  projectWorkspaceLayoutPropsEqual,
  type LayoutMemoProps,
} from "../project-workspace-layout-equality";

function baseProps(): LayoutMemoProps {
  const fn = () => {};
  return {
    currentStepIndex: 0,
    viewMode: "code",
    phase: "architecture",
    onPhaseChange: fn,
    canUsePlanPhase: false,
    onViewModeChange: fn,
    onCloseMiddlePanel: fn,
    onCloseRightPanel: fn,
    onNavigateToProjects: fn,
    isEditing: false,
    ui: { dialog: { kind: "none" } },
    children: null,
    editor: { selectedFileId: null },
  };
}

describe("projectWorkspaceLayoutPropsEqual", () => {
  it("skips re-render when nothing relevant changed (same references)", () => {
    const prev = baseProps();
    assert.strictEqual(
      projectWorkspaceLayoutPropsEqual(prev, { ...prev }),
      true,
    );
  });

  it("re-renders when the editor reference changes (regression guard)", () => {
    // Selecting a file / editing produces a NEW `editor` object via
    // useEditorSession. If the comparator ignores `editor`, the middle panel
    // (CodeView + editor) freezes and files become unclickable — the exact bug
    // this guards against.
    const prev = baseProps();
    const next: LayoutMemoProps = {
      ...prev,
      editor: { selectedFileId: "src/index.ts" },
    };
    assert.strictEqual(projectWorkspaceLayoutPropsEqual(prev, next), false);
  });

  it("re-renders on each tracked prop change", () => {
    const prev = baseProps();
    const changes: Partial<LayoutMemoProps>[] = [
      { currentStepIndex: 1 },
      { viewMode: "visual" },
      // Phase props: skipping any of these would freeze the workspace in a
      // phase (the toggle renders inside this memoized layout).
      { phase: "plan" },
      { onPhaseChange: () => {} },
      { canUsePlanPhase: true },
      { onViewModeChange: () => {} },
      { onCloseMiddlePanel: () => {} },
      { onCloseRightPanel: () => {} },
      { onNavigateToProjects: () => {} },
      { isEditing: true },
      { ui: { dialog: { kind: "new-project" } } },
      { children: "x" },
    ];
    for (const change of changes) {
      assert.strictEqual(
        projectWorkspaceLayoutPropsEqual(prev, { ...prev, ...change }),
        false,
        `expected re-render for change: ${JSON.stringify(Object.keys(change))}`,
      );
    }
  });
});
