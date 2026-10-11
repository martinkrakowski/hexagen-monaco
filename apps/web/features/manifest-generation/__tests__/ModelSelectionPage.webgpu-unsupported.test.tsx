// Issue #766 — the live /projects/new/ai/models page starts a local model
// download even when WebGPU detection has resolved `false` (or the engine
// already reported `no_webgpu` / `unsupported_browser`). These tests pin the
// owner's decision: a local choice (or Retry) must call NEITHER
// initializeModel NOR switchModel and must show an inline notice, while a
// download already in flight is cancelled. Detection not finished behaves
// exactly as today. The cloud path is untouched.

import { describe, it, vi, beforeEach, afterEach } from "vitest";
import assert from "node:assert/strict";
import React from "react";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  act,
} from "@testing-library/react";

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

const gpu = vi.hoisted(() => ({
  current: {
    isWebGPUSupported: false,
    isBrowserSupported: false,
    isHardwareAdequate: false,
    estimatedVRAM: null,
    isRecommended: false,
    capability: null,
    isLoading: true,
  } as Record<string, unknown>,
}));
vi.mock("../ModelSelectionFlow/useWebGPUDetection", () => ({
  useWebGPUDetection: () => gpu.current,
}));

const wire = vi.hoisted(() => ({ hasKey: false }));
vi.mock("../../../app/lib/wire", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../app/lib/wire")>()),
  hasServerLLMAccessKey: vi.fn(() => wire.hasKey),
}));

import { ModelSelectionPage } from "../ModelSelectionPage";
import type { LocalLLMContext } from "../../../lib/llm-interfaces";
import type { LLMEngineStatus } from "@hexagen/local-llm";

const pendingForever = () => new Promise<Response>(() => {});
const fetchMock = vi.fn<typeof fetch>(pendingForever);
vi.stubGlobal("fetch", fetchMock);

const makeLlmContext = (
  status: LLMEngineStatus,
  overrides?: { loadedModelId?: string },
) => {
  const spies = {
    initializeModel: vi.fn(async () => {}),
    cancelDownload: vi.fn(),
    switchModel: vi.fn(async () => {}),
  };
  const ctx = {
    engineState: {
      status,
      progress: 0,
      loadedModelId: overrides?.loadedModelId,
    },
    initializeModel: spies.initializeModel,
    cancelDownload: spies.cancelDownload,
    hasAnyCachedModel: vi.fn(async () => false),
    hasModelInCache: vi.fn(async () => false),
    switchModel: spies.switchModel,
    deleteCachedModel: vi.fn(async () => {}),
    loadedModel: null,
    messages: [],
  };
  return { ctx: ctx as unknown as LocalLLMContext, spies };
};

const renderPage = (
  status: LLMEngineStatus,
  overrides?: { loadedModelId?: string },
) => {
  const { ctx, spies } = makeLlmContext(status, overrides);
  const view = render(<ModelSelectionPage llmContext={ctx} />);
  return { ctx, spies, ...view };
};

const clickFirstDownload = async () => {
  await act(async () => {
    fireEvent.click(screen.getAllByRole("button", { name: "Download" })[0]);
  });
};

beforeEach(() => {
  cleanup();
  nav.push.mockClear();
  nav.searchParams = new URLSearchParams("name=Vellum Notes");
  wire.hasKey = false;
  gpu.current = {
    isWebGPUSupported: false,
    isBrowserSupported: false,
    isHardwareAdequate: false,
    estimatedVRAM: null,
    isRecommended: false,
    capability: null,
    isLoading: true,
  };
});

afterEach(() => {
  cleanup();
});

