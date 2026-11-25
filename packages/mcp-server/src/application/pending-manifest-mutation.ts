import type { EventBusPort } from "@hexagen/messaging";
import type { Transaction } from "@hexagen/transaction-system";
import type { AddDependencyInput } from "./ports/in/add-dependency-tool.port.js";
import type { CreateAdapterInput } from "./ports/in/create-adapter-tool.port.js";
import type { CreateContextInput } from "./ports/in/create-context-tool.port.js";
import type { CreatePortInput } from "./ports/in/create-port-tool.port.js";
import type { RemoveContextInput } from "./ports/in/remove-context-tool.port.js";
import type { RemovePortInput } from "./ports/in/remove-port-tool.port.js";
import type { ScaffoldModuleInput } from "./ports/in/scaffold-module-tool.port.js";
import type { ManifestWritePort } from "./ports/out/manifest-write.port.js";
import type { ScaffoldingPort } from "./ports/out/scaffolding.port.js";

export const PENDING_MANIFEST_MUTATION_KEY = "hexagenPendingManifestMutation";

// Defined locally — HXA1b will replace/align with inbound tool ports.
export interface PendingRemoveAdapterInput {
  context_name: string;
  adapter_name: string;
  port_name: string;
}

export interface PendingRemoveDependencyInput {
  source_module: string;
  target_module: string;
}

export type PendingManifestMutation =
  | { kind: "create-context"; input: CreateContextInput }
  | { kind: "add-dependency"; input: AddDependencyInput }
  | { kind: "create-port"; input: CreatePortInput }
  | { kind: "create-adapter"; input: CreateAdapterInput }
  | { kind: "remove-port"; input: RemovePortInput }
  | { kind: "remove-context"; input: RemoveContextInput }
  | { kind: "remove-adapter"; input: PendingRemoveAdapterInput }
  | { kind: "remove-dependency"; input: PendingRemoveDependencyInput }
  | { kind: "scaffold-module"; input: ScaffoldModuleInput };

// Hostile-input bounds for nested pending-mutation input snapshots. Both are
// O(1) constants; string/array scans are O(length) bounded by these caps.
const MAX_MUTATION_FIELD_LENGTH = 4096;
const MAX_MUTATION_ARRAY_LENGTH = 256;
const MAX_SNAPSHOT_DEPTH = 4;
const POLLUTING_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Deep-snapshot an untrusted nested value into fresh plain data. Every read
 * happens once, through own property descriptors — a getter is never
 * invoked. Getters/setters, functions, symbols, oversized strings/arrays,
 * polluting keys, and wrong-shaped objects are refused with null.
 *
 * Residual risk: a Proxy whose target is a plain object and whose traps
 * forward consistently is indistinguishable from the target itself and is
 * accepted (consistent-trap Proxy residual).
 */
function snapshotValue(value: unknown, depth: number): unknown | null {
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    if (value.length > MAX_MUTATION_FIELD_LENGTH) return null;
    return value;
  }
  if (depth >= MAX_SNAPSHOT_DEPTH) return null;
  if (Array.isArray(value)) {
    // Element-wise snapshot through own property descriptors: `i in value`
    // passes for an accessor and `value[i]` would invoke the getter, so
    // every index is inspected via getOwnPropertyDescriptor instead — a
    // getter is never invoked. Holes and accessor entries are refused.
    // Length is bounded by MAX_MUTATION_ARRAY_LENGTH (256) above, so this
    // scan is O(min(length, 256)).
    if (value.length > MAX_MUTATION_ARRAY_LENGTH) return null;
    const out: unknown[] = [];
    for (let i = 0; i < value.length; i++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
      if (!descriptor) return null; // hole
      if (
        typeof descriptor.get === "function" ||
        typeof descriptor.set === "function"
      ) {
        return null; // accessor element
      }
      const snap = snapshotValue(descriptor.value, depth + 1);
      if (snap === null && descriptor.value !== null) return null;
      out.push(snap);
    }
    return Object.freeze(out);
  }
  if (typeof value !== "object" || typeof value === "function") return null;
  // Nested plain object: same discipline as the top-level input snapshot.
  const source = value as Record<string, unknown>;
  const proto = Object.getPrototypeOf(source);
  if (proto !== Object.prototype && proto !== null) return null;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(source)) {
    if (POLLUTING_KEYS.has(key)) return null;
    const descriptor = Object.getOwnPropertyDescriptor(source, key);
    if (!descriptor || typeof descriptor.get === "function" || typeof descriptor.set === "function") {
      return null;
    }
    const snap = snapshotValue(descriptor.value, depth + 1);
    if (snap === null && descriptor.value !== null) return null;
    out[key] = snap;
  }
  return Object.freeze(out);
}

