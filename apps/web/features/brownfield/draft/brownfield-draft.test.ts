import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import type {
  BrownfieldFlowState,
  BrownfieldFlowViewState,
} from "../BrownfieldFlow/types";
import {
  BROWNFIELD_DRAFT_MAX_AGE_MS,
  BROWNFIELD_DRAFT_SCHEMA_VERSION,
  brownfieldDraftKey,
  emptyBrownfieldDraft,
  fromBrownfieldDraft,
  getBrownfieldDraftStore,
  isBrownfieldDraft,
  resetBrownfieldDraftStores,
  resolveResumeState,
  resumableStateFor,
  toBrownfieldDraft,
  type BrownfieldDraft,
} from "./brownfield-draft";

/** A fully populated view state — every field the flow can carry. */
function fullViewState(): BrownfieldFlowViewState {
  return {
    state: "findings_review",
    projectName: "acme",
    tier: "artifacts",
    repoUrl: "https://example.invalid/acme.git",
    repoRef: "main",
    uploadedFileName: "handoff.zip",
    scanStageLabel: "Linting workspaces",
    blockReason: "could-not-run",
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
      {
        rule: "no-cross-context-import",
        file: "src/a.ts",
        specifier: "../b",
        message: "nope",
      },
    ],
    baselinedFindingKeys: ["no-cross-context-import:src/a.ts:../b"],
    gateInstallMode: "download-zip",
    error: "boom",
  };
}

function validDraft(overrides: Partial<BrownfieldDraft> = {}): BrownfieldDraft {
  return { ...emptyBrownfieldDraft("acme"), ...overrides };
}

beforeEach(() => {
  // The store registry is module-scoped; the shared afterEach in
  // vitest.setup.ts clears localStorage but not these caches.
  resetBrownfieldDraftStores();
});

describe("brownfieldDraftKey", () => {
  it("keys named and unnamed flows into distinct slots", () => {
    expect(brownfieldDraftKey("acme")).not.toBe(brownfieldDraftKey(null));
  });

  it("treats a whitespace-only seed as unnamed", () => {
    expect(brownfieldDraftKey("   ")).toBe(brownfieldDraftKey(null));
  });

  it("does not let a project literally named like the unnamed slot collide", () => {
    expect(brownfieldDraftKey("u")).not.toBe(brownfieldDraftKey(null));
    expect(brownfieldDraftKey("__unnamed__")).not.toBe(
      brownfieldDraftKey(null),
    );
  });

  it("gives different projects different keys", () => {
    expect(brownfieldDraftKey("acme")).not.toBe(brownfieldDraftKey("globex"));
  });
});

