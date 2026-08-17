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
 * HEX-019 / ADR-0048 guard — the transaction-lifecycle tool family binds to
 * inbound ports, not to concrete use-case classes. Sibling of
 * `manifest-structure-inbound-ports.guard.test.ts` (item 6.5(a)); this one
 * covers item 6.5(b): accept / reject / get / list transaction.
 *
 * ADR-0048 Decision 3 requires mcp-server handlers to depend on inbound port
 * interfaces, and Decision 1 gives the operational test for direction: an
 * inbound port is the one *the use case implements* and a driver calls; an
 * outbound port is the one the use case is *given* and an infrastructure
 * adapter implements. This guard mechanises three claims:
 *
 *   1. **Implementer direction** — each transaction-lifecycle use case must
 *      `implements` a contract whose import resolves under
 *      `application/ports/in/`. A use case that implements nothing, or that
 *      implements something filed under `ports/out/`, is not inbound.
 *   2. **Driver direction** — every field of
 *      `TransactionLifecycleToolDependencies` (the slice of the bag the four
 *      tool adapters read) must be typed on a contract imported from
 *      `application/ports/in/`, never from a `*.use-case.js` module.
 *   3. **The driven collaborator stays driven** — this family is the one whose
 *      collaborator is a port that already exists:
 *      `TransactionManagerPort` from `@hexagen/transaction-system`, implemented
 *      by `InMemoryTransactionManager`, an infrastructure adapter. Under
 *      Decision 1 that makes it outbound *for this package*, whatever folder
 *      its owning package files it in. So no transaction-lifecycle use case may
 *      `implements` it, and the tool bag may not type a field on it — a bag
 *      field typed on the manager would let a handler drive the transaction
 *      store directly, skipping the use case that this item exists to put
 *      behind a port.
 *
 * Each claim carries an anti-vacuity assertion: the scan must first find the
 * expected non-zero population, or a drifted regex turns the guard into a green
 * no-op over an empty set — the failure mode this arc keeps finding. Contract
 * names that cannot be tied to an import, and declared types that are not a
 * single named contract, are **reported, not skipped**, for the same reason: a
 * skipped field leaves the population count unchanged and escapes every
 * direction assertion.
 *
 * Source-text based on purpose: `ports/in` and `ports/out` type-check
 * identically, so `tsc` cannot catch a misfiled contract. The complementary
 * compile-time half lives in production code, in
 * `src/infrastructure/adapters/mcp-server.types.ts`
 * (`TransactionLifecycleDepsAreInboundPorts`), where it fails `yarn build`
 * rather than only a test-side type check. The shared readers live in
 * `./inbound-port-scanner.ts`; the specifier and type matchers are pinned by
 * the matchers-themselves block of the sibling guard, the interface-header and
 * class-header readers by the two blocks at the bottom of this file.
 */

/** The four tools of remediation item 6.5(b), by use-case module basename. */
const TRANSACTION_LIFECYCLE_USE_CASE_MODULES = [
  "accept-transaction-tool.use-case.ts",
  "reject-transaction-tool.use-case.ts",
  "get-transaction-tool.use-case.ts",
  "list-transactions-tool.use-case.ts",
] as const;

const DEPENDENCIES_INTERFACE = "TransactionLifecycleToolDependencies";

/** The driven collaborator these four use cases are handed. */
const DRIVEN_COLLABORATOR = "TransactionManagerPort";

