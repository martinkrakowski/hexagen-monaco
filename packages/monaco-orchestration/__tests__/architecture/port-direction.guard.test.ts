import { describe, it, expect } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type {
  ApplySemanticPatchPort,
  ValidatePatchIntentPort,
  UndoLastPatchPort,
  ProjectCurrentBufferStatePort,
  TsMorphPort,
  MonacoPersistencePort,
} from "../../src/index";

/**
 * ADR-0048 guard — port direction is a structural invariant, not a habit.
 *
 * Decision 1 gives an operational rule: `ports/in` is *driving* (the use case
 * implements the port, a driver calls it); `ports/out` is *driven* (the use
 * case depends on the port, an infrastructure adapter implements it) — "if an
 * infrastructure adapter `implements` the interface, it is an outbound port and
 * belongs in `ports/out`."
 *
 * monaco-orchestration ships no infrastructure adapter yet, so the sibling
 * governance guard's single "adapter implements X" scan would find nothing here
 * and go green forever. This guard therefore mechanises both halves of the rule
 * against the two populations that do exist in this package:
 *
 *   1. **Dependency direction** — every port a use case takes by constructor
 *      injection is, by definition, driven, so its specifier must resolve into
 *      `application/ports/out/`.
 *   2. **Implementer direction** — every class that `implements` a
 *      package-local port contract (an infrastructure adapter when one lands;
 *      today the `__tests__/doubles/` fakes that stand in for one) must import
 *      that contract from `application/ports/out/`.
 *
 * Each half carries an anti-vacuity assertion. Without them, the guard passes
 * the moment its regex stops matching — a renamed constructor parameter or a
 * moved test-double folder would turn it into a green no-op, which is the exact
 * failure mode this remediation arc keeps finding.
 *
 * Each half also carries an anti-blind-spot assertion. A contract whose import
 * the parser cannot resolve gets an `undefined` specifier, and `undefined` is
 * filtered out before the direction check — so an unparsed import form is
 * indistinguishable from a correctly filed port. The parser therefore
 * understands named, default and namespace imports, and anything it still
 * cannot tie to a module fails loudly rather than being skipped.
 *
 * It is deliberately source-text based rather than type-based: `ports/in` and
 * `ports/out` type-check identically, so `tsc` can never catch this defect
 * class.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(HERE, "..", "..");
const SRC_ROOT = path.join(PACKAGE_ROOT, "src");
const USE_CASES_ROOT = path.join(SRC_ROOT, "application", "use-cases");
const PORTS_ROOT = path.join(SRC_ROOT, "application", "ports");
/** Path segment every driven-port specifier must contain, relative or not. */
const OUTBOUND_SEGMENT = "/ports/out/";

/**
 * Populations that stand in for "infrastructure" in this package: the real
 * adapter folder (empty today, scaffolded by sync) and the test doubles that
 * substitute for adapters until one exists.
 */
const IMPLEMENTER_ROOTS = [
  path.join(SRC_ROOT, "infrastructure"),
  path.join(PACKAGE_ROOT, "__tests__", "doubles"),
];

/**
 * Compile-time half of the guard: the public surface still resolves every port
 * this package owns. A move that silently dropped one from the barrels would
 * fail `typecheck:test` here rather than at some downstream consumer.
 */
export type PublicSurfaceProbe = [
  ApplySemanticPatchPort,
  ValidatePatchIntentPort,
  UndoLastPatchPort,
  ProjectCurrentBufferStatePort,
  TsMorphPort,
  MonacoPersistencePort,
];

/** `Expect<false>` is a compile error, so this asserts rather than narrows. */
type Expect<T extends true> = T;
export type PortsResolveFromPublicSurface = Expect<
  PublicSurfaceProbe["length"] extends 6 ? true : false
>;

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

/**
 * One `import … from "specifier"` statement. `[^"';]` in the clause keeps a
 * match inside a single statement even in source that omits semicolons.
 */
const IMPORT_PATTERN =
  /import\s+(?:type\s+)?([^"';]*?)\s*from\s*["']([^"']+)["']/g;

/**
 * Local names an import clause binds, across all three forms TypeScript allows
 * for a contract: named (`{ X }`, `{ type X }`, `{ X as Y }`), default (`X`)
 * and namespace (`* as NS`).
 */
function importedBindings(clause: string): string[] {
  const bindings: string[] = [];

  for (const braced of clause.matchAll(/\{([^}]*)\}/g)) {
    for (const raw of braced[1].split(",")) {
      const name = raw
        .trim()
        .replace(/^type\s+/, "")
        .split(/\s+as\s+/)
        .pop()
        ?.trim();
      if (name) bindings.push(name);
    }
  }

  // Whatever sits outside the braces is a default binding, a namespace
  // binding, or both (`import Default, * as NS from "…"`).
  const outside = clause.replace(/\{[^}]*\}/g, " ");
  for (const namespaced of outside.matchAll(/\*\s+as\s+([A-Za-z_$][\w$]*)/g)) {
    bindings.push(namespaced[1]);
  }
  for (const candidate of outside
    .replace(/\*\s+as\s+[A-Za-z_$][\w$]*/g, " ")
    .split(",")) {
    const name = candidate.trim();
    if (/^[A-Za-z_$][\w$]*$/.test(name)) bindings.push(name);
  }

  return bindings;
}

