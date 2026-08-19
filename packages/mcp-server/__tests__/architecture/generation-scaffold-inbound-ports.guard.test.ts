import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import {
  DEPS_FILE,
  identifiersOf,
  implementedContractsOf,
  importMapOf,
  interfaceFieldsOf,
  isInboundSpecifier,
  readUseCaseSources,
  SINGLE_CONTRACT_TYPE,
} from "./inbound-port-scanner.js";

/**
 * HEX-019 / ADR-0048 guard — the generation & scaffold tool family binds to
 * inbound ports, not to concrete use-case classes. Sibling of
 * `manifest-structure-inbound-ports.guard.test.ts` (item 6.5(a)) and
 * `transaction-lifecycle-inbound-ports.guard.test.ts` (item 6.5(b)); this one
 * covers item 6.5(c): scaffold-module, generate-topology, generate-adapters,
 * generate-manifest-pipeline.
 *
 * ADR-0048 Decision 3 requires mcp-server handlers to depend on inbound port
 * interfaces, and Decision 1 gives the operational test for direction: an
 * inbound port is the one *the use case implements* and a driver calls.
 * This guard mechanises both ends of that sentence for the four tools of
 * remediation item 6.5(c):
 *
 *   1. **Implementer direction** — each generation/scaffold use case must
 *      `implements` a contract whose import resolves under
 *      `application/ports/in/`. A use case that implements nothing, or that
 *      implements something filed under `ports/out/`, is not inbound.
 *   2. **Driver direction** — every field of
 *      `GenerationScaffoldToolDependencies` (the bag the tool adapters
 *      receive) must be typed on a contract imported from
 *      `application/ports/in/`, never from a `*.use-case.js` module.
 *
 * `TransactionManagerPort` (scaffold's constructor collaborator) and
 * `ManifestGenerationPort` (the three generate tools) stay outbound: they are
 * injected into the use cases and implemented by infrastructure adapters. They
 * are not listed inbound and must not appear as bag field types.
 *
 * Both halves carry an anti-vacuity assertion: the scan must first find the
 * expected non-zero population, or a drifted regex would turn the guard into a
 * green no-op over an empty set — the failure mode this arc keeps finding.
 * Both halves also fail loudly when a contract name cannot be tied to an import
 * statement, rather than silently skipping it: an unparsed import form must not
 * be indistinguishable from a correctly filed port. That rule extends to the
 * *declared type* as well — a field typed on anything but a single named
 * contract (a union, an array, a generic) is reported, not skipped, because a
 * skipped field leaves the population count unchanged and escapes every
 * direction assertion. A last matchers-themselves block pins both readers: the
 * `ports/in` segment match (barrels included, near-misses excluded) and the
 * refusal to judge a compound type.
 *
 * It is source-text based on purpose. `ports/in` and `ports/out` type-check
 * identically, so `tsc` cannot catch a misfiled contract. The complementary
 * compile-time half of this guard lives in production code, in
 * `src/infrastructure/adapters/mcp-server.types.ts`
 * (`GenerationScaffoldDepsAreInboundPorts`), where it fails `yarn build` rather
 * than only a test-side type check.
 *
 * The readers themselves live in `./inbound-port-scanner.ts`, shared with the
 * (a) and (b) guards. Their behaviour is still pinned by the matchers-themselves
 * block at the bottom of this file.
 */

/** The four tools of remediation item 6.5(c), by use-case module basename. */
const GENERATION_SCAFFOLD_USE_CASE_MODULES = [
  "scaffold-module-tool.use-case.ts",
  "generate-topology-tool.use-case.ts",
  "generate-adapters-tool.use-case.ts",
  "generate-manifest-pipeline-tool.use-case.ts",
] as const;

const DEPENDENCIES_INTERFACE = "GenerationScaffoldToolDependencies";

/** Scaffold's driven collaborator — outbound, must not enter the bag. */
const SCAFFOLD_DRIVEN_COLLABORATOR = "TransactionManagerPort";

