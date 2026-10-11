import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  TEMPLATE_CONFIG_FILE,
  configState,
  emptyConfig,
  isInstalled,
  mergeGeneratedFiles,
} from "../../src/domain/template-config.js";
import type {
  GeneratedFileRecord,
  TemplateConfig,
  TemplateInstallRecord,
} from "../../src/domain/template-config.js";

/**
 * Pins for the template config record vocabulary: the empty shape, membership,
 * and the empty/populated classification the store adapters build on. Whether
 * a record exists at all (`absent`) is decided by the source, not here.
 */

const RECORD: TemplateInstallRecord = {
  installedAt: "2026-01-01T00:00:00.000Z",
  version: "1.2.3",
  answers: {},
  generatedFiles: [],
};

const POPULATED: TemplateConfig = {
  schemaVersion: "1",
  templates: { "ci-github-actions": RECORD },
};

describe("emptyConfig", () => {
  it(`returns schemaVersion "1" with no templates, saved as ${TEMPLATE_CONFIG_FILE}`, () => {
    assert.deepStrictEqual(emptyConfig(), {
      schemaVersion: "1",
      templates: {},
    });
  });
});

describe("isInstalled", () => {
  it("is true for a template id the record lists", () => {
    assert.equal(isInstalled(POPULATED, "ci-github-actions"), true);
  });

  it("is false for a template id the record does not list", () => {
    assert.equal(isInstalled(POPULATED, "agents-md"), false);
  });

  it("is false for any id when the config is empty", () => {
    assert.equal(isInstalled(emptyConfig(), "ci-github-actions"), false);
    assert.equal(isInstalled(emptyConfig(), "constructor"), false);
    assert.equal(isInstalled(emptyConfig(), "toString"), false);
  });
});

describe("configState", () => {
  it("classifies a config with no templates as empty", () => {
    assert.deepStrictEqual(configState(emptyConfig()), { state: "empty" });
  });

  it("classifies a config with entries as populated, carrying the config", () => {
    assert.deepStrictEqual(configState(POPULATED), {
      state: "populated",
      config: POPULATED,
    });
  });
});

describe("mergeGeneratedFiles", () => {
  const h = (s: string) => s;

  it("returns current unchanged when there is no earlier record", () => {
    const current = [
      { path: "a.txt", contentHash: h("A") },
      { path: "b.txt", contentHash: h("B") },
    ];
    assert.deepStrictEqual(mergeGeneratedFiles(undefined, current), current);
  });

  it("keeps an earlier-only path with its earlier hash", () => {
    const earlier = [
      { path: "old.txt", contentHash: h("OLD") },
      { path: "both.txt", contentHash: h("E") },
    ];
    const current = [{ path: "both.txt", contentHash: h("C") }];
    assert.deepStrictEqual(mergeGeneratedFiles(earlier, current), [
      { path: "old.txt", contentHash: h("OLD") },
      { path: "both.txt", contentHash: h("C") },
    ]);
  });

  it("keeps the earlier position for a path present in both", () => {
    const earlier = [
      { path: "first.txt", contentHash: h("E") },
      { path: "second.txt", contentHash: h("E2") },
    ];
    const current = [
      { path: "second.txt", contentHash: h("C2") },
      { path: "first.txt", contentHash: h("C1") },
    ];
    assert.deepStrictEqual(mergeGeneratedFiles(earlier, current), [
      { path: "first.txt", contentHash: h("C1") },
      { path: "second.txt", contentHash: h("C2") },
    ]);
  });

  it("appends new paths in the order this run wrote them", () => {
    const earlier = [{ path: "a.txt", contentHash: h("A") }];
    const current = [
      { path: "c.txt", contentHash: h("C") },
      { path: "b.txt", contentHash: h("B") },
    ];
    assert.deepStrictEqual(mergeGeneratedFiles(earlier, current), [
      { path: "a.txt", contentHash: h("A") },
      { path: "c.txt", contentHash: h("C") },
      { path: "b.txt", contentHash: h("B") },
    ]);
  });

  it("lets the last current entry win for a duplicated path", () => {
    const earlier = [{ path: "a.txt", contentHash: h("A") }];
    const current = [
      { path: "n.txt", contentHash: h("N1") },
      { path: "n.txt", contentHash: h("N2") },
    ];
    assert.deepStrictEqual(mergeGeneratedFiles(earlier, current), [
      { path: "a.txt", contentHash: h("A") },
      { path: "n.txt", contentHash: h("N2") },
    ]);
  });

  it("keeps the first position and the last earlier hash for a path duplicated in earlier", () => {
    const earlier = [
      { path: "d.txt", contentHash: h("D1") },
      { path: "x.txt", contentHash: h("X") },
      { path: "d.txt", contentHash: h("D2") },
    ];
    const current: GeneratedFileRecord[] = [];
    assert.deepStrictEqual(mergeGeneratedFiles(earlier, current), [
      { path: "d.txt", contentHash: h("D2") },
      { path: "x.txt", contentHash: h("X") },
    ]);
  });

  it("takes the current hash over the earlier hash for a path duplicated in earlier", () => {
    const earlier = [
      { path: "d.txt", contentHash: h("D1") },
      { path: "d.txt", contentHash: h("D2") },
    ];
    const current = [{ path: "d.txt", contentHash: h("C") }];
    assert.deepStrictEqual(mergeGeneratedFiles(earlier, current), [
      { path: "d.txt", contentHash: h("C") },
    ]);
  });

  it("treats a non-array earlier record as empty", () => {
    const current = [{ path: "a.txt", contentHash: h("A") }];
    assert.deepStrictEqual(mergeGeneratedFiles("x", current), current);
    assert.deepStrictEqual(mergeGeneratedFiles(null, current), current);
    assert.deepStrictEqual(mergeGeneratedFiles({}, current), current);
  });

  it("skips malformed earlier entries", () => {
    const earlier = [
      null,
      { path: 1, contentHash: "h" },
      { path: "", contentHash: "h" },
      { path: "a" },
      { path: "ok.txt", contentHash: h("OK") },
    ];
    const current: GeneratedFileRecord[] = [];
    assert.deepStrictEqual(mergeGeneratedFiles(earlier, current), [
      { path: "ok.txt", contentHash: h("OK") },
    ]);
  });

  it("does not mutate its inputs and returns plain records without extra keys", () => {
    const earlier = [
      { path: "a.txt", contentHash: h("A"), note: "hand-edited" },
    ] as unknown[];
    const current = [{ path: "b.txt", contentHash: h("B") }];
    const earlierCopy = JSON.parse(JSON.stringify(earlier));
    const currentCopy = JSON.parse(JSON.stringify(current));

    const merged = mergeGeneratedFiles(earlier, current);

    assert.deepStrictEqual(merged, [
      { path: "a.txt", contentHash: h("A") },
      { path: "b.txt", contentHash: h("B") },
    ]);
    assert.deepStrictEqual(Object.keys(merged[0]).sort(), [
      "contentHash",
      "path",
    ]);
    assert.deepStrictEqual(earlier, earlierCopy);
    assert.deepStrictEqual(current, currentCopy);
  });
});
