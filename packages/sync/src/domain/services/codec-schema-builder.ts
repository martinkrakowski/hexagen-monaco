// packages/sync/src/domain/services/codec-schema-builder.ts
//
// Hostile-input codec emitter (Lane H2). Every function here reads UNTRUSTED
// manifest / contract data (in-memory `SyncEngineOptions.manifest` bypasses the
// Zod loader, so nothing downstream can be trusted). All inspection goes through
// own-property descriptors and dense-array checks with an explicit trust
// boundary: reflection/Proxy trap throws are caught and refused, accessors are
// never invoked, sparse holes and array-likes are refused, and prototype-
// polluting keys are rejected before any read. No promise is made about
// transparent non-throwing Proxies — that is not detectable in pure JS.
//
// Cost bounds (why each check is affordable):
// - resolveRuntimeModule: O(1) — at most 2 own descriptors, string length <= 256.
// - buildCodecSchema: O(N) bounded by MAX_CONTRACT_DEPTH=16, MAX_OBJECT_FIELDS=64
//   per object, MAX_ENUM_VALUES=64, MAX_TOTAL_NODES=512 across the whole tree;
//   enormous `length` values are refused before allocating or iterating.
// - renderCodecModule: O(N log F), N <= 512 nodes, F <= 64 fields per object
//   (deterministic code-point key sorting).

/**
 * Local Result variant with E pinned to CodecGeneratorError (domain/result's
 * `ok` hardcodes E = Error, which is not assignable to the narrower error
 * this trust boundary must return).
 */
export type Result<T, E = CodecGeneratorError> =
  | { success: true; value: T }
  | { success: false; error: E };

export function ok<T>(value: T): Result<T, CodecGeneratorError> {
  return { success: true, value };
}

export function err(
  error: CodecGeneratorError,
): Result<never, CodecGeneratorError> {
  return { success: false, error };
}

/** Typed refusal reasons for the codec generator's trust boundary. */
export type CodecGeneratorErrorCode =
  | "MALFORMED_CONTRACT"
  | "HOSTILE_INPUT"
  | "PROTOTYPE_POLLUTION"
  | "BOUNDS_EXCEEDED"
  | "UNKNOWN_TYPE"
  | "MISSING_BOUND"
  | "UNSUPPORTED_SHAPE"
  | "MALFORMED_RUNTIME_MODULE";

/** Typed error carried by every `err(...)` this module returns. */
export class CodecGeneratorError extends Error {
  readonly code: CodecGeneratorErrorCode;
  readonly path: string;

  constructor(code: CodecGeneratorErrorCode, path: string, message: string) {
    super(message);
    this.name = "CodecGeneratorError";
    this.code = code;
    this.path = path;
  }
}

/** Keys that must never be read from untrusted objects. */
const POLLUTING_KEYS: ReadonlySet<string> = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

/** Hard bounds for contract traversal (see cost bounds in the header). */
export const MAX_CONTRACT_DEPTH = 16;
export const MAX_OBJECT_FIELDS = 64;
export const MAX_ENUM_VALUES = 64;
export const MAX_TOTAL_NODES = 512;

/**
 * Runtime API contract module providing `createCodec` / `Codec` / `CodecEnv` /
 * `Validated`. Configurable via `manifest.codec.runtimeModule` (Lane H1).
 */
export const DEFAULT_RUNTIME_MODULE = "@fleet/shared";

/**
 * Plainness check with the prototype read INSIDE the trap-catching boundary:
 * a Proxy whose `getPrototypeOf` trap throws must surface as HOSTILE_INPUT
 * (never escape as an exception) — it is answered here, through the same
 * typed-Result channel as every other reflection read.
 */
function isPlainObjectSafe(
  value: unknown,
  path: string,
): Result<boolean, CodecGeneratorError> {
  let proto: unknown;
  try {
    proto =
      typeof value === "object" && value !== null
        ? Object.getPrototypeOf(value)
        : undefined;
  } catch {
    return err(
      new CodecGeneratorError(
        "HOSTILE_INPUT",
        path,
        `reflection threw while reading the prototype at ${path} (hostile Proxy trap)`,
      ),
    );
  }
  return ok(
    typeof value === "object" &&
      value !== null &&
      (proto === Object.prototype || proto === null),
  );
}

