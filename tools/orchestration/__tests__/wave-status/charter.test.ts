import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, test } from "vitest";

/**
 * The status server's charter: it starts nothing, kills nothing and merges
 * nothing, and it never executes a premise. A premise is arbitrary `sh` read
 * out of a plan file; the server may run only fixed commands with fixed
 * arguments. This is checked against the SOURCE, not by injecting a fake
 * executor: the server has no executor seam, so a stub nothing calls cannot
 * fail, and a real violation would shell out directly.
 *
 * The scan covers this lane's own sources — `src/wave-status/**` and
 * `src/bins/wave-status.ts` — and nothing under `src/internal/**`, which is
 * shared with every other bin and is not this lane's to restate.
 */
const PACKAGE_ROOT = resolve(import.meta.dirname, "../..");
const TOOL = "wave-status";

/** Where this lane's sources live, relative to the package root. */
const OWNED = ["src/wave-status", "src/bins/wave-status.ts"];

/** The only subprocesses the server may run, each with arguments the code builds. */
const ALLOWED_COMMANDS = ["pgrep", "gh", "git"];

/**
 * The only artifact module the tool may import from another tool's family: the
 * artifact's shape and path. `src/internal/artifact.ts` is this lane's import of
 * it, and that module must stay free of `child_process`.
 */
const ALLOWED_PLAN_VERIFY = ["src/internal/artifact.ts"];

const IMPORT =
  /\bfrom\s+["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
// A bare call, not a method: `pattern.exec(text)` is a RegExp, not a subprocess.
const SUBPROCESS =
  /(?<![.\w$])(execFile|execFileSync|spawn|spawnSync|exec|execSync|fork)\s*\(\s*([^,)]*)/g;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return name === "__tests__" ||
        name === "node_modules" ||
        name === "public"
        ? []
        : sourceFiles(path);
    }
    return /\.(ts|mts|js|mjs)$/.test(name) ? [path] : [];
  });
}

function ownedFiles(): string[] {
  return OWNED.flatMap((entry) => {
    const path = resolve(PACKAGE_ROOT, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return [path];
  });
}

function importsOf(file: string): string[] {
  return [...readFileSync(file, "utf8").matchAll(IMPORT)].map(
    (m) => m[1] ?? m[2],
  );
}

describe("the status server's charter", () => {
  const files = ownedFiles();

  test("the scan sees the tool's own sources", () => {
    const names = files.map((file) => relative(PACKAGE_ROOT, file));
    expect(names).toContain(join("src", "wave-status", "lib", "collect.ts"));
    expect(names).toContain(join("src", "wave-status", "server.ts"));
    expect(names).toContain(join("src", "wave-status", "cli.ts"));
    expect(names).toContain(join("src", "bins", "wave-status.ts"));
    // No legacy module: the backlog reader, the event reader and the event
    // writer's own types all live in the shared internals, so a copy here would
    // be a second answer to a question with one.
    expect(names).not.toContain(
      join("src", "wave-status", "lib", "backlog.ts"),
    );
    expect(names).not.toContain(join("src", "wave-status", "lib", "events.ts"));
    expect(names).not.toContain(join("src", "wave-status", "lib", "emit.ts"));
    expect(names).not.toContain(join("src", "wave-status", "lib", "types.ts"));
  });

  test("every subprocess it starts is a fixed, allowed command — never a shell", () => {
    const calls = files.flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(SUBPROCESS)].map((m) => ({
        file: relative(PACKAGE_ROOT, file),
        fn: m[1],
        command: m[2].trim(),
      })),
    );
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call, `${call.file}: ${call.fn}(${call.command}…)`).toMatchObject({
        command: expect.stringMatching(
          new RegExp(`^["'](${ALLOWED_COMMANDS.join("|")})["']$`),
        ),
      });
    }
  });

  test("from the artifact family it imports that one module, and it runs nothing", () => {
    const artifactImports = files
      .flatMap((file) => importsOf(file))
      .filter((spec) => /artifact\.js$/.test(spec));
    // Every specifier that names the artifact module resolves to the one file
    // this package owns, by export name and never by a re-implementation.
    for (const spec of artifactImports) {
      expect(spec).toMatch(/^(?:\.\.\/)+internal\/artifact\.js$/);
    }
    expect(artifactImports.length).toBeGreaterThan(0);
    for (const allowed of ALLOWED_PLAN_VERIFY) {
      const specs = importsOf(resolve(PACKAGE_ROOT, allowed));
      expect(
        specs.some((spec) => /child_process/.test(spec)),
        `${allowed} imports child_process`,
      ).toBe(false);
    }
  });

  test("the one plan-verify-shaped import is the shared artifact module, and nothing else", () => {
    // The source was allowed exactly one module from that family. Here the
    // family's modules are this package's own `src/internal/*`, so the rule is
    // the same one stated over the files that exist: the artifact module, and
    // no verifier.
    const imported = files.flatMap((file) =>
      importsOf(file).map((spec) => ({
        file: relative(PACKAGE_ROOT, file),
        spec,
      })),
    );
    const forbidden = imported.filter(({ spec }) =>
      /(verify|verifier|premise|executor)/.test(spec),
    );
    expect(forbidden).toEqual([]);
    expect(
      imported.filter(({ spec }) => /internal\/artifact\.js$/.test(spec))
        .length,
    ).toBeGreaterThan(0);
  });

  test("the page is served from the shared path constant, never from a literal", () => {
    // `WAVE_STATUS_PAGE` exists so the path is a value that is imported and
    // tested; a literal here would put the page somewhere the package's
    // `files` list does not publish, with nothing failing.
    const literalPagePath = files.filter((file) => {
      const text = readFileSync(file, "utf8");
      return /["'][^"']*public\/wave-status\/index\.html["']/.test(text);
    });
    expect(literalPagePath.map((f) => relative(PACKAGE_ROOT, f))).toEqual([]);
    const server = readFileSync(
      resolve(PACKAGE_ROOT, "src", "wave-status", "server.ts"),
      "utf8",
    );
    expect(server).toContain("waveStatusPageUrl(import.meta.url)");
    // And the call is in the server, not in a module under `lib/`, so the
    // bundled bin resolves it from its own location.
    const libs = files.filter((file) => file.includes(`${TOOL}/lib/`));
    for (const lib of libs) {
      expect(
        readFileSync(lib, "utf8"),
        relative(PACKAGE_ROOT, lib),
      ).not.toContain("waveStatusPageUrl");
    }
  });
});
