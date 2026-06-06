import fs from "node:fs/promises";
import path from "node:path";
import type { SyncConfig } from "../config.js";
import { createEmptyResult, type GeneratorResult } from "../results.js";
import { safeWriteFileAtomic } from "../fs-utils.js";
import { resolveScope } from "../types/manifest.js";
import { analyzePortFile, generateAdapterFromPort } from "./port-analyzer.js";
import type { ReportRecorder } from "../domain/types.js";

/**
 * Dedicated cross-context transport emitter (Phase 3a — event-bus).
 *
 * Reads `manifest.cross_context` (edges produced by the wizard's
 * `deriveCrossContextEdges`) and writes **bespoke** transport with real
 * interfaces — recognizably an event bus, not a generic stub:
 *   - a shared event contract per event name, in the `shared` kernel;
 *   - a publisher port (`message-publisher.out-port.ts`, `publish(event)`) on each
 *     provider, plus its adapter derived via `generateAdapterFromPort`;
 *   - a subscriber port (`event-listener.in-port.ts`, `handle(event)`) on each
 *     consumer, plus its adapter.
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
}

function recordStatus(
  result: GeneratorResult,
  filePath: string,
  status: "created" | "updated" | "unchanged" | "skipped" | "protected",
): void {
  if (status === "created") result.created.push(filePath);
  else if (status === "updated") result.updated.push(filePath);
  else if (status === "skipped" || status === "protected")
    result.skipped.push(filePath);
  if (status === "created" || status === "updated") result.totalOps += 1;
}

function addAll(
  map: Map<string, Set<string>>,
  key: string,
  values: string[],
): void {
  const set = map.get(key) ?? new Set<string>();
  values.forEach((v) => set.add(v));
  map.set(key, set);
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

function portContent(
  scope: string,
  interfaceName: string,
  method: string,
  events: string[],
  doc: string,
): string {
  const hasEvents = events.length > 0;
  const importLine = hasEvents
    ? `import type { ${events.join(", ")} } from "@${scope}/shared";\n\n`
    : "";
  const union = hasEvents ? events.join(" | ") : "unknown";
  return `// @generated cross-context port — edit freely
${importLine}/**
 * ${doc}
 */
export interface ${interfaceName} {
  ${method}(event: ${union}): Promise<void>;
}
`;
}

interface PortSpec {
  contextName: string;
  portKind: "in" | "out";
  portBase: string;
  interfaceName: string;
  method: string;
  events: string[];
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
  await fs.mkdir(portDir, { recursive: true });
  const portPath = path.join(
    portDir,
    `${spec.portBase}.${spec.portKind}-port.ts`,
  );
  recordStatus(
    result,
    portPath,
    await safeWriteFileAtomic(
      portPath,
      portContent(
        scope,
        spec.interfaceName,
        spec.method,
        spec.events,
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
  await fs.mkdir(adapterDir, { recursive: true });
  const adapterPath = path.join(adapterDir, `${spec.portBase}.adapter.ts`);
  recordStatus(
    result,
    adapterPath,
    await safeWriteFileAtomic(
      adapterPath,
      generateAdapterFromPort(analysis, spec.portBase),
      config,
      report,
    ),
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

  // Aggregate by context. A provider publishes all of its events (one publisher
  // port); a consumer subscribes to the union of events across its edges.
  const allEvents = new Set<string>();
  const publisherEvents = new Map<string, Set<string>>();
  const subscriberEvents = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (edge.transport && edge.transport !== "event-bus") continue; // 3a: event-bus only
    const events = (edge.events ?? []).filter(
      (e): e is string => typeof e === "string" && e.length > 0,
    );
    events.forEach((e) => allEvents.add(e));
    if (edge.provider) addAll(publisherEvents, edge.provider, events);
    if (edge.consumer) addAll(subscriberEvents, edge.consumer, events);
  }

  // 1. Shared event contracts.
  for (const event of [...allEvents].sort()) {
    const contractPath = path.join(
      config.workspaceRoot,
      "packages",
      "shared",
      "src",
      "domain",
      "events",
      `${event}.event.ts`,
    );
    await fs.mkdir(path.dirname(contractPath), { recursive: true });
    recordStatus(
      result,
      contractPath,
      await safeWriteFileAtomic(
        contractPath,
        eventContractContent(event),
        config,
        report,
      ),
    );
  }

  // 2. Publisher port + adapter per provider.
  for (const provider of [...publisherEvents.keys()].sort()) {
    await emitPortAndAdapter(result, config, report, scope, {
      contextName: provider,
      portKind: "out",
      portBase: "message-publisher",
      interfaceName: "MessagePublisherPort",
      method: "publish",
      events: [...(publisherEvents.get(provider) ?? [])].sort(),
      doc: "Publishes this context's domain events across the event-bus boundary.",
    });
  }

  // 3. Subscriber port + adapter per consumer.
  for (const consumer of [...subscriberEvents.keys()].sort()) {
    await emitPortAndAdapter(result, config, report, scope, {
      contextName: consumer,
      portKind: "in",
      portBase: "event-listener",
      interfaceName: "EventListenerPort",
      method: "handle",
      events: [...(subscriberEvents.get(consumer) ?? [])].sort(),
      doc: "Handles cross-context events this context subscribes to.",
    });
  }

  return result;
}
