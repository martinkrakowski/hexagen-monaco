import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
 * Source with every comment and string/template literal blanked to spaces,
 * newlines and offsets preserved, so a `class …` mention in prose or in a
 * generated-code template cannot be read as a declaration. Both shapes are in
 * this repository already: `mcp-server.types.ts` says "for a class type lists"
 * in a doc comment, and `sync-engine.adapter.ts` emits
 * `` `export class ${name}Adapter {` `` from a template literal.
 *
 * A regex literal containing a quote (`/["']/`) would be mis-read as opening a
 * string. That direction fails *loud*, not silent: blanking too much can only
 * hide a class, and a hidden class in a scanned module empties that module's
 * implemented-contract set, which the per-module population assertion in each
 * guard rejects.
 */
function blankNonCode(source: string): string {
  const out = source.split("");
  const blank = (from: number, to: number): void => {
    for (let k = from; k < to && k < out.length; k += 1) {
      if (out[k] !== "\n") out[k] = " ";
    }
  };

  let i = 0;
  while (i < source.length) {
    const two = source.slice(i, i + 2);
    if (two === "//") {
      const end = source.indexOf("\n", i);
      const stop = end === -1 ? source.length : end;
      blank(i, stop);
      i = stop;
      continue;
    }
    if (two === "/*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? source.length : end + 2;
      blank(i, stop);
      i = stop;
      continue;
    }
    const quote = source[i];
    if (quote === '"' || quote === "'" || quote === "`") {
      let j = i + 1;
      while (j < source.length) {
        if (source[j] === "\\") {
          j += 2;
          continue;
        }
        if (source[j] === quote) {
          j += 1;
          break;
        }
        j += 1;
      }
      blank(i, j);
      i = j;
      continue;
    }
    i += 1;
  }

  return out.join("");
}

/**
 * One class header, from just after the class name up to the `{` that opens its
 * body, with everything nested inside `<…>` blanked. Returns `null` when there
 * is no body to reach.
 *
 * A regex cannot do this. Between the name and `implements` a header may carry
 * type parameters (`class Foo<T>`), a base class (`class Foo extends Base`),
 * and a type parameter whose constraint is an object type
 * (`class Foo<T extends { value: string }>`) — the last one contains the very
 * `{` and `;` a regex has to use as its stopping marks. Walking the header with
 * an angle-bracket depth ends that whole family instead of widening a pattern
 * once per shape: the brace that stops the walk is only the brace at depth 0.
 * Blanking the nested spans also means `implements A<X, Y>, B` splits into
 * `A` and `B` rather than on the comma inside `A`'s type arguments.
 */
function classHeaderAfterName(source: string, from: number): string | null {
  let angle = 0;
  let header = "";

  for (let i = from; i < source.length; i += 1) {
    const ch = source[i];

    // An arrow in a default type argument (`<T = () => void>`) is not a closing
    // angle bracket.
    if (ch === "=" && source[i + 1] === ">") {
      header += "  ";
      i += 1;
      continue;
    }
    if (ch === "<") {
      angle += 1;
      header += " ";
      continue;
    }
    if (ch === ">") {
      if (angle > 0) angle -= 1;
      header += " ";
      continue;
    }
    if (ch === "{") {
      if (angle === 0) return header;
      let brace = 1;
      i += 1;
      for (; i < source.length && brace > 0; i += 1) {
        if (source[i] === "{") brace += 1;
        else if (source[i] === "}") brace -= 1;
      }
      i -= 1;
      header += " ";
      continue;
    }
    // A declaration that ends before any body is not a class this reader judges.
    if (ch === ";" && angle === 0) return null;

    header += angle === 0 ? ch : " ";
  }

  return null;
}

/**
 * Every contract named in an `implements` clause in one source file.
 *
 * A class this reader skips is invisible to every direction assertion built on
 * it, and the skip is silent whenever another class in the same module already
 * satisfies the per-module population assertion. Measured against the earlier
 * `implements`-must-follow-the-name matcher: a second class declared
 * `class SmuggledGenericUseCase<T> implements TransactionManagerPort` in
 * `accept-transaction-tool.use-case.ts` left the transaction-lifecycle guard
 * 11/11 green while inverting exactly the direction its third claim forbids.
 */
export function implementedContractsOf(source: string): string[] {
  const code = blankNonCode(source);
  const contracts: string[] = [];

  for (const match of code.matchAll(/\bclass\s+[A-Za-z0-9_$]+/g)) {
    const header = classHeaderAfterName(
      code,
      (match.index ?? 0) + match[0].length,
    );
    if (header === null) continue;

    const clause = /\bimplements\b([^]*)$/.exec(header);
    if (!clause) continue;

    for (const raw of clause[1].split(",")) {
      const name = raw.trim();
      if (name) contracts.push(name);
    }
  }

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
