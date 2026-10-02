import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { issueGrantCommand } from "../../../src/commands/grant/issue.js";
import { grantKeyInitCommand } from "../../../src/commands/grant/key-init.js";
import { canonicalGrantPayload } from "../../../src/commands/grant/canonical.js";

const dirs: string[] = [];
async function tmp(prefix: string): Promise<string> {
  const d = await mkdtemp(path.join(tmpdir(), prefix));
  dirs.push(d);
  // Brownfield roots are client repos; the exclude step needs a git dir.
  if (prefix === "bf-root-") execFileSync("git", ["init", "-q", d]);
  return d;
}

function slice(id: string, paths: string[], excludes: string[] = []): string {
  return JSON.stringify({
    schemaVersion: "1.0.0",
    id,
    repo: { commit: "0123456789abcdef" },
    paths,
    excludes,
    createdBy: "test",
    createdAt: "2026-10-01T00:00:00Z",
  });
}

async function writeSlice(
  root: string,
  id: string,
  paths: string[],
  excludes: string[] = [],
): Promise<void> {
  await mkdir(path.join(root, ".hexagen"), { recursive: true });
  await writeFile(
    path.join(root, ".hexagen", "slice.json"),
    slice(id, paths, excludes),
  );
}

let out: string[];
beforeEach(() => {
  out = [];
  vi.spyOn(console, "log").mockImplementation((...a) => {
    out.push(a.join(" "));
  });
  vi.spyOn(console, "error").mockImplementation((...a) => {
    out.push(a.join(" "));
  });
  process.exitCode = 0;
});
afterEach(async () => {
  vi.restoreAllMocks();
  process.exitCode = 0;
  while (dirs.length > 0) {
    await rm(dirs.pop() as string, { recursive: true, force: true });
  }
});

function base(root: string, home: string) {
  return {
    principal: "martin",
    agent: "lane-1",
    tools: "write_file",
    mode: "write" as const,
    expiresIn: "1h",
    workspaceRoot: root,
    homeDir: home,
    yes: true,
  };
}

async function mintKey(home: string, id: string): Promise<string> {
  await grantKeyInitCommand({ engagement: id, homeDir: home });
  expect(process.exitCode).toBe(0);
  return (
    await readFile(path.join(home, ".hexagen", "keys", `${id}.key`), "utf-8")
  ).trim();
}