/**
 * Snapshot the nested `input` record into a fresh plain frozen object, so
 * grant approval (deriveMutationRef) and application (applyRemove*) read the
 * exact same values — a getter returning an allowed context at approval time
 * and a different one at apply time cannot split the check from the use.
 * Returns null on any refusal (getter, polluting key, oversized string,
 * non-plain object). O(fields × length), bounded by the caps above.
 *
 * Accepted residual (hostile-input rule): a Proxy whose traps forward
 * consistently in every trap is indistinguishable from its plain target and
 * is accepted. No Proxy detection is attempted — behaviour is unchanged for
 * this input class by design.
 */
function snapshotInput(input: unknown): Record<string, unknown> | null {
  if (input === null || input === undefined || typeof input !== "object") {
    return null;
  }
  if (Array.isArray(input)) return null;
  const snapshot = snapshotValue(input, 0);
  if (
    snapshot === null ||
    typeof snapshot !== "object" ||
    Array.isArray(snapshot)
  ) {
    return null;
  }
  return snapshot as Record<string, unknown>;
}

export function readPendingMutation(
  tx: Transaction,
): PendingManifestMutation | null {
  const raw = tx.metadata[PENDING_MANIFEST_MUTATION_KEY];
  if (raw === null || raw === undefined || typeof raw !== "object") {
    return null;
  }
  if (Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (POLLUTING_KEYS.has(key)) {
      return null;
    }
  }
  // Inspect own descriptors only — a getter is never invoked. `kind` and
  // `input` must both be own data properties of the record itself.
  const kindDescriptor = Object.getOwnPropertyDescriptor(record, "kind");
  if (!kindDescriptor || typeof kindDescriptor.get === "function") {
    return null;
  }
  const inputDescriptor = Object.getOwnPropertyDescriptor(record, "input");
  if (!inputDescriptor || typeof inputDescriptor.get === "function") {
    return null;
  }
  const kind = kindDescriptor.value;
  if (typeof kind !== "string") return null;
  const input = snapshotInput(inputDescriptor.value);
  if (input === null) return null;
  return Object.freeze({
    kind,
    input,
  }) as unknown as PendingManifestMutation;
}

export interface ApplyMutationPorts {
  manifestWrite: ManifestWritePort;
  scaffolding: ScaffoldingPort;
  eventBus: EventBusPort;
}

export interface AppliedMutation {
  message: string;
  details: Record<string, unknown>;
}

export async function applyPendingManifestMutation(
  mutation: PendingManifestMutation,
  ports: ApplyMutationPorts,
): Promise<AppliedMutation> {
  switch (mutation.kind) {
    case "create-context":
      return applyCreateContext(mutation.input, ports);
    case "add-dependency":
      return applyAddDependency(mutation.input, ports);
    case "create-port":
      return applyCreatePort(mutation.input, ports);
    case "create-adapter":
      return applyCreateAdapter(mutation.input, ports);
    case "remove-port":
      return applyRemovePort(mutation.input, ports);
    case "remove-context":
      return applyRemoveContext(mutation.input, ports);
    case "remove-adapter":
      return applyRemoveAdapter(mutation.input, ports);
    case "remove-dependency":
      return applyRemoveDependency(mutation.input, ports);
    case "scaffold-module":
      return applyScaffoldModule(mutation.input, ports);
  }
}

