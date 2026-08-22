/**
 * The rules that decide whether an S4 draft is safe to write.
 *
 * Every case here corresponds to something that would otherwise land in a
 * user's `.architecture/manifest.yaml` and be discovered by `hexagen-lint`
 * later, in someone else's pull request.
 */
import { describe, it, expect } from "vitest";

import type {
  BrownfieldManifestContextDraft,
  BrownfieldManifestDraft,
} from "../BrownfieldFlow/types";
import {
  DEFAULT_ARCHITECTURE,
  DEFAULT_CONTEXT_TYPE,
  MANIFEST_ARCHITECTURES,
  MANIFEST_CONTEXT_TYPES,
  createManifestDraft,
  dependencyOptionsFor,
  includedContexts,
  toRatificationPayload,
  toggleDependency,
  updateContextAt,
  validateManifestDraft,
} from "./manifest-draft";

function contextOf(
  overrides: Partial<BrownfieldManifestContextDraft> = {},
): BrownfieldManifestContextDraft {
  return {
    name: "orders",
    include: true,
    type: "core",
    description: "",
    dependsOn: [],
    ...overrides,
  };
}

function draftOf(
  overrides: Partial<BrownfieldManifestDraft> = {},
): BrownfieldManifestDraft {
  return {
    system: "Acme Platform",
    scope: "acme",
    architecture: "modular-monolith",
    contexts: [contextOf()],
    ...overrides,
  };
}

const problemIds = (draft: BrownfieldManifestDraft): string[] =>
  validateManifestDraft(draft).map((problem) => problem.id);

describe("createManifestDraft", () => {
  const layout = {
    contexts: [
      { packageRoot: "packages/orders", contextName: "orders", layerDirectories: {} },
      { packageRoot: "packages/billing", contextName: "billing", layerDirectories: {} },
    ],
  };

  it("carries every context S3 ratified, all included", () => {
    const draft = createManifestDraft(layout, "Acme Platform");

    expect(draft.contexts.map((c) => c.name)).toEqual(["orders", "billing"]);
    expect(draft.contexts.every((c) => c.include)).toBe(true);
  });

  it("infers nothing — no descriptions and no edges", () => {
    const draft = createManifestDraft(layout, "Acme Platform");

    expect(draft.contexts.every((c) => c.description === "")).toBe(true);
    expect(draft.contexts.every((c) => c.dependsOn.length === 0)).toBe(true);
    expect(draft.contexts.every((c) => c.type === DEFAULT_CONTEXT_TYPE)).toBe(
      true,
    );
  });

  it("proposes the same architecture `hexagen bootstrap --yes` proposes", () => {
    expect(createManifestDraft(layout, "Acme").architecture).toBe(
      DEFAULT_ARCHITECTURE,
    );
    expect(MANIFEST_ARCHITECTURES).toContain(DEFAULT_ARCHITECTURE);
    expect(MANIFEST_CONTEXT_TYPES).toContain(DEFAULT_CONTEXT_TYPE);
  });

  it("pre-sanitizes the scope so the preview does not open on a rewrite", () => {
    const draft = createManifestDraft(layout, "Acme Platform");

    expect(draft.system).toBe("Acme Platform");
    expect(draft.scope).toBe("acme-platform");
  });

  it("produces a draft that already validates", () => {
    expect(validateManifestDraft(createManifestDraft(layout, "Acme"))).toEqual(
      [],
    );
  });
});

