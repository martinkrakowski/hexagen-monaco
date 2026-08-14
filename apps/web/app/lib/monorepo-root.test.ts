import { describe, it, afterEach } from "vitest";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findMonorepoRoot, MonorepoRootNotFoundError } from "./monorepo-root";

const created: string[] = [];

function makeRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "mrr-"));
  created.push(dir);
  return dir;
}

afterEach(() => {
  while (created.length) {
    rmSync(created.pop() as string, { recursive: true, force: true });
  }
});

describe("findMonorepoRoot", () => {
  it("locates a root far more than 10 directories above the start dir (no fixed depth cap)", () => {
    const root = makeRoot();
    mkdirSync(join(root, ".architecture"), { recursive: true });
    writeFileSync(join(root, ".architecture", "manifest.yaml"), "version: 1\n");

    // 15 nested levels — deeper than the old maxDepth=10 guard, which would
    // have thrown "Maximum search depth exceeded" here even though a valid
    // root exists above. The filesystem-root terminator is the real bound.
    const segments = Array.from({ length: 15 }, (_, i) => `l${i}`);
    const deep = join(root, ...segments);
    mkdirSync(deep, { recursive: true });

    assert.equal(findMonorepoRoot(deep), root);
  });

  it("returns the NEAREST ancestor when an outer manifest also exists (nearest wins)", () => {
    const root = makeRoot();
    mkdirSync(join(root, ".architecture"), { recursive: true });
    writeFileSync(join(root, ".architecture", "manifest.yaml"), "version: 1\n");

    // A second, NEARER manifest between root and start. The upward walk must stop
    // at this one — anchoring mutations at the outer root instead would target the
    // wrong directory. Both manifests must exist: with only the outer one, a
    // "walk to the outermost match" regression would still pass, so this is the
    // case that actually pins nearest-ancestor selection.
    const nearer = join(root, "apps");
    mkdirSync(join(nearer, ".architecture"), { recursive: true });
    writeFileSync(
      join(nearer, ".architecture", "manifest.yaml"),
      "version: 1\n",
    );

    const start = join(nearer, "web");
    mkdirSync(start, { recursive: true });

    assert.equal(findMonorepoRoot(start), nearer);
  });

  it("throws MonorepoRootNotFoundError when no manifest exists up to the filesystem root", () => {
    const root = makeRoot(); // deliberately no .architecture/ created
    const start = join(root, "apps", "web");
    mkdirSync(start, { recursive: true });

    assert.throws(
      () => findMonorepoRoot(start),
      (err: unknown) =>
        err instanceof MonorepoRootNotFoundError &&
        /No \.architecture\/manifest\.yaml found/.test((err as Error).message),
    );
  });
});
