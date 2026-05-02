import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  renderManifestYaml,
  renderDraft,
  verifyToken,
} from "../../../src/domain/manifest/render-yaml.js";
import type { ManifestOutput } from "../../../src/domain/manifest/draft-to-manifest.transform.js";

const makeManifest = (): ManifestOutput => ({
  system: "test-project",
  scope: "test",
  architecture: "modular-monolith",
  bounded_contexts: [
    {
      name: "content-management",
      type: "core",
      description: "Manages content",
      layers: {
        domain: {},
        application: {
          ports: {
            in: ["CreatePostPort"],
            out: ["PostRepositoryPort"],
          },
        },
        infrastructure: {
          adapters: ["PostgresAdapter"],
        },
      },
      depends_on: ["shared"],
    },
  ],
  apps: [],
});

describe("renderManifestYaml", () => {
  it("produces valid YAML string", () => {
    const yaml = renderManifestYaml(makeManifest());
    assert.ok(typeof yaml === "string");
    assert.ok(yaml.includes("system:"));
    assert.ok(yaml.includes("bounded_contexts:"));
  });

  it("uses consistent indentation", () => {
    const yaml = renderManifestYaml(makeManifest());
    assert.ok(yaml.includes("- name: content-management"));
    assert.ok(yaml.includes("type: core"));
  });

  it("is deterministic — same input produces same output", () => {
    const a = renderManifestYaml(makeManifest());
    const b = renderManifestYaml(makeManifest());
    assert.strictEqual(a, b);
  });

  it("renders snake_case keys correctly", () => {
    const yaml = renderManifestYaml(makeManifest());
    assert.ok(yaml.includes("bounded_contexts:"));
    assert.ok(yaml.includes("depends_on:"));
  });
});

describe("renderDraft", () => {
  it("returns yaml, diagnostics, and token", async () => {
    const result = await renderDraft(makeManifest(), []);
    assert.ok(typeof result.yaml === "string");
    assert.ok(result.yaml.length > 0);
    assert.deepStrictEqual(result.diagnostics, []);
    assert.ok(typeof result.token === "string");
    assert.strictEqual(result.token.length, 64);
  });

  it("passes diagnostics through", async () => {
    const diagnostics = [{ code: "test", message: "test error" }];
    const result = await renderDraft(makeManifest(), diagnostics);
    assert.deepStrictEqual(result.diagnostics, diagnostics);
  });
});

describe("verifyToken", () => {
  it("returns true for matching token", async () => {
    const rendered = await renderDraft(makeManifest(), []);
    const valid = await verifyToken(rendered.yaml, rendered.token);
    assert.strictEqual(valid, true);
  });

  it("returns false for wrong token", async () => {
    const rendered = await renderDraft(makeManifest(), []);
    const valid = await verifyToken(rendered.yaml, "0".repeat(64));
    assert.strictEqual(valid, false);
  });

  it("returns false for modified YAML", async () => {
    const rendered = await renderDraft(makeManifest(), []);
    const valid = await verifyToken(rendered.yaml + "x", rendered.token);
    assert.strictEqual(valid, false);
  });
});