describe("isBrownfieldDraft — versioning is discard-and-start-clean", () => {
  it("accepts a current-version draft", () => {
    expect(isBrownfieldDraft(validDraft())).toBe(true);
  });

  it("rejects an OLDER schemaVersion whole, rather than salvaging fields", () => {
    const older = {
      ...validDraft({ tier: "clone", repoUrl: "https://example.invalid" }),
      schemaVersion: BROWNFIELD_DRAFT_SCHEMA_VERSION - 1,
    };
    expect(isBrownfieldDraft(older)).toBe(false);
  });

  it("rejects a NEWER schemaVersion — a forward-compat guess is still a guess", () => {
    const newer = {
      ...validDraft(),
      schemaVersion: BROWNFIELD_DRAFT_SCHEMA_VERSION + 1,
    };
    expect(isBrownfieldDraft(newer)).toBe(false);
  });

  it("rejects a draft with no schemaVersion at all", () => {
    const unversioned: Record<string, unknown> = { ...validDraft() };
    delete unversioned.schemaVersion;
    expect(isBrownfieldDraft(unversioned)).toBe(false);
  });

  it("rejects non-objects and null", () => {
    expect(isBrownfieldDraft(null)).toBe(false);
    expect(isBrownfieldDraft("draft")).toBe(false);
    expect(isBrownfieldDraft(42)).toBe(false);
  });

  it("rejects an unknown flowState", () => {
    expect(
      isBrownfieldDraft(
        validDraft({ flowState: "wandering" as BrownfieldFlowState }),
      ),
    ).toBe(false);
  });

  it("rejects a half-shaped nested layout context", () => {
    const half = {
      ...validDraft(),
      layoutDraft: { contexts: [{ packageRoot: "packages/billing" }] },
    };
    expect(isBrownfieldDraft(half)).toBe(false);
  });

  it("rejects a manifest context missing `include`", () => {
    const half = {
      ...validDraft(),
      manifestDraft: {
        system: "a",
        scope: "a",
        architecture: "hexagonal",
        contexts: [
          { name: "billing", type: "core", description: "x", dependsOn: [] },
        ],
      },
    };
    expect(isBrownfieldDraft(half)).toBe(false);
  });

  it("rejects baselinedFindingKeys that are not all strings", () => {
    expect(
      isBrownfieldDraft({ ...validDraft(), baselinedFindingKeys: ["a", 2] }),
    ).toBe(false);
  });

  it("rejects an unknown gateInstallMode", () => {
    expect(
      isBrownfieldDraft({ ...validDraft(), gateInstallMode: "email-it" }),
    ).toBe(false);
  });
});

describe("toBrownfieldDraft — persists input, drops server state", () => {
  it("keeps every user-supplied field", () => {
    const draft = toBrownfieldDraft("acme", fullViewState(), 1000);
    expect(draft.tier).toBe("artifacts");
    expect(draft.repoUrl).toBe("https://example.invalid/acme.git");
    expect(draft.repoRef).toBe("main");
    expect(draft.layoutDraft?.contexts[0]?.contextName).toBe("billing");
    expect(draft.manifestDraft?.system).toBe("acme");
    expect(draft.baselinedFindingKeys).toEqual([
      "no-cross-context-import:src/a.ts:../b",
    ]);
    expect(draft.gateInstallMode).toBe("download-zip");
    expect(draft.flowState).toBe("findings_review");
    expect(draft.savedAt).toBe(1000);
  });

  it("drops fetched / in-flight server state entirely", () => {
    const draft = toBrownfieldDraft("acme", fullViewState(), 1000);
    const keys = Object.keys(draft);
    for (const dropped of [
      "freshFindings",
      "scanStageLabel",
      "uploadedFileName",
      "blockReason",
      "error",
    ]) {
      expect(keys).not.toContain(dropped);
    }
  });

  it("round-trips through the validator", () => {
    expect(isBrownfieldDraft(toBrownfieldDraft("acme", fullViewState()))).toBe(
      true,
    );
  });

  it("normalises the seed name the same way the key does", () => {
    expect(toBrownfieldDraft("  acme  ", fullViewState()).seedName).toBe(
      "acme",
    );
    expect(toBrownfieldDraft("   ", fullViewState()).seedName).toBeNull();
  });
});

describe("resumableStateFor — a restore never lands on an empty screen", () => {
  const expected: Record<BrownfieldFlowState, BrownfieldFlowState> = {
    tier_pick: "tier_pick",
    uploading: "tier_pick",
    repo_entry: "repo_entry",
    scanning: "tier_pick",
    blocked: "tier_pick",
    layout_ratify: "layout_ratify",
    manifest_ratify: "manifest_ratify",
    findings_review: "manifest_ratify",
    report: "manifest_ratify",
    gate_install: "manifest_ratify",
  };

  for (const [from, to] of Object.entries(expected)) {
    it(`clamps ${from} to ${to}`, () => {
      expect(resumableStateFor(from as BrownfieldFlowState)).toBe(to);
    });
  }

  it("never restores into a blocking state", () => {
    expect(resumableStateFor("uploading")).not.toBe("uploading");
    expect(resumableStateFor("scanning")).not.toBe("scanning");
  });
});

