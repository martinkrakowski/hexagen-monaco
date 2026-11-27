// packages/sync/src/generators/codec-test.ts
//
// Lane H3: emits `<moduleDir>/__tests__/codecs/<PortName>.codec.test.ts` for
// every application port (`in`/`out`) declaring `contracts:`. The emitted
// file executes the Lane-H2 codec against the fleet-v2 adversarial corpus
// and one deterministic valid sample synthesized from the contract.
//
// The manifest is UNTRUSTED: every read goes through the descriptor-based
// safe-read order in codec-sample-synthesizer.ts (`readOwnPlainProperty` /
// `validatePlainRecord`) — accessors are never invoked, Proxy trap throws
// and reflection errors are refused, sparse holes and array-likes are
// refused, and bounds are enforced before iterating. `portName(port)` from
// types/manifest/helpers is NEVER called on an unvalidated object.
//
// Placement: `__tests__/codecs/` sits outside `src/`, so
// `generateRecursiveBarrels` (BARREL_EXCLUSIONS includes "__tests__") and the
// production tsconfig (`include: ["src/**/*"]`) never see it, while Vitest
// and tsconfig.test.json execute and typecheck it.
//
// Cost bound: O(contexts × ports × schema nodes) — at most 64 contexts, 64
// ports per direction, and the synthesizer's own global node/byte budgets
// per contract; `moduleName`, port names and `runtimeModule` are validated
// against path traversal / control characters BEFORE any `path.join` or
// template interpolation.

import path from "node:path";
import { types } from "node:util";
import type { SyncConfig } from "../config.js";
import { isInScope, safeWriteFileAtomic } from "../fs-utils.js";
import {
  createEmptyResult,
  recordWriteStatus,
  type GeneratorResult,
  type WriteStatus,
} from "../results.js";
import type { ReportRecorder } from "../domain/types.js";
import { toPascalCaseIdentifier } from "../domain/services/name-normalizer.js";
import {
  MAX_BOUNDED_CONTEXTS,
  MAX_PORTS_PER_CONTEXT,
  CodecTestGeneratorError,
  installIsProxyDetector,
  readOwnPlainProperty,
  synthesizeValidSample,
  validatePlainRecord,
} from "../domain/services/codec-sample-synthesizer.js";

// Composition seam for the domain layer's proxy-detection port: the domain
// module must not import Node builtins (arch-lint node-builtin-in-layer), so
// util.types.isProxy is installed here at module load — every production
// entry into the synthesizer goes through this generator.
installIsProxyDetector(types.isProxy);

/** Default runtime module providing the fleet-v2 codec contract. */
export const DEFAULT_RUNTIME_MODULE = "@fleet/shared";

/** `runtimeModule` must be a safe package or relative specifier. */
const RUNTIME_MODULE_PATTERN = /^[A-Za-z0-9@][A-Za-z0-9@/._-]*$/;

/** Port/module names must be safe path segments. */
const SAFE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function malformedName(what: string, value: unknown): CodecTestGeneratorError {
  return new CodecTestGeneratorError(
    "MALFORMED_CONTRACT",
    what,
    `${what} must be a non-empty safe name (no path separators, traversal, or control characters), got ${typeof value}`,
  );
}

/**
 * Validate a module or port name for use in a path / import specifier.
 * Cost: O(name length), bounded by the 128-character cap.
 */
function validateSafeName(value: unknown, what: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 128 ||
    !SAFE_NAME_PATTERN.test(value) ||
    value.includes("..")
  ) {
    throw malformedName(what, value);
  }
  return value;
}

function validateRuntimeModule(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 256 ||
    !RUNTIME_MODULE_PATTERN.test(value)
  ) {
    throw new CodecTestGeneratorError(
      "MALFORMED_CONTRACT",
      "generator.codec.runtimeModule",
      `generator.codec.runtimeModule must be a non-empty safe package or relative specifier without whitespace or control characters`,
    );
  }
  return value;
}

/**
 * Resolve `manifest.generator.codec.runtimeModule` through the descriptor
 * boundary, defaulting to "@fleet/shared" when absent at any level.
 */