async function applyCreateContext(
  input: CreateContextInput,
  ports: ApplyMutationPorts,
): Promise<AppliedMutation> {
  const result = await ports.manifestWrite.registerBoundedContext({
    name: input.name,
    type: input.type,
    description: input.description,
  });
  if (!result.success) throw result.error;
  const { registered, alreadyExisted } = result.value;
  if (registered) {
    ports.eventBus.publish({
      type: "ContextCreated",
      payload: { contextName: input.name, contextType: input.type },
      timestamp: Date.now(),
      source: "mcp-server",
    });
  }
  return {
    message: alreadyExisted
      ? `Context '${input.name}' already exists.`
      : `Context '${input.name}' created with ${input.type} type.`,
    details: { registered, alreadyExisted },
  };
}

async function applyAddDependency(
  input: AddDependencyInput,
  ports: ApplyMutationPorts,
): Promise<AppliedMutation> {
  const result = await ports.manifestWrite.addDependency({
    sourceModule: input.sourceModule,
    targetModule: input.targetModule,
  });
  if (!result.success) throw result.error;
  if (result.value.updated) {
    ports.eventBus.publish({
      type: "DependencyAdded",
      payload: {
        source: input.sourceModule,
        target: input.targetModule,
        relationship: "depends_on",
      },
      timestamp: Date.now(),
      source: "mcp-server",
    });
  }
  return {
    message: result.value.updated
      ? "Dependency updated."
      : "Dependency already present.",
    details: { updated: result.value.updated },
  };
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

async function compensateCreatedFiles(
  scaffolding: ScaffoldingPort,
  paths: string[],
  cause: unknown,
): Promise<void> {
  const unique = [...new Set(paths.filter((p) => p.length > 0))];
  if (unique.length === 0) return;
  const compensated = await scaffolding.deleteCreatedFiles(unique);
  if (!compensated.success) {
    throw new Error(
      `${asError(cause).message}; also failed to compensate scaffolded files: ${asError(compensated.error).message}`,
    );
  }
}

async function applyCreatePort(
  input: CreatePortInput,
  ports: ApplyMutationPorts,
): Promise<AppliedMutation> {
  const fileResult = await ports.scaffolding.createPort({
    domainName: input.domain_name,
    portName: input.port_name,
    type: input.type,
  });
  if (!fileResult.success) throw fileResult.error;
  const registerResult = await ports.manifestWrite.registerPort({
    contextName: input.domain_name,
    portName: input.port_name,
    direction: input.type === "inbound" ? "in" : "out",
  });
  if (!registerResult.success) {
    await compensateCreatedFiles(
      ports.scaffolding,
      [fileResult.value.fileCreated],
      registerResult.error,
    );
    throw asError(registerResult.error);
  }
  return {
    message: `Port ${input.port_name} created and registered in manifest.`,
    details: { fileCreated: fileResult.value.fileCreated },
  };
}

async function applyCreateAdapter(
  input: CreateAdapterInput,
  ports: ApplyMutationPorts,
): Promise<AppliedMutation> {
  const fileResult = await ports.scaffolding.createAdapter({
    portName: input.port_name,
    infrastructureName: input.infrastructure_name,
  });
  if (!fileResult.success) throw fileResult.error;
  const registerResult = await ports.manifestWrite.registerAdapter({
    contextName: input.infrastructure_name,
    adapterName: input.port_name.replace(/Port$/, "") + "Adapter",
    portName: input.port_name,
  });
  if (!registerResult.success) {
    await compensateCreatedFiles(
      ports.scaffolding,
      [fileResult.value.fileCreated],
      registerResult.error,
    );
    throw asError(registerResult.error);
  }
  return {
    message: `Adapter for ${input.port_name} created and registered in manifest.`,
    details: { fileCreated: fileResult.value.fileCreated },
  };
}

async function applyRemovePort(
  input: RemovePortInput,
  ports: ApplyMutationPorts,
): Promise<AppliedMutation> {
  const result = await ports.manifestWrite.removePort({
    contextName: input.context_name,
    portName: input.port_name,
    direction: input.direction === "inbound" ? "in" : "out",
  });
  if (!result.success) throw result.error;
  if (result.value.removed) {
    ports.eventBus.publish({
      type: "PortRemoved",
      payload: {
        contextName: input.context_name,
        portName: input.port_name,
        direction: input.direction,
      },
      timestamp: Date.now(),
      source: "mcp-server",
    });
  }
  return {
    message: result.value.removed
      ? `Port ${input.port_name} removed from ${input.context_name}.`
      : `Port ${input.port_name} was not found in ${input.context_name}.`,
    details: { removed: result.value.removed },
  };
}

async function applyRemoveContext(
  input: RemoveContextInput,
  ports: ApplyMutationPorts,
): Promise<AppliedMutation> {
  const result = await ports.manifestWrite.removeContext({
    contextName: input.context_name,
  });
  if (!result.success) throw result.error;
  if (result.value.removed) {
    ports.eventBus.publish({
      type: "ContextRemoved",
      payload: { contextName: input.context_name },
      timestamp: Date.now(),
      source: "mcp-server",
    });
  }
  return {
    message: result.value.removed
      ? `Context ${input.context_name} removed from manifest.`
      : `Context ${input.context_name} was not found in manifest.`,
    details: { removed: result.value.removed },
  };
}

async function applyRemoveAdapter(
  input: PendingRemoveAdapterInput,
  ports: ApplyMutationPorts,
): Promise<AppliedMutation> {
  const write = ports.manifestWrite;
  if (!write || typeof write.removeAdapter !== "function") {
    throw new Error(
      "ManifestWritePort.removeAdapter is not available: the write port must implement removeAdapter.",
    );
  }
  const result = await write.removeAdapter({
    contextName: input.context_name,
    adapterName: input.adapter_name,
    portName: input.port_name,
  });
  if (!result.success) throw result.error;
  if (result.value.removed) {
    ports.eventBus.publish({
      type: "AdapterRemoved",
      payload: {
        contextName: input.context_name,
        adapterName: input.adapter_name,
        portName: input.port_name,
      },
      timestamp: Date.now(),
      source: "mcp-server",
    });
  }
  return {
    message: result.value.removed
      ? `Adapter ${input.adapter_name} removed from ${input.context_name}.`
      : `Adapter ${input.adapter_name} was not found in ${input.context_name}.`,
    details: { removed: result.value.removed },
  };
}

async function applyRemoveDependency(
  input: PendingRemoveDependencyInput,
  ports: ApplyMutationPorts,
): Promise<AppliedMutation> {
  const write = ports.manifestWrite;
  if (!write || typeof write.removeDependency !== "function") {
    throw new Error(
      "ManifestWritePort.removeDependency is not available: the write port must implement removeDependency.",
    );
  }
  const result = await write.removeDependency({
    sourceModule: input.source_module,
    targetModule: input.target_module,
  });
  if (!result.success) throw result.error;
  if (result.value.removed) {
    ports.eventBus.publish({
      type: "DependencyRemoved",
      payload: {
        source: input.source_module,
        target: input.target_module,
      },
      timestamp: Date.now(),
      source: "mcp-server",
    });
  }
  return {
    message: result.value.removed
      ? `Dependency ${input.source_module} → ${input.target_module} removed.`
      : `Dependency ${input.source_module} → ${input.target_module} was not found.`,
    details: { removed: result.value.removed },
  };
}

async function applyScaffoldModule(
  input: ScaffoldModuleInput,
  ports: ApplyMutationPorts,
): Promise<AppliedMutation> {
  const scaffoldResult = await ports.scaffolding.scaffoldModule({
    name: input.name,
    layer: input.layer,
  });
  if (!scaffoldResult.success) throw scaffoldResult.error;
  const registerResult = await ports.manifestWrite.registerBoundedContext({
    name: input.name,
    type: input.context_type ?? "core",
  });
  if (!registerResult.success) {
    await compensateCreatedFiles(
      ports.scaffolding,
      scaffoldResult.value.filesCreated,
      registerResult.error,
    );
    throw asError(registerResult.error);
  }
  ports.eventBus.publish({
    type: "ModuleScaffolded",
    payload: { moduleName: input.name, layer: input.layer },
    timestamp: Date.now(),
    source: "mcp-server",
  });
  const { filesCreated } = scaffoldResult.value;
  const { registered, alreadyExisted } = registerResult.value;
  const manifestNote = alreadyExisted
    ? " (already in manifest)"
    : registered
      ? " and registered in manifest"
      : "";
  return {
    message: `Scaffolded module ${input.name}${manifestNote}.`,
    details: { filesCreated, registeredInManifest: registered },
  };
}
