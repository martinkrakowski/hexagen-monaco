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

/**
 * Unit tests for packages/sync/src/generators/barrels/utils.ts
 *
 * Coverage targets (6 pure functions):
 *   - isGeneratedFile
 *   - contentHash
 *   - detectCircularExports  (CRITICAL per AGENTS.md §7 — circular barrels are a
 *     critical invariant failure; the sync engine aborts + cleans up on detection)
 *   - generateBarrelContent  (Phase 1.4 changed to double-quoted emission)
 *   - parseBarrelExports     (must tolerate both single and double quotes for
 *                             backward compatibility with pre-Phase 1.4 barrels)
 *   - isSourceFile
 *
 * Test style mirrors __tests__/generators/package-json.test.ts:
 *   - self-invoking async IIFE
 *   - node:assert (strict variants)
 *   - console.log for progress, process.exitCode on failure
 *   - no fixtures, inline inputs (these are pure functions)
 */

(async () => {
  console.log("Running barrels/utils tests...\n");

  // ---------------------------------------------------------------------------
  // isGeneratedFile
  // ---------------------------------------------------------------------------

  // 1) Returns true when content contains the current GENERATED_MARKER
  {
    const content = `${GENERATED_MARKER}\n\nexport * from "./a.js";\n`;
    assert.strictEqual(
      isGeneratedFile(content),
      true,
      "isGeneratedFile should return true for the current marker",
    );
    console.log("✅ isGeneratedFile: detects current GENERATED_MARKER");
  }

  // 2) Returns true when content contains the legacy marker
  {
    const content = `// ${LEGACY_GENERATED_MARKER}\n\nexport * from './a.js';\n`;
    assert.strictEqual(
      isGeneratedFile(content),
      true,
      "isGeneratedFile should return true for the legacy marker",
    );
    console.log("✅ isGeneratedFile: detects LEGACY_GENERATED_MARKER");
  }

  // 3) Returns false when content has no marker
  {
    const content = `export const foo = 1;\nexport const bar = 2;\n`;
    assert.strictEqual(
      isGeneratedFile(content),
      false,
      "isGeneratedFile should return false when no marker is present",
    );
    console.log("✅ isGeneratedFile: returns false when no marker present");
  }

  // 4) Returns true when marker is anywhere in the file (not just line 1)
  {
    const content = `export const foo = 1;\n// other comment\n${GENERATED_MARKER}\nexport const bar = 2;\n`;
    assert.strictEqual(
      isGeneratedFile(content),
      true,
      "isGeneratedFile should match marker even when not on the first line",
    );
    console.log("✅ isGeneratedFile: detects marker at any line position");
  }

  // ---------------------------------------------------------------------------
  // contentHash
  // ---------------------------------------------------------------------------

  // 5) Consistent hex digest for the same input
  {
    const input = 'export * from "./alpha.js";\n';
    const h1 = contentHash(input);
    const h2 = contentHash(input);
    assert.strictEqual(
      h1,
      h2,
      "contentHash must be deterministic for identical input",
    );
    console.log("✅ contentHash: deterministic for identical input");
  }

  // 6) Different inputs produce different hashes
  {
    const h1 = contentHash("alpha");
    const h2 = contentHash("beta");
    assert.notStrictEqual(
      h1,
      h2,
      "contentHash must produce distinct hashes for distinct input",
    );
    console.log("✅ contentHash: different inputs yield different hashes");
  }

  // 7) Returns 64-char lowercase hex string (SHA-256 size)
  {
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
    console.log("✅ contentHash: returns 64-char lowercase hex (SHA-256)");
  }

  // ---------------------------------------------------------------------------
  // detectCircularExports  (CRITICAL — per AGENTS.md §7)
  // ---------------------------------------------------------------------------

  // 8) Empty graph → no cycle
  {
    const result = detectCircularExports(new Map());
    assert.deepStrictEqual(
      result,
      { hasCircular: false, cycle: null },
      "empty graph must report no circular dependency",
    );
    console.log("✅ detectCircularExports: empty graph → no cycle");
  }

  // 9) DAG (no cycles) → no cycle
  //    A → B → C
  //    A → C
  {
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
    console.log("✅ detectCircularExports: DAG → no cycle");
  }

  // 10) Simple 2-node cycle: A → B → A
  {
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
    // Cycle should close on itself: first and last element are the same node.
    assert.strictEqual(
      result.cycle![0],
      result.cycle![result.cycle!.length - 1],
      "cycle must close on itself (first === last for human-readable trace)",
    );
    console.log(
      `✅ detectCircularExports: 2-node cycle A→B→A detected (cycle=${JSON.stringify(result.cycle)})`,
    );
  }

  // 11) 3-node cycle: A → B → C → A
  {
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
    // Must contain all three nodes
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
    console.log(
      `✅ detectCircularExports: 3-node cycle A→B→C→A detected (cycle=${JSON.stringify(result.cycle)})`,
    );
  }

  // 12) Self-loop: A → A
  {
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
    console.log(
      `✅ detectCircularExports: self-loop A→A detected (cycle=${JSON.stringify(result.cycle)})`,
    );
  }

  // 13) Disconnected subgraphs — only one contains a cycle
  //    Component 1 (DAG):  X → Y → Z
  //    Component 2 (cycle): A → B → A
  {
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
    // The DAG nodes must NOT appear in the reported cycle
    for (const n of ["X", "Y", "Z"]) {
      assert.ok(
        !result.cycle!.includes(n),
        `DAG node ${n} must not appear in cycle; got ${JSON.stringify(result.cycle)}`,
      );
    }
    console.log(
      "✅ detectCircularExports: disconnected subgraphs — cycle isolated to cyclic component",
    );
  }

  // 14) Cycle array preserves the order of the cycle (for human-readable
  //     error messages the bootstrap validator prints).
  {
    const graph = new Map<string, string[]>([
      ["A", ["B"]],
      ["B", ["C"]],
      ["C", ["A"]],
    ]);
    const result = detectCircularExports(graph);
    assert.ok(result.cycle, "cycle must be populated");
    const cycle = result.cycle!;
    // The cycle closes on itself (first === last) — strip the closing node
    // and verify the open path is exactly one consecutive walk in the graph.
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
    console.log(
      `✅ detectCircularExports: cycle order preserved as a walk through the graph (cycle=${JSON.stringify(cycle)})`,
    );
  }

  // ---------------------------------------------------------------------------
  // generateBarrelContent
  // ---------------------------------------------------------------------------

  // 15) Empty entries → null (do not create a barrel for empty directories)
  {
    const result = generateBarrelContent([]);
    assert.strictEqual(
      result,
      null,
      "generateBarrelContent must return null for empty entries",
    );
    console.log("✅ generateBarrelContent: empty entries → null");
  }

  // 16) Output is prefixed with the GENERATED_MARKER
  {
    const entries: ExportEntry[] = [{ name: "alpha", isDirectory: false }];
    const output = generateBarrelContent(entries);
    assert.ok(output, "output must be non-null for non-empty entries");
    assert.ok(
      output!.startsWith(GENERATED_MARKER),
      `output must start with GENERATED_MARKER; got: ${JSON.stringify(output)}`,
    );
    console.log(
      "✅ generateBarrelContent: output starts with GENERATED_MARKER",
    );
  }

  // 17) File entries emit `export * from "./<name>.js"` with DOUBLE quotes
  //     (Phase 1.4 output contract)
  {
    const entries: ExportEntry[] = [{ name: "alpha", isDirectory: false }];
    const output = generateBarrelContent(entries)!;
    assert.ok(
      output.includes(`export * from "./alpha.js";`),
      `file entry must emit double-quoted export for ./alpha.js; got: ${JSON.stringify(output)}`,
    );
    // Belt-and-braces: make sure we did NOT emit single quotes.
    assert.ok(
      !output.includes(`export * from './alpha.js';`),
      `file entry must NOT emit single-quoted export (Phase 1.4 uses double quotes); got: ${JSON.stringify(output)}`,
    );
    console.log(
      '✅ generateBarrelContent: file entry emits double-quoted export * from "./<name>.js"',
    );
  }

  // 18) Directory entries emit `export * from "./<name>/index.js"`
  {
    const entries: ExportEntry[] = [{ name: "adapters", isDirectory: true }];
    const output = generateBarrelContent(entries)!;
    assert.ok(
      output.includes(`export * from "./adapters/index.js";`),
      `directory entry must emit export for ./adapters/index.js; got: ${JSON.stringify(output)}`,
    );
    console.log(
      '✅ generateBarrelContent: directory entry emits export * from "./<name>/index.js"',
    );
  }

  // 19) Entries are sorted alphabetically by name, regardless of type
  {
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
    console.log("✅ generateBarrelContent: entries sorted alphabetically");
  }

  // 20) Output ends with a trailing newline
  {
    const entries: ExportEntry[] = [{ name: "alpha", isDirectory: false }];
    const output = generateBarrelContent(entries)!;
    assert.ok(
      output.endsWith("\n"),
      `output must end with a trailing newline; got: ${JSON.stringify(output)}`,
    );
    console.log("✅ generateBarrelContent: output ends with trailing newline");
  }

  // ---------------------------------------------------------------------------
  // parseBarrelExports
  // ---------------------------------------------------------------------------

  // 21) Parses single-quoted exports (backward compatibility)
  {
    const content = `${GENERATED_MARKER}\n\nexport * from './alpha.js';\n`;
    const result = parseBarrelExports(content);
    assert.deepStrictEqual(
      result,
      ["alpha"],
      "parseBarrelExports must tolerate single-quoted exports",
    );
    console.log("✅ parseBarrelExports: parses single-quoted exports");
  }

  // 22) Parses double-quoted exports (new Phase 1.4 output)
  {
    const content = `${GENERATED_MARKER}\n\nexport * from "./alpha.js";\n`;
    const result = parseBarrelExports(content);
    assert.deepStrictEqual(
      result,
      ["alpha"],
      "parseBarrelExports must parse double-quoted exports",
    );
    console.log("✅ parseBarrelExports: parses double-quoted exports");
  }

  // 23) Extracted names do not include the .js extension
  {
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
    console.log(
      "✅ parseBarrelExports: strips .js extension from extracted names",
    );
  }

  // 24) Content with no exports → empty array
  {
    const content = `${GENERATED_MARKER}\n\n// nothing to export yet\n`;
    const result = parseBarrelExports(content);
    assert.deepStrictEqual(
      result,
      [],
      "parseBarrelExports must return [] when content has no export statements",
    );
    console.log(
      "✅ parseBarrelExports: returns [] for content with no exports",
    );
  }

  // 25) Handles multiple exports on separate lines, mixed quote styles
  {
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
    console.log(
      "✅ parseBarrelExports: handles multiple exports on separate lines (mixed quotes)",
    );
  }

  // ---------------------------------------------------------------------------
  // isSourceFile
  // ---------------------------------------------------------------------------

  // 26) Plain .ts source file → true
  {
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
    console.log("✅ isSourceFile: returns true for plain .ts files");
  }

  // 27) Declaration files (.d.ts) → false
  {
    assert.strictEqual(
      isSourceFile("types.d.ts"),
      false,
      ".d.ts declaration files must be excluded",
    );
    console.log("✅ isSourceFile: returns false for .d.ts");
  }

  // 28) Test files (.test.ts) → false
  {
    assert.strictEqual(
      isSourceFile("foo.test.ts"),
      false,
      ".test.ts files must be excluded",
    );
    console.log("✅ isSourceFile: returns false for .test.ts");
  }

  // 29) Spec files (.spec.ts) → false
  {
    assert.strictEqual(
      isSourceFile("foo.spec.ts"),
      false,
      ".spec.ts files must be excluded",
    );
    console.log("✅ isSourceFile: returns false for .spec.ts");
  }

  // 30) index.ts itself → false (barrel would recursively export itself)
  {
    assert.strictEqual(
      isSourceFile("index.ts"),
      false,
      "index.ts must be excluded to prevent self-reference in the barrel",
    );
    console.log("✅ isSourceFile: returns false for index.ts");
  }

  // 31) Non-.ts files → false
  {
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
    console.log("✅ isSourceFile: returns false for non-.ts files");
  }

  console.log("\n✅ All barrels/utils tests passed!");
})().catch((err) => {
  console.error("❌ barrels/utils tests FAILED:", err);
  process.exitCode = 1;
});
