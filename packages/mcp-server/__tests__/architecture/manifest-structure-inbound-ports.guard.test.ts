import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * HEX-019 / ADR-0048 guard — the manifest-structure tool family binds to
 * inbound ports, not to concrete use-case classes.
 *
 * ADR-0048 Decision 3 requires mcp-server handlers to depend on inbound port
 * interfaces, and Decision 1 gives the operational test for direction: an
 * inbound port is the one *the use case implements* and a driver calls.
 * This guard mechanises both ends of that sentence for the seven tools of
 * remediation item 6.5(a):
 *
 *   1. **Implementer direction** — each manifest-structure use case must
 *      `implements` a contract whose import resolves under
 *      `application/ports/in/`. A use case that implements nothing, or that
 *      implements something filed under `ports/out/`, is not inbound.
 *   2. **Driver direction** — every field of `ManifestStructureToolDependencies`
 *      (the bag the tool adapters receive) must be typed on a contract imported
 *      from `application/ports/in/`, never from a `*.use-case.js` module.
 *
 * Both halves carry an anti-vacuity assertion: the scan must first find the
 * expected non-zero population, or a drifted regex would turn the guard into a
 * green no-op over an empty set — the failure mode this arc keeps finding.
 * Both halves also fail loudly when a contract name cannot be tied to an import
 * statement, rather than silently skipping it: an unparsed import form must not
 * be indistinguishable from a correctly filed port.
 *
 * It is source-text based on purpose. `ports/in` and `ports/out` type-check
 * identically, so `tsc` cannot catch a misfiled contract. The complementary
 * compile-time half of this guard lives in production code, in
 * `src/infrastructure/adapters/mcp-server.types.ts`
 * (`ManifestStructureDepsAreInboundPorts`), because this package has no
 * `typecheck:test` script — nothing type-checks `__tests__/` at all.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(HERE, "..", "..");
const SRC_ROOT = path.join(PACKAGE_ROOT, "src");
const USE_CASES_ROOT = path.join(SRC_ROOT, "application", "use-cases");
const DEPS_FILE = path.join(
  SRC_ROOT,
  "infrastructure",
  "adapters",
  "mcp-server.types.ts",
);

/** Path segment every inbound-port specifier must contain, relative or not. */
const INBOUND_SEGMENT = "/ports/in/";

/** The seven tools of remediation item 6.5(a), by use-case module basename. */
const MANIFEST_STRUCTURE_USE_CASE_MODULES = [
  "create-context-tool.use-case.ts",
  "create-port-tool.use-case.ts",
  "create-adapter-tool.use-case.ts",
  "remove-context-tool.use-case.ts",
  "remove-port-tool.use-case.ts",
  "add-dependency-tool.use-case.ts",
  "diff-manifest-tool.use-case.ts",
] as const;

const DEPENDENCIES_INTERFACE = "ManifestStructureToolDependencies";

/**
 * One `import … from "specifier"` statement. `[^"';]` in the clause keeps a
 * match inside a single statement even in source that omits semicolons.
 */
const IMPORT_PATTERN =
  /import\s+(?:type\s+)?([^"';]*?)\s*from\s*["']([^"']+)["']/g;

/**
 * Local names an import clause binds, across every form TypeScript allows:
 * `{ A, B as C }`, `Default`, `Default, { A }`, `* as NS`, each optionally
 * prefixed by `type`. A form this cannot read yields no names, which is what
 * the "resolves to a module" assertions below turn into a failure.
 */
function localNamesOf(clause: string): string[] {
  const names: string[] = [];
  const braced = /\{([^}]*)\}/.exec(clause);
  if (braced) {
    for (const raw of braced[1].split(",")) {
      const piece = raw.replace(/^\s*type\s+/, "").trim();
      if (!piece) continue;
      const aliased = /\bas\s+([A-Za-z0-9_$]+)$/.exec(piece);
      names.push(aliased ? aliased[1] : piece);
    }
  }

  const outsideBraces = clause.replace(/\{[^}]*\}/g, "").trim();
  for (const raw of outsideBraces.split(",")) {
    const piece = raw.replace(/^\s*type\s+/, "").trim();
    if (!piece) continue;
    const namespaced = /^\*\s+as\s+([A-Za-z0-9_$]+)$/.exec(piece);
    if (namespaced) {
      names.push(namespaced[1]);
      continue;
    }
    if (/^[A-Za-z0-9_$]+$/.test(piece)) names.push(piece);
  }

  return names;
}

/** Local name → module specifier, for every import in one source file. */
function importMapOf(source: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const match of source.matchAll(IMPORT_PATTERN)) {
    const [, clause, specifier] = match;
    for (const name of localNamesOf(clause)) map.set(name, specifier);
  }
  return map;
}