function resolveRuntimeModuleSafe(manifest: unknown): string {
  const gen = readOwnPlainProperty(manifest, "generator");
  if (gen === undefined) return DEFAULT_RUNTIME_MODULE;
  const sync = readOwnPlainProperty(gen, "codec");
  if (sync === undefined) return DEFAULT_RUNTIME_MODULE;
  const runtimeModule = readOwnPlainProperty(sync, "runtimeModule");
  if (runtimeModule === undefined) return DEFAULT_RUNTIME_MODULE;
  return validateRuntimeModule(runtimeModule);
}

export async function generateCodecTests(
  moduleDir: string,
  moduleName: string,
  config: SyncConfig,
  report?: ReportRecorder,
): Promise<GeneratorResult> {
  const result = createEmptyResult();
  try {
    // Path traversal is refused BEFORE path.join ever sees the name.
    validateSafeName(moduleName, "moduleName");

    const manifest: unknown = config.manifest;
    const context = findBoundedContext(manifest, moduleName);
    if (context === undefined) return result; // context not declared — nothing to emit

    const runtimeModule = resolveRuntimeModuleSafe(manifest);

    const layers = readOwnPlainProperty(context, "layers");
    if (layers === undefined) return result;
    const application = readOwnPlainProperty(layers, "application");
    if (application === undefined) return result;
    const ports = readOwnPlainProperty(application, "ports");
    if (ports === undefined) return result;

    for (const direction of ["in", "out"] as const) {
      const directionPorts = readOwnPlainProperty(ports, direction);
      if (directionPorts === undefined) continue;
      const portList = readPortList(
        directionPorts,
        `layers.application.ports.${direction}`,
      );
      for (const port of portList) {
        await emitPortCodecTest(
          port,
          direction,
          moduleDir,
          moduleName,
          runtimeModule,
          config,
          report,
          result,
        );
        if (result.error) return result; // first failure wins, failed-soft
      }
    }
    return result;
  } catch (thrown) {
    // Failed-soft generator contract: CodecTestGeneratorError passes through
    // with its code; any other escape (including filesystem errors from
    // safeWriteFileAtomic) maps to IO_FAILURE. Never a silent skip, never a
    // green `totalOps: 0` masquerade.
    const error =
      thrown instanceof CodecTestGeneratorError
        ? thrown
        : new CodecTestGeneratorError(
            "IO_FAILURE",
            null,
            thrown instanceof Error ? thrown.message : String(thrown),
          );
    result.error = error;
    result.summary = `CodecTests failed for ${moduleName}: [${error.code}] ${error.message}`;
    config.logger.error(result.summary);
    report?.record(
      "error",
      path.join(moduleDir, "__tests__", "codecs"),
      result.summary,
    );
    return result;
  }
}

/**
 * Locate the bounded context whose `name` equals `moduleName`, reading every
 * entry through the safe-read order. The scan is bounded by
 * MAX_BOUNDED_CONTEXTS; sparse holes, array-likes, non-plain entries and
 * hostile names are refused with HOSTILE_INPUT / MALFORMED_CONTRACT.
 */
function findBoundedContext(manifest: unknown, moduleName: string): unknown {
  const contexts = readOwnPlainProperty(manifest, "bounded_contexts");
  if (contexts === undefined) return undefined;
  if (!Array.isArray(contexts)) {
    throw new CodecTestGeneratorError(
      "HOSTILE_INPUT",
      "bounded_contexts",
      `bounded_contexts must be a dense array`,
    );
  }
  let ctxLen: number;
  try {
    ctxLen = contexts.length;
  } catch {
    throw new CodecTestGeneratorError(
      "HOSTILE_INPUT",
      "bounded_contexts",
      `reflection threw while reading the length of bounded_contexts`,
    );
  }
  if (ctxLen > MAX_BOUNDED_CONTEXTS) {
    throw new CodecTestGeneratorError(
      "HOSTILE_INPUT",
      "bounded_contexts",
      `bounded_contexts has ${ctxLen} entries, exceeding MAX_BOUNDED_CONTEXTS (${MAX_BOUNDED_CONTEXTS})`,
    );
  }
  for (let i = 0; i < ctxLen; i++) {
    let present: boolean;
    try {
      present = i in contexts;
    } catch {
      throw new CodecTestGeneratorError(
        "HOSTILE_INPUT",
        `bounded_contexts[${i}]`,
        `reflection threw while probing index ${i} of bounded_contexts`,
      );
    }
    if (!present) {
      throw new CodecTestGeneratorError(
        "HOSTILE_INPUT",
        `bounded_contexts[${i}]`,
        `sparse array hole at index ${i} of bounded_contexts`,
      );
    }
    // Arrays are validated above; read the entry through its own descriptor
    // (readOwnPlainProperty would refuse the Array.prototype prototype).
    let desc: PropertyDescriptor | undefined;
    try {
      desc = Object.getOwnPropertyDescriptor(contexts, String(i));
    } catch {
      throw new CodecTestGeneratorError(
        "HOSTILE_INPUT",
        `bounded_contexts[${i}]`,
        `reflection threw while reading index ${i} of bounded_contexts`,
      );
    }
    if (!desc || desc.get !== undefined || desc.set !== undefined) {
      throw new CodecTestGeneratorError(
        "HOSTILE_INPUT",
        `bounded_contexts[${i}]`,
        `missing or accessor entry at index ${i} of bounded_contexts`,
      );
    }
    const entry = desc.value;
    validatePlainRecord(entry);
    const name = readOwnPlainProperty(entry, "name");
    if (name === undefined) continue;
    if (name === moduleName) return entry;
  }
  return undefined;
}

