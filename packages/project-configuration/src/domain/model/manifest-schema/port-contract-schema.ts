import { z } from "zod";

/**
 * Typed port-contract validation for `layers.application.ports.{in,out}[n].contracts`.
 *
 * Trust boundary (H1): manifest YAML is untrusted input. JavaScript provides no
 * side-effect-free way to detect a transparent `Proxy`, so this module makes no
 * attempt to; instead every reflection call (`Object.getPrototypeOf`,
 * `Object.getOwnPropertyNames`, `Object.getOwnPropertySymbols`,
 * `Object.getOwnPropertyDescriptor`) is wrapped in `try / catch` and any thrown
 * trap or reflection error is mapped to `HOSTILE_INPUT`. Getters are detected
 * via property descriptors and are NEVER invoked; `z.object(...)` is never run
 * over untrusted `contracts:` data before this validator executes.
 *
 * Per-function cost bounds: `validatePortContractNode` decrements a shared
 * `MAX_CONTRACT_NODES` budget on every entry and refuses in O(1) once it is
 * exhausted, so total recursion work is bounded to O(MAX_CONTRACT_NODES)
 * regardless of branching factor; own-key lists longer than
 * `MAX_CONTRACT_FIELDS` are refused before any descriptor inspection or
 * recursion; `enum.values` length is checked before iterating its indices.
 */

/** Maximum nesting depth of a contract AST (root node counts as depth 1). */
export const MAX_CONTRACT_DEPTH = 8;
/** Maximum entries per object `fields` map and per `enum.values` array. */
export const MAX_CONTRACT_FIELDS = 64;
/** Maximum total AST nodes visited per contract (shared work budget). */
export const MAX_CONTRACT_NODES = 1024;
/** Runtime module assumed by `generator.codec` when none is named. */
export const DEFAULT_CODEC_RUNTIME_MODULE = "@fleet/shared";

/** Field names that can never appear in an object contract's `fields` map. */
export const RESERVED_FIELD_NAMES: ReadonlySet<string> = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

/** Every field kind a port contract node may carry. */
export const PORT_CONTRACT_KINDS = [
  "object",
  "array",
  "string",
  "integer",
  "number",
  "boolean",
  "enum",
  "literal",
  "nullable",
] as const;

export type PortContractKind = (typeof PORT_CONTRACT_KINDS)[number];

/** Keys a contract node may carry, per kind. Anything else is refused. */
const KIND_ALLOWED_KEYS: Record<PortContractKind, readonly string[]> = {
  object: ["kind", "exact", "fields"],
  array: ["kind", "items", "maxItems"],
  string: ["kind", "maxLength", "pattern"],
  integer: ["kind", "min", "max"],
  number: ["kind", "min", "max"],
  boolean: ["kind"],
  enum: ["kind", "values"],
  literal: ["kind", "value"],
  nullable: ["kind", "of"],
};

export type PortContractErrorCode =
  | "MALFORMED_CONTRACT"
  | "UNKNOWN_KIND"
  | "MISSING_BOUND"
  | "UNSUPPORTED_SHAPE"
  | "MAX_DEPTH_EXCEEDED"
  | "MAX_FIELDS_EXCEEDED"
  | "MAX_NODES_EXCEEDED"
  | "RESERVED_FIELD_NAME"
  | "HOSTILE_INPUT";

/** Typed failure surface for every refusal path in this module. */
export class PortContractValidationError extends Error {
  readonly code: PortContractErrorCode;
  readonly portName: string;
  readonly contractPath: string;

  constructor(
    code: PortContractErrorCode,
    portName: string,
    contractPath: string,
    message: string,
  ) {
    super(
      `Port contract validation failed (${code}) for port "${portName}" at ${contractPath}: ${message}`,
    );
    this.name = "PortContractValidationError";
    this.code = code;
    this.portName = portName;
    this.contractPath = contractPath;
  }
}

