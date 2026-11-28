// packages/sync/src/domain/services/codec-sample-synthesizer.ts
//
// Lane H3: deterministic, hostile-input-hardened synthesis of one VALID
// request sample from an untrusted port contract, plus the descriptor-based
// safe-read primitives shared with the codec-test generator.
//
// Hostile-input rule (lane brief §Proof): every function reading untrusted
// input refuses null/undefined where a plain record is required, non-iterable
// values, array holes, wrong primitives, getters (accessors are NEVER
// invoked — they are refused through their own property descriptor),
// detectable Proxies (the injected `IsProxyDetector`) and reflection/trap
// throws (the reflection reads run inside try/catch and map throws to
// HOSTILE_INPUT), array-likes, enormous lengths, and prototype-polluting
// keys — each with a typed error, never a pass. No promise is made about
// transparent Proxies that neither trigger the injected detector nor throw
// during reflection; that is not detectable in pure JS.
//
// Error-code precedence (deterministic, see the lane brief):
//   1. HOSTILE_INPUT   2. MALFORMED_CONTRACT   3. TIMEOUT_OR_BUDGET
//   4. UNKNOWN_TYPE    5. UNSUPPORTED_NESTED_SHAPE
//   6. MISSING_BOUND   7. MISSING_PATTERN_EXAMPLE
// (IO_FAILURE is a filesystem error, only produced by the generator.)
//
// Per-function cost bounds:
// - readOwnPlainProperty / validatePlainRecord: O(1) — one trap-catching
//   descriptor read; no enumeration.
// - synthesizeValidSample: O(N) in schema nodes, bounded by
//   MAX_SAMPLE_CONTRACT_DEPTH = 8, MAX_CONTRACT_FIELDS = 64 fields per object,
//   MAX_CONTRACT_NODES schema nodes across the ENTIRE contract, and a
//   serialized-sample byte budget (MAX_SAMPLE_BYTES) — every overflow is
//   refused with TIMEOUT_OR_BUDGET BEFORE unbounded traversal or allocation.
//   The bounded pattern matcher caps pattern size (MAX_PATTERN_LENGTH) and
//   matching steps (MAX_PATTERN_STEPS); manifest patterns are never run
//   through unrestricted native RegExp.test.

import type { IsProxyDetector } from "./proxy-detector.js";
import { safeEcho } from "./codec-echo.js";

/**
 * Proxy-detection port (arch-lint `node-builtin-in-layer`): the domain layer
 * must not import Node builtins, so `util.types.isProxy` is INJECTED
 * explicitly as an `IsProxyDetector` parameter by every caller
 * (infrastructure: `src/generators/codec-test.ts`, `src/sync-engine.ts`).
 * There is no process-global detector: a missing / non-function detector
 * FAILS CLOSED — every object value is refused with HOSTILE_INPUT before any
 * reflection. A detector that throws is a refusal too; a detector that
 * returns true refuses the value. The reflection/trap-throw checks below
 * still refuse any Proxy whose traps throw.
 */

/**
 * Fail-closed Proxy gate (Lane HXS1). MUST be invoked BEFORE any reflection
 * (Object.getPrototypeOf, Object.getOwnPropertyDescriptor, `in`,
 * Array.isArray, `.length`) on a value that may be hostile. Callers must
 * already have refused null/non-object values (primitives pass through
 * untouched). Throws HOSTILE_INPUT when the detector is missing, throws, or
 * returns true.
 */
function gateProxy(
  value: unknown,
  path: string,
  isProxy: IsProxyDetector | undefined,
): void {
  if (typeof isProxy !== "function") {
    throw hostile(
      path,
      `no proxy detector supplied; refusing an object at ${path}`,
    );
  }
  let refused: boolean;
  try {
    refused = isProxy(value) === true;
  } catch {
    // A throwing detector is treated as a refusal — fail closed.
    refused = true;
  }
  if (refused) {
    throw hostile(path, `refusing a Proxy at ${path}`);
  }
}

/** Typed refusal reasons for the codec-test generator's trust boundary. */
export type CodecTestGeneratorErrorCode =
  | "MALFORMED_CONTRACT"
  | "UNKNOWN_TYPE"
  | "MISSING_BOUND"
  | "UNSUPPORTED_NESTED_SHAPE"
  | "MISSING_PATTERN_EXAMPLE"
  | "HOSTILE_INPUT"
  | "IO_FAILURE"
  | "TIMEOUT_OR_BUDGET";

/** Typed error carried by every refusal in this lane. */
export class CodecTestGeneratorError extends Error {
  readonly code: CodecTestGeneratorErrorCode;
  readonly path: string | null;

  constructor(
    code: CodecTestGeneratorErrorCode,
    path: string | null,
    message: string,
  ) {
    super(message);
    this.name = "CodecTestGeneratorError";
    this.code = code;
    this.path = path;
  }
}

/** Hard traversal bounds (see the module-header cost bounds). */
export const MAX_PORTS_PER_CONTEXT = 64;
export const MAX_BOUNDED_CONTEXTS = 64;
export const MAX_SAMPLE_CONTRACT_DEPTH = 8;
export const MAX_CONTRACT_FIELDS = 64;
export const MAX_CONTRACT_NODES = 512;
export const MAX_SAMPLE_BYTES = 8192;
export const MAX_ARRAY_ITEMS_BOUND = 10_000;
export const MAX_STRING_LENGTH_BOUND = 65_536;
/** Pattern-size budget: patterns longer than this are refused outright. */
export const MAX_PATTERN_LENGTH = 256;
/** Matching-step budget for the bounded pattern matcher. */
export const MAX_PATTERN_STEPS = 10_000;

/** Keys that must never be read from untrusted objects. */
const POLLUTING_KEYS: ReadonlySet<string> = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

function hostile(path: string, message: string): CodecTestGeneratorError {
  return new CodecTestGeneratorError("HOSTILE_INPUT", path, message);
}

