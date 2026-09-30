import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { accessSync, constants, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The scaffold's contract (OW-D1, OW-D12, OW-D14).
 *
 * OW3a pins all sixteen bin names and their FINAL paths, and the other three
 * sub-lanes each overwrite exactly one stub. That only stays true if the list is
 * complete, prefixed, and points at files this build actually produces — so this
 * test reads the real `package.json`, the real built `dist/`, and really runs
 * every stub, rather than restating the list in a fixture.
 */

const PACKAGE_ROOT = resolve(import.meta.dirname, "../..");
const manifest = JSON.parse(
  readFileSync(resolve(PACKAGE_ROOT, "package.json"), "utf8"),
) as {
  bin: Record<string, string>;
  version: string;
  files: string[];
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

/** Every bin, and which sub-lane implements it. */
const EXPECTED: ReadonlyArray<{ name: string; path: string; stub: boolean }> = [
  {
    name: "hexagen-orchestration-wave-event",
    path: "dist/bins/wave-event.js",
    stub: false,
  },
  {
    name: "hexagen-orchestration-plan-verify",
    path: "dist/bins/plan-verify.js",
    stub: false,
  },
  {
    name: "hexagen-orchestration-handoff-check",
    path: "dist/bins/handoff-check.js",
    stub: false,
  },
  {
    name: "hexagen-orchestration-control-bytes",
    path: "dist/bins/control-bytes.js",
    stub: false,
  },
  {
    name: "hexagen-orchestration-init",
    path: "dist/bins/init.js",
    stub: false,
  },
  {
    name: "hexagen-orchestration-doctor",
    path: "dist/bins/doctor.js",
    stub: false,
  },
  {
    name: "hexagen-orchestration-plan-review",
    path: "dist/bins/plan-review.js",
    stub: true,
  },
  {
    name: "hexagen-orchestration-sweep",
    path: "dist/bins/sweep.js",
    stub: true,
  },
  {
    name: "hexagen-orchestration-mutate",
    path: "dist/bins/mutate.js",
    stub: true,
  },
  {
    name: "hexagen-orchestration-mutate-verify",
    path: "dist/bins/mutate-verify.js",
    stub: true,
  },
  {
    name: "hexagen-orchestration-mutate-anchors",
    path: "dist/bins/mutate-anchors.js",
    stub: true,
  },
  {
    name: "hexagen-orchestration-verify-manifests",
    path: "bin/verify-manifests",
    stub: true,
  },
  {
    name: "hexagen-orchestration-merge-prs",
    path: "bin/merge-prs",
    stub: true,
  },
  {
    name: "hexagen-orchestration-wave-status",
    path: "dist/bins/wave-status.js",
    stub: true,
  },
  { name: "hexagen-orchestration-gate", path: "dist/bins/gate.js", stub: true },
  {
    name: "hexagen-orchestration-gate-lock",
    path: "bin/gate-lock",
    stub: true,
  },
];

const SHELL_BINS = EXPECTED.filter((bin) => !bin.path.endsWith(".js")).map(
  (bin) => bin.name,
);

describe("the bin list (OW-D14)", () => {
  it("declares exactly the sixteen canonical bins, and no others", () => {
    expect(Object.keys(manifest.bin).sort()).toEqual(
      EXPECTED.map((bin) => bin.name).sort(),
    );
  });

  it("binds each bin to its pinned final path", () => {
    for (const bin of EXPECTED) {
      expect(manifest.bin[bin.name], bin.name).toBe(bin.path);
    }
  });

  it("prefixes every bin, so none can collide in a consumer's node_modules/.bin", () => {
    for (const name of Object.keys(manifest.bin)) {
      expect(name, name).toMatch(/^hexagen-orchestration-/);
    }
  });

  it("starts at 0.1.0 and versions independently of the CLI (OW-D12)", () => {
    expect(manifest.version).toBe("0.1.0");
  });

  it("publishes dist and bin, which is where the two bin kinds live", () => {
    expect(manifest.files).toEqual(["dist", "bin"]);
  });

  // F18: mutate-anchors (OW3b) imports the TypeScript compiler API at run time.
  // tsup keeps third-party modules external, so a consumer without `typescript`
  // would fail to resolve it.
  it("declares typescript as a RUNTIME dependency, at the range the repo uses", () => {
    expect(manifest.dependencies?.typescript).toBe(
      manifest.devDependencies?.typescript,
    );
    expect(manifest.dependencies?.typescript).toBe("^5.4.5");
  });
});

describe("the built artifacts", () => {
  it.each(EXPECTED)("$name exists on disk", ({ path }) => {
    expect(() => accessSync(resolve(PACKAGE_ROOT, path))).not.toThrow();
  });

  it.each(SHELL_BINS)("%s is executable in the working tree", (name) => {
    const path = resolve(PACKAGE_ROOT, manifest.bin[name]);
    expect(() => accessSync(path, constants.X_OK), path).not.toThrow();
  });
});

describe("the ten stubs", () => {
  const stubs = EXPECTED.filter((bin) => bin.stub);

  it("are exactly ten", () => {
    expect(stubs).toHaveLength(10);
  });

  // `spawnSync`, not `execFileSync`: a stub that wrongly exits 0 is exactly the
  // defect under test, and `execFileSync` cannot report an exit code it treated
  // as an error without unwrapping the throw.
  it.each(stubs.map((bin) => [bin.name, bin.path] as const))(
    "%s exits 2 and names itself",
    (name, path) => {
      const result = spawnSync(resolve(PACKAGE_ROOT, path), [], {
        encoding: "utf8",
      });

      expect(result.status, `${name} exit code`).toBe(2);
      expect(result.stderr, `${name} stderr`).toBe(`${name}: not yet ported\n`);
      expect(result.stdout, `${name} stdout`).toBe("");
    },
  );
});