export type PortContractValidationResult =
  | { ok: true }
  | { ok: false; error: PortContractValidationError };

/** Shared, per-contract work budget (see MAX_CONTRACT_NODES). */
interface NodeBudget {
  nodesRemaining: number;
}

type Fail = (code: PortContractErrorCode, message: string) => {
  ok: false;
  error: PortContractValidationError;
};

function makeFail(
  portName: string,
  contractPath: string,
): Fail {
  return (code, message) => ({
    ok: false,
    error: new PortContractValidationError(
      code,
      portName,
      contractPath,
      message,
    ),
  });
}

function isPlainObject(
  raw: unknown,
  fail: Fail,
): { ok: true } | { ok: false; error: PortContractValidationError } {
  if (raw === null || raw === undefined || typeof raw !== "object") {
    return fail(
      "MALFORMED_CONTRACT",
      "expected a plain object, got null, undefined, a primitive, or an array",
    );
  }
  if (Array.isArray(raw)) {
    return fail("MALFORMED_CONTRACT", "arrays are not valid contract nodes");
  }
  let proto: object | null;
  try {
    proto = Object.getPrototypeOf(raw);
  } catch {
    return fail(
      "HOSTILE_INPUT",
      "prototype inspection threw (hostile object or proxy trap)",
    );
  }
  if (proto !== Object.prototype && proto !== null) {
    return fail(
      "HOSTILE_INPUT",
      "non-plain prototype (class instance, Map, Set, Date, or proxy target)",
    );
  }
  return { ok: true };
}

/** Own-key enumeration that never inspects descriptors or values. */
function ownKeys(
  raw: object,
  fail: Fail,
): { names: string[]; symbols: symbol[] } | { error: PortContractValidationError } {
  try {
    const names = Object.getOwnPropertyNames(raw);
    const symbols = Object.getOwnPropertySymbols(raw);
    return { names, symbols };
  } catch {
    return {
      error: fail(
        "HOSTILE_INPUT",
        "own-key enumeration threw (hostile proxy trap)",
      ).error,
    };
  }
}

/**
 * Read one own property via its descriptor WITHOUT invoking any getter.
 * Returns undefined when the key is absent; fails HOSTILE_INPUT on accessor
 * descriptors, symbol keys, and throwing reflection.
 */
function readOwnKey(
  raw: object,
  key: string,
  names: string[],
  fail: Fail,
):
  | { present: false }
  | { present: true; value: unknown }
  | { error: PortContractValidationError } {
  if (!names.includes(key)) {
    return { present: false };
  }
  try {
    const desc = Object.getOwnPropertyDescriptor(raw, key);
    if (desc === undefined) {
      return { present: false };
    }
    if (desc.get !== undefined || desc.set !== undefined) {
      return {
        error: fail(
          "HOSTILE_INPUT",
          `property "${key}" is an accessor; getters are never invoked`,
        ).error,
      };
    }
    return { present: true, value: desc.value };
  } catch {
    return {
      error: fail(
        "HOSTILE_INPUT",
        `descriptor inspection for "${key}" threw (hostile proxy trap)`,
      ).error,
    };
  }
}

function isPositiveFiniteInteger(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value > 0 &&
    Number.isFinite(value)
  );
}

/**
 * Validate one contract AST node. `depth` counts contract nodes from the root
 * (root = 1); nodes deeper than MAX_CONTRACT_DEPTH are refused.
 */
