import { describe, it, expect, beforeEach } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { renderHook, act } from "@testing-library/react";

import type { BrownfieldFlowViewState } from "../BrownfieldFlow/types";
import {
  BROWNFIELD_DRAFT_SCHEMA_VERSION,
  brownfieldDraftKey,
  resetBrownfieldDraftStores,
  toBrownfieldDraft,
} from "./brownfield-draft";
import { useBrownfieldDraft } from "./useBrownfieldDraft";

function viewState(
  overrides: Partial<BrownfieldFlowViewState> = {},
): BrownfieldFlowViewState {
  return {
    state: "manifest_ratify",
    tier: "artifacts",
    repoUrl: null,
    repoRef: null,
    uploadedFileName: "handoff.zip",
    scanStageLabel: "Linting workspaces",
    layoutDraft: {
      contexts: [
        {
          packageRoot: "packages/billing",
          contextName: "billing",
          layerDirectories: { domain: ["src/domain"] },
        },
      ],
    },
    manifestDraft: {
      system: "acme",
      scope: "acme",
      architecture: "hexagonal",
      contexts: [
        {
          name: "billing",
          include: true,
          type: "core",
          description: "Billing",
          dependsOn: [],
        },
      ],
    },
    freshFindings: [
      { rule: "r", file: "f", specifier: "s", message: "m" },
    ],
    baselinedFindingKeys: ["r:f:s"],
    gateInstallMode: null,
    ...overrides,
  };
}

beforeEach(() => {
  resetBrownfieldDraftStores();
});

describe("useBrownfieldDraft", () => {
  it("reports no draft when nothing is stored", () => {
    const { result } = renderHook(() => useBrownfieldDraft("acme"));
    expect(result.current.restoredDraft).toBeNull();
    expect(result.current.restoredView).toBeNull();
  });

  it("saveDraft persists and the same hook sees it", () => {
    const { result } = renderHook(() => useBrownfieldDraft("acme"));

    act(() => {
      result.current.saveDraft(viewState());
    });

    expect(result.current.restoredDraft?.manifestDraft?.system).toBe("acme");
  });

  it("recovers a draft saved before the component mounted", () => {
    localStorage.setItem(
      brownfieldDraftKey("acme"),
      JSON.stringify(toBrownfieldDraft("acme", viewState())),
    );

    const { result } = renderHook(() => useBrownfieldDraft("acme"));

    expect(result.current.restoredView?.state).toBe("manifest_ratify");
    expect(result.current.restoredView?.baselinedFindingKeys).toEqual(["r:f:s"]);
  });

  it("does not restore fetched server state alongside the user's input", () => {
    localStorage.setItem(
      brownfieldDraftKey("acme"),
      JSON.stringify(toBrownfieldDraft("acme", viewState())),
    );

    const { result } = renderHook(() => useBrownfieldDraft("acme"));

    expect(result.current.restoredView?.freshFindings).toBeNull();
    expect(result.current.restoredView?.scanStageLabel).toBeNull();
    expect(result.current.restoredView?.uploadedFileName).toBeNull();
  });

  it("discardDraft clears the stored draft", () => {
    const { result } = renderHook(() => useBrownfieldDraft("acme"));

    act(() => {
      result.current.saveDraft(viewState());
    });
    act(() => {
      result.current.discardDraft();
    });

    expect(result.current.restoredDraft).toBeNull();
    expect(localStorage.getItem(brownfieldDraftKey("acme"))).toBeNull();
  });

  it("two mounted hooks on the same seed stay in sync", () => {
    const first = renderHook(() => useBrownfieldDraft("acme"));
    const second = renderHook(() => useBrownfieldDraft("acme"));

    act(() => {
      first.result.current.saveDraft(viewState());
    });

    expect(second.result.current.restoredDraft?.manifestDraft?.system).toBe(
      "acme",
    );
  });

  it("keeps separate seeds separate", () => {
    const acme = renderHook(() => useBrownfieldDraft("acme"));
    const globex = renderHook(() => useBrownfieldDraft("globex"));

    act(() => {
      acme.result.current.saveDraft(viewState());
    });

    expect(globex.result.current.restoredDraft).toBeNull();
  });

  it("purges a draft written by an older build instead of leaving it under the key", () => {
    const key = brownfieldDraftKey("acme");
    localStorage.setItem(
      key,
      JSON.stringify({
        ...toBrownfieldDraft("acme", viewState()),
        schemaVersion: BROWNFIELD_DRAFT_SCHEMA_VERSION - 1,
      }),
    );

    const { result } = renderHook(() => useBrownfieldDraft("acme"));

    // Discard-and-start-clean, both halves: nothing is restored, AND the
    // unrecognised blob is gone rather than being re-parsed on every visit.
    expect(result.current.restoredDraft).toBeNull();
    expect(localStorage.getItem(key)).toBeNull();
  });

  it("leaves a valid draft alone on mount", () => {
    const key = brownfieldDraftKey("acme");
    localStorage.setItem(
      key,
      JSON.stringify(toBrownfieldDraft("acme", viewState())),
    );

    renderHook(() => useBrownfieldDraft("acme"));

    expect(localStorage.getItem(key)).not.toBeNull();
  });
});

describe("useBrownfieldDraft — server render", () => {
  /**
   * The hydration contract, tested from the server side: React uses
   * `getServerSnapshot` for a server render, so the markup must show the
   * NO-DRAFT branch even with a perfectly valid draft sitting in storage. If
   * this ever renders the draft, the server HTML and the client's hydration
   * render disagree and React throws a hydration mismatch in production.
   */
  function DraftProbe() {
    const { restoredDraft } = useBrownfieldDraft("acme");
    return createElement(
      "div",
      null,
      restoredDraft === null ? "no-draft" : "restored",
    );
  }

  it("renders the no-draft branch on the server even when a draft is stored", () => {
    localStorage.setItem(
      brownfieldDraftKey("acme"),
      JSON.stringify(toBrownfieldDraft("acme", viewState())),
    );

    const markup = renderToStaticMarkup(createElement(DraftProbe));

    expect(markup).toContain("no-draft");
    expect(markup).not.toContain("restored");
  });

  it("does not write to storage during a server render", () => {
    const key = brownfieldDraftKey("acme");
    renderToStaticMarkup(createElement(DraftProbe));
    expect(localStorage.getItem(key)).toBeNull();
  });
});