/**
 * Validate one direction's port list: Array.isArray (refusing array-likes
 * and non-iterables), `length <= MAX_PORTS_PER_CONTEXT` (refusing enormous
 * lengths) and `i in arr` for every index (refusing holes).
 */
function readPortList(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new CodecTestGeneratorError(
      "HOSTILE_INPUT",
      label,
      `${label} must be a dense array (arrays, array-likes and non-iterables are refused)`,
    );
  }
  // A Proxy over an array passes Array.isArray, so the length comes from its
  // own data descriptor inside a trap-catching boundary — an ordinary
  // `.length` read would run a Proxy `get` trap outside the boundary.
  let proto: unknown;
  let lenDesc: PropertyDescriptor | undefined;
  try {
    proto = Object.getPrototypeOf(value);
    lenDesc = Object.getOwnPropertyDescriptor(value, "length");
  } catch {
    throw new CodecTestGeneratorError(
      "HOSTILE_INPUT",
      label,
      `reflection threw while inspecting ${label} (hostile Proxy trap)`,
    );
  }
  if (proto !== Array.prototype && proto !== null) {
    throw new CodecTestGeneratorError(
      "HOSTILE_INPUT",
      label,
      `${label} has a non-plain array prototype`,
    );
  }
  if (!lenDesc || lenDesc.get !== undefined || lenDesc.set !== undefined) {
    throw new CodecTestGeneratorError(
      "HOSTILE_INPUT",
      label,
      `${label} "length" is missing or an accessor`,
    );
  }
  const len = lenDesc.value;
  if (typeof len !== "number" || !Number.isSafeInteger(len) || len < 0) {
    throw new CodecTestGeneratorError(
      "HOSTILE_INPUT",
      label,
      `${label} "length" is not a non-negative safe integer`,
    );
  }
  if (len > MAX_PORTS_PER_CONTEXT) {
    throw new CodecTestGeneratorError(
      "HOSTILE_INPUT",
      label,
      `${label} has ${len} entries, exceeding MAX_PORTS_PER_CONTEXT (${MAX_PORTS_PER_CONTEXT})`,
    );
  }
  const ports: unknown[] = [];
  for (let i = 0; i < len; i++) {
    let desc: PropertyDescriptor | undefined;
    try {
      desc = Object.getOwnPropertyDescriptor(value, String(i));
    } catch {
      throw new CodecTestGeneratorError(
        "HOSTILE_INPUT",
        label,
        `reflection threw while reading index ${i} of ${label}`,
      );
    }
    if (!desc) {
      throw new CodecTestGeneratorError(
        "HOSTILE_INPUT",
        `${label}[${i}]`,
        `sparse array hole at index ${i} of ${label}`,
      );
    }
    if (desc.get !== undefined || desc.set !== undefined) {
      throw new CodecTestGeneratorError(
        "HOSTILE_INPUT",
        `${label}[${i}]`,
        `accessor at index ${i} of ${label} (getters are never invoked)`,
      );
    }
    ports.push(desc.value);
  }
  return ports;
}