function validatePortContractNode(
  raw: unknown,
  portName: string,
  contractPath: string,
  depth: number,
  budget: NodeBudget,
): PortContractValidationResult {
  const fail = makeFail(portName, contractPath);

  // O(1) total-work budget check, before anything else can recurse.
  budget.nodesRemaining -= 1;
  if (budget.nodesRemaining < 0) {
    return fail(
      "MAX_NODES_EXCEEDED",
      `contract exceeds MAX_CONTRACT_NODES (${MAX_CONTRACT_NODES}) total nodes`,
    );
  }

  // O(1) null / primitive / depth checks.
  if (raw === null || raw === undefined || typeof raw !== "object") {
    return fail(
      "MALFORMED_CONTRACT",
      "expected a contract node object, got null, undefined, or a primitive",
    );
  }
  if (Array.isArray(raw)) {
    return fail(
      "MALFORMED_CONTRACT",
      "arrays are not valid contract nodes",
    );
  }
  if (depth > MAX_CONTRACT_DEPTH) {
    return fail(
      "MAX_DEPTH_EXCEEDED",
      `contract nesting exceeds MAX_CONTRACT_DEPTH (${MAX_CONTRACT_DEPTH})`,
    );
  }

  // O(1) prototype check (also rejects Map/Set/Date/class instances, whose
  // prototype is neither Object.prototype nor null).
  const plain = isPlainObject(raw, fail);
  if (!plain.ok) {
    return { ok: false, error: plain.error };
  }

  // Own-key enumeration: O(K_raw) materialization; symbol keys and oversized
  // key lists are refused BEFORE any descriptor inspection or recursion.
  const keys = ownKeys(raw, fail);
  if ("error" in keys) {
    return { ok: false, error: keys.error };
  }
  if (keys.symbols.length > 0) {
    return fail(
      "HOSTILE_INPUT",
      "symbol-keyed properties are refused on contract nodes",
    );
  }
  if (keys.names.length > MAX_CONTRACT_FIELDS) {
    return fail(
      "MAX_FIELDS_EXCEEDED",
      `more than MAX_CONTRACT_FIELDS (${MAX_CONTRACT_FIELDS}) keys on one node`,
    );
  }

  // kind dispatch.
  const kindRead = readOwnKey(raw, "kind", keys.names, fail);
  if ("error" in kindRead) {
    return { ok: false, error: kindRead.error };
  }
  if (!kindRead.present) {
    return fail("UNKNOWN_KIND", "contract node is missing `kind`");
  }
  const kind = kindRead.value;
  if (
    typeof kind !== "string" ||
    !PORT_CONTRACT_KINDS.includes(kind as PortContractKind)
  ) {
    return fail(
      "UNKNOWN_KIND",
      `\`kind\` must be one of ${PORT_CONTRACT_KINDS.join(", ")}`,
    );
  }

  // Unknown keys are refused on every schema node.
  const allowed = KIND_ALLOWED_KEYS[kind as PortContractKind];
  for (const name of keys.names) {
    if (!allowed.includes(name)) {
      return fail(
        "MALFORMED_CONTRACT",
        `unknown key "${name}" on a "${kind}" contract node`,
      );
    }
  }

  switch (kind as PortContractKind) {
    case "object": {
      const exact = readOwnKey(raw, "exact", keys.names, fail);
      if ("error" in exact) {
        return { ok: false, error: exact.error };
      }
      // Objects are always exact: `exact: true` is accepted, `exact` omitted
      // defaults to true, any other value is refused.
      if (exact.present && exact.value !== true) {
        return fail(
          "UNSUPPORTED_SHAPE",
          "object contracts require `exact: true` (objects are always exact)",
        );
      }
      const fieldsRead = readOwnKey(raw, "fields", keys.names, fail);
      if ("error" in fieldsRead) {
        return { ok: false, error: fieldsRead.error };
      }
      if (!fieldsRead.present) {
        return fail("UNSUPPORTED_SHAPE", "object contract is missing `fields`");
      }
      const fields = fieldsRead.value;
      if (
        fields === null ||
        fields === undefined ||
        typeof fields !== "object" ||
        Array.isArray(fields)
      ) {
        return fail(
          "UNSUPPORTED_SHAPE",
          "`fields` must be a plain object mapping field names to contract nodes",
        );
      }
      const plainFields = isPlainObject(fields, fail);
      if (!plainFields.ok) {
        return { ok: false, error: plainFields.error };
      }
      const fieldKeys = ownKeys(fields, fail);
      if ("error" in fieldKeys) {
        return { ok: false, error: fieldKeys.error };
      }
      if (fieldKeys.symbols.length > 0) {
        return fail(
          "HOSTILE_INPUT",
          "symbol-keyed properties are refused in `fields`",
        );
      }
      // Refuse oversized field maps BEFORE any descriptor inspection.
      if (fieldKeys.names.length > MAX_CONTRACT_FIELDS) {
        return fail(
          "MAX_FIELDS_EXCEEDED",
          `more than MAX_CONTRACT_FIELDS (${MAX_CONTRACT_FIELDS}) fields in one object`,
        );
      }
      for (const fieldName of fieldKeys.names) {
        const fieldFail = makeFail(
          portName,
          `${contractPath}.fields.${fieldName}`,
        );
        if (RESERVED_FIELD_NAMES.has(fieldName)) {
          return fieldFail(
            "RESERVED_FIELD_NAME",
            `field name "${fieldName}" is reserved and always refused`,
          );
        }
        try {
          const desc = Object.getOwnPropertyDescriptor(fields, fieldName);
          if (desc === undefined) {
            return fieldFail(
              "HOSTILE_INPUT",
              `field "${fieldName}" has no own data descriptor`,
            );
          }
          if (desc.get !== undefined || desc.set !== undefined) {
            return fieldFail(
              "HOSTILE_INPUT",
              `field "${fieldName}" is an accessor; getters are never invoked`,
            );
          }
          const childPath = `${contractPath}.fields.${fieldName}`;
          const child = desc.value;
          if (child === null || typeof child !== "object" || Array.isArray(child)) {
            return fieldFail(
              "MALFORMED_CONTRACT",
              "field value must be a contract node or an `{ optional }` wrapper",
            );
          }
          const childKeys = ownKeys(child, fieldFail);
          if ("error" in childKeys) {
            return { ok: false, error: childKeys.error };
          }
          if (childKeys.symbols.length > 0) {
            return fieldFail(
              "HOSTILE_INPUT",
              "symbol-keyed properties are refused on contract nodes",
            );
          }
          let inner: unknown = child;
          let innerPath = childPath;
          // `{ optional: <node> }` wrapper: exactly one own key, named optional.
          if (!childKeys.names.includes("kind")) {
            if (
              childKeys.names.length !== 1 ||
              childKeys.names[0] !== "optional"
            ) {
              return fieldFail(
                "MALFORMED_CONTRACT",
                `unknown keys (${childKeys.names.join(", ")}) on an \`{ optional }\` wrapper`,
              );
            }
            const optDesc = Object.getOwnPropertyDescriptor(child, "optional");
            if (optDesc === undefined) {
              return fieldFail(
                "MALFORMED_CONTRACT",
                "missing `optional` on the wrapper",
              );
            }
            if (optDesc.get !== undefined || optDesc.set !== undefined) {
              return fieldFail(
                "HOSTILE_INPUT",
                "`optional` is an accessor; getters are never invoked",
              );
            }
            inner = optDesc.value;
            innerPath = `${childPath}.optional`;
          }
          const innerResult = validatePortContractNode(
            inner,
            portName,
            innerPath,
            depth + 1,
            budget,
          );
          if (!innerResult.ok) {
            return innerResult;
          }
        } catch (err) {
          return fail(
            "HOSTILE_INPUT",
            `reflection on field "${fieldName}" threw: ${String(err)}`,
          );
        }
      }
      return { ok: true };
    }

    case "array": {
      const maxItems = readOwnKey(raw, "maxItems", keys.names, fail);
      if ("error" in maxItems) {
        return { ok: false, error: maxItems.error };
      }
      if (!maxItems.present || !isPositiveFiniteInteger(maxItems.value)) {
        return fail(
          "MISSING_BOUND",
          "array contracts require an explicit positive finite integer `maxItems`",
        );
      }
      const items = readOwnKey(raw, "items", keys.names, fail);
      if ("error" in items) {
        return { ok: false, error: items.error };
      }
      if (!items.present) {
        return fail("UNSUPPORTED_SHAPE", "array contract is missing `items`");
      }
      return validatePortContractNode(
        items.value,
        portName,
        `${contractPath}.items`,
        depth + 1,
        budget,
      );
    }

    case "string": {
      const maxLength = readOwnKey(raw, "maxLength", keys.names, fail);
      if ("error" in maxLength) {
        return { ok: false, error: maxLength.error };
      }
      if (!maxLength.present || !isPositiveFiniteInteger(maxLength.value)) {
        return fail(
          "MISSING_BOUND",
          "string contracts require an explicit positive finite integer `maxLength`",
        );
      }
      const pattern = readOwnKey(raw, "pattern", keys.names, fail);
      if ("error" in pattern) {
        return { ok: false, error: pattern.error };
      }
      if (pattern.present) {
        if (typeof pattern.value !== "string") {
          return fail(
            "UNSUPPORTED_SHAPE",
            "`pattern` must be a string source of a valid RegExp",
          );
        }
        try {
          new RegExp(pattern.value);
        } catch {
          return fail(
            "UNSUPPORTED_SHAPE",
            `\`pattern\` is not a valid RegExp source: ${JSON.stringify(pattern.value)}`,
          );
        }
      }
      return { ok: true };
    }

    case "integer":
    case "number": {
      for (const boundKey of ["min", "max"] as const) {
        const bound = readOwnKey(raw, boundKey, keys.names, fail);
        if ("error" in bound) {
          return { ok: false, error: bound.error };
        }
        if (bound.present) {
          if (
            typeof bound.value !== "number" ||
            !Number.isFinite(bound.value)
          ) {
            return fail(
              "UNSUPPORTED_SHAPE",
              `\`${boundKey}\` must be a finite number`,
            );
          }
        }
      }
      const min = readOwnKey(raw, "min", keys.names, fail);
      const max = readOwnKey(raw, "max", keys.names, fail);
      if ("error" in min) {
        return { ok: false, error: min.error };
      }
      if ("error" in max) {
        return { ok: false, error: max.error };
      }
      if (
        min.present &&
        max.present &&
        (min.value as number) > (max.value as number)
      ) {
        return fail(
          "UNSUPPORTED_SHAPE",
          "`min` must be <= `max`",
        );
      }
      return { ok: true };
    }

    case "boolean":
      return { ok: true };

    case "enum": {
      const values = readOwnKey(raw, "values", keys.names, fail);
      if ("error" in values) {
        return { ok: false, error: values.error };
      }
      if (!values.present) {
        return fail("UNSUPPORTED_SHAPE", "enum contract is missing `values`");
      }
      const list = values.value;
      // Non-array iterables, non-iterables, and array-likes are refused here;
      // only genuine dense string arrays are accepted. `Array.isArray` can
      // throw on a revoked proxy and the `length` read can throw on a proxy
      // with a hostile get trap — both are caught and mapped to HOSTILE_INPUT
      // (H1 review round 1). The length is cached so later loop reads never
      // touch the hostile object again.
      let isArray: boolean;
      let arrayLength = 0;
      try {
        isArray = Array.isArray(list);
        if (isArray) {
          arrayLength = (list as unknown[]).length;
        }
      } catch (err) {
        return fail(
          "HOSTILE_INPUT",
          `array inspection on \`values\` threw: ${String(err)}`,
        );
      }
      if (!isArray) {
        return fail(
          "HOSTILE_INPUT",
          "`values` must be a genuine array, not an iterable, array-like, or other object",
        );
      }
      const arr = list as unknown[];
      // Enormous lengths are refused in O(1), BEFORE any index iteration.
      if (arrayLength > MAX_CONTRACT_FIELDS) {
        return fail(
          "MAX_FIELDS_EXCEEDED",
          `enum \`values\` exceeds MAX_CONTRACT_FIELDS (${MAX_CONTRACT_FIELDS})`,
        );
      }
      if (arrayLength === 0) {
        return fail(
          "UNSUPPORTED_SHAPE",
          "enum `values` must be a non-empty array of strings",
        );
      }
      for (let i = 0; i < arrayLength; i += 1) {
        try {
          const desc = Object.getOwnPropertyDescriptor(arr, i);
          if (desc === undefined) {
            return fail(
              "HOSTILE_INPUT",
              `enum \`values\` has a hole at index ${i}`,
            );
          }
          if (desc.get !== undefined || desc.set !== undefined) {
            return fail(
              "HOSTILE_INPUT",
              `enum \`values\`[${i}] is an accessor; getters are never invoked`,
            );
          }
          if (typeof desc.value !== "string") {
            return fail(
              "UNSUPPORTED_SHAPE",
              `enum \`values\`[${i}] must be a string`,
            );
          }
        } catch (err) {
          return fail(
            "HOSTILE_INPUT",
            `descriptor inspection on \`values\`[${i}] threw: ${String(err)}`,
          );
        }
      }
      return { ok: true };
    }

    case "literal": {
      const value = readOwnKey(raw, "value", keys.names, fail);
      if ("error" in value) {
        return { ok: false, error: value.error };
      }
      if (!value.present) {
        return fail("UNSUPPORTED_SHAPE", "literal contract is missing `value`");
      }
      const v = value.value;
      const isPrimitive =
        v === null ||
        typeof v === "string" ||
        (typeof v === "number" && Number.isFinite(v)) ||
        typeof v === "boolean";
      if (!isPrimitive) {
        return fail(
          "UNSUPPORTED_SHAPE",
          "literal `value` must be a string, finite number, boolean, or null",
        );
      }
      return { ok: true };
    }

    case "nullable": {
      const of = readOwnKey(raw, "of", keys.names, fail);
      if ("error" in of) {
        return { ok: false, error: of.error };
      }
      if (!of.present) {
        return fail("UNSUPPORTED_SHAPE", "nullable contract is missing `of`");
      }
      return validatePortContractNode(
        of.value,
        portName,
        `${contractPath}.of`,
        depth + 1,
        budget,
      );
    }
  }
}

