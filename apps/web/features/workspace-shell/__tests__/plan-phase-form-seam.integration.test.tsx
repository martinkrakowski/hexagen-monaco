// The A1 seam test: ProjectWorkspace's plan branch renders PlanPhaseView inside
// a REAL WizardStepFormProvider under a REAL WizardLifecycleProvider (no mocked
// lifecycle context, no harness FormProvider). This is the widening edit PR A1
// exists for — the plan section and the wizard steps must share the ONE form
// instance owned by WizardLifecycleProvider, and a plan-section edit must reach
// the persistence port through the real autosave → updateProjectFormState path.
// Only the wire/port boundary is mocked, mirroring useProjectLifecycle.test.tsx.

// crypto is a getter-only global in Node, so stub it via vi.stubGlobal (a plain
// `global.crypto =` throws "has only a getter") — and BEFORE the imports below:
// emptyFormValues seeds a bounded-context id via crypto.randomUUID at module eval.
let uuidCounter = 0;
vi.stubGlobal("crypto", {
  randomUUID: () => `uuid-${(uuidCounter += 1)}`,
} as unknown as Crypto);

import { describe, it, vi, beforeEach, afterEach } from "vitest";
import assert from "node:assert/strict";
import React from "react";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { useFormContext, useWatch } from "react-hook-form";
import { ActiveWorkspaceProvider } from "../../../app/contexts/ActiveWorkspaceContext";

// wire is an `import * as` namespace whose exports are non-configurable under
// Vite, so vi.spyOn would throw "Cannot redefine property". Replace the module
// with vi.mock, keeping the real exports and overriding only the factories the
// lifecycle stack touches.
vi.mock("../../../app/lib/wire", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../app/lib/wire")>()),
  getEventBus: vi.fn(() => ({ publish: vi.fn(), subscribe: vi.fn() })),
  getChatPersistence: vi.fn(() => ({
    purgeProjectData: vi.fn(async () => {}),
  })),
}));

// Mock ONLY the persistence port — useSavedProjects, useProjectLifecycle,
// useWizardForm and both providers stay real. getSavedProjectsPersistence MUST
// return a stable reference: it feeds a useEffect dep, so a fresh object per
// call would re-run the load every render.
const persistencePort = vi.hoisted(() => {
  const state: { projects: Array<Record<string, unknown>> } = { projects: [] };
  const port = {
    loadProjects: async () => ({ success: true, value: state.projects }),
    saveProjects: async () => ({ success: true, value: undefined }),
    updateProjectRecord: async (
      id: string,
      updater: (p: Record<string, unknown>) => Record<string, unknown>,
    ) => {
      const index = state.projects.findIndex((p) => p.id === id);
      if (index === -1) {
        return {
          success: false as const,
          error: { kind: "NotFound", message: `No saved project ${id}` },
        };
      }
      const updated = updater(state.projects[index]);
      state.projects = state.projects.map((p, i) =>
        i === index ? updated : p,
      );
      return { success: true as const, value: updated };
    },
  };
  return { state, port };
});
vi.mock("../../../app/lib/wire.client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../app/lib/wire.client")>()),
  getMigrationReady: vi.fn(async () => {}),
  getSavedProjectsPersistence: vi.fn(() => persistencePort.port),
}));

import type { ProjectConfig } from "@hexagen/project-configuration";
import type { UseWorkspaceShellUiReturn } from "../hooks/useWorkspaceShellUi";
import type { UseEditorSessionReturn } from "../hooks/useEditorSession";
import {
  WizardLifecycleProvider,
  WizardStepFormProvider,
} from "../contexts/WizardLifecycleContext";
import { PlanPhaseView } from "../plan-phase/PlanPhaseView";
import { emptyFormValues } from "../../project-wizard/config";
import { installResizeObserverStub } from "../../../__tests__/support/resize-observer-stub";

// jsdom has no <dialog> implementation; PlanPhaseView mounts (closed) dialogs.
HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute("open", "");
};
HTMLDialogElement.prototype.close = function () {
  this.removeAttribute("open");
};

// PlanPhaseView now hosts the two-pane workbench (A2): the desktop layout is
// react-resizable-panels, which requires ResizeObserver (absent in jsdom).
installResizeObserverStub();

beforeEach(() => {
  persistencePort.state.projects = [
    {
      id: "p1",
      name: "Vellum",
      schemaVersion: 4,
      createdAt: 0,
      updatedAt: 0,
      // Deep clone so the fixture can't share nested refs with the
      // module-level emptyFormValues.
      formState: structuredClone(emptyFormValues),
      manifestYaml: "contexts:\n  - real architecture",
      layers: [],
    },
  ];
});
afterEach(cleanup);