/**
 * Emit one port's codec test. Ports without a `contracts` block (including
 * legacy string-name entries) are skipped silently — they have nothing to
 * test. Everything else goes through the safe-read order and the
 * synthesizer, and any refusal propagates as CodecTestGeneratorError.
 */
async function emitPortCodecTest(
  port: unknown,
  direction: "in" | "out",
  moduleDir: string,
  moduleName: string,
  runtimeModule: string,
  config: SyncConfig,
  report: ReportRecorder | undefined,
  result: GeneratorResult,
): Promise<void> {
  const label = `${moduleName}.ports.${direction}[]`;

  if (typeof port === "string") {
    // Legacy name-only port entry: no contracts block, nothing to emit —
    // but the name must still be safe before it is ever rendered.
    validateSafeName(port, `${label}.name`);
    return;
  }

  validatePlainRecord(port);
  const rawName = readOwnPlainProperty(port, "name");
  if (rawName === undefined) {
    throw new CodecTestGeneratorError(
      "MALFORMED_CONTRACT",
      `${label}.name`,
      `port entry at ${label} is missing a "name"`,
    );
  }
  validateSafeName(rawName, `${label}.name`);

  const contracts = readOwnPlainProperty(port, "contracts");
  if (contracts === undefined) return; // contractless port — skip
  validatePlainRecord(contracts);

  const request = readOwnPlainProperty(contracts, "request");
  if (request === undefined) {
    throw new CodecTestGeneratorError(
      "MALFORMED_CONTRACT",
      `${label}.contracts.request`,
      `contracts at ${label} is missing a "request" schema`,
    );
  }

  const portLabel = `${moduleName}.${direction}.${validateSafeName(rawName, `${label}.name`)}`;
  const rawPortName = validateSafeName(rawName, `${label}.name`);
  const sample = synthesizeValidSample(request, portLabel);

  const portName = toPascalCaseIdentifier(
    rawPortName.replace(/\.(in|out)-port\.ts$/, ""),
  );
  const portFileBase = rawPortName.replace(/\.ts$/, "");
  const filePath = path.join(
    moduleDir,
    "__tests__",
    "codecs",
    `${portName}.codec.test.ts`,
  );
  const content = renderCodecTest({
    portName,
    portFileBase,
    runtimeModule,
    sample,
  });

  if (!isInScope(filePath, config)) {
    config.logger.debug(
      `skipped (outside --only) ${path.relative(config.workspaceRoot, filePath)}`,
    );
    recordWriteStatus(result, filePath, "skipped");
    return;
  }

  const status: WriteStatus = await safeWriteFileAtomic(
    filePath,
    content,
    config,
    report,
    false,
  );
  recordWriteStatus(result, filePath, status);
}

export interface RenderCodecTestInput {
  portName: string;
  portFileBase: string;
  runtimeModule: string;
  sample: unknown;
}

/**
 * Render the emitted codec test. Deterministic: the synthesized sample is
 * embedded as a JSON literal, so equal inputs yield byte-identical output
 * (idempotent re-runs land on "unchanged").
 */
export function renderCodecTest(input: RenderCodecTestInput): string {
  const { portName, portFileBase, runtimeModule, sample } = input;
  return `// @generated by @hexagen/sync
import { describe, it, expect } from "vitest";
import { types } from "node:util";
import { ADVERSARIAL_CORPUS, type CodecEnv, type DecodeResult } from ${JSON.stringify(runtimeModule)};
import { create${portName}Codec } from "../../src/application/ports/${portFileBase}.codec.js";

const env: CodecEnv = { isProxy: types.isProxy };
const codec = create${portName}Codec(env);

const VALID_SAMPLE = ${JSON.stringify(sample, null, 2)} as const;

describe.each(ADVERSARIAL_CORPUS)("${portName} codec refuses adversarial entries", (entry) => {
  it("refuses the adversarial entry", () => {
    const res: DecodeResult<unknown> = codec.decode(entry.build());
    expect(res.ok).toBe(false);
  });
});

it("decodes the synthesized valid sample and freezes the value", () => {
  const res = codec.decode(VALID_SAMPLE);
  expect(res.ok).toBe(true);
  if (res.ok) expect(Object.isFrozen(res.value)).toBe(true);
});
`;
}