/**
 * Validate a port's `contracts:` block. Never invokes getters; every failure
 * path returns a typed `{ ok: false, error: PortContractValidationError }`.
 */
export function validatePortContract(
  contracts: unknown,
  portName: string,
): PortContractValidationResult {
  const contractPath = "contracts";
  const fail = makeFail(portName, contractPath);

  const plain = isPlainObject(contracts, fail);
  if (!plain.ok) {
    return { ok: false, error: plain.error };
  }
  const keys = ownKeys(contracts as object, fail);
  if ("error" in keys) {
    return { ok: false, error: keys.error };
  }
  if (keys.symbols.length > 0) {
    return fail(
      "HOSTILE_INPUT",
      "symbol-keyed properties are refused on the contracts block",
    );
  }
  for (const name of keys.names) {
    if (name !== "request") {
      return fail(
        "MALFORMED_CONTRACT",
        `unknown key "${name}" on the contracts block; only \`request\` is allowed`,
      );
    }
  }
  if (!keys.names.includes("request")) {
    return fail(
      "MALFORMED_CONTRACT",
      "contracts block is missing `request`",
    );
  }
  const request = readOwnKey(contracts as object, "request", keys.names, fail);
  if ("error" in request) {
    return { ok: false, error: request.error };
  }
  if (!request.present) {
    return fail("MALFORMED_CONTRACT", "contracts block is missing `request`");
  }
  return validatePortContractNode(
    request.value,
    portName,
    `${contractPath}.request`,
    1,
    { nodesRemaining: MAX_CONTRACT_NODES },
  );
}

