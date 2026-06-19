import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  ManifestDraftSchema,
  ManifestTopologyDraftSchema,
  ManifestDraftPortSchema,
  ManifestDraftAdapterSchema,
  ManifestDraftContextSchema,
  ManifestTopologyDraftContextSchema,
  MAX_BOUNDED_CONTEXTS_DRAFT,
  GENERIC_CONTEXT_NAMES,
} from "../../../src/domain/manifest/manifest-draft.schema";

const validPort = {
  name: "CreatePostPort",
  type: "use-case",
  description: "Creates a post",
};
const validAdapter = {
  name: "PostgresAdapter",
  type: "database",
  implements: "CreatePostPort",
};
const validContext = {
  name: "content-management",
  type: "core" as const,
  description: "Manages content",
  ports: { in: [validPort], out: [] },
  adapters: [validAdapter],
};
const validTopologyContext = {
  name: "content-management",
  type: "core" as const,
  description: "Manages content",
  ports: { in: [validPort], out: [] },
};
const validDraft = {
  workspace: { name: "my-project", description: "A project" },
  boundedContexts: [validContext],
};
const validTopologyDraft = {
  workspace: { name: "my-project", description: "A project" },
  boundedContexts: [validTopologyContext],
};

describe("ManifestDraftPortSchema", () => {
  it("accepts valid port", () => {
    const result = ManifestDraftPortSchema.safeParse(validPort);
    assert.strictEqual(result.success, true);
  });

  it("rejects missing name", () => {
    const result = ManifestDraftPortSchema.safeParse({
      type: "use-case",
      description: "desc",
    });
    assert.strictEqual(result.success, false);
  });

  it("rejects empty name", () => {
    const result = ManifestDraftPortSchema.safeParse({
      name: "",
      type: "use-case",
      description: "desc",
    });
    assert.strictEqual(result.success, false);
  });

  it("rejects extra fields", () => {
    const result = ManifestDraftPortSchema.safeParse({
      ...validPort,
      extra: "bad",
    });
    assert.strictEqual(result.success, false);
  });
});

describe("ManifestDraftAdapterSchema", () => {
  it("accepts valid adapter", () => {
    const result = ManifestDraftAdapterSchema.safeParse(validAdapter);
    assert.strictEqual(result.success, true);
  });

  it("rejects missing implements", () => {
    const result = ManifestDraftAdapterSchema.safeParse({
      name: "X",
      type: "db",
    });
    assert.strictEqual(result.success, false);
  });

  it("rejects extra fields", () => {
    const result = ManifestDraftAdapterSchema.safeParse({
      ...validAdapter,
      extra: "bad",
    });
    assert.strictEqual(result.success, false);
  });
});

describe("ManifestDraftContextSchema", () => {
  it("accepts valid context", () => {
    const result = ManifestDraftContextSchema.safeParse(validContext);
    assert.strictEqual(result.success, true);
  });

  it("rejects invalid type", () => {
    const result = ManifestDraftContextSchema.safeParse({
      ...validContext,
      type: "invalid",
    });
    assert.strictEqual(result.success, false);
  });

  it("accepts all valid types", () => {
    for (const t of [
      "core",
      "supporting",
      "driver",
      "shared-kernel",
    ] as const) {
      const result = ManifestDraftContextSchema.safeParse({
        ...validContext,
        type: t,
      });
      assert.strictEqual(result.success, true, `type "${t}" should be valid`);
    }
  });

  it("accepts optional dependsOn", () => {
    const result = ManifestDraftContextSchema.safeParse({
      ...validContext,
      dependsOn: ["shared"],
    });
    assert.strictEqual(result.success, true);
  });

  it("rejects extra fields", () => {
    const result = ManifestDraftContextSchema.safeParse({
      ...validContext,
      extra: "bad",
    });
    assert.strictEqual(result.success, false);
  });
});

describe("ManifestTopologyDraftContextSchema", () => {
  it("accepts valid topology context without adapters", () => {
    const result =
      ManifestTopologyDraftContextSchema.safeParse(validTopologyContext);
    assert.strictEqual(result.success, true);
  });

  it("rejects adapters field", () => {
    const result = ManifestTopologyDraftContextSchema.safeParse({
      ...validTopologyContext,
      adapters: [],
    });
    assert.strictEqual(result.success, false);
  });
});

describe("ManifestDraftSchema", () => {
  it("accepts valid draft", () => {
    const result = ManifestDraftSchema.safeParse(validDraft);
    assert.strictEqual(result.success, true);
  });

  it("rejects empty boundedContexts", () => {
    const result = ManifestDraftSchema.safeParse({
      ...validDraft,
      boundedContexts: [],
    });
    assert.strictEqual(result.success, false);
  });

  it("rejects more than MAX_BOUNDED_CONTEXTS_DRAFT contexts", () => {
    const contexts = Array.from(
      { length: MAX_BOUNDED_CONTEXTS_DRAFT + 1 },
      (_, i) => ({
        ...validContext,
        name: `ctx-${i}`,
      }),
    );
    const result = ManifestDraftSchema.safeParse({
      ...validDraft,
      boundedContexts: contexts,
    });
    assert.strictEqual(result.success, false);
  });

  it("accepts exactly MAX_BOUNDED_CONTEXTS_DRAFT contexts", () => {
    const contexts = Array.from(
      { length: MAX_BOUNDED_CONTEXTS_DRAFT },
      (_, i) => ({
        ...validContext,
        name: `ctx-${i}`,
      }),
    );
    const result = ManifestDraftSchema.safeParse({
      ...validDraft,
      boundedContexts: contexts,
    });
    assert.strictEqual(result.success, true);
  });
});

describe("ManifestTopologyDraftSchema", () => {
  it("accepts valid topology draft", () => {
    const result = ManifestTopologyDraftSchema.safeParse(validTopologyDraft);
    assert.strictEqual(result.success, true);
  });
});

describe("Named constants", () => {
  it("MAX_BOUNDED_CONTEXTS_DRAFT is 5", () => {
    assert.strictEqual(MAX_BOUNDED_CONTEXTS_DRAFT, 5);
  });

  it("GENERIC_CONTEXT_NAMES contains expected values", () => {
    assert.ok(GENERIC_CONTEXT_NAMES.includes("core"));
    assert.ok(GENERIC_CONTEXT_NAMES.includes("main"));
    assert.ok(GENERIC_CONTEXT_NAMES.includes("service"));
    assert.ok(GENERIC_CONTEXT_NAMES.includes("module"));
    assert.ok(GENERIC_CONTEXT_NAMES.includes("app"));
    assert.ok(GENERIC_CONTEXT_NAMES.includes("domain"));
    assert.ok(GENERIC_CONTEXT_NAMES.includes("default"));
  });
});
