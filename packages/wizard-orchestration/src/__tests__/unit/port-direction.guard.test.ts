import { describe, it } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/**
 * ADR-0048 (HEX-018) — port direction is a structural invariant, not a habit.
 *
 * Decision 1 defines the two directions operationally: `ports/out` is driven —
 * "the use case depends on the port; an infrastructure adapter implements it";
 * `ports/in` is driving — "the use case implements the inbound port; a driver
 * depends on the port".
 *
 * The sibling packages in this arc can key their guard on the ADR's rule of
 * thumb ("if an infrastructure adapter `implements` the interface…"). This
 * package cannot: `src/infrastructure/` holds a single `export {}` barrel and
 * no adapters at all, so an `implements`-based scan here would find nothing and
 * pass forever. The half of the definition this package *does* exhibit is the
 * other one — a use case that constructor-injects a contract and calls it. That
 * is the dependency direction the guard measures.
 *
 * It has to be source-based. `ports/in` and `ports/out` type-check identically,
 * so `tsc` can never catch a driven port parked in the wrong folder; the defect
 * is invisible to every check in the pipeline except one that reads the paths.
 *
 * Parsed, not grepped, for the same reason `sync-engine-boundary.test.ts` is: a
 * regex over the raw text fires on the specifier written inside a comment or a
 * template string and misses aliased imports (`import type { X as Y }`).
 */
const PACKAGE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const SRC_DIR = path.join(PACKAGE_ROOT, "src");
const USE_CASES_DIR = path.join(SRC_DIR, "application/use-cases");
const PORTS_IN_DIR = path.join(SRC_DIR, "application/ports/in");

/**
 * True when `specifier` addresses `application/ports/{direction}` as a
 * path segment — a file (`…/ports/out/foo.port`) or the directory barrel
 * (`…/ports/out`). A trailing-slash substring misses the barrel and a
 * bare prefix would fire on near-misses like `…/ports/outgoing`.
 */
function hasPortDirection(specifier: string, direction: "in" | "out"): boolean {
  const normalized = specifier.replace(/\\/g, "/");
  return new RegExp(`/ports/${direction}(?:/|$)`).test(normalized);
}

function isMisfiledDrivenImport(specifier: string | undefined): boolean {
  return (
    specifier === undefined ||
    hasPortDirection(specifier, "in") ||
    !hasPortDirection(specifier, "out")
  );
}

function tsFilesUnder(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return tsFilesUnder(full);
    return entry.isFile() && /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

function parse(filePath: string, source: string): ts.SourceFile {
  return ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.ES2022,
    /* setParentNodes */ true,
    ts.ScriptKind.TS,
  );
}

interface InjectedContract {
  /** Use-case module, relative to the package root. */
  readonly useCase: string;
  /** Local name of the injected contract type. */
  readonly contract: string;
  /** Specifier the contract was imported from, or `undefined` if declared locally. */
  readonly specifier: string | undefined;
}

/**
 * Local name → module specifier, for every named import binding in the file.
 * The *local* name is the key, so `import type { A as B }` is found under `B`,
 * which is the name a parameter annotation would actually use.
 */
function importedNames(file: ts.SourceFile): Map<string, string> {
  const bindings = new Map<string, string>();

  for (const statement of file.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      continue;
    }
    const named = statement.importClause?.namedBindings;
    if (named === undefined || !ts.isNamedImports(named)) continue;

    for (const element of named.elements) {
      bindings.set(element.name.text, statement.moduleSpecifier.text);
    }
  }

  return bindings;
}

/**
 * Every contract a use-case class takes through its constructor — the shape
 * ADR-0048 calls "the use case depends on the port". Type arguments are
 * dropped (`Repo<Wizard>` records as `Repo`); non-reference annotations
 * (`string`, unions, inline object types) are not contracts and are skipped.
 */
