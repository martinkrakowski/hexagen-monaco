/**
 * `in-port-unknown` — "no in-port accepts `unknown`" (D4, accepted 2026-11-27).
 *
 * The codec layer (Lane H2) closes the hostile-input hole at every in-port that
 * declares a manifest contract, by generating a `<PortName>.codec.ts` whose
 * `decode` returns a `Validated<Raw<PortName>Request>`. That defence only holds
 * if the port's TypeScript signature actually narrows what the caller may pass.
 * An in-port that declares its parameter as `unknown` accepts ANYTHING at the
 * type level — it re-opens, in the contract itself, the exact hole the codec
 * closes in the body — so it is a violation wherever the codec machinery is the
 * trusted boundary.
 *
 * Scope, deliberately narrow:
 *  - ONLY files under `/ports/in/` (`*.port.ts` and `*.in-port.ts` alike — the
 *    suffix spellings are both in use and neither is authoritative);
 *  - ONLY exported interfaces and exported type aliases (a private helper type
 *    is not an in-process boundary anyone can call across);
 *  - NOT test files (`*.test.ts`, `*.spec.ts`, `__tests__/`), NOT `templates/`
 *    (customer payload, same exclusion as `countsAsContextExportSource` in
 *    cli.ts), NOT `.d.ts` (ambient declarations, not runnable boundaries).
 *
 * Hostile-AST contract (lane H4): every predicate here operates on a
 * `ts-morph` `SourceFile` the CLI already parsed. Malformed, untyped or
 * checker-trapping nodes must NEVER crash the run — a linter that throws on
 * weird code fails closed in the wrong direction (the run "could not run" for
 * an unrelated reason) or, worse, is patched to swallow the crash and silently
 * stops checking. So every reflection/type-checker call is individually
 * guarded: `try/catch` returns a safe result, and cyclic type-alias resolution
 * is cut off by a `visited: Set<Type>` guard bounded by the number of distinct
 * types reachable from one parameter.
 *
 * Pure module: no `console.*`, no `process.*`, no filesystem I/O.
 */
import {
  SyntaxKind,
  type MethodSignature,
  type ParameterDeclaration,
  type SourceFile,
  type Type,
} from "ts-morph";

/** Stable rule id. Part of the baseline key — renaming invalidates entries. */
export const IN_PORT_UNKNOWN_RULE = "in-port-unknown" as const;

export type InPortUnknownRule = typeof IN_PORT_UNKNOWN_RULE;

export interface InPortUnknownViolation {
  rule: InPortUnknownRule;
  /**
   * `<PortName>.<methodName>:<paramName>` for interfaces and method-signature
   * type aliases; `<PortName>:<paramName>` for a bare call signature (a
   * function-type alias has no signature name to attach). Never a line number
   * and never the rendered message — same baseline-key doctrine as
   * ratchet-baseline.ts.
   */
  specifier: string;
  /** Full diagnostic — names the interface/alias, method, parameter, file. */
  message: string;
}

/**
 * Does this path point at a checkable in-port file?
 *
 * Cost bound: O(|filePath|) — one string normalization plus suffix/segment
 * checks. No AST work, no filesystem I/O.
 */
export function isInPortFile(filePath: string): boolean {
  // ts-morph paths are posix already, but the CLI's own predicates normalize
  // defensively (see countsAsContextExportSource) and a direct caller may not.
  const posix = filePath.replace(/\\/g, "/");
  if (posix.includes("/__tests__/")) return false;
  if (posix.includes("/templates/")) return false;
  if (/\.(test|spec)\.tsx?$/.test(posix)) return false;
  // Must precede the `.ts` suffix check: `*.d.ts` ends with `.ts` too, and an
  // ambient declaration is not an in-process boundary this rule owns.
  if (posix.endsWith(".d.ts")) return false;
  return posix.includes("/ports/in/") && posix.endsWith(".ts");
}

/**
 * Check one already-parsed source file for `in-port-unknown` violations.
 *
 * Cost bound: O(I + T + P) over exported interfaces I, exported type aliases
 * T and their method/call-signature parameters P in this single file. Type
 * resolution per parameter is cycle-guarded (`visited`) and reflection-guarded
 * (try/catch), so malformed ASTs and checker traps cost one bounded attempt
 * and never throw.
 */
