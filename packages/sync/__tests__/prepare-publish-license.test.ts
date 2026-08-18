import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(
  new URL("../../../scripts/prepare-publish-package.js", import.meta.url),
);

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

async function makeFixture(opts: { license?: string }): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "prepublish-license-"));
  await fs.mkdir(path.join(dir, "dist"), { recursive: true });
  await fs.writeFile(path.join(dir, "dist", "index.js"), "export {};\n");
  await fs.writeFile(
    path.join(dir, "package.json"),
    JSON.stringify(
      { name: "@hexagen/license-fixture", version: "1.2.3", type: "module" },
      null,
      2,
    ),
  );
  if (opts.license !== undefined) {
    await fs.writeFile(path.join(dir, "LICENSE"), opts.license);
  }
  return dir;
}

describe("prepare-publish-package LICENSE staging", () => {
  it("fails when the package has no per-package LICENSE (does not ship the root license)", async () => {
    const dir = await makeFixture({});
    try {
      let threw = false;
      try {
        execFileSync("node", [SCRIPT, dir], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (error) {
        threw = true;
        const err = error as { status?: number; stderr?: string };
        assert.equal(
          err.status,
          1,
          "missing LICENSE must be a hard error exit 1",
        );
        assert.match(
          String(err.stderr ?? ""),
          /package-local LICENSE/,
          "stderr must name the missing package-local LICENSE",
        );
      }
      assert.equal(threw, true, "staging must not succeed without a LICENSE");

      const stagedLicense = path.join(dir, "publish", "LICENSE");
      try {
        const staged = await fs.readFile(stagedLicense, "utf8");
        assert.doesNotMatch(
          staged,
          /SOURCE-AVAILABLE EVALUATION LICENSE/,
          "must not copy the proprietary root LICENSE into the staged tarball",
        );
      } catch (readErr) {
        assert.equal(
          (readErr as NodeJS.ErrnoException).code,
          "ENOENT",
          "absent staged LICENSE is the other acceptable outcome",
        );
      }
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("fails when the package-local LICENSE is empty or whitespace", async () => {
    const dir = await makeFixture({ license: "   \n  " });
    try {
      let threw = false;
      try {
        execFileSync("node", [SCRIPT, dir], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (error) {
        threw = true;
        const err = error as { status?: number; stderr?: string };
        assert.equal(
          err.status,
          1,
          "empty LICENSE must be a hard error exit 1",
        );
        assert.match(String(err.stderr ?? ""), /is empty or whitespace-only/);
      }
      assert.equal(
        threw,
        true,
        "staging must not succeed with an empty LICENSE",
      );
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("copies the package-local LICENSE verbatim", async () => {
    const marker = "PACKAGE-LOCAL-FSL-MARKER\nValid Clause...";
    const dir = await makeFixture({ license: marker });
    try {
      execFileSync("node", [SCRIPT, dir], { stdio: "ignore" });
      const staged = await fs.readFile(
        path.join(dir, "publish", "LICENSE"),
        "utf8",
      );
      assert.equal(staged, marker);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("published wedge packages carry a full package-local LICENSE with FSL clauses", async () => {
    for (const rel of ["tools/arch-linter/LICENSE"]) {
      const abs = path.join(REPO_ROOT, rel);
      const text = await fs.readFile(abs, "utf8");
      assert.match(text, /Functional Source License, Version 1\.1/i);
      assert.match(text, /Apache License, Version 2\.0/);
    }
  });

  it("verifies package.json uses FSL-1.1-ALv2 in published packages", async () => {
    for (const rel of ["tools/arch-linter/package.json"]) {
      const abs = path.join(REPO_ROOT, rel);
      const pkg = JSON.parse(await fs.readFile(abs, "utf8"));
      assert.equal(
        pkg.license,
        "FSL-1.1-ALv2",
        `${rel} must have FSL-1.1-ALv2 license field`,
      );
    }
  });

  it("published proprietary packages carry a full package-local proprietary LICENSE", async () => {
    for (const rel of ["packages/sync/LICENSE"]) {
      const abs = path.join(REPO_ROOT, rel);
      const text = await fs.readFile(abs, "utf8");
      assert.match(text, /SOURCE-AVAILABLE EVALUATION LICENSE/i);
      assert.match(text, /Krakowski Cloud Solutions/i);
    }
  });

  it("verifies package.json uses UNLICENSED in proprietary packages", async () => {
    for (const rel of ["packages/sync/package.json"]) {
      const abs = path.join(REPO_ROOT, rel);
      const pkg = JSON.parse(await fs.readFile(abs, "utf8"));
      assert.equal(
        pkg.license,
        "UNLICENSED",
        `${rel} must have UNLICENSED license field`,
      );
    }
  });
});