function injectedContracts(
  relativePath: string,
  file: ts.SourceFile,
): InjectedContract[] {
  const imports = importedNames(file);
  const found: InjectedContract[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isConstructorDeclaration(node)) {
      for (const parameter of node.parameters) {
        const annotation = parameter.type;
        if (
          annotation === undefined ||
          !ts.isTypeReferenceNode(annotation) ||
          !ts.isIdentifier(annotation.typeName)
        ) {
          continue;
        }
        const contract = annotation.typeName.text;
        found.push({
          useCase: relativePath,
          contract,
          specifier: imports.get(contract),
        });
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(file);
  return found;
}

function contractsInUseCases(): InjectedContract[] {
  return tsFilesUnder(USE_CASES_DIR).flatMap((file) =>
    injectedContracts(
      path.relative(PACKAGE_ROOT, file),
      parse(file, fs.readFileSync(file, "utf8")),
    ),
  );
}

/**
 * Decision 2: "Update the doc comments that read 'Infrastructure adapters …
 * implement this contract' so folder and comment agree." A comment saying an
 * adapter implements the contract is a self-declaration of outbound direction,
 * so it cannot appear on a file filed under `ports/in`.
 */
function claimsAdapterImplements(source: string): boolean {
  return /adapters?\b[^.]*\bimplement/is.test(source);
}

describe("ADR-0048 port direction (wizard-orchestration)", () => {
  describe("a contract a use case depends on is a driven port", () => {
    it("finds use-case constructor injections to check (the scan is not vacuous)", () => {
      const contracts = contractsInUseCases();

      // Not decoration. This package has exactly three driven contracts
      // (ProcessIntentPort, ProjectWizardStatePort, ValidateStepPort), injected
      // across five use-case modules. A walker that regressed to reading only
      // the first file, or that stopped resolving type references, would still
      // return one or two and would still fail here — which `> 0` could not do.
      const distinct = new Set(contracts.map(({ contract }) => contract));
      assert.ok(
        distinct.size >= 3,
        `expected at least 3 distinct injected contracts, found ${distinct.size}: ${[...distinct].join(", ")}`,
      );

      const local = contracts.filter(({ specifier }) =>
        specifier?.startsWith("."),
      );
      assert.ok(
        local.length >= 3,
        `expected at least 3 package-local injected contracts, found ${local.length}`,
      );
    });

    it("imports every injected contract from application/ports/out", () => {
      const misfiled = contractsInUseCases()
        .filter(({ specifier }) => specifier?.startsWith("."))
        .filter(({ specifier }) => isMisfiledDrivenImport(specifier));

      assert.deepEqual(
        misfiled.map(
          ({ useCase, contract, specifier }) =>
            `${useCase} injects ${contract} from ${specifier}`,
        ),
        [],
        "a use case depends on these contracts and calls them, so under " +
          "ADR-0048 Decision 1 they are driven ports and belong in " +
          "application/ports/out",
      );
    });
  });

  describe("folder and doc comment agree on direction", () => {
    it("no ports/in file claims an infrastructure adapter implements it", () => {
      const inboundFiles = tsFilesUnder(PORTS_IN_DIR).filter(
        (file) => path.basename(file) !== "index.ts",
      );

      // Anti-vacuity: an empty or barrel-only ports/in folder would make the
      // assertion below true by having nothing to read.
      assert.ok(
        inboundFiles.length >= 2,
        `expected ports/in to still hold genuine inbound ports, found ${inboundFiles.length}`,
      );

      const offenders = inboundFiles
        .filter((file) =>
          claimsAdapterImplements(fs.readFileSync(file, "utf8")),
        )
        .map((file) => path.relative(PACKAGE_ROOT, file));

      assert.deepEqual(
        offenders,
        [],
        "ADR-0048 Decision 2: a file whose comment says an infrastructure " +
          "adapter implements it is describing an outbound port",
      );
    });
  });

  describe("the collectors themselves", () => {
    it("reads aliased, generic and multi-parameter injections", () => {
      const file = parse(
        "sample.use-case.ts",
        [
          'import type { AlphaPort as Alpha } from "../ports/out/alpha.port.js";',
          'import type { BetaPort } from "../ports/in/beta.port.js";',
          'import { Repo } from "../ports/out/repo.port.js";',
          "export class SampleUseCase {",
          "  constructor(",
          "    private readonly a: Alpha,",
          "    private readonly b: BetaPort,",
          "    private readonly r: Repo<string>,",
          "    private readonly label: string,",
          "  ) {}",
          "}",
        ].join("\n"),
      );

      assert.deepEqual(
        injectedContracts("sample.use-case.ts", file).map(
          ({ contract, specifier }) => `${contract}<-${specifier}`,
        ),
        [
          // The alias resolves to its import and the generic argument is
          // dropped; `label: string` is a keyword annotation, not a contract,
          // so it never reaches the list at all.
          "Alpha<-../ports/out/alpha.port.js",
          "BetaPort<-../ports/in/beta.port.js",
          "Repo<-../ports/out/repo.port.js",
        ],
      );
    });

    it("accepts outbound file paths and directory barrels, rejects inbound and near-misses", () => {
      const file = parse(
        "sample.use-case.ts",
        [
          'import type { FilePort } from "../ports/out/alpha.port.js";',
          'import type { BarrelPort } from "../ports/out";',
          'import type { TrailingPort } from "../ports/out/";',
          'import type { NearMissPort } from "../ports/outgoing";',
          'import type { InboundBarrel } from "../ports/in";',
          "export class SampleUseCase {",
          "  constructor(",
          "    private readonly file: FilePort,",
          "    private readonly barrel: BarrelPort,",
          "    private readonly trailing: TrailingPort,",
          "    private readonly nearMiss: NearMissPort,",
          "    private readonly inbound: InboundBarrel,",
          "  ) {}",
          "}",
        ].join("\n"),
      );

      const byContract = new Map(
        injectedContracts("sample.use-case.ts", file).map((entry) => [
          entry.contract,
          entry.specifier,
        ]),
      );

      assert.equal(byContract.get("FilePort"), "../ports/out/alpha.port.js");
      assert.equal(byContract.get("BarrelPort"), "../ports/out");
      assert.equal(byContract.get("TrailingPort"), "../ports/out/");
      assert.equal(byContract.get("NearMissPort"), "../ports/outgoing");
      assert.equal(byContract.get("InboundBarrel"), "../ports/in");

      assert.equal(isMisfiledDrivenImport(byContract.get("FilePort")), false);
      assert.equal(isMisfiledDrivenImport(byContract.get("BarrelPort")), false);
      assert.equal(
        isMisfiledDrivenImport(byContract.get("TrailingPort")),
        false,
      );
      assert.equal(
        isMisfiledDrivenImport(byContract.get("NearMissPort")),
        true,
      );
      assert.equal(
        isMisfiledDrivenImport(byContract.get("InboundBarrel")),
        true,
      );
      assert.equal(isMisfiledDrivenImport("../ports/out-of-band"), true);
      assert.equal(isMisfiledDrivenImport("../ports/in/beta.port.js"), true);
      assert.equal(isMisfiledDrivenImport("../ports/inbound"), true);
    });

    it("flags the comment wording ADR-0048 Decision 2 names, and nothing else", () => {
      assert.equal(
        claimsAdapterImplements(
          "/** Infrastructure adapters (AI, rule engine) implement this. */",
        ),
        true,
      );
      assert.equal(
        claimsAdapterImplements(
          "/** Implementations are provided by the UI (React). */",
        ),
        false,
      );
    });
  });
});
