import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "vitest";
import rule from "../../src/rules/no-feature-slice-imports.js";

type Reported = { messageId: string; data?: Record<string, string> };

const SOURCE_FILE = "/repo/apps/web/features/source-slice/file.ts";
const SAME_SLICE_FILE = "/repo/apps/web/features/other-slice/bar.ts";
const SHELL_FILE = "/repo/apps/web/features/workspace-shell/shell.ts";
const NON_FEATURE_FILE = "/repo/apps/web/app/page.ts";

function lint(filename: string, specifier: string): Reported[] {
  const reported: Reported[] = [];
  const visitor = rule.create({
    filename,
    report: (args: Reported) => reported.push(args),
  } as never) as {
    ImportDeclaration?: (node: unknown) => void;
  };
  visitor.ImportDeclaration?.({
    source: { value: specifier },
  });
  return reported;
}

describe("no-feature-slice-imports", () => {
  it("exports a rule object with meta and create", () => {
    assert.ok(rule.meta);
    assert.ok(typeof rule.create === "function");
  });

  it("meta is configured with problem type", () => {
    assert.strictEqual(rule.meta.type, "problem");
  });

  it("reports alias import from another feature slice", () => {
    const reported = lint(SOURCE_FILE, "@/other-slice/foo");
    assert.strictEqual(reported.length, 1);
    assert.strictEqual(reported[0].messageId, "crossSliceImport");
    assert.strictEqual(reported[0].data?.source, "source-slice");
    assert.strictEqual(reported[0].data?.target, "other-slice");
  });

  it("reports relative import from another feature slice", () => {
    const reported = lint(SOURCE_FILE, "../other-slice/foo");
    assert.strictEqual(reported.length, 1);
    assert.strictEqual(reported[0].messageId, "crossSliceImport");
    assert.strictEqual(reported[0].data?.source, "source-slice");
    assert.strictEqual(reported[0].data?.target, "other-slice");
  });

  it("does not report same-slice alias import", () => {
    const reported = lint(SOURCE_FILE, "@/source-slice/foo");
    assert.strictEqual(reported.length, 0);
  });

  it("does not report same-slice relative import", () => {
    const reported = lint(SOURCE_FILE, "./local");
    assert.strictEqual(reported.length, 0);
  });

  it("does not report imports from workspace-shell (composition root)", () => {
    const reported = lint(SHELL_FILE, "@/other-slice/foo");
    assert.strictEqual(reported.length, 0);
  });

  it("does not report imports of workspace-shell from another slice", () => {
    const reported = lint(SOURCE_FILE, "@/workspace-shell/contexts/foo");
    assert.strictEqual(reported.length, 0);
  });

  it("does not report alias imports that resolve to @/components", () => {
    const reported = lint(SOURCE_FILE, "@/components/ui/button");
    assert.strictEqual(reported.length, 0);
  });

  it("does not report alias imports that resolve to @/lib", () => {
    const reported = lint(SOURCE_FILE, "@/lib/utils");
    assert.strictEqual(reported.length, 0);
  });

  it("does not report alias imports that resolve to @/hooks", () => {
    const reported = lint(SOURCE_FILE, "@/hooks/useSavedProjects");
    assert.strictEqual(reported.length, 0);
  });

  it("does not report package imports", () => {
    const reported = lint(SOURCE_FILE, "@hexagen/ui");
    assert.strictEqual(reported.length, 0);
  });

  it("does not report files outside features/", () => {
    const reported = lint(NON_FEATURE_FILE, "@/other-slice/foo");
    assert.strictEqual(reported.length, 0);
  });

  it("does not report same-slice alias from a different file in that slice", () => {
    const reported = lint(SAME_SLICE_FILE, "@/other-slice/foo");
    assert.strictEqual(reported.length, 0);
  });

  it("does not report @/ first-segment that exists under an alias root before features/", () => {
    const root = mkdtempSync(path.join(tmpdir(), "fu3-eslint-"));
    try {
      mkdirSync(path.join(root, "lib", "generated"), { recursive: true });
      mkdirSync(path.join(root, "features", "source-slice"), {
        recursive: true,
      });
      const filename = path.join(root, "features", "source-slice", "file.ts");
      writeFileSync(filename, "");
      const reported = lint(
        filename,
        "@/generated/template-manifest.generated",
      );
      assert.strictEqual(reported.length, 0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports @/ first-segment that exists as a features/ directory", () => {
    const root = mkdtempSync(path.join(tmpdir(), "fu3-eslint-"));
    try {
      mkdirSync(path.join(root, "features", "source-slice"), {
        recursive: true,
      });
      mkdirSync(path.join(root, "features", "other-slice"), { recursive: true });
      const filename = path.join(root, "features", "source-slice", "file.ts");
      writeFileSync(filename, "");
      const reported = lint(filename, "@/other-slice/foo");
      assert.strictEqual(reported.length, 1);
      assert.strictEqual(reported[0].data?.target, "other-slice");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
