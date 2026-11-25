import type { ToolDefinition } from "./tool-definition.js";

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const MAX_STRING_LENGTH = 4096;

/**
 * Hostile-input guards mirroring the use case's own guards, applied before
 * any property of `args` is touched. Every read happens once, through own
 * property descriptors — a getter is never invoked. Null/undefined,
 * primitives, arrays, non-plain prototypes, array-like objects (own
 * `length` property), accessor properties, and prototype-polluting keys
 * are all refused.
 *
 * Accepted residual: a Proxy whose traps forward consistently in every
 * trap is indistinguishable from its plain target and is accepted.
 */
function assertPlainObject(
  input: unknown,
): asserts input is Record<string, unknown> {
  if (input === null || input === undefined) {
    throw new Error("input must be a plain object");
  }
  if (typeof input !== "object" || Array.isArray(input)) {
    throw new Error("input must be a plain object");
  }
  const proto = Object.getPrototypeOf(input);
  if (proto !== Object.prototype && proto !== null) {
    throw new Error("input must be a plain object");
  }
  // Array-like (own `length` property on a non-array object) is refused
  // before any iteration.
  if (Object.prototype.hasOwnProperty.call(input, "length")) {
    throw new Error("input must be a plain object");
  }
  for (const key of Object.getOwnPropertyNames(input)) {
    const desc = Object.getOwnPropertyDescriptor(input, key);
    if (
      desc &&
      (typeof desc.get === "function" || typeof desc.set === "function")
    ) {
      throw new Error("input must not contain accessor properties");
    }
  }
  for (const key of Object.getOwnPropertyNames(input)) {
    if (FORBIDDEN_KEYS.has(key)) {
      throw new Error("input contains forbidden key");
    }
  }
}

function requireOwnString(
  input: Record<string, unknown>,
  field: string,
  fields: readonly string[],
): string {
  const desc = Object.getOwnPropertyDescriptor(input, field);
  const value = desc?.value;
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${fields.join(" and ")} are required`);
  }
  if (value.length > MAX_STRING_LENGTH) {
    throw new Error(`${field} exceeds maximum length`);
  }
  return value;
}

function requireOwnOptionalBoolean(
  input: Record<string, unknown>,
  field: string,
): boolean | undefined {
  const desc = Object.getOwnPropertyDescriptor(input, field);
  const value = desc?.value;
  if (value !== undefined && typeof value !== "boolean") {
    throw new Error(`${field} must be a boolean`);
  }
  return value;
}

export const removeDependencyTool: ToolDefinition = {
  name: "hexagen_remove_dependency",
  description: "Remove a dependency relation from the manifest",
  inputSchema: {
    type: "object",
    properties: {
      source_module: { type: "string" },
      target_module: { type: "string" },
      dry_run: { type: "boolean" },
    },
    required: ["source_module", "target_module"],
  },
  handler: async (args, deps) => {
    try {
      assertPlainObject(args);
      const source_module = requireOwnString(args, "source_module", [
        "source_module",
        "target_module",
      ]);
      const target_module = requireOwnString(args, "target_module", [
        "source_module",
        "target_module",
      ]);
      const dry_run = requireOwnOptionalBoolean(args, "dry_run");

      if (!deps?.removeDependencyToolUseCase) {
        throw new Error("removeDependencyToolUseCase is required");
      }
      if (typeof deps.removeDependencyToolUseCase.execute !== "function") {
        throw new Error("removeDependencyToolUseCase.execute is required");
      }

      const result = await deps.removeDependencyToolUseCase.execute({
        source_module,
        target_module,
        dry_run: dry_run ?? false,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: error instanceof Error ? error.message : String(error),
          },
        ],
      };
    }
  },
};
