import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  isMissingAtRefMessage,
  renameDiffArgs,
  renameNameStatus,
  resolveBaseRef,
  showFileAtRef,
  stagedDiffArgs,
  stagedFiles,
} from "../src/git-ops.js";

describe("resolveBaseRef", () => {
  it("prefers an explicit --base-ref and prefixes a bare branch with origin/", () => {
    assert.equal(resolveBaseRef("main", {}), "origin/main");
    assert.equal(resolveBaseRef("origin/develop", {}), "origin/develop");
    assert.equal(resolveBaseRef(undefined, {}), null);
  });

  it("reads GITHUB_BASE_REF when no explicit ref is given", () => {
    assert.equal(
      resolveBaseRef(undefined, { GITHUB_BASE_REF: "main" }),
      "origin/main",
    );
  });

  it("prefixes slash-containing branch names with origin/", () => {
    assert.equal(resolveBaseRef("release/1.0", {}), "origin/release/1.0");
    assert.equal(
      resolveBaseRef(undefined, { GITHUB_BASE_REF: "feat/x" }),
      "origin/feat/x",
    );
    assert.equal(resolveBaseRef("refs/heads/main", {}), "refs/heads/main");
  });
});

describe("stagedDiffArgs", () => {
  it("asks git for paths relative to cwd so --staged matches ROOT_DIR keys", () => {
    assert.ok(stagedDiffArgs().includes("--relative"));
    assert.ok(stagedDiffArgs().includes("-z"));
  });
});

describe("stagedFiles", () => {
  it("keeps leading spaces, trailing spaces, and newlines in staged paths", () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "hexagen-git-staged-"));
    try {
      execFileSync("git", ["init"], { cwd: tmp, stdio: "ignore" });
      execFileSync("git", ["config", "user.email", "t@example.com"], {
        cwd: tmp,
        stdio: "ignore",
      });
      execFileSync("git", ["config", "user.name", "t"], {
        cwd: tmp,
        stdio: "ignore",
      });
      // NTFS cannot round-trip a trailing space (silently stripped on create,
      // so `git add` then fails) nor a "\n" in a filename — those fixtures
      // only run where such files can exist.
      const names = [
        " leading.txt",
        ...(process.platform === "win32"
          ? []
          : ["trailing.txt ", "has\nnewline.txt"]),
      ];
      for (const name of names) {
        writeFileSync(path.join(tmp, name), "x\n");
      }
      execFileSync("git", ["add", "--", ...names], {
        cwd: tmp,
        stdio: "ignore",
      });
      assert.deepEqual(stagedFiles(tmp).sort(), [...names].sort());
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("renameDiffArgs", () => {
  it("uses two-dot tree comparison, not triple-dot merge-base", () => {
    const args = renameDiffArgs("origin/main");
    assert.deepEqual(args, [
      "diff",
      "--name-status",
      "--find-renames",
      "origin/main",
      "HEAD",
    ]);
    assert.ok(!args.some((a) => a.includes("...")));
  });
});

describe("isMissingAtRefMessage", () => {
  it("classifies a missing path as missing, not a failed git", () => {
    assert.equal(
      isMissingAtRefMessage(
        "fatal: path '.architecture/arch-lint-baseline.json' does not exist in 'origin/main'",
      ),
      true,
    );
    assert.equal(
      isMissingAtRefMessage(
        "fatal: Path 'foo' exists on disk, but not in 'HEAD'.",
      ),
      true,
    );
    assert.equal(
      isMissingAtRefMessage("fatal: invalid object name 'origin/main'"),
      false,
    );
    assert.equal(isMissingAtRefMessage("fatal: not a git repository"), false);
  });
});

describe("showFileAtRef / renameNameStatus", () => {
  it("distinguishes a missing path from an unknown ref, and fails closed on rename git errors", () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "hexagen-git-ops-"));
    try {
      execFileSync("git", ["init"], { cwd: tmp, stdio: "ignore" });
      execFileSync("git", ["config", "user.email", "t@example.com"], {
        cwd: tmp,
        stdio: "ignore",
      });
      execFileSync("git", ["config", "user.name", "t"], {
        cwd: tmp,
        stdio: "ignore",
      });
      writeFileSync(path.join(tmp, "kept.txt"), "ok\n");
      execFileSync("git", ["add", "kept.txt"], { cwd: tmp, stdio: "ignore" });
      execFileSync("git", ["commit", "-m", "init"], {
        cwd: tmp,
        stdio: "ignore",
      });

      const missing = showFileAtRef(tmp, "HEAD", "no-such-file.txt");
      assert.equal(missing.kind, "missing");

      const present = showFileAtRef(tmp, "HEAD", "kept.txt");
      assert.equal(present.kind, "ok");

      const badRef = showFileAtRef(tmp, "no-such-ref", "kept.txt");
      assert.equal(badRef.kind, "error");

      assert.throws(
        () => renameNameStatus(tmp, "no-such-ref"),
        /could not list renames/,
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