/**
 * Read ONE own data property from a PLAIN object without ever invoking
 * accessors. Cost: O(1) — a trap-catching plainness check, a Set lookup and
 * one descriptor read inside a try/catch. Throws HOSTILE_INPUT for:
 * non-object/null receivers, detectable Proxies, reflection/trap throws,
 * non-plain prototypes, prototype-polluting keys and getter/setter
 * descriptors. Returns `undefined` for an ABSENT own property as well as an
 * own data property whose value is `undefined` — callers that must
 * distinguish the two use `hasOwnPlainProperty`.
 */
export function readOwnPlainProperty(
  obj: unknown,
  key: string,
  isProxy?: IsProxyDetector,
): unknown {
  if (obj === null || typeof obj !== "object") {
    throw hostile(
      safeEcho(key),
      `expected a plain object to read "${safeEcho(key)}" from, got ${
        obj === null ? "null" : typeof obj
      }`,
    );
  }
  // Fail-closed Proxy gate BEFORE the prototype read / descriptor read.
  gateProxy(obj, safeEcho(key), isProxy);
  let proto: unknown;
  try {
    proto = Object.getPrototypeOf(obj);
  } catch {
    throw hostile(
      safeEcho(key),
      `reflection threw while reading the prototype (hostile Proxy trap)`,
    );
  }
  if (proto !== Object.prototype && proto !== null) {
    throw hostile(safeEcho(key), `non-plain prototype while reading "${safeEcho(key)}"`);
  }
  if (POLLUTING_KEYS.has(key)) {
    throw hostile(safeEcho(key), `refusing prototype-polluting key "${safeEcho(key)}"`);
  }
  let desc: PropertyDescriptor | undefined;
  try {
    desc = Object.getOwnPropertyDescriptor(obj, key);
  } catch {
    throw hostile(
      safeEcho(key),
      `reflection threw while reading "${safeEcho(key)}" (hostile Proxy trap)`,
    );
  }
  if (desc && (desc.get !== undefined || desc.set !== undefined)) {
    throw hostile(
      safeEcho(key),
      `refusing accessor property "${safeEcho(key)}" (getters are never invoked)`,
    );
  }
  return desc?.value;
}

/**
 * Distinguish an ABSENT own property from an own data property whose value is
 * `undefined`. O(1) — one trap-catching descriptor read.
 */
export function hasOwnPlainProperty(
  obj: unknown,
  key: string,
  isProxy?: IsProxyDetector,
): boolean {
  if (obj === null || typeof obj !== "object") {
    throw hostile(
      safeEcho(key),
      `expected a plain object to test "${safeEcho(key)}" on, got ${
        obj === null ? "null" : typeof obj
      }`,
    );
  }
  // Fail-closed Proxy gate BEFORE the prototype read / descriptor read.
  gateProxy(obj, safeEcho(key), isProxy);
  let proto: unknown;
  try {
    proto = Object.getPrototypeOf(obj);
  } catch {
    throw hostile(safeEcho(key), `reflection threw while reading the prototype`);
  }
  if (proto !== Object.prototype && proto !== null) {
    throw hostile(safeEcho(key), `non-plain prototype while testing "${safeEcho(key)}"`);
  }
  if (POLLUTING_KEYS.has(key)) {
    throw hostile(safeEcho(key), `refusing prototype-polluting key "${safeEcho(key)}"`);
  }
  let desc: PropertyDescriptor | undefined;
  try {
    desc = Object.getOwnPropertyDescriptor(obj, key);
  } catch {
    throw hostile(safeEcho(key), `reflection threw while testing "${safeEcho(key)}"`);
  }
  return desc !== undefined;
}

/**
 * Validate that `value` is a PLAIN record: an object with `Object.prototype`
 * (or null) prototype, not an array, not a detectable Proxy, with no
 * reflection throw. Refuses null/undefined (HOSTILE_INPUT). Cost: O(1).
 */
export function validatePlainRecord(
  value: unknown,
  isProxy?: IsProxyDetector,
): void {
  if (value === null || value === undefined) {
    throw hostile(
      "record",
      `expected a plain record, got ${value === null ? "null" : "undefined"}`,
    );
  }
  if (typeof value !== "object") {
    throw hostile(
      "record",
      `expected a plain record, got the primitive ${typeof value}`,
    );
  }
  // Fail-closed Proxy gate BEFORE the prototype read / Array.isArray.
  gateProxy(value, "record", isProxy);
  let proto: unknown;
  try {
    proto = Object.getPrototypeOf(value);
  } catch {
    throw hostile("record", `reflection threw while reading the prototype`);
  }
  if (proto !== Object.prototype && proto !== null) {
    throw hostile(
      "record",
      `non-plain prototype where a plain record is required`,
    );
  }
  if (Array.isArray(value)) {
    throw hostile(
      "record",
      `refusing an array where a plain record is required`,
    );
  }
}

/** Mutable budget state threaded through the whole contract tree. */
interface SynthesisBudget {
  nodes: number;
  bytes: number;
  /**
   * When true, byte charging is tracked but never enforced. Used for the
   * discarded inner sample of a `nullable` node: its bytes are never
   * serialized into the emitted sample, so only the node budget (shared
   * with the outer tree) still applies to the inner contract.
   */
  discardBytes?: boolean;
}

function chargeNodes(budget: SynthesisBudget, path: string): void {
  budget.nodes += 1;
  if (budget.nodes > MAX_CONTRACT_NODES) {
    throw new CodecTestGeneratorError(
      "TIMEOUT_OR_BUDGET",
      path,
      `contract exceeds the global schema-node budget (MAX_CONTRACT_NODES = ${MAX_CONTRACT_NODES}) at ${path}`,
    );
  }
}

function chargeBytes(budget: SynthesisBudget, n: number, path: string): void {
  budget.bytes += n;
  if (budget.discardBytes === true) return;
  if (budget.bytes > MAX_SAMPLE_BYTES) {
    throw new CodecTestGeneratorError(
      "TIMEOUT_OR_BUDGET",
      path,
      `synthesized sample exceeds the byte budget (MAX_SAMPLE_BYTES = ${MAX_SAMPLE_BYTES}) at ${path}`,
    );
  }
}

/**
 * Exact UTF-8 byte length of `JSON.stringify(value)` for a string value,
 * including the enclosing quotes and every escape sequence — the true
 * serialized size of a string inside a JSON sample. Pure JS: the domain
 * layer must not import node builtins.
 */