/**
 * Read ONE own data property from untrusted input without ever invoking
 * accessors. Cost: O(1) — a plainness check (itself trap-catching), a Set
 * lookup and one descriptor read inside a trap-catching boundary.
 */
export function readOwnDataProperty(
  obj: unknown,
  key: string,
  path: string,
): Result<unknown, CodecGeneratorError> {
  const plain = isPlainObjectSafe(obj, path);
  if (!plain.success) return plain;
  if (!plain.value) {
    return err(
      new CodecGeneratorError(
        "HOSTILE_INPUT",
        path,
        `expected a plain object at ${path}, got non-plain or non-object value`,
      ),
    );
  }
  if (POLLUTING_KEYS.has(key)) {
    return err(
      new CodecGeneratorError(
        "PROTOTYPE_POLLUTION",
        path,
        `refusing prototype-polluting key "${key}" at ${path}`,
      ),
    );
  }
  let desc: PropertyDescriptor | undefined;
  try {
    desc = Object.getOwnPropertyDescriptor(obj, key);
  } catch {
    return err(
      new CodecGeneratorError(
        "HOSTILE_INPUT",
        path,
        `reflection threw while reading "${key}" at ${path} (hostile Proxy trap)`,
      ),
    );
  }
  if (desc && ("get" in desc || "set" in desc)) {
    return err(
      new CodecGeneratorError(
        "HOSTILE_INPUT",
        path,
        `refusing accessor property "${key}" at ${path} (getters are never invoked)`,
      ),
    );
  }
  return ok(desc?.value);
}

/**
 * Distinguish an ABSENT own property from an own DATA property whose value is
 * `undefined` — `readOwnDataProperty` returns `ok(undefined)` for both, so
 * callers that must reject any specified property (e.g. `minLength`) use this.
 * Cost: O(1) — one trap-catching descriptor read.
 */
export function hasOwnDataProperty(
  obj: unknown,
  key: string,
  path: string,
): Result<boolean, CodecGeneratorError> {
  const plain = isPlainObjectSafe(obj, path);
  if (!plain.success) return plain;
  if (!plain.value) {
    return err(
      new CodecGeneratorError(
        "HOSTILE_INPUT",
        path,
        `expected a plain object at ${path}, got non-plain or non-object value`,
      ),
    );
  }
  if (POLLUTING_KEYS.has(key)) {
    return err(
      new CodecGeneratorError(
        "PROTOTYPE_POLLUTION",
        path,
        `refusing prototype-polluting key "${key}" at ${path}`,
      ),
    );
  }
  let desc: PropertyDescriptor | undefined;
  try {
    desc = Object.getOwnPropertyDescriptor(obj, key);
  } catch {
    return err(
      new CodecGeneratorError(
        "HOSTILE_INPUT",
        path,
        `reflection threw while reading "${key}" at ${path} (hostile Proxy trap)`,
      ),
    );
  }
  return ok(desc !== undefined);
}

/**
 * Read an untrusted value as a DENSE array. Never touches `val.length` via an
 * ordinary property read (that would invoke a Proxy `get` trap outside the
 * boundary); the length comes from its own data descriptor. Cost: O(len) with
 * `len <= maxLen` enforced BEFORE any per-index work, so enormous lengths are
 * refused without allocating or iterating.
 */