describe("validateManifestDraft", () => {
  it("accepts a complete draft", () => {
    expect(validateManifestDraft(draftOf())).toEqual([]);
  });

  it("refuses a system with no name", () => {
    expect(problemIds(draftOf({ system: "   " }))).toContain("system-empty");
  });

  it("refuses a scope with no name", () => {
    expect(problemIds(draftOf({ scope: "" }))).toContain("scope-empty");
  });

  it("refuses an architecture hexagen does not write", () => {
    expect(problemIds(draftOf({ architecture: "serverless" }))).toContain(
      "architecture-unknown",
    );
  });

  it("refuses zero included contexts, as `hexagen bootstrap` itself does", () => {
    const draft = draftOf({ contexts: [contextOf({ include: false })] });

    expect(problemIds(draft)).toContain("contexts-none-included");
  });

  it("ignores excluded rows when checking everything else", () => {
    // An excluded row with a broken name and a dangling edge is not a problem:
    // it is not going to be written.
    const draft = draftOf({
      contexts: [
        contextOf({ name: "orders" }),
        contextOf({ name: "  ", include: false, dependsOn: ["ghost"] }),
      ],
    });

    expect(validateManifestDraft(draft)).toEqual([]);
  });

  it("refuses an included context with no name", () => {
    const draft = draftOf({
      contexts: [contextOf({ name: "orders" }), contextOf({ name: "   " })],
    });

    expect(problemIds(draft)).toContain("context-name-empty");
  });

  it("refuses two included contexts with the same name", () => {
    const draft = draftOf({
      contexts: [contextOf({ name: "orders" }), contextOf({ name: "orders" })],
    });

    expect(problemIds(draft)).toContain("context-duplicate-orders");
  });

  it("refuses a context that depends on itself", () => {
    const draft = draftOf({
      contexts: [contextOf({ name: "orders", dependsOn: ["orders"] })],
    });

    expect(problemIds(draft)).toContain("context-self-edge-orders");
  });

  it("refuses an edge pointing at a context the user excluded", () => {
    const draft = draftOf({
      contexts: [
        contextOf({ name: "orders", dependsOn: ["billing"] }),
        contextOf({ name: "billing", include: false }),
      ],
    });

    const problems = validateManifestDraft(draft);

    expect(problems.map((p) => p.id)).toContain(
      "context-dangling-edge-orders-billing",
    );
    // The message has to name BOTH ends — "invalid dependency" sends the user
    // hunting through every row.
    expect(problems[0]?.message).toContain("orders");
    expect(problems[0]?.message).toContain("billing");
  });

  it("accepts an edge between two included contexts", () => {
    const draft = draftOf({
      contexts: [
        contextOf({ name: "orders", dependsOn: ["billing"] }),
        contextOf({ name: "billing" }),
      ],
    });

    expect(validateManifestDraft(draft)).toEqual([]);
  });

  it("attaches each problem to the control that caused it", () => {
    const draft = draftOf({
      system: "",
      scope: "",
      contexts: [contextOf({ include: false })],
    });

    const fields = validateManifestDraft(draft).map((p) => p.field);

    expect(fields).toContain("system");
    expect(fields).toContain("scope");
    expect(fields).toContain("contexts");
  });

  it("gives every problem a distinct key so the list can render", () => {
    const draft = draftOf({
      system: "",
      scope: "",
      contexts: [
        contextOf({ name: "orders", dependsOn: ["orders", "ghost"] }),
        contextOf({ name: "orders" }),
      ],
    });

    const ids = problemIds(draft);

    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("includedContexts / dependencyOptionsFor", () => {
  it("counts only ticked rows", () => {
    const draft = draftOf({
      contexts: [contextOf({ name: "a" }), contextOf({ name: "b", include: false })],
    });

    expect(includedContexts(draft).map((c) => c.name)).toEqual(["a"]);
  });

  it("never offers a context itself as its own dependency", () => {
    const draft = draftOf({
      contexts: [contextOf({ name: "orders" }), contextOf({ name: "billing" })],
    });

    expect(dependencyOptionsFor(draft, 0)).toEqual(["billing"]);
    expect(dependencyOptionsFor(draft, 1)).toEqual(["orders"]);
  });

  it("never offers an excluded context — a control whose only outcome is an error", () => {
    const draft = draftOf({
      contexts: [
        contextOf({ name: "orders" }),
        contextOf({ name: "billing", include: false }),
      ],
    });

    expect(dependencyOptionsFor(draft, 0)).toEqual([]);
  });

  it("de-duplicates while the user is mid-rename", () => {
    const draft = draftOf({
      contexts: [
        contextOf({ name: "orders" }),
        contextOf({ name: "billing" }),
        contextOf({ name: "billing" }),
      ],
    });

    expect(dependencyOptionsFor(draft, 0)).toEqual(["billing"]);
  });

  it("has no row to exclude for an index that does not exist, so offers them all", () => {
    // Not a crash and not an empty list: the caller is out of step with the
    // draft, and the honest answer is "every included context is a candidate".
    expect(dependencyOptionsFor(draftOf(), 99)).toEqual(["orders"]);
  });

  it("has nothing to offer a lone context", () => {
    expect(dependencyOptionsFor(draftOf(), 0)).toEqual([]);
  });
});

describe("updateContextAt / toggleDependency", () => {
  it("patches by index so a rename cannot lose the row", () => {
    const draft = draftOf({ contexts: [contextOf({ name: "orders" })] });
    const renamed = updateContextAt(draft, 0, { name: "ordering" });

    expect(renamed.contexts[0]?.name).toBe("ordering");
    // The original is untouched: the flow reducer relies on a new object.
    expect(draft.contexts[0]?.name).toBe("orders");
  });

  it("ignores an index outside the draft", () => {
    const draft = draftOf();

    expect(updateContextAt(draft, 7, { name: "x" })).toBe(draft);
    expect(updateContextAt(draft, -1, { name: "x" })).toBe(draft);
    expect(toggleDependency(draft, 7, "billing", true)).toBe(draft);
  });

  it("adds an edge, and adding it twice does not duplicate it", () => {
    const draft = draftOf({
      contexts: [contextOf({ name: "orders" }), contextOf({ name: "billing" })],
    });

    const once = toggleDependency(draft, 0, "billing", true);
    const twice = toggleDependency(once, 0, "billing", true);

    expect(once.contexts[0]?.dependsOn).toEqual(["billing"]);
    expect(twice.contexts[0]?.dependsOn).toEqual(["billing"]);
  });

  it("removes an edge without touching the others", () => {
    const draft = draftOf({
      contexts: [contextOf({ name: "orders", dependsOn: ["billing", "shipping"] })],
    });

    expect(toggleDependency(draft, 0, "billing", false).contexts[0]?.dependsOn).toEqual([
      "shipping",
    ]);
  });
});

describe("toRatificationPayload", () => {
  it("drops excluded rows rather than sending include: false", () => {
    const draft = draftOf({
      contexts: [
        contextOf({ name: "orders" }),
        contextOf({ name: "billing", include: false }),
      ],
    });

    expect(toRatificationPayload(draft).contexts.map((c) => c.name)).toEqual([
      "orders",
    ]);
  });

  it("sends the scope exactly as the preview showed it", () => {
    expect(toRatificationPayload(draftOf({ scope: "@Acme Corp!" })).scope).toBe(
      "acme-corp",
    );
  });

  it("trims the strings that become YAML values", () => {
    const draft = draftOf({
      system: "  Acme Platform  ",
      contexts: [
        contextOf({
          name: "  orders  ",
          description: "  handles orders  ",
          dependsOn: ["  billing  ", "   "],
        }),
        contextOf({ name: "billing" }),
      ],
    });

    const payload = toRatificationPayload(draft);

    expect(payload.system).toBe("Acme Platform");
    expect(payload.contexts[0]?.name).toBe("orders");
    expect(payload.contexts[0]?.description).toBe("handles orders");
    // The blank edge is dropped, not sent as an empty string.
    expect(payload.contexts[0]?.dependsOn).toEqual(["billing"]);
  });

  it("falls back to the bootstrap default when a type was blanked", () => {
    const draft = draftOf({ contexts: [contextOf({ type: "  " })] });

    expect(toRatificationPayload(draft).contexts[0]?.type).toBe(
      DEFAULT_CONTEXT_TYPE,
    );
  });

  it("keeps the architecture the user picked", () => {
    expect(
      toRatificationPayload(draftOf({ architecture: "microservices" }))
        .architecture,
    ).toBe("microservices");
  });
});
describe("context type is a closed set (#599 review)", () => {
  const withType = (type: string): BrownfieldManifestDraft =>
    draftOf({ contexts: [{ ...contextOf(), type, include: true }] });

  it("never forwards an unrecognised type into the payload", () => {
    // The payload goes to bootstrap and lands in manifest.yaml as
    // bounded_contexts[].type. A stale value from a persisted draft would
    // produce a manifest the linter later rejects, discovered far from the
    // screen that wrote it.
    const payload = toRatificationPayload(withType("retired-kind"));
    for (const c of payload.contexts) {
      expect(MANIFEST_CONTEXT_TYPES).toContain(c.type);
    }
  });

  it("tells the user rather than silently changing their choice", () => {
    const problems = validateManifestDraft(withType("retired-kind"));
    expect(
      problems.some((p) => p.id.startsWith("context-type-unknown")),
    ).toBe(true);
  });

  it("accepts every supported type unchanged", () => {
    for (const type of MANIFEST_CONTEXT_TYPES) {
      const payload = toRatificationPayload(withType(type));
      expect(payload.contexts[0].type).toBe(type);
      expect(
        validateManifestDraft(withType(type)).some((p) =>
          p.id.startsWith("context-type-unknown"),
        ),
      ).toBe(false);
    }
  });
});

