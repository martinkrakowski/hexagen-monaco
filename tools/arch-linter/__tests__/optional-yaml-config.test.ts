/**
 * Optional-config classification — the "absent vs broken" guard.
 *
 * Before this guard, both `catch` blocks around `layer-rules.yaml` and
 * `linter-config.yaml` mapped EVERY failure to "using defaults". A malformed
 * config therefore disabled the rules it declared and the linter still printed
 * "Architecture is compliant" and exited 0 — a green gate that checked nothing.
 *
 * These tests pin the three outcomes as distinct, because the bug is precisely
 * two of them being collapsed into one:
 *   - absent  → defaults are correct
 *   - broken  → must NOT default (the caller fails closed)
 *   - empty   → parses cleanly, IS a legitimate empty config, must not be fatal
 *
 * The reader is injected, so none of this touches the filesystem.
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  loadOptionalYamlConfig,
  type OptionalYamlConfig,
} from "../src/optional-yaml-config.js";

/** A reader that rejects the way `fs.promises.readFile` does, with a `code`. */
function failingReader(code: string, message = `${code}: read failed`) {
  return async (): Promise<string> => {
    throw Object.assign(new Error(message), { code });
  };
}

function readerOf(contents: string) {
  return async (): Promise<string> => contents;
}

const PATH = "/repo/.architecture/invariants/layer-rules.yaml";

describe("loadOptionalYamlConfig — absent", () => {
  it("classifies ENOENT as missing (the only signal that justifies defaults)", async () => {
    const r = await loadOptionalYamlConfig(PATH, failingReader("ENOENT"));
    assert.deepEqual(r, { kind: "missing" });
  });
});

describe("loadOptionalYamlConfig — broken", () => {
  it("classifies a YAML parse error as invalid, NOT missing", async () => {
    const r = await loadOptionalYamlConfig(
      PATH,
      readerOf(
        "layers:\n  domain:\n    access_rule: strict\n  bad: [unclosed\n",
      ),
    );
    assert.equal(r.kind, "invalid");
    // The parser's own message is carried through so the operator can fix it.
    assert.ok(
      (r as { kind: "invalid"; reason: string }).reason.length > 0,
      "a parse failure must explain itself",
    );
  });

  it("classifies a non-ENOENT read failure as invalid (the file is there, we just could not read it)", async () => {
    for (const code of ["EACCES", "EISDIR", "ELOOP"]) {
      const r = await loadOptionalYamlConfig(PATH, failingReader(code));
      assert.equal(r.kind, "invalid", `${code} must not be treated as absent`);
    }
  });

  it("classifies a reader failure with no error code as invalid", async () => {
    const r = await loadOptionalYamlConfig(PATH, async () => {
      throw new Error("something else went wrong");
    });
    assert.deepEqual(r, {
      kind: "invalid",
      reason: "something else went wrong",
    });
  });

  it("rejects a document that parses to a sequence — it cannot carry the linter's keys", async () => {
    const r = await loadOptionalYamlConfig(PATH, readerOf("- a\n- b\n"));
    assert.deepEqual(r, {
      kind: "invalid",
      reason: "expected a YAML mapping, got a sequence",
    });
  });

  it("rejects a document that parses to a scalar", async () => {
    const r = await loadOptionalYamlConfig(PATH, readerOf("just a string\n"));
    assert.deepEqual(r, {
      kind: "invalid",
      reason: "expected a YAML mapping, got string",
    });
  });
});

describe("loadOptionalYamlConfig — empty but valid stays non-fatal", () => {
  it("treats an empty file as an empty config, not an error", async () => {
    const r = await loadOptionalYamlConfig(PATH, readerOf(""));
    assert.deepEqual(r, { kind: "loaded", value: {} });
  });

  it("treats a comments-only file as an empty config", async () => {
    const r = await loadOptionalYamlConfig(PATH, readerOf("# nothing here\n"));
    assert.deepEqual(r, { kind: "loaded", value: {} });
  });

  it("treats an explicit null document as an empty config", async () => {
    for (const doc of ["null\n", "~\n"]) {
      const r = await loadOptionalYamlConfig(PATH, readerOf(doc));
      assert.deepEqual(r, { kind: "loaded", value: {} }, `document: ${doc}`);
    }
  });
});

describe("loadOptionalYamlConfig — well-formed", () => {
  it("returns the parsed mapping", async () => {
    interface Rules {
      layers?: Record<string, { access_rule: string }>;
    }
    const r: OptionalYamlConfig<Rules> = await loadOptionalYamlConfig<Rules>(
      PATH,
      readerOf("layers:\n  domain:\n    access_rule: strict\n"),
    );
    assert.deepEqual(r, {
      kind: "loaded",
      value: { layers: { domain: { access_rule: "strict" } } },
    });
  });
});
