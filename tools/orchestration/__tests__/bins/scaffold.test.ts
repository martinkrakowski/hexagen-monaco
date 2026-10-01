import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import {
  accessSync,
  constants,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * The scaffold's contract (OW-D1, OW-D12, OW-D14).
 *
 * OW3a pins the sixteen OW-D14 bin names (PB4 adds a seventeenth) and their FINAL paths, and the other three
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

/**
 * Every bin and its pinned final path. This list is the contract; it does NOT
 * say which bins are still stubs. That is derived from each bin's own source
 * (below), so a sub-lane that replaces a stub needs no edit to this file.
 */
const EXPECTED: ReadonlyArray<{ name: string; path: string }> = [
  {
    name: "hexagen-orchestration-wave-event",
    path: "dist/bins/wave-event.js",
  },
  {
    name: "hexagen-orchestration-plan-verify",
    path: "dist/bins/plan-verify.js",
  },
  {
    name: "hexagen-orchestration-handoff-check",
    path: "dist/bins/handoff-check.js",
  },
  {
    name: "hexagen-orchestration-control-bytes",
    path: "dist/bins/control-bytes.js",
  },
  {
    name: "hexagen-orchestration-init",
    path: "dist/bins/init.js",
  },
  {
    name: "hexagen-orchestration-doctor",
    path: "dist/bins/doctor.js",
  },
  {
    name: "hexagen-orchestration-plan-review",
    path: "dist/bins/plan-review.js",
  },
  {
    name: "hexagen-orchestration-sweep",
    path: "dist/bins/sweep.js",
  },
  {
    name: "hexagen-orchestration-mutate",
    path: "dist/bins/mutate.js",
  },
  {
    name: "hexagen-orchestration-mutate-verify",
    path: "dist/bins/mutate-verify.js",
  },
  {
    name: "hexagen-orchestration-mutate-anchors",
    path: "dist/bins/mutate-anchors.js",
  },
  {
    name: "hexagen-orchestration-verify-manifests",
    path: "bin/verify-manifests",
  },
  {
    name: "hexagen-orchestration-merge-prs",
    path: "bin/merge-prs",
  },
  {
    name: "hexagen-orchestration-wave-status",
    path: "dist/bins/wave-status.js",
  },
  { name: "hexagen-orchestration-gate", path: "dist/bins/gate.js" },
  {
    name: "hexagen-orchestration-gate-lock",
    path: "bin/gate-lock",
  },
  {
    name: "hexagen-orchestration-fix-brief",
    path: "dist/bins/fix-brief.js",
  },
  {
    name: "hexagen-orchestration-brief-new",
    path: "dist/bins/brief-new.js",
  },
];

const SHELL_BINS = EXPECTED.filter((bin) => !bin.path.endsWith(".js")).map(
  (bin) => bin.name,
);

describe("the bin list (OW-D14)", () => {
  it(`declares exactly the ${EXPECTED.length} canonical bins, and no others`, () => {
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

  it("is at 0.2.0 and versions independently of the CLI (OW-D12)", () => {
    expect(manifest.version).toBe("0.2.0");
  });

  it("publishes dist and bin, which is where the two bin kinds live", () => {
    expect(manifest.files).toEqual(expect.arrayContaining(["dist", "bin"]));
  });

  // F19: wave-status (OW3c) serves tools/orchestration/public/wave-status/index.html.
  // `files` is owned by this package's scaffold and no later lane may edit
  // package.json, so the directory is published from day one.
  it("publishes public/, where wave-status's page will live", () => {
    expect(manifest.files).toContain("public");
  });

  // F18: mutate-anchors (OW3b) imports the TypeScript compiler API at run time.
  // tsup keeps third-party modules external, so a consumer without `typescript`
  // would fail to resolve it.
  // F24: OW3c's page tests import Window from happy-dom, and OW3c may not edit
  // package.json.
  it("declares happy-dom as a devDependency, at the reference project's range", () => {
    expect(manifest.devDependencies?.["happy-dom"]).toBe("^20.10.2");
  });

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

/** The line every stub carries, and the only thing that makes a bin one. */
const STUB_MARKER = "not yet ported";

/** Whether a bin's SOURCE is still the stub. */
function isStubSource(text: string): boolean {
  return text.includes(STUB_MARKER);
}

/** A bin's source file: the TypeScript behind a dist path, or the script itself. */
function sourceOf(path: string): string {
  const built = /^dist\/bins\/(.+)\.js$/.exec(path);
  return built ? `src/bins/${built[1]}.ts` : path;
}

const stubs = EXPECTED.filter((bin) =>
  isStubSource(readFileSync(resolve(PACKAGE_ROOT, sourceOf(bin.path)), "utf8")),
);

describe("the stubs", () => {
  it("the six OW3a bins are never stubs", () => {
    const names = stubs.map((bin) => bin.name);
    for (const done of [
      "wave-event",
      "plan-verify",
      "handoff-check",
      "control-bytes",
      "init",
      "doctor",
    ]) {
      expect(names).not.toContain(`hexagen-orchestration-${done}`);
    }
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

describe("the stub classifier", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0))
      rmSync(dir, { recursive: true, force: true });
  });

  it("treats a copy of a real bin as not a stub, and the same copy with the marker as one", () => {
    const real = readFileSync(
      resolve(PACKAGE_ROOT, "src/bins/doctor.ts"),
      "utf8",
    );
    const dir = mkdtempSync(join(tmpdir(), "orchestration-stub-"));
    dirs.push(dir);
    writeFileSync(join(dir, "real.ts"), real);
    writeFileSync(
      join(dir, "marked.ts"),
      `${real}\nconsole.error("hexagen-orchestration-doctor: not yet ported");\n`,
    );
    expect(isStubSource(readFileSync(join(dir, "real.ts"), "utf8"))).toBe(
      false,
    );
    expect(isStubSource(readFileSync(join(dir, "marked.ts"), "utf8"))).toBe(
      true,
    );
  });

  it("maps a dist path to its source and a shell bin to itself", () => {
    expect(sourceOf("dist/bins/gate.js")).toBe("src/bins/gate.ts");
    expect(sourceOf("bin/gate-lock")).toBe("bin/gate-lock");
  });
});
