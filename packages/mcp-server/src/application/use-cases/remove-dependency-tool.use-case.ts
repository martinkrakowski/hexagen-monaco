import type { TransactionManagerPort } from "@hexagen/transaction-system";
import {
  PENDING_MANIFEST_MUTATION_KEY,
  type PendingManifestMutation,
} from "../pending-manifest-mutation.js";
import type {
  RemoveDependencyInput,
  RemoveDependencyOutput,
  RemoveDependencyToolPort,
} from "../ports/in/remove-dependency-tool.port.js";

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const MAX_STRING_LENGTH = 4096;

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

function requireString(
  input: Record<string, unknown>,
  field: string,
  fields: readonly string[],
): string {
  const value = input[field];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${fields.join(" and ")} are required`);
  }
  if (value.length > MAX_STRING_LENGTH) {
    throw new Error(`${field} exceeds maximum length`);
  }
  return value;
}

function requireOptionalBoolean(
  input: Record<string, unknown>,
  field: string,
): boolean | undefined {
  const value = input[field];
  if (value !== undefined && typeof value !== "boolean") {
    throw new Error(`${field} must be a boolean`);
  }
  return value;
}

export class RemoveDependencyToolUseCase implements RemoveDependencyToolPort {
  constructor(private readonly transactionManager: TransactionManagerPort) {}

  async execute(input: RemoveDependencyInput): Promise<RemoveDependencyOutput> {
    assertPlainObject(input);
    const source_module = requireString(input, "source_module", [
      "source_module",
      "target_module",
    ]);
    const target_module = requireString(input, "target_module", [
      "source_module",
      "target_module",
    ]);
    const dry_run = requireOptionalBoolean(input, "dry_run");

    if (dry_run === true) {
      return {
        dryRun: true,
        removed: false,
        message: `Dry-run successful. Dependency ${source_module} -> ${target_module} can be removed.`,
      };
    }

    if (
      !this.transactionManager ||
      typeof this.transactionManager?.begin !== "function"
    ) {
      throw new Error("TransactionManagerPort.begin is required");
    }

    const mutation: PendingManifestMutation = {
      kind: "remove-dependency",
      input: { source_module, target_module },
    };
    const tx = this.transactionManager.begin(
      `mcp:remove-dependency:${source_module}->${target_module}`,
      { [PENDING_MANIFEST_MUTATION_KEY]: mutation },
    );

    return {
      dryRun: false,
      removed: false,
      pendingApproval: true,
      transactionId: tx.id,
      message: `Proposed removal of dependency ${source_module} -> ${target_module}. Accept via hexagen_accept_transaction (${tx.id}) to write the manifest.`,
    };
  }
}
