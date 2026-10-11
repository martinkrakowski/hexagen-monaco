import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  ModelSettingsView,
  setHardwareProfiler,
} from "@hexagen/model-settings";

/**
 * Runtime proof that `apps/web` and `packages/model-settings` share ONE React
 * (since #869): the real `ModelSettingsView` — hooks included — renders inside
 * an `apps/web` jsdom test with no `vi.mock` of the package.
 */
setHardwareProfiler(() => ({
  profile: async () => ({
    success: false as const,
    error: new Error("no hardware in test"),
  }),
}));

describe("ModelSettingsView — real mount from apps/web", () => {
  it("renders the real component without a second React", async () => {
    render(
      <ModelSettingsView
        currentModelId={null}
        loadedModel={null}
        messagesLength={0}
        onSwitchModel={vi
          .fn<() => Promise<void>>()
          .mockResolvedValue(undefined)}
        onDeleteModel={vi
          .fn<() => Promise<void>>()
          .mockResolvedValue(undefined)}
        hasModelInCache={vi
          .fn<() => Promise<boolean>>()
          .mockResolvedValue(false)}
        isLoading={false}
      />,
    );

    expect(screen.getByText("AI Model Settings")).toBeTruthy();
  });
});