/**
 * Walk every application-layer port of every bounded context in a manifest
 * (raw parsed YAML or a validated manifest — both are plain data) and validate
 * each declared `contracts:` block. Ports without a `contracts` own property
 * pass untouched; domain-layer ports are never visited.
 *
 * Cost: O(C * P) contexts-and-ports with O(MAX_CONTRACT_NODES) per contract.
 */
/**
 * Descriptor-based own-property read. Never invokes getters (accessors are
 * reported as `error`) and never lets a proxy trap escape (thrown traps are
 * reported as `error`).
 */
function readOwnData(
  value: object,
  key: string,
): { present: boolean; value?: unknown; error?: string } {
  try {
    const desc = Object.getOwnPropertyDescriptor(value, key);
    if (desc === undefined) {
      return { present: false };
    }
    if (desc.get !== undefined || desc.set !== undefined) {
      return { present: false, error: "accessor; getters are never invoked" };
    }
    return { present: true, value: desc.value };
  } catch (err) {
    return {
      present: false,
      error: `reflection threw: ${String(err)}`,
    };
  }
}

/**
 * `Array.isArray` plus a density check. A revoked proxy throws inside
 * `Array.isArray`; a sparse array has holes — both are hostile. A dense
 * genuine array is reported as dense; anything else as not-an-array.
 */
