import { describe, it, expect } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * ADR-0048 guard — port direction is a structural invariant, not a habit.
 *
 * ADR-0048 Decision 1 states the convention operationally:
 *
 *   `ports/in`  = driving/inbound — **the use case implements the port**, a
 *                 driver (UI route, CLI, MCP handler) depends on it.
 *   `ports/out` = driven/outbound — **the use case depends on the port**, an
 *                 infrastructure adapter implements it. Rule of thumb: if an
 *                 infrastructure adapter `implements` the interface, it is an
 *                 outbound port and belongs in `ports/out`.
 *
 * This guard is deliberately **source-text based rather than type-based**.
 * `ports/in` and `ports/out` type-check identically — a driven port filed under
 * `ports/in` produces no diagnostic from `tsc`, ever — so a compile-time check
 * of this class cannot exist. Reading the source is the only mechanism that can
 * see the defect.
 *
 * Each test carries an **anti-vacuity** assertion. Both scans are regex-based
 * over source text; if a naming or formatting convention drifts far enough that
 * a scan matches nothing, the direction assertions below would pass over an
 * empty list and report confidence they have not earned. The anti-vacuity
 * assertions turn that silent degradation into a failure.
 */

const PACKAGE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const SRC_ROOT = path.join(PACKAGE_ROOT, "src");
const PORTS_IN_DIR = path.join(SRC_ROOT, "application", "ports", "in");
const USE_CASES_DIR = path.join(SRC_ROOT, "application", "use-cases");
const INFRASTRUCTURE_DIR = path.join(SRC_ROOT, "infrastructure");

async function collectTypeScriptFiles(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const found: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await collectTypeScriptFiles(full)));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      found.push(full);
    }
  }
  return found;
}

async function readSources(
  dir: string,
): Promise<Array<{ relativePath: string; source: string }>> {
  const files = await collectTypeScriptFiles(dir);
  return Promise.all(
    files.map(async (file) => ({
      relativePath: path.relative(SRC_ROOT, file),
      source: await readFile(file, "utf8"),
    })),
  );
}

/**
 * Every `*Port` symbol a `ports/in` file puts on the package surface, whether
 * it declares the interface itself or re-exports one from elsewhere. Both forms
 * exist in this package's history, and a re-export shim is exactly as much of a
 * direction claim as a declaration is.
 */
function extractExportedPortNames(source: string): string[] {
  const names = new Set<string>();

  for (const match of source.matchAll(
    /export\s+(?:declare\s+)?interface\s+(\w+)/g,
  )) {
    names.add(match[1]);
  }

  for (const match of source.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g)) {
    for (const raw of match[1].split(",")) {
      const exported = raw
        .trim()
        .split(/\s+as\s+/)
        .pop()
        ?.trim();
      if (exported) names.add(exported);
    }
  }

  return [...names].filter((name) => name.endsWith("Port"));
}

