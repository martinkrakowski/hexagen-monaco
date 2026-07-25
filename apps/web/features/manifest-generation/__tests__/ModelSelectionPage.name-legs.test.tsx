// Pins the three GENESIS return legs of the /models detour: Back, Generate
// (auto-start) and the model-progress Cancel must all echo `?name=` back to
// /projects/new/ai. The carried name keys the genesis settings-store snapshot,
// so a leg that drops it makes the workbench form reseed from blank and
// strands the user's Section A edits under the old key. The Cancel leg
// regressed exactly this way (caught in #423's second review round) — it lives
// in a portal'd overlay, far from the two footer legs, and is easy to miss.
// The returnUrl arm belongs to non-genesis callers and takes precedence on
// every leg; one case pins that contract too.

import { describe, it, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

// The setup-file next/navigation stub mints a fresh router per call — these
// assertions need a STABLE push spy and a mutable ?name= query (blueprint:
// AIGenerationPage.workbench.integration).
const nav = vi.hoisted(() => ({
  push: vi.fn(),
  searchParams: new URLSearchParams("name=Vellum Notes"),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: nav.push,
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => "/projects/new/ai/models",
  useSearchParams: () => nav.searchParams,
  useParams: () => ({}),
}));

// Server-key fast-pass (the deployed configuration): isModelReady holds
// without any local engine, so the ready legs show "Generate Manifest".
vi.mock("../../../app/lib/wire", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../app/lib/wire")>()),
  hasServerLLMAccessKey: vi.fn(() => true),
}));

// The model catalog ships prebuilt from packages/model-settings/dist with its
// own bundled React — RENDERING it here crashes on dual-React hooks, and the
// catalog UI plays no part in the return legs. Stub only the view component;
// the passthrough keeps the package's other exports (setHardwareProfiler et
// al.) real for the rest of the import graph.
vi.mock("@hexagen/model-settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hexagen/model-settings")>()),
  ModelSettingsView: () => <div data-testid="model-settings-stub" />,
}));

import { ModelSelectionPage } from "../ModelSelectionPage";
import type { LocalLLMContext } from "../../../lib/llm-interfaces";
import type { LLMEngineStatus } from "@hexagen/local-llm";

// Keep the capability probe quiet and in-flight; nothing here awaits it.
const pendingForever = () => new Promise<Response>(() => {});
const fetchMock = vi.fn<typeof fetch>(pendingForever);
vi.stubGlobal("fetch", fetchMock);

/** Only the members ModelSelectionPage actually reads are functional. */
const makeLlmContext = (status: LLMEngineStatus): LocalLLMContext =>
  ({
    engineState: { status, progress: 0 },
    initializeModel: vi.fn(async () => {}),
    cancelDownload: vi.fn(),
    hasAnyCachedModel: vi.fn(async () => false),
    hasModelInCache: vi.fn(async () => false),
    switchModel: vi.fn(async () => {}),
    deleteCachedModel: vi.fn(async () => {}),
    loadedModel: null,
    messages: [],
  }) as unknown as LocalLLMContext;

beforeEach(() => {
  cleanup();
  nav.push.mockClear();
  nav.searchParams = new URLSearchParams("name=Vellum Notes");
});

describe("ModelSelectionPage — genesis ?name= return legs", () => {
  it("Back echoes the carried name", () => {
    render(<ModelSelectionPage llmContext={makeLlmContext("unloaded")} />);
    fireEvent.click(screen.getByRole("button", { name: /back/i }));
    assert.deepEqual(nav.push.mock.calls, [
      ["/projects/new/ai?name=Vellum%20Notes"],
    ]);
  });

  it("Generate Manifest echoes the carried name on the auto-start URL", () => {
    render(<ModelSelectionPage llmContext={makeLlmContext("unloaded")} />);
    fireEvent.click(screen.getByRole("button", { name: /generate manifest/i }));
    assert.deepEqual(nav.push.mock.calls, [
      ["/projects/new/ai?generate=1&name=Vellum%20Notes"],
    ]);
  });

  it("cancelling a model download echoes the carried name (portal leg)", () => {
    render(<ModelSelectionPage llmContext={makeLlmContext("downloading")} />);
    fireEvent.click(screen.getByLabelText("Cancel download"));
    assert.deepEqual(nav.push.mock.calls, [
      ["/projects/new/ai?name=Vellum%20Notes"],
    ]);
  });

  it("returnUrl still takes precedence over the genesis path on cancel", () => {
    nav.searchParams = new URLSearchParams(
      "returnUrl=%2Fwizard%2Fstep-3&name=Vellum Notes",
    );
    render(<ModelSelectionPage llmContext={makeLlmContext("downloading")} />);
    fireEvent.click(screen.getByLabelText("Cancel download"));
    assert.deepEqual(nav.push.mock.calls, [["/wizard/step-3"]]);
  });

  it("omits ?name= entirely when no name is carried (bypassed-name flow)", () => {
    nav.searchParams = new URLSearchParams();
    render(<ModelSelectionPage llmContext={makeLlmContext("downloading")} />);
    fireEvent.click(screen.getByLabelText("Cancel download"));
    assert.deepEqual(nav.push.mock.calls, [["/projects/new/ai"]]);
  });
});
