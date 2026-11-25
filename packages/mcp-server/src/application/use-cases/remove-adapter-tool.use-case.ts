import type { TransactionManagerPort } from "@hexagen/transaction-system";
import {
  PENDING_MANIFEST_MUTATION_KEY,
  type PendingManifestMutation,
} from "../pending-manifest-mutation.js";
import type {
  RemoveAdapterInput,
  RemoveAdapterOutput,
  RemoveAdapterToolPort,
} from "../ports/in/remove-adapter-tool.port.js";

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

export class RemoveAdapterToolUseCase implements RemoveAdapterToolPort {
  constructor(private readonly transactionManager: TransactionManagerPort) {}

  async execute(input: RemoveAdapterInput): Promise<RemoveAdapterOutput> {
    assertPlainObject(input);
    const context_name = requireString(input, "context_name", [
      "context_name",
      "adapter_name",
      "port_name",
    ]);
    const adapter_name = requireString(input, "adapter_name", [
      "context_name",
      "adapter_name",
      "port_name",
    ]);
    const port_name = requireString(input, "port_name", [
      "context_name",
      "adapter_name",
      "port_name",
    ]);
    const dry_run = requireOptionalBoolean(input, "dry_run");

    if (dry_run === true) {
      return {
        dryRun: true,
        removed: false,
        message: `Dry-run successful. Adapter ${adapter_name} can be removed from ${context_name}.`,
      };
    }

    if (
      !this.transactionManager ||
      typeof this.transactionManager?.begin !== "function"
    ) {
      throw new Error("TransactionManagerPort.begin is required");
    }

    const mutation: PendingManifestMutation = {
      kind: "remove-adapter",
      input: { context_name, adapter_name, port_name },
    };
    const tx = this.transactionManager.begin(
      `mcp:remove-adapter:${context_name}/${adapter_name}`,
      { [PENDING_MANIFEST_MUTATION_KEY]: mutation },
    );

    return {
      dryRun: false,
      removed: false,
      pendingApproval: true,
      transactionId: tx.id,
      message: `Proposed removal of adapter ${adapter_name}. Accept via hexagen_accept_transaction (${tx.id}) to write the manifest.`,
    };
  }
}
