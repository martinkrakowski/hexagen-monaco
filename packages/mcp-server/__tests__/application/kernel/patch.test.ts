import { describe, it, expect } from "vitest";
import {
  MAX_PATCH_BYTES,
  parseUnifiedDiff,
} from "../../../src/application/kernel/patch.js";

const HUNK = "@@ -1 +1 @@\n-a\n+b\n";

function modify(p: string): string {
  return `diff --git a/${p} b/${p}\nindex 1111111..2222222 100644\n--- a/${p}\n+++ b/${p}\n${HUNK}`;
}

function paths(patch: string): readonly string[] {
  const r = parseUnifiedDiff(patch);
  if (!r.ok) throw new Error(`refused: ${r.reason}`);
  return r.paths;
}

function refusal(patch: string): string {
  const r = parseUnifiedDiff(patch);
  if (r.ok) throw new Error(`expected a refusal, got ${r.paths.join(",")}`);
  return r.reason;
}

describe("parseUnifiedDiff", () => {
  it("names the path of a plain modification and of several files", () => {
    expect(paths(modify("src/a.ts"))).toEqual(["src/a.ts"]);
    expect(paths(modify("src/a.ts") + modify("lib/b.ts"))).toEqual([
      "src/a.ts",
      "lib/b.ts",
    ]);
  });

  it("reads both sides of a rename with no ---/+++ lines", () => {
    const patch =
      "diff --git a/src/old.ts b/lib/new.ts\nsimilarity index 100%\nrename from src/old.ts\nrename to lib/new.ts\n";
    expect(paths(patch)).toEqual(["src/old.ts", "lib/new.ts"]);
  });

  it("reads both sides of a copy", () => {
    const patch =
      "diff --git a/src/a.ts b/lib/c.ts\nsimilarity index 90%\ncopy from src/a.ts\ncopy to lib/c.ts\nindex 1111111..2222222 100644\n--- a/src/a.ts\n+++ b/lib/c.ts\n" +
      HUNK;
    expect(paths(patch)).toEqual(["src/a.ts", "lib/c.ts"]);
  });

  it("treats /dev/null as created or deleted, never as a path", () => {
    const created = `diff --git a/src/n.ts b/src/n.ts\nnew file mode 100644\nindex 0000000..2222222\n--- /dev/null\n+++ b/src/n.ts\n@@ -0,0 +1 @@\n+x\n`;
    const deleted = `diff --git a/src/d.ts b/src/d.ts\ndeleted file mode 100644\nindex 1111111..0000000\n--- a/src/d.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-x\n`;
    expect(paths(created)).toEqual(["src/n.ts"]);
    expect(paths(deleted)).toEqual(["src/d.ts"]);
  });

  it("does not read a hunk body line that looks like a header", () => {
    const patch = `diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,2 +1,4 @@\n a\n+++ b/evil.ts\n+diff --git a/x b/y\n b\n`;
    expect(paths(patch)).toEqual(["src/a.ts"]);
  });

  it("accepts a no-newline marker and a spaced path", () => {
    const patch = `diff --git a/src/my file.ts b/src/my file.ts\n--- a/src/my file.ts\t\n+++ b/src/my file.ts\t\n@@ -1 +1 @@\n-a\n\\ No newline at end of file\n+b\n\\ No newline at end of file\n`;
    expect(paths(patch)).toEqual(["src/my file.ts"]);
  });

  it("decodes a git-quoted non-ASCII path", () => {
    const q = '"a/src/caf\\303\\251.ts"';
    const patch = `diff --git ${q} "b/src/caf\\303\\251.ts"\n`;
    expect(paths(patch)).toEqual(["src/café.ts"]);
  });

  it("refuses a quoted path it cannot decode, and an escape that makes a control character", () => {
    expect(refusal('diff --git "a/x\\q" "b/x\\q"\n')).toMatch(/decoded/);
    expect(refusal('diff --git "a/x\\tz" "b/x\\tz"\n')).toMatch(/control/);
    expect(refusal('diff --git "a/x\\377" "b/x\\377"\n')).toMatch(/decoded/);
  });

  it.each(["120000", "160000"])("refuses mode %s everywhere", (mode) => {
    const head = "diff --git a/src/l b/src/l\n";
    expect(refusal(`${head}new file mode ${mode}\n`)).toMatch(mode);
    expect(refusal(`${head}old mode ${mode}\nnew mode 100644\n`)).toMatch(mode);
    expect(refusal(`${head}new mode ${mode}\n`)).toMatch(mode);
    expect(refusal(`${head}deleted file mode ${mode}\n`)).toMatch(mode);
    expect(refusal(`${head}index 1111111..2222222 ${mode}\n`)).toMatch(mode);
  });

  it("refuses an unknown mode", () => {
    expect(refusal("diff --git a/x b/x\nnew file mode 100664\n")).toMatch(
      /100664/,
    );
  });

  it("refuses binary patches", () => {
    expect(
      refusal(
        "diff --git a/x b/x\nindex 1..2 100644\nGIT binary patch\nliteral 1\n",
      ),
    ).toMatch(/binary/);
    expect(
      refusal(
        "diff --git a/x b/x\nindex 1..2 100644\nBinary files a/x and b/x differ\n",
      ),
    ).toMatch(/binary/);
  });

  it("refuses a patch with no file headers, junk before a header, and a bare ---/+++ pair", () => {
    expect(refusal("")).toMatch(/no file headers/);
    expect(refusal("hello\n")).toMatch(/outside a file section/);
    expect(refusal(`--- a/src/a.ts\n+++ b/src/a.ts\n${HUNK}`)).toMatch(
      /outside a file section/,
    );
    expect(refusal(`${modify("src/a.ts")}trailing junk\n`)).toMatch(
      /outside a file section/,
    );
  });

  it("refuses a hunk that is shorter or longer than declared", () => {
    const head = "diff --git a/x b/x\n--- a/x\n+++ b/x\n";
    expect(refusal(`${head}@@ -1,2 +1,2 @@\n-a\n+b\n`)).toMatch(/ends inside/);
    expect(refusal(`${head}@@ -1 +1 @@\n-a\n+b\n+c\n`)).toMatch(
      /outside a file section|more lines/,
    );
  });

  it("refuses a header that disagrees with an unreadable split, and an unknown header line", () => {
    expect(refusal("diff --git a/x b/x b/../y\n")).toMatch(/ambiguous/);
    expect(refusal("diff --git a/x b/x\nsurprise line\n")).toMatch(
      /unrecognised/,
    );
    expect(refusal("diff --git x/p y/p\n")).toMatch(/ambiguous|-p1/);
  });

  it("returns every path a section names, so a mismatched ---/+++ cannot hide one", () => {
    const patch = `diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/other/z.ts\n${HUNK}`;
    expect(paths(patch)).toEqual(["src/a.ts", "other/z.ts"]);
  });

  it("refuses traversal, absolute and backslash paths", () => {
    expect(refusal(modify("a/../../x"))).toMatch(/\.\./);
    expect(refusal(modify("/etc/passwd"))).toMatch(/absolute|empty/);
    expect(refusal(modify("src\\a.ts"))).toMatch(/backslash/);
    expect(refusal(modify("src/./a.ts"))).toMatch(/"\."/);
  });

  it("refuses a patch over the size cap", () => {
    const big = `${modify("src/a.ts")}${"x".repeat(MAX_PATCH_BYTES)}`;
    expect(refusal(big)).toMatch(/larger than/);
  });
});
