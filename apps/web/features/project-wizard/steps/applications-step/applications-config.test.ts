import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  collapseApplications,
  fanOutApplications,
} from "./applications-config";
import { createEmptyContext } from "../bounded-context-step/createEmptyContext";

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

  it("defaults infra target to nestjs when none is declared", () => {
    const result = collapseApplications([ctx({ uiFramework: "Next.js" })]);
    assert.equal(result.infrastructureTarget, "nestjs");
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

describe("createEmptyContext inherits the Applications selection", () => {
  it("a context created AFTER the Applications step carries the project's UI/API choice (ADR-0041 gap-closer)", () => {
    // Simulates the BoundedContextStep add handler: collapse existing contexts,
    // pass the selection into createEmptyContext.
    const existing = [
      { uiFramework: "Remix" as const, infrastructureTarget: "nitro" as const },
    ];
    const { uiFramework, infrastructureTarget } =
      collapseApplications(existing);

    const created = createEmptyContext({ uiFramework, infrastructureTarget });

    assert.equal(created.uiFramework, "Remix");
    assert.equal(created.infrastructureTarget, "nitro");
  });

  it("falls back to the single-app preset (Next.js + nestjs) with no selection", () => {
    const created = createEmptyContext();
    assert.equal(created.uiFramework, "Next.js");
    assert.equal(created.infrastructureTarget, "nestjs");
  });
});
