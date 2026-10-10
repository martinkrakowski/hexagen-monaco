import { describe, expect, it } from "vitest";
import { scanSpecifiers } from "../../../src/commands/observe/imports/scan.js";
import { parseJsonc } from "../../../src/commands/observe/imports/jsonc.js";

const specs = (text: string): (string | null)[] =>
  scanSpecifiers(text).map((s) => s.specifier);

describe("scanSpecifiers", () => {
  it("reads every static form", () => {
    const text = [
      `import a from './a';`,
      `import { b, c as d } from "./b"`,
      `import type { T } from './t';`,
      `import * as ns from './ns';`,
      `import './side';`,
      `export * from './re';`,
      `export { x } from './rex';`,
      `import e = require('./eq');`,
      `const f = require('./f');`,
      `const g = await import('./g');`,
      `import {\n  multi,\n  line,\n} from './multi';`,
    ].join("\n");
    expect(specs(text)).toEqual([
      "./a",
      "./b",
      "./t",
      "./ns",
      "./side",
      "./re",
      "./rex",
      "./eq",
      "./f",
      "./g",
      "./multi",
    ]);
  });

  it("labels the kind of each specifier", () => {
    const kinds = scanSpecifiers(
      `import 'a'; import x from 'b'; export * from 'c'; import('d'); require('e');`,
    ).map((s) => s.kind);
    expect(kinds).toEqual([
      "import",
      "import",
      "export-from",
      "dynamic-import",
      "require",
    ]);
  });

  it("ignores specifiers in line and block comments", () => {
    const text = [
      `// import x from './line-comment';`,
      `/* import y from './block'; require('./block-req'); */`,
      `import real from './real'; // trailing import('./t')`,
    ].join("\n");
    expect(specs(text)).toEqual(["./real"]);
  });

  it("ignores specifiers in strings and template literals, including nested ones", () => {
    const text = [
      "const a = `import x from './in-template'`;",
      "const b = `outer ${require('./in-expr')} and ${`inner ${import('./deep')}`}`;",
      `const c = "import('./in-string')";`,
      `const d = 'require("./in-single")';`,
      `import real from './real';`,
    ].join("\n");
    expect(specs(text)).toEqual(["./real"]);
  });

  it("resumes after a template with a brace-bearing expression", () => {
    const text = "const t = `a ${ {k: 1}.k } b`;\nrequire('./after');";
    expect(specs(text)).toEqual(["./after"]);
  });

  it("reports a non-literal specifier as null", () => {
    expect(
      scanSpecifiers(
        "import(name); require(a + b); import(`./t`); require('./' + x);",
      ).map((s) => [s.kind, s.specifier]),
    ).toEqual([
      ["dynamic-import", null],
      ["require", null],
      ["dynamic-import", null],
      ["require", null],
    ]);
  });

  it("accepts a dynamic import with an options argument", () => {
    expect(specs(`import('./a.json', { with: { type: 'json' } })`)).toEqual([
      "./a.json",
    ]);
  });

  it("does not mistake member calls, declarations or identifiers for imports", () => {
    const text = [
      `obj.require('./not');`,
      `obj.import('./not');`,
      `function require(x) {}`,
      `const important = 'x'; const required = 'y';`,
      `import.meta.url;`,
      `const from = 'x';`,
    ].join("\n");
    expect(specs(text)).toEqual([]);
  });

  it("is not thrown off by regex literals or division", () => {
    const text = [
      `const r = /import 'x'|["']/g;`,
      `const q = a / b / c; // import 'nope'`,
      `const s = x.replace(/\\//g, '/');`,
      `import ok from './ok';`,
    ].join("\n");
    expect(specs(text)).toEqual(["./ok"]);
  });

  it("closes an unterminated string at the end of the line", () => {
    expect(specs(`const a = 'oops\nimport b from './b';`)).toEqual(["./b"]);
  });

  it("skips a hashbang and a lone unterminated block comment", () => {
    expect(specs(`#!/usr/bin/env node\nrequire('./cli');`)).toEqual(["./cli"]);
    expect(specs(`require('./a'); /* never closed import 'b'`)).toEqual([
      "./a",
    ]);
  });

  it("treats a string with escapes as non-literal", () => {
    expect(specs(`require('a\\u0062')`)).toEqual([null]);
  });
});