export function readDenseArray(
  val: unknown,
  maxLen: number,
  path: string,
): Result<readonly unknown[], CodecGeneratorError> {
  let isArray: boolean;
  let proto: unknown;
  let lenDesc: PropertyDescriptor | undefined;
  try {
    isArray = Array.isArray(val);
    proto = isArray ? Object.getPrototypeOf(val) : undefined;
    lenDesc = isArray
      ? Object.getOwnPropertyDescriptor(val, "length")
      : undefined;
  } catch {
    return err(
      new CodecGeneratorError(
        "HOSTILE_INPUT",
        path,
        `reflection threw while inspecting array at ${path} (hostile Proxy trap)`,
      ),
    );
  }
  if (!isArray) {
    // Also covers array-likes (`{ length: N }`) — they are not arrays.
    return err(
      new CodecGeneratorError(
        "MALFORMED_CONTRACT",
        path,
        `expected a dense array at ${path}, got a non-array (or array-like) value`,
      ),
    );
  }
  if (proto !== Array.prototype && proto !== null) {
    return err(
      new CodecGeneratorError(
        "HOSTILE_INPUT",
        path,
        `array at ${path} has a non-plain prototype`,
      ),
    );
  }
  if (!lenDesc || "get" in lenDesc || "set" in lenDesc) {
    return err(
      new CodecGeneratorError(
        "HOSTILE_INPUT",
        path,
        `array "length" at ${path} is missing or an accessor`,
      ),
    );
  }
  const len = lenDesc.value;
  if (typeof len !== "number" || !Number.isSafeInteger(len) || len < 0) {
    return err(
      new CodecGeneratorError(
        "MALFORMED_CONTRACT",
        path,
        `array "length" at ${path} is not a non-negative safe integer`,
      ),
    );
  }
  if (len > maxLen) {
    return err(
      new CodecGeneratorError(
        "BOUNDS_EXCEEDED",
        path,
        `array at ${path} has ${len} items, exceeding the bound ${maxLen}`,
      ),
    );
  }
  const items: unknown[] = [];
  for (let i = 0; i < len; i++) {
    let desc: PropertyDescriptor | undefined;
    try {
      desc = Object.getOwnPropertyDescriptor(val, String(i));
    } catch {
      return err(
        new CodecGeneratorError(
          "HOSTILE_INPUT",
          path,
          `reflection threw while reading index ${i} at ${path}`,
        ),
      );
    }
    if (!desc) {
      return err(
        new CodecGeneratorError(
          "HOSTILE_INPUT",
          path,
          `sparse array hole at index ${i} of ${path}`,
        ),
      );
    }
    if ("get" in desc || "set" in desc) {
      return err(
        new CodecGeneratorError(
          "HOSTILE_INPUT",
          path,
          `accessor at index ${i} of ${path} (getters are never invoked)`,
        ),
      );
    }
    items.push(desc.value);
  }
  return ok(items);
}

/**
 * Literal schema tree handed to the runtime `createCodec` (Lane H1 contract).
 * Objects are always exact; every bounded kind carries an explicit positive
 * bound; no `minLength` is emitted.
 */
export type CodecSchemaLiteral =
  | {
      kind: "object";
      exact: true;
      fields: Record<string, CodecSchemaLiteral>;
    }
  | { kind: "array"; items: CodecSchemaLiteral; maxItems: number }
  | { kind: "string"; maxLength: number; pattern?: string }
  | {
      kind: "integer" | "number";
      min?: number;
      max?: number;
    }
  | { kind: "boolean" }
  | { kind: "enum"; values: readonly string[] }
  | { kind: "literal"; value: string | number | boolean | null }
  | { kind: "nullable"; of: CodecSchemaLiteral };

/**
 * Resolve `manifest.codec.runtimeModule` defensively. O(1): at most two own
 * descriptors are inspected, plus a length/charset check on the string —
 * no recursion or iteration.
 */
