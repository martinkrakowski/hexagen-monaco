import { describe, it, expect } from "vitest";
import type { LLMEngineState, LLMEngineStatus } from "@hexagen/local-llm";
import {
  selectLocalLifecycle,
  lifecycleOwnsThePanel,
  type LocalLifecycle,
} from "../GovernanceAssistantPanel/lifecycle";

/**
 * Every member of `LLMEngineStatus` (REA-002).
 *
 * `satisfies` ties this list to the package's union at compile time in the
 * widening direction — a status deleted upstream fails here. The other
 * direction (a status ADDED upstream) is caught by the `never` arm inside
 * `selectLocalLifecycle`, which `apps/web`'s `tsc --noEmit` checks. This file
 * is NOT in that program — `apps/web/tsconfig.json` excludes every test file —
 * so the compile-time half of the guard deliberately lives in the production
 * module rather than in a type assertion here.
 */
const ENGINE_STATUSES = [
  "unavailable",
  "unsupported_browser",
  "no_webgpu",
  "opt_in",
  "downloading",
  "loading_vram",
  "ready",
  "error",
  "requires_model",
] as const satisfies readonly LLMEngineStatus[];

const ALL_LIFECYCLE_KINDS: ReadonlyArray<LocalLifecycle["kind"]> = [
  "booting",
  "unsupported",
  "waking-up",
  "loading",
  "failed",
  "requires-model",
  "usable",
];

function engineState(
  status: LLMEngineStatus,
  overrides: Partial<LLMEngineState> = {},
): LLMEngineState {
  return {
    status,
    progress: 0,
    loadedModelId: null,
    errorMessage: null,
    autoLoading: false,
    ...overrides,
  };
}

describe("selectLocalLifecycle — one discriminant instead of six booleans (REA-002)", () => {
  it("maps every engine status to exactly one lifecycle, and the scan covers every kind", () => {
    // Anti-vacuity: the population is the whole status union, not a sample,
    // and the sweep below must actually reach every branch of the selector.
    expect(ENGINE_STATUSES).toHaveLength(9);

    const produced = new Set<LocalLifecycle["kind"]>();
    for (const status of ENGINE_STATUSES) {
      for (const autoLoading of [false, true]) {
        const lifecycle = selectLocalLifecycle(
          engineState(status, { autoLoading }),
          false,
        );
        expect(ALL_LIFECYCLE_KINDS).toContain(lifecycle.kind);
        produced.add(lifecycle.kind);
      }
    }

    expect([...produced].sort()).toEqual([...ALL_LIFECYCLE_KINDS].sort());
  });

  it("suppresses every local-engine card when the server assistant is available", () => {
    // The old code repeated `&& !hasServerLLMAccessKey()` on six separate
    // booleans; a seventh card added later could simply forget it. Here it is
    // one early return, and this sweep is what holds it.
    for (const status of ENGINE_STATUSES) {
      for (const autoLoading of [false, true]) {
        expect(
          selectLocalLifecycle(engineState(status, { autoLoading }), true),
        ).toEqual({ kind: "usable" });
      }
    }
  });

  it("carries the data each card needs on the variant that needs it", () => {
    expect(selectLocalLifecycle(engineState("no_webgpu"), false)).toEqual({
      kind: "unsupported",
      reason: "no_webgpu",
    });
    expect(
      selectLocalLifecycle(engineState("unsupported_browser"), false),
    ).toEqual({ kind: "unsupported", reason: "unsupported_browser" });

    expect(
      selectLocalLifecycle(
        engineState("downloading", { progress: 0.42 }),
        false,
      ),
    ).toEqual({ kind: "loading", status: "downloading", progress: 0.42 });

    expect(
      selectLocalLifecycle(
        engineState("error", { errorMessage: "out of VRAM" }),
        false,
      ),
    ).toEqual({ kind: "failed", message: "out of VRAM" });
  });

  it("splits loading_vram on autoLoading — the only status whose card depends on more than the status", () => {
    expect(
      selectLocalLifecycle(
        engineState("loading_vram", { autoLoading: true }),
        false,
      ),
    ).toEqual({ kind: "waking-up" });

    expect(
      selectLocalLifecycle(
        engineState("loading_vram", { autoLoading: false, progress: 0.9 }),
        false,
      ),
    ).toEqual({ kind: "loading", status: "loading_vram", progress: 0.9 });
  });

  it("hands the panel over to a lifecycle card for every kind except the two that keep the Q&A view", () => {
    const keepsPanel: ReadonlyArray<LocalLifecycle["kind"]> = [
      "usable",
      "requires-model",
    ];

    const samples: LocalLifecycle[] = [
      { kind: "booting" },
      { kind: "unsupported", reason: "no_webgpu" },
      { kind: "waking-up" },
      { kind: "loading", status: "downloading", progress: 0 },
      { kind: "failed", message: null },
      { kind: "requires-model" },
      { kind: "usable" },
    ];

    // Anti-vacuity: the sample list is the whole union, one per kind.
    expect(samples.map((s) => s.kind).sort()).toEqual(
      [...ALL_LIFECYCLE_KINDS].sort(),
    );

    for (const lifecycle of samples) {
      expect(lifecycleOwnsThePanel(lifecycle)).toBe(
        !keepsPanel.includes(lifecycle.kind),
      );
    }
  });
});
