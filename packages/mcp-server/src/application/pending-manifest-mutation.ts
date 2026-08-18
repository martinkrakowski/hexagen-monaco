import type { EventBusPort } from "@hexagen/messaging";
import type { BoundedContextType } from "@hexagen/shared";
import type { Transaction } from "@hexagen/transaction-system";
import type { AddDependencyInput } from "./ports/in/add-dependency-tool.port.js";
import type { CreateAdapterInput } from "./ports/in/create-adapter-tool.port.js";
import type { CreateContextInput } from "./ports/in/create-context-tool.port.js";
import type { CreatePortInput } from "./ports/in/create-port-tool.port.js";
import type { RemoveContextInput } from "./ports/in/remove-context-tool.port.js";
import type { RemovePortInput } from "./ports/in/remove-port-tool.port.js";
import type { ManifestWritePort } from "./ports/out/manifest-write.port.js";
import type { ScaffoldingPort } from "./ports/out/scaffolding.port.js";

export interface ScaffoldModuleMutationInput {
  name: string;
  layer: "domain" | "application" | "infrastructure";
  context_type?: BoundedContextType;
  dry_run?: boolean;
}

export const PENDING_MANIFEST_MUTATION_KEY = "hexagenPendingManifestMutation";

export type PendingManifestMutation =
  | { kind: "create-context"; input: CreateContextInput }
  | { kind: "add-dependency"; input: AddDependencyInput }
  | { kind: "create-port"; input: CreatePortInput }
  | { kind: "create-adapter"; input: CreateAdapterInput }
  | { kind: "remove-port"; input: RemovePortInput }
  | { kind: "remove-context"; input: RemoveContextInput }
  | { kind: "scaffold-module"; input: ScaffoldModuleMutationInput };

export function readPendingMutation(
  tx: Transaction,
): PendingManifestMutation | null {
  const raw = tx.metadata[PENDING_MANIFEST_MUTATION_KEY];
  if (!raw || typeof raw !== "object") return null;
  const kind = (raw as { kind?: unknown }).kind;
  if (typeof kind !== "string") return null;
  return raw as PendingManifestMutation;
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
  if (!registerResult.success) throw registerResult.error;
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
  if (!registerResult.success) throw registerResult.error;
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

async function applyScaffoldModule(
  input: ScaffoldModuleMutationInput,
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
  if (!registerResult.success) throw registerResult.error;
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