describe("grant issue, brownfield (no manifest)", () => {
  it("without slice.json and without --engagement exits 2 and writes no key into the repo", async () => {
    const root = await tmp("bf-root-");
    const home = await tmp("bf-home-");
    await issueGrantCommand({ ...base(root, home), paths: "src/" });
    expect(process.exitCode).toBe(2);
    expect(existsSync(path.join(root, ".hexagen"))).toBe(false);
    expect(existsSync(path.join(root, ".gitignore"))).toBe(false);
    expect((await readdir(root)).filter((n) => n !== ".git")).toEqual([]);
  });

  it("issues from the slice defaults, omits contexts, and the grant verifies", async () => {
    const root = await tmp("bf-root-");
    const home = await tmp("bf-home-");
    await writeSlice(root, "eng-1", ["src/", "docs/readme.md"]);
    const keyHex = await mintKey(home, "eng-1");
    out.length = 0;
    await issueGrantCommand({
      ...base(root, home),
      out: "grant.json",
    });
    expect(process.exitCode).toBe(0);
    const raw = await readFile(path.join(root, "grant.json"), "utf-8");
    const grant = JSON.parse(raw);
    expect("contexts" in grant).toBe(false);
    expect(grant.paths).toEqual(["src/", "docs/readme.md"]);
    const { signature, ...unsigned } = grant;
    const expected = createHmac("sha256", Buffer.from(keyHex, "hex"))
      .update(canonicalGrantPayload(unsigned))
      .digest("hex");
    expect(signature).toBe(expected);
    // never mints or edits .gitignore
    expect(existsSync(path.join(root, ".gitignore"))).toBe(false);
    expect(existsSync(path.join(root, ".hexagen", "grant-signing.key"))).toBe(
      false,
    );
    const text = out.join("\n");
    expect(text).toContain(root);
    expect(text).toContain(path.join(home, ".hexagen", "keys", "eng-1.key"));
    expect(text).not.toContain(keyHex);
  });

  it("a missing key exits 2 naming the path and `grant key init`", async () => {
    const root = await tmp("bf-root-");
    const home = await tmp("bf-home-");
    await writeSlice(root, "eng-2", ["src/"]);
    await issueGrantCommand(base(root, home));
    expect(process.exitCode).toBe(2);
    const text = out.join("\n");
    expect(text).toContain(path.join(home, ".hexagen", "keys", "eng-2.key"));
    expect(text).toContain("grant key init");
    expect(existsSync(path.join(root, ".hexagen", "grant-signing.key"))).toBe(
      false,
    );
  });

  it("--engagement works without a slice when --paths are valid", async () => {
    const root = await tmp("bf-root-");
    const home = await tmp("bf-home-");
    await mintKey(home, "eng-3");
    await issueGrantCommand({
      ...base(root, home),
      engagement: "eng-3",
      paths: "src/a.ts",
      out: "g.json",
    });
    expect(process.exitCode).toBe(0);
    expect(
      JSON.parse(await readFile(path.join(root, "g.json"), "utf-8")).paths,
    ).toEqual(["src/a.ts"]);
  });

  it("refuses --paths outside the slice, naming the entry", async () => {
    const root = await tmp("bf-root-");
    const home = await tmp("bf-home-");
    await writeSlice(root, "eng-4", ["src/"], ["src/gen/"]);
    await mintKey(home, "eng-4");
    for (const bad of ["lib/x.ts", "src/gen/y.ts"]) {
      out.length = 0;
      process.exitCode = 0;
      await issueGrantCommand({
        ...base(root, home),
        paths: `src/ok.ts,${bad}`,
      });
      expect(process.exitCode).toBe(2);
      expect(out.join("\n")).toContain(bad);
    }
  });

  it("refuses malformed --paths entries", async () => {
    const root = await tmp("bf-root-");
    const home = await tmp("bf-home-");
    await writeSlice(root, "eng-5", ["src/"]);
    await mintKey(home, "eng-5");
    for (const bad of ["../etc/passwd", "/abs", "src\\x", "src//x"]) {
      out.length = 0;
      process.exitCode = 0;
      await issueGrantCommand({ ...base(root, home), paths: bad });
      expect(process.exitCode).toBe(2);
      expect(out.join("\n")).toContain(bad);
    }
  });

  it("refuses an engagement id that could escape the key directory", async () => {
    const root = await tmp("bf-root-");
    const home = await tmp("bf-home-");
    await issueGrantCommand({
      ...base(root, home),
      engagement: "../evil",
      paths: "src/",
    });
    expect(process.exitCode).toBe(2);
  });

  it("warns, naming both paths and fingerprints, when --key-file differs from what the server would resolve", async () => {
    const root = await tmp("bf-root-");
    const home = await tmp("bf-home-");
    await writeSlice(root, "eng-6", ["src/"]);
    const serverKey = await mintKey(home, "eng-6");
    const otherKeyFile = path.join(home, "other.key");
    const otherKey = "c3".repeat(32);
    await writeFile(otherKeyFile, `${otherKey}\n`);
    await issueGrantCommand({
      ...base(root, home),
      keyFile: otherKeyFile,
      out: "g.json",
    });
    expect(process.exitCode).toBe(0);
    const text = out.join("\n");
    expect(text).toContain("grant key mismatch");
    expect(text).toContain(otherKeyFile);
    expect(text).toContain(path.join(home, ".hexagen", "keys", "eng-6.key"));
    expect(text).not.toContain(otherKey);
    expect(text).not.toContain(serverKey);
  });
});

describe("repo mode is unchanged", () => {
  it("with a manifest it still mints the in-repo key, gitignores it, and writes contexts", async () => {
    const root = await tmp("bf-repo-");
    const home = await tmp("bf-home-");
    await mkdir(path.join(root, ".architecture"), { recursive: true });
    await writeFile(
      path.join(root, ".architecture", "manifest.yaml"),
      "bounded_contexts:\n  - name: billing\n    type: core\n",
    );
    await issueGrantCommand({
      ...base(root, home),
      paths: ".architecture/,packages/billing/",
      out: "g.json",
    });
    expect(process.exitCode).toBe(0);
    expect(existsSync(path.join(root, ".hexagen", "grant-signing.key"))).toBe(
      true,
    );
    expect(await readFile(path.join(root, ".gitignore"), "utf-8")).toContain(
      ".hexagen/grant-signing.key",
    );
    const grant = JSON.parse(
      await readFile(path.join(root, "g.json"), "utf-8"),
    );
    expect(grant.contexts).toEqual(["billing"]);
  });
});