export function resolveRuntimeModule(
  manifest: unknown,
): Result<string, CodecGeneratorError> {
  const codecResult = readOwnDataProperty(manifest, "codec", "codec");
  if (!codecResult.success) return codecResult;
  const codec = codecResult.value;
  if (codec === undefined) return ok(DEFAULT_RUNTIME_MODULE);

  const modResult = readOwnDataProperty(
    codec,
    "runtimeModule",
    "codec.runtimeModule",
  );
  if (!modResult.success) return modResult;
  const mod = modResult.value;
  if (mod === undefined) return ok(DEFAULT_RUNTIME_MODULE);

  if (typeof mod !== "string" || mod.length === 0 || mod.length > 256) {
    return err(
      new CodecGeneratorError(
        "MALFORMED_RUNTIME_MODULE",
        "codec.runtimeModule",
        `codec.runtimeModule must be a non-empty string of at most 256 characters`,
      ),
    );
  }
  // Quotes and line breaks would let a module specifier escape the import
  // literal; control characters are refused by code unit (eslint
  // no-control-regex forbids the character-class form).
  if (/["'`\n\r]/.test(mod)) {
    return err(
      new CodecGeneratorError(
        "MALFORMED_RUNTIME_MODULE",
        "codec.runtimeModule",
        `codec.runtimeModule contains quotes, newlines or control characters`,
      ),
    );
  }
  for (let i = 0; i < mod.length; i++) {
    if (mod.charCodeAt(i) < 0x20 || mod.charCodeAt(i) === 0x7f) {
      return err(
        new CodecGeneratorError(
          "MALFORMED_RUNTIME_MODULE",
          "codec.runtimeModule",
          `codec.runtimeModule contains quotes, newlines or control characters`,
        ),
      );
    }
  }
  return ok(mod);
}

/** Mutable node counter threaded through the whole contract tree. */
interface NodeCounter {
  count: number;
}

function isUnsupportedKind(kind: string): boolean {
  return (
    kind === "union" ||
    kind === "tuple" ||
    kind === "record" ||
    kind === "any" ||
    kind === "unknown"
  );
}

function buildNode(
  node: unknown,
  path: string,
  depth: number,
  counter: NodeCounter,
): Result<CodecSchemaLiteral, CodecGeneratorError> {
  if (depth > MAX_CONTRACT_DEPTH) {
    return err(
      new CodecGeneratorError(
        "BOUNDS_EXCEEDED",
        path,
        `contract nesting exceeds MAX_CONTRACT_DEPTH (${MAX_CONTRACT_DEPTH}) at ${path}`,
      ),
    );
  }
  if (typeof node !== "object" || node === null) {
    return err(
      new CodecGeneratorError(
        "MALFORMED_CONTRACT",
        path,
        `expected a contract node (object) at ${path}, got ${node === null ? "null" : typeof node}`,
      ),
    );
  }

  counter.count += 1;
  if (counter.count > MAX_TOTAL_NODES) {
    return err(
      new CodecGeneratorError(
        "BOUNDS_EXCEEDED",
        path,
        `contract tree exceeds MAX_TOTAL_NODES (${MAX_TOTAL_NODES}) at ${path}`,
      ),
    );
  }

  const kindResult = readOwnDataProperty(node, "kind", path);
  if (!kindResult.success) return kindResult;
  const kind = kindResult.value;

  if (typeof kind !== "string") {
    return err(
      new CodecGeneratorError(
        "UNKNOWN_TYPE",
        path,
        `contract "kind" at ${path} is not a string`,
      ),
    );
  }

  switch (kind) {
    case "string": {
      // minLength is deliberately unsupported: the runtime contract has no
      // notion of it, so a contract carrying one would silently lose a rule.
      // The check goes through the descriptor boundary: a Proxy that throws
      // only when asked for "minLength" is HOSTILE_INPUT, never "absent".
      const minLengthResult = readOwnDataProperty(node, "minLength", path);
      if (!minLengthResult.success) return minLengthResult;
      // readOwnDataProperty yields `undefined` both for an ABSENT property and
      // an own data property whose value is undefined — distinguish them, so
      // `{ kind: "string", maxLength: 5, minLength: undefined }` is refused.
      const hasMinLength = hasOwnDataProperty(node, "minLength", path);
      if (!hasMinLength.success) return hasMinLength;
      if (hasMinLength.value) {
        return err(
          new CodecGeneratorError(
            "UNSUPPORTED_SHAPE",
            path,
            `string contracts with minLength are not supported at ${path}`,
          ),
        );
      }
      const maxResult = readOwnDataProperty(node, "maxLength", path);
      if (!maxResult.success) return maxResult;
      const maxLength = maxResult.value;
      if (maxLength === undefined) {
        return err(
          new CodecGeneratorError(
            "MISSING_BOUND",
            path,
            `string at ${path} requires a positive safe-integer maxLength`,
          ),
        );
      }
      if (
        typeof maxLength !== "number" ||
        !Number.isSafeInteger(maxLength) ||
        maxLength <= 0
      ) {
        return err(
          new CodecGeneratorError(
            "MALFORMED_CONTRACT",
            path,
            `string "maxLength" at ${path} is not a positive safe integer`,
          ),
        );
      }
      const patternResult = readOwnDataProperty(node, "pattern", path);
      if (!patternResult.success) return patternResult;
      const pattern = patternResult.value;
      if (pattern === undefined) {
        return ok({ kind: "string", maxLength });
      }
      if (typeof pattern !== "string") {
        return err(
          new CodecGeneratorError(
            "MALFORMED_CONTRACT",
            path,
            `string "pattern" at ${path} is not a string`,
          ),
        );
      }
      return ok({ kind: "string", maxLength, pattern });
    }
    case "array": {
      const maxResult = readOwnDataProperty(node, "maxItems", path);
      if (!maxResult.success) return maxResult;
      const maxItems = maxResult.value;
      if (maxItems === undefined) {
        return err(
          new CodecGeneratorError(
            "MISSING_BOUND",
            path,
            `array at ${path} requires a positive safe-integer maxItems`,
          ),
        );
      }
      if (
        typeof maxItems !== "number" ||
        !Number.isSafeInteger(maxItems) ||
        maxItems <= 0
      ) {
        return err(
          new CodecGeneratorError(
            "MALFORMED_CONTRACT",
            path,
            `array "maxItems" at ${path} is not a positive safe integer`,
          ),
        );
      }
      const itemsResult = readOwnDataProperty(node, "items", path);
      if (!itemsResult.success) return itemsResult;
      if (itemsResult.value === undefined) {
        return err(
          new CodecGeneratorError(
            "MALFORMED_CONTRACT",
            path,
            `array at ${path} is missing "items"`,
          ),
        );
      }
      const items = buildNode(
        itemsResult.value,
        `${path}.items`,
        depth + 1,
        counter,
      );
      if (!items.success) return items;
      return ok({ kind: "array", items: items.value, maxItems });
    }
    case "object": {
      const exactResult = readOwnDataProperty(node, "exact", path);
      if (!exactResult.success) return exactResult;
      if (exactResult.value !== undefined && exactResult.value !== true) {
        return err(
          new CodecGeneratorError(
            "UNSUPPORTED_SHAPE",
            path,
            `non-exact objects (exact: false) are not supported at ${path}`,
          ),
        );
      }
      const fieldsResult = readOwnDataProperty(node, "fields", path);
      if (!fieldsResult.success) return fieldsResult;
      const fieldsRaw = fieldsResult.value;
      if (fieldsRaw === undefined) {
        return err(
          new CodecGeneratorError(
            "MALFORMED_CONTRACT",
            path,
            `object at ${path} is missing a plain-object "fields"`,
          ),
        );
      }
      // The plainness check is trap-catching: a Proxy whose getPrototypeOf
      // trap throws is HOSTILE_INPUT, never an escaping reflection error.
      const fieldsPlain = isPlainObjectSafe(fieldsRaw, path);
      if (!fieldsPlain.success) return fieldsPlain;
      if (!fieldsPlain.value) {
        return err(
          new CodecGeneratorError(
            "MALFORMED_CONTRACT",
            path,
            `object at ${path} is missing a plain-object "fields"`,
          ),
        );
      }
      // Bounded own-key enumeration: a `for...in` scan is a lazy iterator, so
      // counting own enumerable keys with an early return refuses an enormous
      // field count BEFORE `Object.getOwnPropertyNames` materializes the full
      // key list (unbounded allocation). Getters are never invoked by a
      // `for...in`; trap throws remain HOSTILE_INPUT. Non-enumerable own keys
      // are not seen by `for...in` — they are still caught by the exhaustive
      // `getOwnPropertyNames` count check below.
      let enumerableOwnKeys = 0;
      try {
        for (const key in fieldsRaw) {
          if (Object.prototype.hasOwnProperty.call(fieldsRaw, key)) {
            enumerableOwnKeys += 1;
            if (enumerableOwnKeys > MAX_OBJECT_FIELDS) {
              return err(
                new CodecGeneratorError(
                  "BOUNDS_EXCEEDED",
                  path,
                  `object at ${path} exceeds MAX_OBJECT_FIELDS (${MAX_OBJECT_FIELDS}) before key materialization`,
                ),
              );
            }
          }
        }
      } catch {
        return err(
          new CodecGeneratorError(
            "HOSTILE_INPUT",
            path,
            `reflection threw while enumerating fields at ${path}`,
          ),
        );
      }
      // Enumerate ALL own string keys (Object.keys would silently omit
      // non-enumerable own field schemas — a contract carrying one would
      // lose that field's validation). Reflection throws are HOSTILE_INPUT.
      let keys: string[];
      try {
        keys = Object.getOwnPropertyNames(fieldsRaw as Record<string, unknown>);
      } catch {
        return err(
          new CodecGeneratorError(
            "HOSTILE_INPUT",
            path,
            `reflection threw while enumerating fields at ${path}`,
          ),
        );
      }
      if (keys.length > MAX_OBJECT_FIELDS) {
        return err(
          new CodecGeneratorError(
            "BOUNDS_EXCEEDED",
            path,
            `object at ${path} has ${keys.length} fields, exceeding MAX_OBJECT_FIELDS (${MAX_OBJECT_FIELDS})`,
          ),
        );
      }
      const fields: Record<string, CodecSchemaLiteral> = {};
      for (const key of keys) {
        const fieldResult = readOwnDataProperty(
          fieldsRaw,
          key,
          `${path}.${key}`,
        );
        if (!fieldResult.success) return fieldResult;
        const built = buildNode(
          fieldResult.value,
          `${path}.${key}`,
          depth + 1,
          counter,
        );
        if (!built.success) return built;
        fields[key] = built.value;
      }
      return ok({ kind: "object", exact: true, fields });
    }
    case "integer":
    case "number": {
      const out: { kind: "integer" | "number"; min?: number; max?: number } = {
        kind,
      };
      const minResult = readOwnDataProperty(node, "min", path);
      if (!minResult.success) return minResult;
      const maxResult = readOwnDataProperty(node, "max", path);
      if (!maxResult.success) return maxResult;
      const min = minResult.value;
      const max = maxResult.value;
      if (min !== undefined) {
        if (typeof min !== "number") {
          return err(
            new CodecGeneratorError(
              "MALFORMED_CONTRACT",
              path,
              `integer/number "min" at ${path} is not a finite number`,
            ),
          );
        }
        const valid =
          kind === "integer" ? Number.isSafeInteger(min) : Number.isFinite(min);
        if (!valid) {
          return err(
            new CodecGeneratorError(
              "MALFORMED_CONTRACT",
              path,
              `integer/number "min" at ${path} is not a finite number`,
            ),
          );
        }
        out.min = min;
      }
      if (max !== undefined) {
        if (typeof max !== "number") {
          return err(
            new CodecGeneratorError(
              "MALFORMED_CONTRACT",
              path,
              `integer/number "max" at ${path} is not a finite number`,
            ),
          );
        }
        const valid =
          kind === "integer" ? Number.isSafeInteger(max) : Number.isFinite(max);
        if (!valid) {
          return err(
            new CodecGeneratorError(
              "MALFORMED_CONTRACT",
              path,
              `integer/number "max" at ${path} is not a finite number`,
            ),
          );
        }
        out.max = max;
      }
      if (out.min !== undefined && out.max !== undefined && out.min > out.max) {
        return err(
          new CodecGeneratorError(
            "MALFORMED_CONTRACT",
            path,
            `min > max at ${path}`,
          ),
        );
      }
      return ok(out);
    }
    case "boolean":
      return ok({ kind: "boolean" });
    case "enum": {
      const valuesResult = readOwnDataProperty(node, "values", path);
      if (!valuesResult.success) return valuesResult;
      if (valuesResult.value === undefined) {
        return err(
          new CodecGeneratorError(
            "MALFORMED_CONTRACT",
            path,
            `enum at ${path} is missing "values"`,
          ),
        );
      }
      // BOUND: readDenseArray refuses length > MAX_ENUM_VALUES (BOUNDS_EXCEEDED)
      // before iterating, holes (HOSTILE_INPUT) and array-likes
      // (MALFORMED_CONTRACT) before any value is trusted.
      const dense = readDenseArray(
        valuesResult.value,
        MAX_ENUM_VALUES,
        `${path}.values`,
      );
      if (!dense.success) return dense;
      const values = dense.value;
      if (values.length < 1) {
        return err(
          new CodecGeneratorError(
            "MALFORMED_CONTRACT",
            path,
            `enum at ${path} has an empty "values" array`,
          ),
        );
      }
      const strs: string[] = [];
      for (const v of values) {
        if (typeof v !== "string") {
          return err(
            new CodecGeneratorError(
              "MALFORMED_CONTRACT",
              path,
              `enum at ${path} contains a non-string value`,
            ),
          );
        }
        strs.push(v);
      }
      return ok({ kind: "enum", values: strs });
    }
    case "literal": {
      const valueResult = readOwnDataProperty(node, "value", path);
      if (!valueResult.success) return valueResult;
      const value = valueResult.value;
      if (
        typeof value !== "string" &&
        typeof value !== "number" &&
        typeof value !== "boolean" &&
        value !== null
      ) {
        return err(
          new CodecGeneratorError(
            "MALFORMED_CONTRACT",
            path,
            `literal at ${path} must carry a string/number/boolean/null value`,
          ),
        );
      }
      // NaN and Infinity would render as `null` via JSON.stringify, silently
      // changing the contract's literal value and generated type.
      if (typeof value === "number" && !Number.isFinite(value)) {
        return err(
          new CodecGeneratorError(
            "MALFORMED_CONTRACT",
            path,
            `literal at ${path} must be a finite number (NaN and Infinity are refused)`,
          ),
        );
      }
      return ok({ kind: "literal", value });
    }
    case "nullable": {
      const ofResult = readOwnDataProperty(node, "of", path);
      if (!ofResult.success) return ofResult;
      if (ofResult.value === undefined) {
        return err(
          new CodecGeneratorError(
            "MALFORMED_CONTRACT",
            path,
            `nullable at ${path} is missing "of"`,
          ),
        );
      }
      const of = buildNode(ofResult.value, `${path}.of`, depth + 1, counter);
      if (!of.success) return of;
      return ok({ kind: "nullable", of: of.value });
    }
    default:
      if (isUnsupportedKind(kind)) {
        return err(
          new CodecGeneratorError(
            "UNSUPPORTED_SHAPE",
            path,
            `unsupported contract shape "${kind}" at ${path}`,
          ),
        );
      }
      return err(
        new CodecGeneratorError(
          "UNKNOWN_TYPE",
          path,
          `unknown contract kind "${kind}" at ${path}`,
        ),
      );
  }
}

/**
 * Validate an untrusted port contract into a `CodecSchemaLiteral`.
 * O(N) with the bounds documented in the module header; the shared node
 * counter enforces MAX_TOTAL_NODES across the entire tree.
 */
export function buildCodecSchema(
  rawContract: unknown,
  pathPrefix: string = "contract",
): Result<CodecSchemaLiteral, CodecGeneratorError> {
  const counter: NodeCounter = { count: 0 };

  // Port contracts wrap the request schema as `{ request: <schema> }` —
  // unwrap through the same descriptor boundary; a schema literal never has
  // a `kind` but a `request` key, so the two shapes are unambiguous.
  if (typeof rawContract === "object" && rawContract !== null) {
    const kindPeek = readOwnDataProperty(rawContract, "kind", pathPrefix);
    if (kindPeek.success && kindPeek.value === undefined) {
      const requestPeek = readOwnDataProperty(
        rawContract,
        "request",
        pathPrefix,
      );
      // A failed descriptor read for `request` (accessor or throwing Proxy
      // trap) is HOSTILE_INPUT — never fall through to UNKNOWN_TYPE.
      if (!requestPeek.success) return requestPeek;
      if (requestPeek.value !== undefined) {
        return buildNode(
          requestPeek.value,
          `${pathPrefix}.request`,
          1,
          counter,
        );
      }
    } else if (!kindPeek.success) {
      return kindPeek;
    }
  }
  return buildNode(rawContract, pathPrefix, 1, counter);
}

// ---------------------------------------------------------------------------
// Deterministic TypeScript rendering
// ---------------------------------------------------------------------------

/** Code-point comparison — locale-independent, byte-deterministic. */
function compareCodePoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function tsTypeOf(schema: CodecSchemaLiteral): string {
  switch (schema.kind) {
    case "object": {
      const entries = Object.keys(schema.fields).sort(compareCodePoint);
      const parts = entries.map((key) => {
        const safeKey = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)
          ? key
          : JSON.stringify(key);
        return `readonly ${safeKey}: ${tsTypeOf(schema.fields[key])};`;
      });
      return parts.length === 0 ? "{}" : `{ ${parts.join(" ")} }`;
    }
    case "array":
      return `ReadonlyArray<${tsTypeOf(schema.items)}>`;
    case "string":
      return "string";
    case "integer":
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "enum":
      return schema.values
        .map((v) => JSON.stringify(v))
        .sort(compareCodePoint)
        .join(" | ");
    case "literal":
      return schema.value === null ? "null" : JSON.stringify(schema.value);
    case "nullable":
      return `${tsTypeOf(schema.of)} | null`;
  }
}

