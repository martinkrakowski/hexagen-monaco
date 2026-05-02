import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { draftToManifest } from "../../../src/domain/manifest/draft-to-manifest.transform.js";
import type { ManifestDraft } from "../../../src/domain/manifest/manifest-draft.types.js";

const makeDraft = (overrides?: Partial<ManifestDraft>): ManifestDraft => ({
  workspace: { name: "My Project", description: "A test project" },
  boundedContexts: [
    {
      name: "content-management",
      type: "core",
      description: "Manages content",
      ports: {
        in: [
          {
            name: "CreatePostPort",
            type: "use-case",
            description: "Creates a post",
          },
        ],
        out: [
          {
            name: "PostRepositoryPort",
            type: "repository",
            description: "Post persistence",
          },
        ],
      },
      adapters: [
        {
          name: "PostgresAdapter",
          type: "database",
          implements: "PostRepositoryPort",
        },
      ],
      dependsOn: ["shared"],
    },
    {
      name: "shared",
      type: "shared-kernel",
      description: "Shared kernel",
      ports: { in: [], out: [] },
      adapters: [],
    },
  ],
  ...overrides,
});

describe("draftToManifest", () => {
  it("produces snake_case bounded_contexts", () => {
    const result = draftToManifest(makeDraft());
    assert.ok("bounded_contexts" in result);
    assert.ok(!("boundedContexts" in result));
  });

  it("sets system to kebab-case workspace name", () => {
    const result = draftToManifest(makeDraft());
    assert.strictEqual(result.system, "my-project");
  });

  it("extracts scope from first segment", () => {
    const result = draftToManifest(makeDraft());
    assert.strictEqual(result.scope, "my");
  });

  it("uses full name as scope for single-word workspace", () => {
    const result = draftToManifest(
      makeDraft({ workspace: { name: "Acme", description: "desc" } }),
    );
    assert.strictEqual(result.scope, "acme");
  });

  it("sets architecture to modular-monolith", () => {
    const result = draftToManifest(makeDraft());
    assert.strictEqual(result.architecture, "modular-monolith");
  });

  it("maps context type correctly", () => {
    const result = draftToManifest(makeDraft());
    assert.strictEqual(result.bounded_contexts[0].type, "core");
    assert.strictEqual(result.bounded_contexts[1].type, "shared-kernel");
  });

  it("maps ports to application layer", () => {
    const result = draftToManifest(makeDraft());
    const ctx = result.bounded_contexts[0];
    assert.deepStrictEqual(ctx.layers.application?.ports?.in, [
      "CreatePostPort",
    ]);
    assert.deepStrictEqual(ctx.layers.application?.ports?.out, [
      "PostRepositoryPort",
    ]);
  });

  it("maps adapters to infrastructure layer", () => {
    const result = draftToManifest(makeDraft());
    const ctx = result.bounded_contexts[0];
    assert.deepStrictEqual(ctx.layers.infrastructure?.adapters, [
      "PostgresAdapter",
    ]);
  });

  it("maps dependsOn to depends_on", () => {
    const result = draftToManifest(makeDraft());
    assert.deepStrictEqual(result.bounded_contexts[0].depends_on, ["shared"]);
  });

  it("omits depends_on when not present", () => {
    const result = draftToManifest(makeDraft());
    assert.strictEqual(result.bounded_contexts[1].depends_on, undefined);
  });

  it("handles context with no ports gracefully", () => {
    const result = draftToManifest(
      makeDraft({
        boundedContexts: [
          {
            name: "empty",
            type: "shared-kernel",
            description: "No ports",
            ports: { in: [], out: [] },
            adapters: [],
          },
        ],
      }),
    );
    const ctx = result.bounded_contexts[0];
    assert.strictEqual(ctx.layers.application?.ports?.in, undefined);
    assert.strictEqual(ctx.layers.application?.ports?.out, undefined);
    assert.strictEqual(ctx.layers.infrastructure?.adapters, undefined);
  });

  it("initializes apps as empty array", () => {
    const result = draftToManifest(makeDraft());
    assert.deepStrictEqual(result.apps, []);
  });
});
