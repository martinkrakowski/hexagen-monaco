import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  validateDraft,
  checkClarificationTriggers,
} from "../../../src/domain/manifest/validate-draft";
import type {
  ManifestDraft,
  ManifestTopologyDraft,
} from "../../../src/domain/manifest/manifest-draft.types";

const makePort = (name: string) => ({
  name,
  type: "use-case",
  description: `${name} desc`,
});
const makeAdapter = (name: string, implements_: string) => ({
  name,
  type: "database",
  implements: implements_,
});

const makeDraft = (overrides?: Partial<ManifestDraft>): ManifestDraft => ({
  workspace: { name: "test", description: "Test project" },
  boundedContexts: [
    {
      name: "content-management",
      type: "core",
      description: "Manages content",
      ports: {
        in: [makePort("CreatePostPort")],
        out: [makePort("PostRepositoryPort")],
      },
      adapters: [makeAdapter("PostgresAdapter", "PostRepositoryPort")],
    },
  ],
  ...overrides,
});

describe("validateDraft", () => {
  it("returns valid for a correct draft", () => {
    const result = validateDraft(makeDraft());
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.diagnostics.length, 0);
  });

  it("detects duplicate context names", () => {
    const draft = makeDraft({
      boundedContexts: [
        {
          name: "content",
          type: "core",
          description: "First",
          ports: { in: [], out: [] },
          adapters: [],
        },
        {
          name: "content",
          type: "supporting",
          description: "Second",
          ports: { in: [], out: [] },
          adapters: [],
        },
      ],
    });
    const result = validateDraft(draft);
    assert.strictEqual(result.valid, false);
    assert.ok(
      result.diagnostics.some((d) => d.code === "duplicate-context-name"),
    );
  });

  it("detects duplicate port names within a context", () => {
    const draft = makeDraft({
      boundedContexts: [
        {
          name: "content",
          type: "core",
          description: "desc",
          ports: { in: [makePort("SamePort")], out: [makePort("SamePort")] },
          adapters: [],
        },
      ],
    });
    const result = validateDraft(draft);
    assert.strictEqual(result.valid, false);
    assert.ok(result.diagnostics.some((d) => d.code === "duplicate-port-name"));
  });

  it("detects adapter referencing missing port", () => {
    const draft = makeDraft({
      boundedContexts: [
        {
          name: "content",
          type: "core",
          description: "desc",
          ports: { in: [makePort("CreatePostPort")], out: [] },
          adapters: [makeAdapter("BadAdapter", "NonExistentPort")],
        },
      ],
    });
    const result = validateDraft(draft);
    assert.strictEqual(result.valid, false);
    assert.ok(
      result.diagnostics.some(
        (d) => d.code === "adapter-references-missing-port",
      ),
    );
  });

  it("detects self-referential dependsOn", () => {
    const draft = makeDraft({
      boundedContexts: [
        {
          name: "content",
          type: "core",
          description: "desc",
          ports: { in: [makePort("CreatePostPort")], out: [] },
          adapters: [],
          dependsOn: ["content"],
        },
      ],
    });
    const result = validateDraft(draft);
    assert.strictEqual(result.valid, false);
    assert.ok(
      result.diagnostics.some((d) => d.code === "self-referential-depends-on"),
    );
  });

  it("detects dependsOn referencing unknown context", () => {
    const draft = makeDraft({
      boundedContexts: [
        {
          name: "content",
          type: "core",
          description: "desc",
          ports: { in: [makePort("CreatePostPort")], out: [] },
          adapters: [],
          dependsOn: ["nonexistent"],
        },
      ],
    });
    const result = validateDraft(draft);
    assert.strictEqual(result.valid, false);
    assert.ok(
      result.diagnostics.some((d) => d.code === "depends-on-unknown-context"),
    );
  });

  it("accepts valid dependsOn reference", () => {
    const draft = makeDraft({
      boundedContexts: [
        {
          name: "content",
          type: "core",
          description: "desc",
          ports: { in: [makePort("CreatePostPort")], out: [] },
          adapters: [],
          dependsOn: ["shared"],
        },
        {
          name: "shared",
          type: "shared-kernel",
          description: "Shared",
          ports: { in: [], out: [] },
          adapters: [],
        },
      ],
    });
    const result = validateDraft(draft);
    assert.strictEqual(result.valid, true);
  });
});

describe("checkClarificationTriggers", () => {
  const makeTopology = (
    overrides?: Partial<ManifestTopologyDraft>,
  ): ManifestTopologyDraft => ({
    workspace: { name: "test", description: "Test" },
    boundedContexts: [
      {
        name: "content-management",
        type: "core",
        description: "Manages content",
        ports: {
          in: [makePort("CreatePostPort")],
          out: [makePort("PostRepoPort")],
        },
      },
    ],
    ...overrides,
  });

  it("returns empty for valid topology", () => {
    const triggers = checkClarificationTriggers(makeTopology());
    assert.strictEqual(triggers.length, 0);
  });

  it("triggers no-inbound-ports when zero inbound ports", () => {
    const triggers = checkClarificationTriggers(
      makeTopology({
        boundedContexts: [
          {
            name: "content",
            type: "core",
            description: "desc",
            ports: { in: [], out: [makePort("SomePort")] },
          },
        ],
      }),
    );
    assert.ok(triggers.some((t) => t.type === "no-inbound-ports"));
  });

  it("triggers single-context-no-outbound for single context with no outbound", () => {
    const triggers = checkClarificationTriggers(
      makeTopology({
        boundedContexts: [
          {
            name: "content",
            type: "core",
            description: "desc",
            ports: { in: [makePort("SomePort")], out: [] },
          },
        ],
      }),
    );
    assert.ok(triggers.some((t) => t.type === "single-context-no-outbound"));
  });

  it("triggers generic-context-name for generic names", () => {
    for (const name of [
      "core",
      "main",
      "service",
      "module",
      "app",
      "domain",
      "default",
    ]) {
      const triggers = checkClarificationTriggers(
        makeTopology({
          boundedContexts: [
            {
              name,
              type: "core",
              description: "desc",
              ports: {
                in: [makePort("SomePort")],
                out: [makePort("OtherPort")],
              },
            },
          ],
        }),
      );
      assert.ok(
        triggers.some((t) => t.type === "generic-context-name"),
        `"${name}" should trigger generic-context-name`,
      );
    }
  });

  it("does not trigger single-context-no-outbound with multiple contexts", () => {
    const triggers = checkClarificationTriggers(
      makeTopology({
        boundedContexts: [
          {
            name: "content",
            type: "core",
            description: "desc",
            ports: { in: [makePort("P1")], out: [] },
          },
          {
            name: "shared",
            type: "shared-kernel",
            description: "Shared",
            ports: { in: [makePort("P2")], out: [] },
          },
        ],
      }),
    );
    assert.ok(!triggers.some((t) => t.type === "single-context-no-outbound"));
  });
});
