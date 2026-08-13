// emptyFormValues seeds a bounded-context id via crypto.randomUUID at module
// eval, so crypto must be stubbed BEFORE that import.
let uuidCounter = 0;
vi.stubGlobal("crypto", {
  randomUUID: () => `uuid-${(uuidCounter += 1)}`,
} as unknown as Crypto);

import { describe, it, vi, afterEach } from "vitest";
import assert from "node:assert/strict";
import React from "react";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  act,
} from "@testing-library/react";
import { FormProvider, useForm } from "react-hook-form";
import type { ProjectConfig } from "@hexagen/project-configuration";
import { emptyFormValues } from "../../../project-wizard/config";
import { ProjectSettingsSection } from "../ProjectSettingsSection";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// Production supplies the shared wizard form through WizardStepFormProvider; the
// section reads it via useFormContext. Wrap it in a real form here.
function renderSection(
  persist: (id: string, formState: ProjectConfig) => void,
) {
  function Harness() {
    const form = useForm<ProjectConfig>({ defaultValues: emptyFormValues });
    return (
      <FormProvider {...form}>
        <ProjectSettingsSection projectId="p1" persist={persist} />
      </FormProvider>
    );
  }
  return render(<Harness />);
}

const workspaceNameInput = () =>
  screen.getByLabelText("Workspace Name") as HTMLInputElement;

describe("ProjectSettingsSection", () => {
  it("renders the governance fields under a labeled section", () => {
    renderSection(vi.fn());
    const section = document.querySelector(
      'section[aria-label="Project settings"]',
    );
    assert.ok(section, "the section landmark is present");
    const text = (document.body.textContent || "").replace(/\s+/g, " ");
    // A2: the visible "Project settings" heading moved to the workbench's
    // accordion Trigger — the section itself carries only the aria-label
    // landmark and the autosave hint.
    assert.match(text, /Changes save automatically/);
    assert.match(text, /Workspace Name/);
    assert.match(text, /Naming Conventions/i);
    // Seeded from the shared form's defaults.
    assert.strictEqual(
      workspaceNameInput().value,
      "@hexagen",
      "the field reflects the shared form value",
    );
  });

  it("persists an edit through the shared form after the debounce", () => {
    vi.useFakeTimers();
    const persist = vi.fn();
    renderSection(persist);

    fireEvent.change(workspaceNameInput(), { target: { value: "@renamed" } });
    assert.strictEqual(
      persist.mock.calls.length,
      0,
      "debounced, not immediate",
    );

    act(() => {
      vi.advanceTimersByTime(600);
    });

    assert.strictEqual(persist.mock.calls.length, 1);
    assert.strictEqual(persist.mock.calls[0][0], "p1");
    assert.strictEqual(
      (persist.mock.calls[0][1] as ProjectConfig).governance.workspaceName,
      "@renamed",
    );
  });

  it("flushes immediately on blur (focusout bubbles to the section)", () => {
    const persist = vi.fn();
    renderSection(persist);

    const input = workspaceNameInput();
    fireEvent.change(input, { target: { value: "@blurred" } });
    // Real focus loss fires focusout, which bubbles to the section's onBlur.
    fireEvent.focusOut(input);

    assert.strictEqual(
      persist.mock.calls.length,
      1,
      "blur commits without waiting out the debounce",
    );
    assert.strictEqual(
      (persist.mock.calls[0][1] as ProjectConfig).governance.workspaceName,
      "@blurred",
    );
  });
});