function renderSchemaLiteral(
  schema: CodecSchemaLiteral,
  indent: string,
): string {
  const inner = `${indent}  `;
  switch (schema.kind) {
    case "object": {
      const keys = Object.keys(schema.fields).sort(compareCodePoint);
      const lines = keys.map(
        (key) =>
          `${inner}${JSON.stringify(key)}: ${renderSchemaLiteral(schema.fields[key], inner)},`,
      );
      return `{ kind: "object", exact: true, fields: {\n${lines.join("\n")}\n${indent}} }`;
    }
    case "array":
      return `{ kind: "array", items: ${renderSchemaLiteral(schema.items, inner)}, maxItems: ${schema.maxItems} }`;
    case "string": {
      const pattern =
        schema.pattern !== undefined
          ? `, pattern: ${JSON.stringify(schema.pattern)}`
          : "";
      return `{ kind: "string", maxLength: ${schema.maxLength}${pattern} }`;
    }
    case "integer":
    case "number": {
      const min = schema.min !== undefined ? `, min: ${schema.min}` : "";
      const max = schema.max !== undefined ? `, max: ${schema.max}` : "";
      return `{ kind: "${schema.kind}"${min}${max} }`;
    }
    case "boolean":
      return `{ kind: "boolean" }`;
    case "enum":
      return `{ kind: "enum", values: [${schema.values.map((v) => JSON.stringify(v)).join(", ")}] }`;
    case "literal":
      return `{ kind: "literal", value: ${JSON.stringify(schema.value)} }`;
    case "nullable":
      return `{ kind: "nullable", of: ${renderSchemaLiteral(schema.of, inner)} }`;
  }
}

export interface RenderCodecModuleInput {
  portName: string;
  schemaId: string;
  runtimeModule: string;
  schema: CodecSchemaLiteral;
}

/**
 * Render the emitted `<PortName>.codec.ts` module. Deterministic: field keys
 * are sorted with code-point comparison at every object level (both in the TS
 * type and in the schema literal), so equal inputs yield byte-identical
 * output. O(N log F) with N <= MAX_TOTAL_NODES and F <= MAX_OBJECT_FIELDS.
 */
export function renderCodecModule(input: RenderCodecModuleInput): string {
  const { portName, schemaId, runtimeModule, schema } = input;
  const tsType = tsTypeOf(schema);
  const literal = renderSchemaLiteral(schema, "  ");
  return `// @generated by @hexagen/sync
import { createCodec, type Codec, type CodecEnv, type CodecSchema, type Validated } from ${JSON.stringify(runtimeModule)};

export type ${portName}Request = Validated<${tsType}>;

const schema = ${literal} as const satisfies CodecSchema;

export function create${portName}Codec(env: CodecEnv): Codec<${tsType}> {
  return createCodec<${tsType}>(${JSON.stringify(schemaId)}, schema, env);
}
`;
}