export function checkInPortUnknown(file: SourceFile): InPortUnknownViolation[] {
  const violations: InPortUnknownViolation[] = [];

  let filePath = "";
  try {
    filePath = file.getFilePath();
  } catch {
    return violations;
  }
  if (!isInPortFile(filePath)) return violations;

  const push = (specifier: string, message: string): void => {
    violations.push({ rule: IN_PORT_UNKNOWN_RULE, specifier, message });
  };

  // ── Exported interfaces ────────────────────────────────────────────────────
  try {
    for (const iface of file.getInterfaces()) {
      try {
        if (!iface.isExported()) continue;
        const ifaceName = iface.getName();
        for (const method of iface.getMethods()) {
          const methodName = safeName(() => method.getName());
          for (const param of method.getParameters()) {
            if (parameterAcceptsUnknown(param)) {
              const paramName = safeName(() => param.getName());
              push(
                `${ifaceName}.${methodName}:${paramName}`,
                `in-port '${ifaceName}' accepts 'unknown' — ${ifaceName}.${methodName} parameter '${paramName}' must use a typed/Validated request contract (${filePath})`,
              );
            }
          }
        }
      } catch {
        // A malformed interface is skipped, not fatal — the run must never
        // crash on hostile AST shapes (lane H4 refusal 6).
      }
    }
  } catch {
    // Unreachable short of a ts-morph internals bug; guarded for the same
    // never-crash contract.
  }

  // ── Exported type aliases ──────────────────────────────────────────────────
  try {
    for (const alias of file.getTypeAliases()) {
      try {
        if (!alias.isExported()) continue;
        const aliasName = alias.getName();
        inspectAliasSignatures(aliasName, alias, filePath, push);
      } catch {
        // Skip a malformed alias, never crash.
      }
    }
  } catch {
    // Same never-crash contract.
  }

  return violations;
}

/**
 * Call/method signatures on an exported type alias:
 *
 *   export type P = (req: unknown) => Promise<void>;   // call signature
 *   export type P = { run(req: unknown): Promise<void> }; // method signature
 *
 * Both forms type an in-process boundary a caller can invoke, so both are
 * checked. Every checker call is guarded — an alias whose type cannot be
 * resolved is skipped, not fatal.
 */
function inspectAliasSignatures(
  aliasName: string,
  alias: { getType(): Type },
  filePath: string,
  push: (specifier: string, message: string) => void,
): void {
  let type: Type | undefined;
  try {
    type = alias.getType();
  } catch {
    return;
  }
  if (type === undefined) return;

  // Call signatures (function-type aliases, and `{ (req: T): R }` literals).
  try {
    for (const signature of type.getCallSignatures()) {
      let declaration: unknown;
      try {
        declaration = signature.getDeclaration();
      } catch {
        continue;
      }
      const params = parametersOf(declaration);
      if (params === undefined) continue;
      for (const param of params) {
        if (!parameterAcceptsUnknown(param)) continue;
        const paramName = safeName(() => param.getName());
        // A call signature has no name of its own — the alias IS the name.
        push(
          `${aliasName}:${paramName}`,
          `in-port type alias '${aliasName}' accepts 'unknown' — ${aliasName} call-signature parameter '${paramName}' must use a typed/Validated request contract (${filePath})`,
        );
      }
    }
  } catch {
    // Checker trap on the call-signature list — skip this facet.
  }

  // Method signatures reachable as properties of the alias type.
  try {
    for (const property of type.getProperties()) {
      let declarations;
      try {
        declarations = property.getDeclarations();
      } catch {
        continue;
      }
      for (const declaration of declarations) {
        if (declaration.getKind() !== SyntaxKind.MethodSignature) continue;
        const method = declaration as MethodSignature;
        const methodName = safeName(() => method.getName());
        for (const param of method.getParameters()) {
          if (!parameterAcceptsUnknown(param)) continue;
          const paramName = safeName(() => param.getName());
          push(
            `${aliasName}.${methodName}:${paramName}`,
            `in-port type alias '${aliasName}' accepts 'unknown' — ${aliasName}.${methodName} parameter '${paramName}' must use a typed/Validated request contract (${filePath})`,
          );
        }
      }
    }
  } catch {
    // Checker trap on the property list — skip this facet.
  }
}

