import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/**
 * Source-text reader shared by the HEX-019 / ADR-0048 inbound-port guards, one
 * per mcp-server tool family (remediation item 6.5).
 *
 * Extracted verbatim from `manifest-structure-inbound-ports.guard.test.ts`
 * (item 6.5(a)) when the transaction-lifecycle family (6.5(b)) needed the same
 * reader. Two guards in the same package enforcing the same ADR clause must not
 * disagree about what a `ports/in` segment is or about which declared types
 * they are willing to judge — the (a) guard already said so in prose and kept
 * the rule in sync with `project-configuration` by copying it. Copying it a
 * third time inside one package would make "in sync" a matter of discipline;
 * importing it makes drift impossible.
 *
 * These readers are source-text based on purpose. `ports/in` and `ports/out`
 * type-check identically, so `tsc` cannot catch a misfiled contract.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(HERE, "..", "..");

export const SRC_ROOT = path.join(PACKAGE_ROOT, "src");
export const USE_CASES_ROOT = path.join(SRC_ROOT, "application", "use-cases");

/** The tool-handler dependency bag every family's fields live in. */
export const DEPS_FILE = path.join(
  SRC_ROOT,
  "infrastructure",
  "adapters",
  "mcp-server.types.ts",
);

/**
 * `ports/in` as a *path segment*, not as a substring. A file specifier
 * (`../ports/in/create-port-tool.port.js`) and a directory barrel
 * (`../ports/in`) are both legal inbound imports — a trailing-slash substring
 * test silently misfiles the barrel — while near-misses such as `ports/input`
 * or `ports/in-memory` must not match. Same rule as `isPortDirectionSpecifier`
 * in `packages/project-configuration/__tests__/architecture/port-direction.guard.test.ts`.
 */
export const INBOUND_SEGMENT = /(^|\/)ports\/in(\/|$)/;

export function isInboundSpecifier(specifier: string): boolean {
  return INBOUND_SEGMENT.test(specifier.replace(/\\/g, "/"));
}

/**
 * A declared type these guards can tie to exactly one import: a single
 * identifier, optionally namespace-qualified. Anything compound — a union, an
 * intersection, an array, a generic application — is **reported, not skipped**.
 * A field whose type the scanner cannot read is precisely where a concrete
 * use-case class hides: `x: SomeToolUseCase[]` was measured escaping both the
 * (a) guard (6/6 green) and the compile-time `*DepsAreInboundPorts` check,
 * because a homomorphic mapped type over an array is the identity.
 */
export const SINGLE_CONTRACT_TYPE = /^[A-Za-z0-9_$]+(?:\.[A-Za-z0-9_$]+)*$/;

/** Every identifier occurring anywhere in a declared type's source text. */
export function identifiersOf(typeText: string): string[] {
  return typeText.match(/[A-Za-z_$][A-Za-z0-9_$]*/g) ?? [];
}

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
 * the "resolves to a module" assertions in the guards turn into a failure.
 */
export function localNamesOf(clause: string): string[] {
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
export function importMapOf(source: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const match of source.matchAll(IMPORT_PATTERN)) {
    const [, clause, specifier] = match;
    for (const name of localNamesOf(clause)) map.set(name, specifier);
  }
  return map;
}

/**
 * Every contract named in an `implements` clause in one source file.
 *
 * Parsed rather than matched. A class this reader skips is invisible to every
 * direction assertion built on it, and the skip is silent whenever another
 * class in the same module already satisfies the per-module population
 * assertion — so the reader has to be right about the whole grammar, not about
 * the shapes anyone thought to enumerate. Three successive hand-written
 * matchers each missed a legal header: `class Foo<T> implements P`, then
 * `class Foo<T extends { value: string }> implements P` (the constraint carries
 * the very `{` a matcher must stop on), then a class following a regex literal
 * that contains a quote. Measured against the first of them, a second class
 * declared `class SmuggledGenericUseCase<T> implements TransactionManagerPort`
 * in `accept-transaction-tool.use-case.ts` left the transaction-lifecycle guard
 * 11/11 green while inverting exactly the direction its third claim forbids.
 *
 * `ts.createSourceFile` is the same parser that reads these files for real, so
 * there is no fourth shape: comments, template literals and regex literals are
 * not declarations, class *expressions* and nested classes are, and type
 * parameters, base clauses and type arguments are structure rather than text to
 * be stopped on. It is a syntax-only parse — no program, no type checker —
 * which leaves the rationale for these guards intact: `ports/in` and
 * `ports/out` type-check identically, so what needs reading is where a contract
 * is *filed*, and only the source text says that.
 */
export function implementedContractsOf(source: string): string[] {
  const parsed = ts.createSourceFile(
    "scanned.ts",
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ false,
    ts.ScriptKind.TS,
  );

  const contracts: string[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
      for (const clause of node.heritageClauses ?? []) {
        if (clause.token !== ts.SyntaxKind.ImplementsKeyword) continue;
        // `expression` is the contract itself; any type arguments hang off the
        // node separately, so `A<X, Y>` yields `A` with no text surgery.
        for (const type of clause.types) {
          contracts.push(type.expression.getText(parsed));
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  ts.forEachChild(parsed, visit);
  return contracts;
}

/**
 * Field name → declared type *source text*, for one interface body.
 *
 * The type is captured verbatim up to the `;` rather than as a bare identifier.
 * A narrower capture would skip any field carrying a compound type, and a
 * skipped field is invisible to both the population count and the direction
 * assertions in the guards — the exact hole through which
 * `x: SomeToolUseCase[]` was measured passing the (a) guard. Reading the whole
 * type keeps every field in the population; `SINGLE_CONTRACT_TYPE` then decides
 * whether it can be judged.
 */
export function interfaceFieldsOf(
  source: string,
  interfaceName: string,
): Array<{ field: string; type: string }> {
  // `extends\s` rather than `extends `: with a second base interface added in
  // item 6.5(b), Prettier reformats `MCPServerAdapterDependencies` so that
  // `extends` ends its own line. A literal-space matcher stops matching such a
  // header and returns an empty field list — which any population assertion
  // would then read as "interface not found" rather than "no fields", the
  // silent-empty-population failure these guards exist to prevent.
  const body = new RegExp(
    `export interface ${interfaceName}\\s*(?:extends\\s[^{]+)?\\{([^}]*)\\}`,
  ).exec(source);
  if (!body) return [];

  const fields: Array<{ field: string; type: string }> = [];
  for (const match of body[1].matchAll(
    /^\s*(?:readonly\s+)?([A-Za-z0-9_$]+)\??\s*:\s*([^;]+);/gm,
  )) {
    fields.push({ field: match[1], type: match[2].trim() });
  }
  return fields;
}

/** Reads one family's use-case modules by basename, in declaration order. */
export async function readUseCaseSources(
  modules: readonly string[],
): Promise<Array<{ module: string; source: string }>> {
  return Promise.all(
    modules.map(async (module) => ({
      module,
      source: await readFile(path.join(USE_CASES_ROOT, module), "utf8"),
    })),
  );
}