describe("resolveResumeState — degrades when the content is missing", () => {
  const view = fullViewState();

  it("resumes at manifest_ratify when the manifest draft is present", () => {
    const draft = toBrownfieldDraft("acme", { ...view, state: "report" });
    expect(resolveResumeState(draft)).toBe("manifest_ratify");
  });

  it("falls back to layout_ratify when the manifest draft is absent", () => {
    const draft = toBrownfieldDraft("acme", {
      ...view,
      state: "report",
      manifestDraft: null,
    });
    expect(resolveResumeState(draft)).toBe("layout_ratify");
  });

  it("falls back to tier_pick when neither draft is present", () => {
    const draft = toBrownfieldDraft("acme", {
      ...view,
      state: "report",
      manifestDraft: null,
      layoutDraft: null,
    });
    expect(resolveResumeState(draft)).toBe("tier_pick");
  });

  it("only resumes repo_entry for the clone tier", () => {
    const clone = toBrownfieldDraft("acme", {
      ...view,
      state: "repo_entry",
      tier: "clone",
    });
    const zip = toBrownfieldDraft("acme", {
      ...view,
      state: "repo_entry",
      tier: "zip",
    });
    expect(resolveResumeState(clone)).toBe("repo_entry");
    expect(resolveResumeState(zip)).toBe("tier_pick");
  });
});

describe("fromBrownfieldDraft", () => {
  it("nulls every non-persisted field so a spread cannot inherit stale data", () => {
    const restored = fromBrownfieldDraft(
      toBrownfieldDraft("acme", fullViewState()),
    );
    expect(restored.freshFindings).toBeNull();
    expect(restored.scanStageLabel).toBeNull();
    expect(restored.uploadedFileName).toBeNull();
    expect(restored.blockReason).toBeNull();
    expect(restored.error).toBeNull();
  });

  it("carries the user's baselining decisions and clamps the state", () => {
    const restored = fromBrownfieldDraft(
      toBrownfieldDraft("acme", fullViewState()),
    );
    expect(restored.baselinedFindingKeys).toEqual([
      "no-cross-context-import:src/a.ts:../b",
    ]);
    expect(restored.state).toBe("manifest_ratify");
  });
});