describe("HEX-019 — generation/scaffold tools bind to inbound ports", () => {
  describe("implementer direction: the use case implements the port", () => {
    it("finds an implements clause on every generation/scaffold use case", async () => {
      const sources = await readUseCaseSources(
        GENERATION_SCAFFOLD_USE_CASE_MODULES,
      );

      // Anti-vacuity: the population must be non-empty and complete before
      // any purity claim about it is worth making.
      expect(sources).toHaveLength(GENERATION_SCAFFOLD_USE_CASE_MODULES.length);

      const withoutImplements = sources
        .filter(({ source }) => implementedContractsOf(source).length === 0)
        .map(({ module }) => module);

      expect(withoutImplements).toEqual([]);
    });

    it("resolves every implemented contract to an import statement", async () => {
      const sources = await readUseCaseSources(
        GENERATION_SCAFFOLD_USE_CASE_MODULES,
      );
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
        GENERATION_SCAFFOLD_USE_CASE_MODULES.length,
      );
    });

    it("files every implemented contract under application/ports/in", async () => {
      const sources = await readUseCaseSources(
        GENERATION_SCAFFOLD_USE_CASE_MODULES,
      );
      const misfiled: string[] = [];
      let checked = 0;

      for (const { module, source } of sources) {
        const imports = importMapOf(source);
        for (const contract of implementedContractsOf(source)) {
          const specifier = imports.get(contract);
          if (specifier === undefined) continue;
          checked += 1;
          if (!isInboundSpecifier(specifier)) {
            misfiled.push(`${module}: ${contract} <- ${specifier}`);
          }
        }
      }

      expect(checked).toBeGreaterThanOrEqual(
        GENERATION_SCAFFOLD_USE_CASE_MODULES.length,
      );
      expect(misfiled).toEqual([]);
    });
  });

  describe("driver direction: the tool bag is typed on the ports", () => {
    it("finds every generation/scaffold dependency field", async () => {
      const source = await readFile(DEPS_FILE, "utf8");
      const fields = interfaceFieldsOf(source, DEPENDENCIES_INTERFACE);

      // Anti-vacuity: a renamed interface or a drifted field regex must fail
      // here, not sail through the emptiness of the population below.
      expect(fields).toHaveLength(GENERATION_SCAFFOLD_USE_CASE_MODULES.length);
    });

    it("types every dependency field on a contract imported from ports/in", async () => {
      const source = await readFile(DEPS_FILE, "utf8");
      const imports = importMapOf(source);
      const fields = interfaceFieldsOf(source, DEPENDENCIES_INTERFACE);

      expect(fields).toHaveLength(GENERATION_SCAFFOLD_USE_CASE_MODULES.length);

      const offenders = fields.map(({ field, type }) => {
        // A type the scanner cannot tie to one import is reported, never
        // skipped: silence here is indistinguishable from a correctly filed
        // port, and is where a concrete use-case class would hide.
        if (!SINGLE_CONTRACT_TYPE.test(type)) {
          return `${field}: ${type} <- compound type, not a single named contract`;
        }
        const specifier = imports.get(type);
        if (specifier === undefined) {
          return `${field}: ${type} <- unresolved import`;
        }
        return isInboundSpecifier(specifier)
          ? null
          : `${field}: ${type} <- ${specifier}`;
      });

      expect(offenders.filter((entry) => entry !== null)).toEqual([]);
    });

    it("keeps concrete use-case modules out of the generation/scaffold bag", async () => {
      const source = await readFile(DEPS_FILE, "utf8");
      const imports = importMapOf(source);
      const fields = interfaceFieldsOf(source, DEPENDENCIES_INTERFACE);

      expect(fields).toHaveLength(GENERATION_SCAFFOLD_USE_CASE_MODULES.length);

      // Scans every identifier in the declared type, so a concrete class
      // smuggled inside a union, an array or a generic is caught too.
      const concrete = fields
        .filter(({ type }) =>
          identifiersOf(type).some((name) =>
            imports.get(name)?.includes(".use-case.js"),
          ),
        )
        .map(({ field, type }) => `${field}: ${type}`);

      expect(concrete).toEqual([]);
    });
  });

  describe("the driven collaborator stays driven", () => {
    it("hands TransactionManagerPort to the scaffold use case as a dependency", async () => {
      const sources = await readUseCaseSources([
        "scaffold-module-tool.use-case.ts",
      ]);

      // Anti-vacuity for the two assertions below: they are only meaningful
      // while scaffold really does collaborate with the transaction store.
      expect(sources).toHaveLength(1);
      expect(
        importMapOf(sources[0].source).has(SCAFFOLD_DRIVEN_COLLABORATOR),
      ).toBe(true);
    });

    it("never lets a generation/scaffold use case implement the transaction manager", async () => {
      const sources = await readUseCaseSources(
        GENERATION_SCAFFOLD_USE_CASE_MODULES,
      );

      // Anti-vacuity: "nobody implements the manager" is trivially true of a
      // family that implements nothing at all, which is exactly the pre-6.5(c)
      // state. Demand a real implemented-contract population first, so this
      // test can only pass by the reason it names.
      const implemented = sources.flatMap(({ source }) =>
        implementedContractsOf(source),
      );
      expect(implemented.length).toBeGreaterThanOrEqual(
        GENERATION_SCAFFOLD_USE_CASE_MODULES.length,
      );

      const inverted = sources
        .filter(({ source }) =>
          implementedContractsOf(source).includes(SCAFFOLD_DRIVEN_COLLABORATOR),
        )
        .map(({ module }) => module);

      expect(inverted).toEqual([]);
    });

    it("never types a bag field on the transaction manager", async () => {
      const source = await readFile(DEPS_FILE, "utf8");
      const fields = interfaceFieldsOf(source, DEPENDENCIES_INTERFACE);

      expect(fields).toHaveLength(GENERATION_SCAFFOLD_USE_CASE_MODULES.length);

      const bypasses = fields
        .filter(({ type }) =>
          identifiersOf(type).includes(SCAFFOLD_DRIVEN_COLLABORATOR),
        )
        .map(({ field, type }) => `${field}: ${type}`);

      expect(bypasses).toEqual([]);
    });
  });

  describe("the matchers themselves", () => {
    it("reads ports/in as a path segment, file specifier or directory barrel", () => {
      expect(
        isInboundSpecifier("../ports/in/scaffold-module-tool.port.js"),
      ).toBe(true);
      expect(
        isInboundSpecifier(
          "../../application/ports/in/generate-topology-tool.port.js",
        ),
      ).toBe(true);
      expect(isInboundSpecifier("../ports/in")).toBe(true);
      expect(isInboundSpecifier("./ports/in/index.js")).toBe(true);
      expect(isInboundSpecifier("..\\ports\\in\\index.js")).toBe(true);
    });

    it("does not match a near-miss segment", () => {
      expect(isInboundSpecifier("../ports/input/foo.port.js")).toBe(false);
      expect(isInboundSpecifier("../ports/in-memory/logger.js")).toBe(false);
      expect(isInboundSpecifier("../ports/inbound/foo.port.js")).toBe(false);
      expect(
        isInboundSpecifier("../ports/out/manifest-generation.port.js"),
      ).toBe(false);
      expect(
        isInboundSpecifier("../use-cases/scaffold-module-tool.use-case.js"),
      ).toBe(false);
    });

    it("refuses to judge a type it cannot tie to a single import", () => {
      expect(SINGLE_CONTRACT_TYPE.test("ScaffoldModuleToolPort")).toBe(true);
      expect(SINGLE_CONTRACT_TYPE.test("Ports.ScaffoldModuleToolPort")).toBe(
        true,
      );
      expect(SINGLE_CONTRACT_TYPE.test("ScaffoldModuleToolUseCase[]")).toBe(
        false,
      );
      expect(
        SINGLE_CONTRACT_TYPE.test("ScaffoldModuleToolPort | undefined"),
      ).toBe(false);
      expect(SINGLE_CONTRACT_TYPE.test("Promise<ScaffoldModuleToolPort>")).toBe(
        false,
      );
    });

    it("finds a concrete class hidden inside a compound type", () => {
      const imports = new Map([
        [
          "ScaffoldModuleToolUseCase",
          "../../application/use-cases/scaffold-module-tool.use-case.js",
        ],
      ]);
      const hidden = identifiersOf("ScaffoldModuleToolUseCase[]").some((name) =>
        imports.get(name)?.includes(".use-case.js"),
      );

      expect(hidden).toBe(true);
    });
  });
});
