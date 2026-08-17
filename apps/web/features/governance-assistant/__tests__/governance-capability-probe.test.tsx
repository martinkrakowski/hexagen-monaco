import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { SecretVaultProvider } from "@/lib/vault-context";
import { invalidateCapabilityCache } from "@/lib/manifest-generation";
import { GovernanceAssistantPanel } from "../GovernanceAssistantPanel/GovernanceAssistantPanel";

/**
 * `@hexagen/model-settings` is replaced here, and ONLY here, because it cannot
 * be mounted from `apps/web` at all: `yarn.lock` resolves that workspace's
 * `react@^19.0.0` dev-dependency to 19.2.5 while `apps/web` gets 19.2.4, so
 * `packages/model-settings/node_modules/react` is a second React instance and
 * any of its hooks throws "Invalid hook call" under this runner. That is a
 * pre-existing dependency defect, reported separately — not something this
 * suite is asserting about.
 *
 * The substitution is a collaborator, not the subject: what is under test is
 * how many times the PANEL probes `/api/manifest/capabilities`, and the panel,
 * its capability transport and the settings view it routes to are all the real
 * modules. `importOriginal` is spread first so `wire.client`'s
 * `setHardwareProfiler(...)` DI call still finds its export.
 */
vi.mock("@hexagen/model-settings", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useHardwareDetection: () => ({ profile: null, isDetecting: false }),
  ModelSettingsView: (props: Record<string, unknown>) => (
    <div data-testid="model-settings-view">
      chat:{String(props.serverModelName)}
    </div>
  ),
}));

const CAPABILITIES_URL = "/api/manifest/capabilities";

const originalFetch = globalThis.fetch;
const originalLlmAvailable = process.env.NEXT_PUBLIC_LLM_AVAILABLE;

const wizardData = {
  governance: { workspaceName: "test-ws" },
  boundedContexts: [],
  externalContexts: [],
  peerMappings: [],
  addOnsAnswers: {},
};

beforeEach(() => {
  // The capability cache is module state with a 5-minute TTL. Clearing it makes
  // each test start cold, which is also the state a real first paint is in.
  invalidateCapabilityCache();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalLlmAvailable === undefined) {
    delete process.env.NEXT_PUBLIC_LLM_AVAILABLE;
  } else {
    process.env.NEXT_PUBLIC_LLM_AVAILABLE = originalLlmAvailable;
  }
});

function renderPanel() {
  return render(
    <SecretVaultProvider>
      <GovernanceAssistantPanel
        wizardData={wizardData}
        currentStepIndex={0}
        violations={[]}
        suggestions={[]}
        onRefresh={() => {}}
        isLoading={false}
      />
    </SecretVaultProvider>,
  );
}

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

function stubCapabilities(requests: string[], body: unknown) {
  globalThis.fetch = vi.fn(async (url: unknown) => {
    requests.push(String(url));
    if (String(url) !== CAPABILITIES_URL) {
      throw new Error(`unexpected request: ${String(url)}`);
    }
    return { ok: true, json: async () => body } as Response;
  }) as unknown as typeof fetch;
}

describe("governance assistant — capabilities are probed once per panel mount (REA-006)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("issues exactly one capabilities request across mount and opening model settings", async () => {
    process.env.NEXT_PUBLIC_LLM_AVAILABLE = "true";

    const requests: string[] = [];
    stubCapabilities(requests, { activeModelName: "z-ai/glm-5.2" });

    renderPanel();
    await settle();

    // Anti-vacuity: the panel really is probing. A refactor that stopped
    // fetching altogether would satisfy "at most one" and prove nothing.
    expect(requests.filter((u) => u === CAPABILITIES_URL)).toHaveLength(1);

    // Step past the capability cache's 5-minute TTL. Without this the shared
    // cache would absorb a second call site and the panel would look
    // single-probe when it is not — the point is that there IS only one call
    // site, not that a cache happens to be warm.
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 6 * 60 * 1000);

    // Opening model settings is the second historical call site.
    const modelButton = screen.getByTitle(/click to manage model/i);
    await act(async () => {
      modelButton.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(requests.filter((u) => u === CAPABILITIES_URL)).toHaveLength(1);
  });

  it("labels the footer from the probe rather than from a hard-coded guess", async () => {
    process.env.NEXT_PUBLIC_LLM_AVAILABLE = "true";

    const requests: string[] = [];
    let release: (() => void) | undefined;
    globalThis.fetch = vi.fn((url: unknown) => {
      requests.push(String(url));
      return new Promise<Response>((resolve) => {
        release = () =>
          resolve({
            ok: true,
            json: async () => ({ activeModelName: "z-ai/glm-5.2" }),
          } as Response);
      });
    }) as unknown as typeof fetch;

    renderPanel();
    await settle();

    // While the probe is in flight the panel knows no model name, and must not
    // invent one. The default it used to ship, "gpt-4o-mini", is not even the
    // model this deployment runs.
    expect(screen.queryByTitle(/click to manage model/i)).toBeNull();

    await act(async () => {
      release?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(screen.getByTitle(/click to manage model/i).textContent).toContain(
      "z-ai/glm-5.2",
    );
  });
});