function jsonUtf8Length(value: string): number {
  let total = 2; // enclosing quotes
  let i = 0;
  while (i < value.length) {
    const cp = value.codePointAt(i) as number;
    if (
      cp === 0x08 ||
      cp === 0x09 ||
      cp === 0x0a ||
      cp === 0x0c ||
      cp === 0x0d
    ) {
      total += 2; // \b \t \n \f \r short escapes
    } else if (cp < 0x20 || (cp >= 0xd800 && cp <= 0xdfff)) {
      total += 6; // \uXXXX (JSON.stringify escapes lone surrogates too)
    } else if (cp === 0x22 || cp === 0x5c) {
      total += 2; // \" \\
    } else if (cp < 0x7f) {
      total += 1;
    } else if (cp < 0x800) {
      total += 2;
    } else if (cp < 0x10000) {
      total += 3;
    } else {
      total += 4;
    }
    i += cp > 0xffff ? 2 : 1;
  }
  return total;
}

/** Charge the actual UTF-8 size of the JSON-serialized string sample. */
function chargeJsonString(
  budget: SynthesisBudget,
  value: string,
  path: string,
): void {
  chargeBytes(budget, jsonUtf8Length(value), path);
}

/** Read an untrusted value as a dense array of bounded length. */
function readBoundedDenseArray(
  value: unknown,
  maxLen: number,
  path: string,
  isProxy?: IsProxyDetector,
): readonly unknown[] {
  // Detectable Proxies are refused BEFORE any reflection: getPrototypeOf,
  // descriptor reads and `i in value` would otherwise run Proxy traps.
  gateProxy(value, path, isProxy);
  let isArray: boolean;
  try {
    isArray = Array.isArray(value);
  } catch {
    // A revoked Proxy can throw even from Array.isArray.
    throw hostile(path, `reflection threw while inspecting the array`);
  }
  if (!isArray) {
    // Also covers array-likes ({ length: N }) and non-iterables.
    throw hostile(path, `expected a dense array at ${path}`);
  }
  // Array.isArray succeeded; the reflection reads below still run inside
  // their own trap-catching boundary against the (possibly Proxy) target.
  const arr = value as unknown[];
  let proto: unknown;
  let lenDesc: PropertyDescriptor | undefined;
  try {
    proto = Object.getPrototypeOf(arr);
    lenDesc = Object.getOwnPropertyDescriptor(arr, "length");
  } catch {
    throw hostile(path, `reflection threw while inspecting the array`);
  }
  if (proto !== Array.prototype && proto !== null) {
    throw hostile(path, `array at ${path} has a non-plain prototype`);
  }
  if (!lenDesc || lenDesc.get !== undefined || lenDesc.set !== undefined) {
    throw hostile(path, `array "length" at ${path} is missing or an accessor`);
  }
  const len = lenDesc.value;
  if (typeof len !== "number" || !Number.isSafeInteger(len) || len < 0) {
    throw hostile(path, `array "length" at ${path} is not a safe integer`);
  }
  if (len > maxLen) {
    throw hostile(
      path,
      `array at ${path} has ${len} items, exceeding the bound ${maxLen}`,
    );
  }
  const items: unknown[] = [];
  for (let i = 0; i < len; i++) {
    let present: boolean;
    try {
      present = i in arr;
    } catch {
      throw hostile(path, `reflection threw while probing index ${i}`);
    }
    if (!present) {
      throw hostile(path, `sparse array hole at index ${i} of ${path}`);
    }
    // Arrays are validated above (plain Array.prototype, accessor-free
    // length), so read the element through its own descriptor directly —
    // readOwnPlainProperty would refuse the Array.prototype prototype.
    let desc: PropertyDescriptor | undefined;
    try {
      desc = Object.getOwnPropertyDescriptor(value, String(i));
    } catch {
      throw hostile(path, `reflection threw while reading index ${i}`);
    }
    if (!desc) {
      throw hostile(path, `missing element at index ${i} of ${path}`);
    }
    if (desc.get !== undefined || desc.set !== undefined) {
      throw hostile(
        path,
        `accessor at index ${i} of ${path} (getters are never invoked)`,
      );
    }
    items.push(desc.value);
  }
  return items;
}

// ---------------------------------------------------------------------------
// Bounded pattern matcher (never runs unrestricted native RegExp.test)
// ---------------------------------------------------------------------------

type ClassItem =
  | { t: "char"; ch: string }
  | { t: "range"; lo: string; hi: string }
  | { t: "digit"; neg: boolean }
  | { t: "word"; neg: boolean }
  | { t: "space"; neg: boolean };

type PatternNode =
  | { t: "char"; ch: string }
  | { t: "any" }
  | { t: "class"; neg: boolean; items: ClassItem[] }
  | { t: "seq"; parts: PatternNode[] }
  | { t: "alt"; opts: PatternNode[] }
  | { t: "quant"; node: PatternNode; min: number; max: number }
  | { t: "start" }
  | { t: "end" };

interface PatternParser {
  src: string;
  i: number;
}

function peek(p: PatternParser): string | undefined {
  return p.i < p.src.length ? p.src[p.i] : undefined;
}

function parsePatternOrThrow(src: string): PatternNode {
  const p: PatternParser = { src, i: 0 };
  const node = parseAlternation(p, true);
  if (p.i < p.src.length) {
    throw new CodecTestGeneratorError(
      "MALFORMED_CONTRACT",
      "string.pattern",
      `unexpected "${p.src[p.i]}" in pattern at offset ${p.i}`,
    );
  }
  return node;
}

function parseAlternation(p: PatternParser, top: boolean): PatternNode {
  const opts: PatternNode[] = [parseSequence(p, top)];
  while (peek(p) === "|") {
    p.i += 1;
    opts.push(parseSequence(p, top));
  }
  return opts.length === 1 ? opts[0] : { t: "alt", opts };
}

function parseSequence(p: PatternParser, top: boolean): PatternNode {
  const parts: PatternNode[] = [];
  for (;;) {
    const c = peek(p);
    if (c === undefined || c === "|" || (c === ")" && !top)) break;
    parts.push(parseQuantified(p));
  }
  return { t: "seq", parts };
}

