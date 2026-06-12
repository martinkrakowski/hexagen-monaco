import fs from "node:fs/promises";
import path from "node:path";
import type { SyncConfig } from "../config.js";
import {
  createEmptyResult,
  recordWriteStatus,
  type GeneratorResult,
} from "../results.js";
import { safeWriteFileAtomic, isInScope } from "../fs-utils.js";
import { resolveScope } from "../types/manifest.js";
import {
  analyzePortFile,
  generateAdapterFromPort,
  relativeImportSpecifier,
} from "./port-analyzer.js";
import type { ReportRecorder } from "../domain/types.js";

/**
 * Dedicated cross-context transport emitter (Phase 3 — event-bus + network).
 *
 * Reads `manifest.cross_context` (edges produced by the wizard's
 * `deriveCrossContextEdges`) and writes **bespoke** transport with real
 * interfaces — recognizably an event bus or an HTTP boundary, not a generic stub.
 * It dispatches on each edge's `transport`:
 *
 * - **`event-bus`** (Phase 3a): a shared event contract per event name; a
 *   publisher port (`message-publisher.out-port.ts`, `publish(event)`) on each
 *   provider; a subscriber port (`event-listener.in-port.ts`, `handle(event)`) on
 *   each consumer.
 * - **`network`** (Phase 3b): a shared `<Op>Request`/`<Op>Response` DTO pair per
 *   operation; a controller port (`rest-controller.in-port.ts`) on each provider;
 *   a client port (`external-service-client.out-port.ts`) on each consumer — both
 *   with one `<op>(request): Promise<response>` method per operation.
 *
 * Adapters are derived from the bespoke ports via `generateAdapterFromPort`.
 *
 * This generator is the SOLE writer of these files: they are deliberately NOT
 * declared in the manifest layers, because `generateStubs` would overwrite the
 * bespoke content with generic stubs under the web flow's `forceRoot`
 * (`safeWriteFileAtomic` only preserves hand-written files when `!forceRoot`).
 * It runs after `generateApps` and before the pass-2 barrels, which are
 * disk-based and re-export the emitted files automatically.
 */

interface CrossContextEdge {
  consumer?: string;
  provider?: string;
  transport?: string;
  events?: string[];
  operations?: string[];
  integrationPattern?: string;
}

// DDD integration-pattern annotations (Phase 3c). A single per-edge value maps to
// one end: `open-host` marks the PROVIDER's port as a published-language Open Host
// Service; `acl` marks the CONSUMER's port as an Anti-Corruption Layer. Appended
// to the port doc so the pattern is visible in the generated contract (the runtime
// translation is the user's to fill — C1).
const OHS_NOTE =
  "\n *\n * Open Host Service (open-host): this is this context's published language " +
  "for consuming contexts — keep it stable.";
const ACL_NOTE =
  "\n *\n * Anti-Corruption Layer (acl): translate the upstream contract into this " +
  "context's own domain model; do not leak provider types inward.";

function addAll(
  map: Map<string, Set<string>>,
  key: string,
  values: string[],
): void {
  const set = map.get(key) ?? new Set<string>();
  values.forEach((v) => set.add(v));
  map.set(key, set);
}

/**
 * PascalCase a kebab/dot stem into a valid TS identifier (e.g.
 * `message-publisher` → `MessagePublisher`). Kept local — a 5-line pure helper —
 * rather than coupling this emitter to `architecture-files.ts`'s private copy.
 */
