/**
 * `.architecture/layout.yaml` schema — unknown-key rejection and misspellings
 * must fail closed. Absent / empty config is legitimate and keeps today's
 * convention-mode behaviour.
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { loadLayoutConfig, parseLayoutConfig } from "../src/layout-config.js";

function readerOf(contents: string) {
  return async (): Promise<string> => contents;
}

function failingReader(code: string) {
  return async (): Promise<string> => {
    throw Object.assign(new Error(`${code}: read failed`), { code });
  };
}

const PATH = "/repo/.architecture/layout.yaml";

const VALID = `contexts:
  billing:
    root: packages/billing
    layers:
      domain: [src/core]
      application: [src/services]
      infrastructure: [src/db, src/http]
  identity:
    root: packages/auth
ignore: [legacy/, scripts/]
`;

describe("parseLayoutConfig — well-formed", () => {
  it("accepts the runbook example", () => {
    const parsed = parseLayoutConfig({
      contexts: {
        billing: {
          root: "packages/billing",
          layers: {
            domain: ["src/core"],
            application: ["src/services"],
            infrastructure: ["src/db", "src/http"],
          },
        },
        identity: { root: "packages/auth" },
      },
      ignore: ["legacy/", "scripts/"],
    });
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.value.contexts?.billing.root, "packages/billing");
      assert.deepEqual(parsed.value.contexts?.billing.layers?.domain, [
        "src/core",
      ]);
      assert.equal(parsed.value.contexts?.identity.layers, undefined);
    }
  });

  it("accepts an empty mapping (today's convention-mode behaviour)", () => {
    const parsed = parseLayoutConfig({});
    assert.equal(parsed.ok, true);
  });
});

describe("parseLayoutConfig — misspellings fail loudly", () => {
  it("rejects an unknown top-level key", () => {
    const parsed = parseLayoutConfig({ contexs: { billing: { root: "x" } } });
    assert.equal(parsed.ok, false);
    if (!parsed.ok) {
      assert.match(parsed.reason, /unrecognized key|contexs/i);
    }
  });

  it("rejects a misspelled context field (rooot instead of root)", () => {
    const parsed = parseLayoutConfig({
      contexts: { billing: { rooot: "packages/billing" } },
    });
    assert.equal(parsed.ok, false);
    if (!parsed.ok) {
      assert.match(parsed.reason, /unrecognized key|rooot|root/i);
    }
  });

  it("rejects a misspelled hexagonal layer name", () => {
    const parsed = parseLayoutConfig({
      contexts: {
        billing: {
          root: "packages/billing",
          layers: { domaine: ["src/core"] },
        },
      },
    });
    assert.equal(parsed.ok, false);
    if (!parsed.ok) {
      assert.match(parsed.reason, /domaine|domain|invalid/i);
    }
  });
});

describe("loadLayoutConfig", () => {
  it("classifies ENOENT as missing", async () => {
    const r = await loadLayoutConfig(PATH, failingReader("ENOENT"));
    assert.deepEqual(r, { kind: "missing" });
  });

  it("classifies a schema-invalid document as invalid, not loaded", async () => {
    const r = await loadLayoutConfig(
      PATH,
      readerOf("contexts:\n  billing:\n    rooot: packages/billing\n"),
    );
    assert.equal(r.kind, "invalid");
    if (r.kind === "invalid") {
      assert.ok(r.reason.length > 0);
    }
  });

  it("loads the runbook example", async () => {
    const r = await loadLayoutConfig(PATH, readerOf(VALID));
    assert.equal(r.kind, "loaded");
    if (r.kind === "loaded") {
      assert.equal(r.value.contexts?.billing.root, "packages/billing");
      assert.deepEqual(r.value.ignore, ["legacy/", "scripts/"]);
    }
  });

  it("treats an empty file as an empty (non-fatal) config", async () => {
    const r = await loadLayoutConfig(PATH, readerOf(""));
    assert.deepEqual(r, { kind: "loaded", value: {} });
  });
});