function parseQuantified(p: PatternParser): PatternNode {
  const atom = parseAtom(p);
  const c = peek(p);
  if (c === "*") {
    p.i += 1;
    return { t: "quant", node: atom, min: 0, max: Number.POSITIVE_INFINITY };
  }
  if (c === "+") {
    p.i += 1;
    return { t: "quant", node: atom, min: 1, max: Number.POSITIVE_INFINITY };
  }
  if (c === "?") {
    p.i += 1;
    return { t: "quant", node: atom, min: 0, max: 1 };
  }
  if (c === "{") {
    const bound = parseBound(p);
    if (bound === null) {
      throw new CodecTestGeneratorError(
        "MALFORMED_CONTRACT",
        "string.pattern",
        `invalid or nested quantifier in pattern at offset ${p.i}`,
      );
    }
    return { t: "quant", node: atom, min: bound.min, max: bound.max };
  }
  return atom;
}

/** Parse `{m}`, `{m,}` or `{m,n}`; null when it is not a valid bound. */
function parseBound(p: PatternParser): { min: number; max: number } | null {
  const start = p.i;
  p.i += 1; // consume "{"
  const min = parseDigits(p);
  if (min === null) {
    p.i = start;
    return null;
  }
  let max = min;
  if (peek(p) === ",") {
    p.i += 1;
    if (peek(p) === "}") {
      max = Number.POSITIVE_INFINITY;
    } else {
      const n = parseDigits(p);
      if (n === null) {
        p.i = start;
        return null;
      }
      max = n;
    }
  }
  if (peek(p) !== "}" || max < min) {
    p.i = start;
    return null;
  }
  p.i += 1;
  return { min, max };
}

function parseDigits(p: PatternParser): number | null {
  const start = p.i;
  while (p.i < p.src.length && /[0-9]/.test(p.src[p.i])) {
    p.i += 1;
  }
  if (p.i === start) return null;
  const n = Number.parseInt(p.src.slice(start, p.i), 10);
  return Number.isSafeInteger(n) ? n : null;
}

function parseClassEscape(p: PatternParser): ClassItem {
  const c = p.src[p.i];
  p.i += 1;
  if (c === "d") return { t: "digit", neg: false };
  if (c === "D") return { t: "digit", neg: true };
  if (c === "w") return { t: "word", neg: false };
  if (c === "W") return { t: "word", neg: true };
  if (c === "s") return { t: "space", neg: false };
  if (c === "S") return { t: "space", neg: true };
  const literal = c === "n" ? "\n" : c === "t" ? "\t" : c === "r" ? "\r" : c;
  return { t: "char", ch: literal };
}

function parseAtom(p: PatternParser): PatternNode {
  const c = peek(p);
  if (c === undefined) {
    throw new CodecTestGeneratorError(
      "MALFORMED_CONTRACT",
      "string.pattern",
      `unexpected end of pattern`,
    );
  }
  if (c === "(") {
    p.i += 1;
    if (peek(p) === "?") {
      throw new CodecTestGeneratorError(
        "MALFORMED_CONTRACT",
        "string.pattern",
        `unsupported group construct (?...) in pattern at offset ${p.i}`,
      );
    }
    const inner = parseAlternation(p, false);
    if (peek(p) !== ")") {
      throw new CodecTestGeneratorError(
        "MALFORMED_CONTRACT",
        "string.pattern",
        `unmatched "(" in pattern at offset ${p.i}`,
      );
    }
    p.i += 1;
    return inner;
  }
  if (c === "[") {
    p.i += 1;
    return parseClass(p);
  }
  if (c === "^") {
    p.i += 1;
    return { t: "start" };
  }
  if (c === "$") {
    p.i += 1;
    return { t: "end" };
  }
  if (c === ".") {
    p.i += 1;
    return { t: "any" };
  }
  if (c === "\\") {
    p.i += 1;
    const e = peek(p);
    if (e === undefined) {
      throw new CodecTestGeneratorError(
        "MALFORMED_CONTRACT",
        "string.pattern",
        `dangling escape at end of pattern`,
      );
    }
    if (e >= "1" && e <= "9") {
      throw new CodecTestGeneratorError(
        "MALFORMED_CONTRACT",
        "string.pattern",
        `backreferences are not supported in pattern at offset ${p.i}`,
      );
    }
    if (e === "b" || e === "B") {
      throw new CodecTestGeneratorError(
        "MALFORMED_CONTRACT",
        "string.pattern",
        `word boundaries are not supported in pattern at offset ${p.i}`,
      );
    }
    if (
      e === "d" ||
      e === "D" ||
      e === "w" ||
      e === "W" ||
      e === "s" ||
      e === "S"
    ) {
      // parseClassEscape reads the character at p.i (the escape letter) and
      // consumes it.
      const item = parseClassEscape(p);
      return { t: "class", neg: false, items: [item] };
    }
    p.i += 1;
    const literal = e === "n" ? "\n" : e === "t" ? "\t" : e === "r" ? "\r" : e;
    return { t: "char", ch: literal };
  }
  if (c === "*" || c === "+" || c === "?" || c === ")") {
    throw new CodecTestGeneratorError(
      "MALFORMED_CONTRACT",
      "string.pattern",
      `unexpected "${c}" in pattern at offset ${p.i}`,
    );
  }
  p.i += 1;
  return { t: "char", ch: c };
}