describe("the seed-keyed store", () => {
  it("memoises one store per key so subscribers share a listener set", () => {
    expect(getBrownfieldDraftStore("acme")).toBe(
      getBrownfieldDraftStore("acme"),
    );
    expect(getBrownfieldDraftStore("acme")).not.toBe(
      getBrownfieldDraftStore("globex"),
    );
  });

  it("round-trips a draft through storage", () => {
    const store = getBrownfieldDraftStore("acme");
    store.save(toBrownfieldDraft("acme", fullViewState()));
    expect(store.read()?.manifestDraft?.system).toBe("acme");
  });

  it("does not leak one project's draft into another's", () => {
    getBrownfieldDraftStore("acme").save(
      toBrownfieldDraft("acme", fullViewState()),
    );
    expect(getBrownfieldDraftStore("globex").read()).toBeNull();
  });

  it("clear() removes the draft", () => {
    const store = getBrownfieldDraftStore("acme");
    store.save(toBrownfieldDraft("acme", fullViewState()));
    store.clear();
    expect(store.read()).toBeNull();
  });

  it("notifies subscribers on save and on clear", () => {
    const store = getBrownfieldDraftStore("acme");
    const seen = vi.fn();
    const unsubscribe = store.subscribe(seen);
    store.save(toBrownfieldDraft("acme", fullViewState()));
    store.clear();
    unsubscribe();
    expect(seen).toHaveBeenCalledTimes(2);
  });

  it("returns a stable snapshot reference between writes (useSyncExternalStore)", () => {
    const store = getBrownfieldDraftStore("acme");
    store.save(toBrownfieldDraft("acme", fullViewState()));
    expect(store.read()).toBe(store.read());
  });

  it("invalidates the cached snapshot after a save with no subscribers", () => {
    const store = getBrownfieldDraftStore("acme");
    expect(store.read()).toBeNull();
    store.save(toBrownfieldDraft("acme", fullViewState()));
    expect(store.read()).not.toBeNull();
  });

  it("readServer() is always null, which is what keeps hydration matching", () => {
    const store = getBrownfieldDraftStore("acme");
    store.save(toBrownfieldDraft("acme", fullViewState()));
    expect(store.readServer()).toBeNull();
  });

  it("discards a draft written by an older build instead of half-applying it", () => {
    const stale = {
      ...toBrownfieldDraft("acme", fullViewState()),
      schemaVersion: BROWNFIELD_DRAFT_SCHEMA_VERSION - 1,
    };
    localStorage.setItem(brownfieldDraftKey("acme"), JSON.stringify(stale));
    expect(getBrownfieldDraftStore("acme").read()).toBeNull();
  });

  it("discards unparseable stored content", () => {
    localStorage.setItem(brownfieldDraftKey("acme"), "{not json");
    expect(getBrownfieldDraftStore("acme").read()).toBeNull();
  });

  it("discards a draft older than the max age", () => {
    const old = toBrownfieldDraft(
      "acme",
      fullViewState(),
      Date.now() - BROWNFIELD_DRAFT_MAX_AGE_MS - 1,
    );
    localStorage.setItem(brownfieldDraftKey("acme"), JSON.stringify(old));
    expect(getBrownfieldDraftStore("acme").read()).toBeNull();
  });

  it("keeps a draft just inside the max age", () => {
    const recent = toBrownfieldDraft(
      "acme",
      fullViewState(),
      Date.now() - (BROWNFIELD_DRAFT_MAX_AGE_MS - 60_000),
    );
    localStorage.setItem(brownfieldDraftKey("acme"), JSON.stringify(recent));
    expect(getBrownfieldDraftStore("acme").read()).not.toBeNull();
  });

  it("discards a draft whose seedName does not match its key", () => {
    const mismatched = toBrownfieldDraft("globex", fullViewState());
    localStorage.setItem(
      brownfieldDraftKey("acme"),
      JSON.stringify(mismatched),
    );
    expect(getBrownfieldDraftStore("acme").read()).toBeNull();
  });
});

describe("storage that throws (private browsing / blocked site data)", () => {
  afterEach(() => {
    // Restores the in-memory storage installed by vitest.setup.ts.
    vi.unstubAllGlobals();
    resetBrownfieldDraftStores();
  });

  function stubThrowingStorage(): void {
    vi.stubGlobal("localStorage", {
      get length(): number {
        throw new Error("SecurityError: site data blocked");
      },
      clear(): void {
        throw new Error("SecurityError: site data blocked");
      },
      getItem(): string | null {
        throw new Error("SecurityError: site data blocked");
      },
      key(): string | null {
        throw new Error("SecurityError: site data blocked");
      },
      removeItem(): void {
        throw new Error("SecurityError: site data blocked");
      },
      setItem(): void {
        throw new Error("SecurityError: site data blocked");
      },
    });
    resetBrownfieldDraftStores();
  }

  it("read() returns null rather than throwing", () => {
    stubThrowingStorage();
    expect(() => getBrownfieldDraftStore("acme").read()).not.toThrow();
    expect(getBrownfieldDraftStore("acme").read()).toBeNull();
  });

  it("save() is a silent no-op rather than throwing", () => {
    stubThrowingStorage();
    const store = getBrownfieldDraftStore("acme");
    expect(() =>
      store.save(toBrownfieldDraft("acme", fullViewState())),
    ).not.toThrow();
    expect(store.read()).toBeNull();
  });

  it("clear() does not throw", () => {
    stubThrowingStorage();
    expect(() => getBrownfieldDraftStore("acme").clear()).not.toThrow();
  });
});