/** Interface names appearing in a `class X ... implements A, B {` clause. */
function extractImplementedContracts(source: string): string[] {
  const contracts: string[] = [];
  for (const match of source.matchAll(
    /\bclass\s+\w+[^{]*?\bimplements\s+([^{]+)\{/g,
  )) {
    for (const raw of match[1].split(",")) {
      const name = raw.trim().replace(/<.*$/, "");
      if (name) contracts.push(name);
    }
  }
  return contracts;
}

/** The module specifier a given symbol was imported from in this file. */
function findImportSpecifier(
  source: string,
  symbol: string,
): string | undefined {
  for (const match of source.matchAll(
    /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g,
  )) {
    const imported = match[1]
      .split(",")
      .map((name) =>
        name
          .trim()
          .replace(/^type\s+/, "")
          .split(/\s+as\s+/)
          .pop()
          ?.trim(),
      )
      .filter((name): name is string => Boolean(name));
    if (imported.includes(symbol)) return match[2];
  }
  return undefined;
}

/** Constructor parameter types ending in `Port` — the injected dependencies. */
function extractConstructorInjectedPorts(source: string): string[] {
  const injected = new Set<string>();
  for (const match of source.matchAll(/\bconstructor\s*\(([^)]*)\)/g)) {
    for (const param of match[1].split(",")) {
      const typed = /:\s*([A-Za-z_$][\w$]*Port)\b/.exec(param);
      if (typed) injected.add(typed[1]);
    }
  }
  return [...injected];
}

/**
 * `ports/in` / `ports/out` as a path segment.
 * File specifiers (`../ports/out/foo.port`) and directory barrels (`../ports/out`)
 * are both legal; a trailing-slash substring misses the barrel. Near-misses
 * like `ports/outgoing` must not match.
 */
function isPortDirectionSpecifier(
  specifier: string,
  direction: "in" | "out",
): boolean {
  const pattern =
    direction === "in" ? /(^|\/)ports\/in(\/|$)/ : /(^|\/)ports\/out(\/|$)/;
  return pattern.test(specifier);
}

describe("ADR-0048 port direction (project-configuration)", () => {
  it("has a use case implementing every port exported from application/ports/in", async () => {
    const portFiles = (await readSources(PORTS_IN_DIR)).filter(
      ({ relativePath }) => path.basename(relativePath) !== "index.ts",
    );

    const inboundPorts = portFiles.flatMap(({ relativePath, source }) =>
      extractExportedPortNames(source).map((port) => ({
        port,
        declaredIn: relativePath,
      })),
    );

    const useCaseSources = await readSources(USE_CASES_DIR);
    const implementedByUseCases = new Set(
      useCaseSources.flatMap(({ source }) =>
        extractImplementedContracts(source),
      ),
    );

    // Anti-vacuity, both sides. If either scan silently matched nothing the
    // subset assertion below would hold trivially and stay green forever.
    expect(
      inboundPorts.length,
      "expected application/ports/in to export at least one *Port symbol — " +
        "a guard that checks nothing is worse than no guard",
    ).toBeGreaterThan(0);
    expect(
      implementedByUseCases.size,
      "expected at least one `implements` clause under application/use-cases — " +
        "if this scan matches nothing, the check below passes vacuously",
    ).toBeGreaterThan(0);

    const unimplemented = inboundPorts.filter(
      ({ port }) => !implementedByUseCases.has(port),
    );

    expect(
      unimplemented.map(({ port, declaredIn }) => `${port} (${declaredIn})`),
      "ADR-0048: a port under application/ports/in is inbound, meaning a use " +
        "case implements it. No use case implements these, so they are driven " +
        "ports and belong under application/ports/out",
    ).toEqual([]);
  });

  it("resolves every driven contract through application/ports/out", async () => {
    const adapterSources = await readSources(INFRASTRUCTURE_DIR);
    const useCaseSources = await readSources(USE_CASES_DIR);

    // Driven by implementation: an infrastructure adapter implements it.
    const implemented = adapterSources.flatMap(({ relativePath, source }) =>
      extractImplementedContracts(source).map((contract) => ({
        site: relativePath,
        contract,
        specifier: findImportSpecifier(source, contract),
        reason: "an infrastructure adapter implements it",
      })),
    );

    // Driven by dependency: a use case takes it as a constructor dependency.
    const injected = useCaseSources.flatMap(({ relativePath, source }) =>
      extractConstructorInjectedPorts(source).map((contract) => ({
        site: relativePath,
        contract,
        specifier: findImportSpecifier(source, contract),
        reason: "a use case depends on it as a constructor parameter",
      })),
    );

    // Anti-vacuity, both scans.
    expect(
      implemented.length,
      "expected at least one `implements` pair under src/infrastructure",
    ).toBeGreaterThan(0);
    expect(
      injected.length,
      "expected at least one constructor-injected *Port under " +
        "application/use-cases — this arm is what catches a driven port that " +
        "no adapter in this package implements yet",
    ).toBeGreaterThan(0);

    const driven = [...implemented, ...injected];

    // A contract the resolver cannot classify must not pass silently.
    // Default / namespace / same-file symbols return undefined today.
    const unresolved = driven.filter(
      ({ specifier }) => specifier === undefined,
    );
    expect(
      unresolved.map(({ site, contract }) => `${site}: ${contract}`),
      "port-direction guard could not resolve an import specifier for these " +
        "driven contracts, so their direction was never checked",
    ).toEqual([]);

    const misfiled = driven.filter(
      ({ specifier }) =>
        specifier !== undefined && isPortDirectionSpecifier(specifier, "in"),
    );
    expect(
      misfiled.map(
        ({ site, contract, specifier, reason }) =>
          `${site}: ${contract} from ${specifier} — ${reason}`,
      ),
      "ADR-0048: driven contracts belong under application/ports/out",
    ).toEqual([]);

    // Contracts imported from another package (e.g. @hexagen/shared) are out of
    // scope for this package's own directory convention; relative specifiers
    // are this package's own files and must land in ports/out.
    const packageLocal = driven.filter(({ specifier }) =>
      specifier?.startsWith("."),
    );
    expect(
      packageLocal.length,
      "expected at least one package-local driven contract",
    ).toBeGreaterThan(0);

    for (const { site, contract, specifier, reason } of packageLocal) {
      expect(
        specifier !== undefined && isPortDirectionSpecifier(specifier, "out"),
        `${site}: ${contract} is driven (${reason}); ADR-0048 files driven ports under application/ports/out`,
      ).toBe(true);
    }
  });
});

describe("findImportSpecifier", () => {
  it("resolves import type { X } and import { type X }", () => {
    expect(
      findImportSpecifier(
        `import type { LoggerPort } from "@hexagen/shared";`,
        "LoggerPort",
      ),
    ).toBe("@hexagen/shared");
    expect(
      findImportSpecifier(
        `import { type LoggerPort } from "@hexagen/shared";`,
        "LoggerPort",
      ),
    ).toBe("@hexagen/shared");
    expect(
      findImportSpecifier(
        `import {\n  LogLevel,\n  type LoggerPort,\n} from "@hexagen/shared";`,
        "LoggerPort",
      ),
    ).toBe("@hexagen/shared");
  });

  it("returns undefined for default, namespace, and same-file symbols", () => {
    expect(
      findImportSpecifier(`import LoggerPort from "./logger";`, "LoggerPort"),
    ).toBeUndefined();
    expect(
      findImportSpecifier(`import * as ports from "./ports";`, "LoggerPort"),
    ).toBeUndefined();
    expect(
      findImportSpecifier(
        `interface LoggerPort {}\nclass A implements LoggerPort {}`,
        "LoggerPort",
      ),
    ).toBeUndefined();
  });
});

describe("isPortDirectionSpecifier", () => {
  it("matches a file specifier that contains /ports/<dir>/", () => {
    expect(
      isPortDirectionSpecifier("../ports/out/generate-project.port", "out"),
    ).toBe(true);
    expect(
      isPortDirectionSpecifier("../ports/in/validate-spec.port", "in"),
    ).toBe(true);
    expect(
      isPortDirectionSpecifier(
        "../../application/ports/out/telemetry.port",
        "out",
      ),
    ).toBe(true);
  });

  it("matches a directory barrel with no trailing slash", () => {
    expect(isPortDirectionSpecifier("../ports/out", "out")).toBe(true);
    expect(isPortDirectionSpecifier("../ports/in", "in")).toBe(true);
    expect(isPortDirectionSpecifier("./ports/out", "out")).toBe(true);
  });

  it("does not match a near-miss segment such as ports/outgoing", () => {
    expect(isPortDirectionSpecifier("../ports/outgoing/foo.port", "out")).toBe(
      false,
    );
    expect(isPortDirectionSpecifier("../ports/input/foo.port", "in")).toBe(
      false,
    );
    expect(isPortDirectionSpecifier("../ports/in-memory/logger", "in")).toBe(
      false,
    );
  });

  it("does not treat the opposite direction as a match", () => {
    expect(isPortDirectionSpecifier("../ports/in", "out")).toBe(false);
    expect(isPortDirectionSpecifier("../ports/out", "in")).toBe(false);
    expect(
      isPortDirectionSpecifier("../ports/in/validate-spec.port", "out"),
    ).toBe(false);
  });
});
