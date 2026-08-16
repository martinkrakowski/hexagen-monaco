import { describe, it } from "vitest";
import assert from "node:assert/strict";

import {
  collapseApplications,
  fanOutApplications,
} from "../applications-config";

type Ctx = Parameters<typeof collapseApplications>[0][number];

const ctx = (over: Partial<Ctx>): Ctx => ({
  uiFramework: "",
  infrastructureTarget: undefined,
  ...over,
});

describe("collapseApplications", () => {
  it("takes the first non-empty UI framework and infra target (in order)", () => {
    const result = collapseApplications([
      ctx({ uiFramework: "", infrastructureTarget: undefined }),
      ctx({ uiFramework: "Remix", infrastructureTarget: "nitro" }),
      ctx({ uiFramework: "Vue.js", infrastructureTarget: "express" }),
    ]);
    assert.equal(result.uiFramework, "Remix");
    assert.equal(result.infrastructureTarget, "nitro");
  });

  it("preserves headless (UI stays '') when no context declares a UI", () => {
    // Back-compat: a deliberately headless project must NOT be flipped to a UI.
    const result = collapseApplications([
      ctx({ uiFramework: "", infrastructureTarget: "nestjs" }),
      ctx({ uiFramework: "", infrastructureTarget: "nestjs" }),
    ]);
    assert.equal(result.uiFramework, "");
  });

  it("defaults infra target to the preset (nitro) when none is declared", () => {
    const result = collapseApplications([ctx({ uiFramework: "Next.js" })]);
    assert.equal(result.infrastructureTarget, "nitro");
  });

  it("preserves a deliberate 'none' (no API backend) selection", () => {
    const result = collapseApplications([
      ctx({ uiFramework: "Next.js", infrastructureTarget: "none" }),
    ]);
    assert.equal(result.infrastructureTarget, "none");
  });

  it("flags divergence when ≥2 contexts carry different non-empty values", () => {
    const result = collapseApplications([
      ctx({ uiFramework: "Next.js", infrastructureTarget: "nestjs" }),
      ctx({ uiFramework: "Remix", infrastructureTarget: "nitro" }),
    ]);
    assert.equal(result.uiDiverged, true);
    assert.equal(result.infraDiverged, true);
  });

  it("does NOT flag divergence for a single value or for empties", () => {
    const result = collapseApplications([
      ctx({ uiFramework: "Next.js", infrastructureTarget: "nestjs" }),
      ctx({ uiFramework: "", infrastructureTarget: undefined }),
      ctx({ uiFramework: "Next.js", infrastructureTarget: "nestjs" }),
    ]);
    assert.equal(result.uiDiverged, false);
    assert.equal(result.infraDiverged, false);
  });
});

describe("fanOutApplications", () => {
  it("writes the selection to every context", () => {
    const contexts = [
      ctx({ uiFramework: "Remix", infrastructureTarget: "nitro" }),
      ctx({ uiFramework: "", infrastructureTarget: undefined }),
    ];
    const out = fanOutApplications(contexts, {
      uiFramework: "Next.js",
      infrastructureTarget: "nestjs",
    });
    assert.ok(out.every((c) => c.uiFramework === "Next.js"));
    assert.ok(out.every((c) => c.infrastructureTarget === "nestjs"));
  });

  it("preserves all other (driven-infra) fields untouched", () => {
    const contexts = [
      {
        uiFramework: "" as const,
        infrastructureTarget: "express" as const,
        persistenceAdapter: "Prisma",
        messagingAdapter: "BullMQ",
      },
    ];
    const [out] = fanOutApplications(contexts, {
      uiFramework: "Next.js",
      infrastructureTarget: "nestjs",
    });
    assert.equal(out.persistenceAdapter, "Prisma");
    assert.equal(out.messagingAdapter, "BullMQ");
  });
});

describe("normalization (ADR-0041 D4 convergence)", () => {
  it("collapsing an empty context list yields headless UI (root of the add-after-delete case)", () => {
    // Why BoundedContextStep must NOT pass this collapse into createEmptyContext
    // when the list is empty: it would seed `""` (headless) instead of the preset.
    const result = collapseApplications([]);
    assert.equal(result.uiFramework, "");
  });

  it("fanning out the collapsed selection eliminates divergence (round-trip)", () => {
    // Models the ApplicationsStep entry-normalize effect: applying the collapse
    // back to the contexts converges them, so what the step shows is persisted.
    const divergent = [
      ctx({ uiFramework: "Next.js", infrastructureTarget: "nestjs" }),
      ctx({ uiFramework: "Remix", infrastructureTarget: "nitro" }),
    ];
    const collapsed = collapseApplications(divergent);
    const unified = fanOutApplications(divergent, {
      uiFramework: collapsed.uiFramework,
      infrastructureTarget: collapsed.infrastructureTarget,
    });

    const after = collapseApplications(unified);
    assert.equal(after.uiDiverged, false);
    assert.equal(after.infraDiverged, false);
    assert.ok(unified.every((c) => c.uiFramework === collapsed.uiFramework));
    assert.ok(
      unified.every(
        (c) => c.infrastructureTarget === collapsed.infrastructureTarget,
      ),
    );
  });

  it("normalizes a missing infrastructureTarget to the collapse default (nitro)", () => {
    const contexts = [
      ctx({ uiFramework: "Next.js", infrastructureTarget: undefined }),
    ];
    const collapsed = collapseApplications(contexts);
    const [unified] = fanOutApplications(contexts, {
      uiFramework: collapsed.uiFramework,
      infrastructureTarget: collapsed.infrastructureTarget,
    });
    assert.equal(unified.infrastructureTarget, "nitro");
  });
});
