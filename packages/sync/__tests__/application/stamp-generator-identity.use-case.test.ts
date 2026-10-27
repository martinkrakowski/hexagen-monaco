import { describe, it } from "vitest";
import assert from "node:assert";
import { readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import yaml from "js-yaml";
import { StampGeneratorIdentityUseCase } from "../../src/application/use-cases/stamp-generator-identity.use-case.js";

const useCase = new StampGeneratorIdentityUseCase(isDeepStrictEqual);

describe("StampGeneratorIdentityUseCase", () => {
  it("appends the generator block when absent, preserving comments byte-for-byte", () => {
    const input =
      ["# header", "system: app # inline note", "bounded_contexts: []"].join(
        "\n",
      ) + "\n";
    const result = useCase.execute(input);
    assert.strictEqual(result.changed, true);
    assert.strictEqual(
      result.content,
      input + 'generator:\n  name: "@hexagen-monaco/sync"\n',
    );
    assert.deepStrictEqual(
      (yaml.load(result.content) as { generator: unknown }).generator,
      { name: "@hexagen-monaco/sync" },
    );
  });

  it("handles input without a trailing newline", () => {
    const input = "system: app\nbounded_contexts: []";
    const result = useCase.execute(input);
    assert.strictEqual(result.changed, true);
    assert.strictEqual(
      result.content,
      [
        "system: app",
        "bounded_contexts: []",
        "generator:",
        '  name: "@hexagen-monaco/sync"',
        "",
      ].join("\n"),
    );
    const parsed = yaml.load(result.content) as {
      system: string;
      generator: unknown;
    };
    assert.strictEqual(parsed.system, "app");
    assert.deepStrictEqual(parsed.generator, {
      name: "@hexagen-monaco/sync",
    });
  });

  it("inserts the name at two-space indentation under a block generator, keeping version/sync", () => {
    const input = [
      "system: x",
      "generator:",
      "  version: 0.2.0",
      "  sync:",
      "    idempotent: true",
      "",
    ].join("\n");
    const result = useCase.execute(input);
    assert.strictEqual(result.changed, true);
    assert.strictEqual(
      result.content,
      [
        "system: x",
        "generator:",
        '  name: "@hexagen-monaco/sync"',
        "  version: 0.2.0",
        "  sync:",
        "    idempotent: true",
        "",
      ].join("\n"),
    );
    const parsed = yaml.load(result.content) as {
      generator: Record<string, unknown>;
    };
    assert.deepStrictEqual(parsed.generator, {
      name: "@hexagen-monaco/sync",
      version: "0.2.0",
      sync: { idempotent: true },
    });
  });

  it("matches four-space child indentation", () => {
    const input = ["generator:", "    version: 0.2.0", ""].join("\n");
    const result = useCase.execute(input);
    assert.strictEqual(
      result.content,
      [
        "generator:",
        '    name: "@hexagen-monaco/sync"',
        "    version: 0.2.0",
        "",
      ].join("\n"),
    );
  });

  it("keeps a comment directly under generator: and uses the first real child's indentation", () => {
    const input = ["generator:", "  # tool notes", "  version: 1.0.0", ""].join(
      "\n",
    );
    const result = useCase.execute(input);
    assert.strictEqual(
      result.content,
      [
        "generator:",
        '  name: "@hexagen-monaco/sync"',
        "  # tool notes",
        "  version: 1.0.0",
        "",
      ].join("\n"),
    );
  });

  it("returns changed=false and byte-identical content when already stamped", () => {
    const input = [
      "system: x",
      "generator:",
      '  name: "@hexagen-monaco/sync"',
      "",
    ].join("\n");
    const result = useCase.execute(input);
    assert.strictEqual(result.changed, false);
    assert.strictEqual(result.content, input);
  });

  it("is idempotent: stamping the stamped output changes nothing", () => {
    const once = useCase.execute("system: x\n");
    const twice = useCase.execute(once.content);
    assert.strictEqual(twice.changed, false);
    assert.strictEqual(twice.content, once.content);
  });

  it("refuses to overwrite another generator's identity", () => {
    const input = ["generator:", '  name: "acme-tool"', ""].join("\n");
    assert.throws(
      () => useCase.execute(input),
      (err: Error) => {
        assert.match(err.message, /acme-tool/);
        assert.match(err.message, /refusing to overwrite/i);
        return true;
      },
    );
  });

  it("refuses a flow-style generator block", () => {
    const input = 'system: x\ngenerator: { version: "1" }\n';
    assert.throws(() => useCase.execute(input), /unsupported YAML layout/);
  });

  it("refuses a null generator value", () => {
    const input = "system: x\ngenerator: null\n";
    assert.throws(() => useCase.execute(input), /must be a mapping/);
  });

  it("refuses a non-mapping root", () => {
    assert.throws(
      () => useCase.execute("- a\n- b\n"),
      /must be a YAML mapping/,
    );
  });
});

describe("stamp-generator-identity.use-case.ts — application stays builtin-free", () => {
  it("imports no node: builtin", async () => {
    const url = new URL(
      "../../src/application/use-cases/stamp-generator-identity.use-case.ts",
      import.meta.url,
    );
    const source = await readFile(url, "utf-8");
    const builtinImports = [
      ...source.matchAll(/from\s+["'](node:[^"']+)["']/g),
    ].map((m) => m[1]);
    assert.deepStrictEqual(builtinImports, []);
  });
});
