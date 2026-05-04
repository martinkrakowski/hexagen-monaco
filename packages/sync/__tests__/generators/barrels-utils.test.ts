import { describe, it } from "node:test";
import assert from "node:assert";
import {
  isGeneratedFile,
  contentHash,
  detectCircularExports,
  generateBarrelContent,
  parseBarrelExports,
  isSourceFile,
  GENERATED_MARKER,
  LEGACY_GENERATED_MARKER,
  type ExportEntry,
} from "../../src/generators/barrels/utils.js";

describe("barrels utils", () => {
  it("should detect current GENERATED_MARKER", async () => {
    const content = `${GENERATED_MARKER}\n\nexport * from "./a.js";\n`;
    assert.strictEqual(
      isGeneratedFile(content),
      true,
      "isGeneratedFile should return true for the current marker",
    );
  });

  it("should detect LEGACY_GENERATED_MARKER", async () => {
    const content = `// ${LEGACY_GENERATED_MARKER}\n\nexport * from './a.js';\n`;
    assert.strictEqual(
      isGeneratedFile(content),
      true,
      "isGeneratedFile should return true for the legacy marker",
    );
  });

  it("should return false when no marker is present", async () => {
    const content = `export const foo = 1;\nexport const bar = 2;\n`;
    assert.strictEqual(
      isGeneratedFile(content),
      false,
      "isGeneratedFile should return false when no marker is present",
    );
  });

  it("should detect marker at any line position", async () => {
    const content = `export const foo = 1;\n// other comment\n${GENERATED_MARKER}\nexport const bar = 2;\n`;
    assert.strictEqual(
      isGeneratedFile(content),
      true,
      "isGeneratedFile should match marker even when not on the first line",
    );
  });

  it("should be deterministic for identical input", async () => {
    const input = 'export * from "./alpha.js";\n';
    const h1 = contentHash(input);
    const h2 = contentHash(input);
    assert.strictEqual(
      h1,
      h2,
      "contentHash must be deterministic for identical input",
    );
  });

  it("should produce distinct hashes for distinct input", async () => {
    const h1 = contentHash("alpha");
    const h2 = contentHash("beta");
    assert.notStrictEqual(
      h1,
      h2,
      "contentHash must produce distinct hashes for distinct input",
    );
  });

  it("should return 64-char lowercase hex string", async () => {
    const h = contentHash("anything");
    assert.strictEqual(
      h.length,
      64,
      "contentHash must return 64-char hex string (SHA-256)",
    );
    assert.match(
      h,
      /^[0-9a-f]{64}$/,
      "contentHash must return lowercase hex characters only",
    );
  });

  it("should report no cycle for empty graph", async () => {
    const result = detectCircularExports(new Map());
    assert.deepStrictEqual(
      result,
      { hasCircular: false, cycle: null },
      "empty graph must report no circular dependency",
    );
  });

  it("should report no cycle for DAG", async () => {
    const graph = new Map<string, string[]>([
      ["A", ["B", "C"]],
      ["B", ["C"]],
      ["C", []],
    ]);
    const result = detectCircularExports(graph);
    assert.deepStrictEqual(
      result,
      { hasCircular: false, cycle: null },
      "DAG must report no circular dependency",
    );
  });

  it("should detect 2-node cycle", async () => {
    const graph = new Map<string, string[]>([
      ["A", ["B"]],
      ["B", ["A"]],
    ]);
    const result = detectCircularExports(graph);
    assert.strictEqual(
      result.hasCircular,
      true,
      "2-node cycle must be detected",
    );
    assert.ok(result.cycle, "cycle array must be populated on detection");
    assert.ok(
      result.cycle!.includes("A") && result.cycle!.includes("B"),
      `cycle must contain both A and B; got ${JSON.stringify(result.cycle)}`,
    );
    assert.strictEqual(
      result.cycle![0],
      result.cycle![result.cycle!.length - 1],
      "cycle must close on itself (first === last for human-readable trace)",
    );
  });

  it("should detect 3-node cycle", async () => {
    const graph = new Map<string, string[]>([
      ["A", ["B"]],
      ["B", ["C"]],
      ["C", ["A"]],
    ]);
    const result = detectCircularExports(graph);
    assert.strictEqual(
      result.hasCircular,
      true,
      "3-node cycle must be detected",
    );
    assert.ok(result.cycle, "cycle array must be populated");
    for (const n of ["A", "B", "C"]) {
      assert.ok(
        result.cycle!.includes(n),
        `cycle must contain node ${n}; got ${JSON.stringify(result.cycle)}`,
      );
    }
    assert.strictEqual(
      result.cycle![0],
      result.cycle![result.cycle!.length - 1],
      "cycle must close on itself",
    );
  });

  it("should detect self-loop", async () => {
    const graph = new Map<string, string[]>([["A", ["A"]]]);
    const result = detectCircularExports(graph);
    assert.strictEqual(
      result.hasCircular,
      true,
      "self-loop must be detected as circular",
    );
    assert.ok(result.cycle, "cycle array must be populated");
    assert.ok(
      result.cycle!.includes("A"),
      "self-loop cycle must contain the offending node",
    );
  });

  it("should detect cycle in disconnected subgraphs", async () => {
    const graph = new Map<string, string[]>([
      ["X", ["Y"]],
      ["Y", ["Z"]],
      ["Z", []],
      ["A", ["B"]],
      ["B", ["A"]],
    ]);
    const result = detectCircularExports(graph);
    assert.strictEqual(
      result.hasCircular,
      true,
      "cycle in any disconnected component must be detected",
    );
    assert.ok(result.cycle, "cycle array must be populated");
    assert.ok(
      result.cycle!.includes("A") && result.cycle!.includes("B"),
      `reported cycle must come from the cyclic component, not the DAG; got ${JSON.stringify(result.cycle)}`,
    );
    for (const n of ["X", "Y", "Z"]) {
      assert.ok(
        !result.cycle!.includes(n),
        `DAG node ${n} must not appear in cycle; got ${JSON.stringify(result.cycle)}`,
      );
    }
  });

  it("should preserve cycle order as a walk through the graph", async () => {
    const graph = new Map<string, string[]>([
      ["A", ["B"]],
      ["B", ["C"]],
      ["C", ["A"]],
    ]);
    const result = detectCircularExports(graph);
    assert.ok(result.cycle, "cycle must be populated");
    const cycle = result.cycle!;
    assert.strictEqual(
      cycle[0],
      cycle[cycle.length - 1],
      "cycle must close on itself",
    );
    const open = cycle.slice(0, -1);
    for (let i = 0; i < open.length; i++) {
      const from = open[i];
      const to = open[(i + 1) % open.length];
      const outgoing = graph.get(from) ?? [];
      assert.ok(
        outgoing.includes(to),
        `cycle order invalid: ${from} has no edge to ${to}; cycle=${JSON.stringify(cycle)}`,
      );
    }
  });

  it("should return null for empty entries", async () => {
    const result = generateBarrelContent([]);
    assert.strictEqual(
      result,
      null,
      "generateBarrelContent must return null for empty entries",
    );
  });

  it("should prefix output with GENERATED_MARKER", async () => {
    const entries: ExportEntry[] = [{ name: "alpha", isDirectory: false }];
    const output = generateBarrelContent(entries);
    assert.ok(output, "output must be non-null for non-empty entries");
    assert.ok(
      output!.startsWith(GENERATED_MARKER),
      `output must start with GENERATED_MARKER; got: ${JSON.stringify(output)}`,
    );
  });

  it("should emit double-quoted export for file entries", async () => {
    const entries: ExportEntry[] = [{ name: "alpha", isDirectory: false }];
    const output = generateBarrelContent(entries)!;
    assert.ok(
      output.includes(`export * from "./alpha.js";`),
      `file entry must emit double-quoted export for ./alpha.js; got: ${JSON.stringify(output)}`,
    );
    assert.ok(
      !output.includes(`export * from './alpha.js';`),
      `file entry must NOT emit single-quoted export (Phase 1.4 uses double quotes); got: ${JSON.stringify(output)}`,
    );
  });

  it("should emit directory entry with index.js path", async () => {
    const entries: ExportEntry[] = [{ name: "adapters", isDirectory: true }];
    const output = generateBarrelContent(entries)!;
    assert.ok(
      output.includes(`export * from "./adapters/index.js";`),
      `directory entry must emit export for ./adapters/index.js; got: ${JSON.stringify(output)}`,
    );
  });

  it("should sort entries alphabetically by name", async () => {
    const entries: ExportEntry[] = [
      { name: "zeta", isDirectory: false },
      { name: "alpha", isDirectory: true },
      { name: "mu", isDirectory: false },
    ];
    const output = generateBarrelContent(entries)!;
    const alphaIdx = output.indexOf('"./alpha/index.js"');
    const muIdx = output.indexOf('"./mu.js"');
    const zetaIdx = output.indexOf('"./zeta.js"');
    assert.ok(
      alphaIdx !== -1 && muIdx !== -1 && zetaIdx !== -1,
      `all three entries must appear in output; got: ${JSON.stringify(output)}`,
    );
    assert.ok(
      alphaIdx < muIdx && muIdx < zetaIdx,
      `entries must be alphabetically sorted (alpha < mu < zeta); got indices ${alphaIdx}, ${muIdx}, ${zetaIdx}`,
    );
  });

  it("should end output with trailing newline", async () => {
    const entries: ExportEntry[] = [{ name: "alpha", isDirectory: false }];
    const output = generateBarrelContent(entries)!;
    assert.ok(
      output.endsWith("\n"),
      `output must end with a trailing newline; got: ${JSON.stringify(output)}`,
    );
  });

  it("should parse single-quoted exports for backward compatibility", async () => {
    const content = `${GENERATED_MARKER}\n\nexport * from './alpha.js';\n`;
    const result = parseBarrelExports(content);
    assert.deepStrictEqual(
      result,
      ["alpha"],
      "parseBarrelExports must tolerate single-quoted exports",
    );
  });

  it("should parse double-quoted exports", async () => {
    const content = `${GENERATED_MARKER}\n\nexport * from "./alpha.js";\n`;
    const result = parseBarrelExports(content);
    assert.deepStrictEqual(
      result,
      ["alpha"],
      "parseBarrelExports must parse double-quoted exports",
    );
  });

  it("should strip .js extension from extracted names", async () => {
    const content = `export * from "./foo.js";\nexport * from "./bar/index.js";\n`;
    const result = parseBarrelExports(content);
    for (const name of result) {
      assert.ok(
        !name.endsWith(".js"),
        `parsed name must not include .js extension; got: ${name}`,
      );
    }
    assert.deepStrictEqual(
      result,
      ["foo", "bar/index"],
      "parseBarrelExports must strip .js and return the inner path",
    );
  });

  it("should return empty array for content with no exports", async () => {
    const content = `${GENERATED_MARKER}\n\n// nothing to export yet\n`;
    const result = parseBarrelExports(content);
    assert.deepStrictEqual(
      result,
      [],
      "parseBarrelExports must return [] when content has no export statements",
    );
  });

  it("should handle multiple exports with mixed quote styles", async () => {
    const content = [
      GENERATED_MARKER,
      "",
      `export * from "./alpha.js";`,
      `export * from './beta.js';`,
      `export * from "./gamma/index.js";`,
      "",
    ].join("\n");
    const result = parseBarrelExports(content);
    assert.deepStrictEqual(
      result,
      ["alpha", "beta", "gamma/index"],
      "parseBarrelExports must handle multiple exports across lines and mixed quote styles",
    );
  });

  it("should return true for plain .ts files", async () => {
    assert.strictEqual(
      isSourceFile("foo.ts"),
      true,
      "plain .ts file must be treated as source",
    );
    assert.strictEqual(
      isSourceFile("some-adapter.ts"),
      true,
      "hyphenated .ts file must be treated as source",
    );
  });

  it("should return false for .d.ts declaration files", async () => {
    assert.strictEqual(
      isSourceFile("types.d.ts"),
      false,
      ".d.ts declaration files must be excluded",
    );
  });

  it("should return false for .test.ts files", async () => {
    assert.strictEqual(
      isSourceFile("foo.test.ts"),
      false,
      ".test.ts files must be excluded",
    );
  });

  it("should return false for .spec.ts files", async () => {
    assert.strictEqual(
      isSourceFile("foo.spec.ts"),
      false,
      ".spec.ts files must be excluded",
    );
  });

  it("should return false for index.ts to prevent self-reference", async () => {
    assert.strictEqual(
      isSourceFile("index.ts"),
      false,
      "index.ts must be excluded to prevent self-reference in the barrel",
    );
  });

  it("should return false for non-.ts files", async () => {
    assert.strictEqual(
      isSourceFile("config.json"),
      false,
      ".json files must be excluded",
    );
    assert.strictEqual(
      isSourceFile("README.md"),
      false,
      ".md files must be excluded",
    );
    assert.strictEqual(
      isSourceFile("styles.css"),
      false,
      ".css files must be excluded",
    );
    assert.strictEqual(
      isSourceFile("script.js"),
      false,
      "plain .js files must be excluded",
    );
  });
});