/**
 * `getParameters()` exists on every node a call/method signature can declare
 * (FunctionTypeNode, CallSignatureDeclaration, MethodSignatureDeclaration) but
 * not on the `Signature` wrapper itself, so probe duck-typed and refuse
 * anything else rather than assume.
 */
function parametersOf(
  declaration: unknown,
): ParameterDeclaration[] | undefined {
  if (
    declaration === null ||
    typeof declaration !== "object" ||
    typeof (declaration as { getParameters?: unknown }).getParameters !==
      "function"
  ) {
    return undefined;
  }
  try {
    return (
      declaration as { getParameters(): ParameterDeclaration[] }
    ).getParameters();
  } catch {
    return undefined;
  }
}

/**
 * Does this parameter accept `unknown`?
 *
 * Two independent probes, both guarded:
 *  1. Syntactic — the type node literally spells `unknown`. O(text length),
 *     no checker involvement, catches the direct form even if the checker is
 *     in a state where resolution would trap.
 *  2. Semantic — the checker's type for the parameter is (or resolves to)
 *     `unknown`, with a fresh `visited: Set<Type>` cycle guard per parameter
 *     (single-hop type-alias descent included; bounded by the number of
 *     distinct types reachable from the parameter).
 */
function parameterAcceptsUnknown(param: ParameterDeclaration): boolean {
  try {
    if (spellsUnknown(param.getTypeNode())) return true;
  } catch {
    // Missing/unreadable type node — fall through to the semantic probe.
  }
  try {
    return resolvesToUnknown(param.getType(), new Set());
  } catch {
    // Unresolvable parameter (no type node, error type, checker trap) is
    // handled by resolveToUnknown's own guards; a throw here is a trap it
    // did not anticipate — safe result: not unknown.
    return false;
  }
}

/** `unknown` spelled verbatim — the direct form of the violation. */
function spellsUnknown(node: { getText(): string } | undefined): boolean {
  if (node === undefined) return false;
  try {
    return node.getText().trim() === "unknown";
  } catch {
    return false;
  }
}

/**
 * Does this type — including unions, intersections and a single hop through a
 * type alias — resolve to `unknown`?
 *
 * `visited` is the cycle guard: recursive aliases (`type A = B; type B = A`)
 * terminate when a type already in flight is reached again. The set is bounded
 * by the number of distinct types reachable from the originating parameter, so
 * resolution is finite; every facet inside is individually try/catch-guarded,
 * and a facet that throws is skipped rather than aborting the walk.
 */
function resolvesToUnknown(
  inputType: Type | undefined,
  visited: Set<Type>,
): boolean {
  if (inputType === undefined || visited.has(inputType)) return false;
  visited.add(inputType);
  const type = inputType;

  try {
    if (type.isUnknown()) return true;
  } catch {
    // Unreadable flags — nothing more can be learned from this node's own
    // kind; the compound/alias facets below may still resolve.
  }

  try {
    for (const member of type.getUnionTypes()) {
      if (resolvesToUnknown(member, visited)) return true;
    }
  } catch {
    // Not a union (or the union walk trapped) — skip.
  }

  try {
    for (const member of type.getIntersectionTypes()) {
      if (resolvesToUnknown(member, visited)) return true;
    }
  } catch {
    // Not an intersection — skip.
  }

  // Single-hop alias resolution: the checker hands back the ALIASED type for
  // transparent aliases (`type MyReq = unknown` already reads as unknown), but
  // an opaque alias wrapper is possible — descend into the alias declaration's
  // own type node once, guarded, rather than trusting the wrapper.
  try {
    const declarations = type.getAliasSymbol()?.getDeclarations() ?? [];
    for (const declaration of declarations) {
      if (declaration.getKind() !== SyntaxKind.TypeAliasDeclaration) continue;
      if (
        spellsUnknown(
          (declaration as { getTypeNode?: () => unknown }).getTypeNode?.() as
            | { getText(): string }
            | undefined,
        )
      ) {
        return true;
      }
    }
  } catch {
    // Alias symbol unreachable — the hop is unavailable, not fatal.
  }

  return false;
}

function safeName(getName: () => string): string {
  try {
    const name = getName();
    return typeof name === "string" && name.length > 0 ? name : "<unnamed>";
  } catch {
    return "<unnamed>";
  }
}