function inspectDenseArray(
  value: unknown,
): { kind: "dense" } | { kind: "not-array" } | { kind: "hostile"; message: string } {
  try {
    if (!Array.isArray(value)) {
      return { kind: "not-array" };
    }
    const length = value.length;
    for (let i = 0; i < length; i += 1) {
      if (!(i in value)) {
        return {
          kind: "hostile",
          message: `sparse array (hole at index ${i})`,
        };
      }
    }
    return { kind: "dense" };
  } catch (err) {
    return { kind: "hostile", message: `array inspection threw: ${String(err)}` };
  }
}

function hostile(
  portName: string,
  contractPath: string,
  message: string,
): PortContractValidationResult {
  return {
    ok: false,
    error: new PortContractValidationError("HOSTILE_INPUT", portName, contractPath, message),
  };
}

/**
 * Walk every application-layer port of every bounded context in a manifest
 * (raw parsed YAML or a validated manifest — both are plain data) and validate
 * each declared `contracts:` block. Ports without a `contracts` own property
 * pass untouched; domain-layer ports are never visited.
 *
 * H1 review round 1: every property read (manifest, bounded_contexts, layers,
 * port lists, port names) goes through descriptor reads wrapped in try/catch —
 * a getter, a throwing proxy trap, or a non-dense array yields HOSTILE_INPUT,
 * never `{ ok: true }` and never a throw.
 *
 * Cost: O(C * P) contexts-and-ports with O(MAX_CONTRACT_NODES) per contract.
 */