describe("scanSpecifiers: hostile and JSX input", () => {
  it("stays linear on a failed-regex pattern (F1)", () => {
    // F1: guards the cost of `tokenize` (src/commands/observe/imports/scan.ts).
    // (A) an absolute cap on the small input, checked first: a quadratic scan
    // fails here within seconds and never reaches the large input.
    // (B) the growth exponent between the two sizes, on the minimum of 7 samples.
    // Measured on an 8-core host under load: linear about 5 ms at 25,000
    // characters and 48 ms at 200,000; with the `noRegexBefore` guard removed
    // (quadratic) about 2,400 ms at 25,000. The old small sample (16 KiB) took
    // under a millisecond, so its ratio was timer noise on a loaded machine.
    const ABS_SMALL = 25_000;
    const ABS_LARGE = 200_000; // 8x
    const CAP_SMALL_MS = 250;
    const BOUND = 1.5; // linear is about 1, quadratic 2; the worst loaded run measured 1.17
    const sample = (len: number, stopAboveMs: number): number => {
      const input = "/[".repeat(len / 2);
      scanSpecifiers(input); // warm-up, not measured
      let best = Infinity;
      for (let n = 1; n <= 7; ++n) {
        const t0 = performance.now();
        scanSpecifiers(input);
        const ms = performance.now() - t0;
        if (ms < best) best = ms;
        // Stop early only when the MINIMUM so far is over the limit after at
        // least two samples: one slow sample may be the scheduler or the collector.
        if (n >= 2 && best > stopAboveMs) break;
      }
      return best;
    };
    // Check SMALL FIRST and expect it before touching LARGE, so the mutant never runs LARGE.
    const minSmall = sample(ABS_SMALL, CAP_SMALL_MS);
    expect(minSmall).toBeLessThan(CAP_SMALL_MS);
    // No early stop on LARGE: one slow sample on a loaded machine must not
    // become the minimum. A quadratic implementation never gets here.
    const minLarge = sample(ABS_LARGE, Number.POSITIVE_INFINITY);
    const exponent = Math.log(minLarge / minSmall) / Math.log(8);
    console.log(
      `[F1] small=${minSmall.toFixed(2)}ms large=${minLarge.toFixed(2)}ms exponent=${exponent.toFixed(3)}`,
    );
    expect(exponent).toBeLessThan(BOUND);
    // Correctness on a 1 MiB input (1,048,576 characters).
    expect(scanSpecifiers("/[".repeat(512 * 1024))).toEqual([]);
  }, 30_000);

  it("recognizes require?.() and (require)() calls (bot 5)", () => {
    expect(
      specs(
        "const a = require?.('./a'); const b = (require)('./b'); const c = (require)(name); const d = require?.(name);",
      ),
    ).toEqual(["./a", "./b", null, null]);
    expect(specs("x.require?.('./no'); obj?.require('./no2');")).toEqual([]);
  });

  it("keeps an escaped or empty static specifier as null (bot 7)", () => {
    expect(
      scanSpecifiers(
        "import '\\u0061'; export * from ''; import x from './ok';",
      ).map((s) => [s.kind, s.specifier]),
    ).toEqual([
      ["import", null],
      ["export-from", null],
      ["import", "./ok"],
    ]);
  });

  it("keeps correct results on the short form of that pattern", () => {
    expect(specs("const a = 1 /[ /[ /[\nimport b from './b';")).toEqual([
      "./b",
    ]);
    expect(specs("x = /[/]\\/ab/.test(s);\nimport c from './c';")).toEqual([
      "./c",
    ]);
  });

  it("does not read the slash of a JSX closing tag as a regex (F4)", () => {
    expect(specs("const a = <p>x</p>{`a/b`};\nimport z from './z';")).toEqual([
      "./z",
    ]);
    expect(
      specs("const a = <p>x</p>{`a/b`};\nconst b = `x`;\nimport('./after')"),
    ).toEqual(["./after"]);
  });

  it("still reads a regex after the > of an arrow function", () => {
    expect(
      specs("arr.filter(x => /import 'x'/.test(x)); import a from './a';"),
    ).toEqual(["./a"]);
  });

  it("does not report a method named require or import (F10)", () => {
    expect(
      specs("class Loader { require(id) {} async import(x, y) { } }"),
    ).toEqual([]);
    expect(specs("if (a) { x = require(name); }")).toEqual([null]);
  });
});

describe("parseJsonc", () => {
  it("accepts comments, trailing commas and a BOM, and keeps strings intact", () => {
    const text = `\ufeff{
      // line
      "a": "x // not a comment, /* nor this */",
      /* block */ "b": [1, 2,],
    }`;
    expect(parseJsonc(text)).toEqual({
      a: "x // not a comment, /* nor this */",
      b: [1, 2],
    });
  });

  it("returns undefined for invalid text", () => {
    expect(parseJsonc("{ nope")).toBeUndefined();
  });
});

describe("scanSpecifiers: escapes", () => {
  it("decodes an escaped backslash and quote, so a Windows-style specifier is literal", () => {
    expect(
      specs(`import 'D:\\\\y'; import ".\\\\z"; import 'it\\'s';`),
    ).toEqual(["D:\\y", ".\\z", "it's"]);
  });
});