/** Exactly what a wizard step does: read the shared form via useFormContext
 * (re-broadcast by its OWN WizardStepFormProvider mount, like the wizard's
 * left pane in ProjectWorkspace). */
function WizardStepReadProbe() {
  // useWatch (not watch()) so the PROBE component subscribes and re-renders —
  // the same live-read pattern the wizard steps use.
  const { control } = useFormContext<ProjectConfig>();
  const name = useWatch({ control, name: "governance.workspaceName" });
  return <output data-testid="wizard-step-read">{name}</output>;
}

/** ProjectWorkspace's plan-branch topology, under the REAL provider stack:
 * two sibling WizardStepFormProvider mounts (plan branch + wizard pane), both
 * re-broadcasting the single form owned by WizardLifecycleProvider. */
function renderPlanSeam() {
  const ui = {
    currentStepIndex: 0,
    viewMode: "visual" as const,
    openDialog: vi.fn(),
    closeDialog: vi.fn(),
    setContextId: vi.fn(),
    setMappingId: vi.fn(),
    enterEditMode: vi.fn(),
    enterGenesisMode: vi.fn(),
  } as unknown as UseWorkspaceShellUiReturn;
  const editor = {
    setSessionId: vi.fn(),
    clearSession: vi.fn(),
    setActiveWorkspace: vi.fn(),
    clearActiveWorkspace: vi.fn(),
  } as unknown as UseEditorSessionReturn;

  return render(
    <ActiveWorkspaceProvider>
      <WizardLifecycleProvider
        ui={ui}
        uiState={{ kind: "edit", projectId: "p1" }}
        editor={editor}
        totalSteps={4}
        onGoToStep={vi.fn()}
      >
        <WizardStepFormProvider>
          <PlanPhaseView onNavigateToImport={vi.fn()} />
        </WizardStepFormProvider>
        <WizardStepFormProvider>
          <WizardStepReadProbe />
        </WizardStepFormProvider>
      </WizardLifecycleProvider>
    </ActiveWorkspaceProvider>,
  );
}

const workspaceNameInput = () =>
  document.querySelector('input[placeholder="@mycompany"]') as HTMLInputElement;

// This suite runs the REAL provider stack (no timer mocks), so the initial
// port-load waitFor competes with 60+ parallel turbo tasks on CI — a generous
// bound there only widens the failure case; green runs return as soon as the
// condition holds. The PORT-WRITE waitFor deliberately keeps the 1s default:
// the historical failure there was NOT starvation (it failed identically at
// 15s) but a permanently lost edit — the autosave watch subscription used to
// land one Scheduler task after the fields committed, so a change dispatched
// in that gap never armed dirtyRef (fixed: the subscription is a layout
// effect now, live in the same commit that renders the fields). Post-fix the
// write lands in ~one poll; a long bound would only waste 15s per genuine
// regression.
const CI_SAFE_TIMEOUT = { timeout: 15_000 };

describe("Plan-phase form seam (PR A1 integration)", () => {
  it("renders the governance fields under the REAL providers and shares the wizard's form instance — a plan edit is visible to a wizard-step read and persists formState-only through the port", async () => {
    renderPlanSeam();

    // The port load is async — the guard state renders until p1 surfaces.
    await waitFor(
      () => assert.ok(workspaceNameInput(), "governance fields render"),
      CI_SAFE_TIMEOUT,
    );
    assert.ok(
      document.querySelector('section[aria-label="Project settings"]'),
      "the settings section landmark is present in the plan branch",
    );

    // Both sibling WizardStepFormProvider mounts re-broadcast ONE form: the
    // probe already sees the shared default.
    assert.strictEqual(
      screen.getByTestId("wizard-step-read").textContent,
      "@hexagen",
    );

    // Edit in the plan section → immediately visible through the wizard-step
    // read. This is THE seam claim: one form instance, not two.
    fireEvent.change(workspaceNameInput(), {
      target: { value: "@seam-proof" },
    });
    assert.strictEqual(
      screen.getByTestId("wizard-step-read").textContent,
      "@seam-proof",
    );

    // Blur flushes the debounced autosave through the REAL
    // useProjectLifecycle → useSavedProjects.updateProjectFormState →
    // port.updateProjectRecord chain.
    fireEvent.focusOut(workspaceNameInput());
    await waitFor(() => {
      const record = persistencePort.state.projects[0] as {
        formState: ProjectConfig;
        manifestYaml: string;
      };
      assert.strictEqual(
        record.formState.governance.workspaceName,
        "@seam-proof",
        "the edit reached the persistence port",
      );
    });
    // formState-only: the real generated manifest was NOT regenerated from the
    // form (the reason this path is updateProjectFormState, not updateProject).
    assert.strictEqual(
      (persistencePort.state.projects[0] as { manifestYaml: string })
        .manifestYaml,
      "contexts:\n  - real architecture",
    );
  });
});