/**
 * Module specifier the given symbol was imported from, in this source text.
 *
 * A parser that understood only named imports would return `undefined` for a
 * contract reached through `import * as NS` or a default import, and an
 * `undefined` specifier is dropped by `isPackageLocal` *before* the direction
 * check — so a misfiled driven port would sail through green. Namespace
 * members (`NS.SomePort`) therefore resolve through their namespace binding.
 */
function findImportSpecifier(
  source: string,
  symbol: string,
): string | undefined {
  const binding = symbol.split(".")[0];

  for (const match of source.matchAll(IMPORT_PATTERN)) {
    if (importedBindings(match[1]).includes(binding)) return match[2];
  }
  return undefined;
}

/**
 * The contract is declared in the very file that references it, so it has no
 * import to resolve. This is the only legitimate reason for a missing
 * specifier; every other one is a parser blind spot and must fail loudly.
 */
function declaresLocally(source: string, symbol: string): boolean {
  if (symbol.includes(".")) return false; // a namespace member is never local
  return new RegExp(`\\b(?:interface|type|class)\\s+${symbol}\\b`).test(source);
}

interface PortReference {
  /** File the reference was found in, relative to the package root. */
  readonly file: string;
  /** Port interface name. */
  readonly contract: string;
  /** Specifier it was imported from, if any. */
  readonly specifier: string | undefined;
  /** The contract is declared in this same file, so there is no import. */
  readonly declaredLocally: boolean;
}

/**
 * `constructor(private readonly port: SomePort, other: NS.Thing)` →
 * ["SomePort", "NS.Thing"]. Qualified names are kept whole so a
 * namespace-imported port is still recognised as a port.
 */
function extractConstructorParameterTypes(source: string): string[] {
  const types: string[] = [];
  for (const match of source.matchAll(/\bconstructor\s*\(([^)]*)\)/g)) {
    for (const param of match[1].split(",")) {
      const annotated = /:\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)/.exec(
        param,
      );
      if (annotated) types.push(annotated[1]);
    }
  }
  return types;
}

/**
 * References the parser could not tie to a module. `isPackageLocal` filters
 * `undefined` specifiers out before the direction check, so anything landing
 * here would be checked by nothing at all.
 */
const unresolvedReferences = (refs: readonly PortReference[]): string[] =>
  refs
    .filter(({ specifier, declaredLocally }) => !specifier && !declaredLocally)
    .map(({ file, contract }) => `${file}: ${contract}`);

const UNRESOLVED_MESSAGE =
  "every port contract must resolve to the module it came from — an " +
  "unresolvable specifier is dropped before the direction check, which is " +
  "exactly how a misfiled port goes green";