function parseClass(p: PatternParser): PatternNode {
  const neg = peek(p) === "^";
  if (neg) p.i += 1;
  const items: ClassItem[] = [];
  for (;;) {
    const c = peek(p);
    if (c === undefined) {
      throw new CodecTestGeneratorError(
        "MALFORMED_CONTRACT",
        "string.pattern",
        `unmatched "[" in pattern`,
      );
    }
    if (c === "]") {
      p.i += 1;
      break;
    }
    let item: ClassItem;
    if (c === "\\") {
      p.i += 1;
      item = parseClassEscape(p);
    } else {
      p.i += 1;
      item = { t: "char", ch: c };
    }
    // Range a-z (only between plain chars).
    const next = peek(p);
    if (
      item.t === "char" &&
      next === "-" &&
      p.i + 1 < p.src.length &&
      p.src[p.i + 1] !== "]"
    ) {
      p.i += 1; // consume "-"
      let hi: string;
      if (peek(p) === "\\") {
        p.i += 1;
        const hiItem = parseClassEscape(p);
        if (hiItem.t !== "char") {
          throw new CodecTestGeneratorError(
            "MALFORMED_CONTRACT",
            "string.pattern",
            `invalid range end in character class`,
          );
        }
        hi = hiItem.ch;
      } else {
        hi = p.src[p.i];
        p.i += 1;
      }
      if (item.ch > hi) {
        throw new CodecTestGeneratorError(
          "MALFORMED_CONTRACT",
          "string.pattern",
          `character-class range out of order (${item.ch}-${hi})`,
        );
      }
      items.push({ t: "range", lo: item.ch, hi });
    } else {
      items.push(item);
    }
  }
  if (items.length === 0) {
    throw new CodecTestGeneratorError(
      "MALFORMED_CONTRACT",
      "string.pattern",
      `empty character class "[]"`,
    );
  }
  return { t: "class", neg, items };
}

interface MatchState {
  s: string;
  steps: number;
}

function step(state: MatchState): void {
  state.steps += 1;
  if (state.steps > MAX_PATTERN_STEPS) {
    throw new CodecTestGeneratorError(
      "TIMEOUT_OR_BUDGET",
      "string.pattern",
      `pattern matching exceeded the step budget (MAX_PATTERN_STEPS = ${MAX_PATTERN_STEPS})`,
    );
  }
}

function classMatches(
  node: Extract<PatternNode, { t: "class" }>,
  ch: string,
): boolean {
  let matched = false;
  for (const item of node.items) {
    if (item.t === "char") {
      if (ch === item.ch) matched = true;
    } else if (item.t === "range") {
      if (ch >= item.lo && ch <= item.hi) matched = true;
    } else if (item.t === "digit") {
      const isDigit = ch >= "0" && ch <= "9";
      if (isDigit !== item.neg) matched = true;
    } else if (item.t === "word") {
      const isWord =
        (ch >= "a" && ch <= "z") ||
        (ch >= "A" && ch <= "Z") ||
        (ch >= "0" && ch <= "9") ||
        ch === "_";
      if (isWord !== item.neg) matched = true;
    } else {
      const isSpace =
        ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\f";
      if (isSpace !== item.neg) matched = true;
    }
    if (matched) break;
  }
  return node.neg ? !matched : matched;
}

/** Continuation frame of the iterative bounded matcher. */
type QuantNode = Extract<PatternNode, { t: "quant" }>;

/**
 * Frames are immutable: processing a frame pops it and pushes its successor,
 * so a choice point restores the continuation state from a full snapshot of
 * the stack taken when the choice was created (a length-based truncation
 * would be wrong: a pop+push keeps the length while changing the content).
 */
type MatchFrame =
  | { t: "seq"; parts: PatternNode[]; idx: number }
  | { t: "quant"; q: QuantNode; count: number; p: number }
  | { t: "quantRep"; q: QuantNode; count: number; p: number };

/** A saved alternative: either another node to match, or "stop here". */
type MatchAlt = { node: PatternNode; si: number } | { deliverP: number };

/** The node currently being matched and the position to match it at. */
interface MatchCursor {
  node: PatternNode;
  si: number;
}

interface MatchChoice {
  /** Continuation-stack snapshot at the moment the choice was created. */
  frames: MatchFrame[];
  alts: MatchAlt[];
}

// Deliver outcomes for the matcher's main loop.
const RESUME = 0; // `cur` was set — keep running.
const DONE = 1; // the whole pattern matched.
const FAIL = 2; // current path failed — backtrack.

/**
 * Iterative bounded matcher. The recursive CPS matcher it replaces recursed
 * once per quantifier repetition, so a long matching example (e.g. `a+`
 * against thousands of characters) exhausted the JavaScript call stack and
 * surfaced as a `RangeError` before the step budget could run. The machine
 * below keeps its continuation and backtrack state on the heap in explicitly
 * bounded structures, so MAX_PATTERN_STEPS is always the first budget to
 * blow — with the required TIMEOUT_OR_BUDGET refusal, never a RangeError.
 */
