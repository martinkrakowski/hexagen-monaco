import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  normalizeDraft,
  normalizeTopologyDraft,
  toPascalCase,
  toKebabCase,
  ensurePortSuffix,
  normalizePortName,
} from "../../../src/domain/manifest/normalize-draft";
import type {
  ManifestDraft,
  ManifestTopologyDraft,
} from "../../../src/domain/manifest/manifest-draft.types";

describe("toPascalCase", () => {
  it("converts kebab-case", () => {
    assert.strictEqual(toPascalCase("post-repository"), "PostRepository");
  });

  it("converts snake_case", () => {
    assert.strictEqual(toPascalCase("post_repository"), "PostRepository");
  });

  it("converts space-separated", () => {
    assert.strictEqual(
      toPascalCase("post repository port"),
      "PostRepositoryPort",
    );
  });

  it("preserves already PascalCase", () => {
    assert.strictEqual(toPascalCase("PostRepository"), "PostRepository");
  });
});

describe("toKebabCase", () => {
  it("converts PascalCase", () => {
    assert.strictEqual(toKebabCase("ContentManagement"), "content-management");
  });

  it("preserves kebab-case", () => {
    assert.strictEqual(toKebabCase("content-management"), "content-management");
  });

  it("converts snake_case", () => {
    assert.strictEqual(toKebabCase("content_management"), "content-management");
  });

  it("handles spaces", () => {
    assert.strictEqual(toKebabCase("Content Management"), "content-management");
  });

  it("trims whitespace", () => {
    assert.strictEqual(
      toKebabCase("  content-management  "),
      "content-management",
    );
  });
});

describe("ensurePortSuffix", () => {
  it("adds Port suffix if missing", () => {
    assert.strictEqual(
      ensurePortSuffix("postRepository"),
      "postRepositoryPort",
    );
  });

  it("preserves Port suffix if present", () => {
    assert.strictEqual(
      ensurePortSuffix("PostRepositoryPort"),
      "PostRepositoryPort",
    );
  });
});

describe("normalizePortName", () => {
  it("converts camelCase to PascalCase with Port suffix", () => {
    assert.strictEqual(
      normalizePortName("postRepository"),
      "PostRepositoryPort",
    );
  });

  it("converts space-separated to PascalCase with Port suffix", () => {
    assert.strictEqual(
      normalizePortName("Post Repository Port"),
      "PostRepositoryPort",
    );
  });

  it("preserves already-correct name", () => {
    assert.strictEqual(
      normalizePortName("PostRepositoryPort"),
      "PostRepositoryPort",
    );
  });

  it("trims whitespace", () => {
    assert.strictEqual(
      normalizePortName("  PostRepositoryPort  "),
      "PostRepositoryPort",
    );
  });
});

describe("normalizeDraft", () => {
  const draft: ManifestDraft = {
    workspace: { name: "  My Project  ", description: "  A project  " },
    boundedContexts: [
      {
        name: "ContentManagement",
        type: "core",
        description: " Manages content ",
        ports: {
          in: [
            {
              name: "post Repository",
              type: " use-case ",
              description: "Creates posts",
            },
          ],
          out: [
            {
              name: "postRepository",
              type: "repository",
              description: "Post persistence",
            },
          ],
        },
        adapters: [
          {
            name: " PostgresAdapter ",
            type: " database ",
            implements: "postRepository",
          },
        ],
        dependsOn: ["SharedKernel"],
      },
    ],
  };

  it("normalizes workspace name and description", () => {
    const result = normalizeDraft(draft);
    assert.strictEqual(result.workspace.name, "My Project");
    assert.strictEqual(result.workspace.description, "A project");
  });

  it("converts context name to kebab-case", () => {
    const result = normalizeDraft(draft);
    assert.strictEqual(result.boundedContexts[0].name, "content-management");
  });

  it("normalizes port names with PascalCase and Port suffix", () => {
    const result = normalizeDraft(draft);
    assert.strictEqual(
      result.boundedContexts[0].ports.in[0].name,
      "PostRepositoryPort",
    );
    assert.strictEqual(
      result.boundedContexts[0].ports.out[0].name,
      "PostRepositoryPort",
    );
  });

  it("normalizes adapter implements to port name", () => {
    const result = normalizeDraft(draft);
    assert.strictEqual(
      result.boundedContexts[0].adapters[0].implements,
      "PostRepositoryPort",
    );
  });

  it("converts dependsOn to kebab-case", () => {
    const result = normalizeDraft(draft);
    assert.deepStrictEqual(result.boundedContexts[0].dependsOn, [
      "shared-kernel",
    ]);
  });

  it("trims whitespace on descriptions and types", () => {
    const result = normalizeDraft(draft);
    assert.strictEqual(
      result.boundedContexts[0].description,
      "Manages content",
    );
    assert.strictEqual(result.boundedContexts[0].ports.in[0].type, "use-case");
    assert.strictEqual(
      result.boundedContexts[0].adapters[0].name,
      "PostgresAdapter",
    );
  });
});

describe("normalizeTopologyDraft", () => {
  const topology: ManifestTopologyDraft = {
    workspace: { name: "TestProject", description: "Test" },
    boundedContexts: [
      {
        name: "ContentManagement",
        type: "core",
        description: "Manages content",
        ports: {
          in: [
            {
              name: "createPost",
              type: "use-case",
              description: "Creates posts",
            },
          ],
          out: [],
        },
      },
    ],
  };

  it("normalizes topology without adapters", () => {
    const result = normalizeTopologyDraft(topology);
    assert.strictEqual(result.boundedContexts[0].name, "content-management");
    assert.strictEqual(
      result.boundedContexts[0].ports.in[0].name,
      "CreatePostPort",
    );
  });
});