function toPascalCase(stem: string): string {
  return stem
    .split(/[-.]/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

/**
 * camelCase a PascalCase operation base into a method name (`GetInvoice` →
 * `getInvoice`; single-segment `Billing` → `billing`).
 */
function toCamelCase(pascal: string): string {
  return pascal.length > 0
    ? pascal.charAt(0).toLowerCase() + pascal.slice(1)
    : pascal;
}

/**
 * A name safe to use as a package directory segment. The emitter builds
 * `packages/<context>/...` paths from edge provider/consumer names, bypassing the
 * SyncEngine per-module guard — so it must reject traversal itself (mirrors that
 * guard and the generateApps hardening in #237) for unvalidated `/api/generate`
 * manifests.
 */
function isSafePathSegment(name: string): boolean {
  return (
    name.length > 0 &&
    !name.includes("..") &&
    !name.includes("/") &&
    !name.includes("\\") &&
    !name.startsWith(".")
  );
}

/**
 * Whether `name` is a valid TypeScript identifier — event/operation names become
 * interface names and method param/return types, so an invalid one (leading
 * digit, hyphen, empty) would emit uncompilable declarations. Names arrive already
 * PascalCased from the wizard; this is the emitter's single choke point that drops
 * any residual pathological value rather than generating broken code.
 */
function isValidTsIdentifier(name: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name);
}

function eventContractContent(name: string): string {
  return `// @generated cross-context event contract — edit freely
/**
 * ${name} is a domain event published across an event-bus boundary.
 * Both the publishing and subscribing contexts depend on this shared contract.
 */
export interface ${name} {
  // TODO: define the event payload
  readonly occurredAt: string;
}
`;
}

function dtoContent(op: string): string {
  return `// @generated cross-context DTO — edit freely
/**
 * Request/response payloads for the ${op} operation, exchanged across the
 * network boundary. Both the calling (client) and serving (controller) contexts
 * depend on these shared contracts.
 */
export interface ${op}Request {
  // TODO: define the request fields
  readonly _placeholder?: never;
}

export interface ${op}Response {
  // TODO: define the response fields
  readonly _placeholder?: never;
}
`;
}

/** One method signature on a bespoke transport port. */
interface PortMethod {
  name: string;
  paramName: string;
  paramType: string;
  returnType: string;
}

/**
 * Render a bespoke port interface with one or more real method signatures and a
 * single shared-kernel type import. Event-bus ports have one method
 * (`publish`/`handle`); network ports have one per operation.
 */
function portContent(
  scope: string,
  interfaceName: string,
  methods: PortMethod[],
  importedTypes: string[],
  doc: string,
): string {
  const uniqueImports = [...new Set(importedTypes)].sort();
  const importLine =
    uniqueImports.length > 0
      ? `import type { ${uniqueImports.join(", ")} } from "@${scope}/shared";\n\n`
      : "";
  const methodLines = methods
    .map(
      (m) =>
        `  ${m.name}(${m.paramName}: ${m.paramType}): Promise<${m.returnType}>;`,
    )
    .join("\n");
  return `// @generated cross-context port — edit freely
${importLine}/**
 * ${doc}
 */
export interface ${interfaceName} {
${methodLines}
}
`;
}

interface PortSpec {
  contextName: string;
  portKind: "in" | "out";
  portBase: string;
  interfaceName: string;
  methods: PortMethod[];
  importedTypes: string[];
  doc: string;
}

async function emitPortAndAdapter(
  result: GeneratorResult,
  config: SyncConfig,
  report: ReportRecorder | undefined,
  scope: string,
  spec: PortSpec,
): Promise<void> {
  const moduleRoot = path.join(
    config.workspaceRoot,
    "packages",
    spec.contextName,
  );

  // Bespoke port — written first so the adapter can be derived from its real interface.
  const portDir = path.join(
    moduleRoot,
    "src",
    "application",
    "ports",
    spec.portKind,
  );
  const portPath = path.join(
    portDir,
    `${spec.portBase}.${spec.portKind}-port.ts`,
  );
  // Under --only, an out-of-scope port skips the whole spec: the adapter is
  // derived from the port file, so without it there is nothing to generate.
  // Guarded before mkdir so no empty `ports/<kind>` directory is left behind.
  if (!isInScope(portPath, config)) {
    return;
  }
  // PR-A2: dry-run gate — this mkdir mutated the tree despite the flag.
  if (!config.dryRun) {
    await fs.mkdir(portDir, { recursive: true });
  }
  recordWriteStatus(
    result,
    portPath,
    await safeWriteFileAtomic(
      portPath,
      portContent(
        scope,
        spec.interfaceName,
        spec.methods,
        spec.importedTypes,
        spec.doc,
      ),
      config,
      report,
    ),
  );

  // Adapter — derived from the bespoke port (reuse the mechanical generator).
  const analysis = analyzePortFile(portPath);
  if (!analysis) {
    config.logger.warn(
      `[cross-context] could not analyze ${portPath}; skipping adapter`,
    );
    return;
  }
  const adapterDir = path.join(moduleRoot, "src", "infrastructure", "adapters");
  const adapterPath = path.join(adapterDir, `${spec.portBase}.adapter.ts`);
  // Adapter lives in a different directory than the port, so re-check scope
  // before its mkdir (a glob could include the port but not the adapter).
  if (!isInScope(adapterPath, config)) {
    return;
  }
  // PR-A2: dry-run gate — this mkdir mutated the tree despite the flag.
  if (!config.dryRun) {
    await fs.mkdir(adapterDir, { recursive: true });
  }
  // The adapter CLASS name must be a valid TS identifier — `generateAdapterFromPort`
  // emits it verbatim as `export class <name>`. The file base stays kebab
  // (`message-publisher.adapter.ts`) but the class is PascalCased with the `Adapter`
  // suffix (`MessagePublisherAdapter`), matching the generic stub template's
  // `{name}Adapter` convention. Passing the kebab `portBase` here produced an
  // invalid `export class message-publisher` — a compile error in generated output.
  const adapterClassName = `${toPascalCase(spec.portBase)}Adapter`;
  // The adapter must import the port interface it implements (relative to itself).
  const portSpecifier = relativeImportSpecifier(adapterPath, portPath);
  recordWriteStatus(
    result,
    adapterPath,
    await safeWriteFileAtomic(
      adapterPath,
      generateAdapterFromPort(analysis, adapterClassName, portSpecifier),
      config,
      report,
    ),
  );
}

/** Network controller/client methods for a set of operation bases (Decision E1). */
function operationMethods(ops: string[]): PortMethod[] {
  return ops.map((op) => ({
    name: toCamelCase(op),
    paramName: "request",
    paramType: `${op}Request`,
    returnType: `${op}Response`,
  }));
}

/** The DTO type names a set of operations imports from the shared kernel. */
function operationImports(ops: string[]): string[] {
  return ops.flatMap((op) => [`${op}Request`, `${op}Response`]);
}

/** Write a shared-kernel contract under `packages/shared/src/<segments>`. */
async function writeSharedContract(
  result: GeneratorResult,
  config: SyncConfig,
  report: ReportRecorder | undefined,
  relSegments: string[],
  content: string,
): Promise<void> {
  const contractPath = path.join(
    config.workspaceRoot,
    "packages",
    "shared",
    "src",
    ...relSegments,
  );
  // PR-A2: dry-run gate — this mkdir mutated the tree despite the flag.
  if (!config.dryRun) {
    await fs.mkdir(path.dirname(contractPath), { recursive: true });
  }
  recordWriteStatus(
    result,
    contractPath,
    await safeWriteFileAtomic(contractPath, content, config, report),
  );
}

export async function generateCrossContext(
  config: SyncConfig,
  report?: ReportRecorder,
): Promise<GeneratorResult> {
  const result = createEmptyResult();
  const edges = (config.manifest as { cross_context?: CrossContextEdge[] })
    .cross_context;
  if (!Array.isArray(edges) || edges.length === 0) return result;

  const scope = resolveScope(config.manifest);

  // Aggregate by context and transport. event-bus: a provider publishes all of
  // its events (one publisher port), a consumer subscribes to the union across
  // its edges. network: a provider serves all of its operations (one controller
  // port), a consumer calls the union of operations across its edges.
  const allEvents = new Set<string>();
  const publisherEvents = new Map<string, Set<string>>();
  const subscriberEvents = new Map<string, Set<string>>();
  const allOperations = new Set<string>();
  const controllerOps = new Map<string, Set<string>>();
  const clientOps = new Map<string, Set<string>>();
  // Integration-pattern shaping (Phase 3c): a provider with any `open-host` edge
  // exposes an Open Host Service; a consumer with any `acl` edge wraps the upstream
  // contract in an Anti-Corruption Layer.
  const ohsProviders = new Set<string>();
  const aclConsumers = new Set<string>();

  for (const edge of edges) {
    // Path-safety: provider/consumer become `packages/<context>/` segments.
    // Reject traversal from an unvalidated manifest (the emitter bypasses the
    // SyncEngine per-module guard; same posture as generateApps #237).
    if (
      (edge.provider && !isSafePathSegment(edge.provider)) ||
      (edge.consumer && !isSafePathSegment(edge.consumer))
    ) {
      config.logger.warn(
        `[cross-context] skipping edge with unsafe context name: ${edge.consumer} -> ${edge.provider}`,
      );
      continue;
    }
    if (edge.integrationPattern === "open-host" && edge.provider)
      ohsProviders.add(edge.provider);
    if (edge.integrationPattern === "acl" && edge.consumer)
      aclConsumers.add(edge.consumer);
    if (edge.transport === "network") {
      // Operation names become interface names + method param/return types — drop
      // any that aren't valid TS identifiers rather than emit broken declarations.
      const operations = (edge.operations ?? []).filter(
        (o): o is string => typeof o === "string" && isValidTsIdentifier(o),
      );
      operations.forEach((o) => allOperations.add(o));
      if (edge.provider) addAll(controllerOps, edge.provider, operations);
      if (edge.consumer) addAll(clientOps, edge.consumer, operations);
    } else {
      // Unspecified / "event-bus" transport is treated as event-bus.
      const events = (edge.events ?? []).filter(
        (e): e is string => typeof e === "string" && isValidTsIdentifier(e),
      );
      events.forEach((e) => allEvents.add(e));
      if (edge.provider) addAll(publisherEvents, edge.provider, events);
      if (edge.consumer) addAll(subscriberEvents, edge.consumer, events);
    }
  }

  // ── event-bus transport ───────────────────────────────────────────────────
  // 1. Shared event contracts.
  for (const event of [...allEvents].sort()) {
    await writeSharedContract(
      result,
      config,
      report,
      ["domain", "events", `${event}.event.ts`],
      eventContractContent(event),
    );
  }

  // 2. Publisher port + adapter per provider.
  for (const provider of [...publisherEvents.keys()].sort()) {
    const events = [...(publisherEvents.get(provider) ?? [])].sort();
    await emitPortAndAdapter(result, config, report, scope, {
      contextName: provider,
      portKind: "out",
      portBase: "message-publisher",
      interfaceName: "MessagePublisherPort",
      methods: [
        {
          name: "publish",
          paramName: "event",
          paramType: events.join(" | ") || "unknown",
          returnType: "void",
        },
      ],
      importedTypes: events,
      doc:
        "Publishes this context's domain events across the event-bus boundary." +
        (ohsProviders.has(provider) ? OHS_NOTE : ""),
    });
  }

  // 3. Subscriber port + adapter per consumer.
  for (const consumer of [...subscriberEvents.keys()].sort()) {
    const events = [...(subscriberEvents.get(consumer) ?? [])].sort();
    await emitPortAndAdapter(result, config, report, scope, {
      contextName: consumer,
      portKind: "in",
      portBase: "event-listener",
      interfaceName: "EventListenerPort",
      methods: [
        {
          name: "handle",
          paramName: "event",
          paramType: events.join(" | ") || "unknown",
          returnType: "void",
        },
      ],
      importedTypes: events,
      doc:
        "Handles cross-context events this context subscribes to." +
        (aclConsumers.has(consumer) ? ACL_NOTE : ""),
    });
  }

  // ── network transport ─────────────────────────────────────────────────────
  // 4. Shared request/response DTOs per operation.
  for (const op of [...allOperations].sort()) {
    await writeSharedContract(
      result,
      config,
      report,
      ["domain", "dtos", `${op}.dto.ts`],
      dtoContent(op),
    );
  }

  // 5. Provider controller port + adapter (serves its operations).
  for (const provider of [...controllerOps.keys()].sort()) {
    const ops = [...(controllerOps.get(provider) ?? [])].sort();
    await emitPortAndAdapter(result, config, report, scope, {
      contextName: provider,
      portKind: "in",
      portBase: "rest-controller",
      interfaceName: "RestControllerPort",
      methods: operationMethods(ops),
      importedTypes: operationImports(ops),
      doc:
        "Serves this context's operations over the network boundary." +
        (ohsProviders.has(provider) ? OHS_NOTE : ""),
    });
  }

  // 6. Consumer client port + adapter (calls its providers' operations).
  for (const consumer of [...clientOps.keys()].sort()) {
    const ops = [...(clientOps.get(consumer) ?? [])].sort();
    await emitPortAndAdapter(result, config, report, scope, {
      contextName: consumer,
      portKind: "out",
      portBase: "external-service-client",
      interfaceName: "ExternalServiceClientPort",
      methods: operationMethods(ops),
      importedTypes: operationImports(ops),
      doc:
        "Calls operations on the contexts this context depends on over the network." +
        (aclConsumers.has(consumer) ? ACL_NOTE : ""),
    });
  }

  return result;
}