export function matchesPatternBounded(
  pattern: string,
  sample: string,
): boolean {
  if (pattern.length > MAX_PATTERN_LENGTH) {
    throw new CodecTestGeneratorError(
      "TIMEOUT_OR_BUDGET",
      "string.pattern",
      `pattern size ${pattern.length} exceeds the budget (MAX_PATTERN_LENGTH = ${MAX_PATTERN_LENGTH})`,
    );
  }
  const ast = parsePatternOrThrow(pattern);
  const s = sample;
  const state: MatchState = { s, steps: 0 };
  let stack: MatchFrame[] = [];
  const choices: MatchChoice[] = [];
  let cur: MatchCursor | null = { node: ast, si: 0 };
  let finished = false;

  // Deliver a successful position `p` to the continuation stack.
  const deliver = (p: number): number => {
    for (;;) {
      const frame = stack.pop();
      if (frame === undefined) {
        // Top-level continuation: the pattern matched iff the sample is
        // fully consumed.
        if (p === s.length) {
          finished = true;
          return DONE;
        }
        return FAIL;
      }
      switch (frame.t) {
        case "seq": {
          if (frame.idx < frame.parts.length) {
            stack.push({ t: "seq", parts: frame.parts, idx: frame.idx + 1 });
            cur = { node: frame.parts[frame.idx], si: p };
            return RESUME;
          }
          break; // exhausted sequence tail: deliver p to the next frame
        }
        case "quant": {
          step(state);
          if (frame.count < frame.q.min) {
            stack.push({
              t: "quantRep",
              q: frame.q,
              count: frame.count,
              p,
            });
            cur = { node: frame.q.node, si: p };
            return RESUME;
          }
          if (frame.count < frame.q.max) {
            // Greedy: try one more repetition, keeping "stop at p" as the
            // backtrack alternative.
            choices.push({
              frames: stack.slice(),
              alts: [{ deliverP: p }],
            });
            stack.push({
              t: "quantRep",
              q: frame.q,
              count: frame.count,
              p,
            });
            cur = { node: frame.q.node, si: p };
            return RESUME;
          }
          break; // max reached: deliver p onward
        }
        case "quantRep": {
          // An empty body match cannot make progress; refuse the loop.
          if (frame.p === p) return FAIL;
          stack.push({
            t: "quant",
            q: frame.q,
            count: frame.count + 1,
            p,
          });
          break; // deliver p to the quant frame
        }
      }
    }
  };

  // Backtrack to the most recent choice point; false when none remain.
  const backtrack = (): boolean => {
    cur = null;
    for (;;) {
      const choice = choices.pop();
      if (choice === undefined) return false;
      // Restore the continuation stack exactly as it was when the choice
      // was created (frames are immutable, so sharing them is safe).
      stack = choice.frames;
      const alt = choice.alts.shift();
      if (alt === undefined) continue;
      // Retain the choice point while any alternative remains untried, so
      // backtracking later resumes THIS choice (e.g. the third arm of
      // `a|b|c`) instead of discarding it after its first retry. Re-push
      // before attempting the alternative so choices created while running
      // that alternative sit above it, preserving most-recent-first order.
      if (choice.alts.length > 0) {
        choices.push(choice);
      }
      if ("node" in alt) {
        cur = { node: alt.node, si: alt.si };
        return true;
      }
      const r = deliver(alt.deliverP);
      if (r === RESUME) return true;
      if (r === DONE) return true; // finished flag is set
      // FAIL: this alternative is exhausted too — keep backtracking.
    }
  };

  for (;;) {
    const active: MatchCursor | null = cur;
    if (active === null) {
      if (!backtrack()) return false;
      if (finished) return true;
      continue;
    }
    step(state);
    const { node, si }: MatchCursor = active;
    let outcome: number = FAIL;
    switch (node.t) {
      case "char":
        outcome = si < s.length && s[si] === node.ch ? deliver(si + 1) : FAIL;
        break;
      case "any":
        outcome = si < s.length && s[si] !== "\n" ? deliver(si + 1) : FAIL;
        break;
      case "class":
        outcome =
          si < s.length && classMatches(node, s[si]) ? deliver(si + 1) : FAIL;
        break;
      case "start":
        outcome = si === 0 ? deliver(si) : FAIL;
        break;
      case "end":
        outcome = si === s.length ? deliver(si) : FAIL;
        break;
      case "seq": {
        if (node.parts.length === 0) {
          outcome = deliver(si);
        } else {
          stack.push({ t: "seq", parts: node.parts, idx: 1 });
          cur = { node: node.parts[0], si };
          outcome = RESUME;
        }
        break;
      }
      case "alt": {
        if (node.opts.length === 0) {
          outcome = FAIL;
        } else {
          choices.push({
            frames: stack.slice(),
            alts: node.opts.slice(1).map((opt) => ({ node: opt, si })),
          });
          cur = { node: node.opts[0], si };
          outcome = RESUME;
        }
        break;
      }
      case "quant": {
        stack.push({ t: "quant", q: node, count: 0, p: si });
        outcome = deliver(si);
        break;
      }
    }
    if (outcome === DONE) return true;
    if (outcome === FAIL) {
      if (!backtrack()) return false;
      // backtrack() may complete the match through a saved "stop here"
      // alternative that delivers to the top-level continuation.
      if (finished) return true;
    }
  }
}

// ---------------------------------------------------------------------------
// Deterministic sample synthesis
// ---------------------------------------------------------------------------

function isPlainObjectSafe(
  node: unknown,
  isProxy: IsProxyDetector | undefined,
): boolean {
  if (node === null || typeof node !== "object") return false;
  gateProxy(node, "field", isProxy);
  try {
    const proto = Object.getPrototypeOf(node);
    return proto === Object.prototype || proto === null;
  } catch {
    return false;
  }
}