describe("HEX-019 — transaction-lifecycle tools bind to inbound ports", () => {
  describe("implementer direction: the use case implements the port", () => {
    it("finds an implements clause on every transaction-lifecycle use case", async () => {
      const sources = await readUseCaseSources(
        TRANSACTION_LIFECYCLE_USE_CASE_MODULES,
      );

      // Anti-vacuity: the population must be non-empty and complete before any
      // purity claim about it is worth making.
      expect(sources).toHaveLength(
        TRANSACTION_LIFECYCLE_USE_CASE_MODULES.length,
      );

      const withoutImplements = sources
        .filter(({ source }) => implementedContractsOf(source).length === 0)
        .map(({ module }) => module);

      expect(withoutImplements).toEqual([]);
    });

    it("resolves every implemented contract to an import statement", async () => {
      const sources = await readUseCaseSources(
        TRANSACTION_LIFECYCLE_USE_CASE_MODULES,
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
        TRANSACTION_LIFECYCLE_USE_CASE_MODULES.length,
      );
    });

    it("files every implemented contract under application/ports/in", async () => {
      const sources = await readUseCaseSources(
        TRANSACTION_LIFECYCLE_USE_CASE_MODULES,
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
        TRANSACTION_LIFECYCLE_USE_CASE_MODULES.length,
      );
      expect(misfiled).toEqual([]);
    });
  });

  describe("driver direction: the tool bag is typed on the ports", () => {
    it("finds every transaction-lifecycle dependency field", async () => {
      const source = await readFile(DEPS_FILE, "utf8");
      const fields = interfaceFieldsOf(source, DEPENDENCIES_INTERFACE);

      // Anti-vacuity: a renamed interface or a drifted field regex must fail
      // here, not sail through the emptiness of the population below.
      expect(fields).toHaveLength(
        TRANSACTION_LIFECYCLE_USE_CASE_MODULES.length,
      );
    });

    it("types every dependency field on a contract imported from ports/in", async () => {
      const source = await readFile(DEPS_FILE, "utf8");
      const imports = importMapOf(source);
      const fields = interfaceFieldsOf(source, DEPENDENCIES_INTERFACE);

      expect(fields).toHaveLength(
        TRANSACTION_LIFECYCLE_USE_CASE_MODULES.length,
      );

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

    it("keeps concrete use-case modules out of the transaction-lifecycle bag", async () => {
      const source = await readFile(DEPS_FILE, "utf8");
      const imports = importMapOf(source);
      const fields = interfaceFieldsOf(source, DEPENDENCIES_INTERFACE);

      expect(fields).toHaveLength(
        TRANSACTION_LIFECYCLE_USE_CASE_MODULES.length,
      );

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
    it("hands TransactionManagerPort to every use case as a dependency", async () => {
      const sources = await readUseCaseSources(
        TRANSACTION_LIFECYCLE_USE_CASE_MODULES,
      );

      // Anti-vacuity for the two assertions below: they are only meaningful
      // while this family really does collaborate with the transaction store.
      // If the collaborator is renamed or dropped, this fails rather than
      // leaving "nobody implements it" trivially true.
      const withoutCollaborator = sources
        .filter(({ source }) => !importMapOf(source).has(DRIVEN_COLLABORATOR))
        .map(({ module }) => module);

      expect(withoutCollaborator).toEqual([]);
    });

    it("never lets a use case implement the transaction manager", async () => {
      const sources = await readUseCaseSources(
        TRANSACTION_LIFECYCLE_USE_CASE_MODULES,
      );

      // Anti-vacuity: "nobody implements the manager" is trivially true of a
      // family that implements nothing at all, which is exactly the pre-6.5(b)
      // state. Demand a real implemented-contract population first, so this
      // test can only pass by the reason it names.
      const implemented = sources.flatMap(({ source }) =>
        implementedContractsOf(source),
      );
      expect(implemented.length).toBeGreaterThanOrEqual(
        TRANSACTION_LIFECYCLE_USE_CASE_MODULES.length,
      );

      const inverted = sources
        .filter(({ source }) =>
          implementedContractsOf(source).includes(DRIVEN_COLLABORATOR),
        )
        .map(({ module }) => module);

      expect(inverted).toEqual([]);
    });

    it("never types a bag field on the transaction manager", async () => {
      const source = await readFile(DEPS_FILE, "utf8");
      const fields = interfaceFieldsOf(source, DEPENDENCIES_INTERFACE);

      expect(fields).toHaveLength(
        TRANSACTION_LIFECYCLE_USE_CASE_MODULES.length,
      );

      // A handler given the manager directly would bypass the use case this
      // item exists to place behind a port — the seam would still be "typed on
      // an interface" and still be wrong.
      const bypasses = fields
        .filter(({ type }) => identifiersOf(type).includes(DRIVEN_COLLABORATOR))
        .map(({ field, type }) => `${field}: ${type}`);

      expect(bypasses).toEqual([]);
    });
  });

  describe("the field reader, against the header shape this item creates", () => {
    /**
     * Adding a second base interface makes Prettier put `extends` on a line of
     * its own in `MCPServerAdapterDependencies`. A field reader that insists on
     * a literal space after `extends` stops matching such a header and returns
     * an empty field list — indistinguishable, to every population assertion
     * above, from an interface with no fields. Pinned here rather than left to
     * the (a) guard, because this item is what produced the shape.
     */
    it("reads an interface whose extends clause spans lines", () => {
      const source = [
        "export interface Bag",
        "  extends",
        "    FamilyA,",
        "    FamilyB {",
        "  someToolUseCase: SomeToolPort;",
        "}",
      ].join("\n");

      expect(interfaceFieldsOf(source, "Bag")).toEqual([
        { field: "someToolUseCase", type: "SomeToolPort" },
      ]);
    });

    it("still reads the plain single-line header", () => {
      const source = "export interface Bag {\n  a: APort;\n}";

      expect(interfaceFieldsOf(source, "Bag")).toEqual([
        { field: "a", type: "APort" },
      ]);
    });
  });

  describe("the class-header reader, against the shapes it must not skip", () => {
    /**
     * A class the reader skips is invisible to all three claims above, and the
     * skip is silent: with a second class present in the module, the
     * per-module "has an implements clause" assertion is already satisfied by
     * the first one. Measured before the matcher was widened — adding
     * `class SmuggledGenericUseCase<T> implements TransactionManagerPort` to
     * `accept-transaction-tool.use-case.ts` left this guard 11/11 green while
     * inverting the very direction the third claim forbids.
     */
    it("reads a generic class header", () => {
      expect(
        implementedContractsOf("export class Foo<T> implements FooPort {"),
      ).toEqual(["FooPort"]);
      expect(
        implementedContractsOf(
          "export class Foo<T extends Map<string, number>> implements FooPort {",
        ),
      ).toEqual(["FooPort"]);
    });

    it("reads a header whose type parameter is constrained by an object type", () => {
      // The constraint contains the very `{` and `;` a regex has to stop on.
      expect(
        implementedContractsOf(
          "export class Foo<T extends { value: string }> implements FooPort {",
        ),
      ).toEqual(["FooPort"]);
      expect(
        implementedContractsOf(
          "export class Foo<T extends { a: string; b: number }> implements FooPort {",
        ),
      ).toEqual(["FooPort"]);
      expect(
        implementedContractsOf(
          "export class Foo<T = () => void> implements FooPort {",
        ),
      ).toEqual(["FooPort"]);
    });

    it("splits contracts on commas between them, not inside their type arguments", () => {
      expect(
        implementedContractsOf(
          "export class Foo<X, Y> implements APort<X, Y>, BPort {",
        ),
      ).toEqual(["APort", "BPort"]);
    });

    it("does not read a class mentioned in a comment or built in a template", () => {
      // Both shapes exist in this package already: a doc comment in
      // mcp-server.types.ts, and a generated-code template in
      // sync-engine.adapter.ts.
      expect(
        implementedContractsOf(
          "/** for a class Foo implements FooPort { */\nexport const x = 1;",
        ),
      ).toEqual([]);
      expect(
        implementedContractsOf(
          "// class Foo implements FooPort {\nexport const x = 1;",
        ),
      ).toEqual([]);
      expect(
        implementedContractsOf(
          "const emitted = `export class Foo implements FooPort {`;",
        ),
      ).toEqual([]);
    });

    it("is not thrown off by a regex literal before a class", () => {
      // A quote inside a regex literal reads as an opening quote to anything
      // that scans characters rather than parsing them, which blanks the class
      // that follows.
      expect(
        implementedContractsOf(
          "const quoted = /[\"']/;\nexport class Foo implements FooPort {}",
        ),
      ).toEqual(["FooPort"]);
    });

    it("reads a class expression and a nested class, not only a top-level declaration", () => {
      expect(
        implementedContractsOf(
          "const C = class Inner implements InnerPort {};",
        ),
      ).toEqual(["InnerPort"]);
      expect(
        implementedContractsOf(
          "export class Outer {\n  m() {\n    class Inner implements InnerPort {}\n  }\n}",
        ),
      ).toEqual(["InnerPort"]);
    });

    it("reads a header that carries a base class before implements", () => {
      expect(
        implementedContractsOf(
          "export class Foo extends Base implements FooPort {",
        ),
      ).toEqual(["FooPort"]);
      expect(
        implementedContractsOf(
          "export class Foo<T>\n  extends Base<T>\n  implements APort, BPort<T>\n{",
        ),
      ).toEqual(["APort", "BPort"]);
    });

    it("still reads the plain header, and reaches no further than one", () => {
      expect(
        implementedContractsOf("export class Foo implements FooPort {"),
      ).toEqual(["FooPort"]);

      // The widening must not let a header matcher run past a class body and
      // adopt an `implements` that belongs to no class.
      expect(
        implementedContractsOf(
          [
            "export class Alpha {",
            "  private readonly x = 1;",
            "  run(): void {}",
            "}",
            "",
            "// a comment mentioning implements SomethingPort {",
          ].join("\n"),
        ),
      ).toEqual([]);
    });
  });
});