/** Every contract named in an `implements` clause in one source file. */
function implementedContractsOf(source: string): string[] {
  const contracts: string[] = [];
  for (const match of source.matchAll(
    /\bclass\s+[A-Za-z0-9_$]+\s+implements\s+([^{]+)\{/g,
  )) {
    for (const raw of match[1].split(",")) {
      const name = raw.trim().replace(/<.*$/, "");
      if (name) contracts.push(name);
    }
  }
  return contracts;
}

/** Field name → declared type name, for one interface body. */
function interfaceFieldsOf(
  source: string,
  interfaceName: string,
): Array<{ field: string; type: string }> {
  const body = new RegExp(
    `export interface ${interfaceName}\\s*(?:extends [^{]+)?\\{([^}]*)\\}`,
  ).exec(source);
  if (!body) return [];

  const fields: Array<{ field: string; type: string }> = [];
  for (const match of body[1].matchAll(
    /^\s*([A-Za-z0-9_$]+)\??\s*:\s*([A-Za-z0-9_$.]+)\s*;/gm,
  )) {
    fields.push({ field: match[1], type: match[2] });
  }
  return fields;
}

async function readUseCaseSources(): Promise<
  Array<{ module: string; source: string }>
> {
  return Promise.all(
    MANIFEST_STRUCTURE_USE_CASE_MODULES.map(async (module) => ({
      module,
      source: await readFile(path.join(USE_CASES_ROOT, module), "utf8"),
    })),
  );
}

describe("HEX-019 — manifest-structure tools bind to inbound ports", () => {
  describe("implementer direction: the use case implements the port", () => {
    it("finds an implements clause on every manifest-structure use case", async () => {
      const sources = await readUseCaseSources();

      // Anti-vacuity: the population must be non-empty and complete before
      // any purity claim about it is worth making.
      expect(sources).toHaveLength(MANIFEST_STRUCTURE_USE_CASE_MODULES.length);

      const withoutImplements = sources
        .filter(({ source }) => implementedContractsOf(source).length === 0)
        .map(({ module }) => module);

      expect(withoutImplements).toEqual([]);
    });

    it("resolves every implemented contract to an import statement", async () => {
      const sources = await readUseCaseSources();
      const unresolved: string[] = [];
      let resolved = 0;

      for (const { module, source } of sources) {
        const imports = importMapOf(source);
        for (const contract of implementedContractsOf(source)) {
          const specifier = imports.get(contract);
          if (specifier === undefined) {
            unresolved.push(`${module}: ${contract}`);
            continue;
          }
          resolved += 1;
        }
      }

      expect(unresolved).toEqual([]);
      // Anti-vacuity: an unparsed import form must not read as "clean".
      expect(resolved).toBeGreaterThanOrEqual(
        MANIFEST_STRUCTURE_USE_CASE_MODULES.length,
      );
    });

    it("files every implemented contract under application/ports/in", async () => {
      const sources = await readUseCaseSources();
      const misfiled: string[] = [];
      let checked = 0;

      for (const { module, source } of sources) {
        const imports = importMapOf(source);
        for (const contract of implementedContractsOf(source)) {
          const specifier = imports.get(contract);
          if (specifier === undefined) continue;
          checked += 1;
          if (!specifier.includes(INBOUND_SEGMENT)) {
            misfiled.push(`${module}: ${contract} <- ${specifier}`);
          }
        }
      }

      expect(checked).toBeGreaterThanOrEqual(
        MANIFEST_STRUCTURE_USE_CASE_MODULES.length,
      );
      expect(misfiled).toEqual([]);
    });
  });

  describe("driver direction: the tool bag is typed on the ports", () => {
    it("finds every manifest-structure dependency field", async () => {
      const source = await readFile(DEPS_FILE, "utf8");
      const fields = interfaceFieldsOf(source, DEPENDENCIES_INTERFACE);

      // Anti-vacuity: a renamed interface or a drifted field regex must fail
      // here, not sail through the emptiness of the population below.
      expect(fields).toHaveLength(MANIFEST_STRUCTURE_USE_CASE_MODULES.length);
    });

    it("types every dependency field on a contract imported from ports/in", async () => {
      const source = await readFile(DEPS_FILE, "utf8");
      const imports = importMapOf(source);
      const fields = interfaceFieldsOf(source, DEPENDENCIES_INTERFACE);

      expect(fields).toHaveLength(MANIFEST_STRUCTURE_USE_CASE_MODULES.length);

      const offenders = fields.map(({ field, type }) => {
        const specifier = imports.get(type);
        if (specifier === undefined) {
          return `${field}: ${type} <- unresolved import`;
        }
        return specifier.includes(INBOUND_SEGMENT)
          ? null
          : `${field}: ${type} <- ${specifier}`;
      });

      expect(offenders.filter((entry) => entry !== null)).toEqual([]);
    });

    it("keeps concrete use-case modules out of the manifest-structure bag", async () => {
      const source = await readFile(DEPS_FILE, "utf8");
      const imports = importMapOf(source);
      const fields = interfaceFieldsOf(source, DEPENDENCIES_INTERFACE);

      expect(fields).toHaveLength(MANIFEST_STRUCTURE_USE_CASE_MODULES.length);

      const concrete = fields
        .filter(({ type }) => imports.get(type)?.includes(".use-case.js"))
        .map(({ field, type }) => `${field}: ${type}`);

      expect(concrete).toEqual([]);
    });
  });
});
