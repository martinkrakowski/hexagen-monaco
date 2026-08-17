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
 * (`ManifestStructureDepsAreInboundPorts`), where it fails `yarn build` rather
 * than only a test-side type check.
 *
 * The readers themselves now live in `./inbound-port-scanner.ts`, shared with
 * the transaction-lifecycle guard of item 6.5(b). Their behaviour is still
 * pinned by the matchers-themselves block at the bottom of this file.
 */

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

describe("HEX-019 — manifest-structure tools bind to inbound ports", () => {
  describe("implementer direction: the use case implements the port", () => {
    it("finds an implements clause on every manifest-structure use case", async () => {
      const sources = await readUseCaseSources(
        MANIFEST_STRUCTURE_USE_CASE_MODULES,
      );

      // Anti-vacuity: the population must be non-empty and complete before
      // any purity claim about it is worth making.
      expect(sources).toHaveLength(MANIFEST_STRUCTURE_USE_CASE_MODULES.length);

      const withoutImplements = sources
        .filter(({ source }) => implementedContractsOf(source).length === 0)
        .map(({ module }) => module);

      expect(withoutImplements).toEqual([]);
    });

    it("resolves every implemented contract to an import statement", async () => {
      const sources = await readUseCaseSources(
        MANIFEST_STRUCTURE_USE_CASE_MODULES,
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
        MANIFEST_STRUCTURE_USE_CASE_MODULES.length,
      );
    });

    it("files every implemented contract under application/ports/in", async () => {
      const sources = await readUseCaseSources(
        MANIFEST_STRUCTURE_USE_CASE_MODULES,
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

    it("keeps concrete use-case modules out of the manifest-structure bag", async () => {
      const source = await readFile(DEPS_FILE, "utf8");
      const imports = importMapOf(source);
      const fields = interfaceFieldsOf(source, DEPENDENCIES_INTERFACE);

      expect(fields).toHaveLength(MANIFEST_STRUCTURE_USE_CASE_MODULES.length);

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

  describe("the matchers themselves", () => {
    it("reads ports/in as a path segment, file specifier or directory barrel", () => {
      expect(isInboundSpecifier("../ports/in/create-port-tool.port.js")).toBe(
        true,
      );
      expect(
        isInboundSpecifier("../../application/ports/in/mcp-server.port.js"),
      ).toBe(true);
      expect(isInboundSpecifier("../ports/in")).toBe(true);
      expect(isInboundSpecifier("./ports/in/index.js")).toBe(true);
      expect(isInboundSpecifier("..\\ports\\in\\index.js")).toBe(true);
    });

    it("does not match a near-miss segment", () => {
      expect(isInboundSpecifier("../ports/input/foo.port.js")).toBe(false);
      expect(isInboundSpecifier("../ports/in-memory/logger.js")).toBe(false);
      expect(isInboundSpecifier("../ports/inbound/foo.port.js")).toBe(false);
      expect(isInboundSpecifier("../ports/out/manifest-write.port.js")).toBe(
        false,
      );
      expect(
        isInboundSpecifier("../use-cases/create-port-tool.use-case.js"),
      ).toBe(false);
    });

    it("refuses to judge a type it cannot tie to a single import", () => {
      expect(SINGLE_CONTRACT_TYPE.test("CreatePortToolPort")).toBe(true);
      expect(SINGLE_CONTRACT_TYPE.test("Ports.CreatePortToolPort")).toBe(true);
      expect(SINGLE_CONTRACT_TYPE.test("CreatePortToolUseCase[]")).toBe(false);
      expect(SINGLE_CONTRACT_TYPE.test("CreatePortToolPort | undefined")).toBe(
        false,
      );
      expect(SINGLE_CONTRACT_TYPE.test("Promise<CreatePortToolPort>")).toBe(
        false,
      );
    });

    it("finds a concrete class hidden inside a compound type", () => {
      const imports = new Map([
        [
          "CreatePortToolUseCase",
          "../../application/use-cases/create-port-tool.use-case.js",
        ],
      ]);
      const hidden = identifiersOf("CreatePortToolUseCase[]").some((name) =>
        imports.get(name)?.includes(".use-case.js"),
      );

      expect(hidden).toBe(true);
    });
  });
});