export function validateManifestPortContracts(
  manifest: unknown,
): PortContractValidationResult {
  if (manifest === null || typeof manifest !== "object") {
    return { ok: true };
  }
  // `Array.isArray` can throw on a revoked proxy — never let it escape.
  const manifestShape = inspectDenseArray(manifest);
  if (manifestShape.kind === "hostile") {
    return hostile(
      "<unnamed>",
      "manifest",
      manifestShape.message,
    );
  }
  if (manifestShape.kind === "dense") {
    return { ok: true };
  }
  const boundedContextsRead = readOwnData(
    manifest as object,
    "bounded_contexts",
  );
  if (boundedContextsRead.error !== undefined) {
    return hostile(
      "<unnamed>",
      "manifest.bounded_contexts",
      boundedContextsRead.error,
    );
  }
  if (!boundedContextsRead.present) {
    return { ok: true };
  }
  const contexts = boundedContextsRead.value;
  const contextsShape = inspectDenseArray(contexts);
  if (contextsShape.kind === "hostile") {
    return hostile(
      "<unnamed>",
      "manifest.bounded_contexts",
      contextsShape.message,
    );
  }
  if (contextsShape.kind !== "dense") {
    return { ok: true };
  }
  for (const context of contexts as unknown[]) {
    if (context === null || typeof context !== "object") {
      continue;
    }
    const contextShape = inspectDenseArray(context);
    if (contextShape.kind === "hostile") {
      return hostile(
        "<unnamed>",
        "bounded_contexts",
        contextShape.message,
      );
    }
    if (contextShape.kind === "dense") {
      continue;
    }
    const layersRead = readOwnData(context, "layers");
    if (layersRead.error !== undefined) {
      return hostile(
        "<unnamed>",
        "bounded_contexts.layers",
        layersRead.error,
      );
    }
    if (!layersRead.present) {
      continue;
    }
    const layers = layersRead.value;
    if (layers === null || typeof layers !== "object") {
      continue;
    }
    const applicationRead = readOwnData(layers, "application");
    if (applicationRead.error !== undefined) {
      return hostile(
        "<unnamed>",
        "bounded_contexts.layers.application",
        applicationRead.error,
      );
    }
    if (!applicationRead.present) {
      continue;
    }
    const application = applicationRead.value;
    if (application === null || typeof application !== "object") {
      continue;
    }
    const portsRead = readOwnData(application, "ports");
    if (portsRead.error !== undefined) {
      return hostile(
        "<unnamed>",
        "bounded_contexts.layers.application.ports",
        portsRead.error,
      );
    }
    if (!portsRead.present) {
      continue;
    }
    const ports = portsRead.value;
    if (ports === null || typeof ports !== "object") {
      continue;
    }
    for (const direction of ["in", "out"] as const) {
      const listRead = readOwnData(ports, direction);
      if (listRead.error !== undefined) {
        return hostile(
          "<unnamed>",
          `ports.${direction}`,
          listRead.error,
        );
      }
      if (!listRead.present) {
        continue;
      }
      const list = listRead.value;
      const listShape = inspectDenseArray(list);
      if (listShape.kind === "hostile") {
        return hostile(
          "<unnamed>",
          `ports.${direction}`,
          listShape.message,
        );
      }
      if (listShape.kind !== "dense") {
        continue;
      }
      for (const port of list as unknown[]) {
        if (port === null || typeof port !== "object") {
          continue;
        }
        const portShape = inspectDenseArray(port);
        if (portShape.kind === "hostile") {
          return hostile(
            "<unnamed>",
            `ports.${direction}`,
            portShape.message,
          );
        }
        if (portShape.kind === "dense") {
          continue;
        }
        const portNameRead = readOwnData(port, "name");
        if (portNameRead.error !== undefined) {
          return hostile(
            "<unnamed>",
            `ports.${direction}[name]`,
            portNameRead.error,
          );
        }
        const portName =
          portNameRead.present && typeof portNameRead.value === "string"
            ? portNameRead.value
            : "<unnamed>";
        const contractsRead = readOwnData(port, "contracts");
        if (contractsRead.error !== undefined) {
          return hostile(
            portName,
            "contracts",
            contractsRead.error,
          );
        }
        if (!contractsRead.present) {
          continue;
        }
        const result = validatePortContract(contractsRead.value, portName);
        if (!result.ok) {
          return result;
        }
      }
    }
  }
  return { ok: true };
}

/**
 * `generator.codec` block. When `codec` is present without `runtimeModule`,
 * the runtime module defaults to DEFAULT_CODEC_RUNTIME_MODULE ("@fleet/shared").
 */
export const CodecGeneratorBlockSchema = z
  .object({
    runtimeModule: z.string().min(1).default(DEFAULT_CODEC_RUNTIME_MODULE),
  })
  .passthrough();