/** `class Fake implements SomePort` → ["SomePort"]. */
function extractImplementedContracts(source: string): string[] {
  const contracts: string[] = [];
  for (const match of source.matchAll(
    /\bclass\s+\w+[^{]*?\bimplements\s+([^{]+)\{/g,
  )) {
    for (const name of match[1].split(",")) {
      const cleaned = name.trim().replace(/<.*$/, "");
      if (cleaned.length > 0) contracts.push(cleaned);
    }
  }
  return contracts;
}

/** `SomePort` and `NS.SomePort` alike; the namespace prefix is not the name. */
const isPortName = (name: string): boolean =>
  (name.split(".").pop() ?? "").endsWith("Port");
const isPackageLocal = (specifier: string | undefined): boolean =>
  specifier !== undefined && specifier.startsWith(".");

describe("ADR-0048 port direction (monaco-orchestration)", () => {
  it("injects every use-case port from application/ports/out", async () => {
    const files = await collectTypeScriptFiles(USE_CASES_ROOT);
    const injected: PortReference[] = [];

    for (const file of files) {
      const source = await readFile(file, "utf8");
      for (const contract of extractConstructorParameterTypes(source)) {
        if (!isPortName(contract)) continue;
        injected.push({
          file: path.relative(PACKAGE_ROOT, file),
          contract,
          specifier: findImportSpecifier(source, contract),
          declaredLocally: declaresLocally(source, contract),
        });
      }
    }

    // Anti-vacuity. Without this, renaming a constructor parameter or moving
    // the use-case folder turns the assertions below into a green no-op.
    expect(
      injected.length,
      "expected at least one constructor-injected *Port under " +
        "src/application/use-cases — a guard that checks nothing is worse " +
        "than no guard",
    ).toBeGreaterThan(0);

    expect(unresolvedReferences(injected), UNRESOLVED_MESSAGE).toEqual([]);

    const local = injected.filter(({ specifier }) => isPackageLocal(specifier));
    expect(
      local.length,
      "expected at least one package-local injected port specifier",
    ).toBeGreaterThan(0);

    const misfiled = local
      .filter(({ specifier }) => !specifier?.includes(OUTBOUND_SEGMENT))
      .map(
        ({ file, contract, specifier }) =>
          `${file}: ${contract} <- ${specifier}`,
      );

    expect(
      misfiled,
      "a use case depends on this port, so per ADR-0048 it is driven and " +
        "belongs in application/ports/out",
    ).toEqual([]);
  });

  it("imports every implemented port contract from application/ports/out", async () => {
    const implemented: PortReference[] = [];

    for (const root of IMPLEMENTER_ROOTS) {
      for (const file of await collectTypeScriptFiles(root)) {
        const source = await readFile(file, "utf8");
        for (const contract of extractImplementedContracts(source)) {
          if (!isPortName(contract)) continue;
          implemented.push({
            file: path.relative(PACKAGE_ROOT, file),
            contract,
            specifier: findImportSpecifier(source, contract),
            declaredLocally: declaresLocally(source, contract),
          });
        }
      }
    }

    // Anti-vacuity: the fakes under __tests__/doubles are what stands in for an
    // infrastructure adapter here. If none of them declares `implements`
    // any more, this check has stopped checking and must fail loudly.
    expect(
      implemented.length,
      "expected at least one class implementing a *Port under " +
        IMPLEMENTER_ROOTS.map((r) => path.relative(PACKAGE_ROOT, r)).join(
          " or ",
        ) +
        " — a guard that checks nothing is worse than no guard",
    ).toBeGreaterThan(0);

    expect(unresolvedReferences(implemented), UNRESOLVED_MESSAGE).toEqual([]);

    const local = implemented.filter(({ specifier }) =>
      isPackageLocal(specifier),
    );
    expect(
      local.length,
      "expected at least one package-local implemented port specifier",
    ).toBeGreaterThan(0);

    const misfiled = local
      .filter(({ specifier }) => !specifier?.includes(OUTBOUND_SEGMENT))
      .map(
        ({ file, contract, specifier }) =>
          `${file}: ${contract} <- ${specifier}`,
      );

    expect(
      misfiled,
      "this contract is implemented by an adapter (or the double standing in " +
        "for one), so per ADR-0048 it is driven and belongs in " +
        "application/ports/out",
    ).toEqual([]);
  });

  it("keeps ports/in free of contracts no use case implements", async () => {
    const inboundFiles = await collectTypeScriptFiles(
      path.join(PORTS_ROOT, "in"),
    );
    const outboundFiles = await collectTypeScriptFiles(
      path.join(PORTS_ROOT, "out"),
    );

    // Anti-vacuity: this package must still own ports somewhere, or the
    // directory scan has silently lost its subject.
    expect(
      outboundFiles.filter((f) => f.endsWith(".port.ts")).length,
      "expected application/ports/out to contain port files",
    ).toBeGreaterThan(0);

    const useCaseSources = await Promise.all(
      (await collectTypeScriptFiles(USE_CASES_ROOT)).map((f) =>
        readFile(f, "utf8"),
      ),
    );
    const implementedByUseCases = new Set(
      useCaseSources.flatMap(extractImplementedContracts),
    );

    const unearned: string[] = [];
    for (const file of inboundFiles) {
      if (!file.endsWith(".port.ts")) continue;
      const source = await readFile(file, "utf8");
      for (const match of source.matchAll(
        /export\s+interface\s+([A-Za-z_$][\w$]*)/g,
      )) {
        if (!implementedByUseCases.has(match[1])) {
          unearned.push(`${path.relative(PACKAGE_ROOT, file)}: ${match[1]}`);
        }
      }
    }

    expect(
      unearned,
      "a contract under application/ports/in is inbound only if a use case " +
        "implements it (ADR-0048 Decision 1); otherwise it is driven and " +
        "belongs in application/ports/out",
    ).toEqual([]);
  });
});