describe("ModelSelectionPage — WebGPU-absent guard (#766)", () => {
  it("a. blocks a local choice when detection resolved false", async () => {
    // expected colour today: RED
    gpu.current = {
      ...gpu.current,
      isLoading: false,
      isWebGPUSupported: false,
    };
    const { spies } = renderPage("requires_model");
    await clickFirstDownload();
    assert.equal(spies.initializeModel.mock.calls.length, 0);
    assert.equal(spies.switchModel.mock.calls.length, 0);
    screen.getByText("Local models cannot run in this browser");
  });

  it("b. detection still loading proceeds as today", async () => {
    // expected colour today: GREEN (a pin)
    const { spies } = renderPage("requires_model");
    await clickFirstDownload();
    assert.equal(spies.initializeModel.mock.calls.length, 1);
    assert.equal(
      screen.queryByText("Local models cannot run in this browser"),
      null,
    );
  });

  it("c. detection resolved true proceeds as today", async () => {
    // expected colour today: GREEN (a pin)
    gpu.current = { ...gpu.current, isLoading: false, isWebGPUSupported: true };
    const { spies } = renderPage("requires_model");
    await clickFirstDownload();
    assert.equal(spies.initializeModel.mock.calls.length, 1);
    assert.equal(
      screen.queryByText("Local models cannot run in this browser"),
      null,
    );
  });

  it("d. switch path: allowed when supported, blocked when not", async () => {
    // expected colour today: GREEN for the true half, RED for the false half
    gpu.current = { ...gpu.current, isLoading: false, isWebGPUSupported: true };
    const ok = renderPage("ready", { loadedModelId: "qwen3-8b" });
    await clickFirstDownload();
    assert.equal(ok.spies.switchModel.mock.calls.length, 1);
    cleanup();

    gpu.current = {
      ...gpu.current,
      isLoading: false,
      isWebGPUSupported: false,
    };
    const blocked = renderPage("ready", { loadedModelId: "qwen3-8b" });
    await clickFirstDownload();
    assert.equal(blocked.spies.switchModel.mock.calls.length, 0);
    screen.getByText("Local models cannot run in this browser");
  });

  it("e. engine status no_webgpu blocks a local choice", async () => {
    // expected colour today: RED
    const { spies } = renderPage("no_webgpu");
    await clickFirstDownload();
    assert.equal(spies.initializeModel.mock.calls.length, 0);
    assert.equal(spies.switchModel.mock.calls.length, 0);
    screen.getByText("Local models cannot run in this browser");
  });

  it("f. no automatic start when detection resolved false", () => {
    // expected colour today: GREEN (a pin)
    gpu.current = {
      ...gpu.current,
      isLoading: false,
      isWebGPUSupported: false,
    };
    const { spies } = renderPage("no_webgpu");
    assert.equal(spies.initializeModel.mock.calls.length, 0);
    assert.equal(spies.switchModel.mock.calls.length, 0);
    assert.equal(
      screen.queryByText("Local models cannot run in this browser"),
      null,
    );
  });

  it("g. a download already in flight is cancelled when detection resolves false", async () => {
    // expected colour today: RED
    const { ctx, spies, rerender } = renderPage("downloading");
    gpu.current = {
      ...gpu.current,
      isLoading: false,
      isWebGPUSupported: false,
    };
    await act(async () => {
      rerender(<ModelSelectionPage llmContext={ctx} />);
    });
    assert.equal(spies.cancelDownload.mock.calls.length, 1);
    screen.getByText("Local models cannot run in this browser");
    await act(async () => {
      rerender(<ModelSelectionPage llmContext={ctx} />);
    });
    assert.equal(spies.cancelDownload.mock.calls.length, 1);
  });

  it("h. Retry is blocked when detection resolved false", async () => {
    // expected colour today: RED
    gpu.current = {
      ...gpu.current,
      isLoading: false,
      isWebGPUSupported: false,
    };
    const { spies } = renderPage("error", { loadedModelId: "qwen3-8b" });
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Retry download"));
    });
    assert.equal(spies.initializeModel.mock.calls.length, 0);
    screen.getByText("Local models cannot run in this browser");
    // The error card would cover the notice: it is gone after a blocked Retry.
    assert.equal(screen.queryByLabelText("Retry download"), null);
    assert.equal(screen.queryByRole("dialog"), null);
  });

  it("h2. an unblocked Retry retries the model and the error card stays", async () => {
    // expected colour today: GREEN (a pin)
    gpu.current = { ...gpu.current, isLoading: false, isWebGPUSupported: true };
    const { spies } = renderPage("error", { loadedModelId: "qwen3-8b" });
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Retry download"));
    });
    assert.equal(spies.initializeModel.mock.calls.length, 1);
    screen.getByLabelText("Retry download");
  });

  it("i. cloud path untouched when a server key exists", async () => {
    // expected colour today: GREEN (a pin)
    wire.hasKey = true;
    gpu.current = {
      ...gpu.current,
      isLoading: false,
      isWebGPUSupported: false,
    };
    const { spies } = renderPage("requires_model");
    assert.equal(
      screen.queryByText("Local models cannot run in this browser"),
      null,
    );
    const generate = screen.getByRole("button", { name: /generate manifest/i });
    await act(async () => {
      fireEvent.click(generate);
    });
    assert.deepEqual(nav.push.mock.calls, [
      ["/projects/new/ai?generate=1&name=Vellum%20Notes"],
    ]);
    assert.equal(spies.initializeModel.mock.calls.length, 0);
  });

  it("j. notice wording depends on the server key", async () => {
    // expected colour today: RED
    wire.hasKey = true;
    gpu.current = {
      ...gpu.current,
      isLoading: false,
      isWebGPUSupported: false,
    };
    renderPage("requires_model");
    await clickFirstDownload();
    assert.match(
      document.body.textContent ?? "",
      /The cloud model shown below is active/,
    );
    cleanup();

    wire.hasKey = false;
    gpu.current = {
      ...gpu.current,
      isLoading: false,
      isWebGPUSupported: false,
    };
    renderPage("requires_model");
    await clickFirstDownload();
    assert.match(document.body.textContent ?? "", /or go back/);
  });

  it("k. no 'Use a cloud model' button after a blocked click", async () => {
    // expected colour today: GREEN (a pin)
    gpu.current = {
      ...gpu.current,
      isLoading: false,
      isWebGPUSupported: false,
    };
    renderPage("requires_model");
    await clickFirstDownload();
    assert.equal(
      screen.queryByRole("button", { name: /use a cloud model/i }),
      null,
    );
  });

  it("l. the notice goes away when the condition does", async () => {
    // expected colour today: RED
    const { ctx, rerender } = renderPage("requires_model");
    gpu.current = {
      ...gpu.current,
      isLoading: false,
      isWebGPUSupported: false,
    };
    await act(async () => {
      rerender(<ModelSelectionPage llmContext={ctx} />);
    });
    await clickFirstDownload();
    screen.getByText("Local models cannot run in this browser");
    gpu.current = { ...gpu.current, isLoading: false, isWebGPUSupported: true };
    rerender(<ModelSelectionPage llmContext={ctx} />);
    assert.equal(
      screen.queryByText("Local models cannot run in this browser"),
      null,
    );
  });
});