function synthesizeNode(
  node: unknown,
  path: string,
  depth: number,
  budget: SynthesisBudget,
  isProxy: IsProxyDetector | undefined,
): unknown {
  if (depth > MAX_SAMPLE_CONTRACT_DEPTH) {
    throw new CodecTestGeneratorError(
      "UNSUPPORTED_NESTED_SHAPE",
      path,
      `contract nesting exceeds MAX_SAMPLE_CONTRACT_DEPTH (${MAX_SAMPLE_CONTRACT_DEPTH}) at ${path}`,
    );
  }
  // Precedence 1 (HOSTILE_INPUT) runs before the null/primitive check of
  // precedence 2 only where a plain record is REQUIRED (field maps, ports,
  // containers). A null/primitive contract NODE itself is precedence 2.
  if (typeof node !== "object" || node === null) {
    throw new CodecTestGeneratorError(
      "MALFORMED_CONTRACT",
      path,
      `expected a contract object at ${path}, got ${
        node === null ? "null" : typeof node
      }`,
    );
  }
  // Fail-closed Proxy gate BEFORE the prototype read (Lane HXS1).
  gateProxy(node, path, isProxy);
  let proto: unknown;
  try {
    proto = Object.getPrototypeOf(node);
  } catch {
    throw hostile(path, `reflection threw while reading the prototype`);
  }
  if (proto !== Object.prototype && proto !== null) {
    throw hostile(path, `non-plain contract node at ${path}`);
  }
  chargeNodes(budget, path);

  const kind = readOwnPlainProperty(node, "kind", isProxy);
  if (kind === undefined) {
    throw new CodecTestGeneratorError(
      "MALFORMED_CONTRACT",
      path,
      `contract at ${path} is missing "kind"`,
    );
  }
  if (typeof kind !== "string") {
    throw new CodecTestGeneratorError(
      "MALFORMED_CONTRACT",
      path,
      `contract "kind" at ${path} is not a string`,
    );
  }

  switch (kind) {
    case "object": {
      const exact = readOwnPlainProperty(node, "exact", isProxy);
      if (exact !== true) {
        throw new CodecTestGeneratorError(
          "MALFORMED_CONTRACT",
          path,
          `object contract at ${path} requires exact: true`,
        );
      }
      const fields = readOwnPlainProperty(node, "fields", isProxy);
      validatePlainRecord(fields, isProxy);
      let keys: string[];
      try {
        keys = Object.keys(fields as Record<string, unknown>);
      } catch {
        throw hostile(path, `reflection threw while enumerating fields`);
      }
      for (const key of keys) {
        if (POLLUTING_KEYS.has(key)) {
          throw hostile(path, `prototype-polluting field key "${safeEcho(key)}"`);
        }
      }
      if (keys.length > MAX_CONTRACT_FIELDS) {
        throw new CodecTestGeneratorError(
          "TIMEOUT_OR_BUDGET",
          path,
          `object at ${path} has ${keys.length} fields, exceeding MAX_CONTRACT_FIELDS (${MAX_CONTRACT_FIELDS})`,
        );
      }
      const sample: Record<string, unknown> = {};
      // Braces, then the actual UTF-8 size of each JSON-serialized key with
      // its colon/comma separators — charged per key, not approximated.
      chargeBytes(budget, 2, path);
      for (const key of [...keys].sort((a, b) =>
        a < b ? -1 : a > b ? 1 : 0,
      )) {
        chargeJsonString(budget, key, path);
        chargeBytes(budget, 2, path); // ":" + ","
        let field = readOwnPlainProperty(fields, key, isProxy);
        if (isPlainObjectSafe(field, isProxy)) {
          const optional = readOwnPlainProperty(field, "optional", isProxy);
          if (optional !== undefined && isPlainObjectSafe(optional, isProxy)) {
            field = optional;
          }
        }
        sample[key] = synthesizeNode(
          field,
          `${path}.${safeEcho(key)}`,
          depth + 1,
          budget,
          isProxy,
        );
      }
      return sample;
    }
    case "array": {
      const maxItems = readOwnPlainProperty(node, "maxItems", isProxy);
      if (maxItems === undefined) {
        throw new CodecTestGeneratorError(
          "MISSING_BOUND",
          path,
          `array contract at ${path} requires a positive integer maxItems (1 <= maxItems <= ${MAX_ARRAY_ITEMS_BOUND})`,
        );
      }
      if (
        typeof maxItems !== "number" ||
        !Number.isSafeInteger(maxItems) ||
        maxItems < 1 ||
        maxItems > MAX_ARRAY_ITEMS_BOUND
      ) {
        throw new CodecTestGeneratorError(
          "MISSING_BOUND",
          path,
          `array "maxItems" at ${path} must be a positive integer <= ${MAX_ARRAY_ITEMS_BOUND}`,
        );
      }
      const items = readOwnPlainProperty(node, "items", isProxy);
      if (items === undefined) {
        throw new CodecTestGeneratorError(
          "MALFORMED_CONTRACT",
          path,
          `array contract at ${path} is missing "items"`,
        );
      }
      // One element — item validation is exercised without unbounded output.
      chargeBytes(budget, 2, path);
      return [
        synthesizeNode(items, `${path}.items`, depth + 1, budget, isProxy),
      ];
    }
    case "string": {
      const maxLength = readOwnPlainProperty(node, "maxLength", isProxy);
      if (maxLength === undefined) {
        throw new CodecTestGeneratorError(
          "MISSING_BOUND",
          path,
          `string contract at ${path} requires a positive integer maxLength (1 <= maxLength <= ${MAX_STRING_LENGTH_BOUND})`,
        );
      }
      if (
        typeof maxLength !== "number" ||
        !Number.isSafeInteger(maxLength) ||
        maxLength < 1 ||
        maxLength > MAX_STRING_LENGTH_BOUND
      ) {
        throw new CodecTestGeneratorError(
          "MISSING_BOUND",
          path,
          `string "maxLength" at ${path} must be a positive integer <= ${MAX_STRING_LENGTH_BOUND}`,
        );
      }
      const pattern = readOwnPlainProperty(node, "pattern", isProxy);
      if (pattern !== undefined) {
        if (typeof pattern !== "string" || pattern.length === 0) {
          throw new CodecTestGeneratorError(
            "MALFORMED_CONTRACT",
            path,
            `string "pattern" at ${path} must be a non-empty string`,
          );
        }
        // Pattern syntax and size are validated BEFORE the example check so
        // an invalid or over-budget pattern keeps its own error precedence
        // even when the example is absent or not a string.
        if (pattern.length > MAX_PATTERN_LENGTH) {
          throw new CodecTestGeneratorError(
            "TIMEOUT_OR_BUDGET",
            "string.pattern",
            `pattern size ${pattern.length} exceeds the budget (MAX_PATTERN_LENGTH = ${MAX_PATTERN_LENGTH})`,
          );
        }
        parsePatternOrThrow(pattern);
        const example = readOwnPlainProperty(node, "example", isProxy);
        if (example === undefined || typeof example !== "string") {
          throw new CodecTestGeneratorError(
            "MISSING_PATTERN_EXAMPLE",
            path,
            `pattern string at ${path} requires an explicit "example" matching the pattern`,
          );
        }
        if (!matchesPatternBounded(pattern, example)) {
          throw new CodecTestGeneratorError(
            "MISSING_PATTERN_EXAMPLE",
            path,
            `pattern string at ${path} requires an explicit "example" matching the pattern`,
          );
        }
        if (example.length > maxLength) {
          // The example is the emitted sample; one longer than the string's
          // own maxLength is not a valid sample for the contract.
          throw new CodecTestGeneratorError(
            "MISSING_PATTERN_EXAMPLE",
            path,
            `pattern string "example" at ${path} is longer than the string bound maxLength (${maxLength}) and is not a valid sample`,
          );
        }
        chargeJsonString(budget, example, path);
        return example;
      }
      // Deterministic minimal sample: "a".repeat(min(1, maxLength)) === "a"
      // for every accepted maxLength (>= 1).
      chargeJsonString(budget, "a", path);
      return "a".repeat(Math.min(1, maxLength));
    }
    case "integer":
    case "number": {
      const min = readOwnPlainProperty(node, "min", isProxy);
      const max = readOwnPlainProperty(node, "max", isProxy);
      if (
        min !== undefined &&
        (typeof min !== "number" || !Number.isFinite(min))
      ) {
        throw new CodecTestGeneratorError(
          "MALFORMED_CONTRACT",
          path,
          `${safeEcho(kind)} "min" at ${path} must be a finite number`,
        );
      }
      if (
        max !== undefined &&
        (typeof max !== "number" || !Number.isFinite(max))
      ) {
        throw new CodecTestGeneratorError(
          "MALFORMED_CONTRACT",
          path,
          `${safeEcho(kind)} "max" at ${path} must be a finite number`,
        );
      }
      if (min !== undefined && max !== undefined && min > max) {
        throw new CodecTestGeneratorError(
          "UNSUPPORTED_NESTED_SHAPE",
          path,
          `inverted numeric bounds (min > max) at ${path}`,
        );
      }
      let value: number = min ?? 0;
      if (min === undefined && max !== undefined && max < 0) {
        value = max; // 0 would violate the upper bound; clamp to max.
      }
      if (kind === "integer") {
        // Integer semantics: the emitted value must be an integer, so a
        // fractional bound is rounded to the integer inside the bounds —
        // and bounds containing no integer are refused.
        if (min !== undefined) {
          value = Math.ceil(min);
          // Normalize -0 (e.g. ceil(-0.5)) to 0.
          if (Object.is(value, -0)) value = 0;
          if (max !== undefined && value > max) {
            throw new CodecTestGeneratorError(
              "UNSUPPORTED_NESTED_SHAPE",
              path,
              `integer bounds at ${path} contain no integer (min: ${min}, max: ${max})`,
            );
          }
        } else if (max !== undefined && max < 0) {
          value = Math.floor(max); // 0 would violate the upper bound
        } else {
          value = 0;
        }
      }
      chargeBytes(budget, String(value).length, path);
      return value;
    }
    case "boolean":
      // The serialized sample is `false` — 5 JSON bytes, charged like any
      // other emitted value so wide boolean objects cannot dodge the budget.
      chargeBytes(budget, 5, path);
      return false;
    case "enum": {
      const values = readOwnPlainProperty(node, "values", isProxy);
      if (values === undefined) {
        throw new CodecTestGeneratorError(
          "MALFORMED_CONTRACT",
          path,
          `enum contract at ${path} is missing "values"`,
        );
      }
      const dense = readBoundedDenseArray(
        values,
        MAX_CONTRACT_FIELDS,
        `${path}.values`,
        isProxy,
      );
      if (dense.length === 0) {
        throw new CodecTestGeneratorError(
          "UNSUPPORTED_NESTED_SHAPE",
          path,
          `enum at ${path} has an empty "values" array`,
        );
      }
      for (const v of dense) {
        if (typeof v !== "string") {
          throw new CodecTestGeneratorError(
            "UNSUPPORTED_NESTED_SHAPE",
            path,
            `enum at ${path} contains a non-string value`,
          );
        }
      }
      const first = dense[0] as string;
      chargeJsonString(budget, first, path);
      return first;
    }
    case "literal": {
      const value = readOwnPlainProperty(node, "value", isProxy);
      if (
        typeof value !== "string" &&
        typeof value !== "number" &&
        typeof value !== "boolean" &&
        value !== null
      ) {
        throw new CodecTestGeneratorError(
          "UNSUPPORTED_NESTED_SHAPE",
          path,
          `literal at ${path} must carry a string/number/boolean/null value`,
        );
      }
      if (typeof value === "number" && !Number.isFinite(value)) {
        throw new CodecTestGeneratorError(
          "MALFORMED_CONTRACT",
          path,
          `literal at ${path} must be a finite number`,
        );
      }
      chargeBytes(
        budget,
        typeof value === "string"
          ? jsonUtf8Length(value)
          : value === null
            ? 4
            : String(value).length,
        path,
      );
      return value;
    }
    case "nullable": {
      const of = readOwnPlainProperty(node, "of", isProxy);
      if (of === undefined) {
        throw new CodecTestGeneratorError(
          "MALFORMED_CONTRACT",
          path,
          `nullable contract at ${path} is missing "of"`,
        );
      }
      // Validate the inner node (it still charges the shared node budget)
      // but emit the null sample — that is the deterministic valid value.
      // The inner sample itself is discarded, so its bytes are tracked
      // against a scratch budget with enforcement disabled: an inner
      // contract whose hypothetical sample would exceed MAX_SAMPLE_BYTES
      // is still a valid nullable inner contract, because only the emitted
      // `null` (4 JSON bytes) is ever serialized. The shared node budget
      // still bounds the inner traversal.
      const innerBudget: SynthesisBudget = {
        nodes: budget.nodes,
        bytes: 0,
        discardBytes: true,
      };
      synthesizeNode(of, `${path}.of`, depth + 1, innerBudget, isProxy);
      budget.nodes = innerBudget.nodes;
      chargeBytes(budget, 4, path);
      return null;
    }
    default:
      throw new CodecTestGeneratorError(
        "UNKNOWN_TYPE",
        path,
        `unknown contract kind "${safeEcho(kind)}" at ${path}`,
      );
  }
}

/**
 * Synthesize ONE deterministic valid sample for an untrusted contract node.
 * Throws `CodecTestGeneratorError` with the deterministic error-code
 * precedence documented in the module header. O(N) with hard global budgets
 * (nodes + serialized bytes) enforced BEFORE any unbounded traversal or
 * allocation.
 */
export function synthesizeValidSample(
  contract: unknown,
  portLabel: string,
  isProxy?: IsProxyDetector,
): unknown {
  const budget: SynthesisBudget = { nodes: 0, bytes: 0 };
  const sample = synthesizeNode(contract, portLabel, 1, budget, isProxy);
  if (budget.bytes > MAX_SAMPLE_BYTES) {
    throw new CodecTestGeneratorError(
      "TIMEOUT_OR_BUDGET",
      portLabel,
      `synthesized sample for ${portLabel} exceeds MAX_SAMPLE_BYTES (${MAX_SAMPLE_BYTES})`,
    );
  }
  return sample;
}
